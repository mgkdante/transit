import hashlib
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import pytest

from transit_ops.ingestion import storage as bronze
from transit_ops.ingestion.storage import BronzeStorageError, LocalBronzeStorage
from transit_ops.lake.objects import ObjectKeyTaken, object_digest, put_create_only


def test_put_create_only_creates_then_reports_equal_for_the_same_bytes(tmp_path):
    storage = LocalBronzeStorage(storage_backend="local", root=tmp_path / "objects")
    source = tmp_path / "copy"
    source.write_bytes(b"abc")

    assert put_create_only(storage, source, "archive/copy") == "created"
    assert not source.exists()
    assert storage.read_bytes("archive/copy") == b"abc"

    source.write_bytes(b"abc")
    assert put_create_only(storage, source, "archive/copy") == "already_equal"
    assert source.read_bytes() == b"abc"
    assert storage.read_bytes("archive/copy") == b"abc"


@pytest.mark.parametrize("replacement", [b"abd", b"abcd", b""])
def test_put_create_only_refuses_different_bytes_and_leaves_the_object(tmp_path, replacement):
    storage = LocalBronzeStorage(storage_backend="local", root=tmp_path / "objects")
    source = tmp_path / "copy"
    source.write_bytes(b"abc")
    assert put_create_only(storage, source, "archive/copy") == "created"
    source.write_bytes(replacement)

    with pytest.raises(ObjectKeyTaken, match="archive/copy"):
        put_create_only(storage, source, "archive/copy")

    assert storage.read_bytes("archive/copy") == b"abc"
    assert source.read_bytes() == replacement


@pytest.mark.parametrize(
    ("payload", "digest"),
    [
        (b"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
        (b"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
        (b"a" * 1_000_000, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"),
    ],
)
def test_object_digest_streams_size_and_sha256(tmp_path, monkeypatch, payload, digest):
    storage = LocalBronzeStorage(storage_backend="local", root=tmp_path / "objects")
    source = tmp_path / "copy"
    source.write_bytes(payload)
    storage.put_if_absent(source, "archive/copy")
    original_open = Path.open

    class BoundedReader:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.stream.close()

        def read(self, size=-1):
            assert 0 < size <= 1024 * 1024, "object reads must be bounded"
            return self.stream.read(size)

    def opened(path, *args, **kwargs):
        return BoundedReader(original_open(path, *args, **kwargs))

    monkeypatch.setattr(Path, "open", opened)
    assert object_digest(storage, "archive/copy") == (digest, len(payload))


@pytest.mark.parametrize("occupied", [False, True])
@pytest.mark.parametrize(
    "expected", [(hashlib.sha256(b"abd").hexdigest(), 3), (hashlib.sha256(b"abc").hexdigest(), 4)]
)
def test_expected_identity_refuses_source_before_upload(tmp_path, occupied, expected):
    storage = LocalBronzeStorage("local", tmp_path / "objects")
    source = tmp_path / "source"
    source.write_bytes(b"abc")
    if occupied:
        storage.put_if_absent(source, "copy")
        source.write_bytes(b"abc")
    with pytest.raises(ValueError, match="copy"):
        put_create_only(storage, source, "copy", expected=expected)
    assert source.read_bytes() == b"abc"
    assert storage.exists("copy") == occupied
    if occupied:
        assert storage.read_bytes("copy") == b"abc"


def test_expected_identity_accepts_creation_and_equal_replay(tmp_path):
    storage = LocalBronzeStorage("local", tmp_path / "objects")
    source = tmp_path / "source"
    expected = (hashlib.sha256(b"abc").hexdigest(), 3)
    source.write_bytes(b"abc")
    assert put_create_only(storage, source, "copy", expected=expected) == "created"
    source.write_bytes(b"abc")
    assert put_create_only(storage, source, "copy", expected=expected) == "already_equal"
    assert storage.read_bytes("copy") == source.read_bytes() == b"abc"


def test_storage_failure_propagates_and_keeps_source(tmp_path):
    class Unavailable(bronze.BronzeStorage):
        def put_if_absent(self, path, key):
            raise BronzeStorageError("unavailable")

    source = tmp_path / "source"
    source.write_bytes(b"abc")
    with pytest.raises(BronzeStorageError, match="unavailable"):
        put_create_only(Unavailable("local"), source, "copy")
    assert source.read_bytes() == b"abc"


@pytest.mark.parametrize("abort", [False, True])
def test_overlapping_writer_never_accepts_partial_bytes(tmp_path, monkeypatch, abort):
    storage = LocalBronzeStorage("local", tmp_path / "objects")
    source, contender = tmp_path / "source", tmp_path / "contender"
    source.write_bytes(b"prefix-tail")
    contender.write_bytes(b"prefix")
    paused, release = Event(), Event()
    original_copy = bronze.shutil.copyfileobj

    def copy(reader, destination):
        if Path(reader.name) != source:
            return original_copy(reader, destination)
        destination.write(reader.read(6))
        destination.flush()
        paused.set()
        assert release.wait(10), "writer was not released"
        if abort:
            raise OSError("interrupted copy")
        original_copy(reader, destination)

    monkeypatch.setattr(bronze.shutil, "copyfileobj", copy)
    with ThreadPoolExecutor(max_workers=1) as pool:
        writer = pool.submit(put_create_only, storage, source, "copy")
        assert paused.wait(10), "writer did not pause"
        try:
            assert put_create_only(storage, contender, "copy") == "created"
        finally:
            release.set()
        with pytest.raises(OSError if abort else ObjectKeyTaken):
            writer.result(timeout=10)
    assert storage.read_bytes("copy") == b"prefix"
    assert source.read_bytes() == b"prefix-tail"
    assert not contender.exists()
    assert set(storage.root.iterdir()) == {storage.root / "copy"}


def test_interrupted_copy_leaves_no_published_object(tmp_path, monkeypatch):
    storage = LocalBronzeStorage("local", tmp_path / "objects")
    source = tmp_path / "source"
    source.write_bytes(b"prefix-tail")

    def interrupt(reader, destination):
        destination.write(reader.read(6))
        destination.flush()
        raise OSError("interrupted copy")

    with monkeypatch.context() as patch:
        patch.setattr(bronze.shutil, "copyfileobj", interrupt)
        with pytest.raises(OSError, match="interrupted copy"):
            put_create_only(storage, source, "copy")
    assert not storage.exists("copy")
    assert list(storage.root.iterdir()) == []
    assert source.read_bytes() == b"prefix-tail"
    assert put_create_only(storage, source, "copy") == "created"


def test_process_exit_after_partial_copy_does_not_reserve_key(tmp_path):
    source, root = tmp_path / "source", tmp_path / "objects"
    source.write_bytes(b"prefix-tail")
    program = """
import os, sys
from pathlib import Path
from transit_ops.ingestion import storage as bronze
from transit_ops.lake.objects import put_create_only
def stop(reader, destination):
    destination.write(reader.read(6))
    destination.flush()
    os._exit(71)
bronze.shutil.copyfileobj = stop
put_create_only(bronze.LocalBronzeStorage('local', Path(sys.argv[2])),
                Path(sys.argv[1]), 'copy')
"""
    child = subprocess.run(
        [sys.executable, "-c", program, str(source), str(root)], capture_output=True, timeout=30
    )
    assert child.returncode == 71, child.stderr.decode()
    storage = LocalBronzeStorage("local", root)
    assert not storage.exists("copy")
    assert source.read_bytes() == b"prefix-tail"
    assert put_create_only(storage, source, "copy") == "created"
    assert storage.read_bytes("copy") == b"prefix-tail"
