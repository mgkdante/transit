from pathlib import Path

import pytest

from transit_ops.ingestion.storage import LocalBronzeStorage
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
