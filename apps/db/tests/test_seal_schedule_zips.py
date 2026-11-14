from unittest.mock import Mock

import pytest

from transit_ops.history.seal_objects import archive_schedule_zip
from transit_ops.ingestion.storage import LocalBronzeStorage

ZIP = b"PK\x05\x06" + bytes(18)
SHA = "8739c76e681f900923b900c9df0ef75cf421d39cabb54650c4b9ad19b6a76d85"
KEY = f"archive/v1/schedules/network/{SHA}.zip"


def setup(tmp_path, **changes):
    store = LocalBronzeStorage("local", tmp_path)
    (tmp_path / "original.zip").write_bytes(ZIP)
    row = dict(
        checksum_sha256=SHA,
        byte_size=22,
        storage_backend="local",
        storage_path="original.zip",
        source_ingestion_object_id=None,
        raw_id=None,
        raw_checksum=None,
        raw_size=None,
        raw_backend=None,
        raw_path=None,
    )
    row.update(changes)
    connection = Mock()
    connection.execute.return_value.mappings.return_value.one_or_none.return_value = row
    return connection, store


def archive(connection, store, **selection):
    return archive_schedule_zip(
        connection,
        lambda _: store,
        provider_id="network",
        dataset_version_id=7,
        archive_backend="local",
        **selection,
    )


def test_zip_is_archived_once_under_its_checksum(tmp_path):
    connection, store = setup(tmp_path)
    result = archive(connection, store)
    assert (result.storage_path, result.checksum_sha256, result.byte_size) == (KEY, SHA, 22)
    assert result.outcome == "created"
    assert store.read_bytes(KEY) == store.read_bytes("original.zip") == ZIP


@pytest.mark.parametrize(
    "changes",
    [
        dict(checksum_sha256="bad"),
        dict(byte_size=0),
        dict(raw_checksum="0" * 64),
        dict(raw_size=23),
        dict(source_ingestion_object_id=9),
        dict(storage_path=None),
    ],
)
def test_schedule_archive_refuses_conflicting_metadata(tmp_path, changes):
    connection, store = setup(tmp_path, **changes)
    with pytest.raises(ValueError):
        archive(connection, store)
    assert not store.exists(KEY)
    assert store.read_bytes("original.zip") == ZIP


@pytest.mark.parametrize(
    "provider", ["", ".", "..", "/root", "a/b", "a\\b", "C:escape", "x\n", "Network", "schemas"]
)
def test_schedule_archive_refuses_unsafe_keys(tmp_path, provider):
    connection, store = setup(tmp_path)
    with pytest.raises(ValueError):
        archive_schedule_zip(
            connection,
            lambda _: store,
            provider_id=provider,
            dataset_version_id=7,
            archive_backend="local",
        )
    connection.execute.assert_not_called()


def test_schedule_archive_requires_transaction(tmp_path):
    connection, store = setup(tmp_path)
    connection.in_transaction.return_value = False
    with pytest.raises(ValueError, match="transaction"):
        archive(connection, store)
    connection.execute.assert_not_called()


@pytest.mark.parametrize("digest", [SHA.upper(), SHA[:63]], ids=["uppercase", "short"])
def test_schedule_archive_refuses_noncanonical_digest(tmp_path, digest):
    connection, store = setup(tmp_path, checksum_sha256=digest)
    with pytest.raises(ValueError, match="Invalid edition checksum"):
        archive(connection, store)
    assert not store.exists(KEY)


def test_archived_zip_is_read_back_and_matches(tmp_path):
    class Damaged(LocalBronzeStorage):
        def put_if_absent(self, path, key):
            super().put_if_absent(path, key)
            (self.root / key).write_bytes(b"x" * 22)

    connection, _ = setup(tmp_path)
    store = Damaged("local", tmp_path)
    with pytest.raises(ValueError, match="[Dd]estination"):
        archive(connection, store)
    assert store.read_bytes(KEY) == b"x" * 22
    assert store.read_bytes("original.zip") == ZIP


def test_archiving_the_same_zip_again_writes_nothing(tmp_path):
    connection, store = setup(tmp_path, byte_size=None)
    result = archive(connection, store)
    assert (result.outcome, result.byte_size) == ("created", 22)
    result = archive(connection, store)
    assert (result.outcome, result.byte_size) == ("already_equal", 22)
    (tmp_path / "original.zip").unlink()
    result = archive(connection, store)
    assert (result.outcome, result.byte_size) == ("already_equal", 22)
    assert store.read_bytes(KEY) == ZIP


def test_schedule_archive_reports_unreadable_sources(tmp_path):
    class Unreadable(LocalBronzeStorage):
        def open_stream(self, key, **kwargs):
            raise PermissionError("unavailable")

    connection, _ = setup(tmp_path)
    store = Unreadable("local", tmp_path)
    with pytest.raises(PermissionError, match="unavailable"):
        archive(connection, store)
    (tmp_path / "original.zip").unlink()
    with pytest.raises(FileNotFoundError):
        archive(connection, store)
    assert not store.exists(KEY)


@pytest.mark.parametrize("target", ["original.zip", KEY])
def test_schedule_archive_refuses_conflicting_bytes(tmp_path, target):
    connection, store = setup(tmp_path)
    path = tmp_path / target
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * 22)
    with pytest.raises(ValueError, match="digest or size"):
        archive(connection, store)
    assert path.read_bytes() == b"x" * 22


def test_schedule_archive_handles_two_equal_writers(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    barrier = Barrier(2)

    class Racing(LocalBronzeStorage):
        def exists(self, key):
            if key == KEY:
                barrier.wait(timeout=10)
                return False
            return super().exists(key)

    connection, _ = setup(tmp_path)
    store = Racing("local", tmp_path)
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: archive(connection, store), range(2)))
    assert {r.outcome for r in results} == {"created", "already_equal"}
    assert store.read_bytes(KEY) == store.read_bytes("original.zip") == ZIP


def test_equal_bytes_have_provider_scoped_keys(tmp_path):
    connection, store = setup(tmp_path)
    first = archive(connection, store)
    second = archive_schedule_zip(
        connection,
        lambda _: store,
        provider_id="second",
        dataset_version_id=8,
        archive_backend="local",
    )
    assert second.storage_path == f"archive/v1/schedules/second/{SHA}.zip"
    assert store.read_bytes(first.storage_path) == store.read_bytes(second.storage_path) == ZIP
