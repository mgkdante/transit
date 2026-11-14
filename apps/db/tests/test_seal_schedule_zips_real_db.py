from uuid import uuid4

import pytest
from sqlalchemy import text
from test_seal_schedule_zips import SHA, ZIP

from transit_ops.history.seal_objects import archive_schedule_zip
from transit_ops.ingestion.storage import LocalBronzeStorage


@pytest.fixture
def edition(real_db_engine, seed_provider, tmp_path):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        provider = f"zip-{uuid4().hex}"
        seed_provider(connection, provider, display_name="Schedule archive test")
        endpoint = connection.execute(
            text("""
            INSERT INTO core.feed_endpoints
                (provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:p, 'schedule', 'static_schedule', 'gtfs_schedule_zip')
            RETURNING feed_endpoint_id
        """),
            dict(p=provider),
        ).scalar_one()
        run = connection.execute(
            text("""
            INSERT INTO raw.ingestion_runs
                (provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:p, :e, 'static_schedule', 'succeeded') RETURNING ingestion_run_id
        """),
            dict(p=provider, e=endpoint),
        ).scalar_one()
        obj = connection.execute(
            text("""
            INSERT INTO raw.ingestion_objects (provider_id, ingestion_run_id, object_kind,
                storage_backend, storage_path, checksum_sha256, byte_size)
            VALUES (:p, :r, 'static_schedule', 'local', 'original.zip', :s, 22)
            RETURNING ingestion_object_id
        """),
            dict(p=provider, r=run, s=SHA),
        ).scalar_one()
        version = connection.execute(
            text("""
            INSERT INTO core.dataset_versions (provider_id, feed_endpoint_id,
                source_ingestion_run_id, source_ingestion_object_id, content_hash,
                checksum_sha256, storage_backend, storage_path, byte_size)
            VALUES (:p, :e, :r, :o, :s, :s, 'local', 'original.zip', 22)
            RETURNING dataset_version_id
        """),
            dict(p=provider, e=endpoint, r=run, o=obj, s=SHA),
        ).scalar_one()
        (tmp_path / "original.zip").write_bytes(ZIP)
        yield (
            connection,
            LocalBronzeStorage("local", tmp_path),
            dict(provider_id=provider, dataset_version_id=version, archive_backend="local"),
        )
        if transaction.is_active:
            transaction.rollback()


def seal(edition):
    connection, store, selection = edition
    return archive_schedule_zip(connection, lambda _: store, **selection)


def test_zip_is_archived_once_under_its_checksum(edition):
    _, store, selection = edition
    result = seal(edition)
    assert result.storage_path == f"archive/v1/schedules/{selection['provider_id']}/{SHA}.zip"
    assert (result.checksum_sha256, result.byte_size, result.outcome) == (SHA, 22, "created")
    assert store.read_bytes(result.storage_path) == store.read_bytes("original.zip") == ZIP


def test_archiving_the_same_zip_again_writes_nothing(edition):
    result = seal(edition)
    assert seal(edition).outcome == "already_equal"
    edition[1].delete_object("original.zip")
    assert seal(edition).outcome == "already_equal"
    assert edition[1].read_bytes(result.storage_path) == ZIP


def test_zip_of_an_inactive_provider_is_archived(edition):
    connection, _, selection = edition
    connection.execute(
        text("UPDATE core.providers SET is_active=false WHERE provider_id=:p"),
        dict(p=selection["provider_id"]),
    )
    connection.execute(
        text("UPDATE core.dataset_versions SET is_current=false WHERE dataset_version_id=:v"),
        dict(v=selection["dataset_version_id"]),
    )
    assert seal(edition).outcome == "created"


def test_archived_zip_is_read_back_and_matches(edition):
    result = seal(edition)
    store = edition[1]
    (store.root / result.storage_path).write_bytes(b"x" * 22)
    with pytest.raises(ValueError, match="Destination"):
        seal(edition)


@pytest.mark.parametrize("checksum", [None, SHA.upper()])
def test_edition_identity_uses_provider_and_checksum_fallback(edition, checksum):
    connection, store, selection = edition
    connection.execute(
        text(
            "UPDATE core.dataset_versions SET checksum_sha256=:s, content_hash=:h, byte_size=NULL "
            "WHERE dataset_version_id=:v"
        ),
        dict(
            s=checksum, h=SHA if checksum is None else "legacy", v=selection["dataset_version_id"]
        ),
    )
    assert seal(edition).checksum_sha256 == SHA
    with pytest.raises(ValueError, match="not found"):
        archive_schedule_zip(connection, lambda _: store, **(selection | {"provider_id": "other"}))


def test_schedule_archive_preserves_transaction_and_source(edition):
    connection, store, selection = edition
    transaction = connection.get_transaction()
    result = seal(edition)
    assert connection.get_transaction() is transaction
    connection.rollback()
    assert (
        connection.execute(
            text("SELECT count(*) FROM core.dataset_versions WHERE dataset_version_id=:v"),
            dict(v=selection["dataset_version_id"]),
        ).scalar_one()
        == 0
    )
    assert store.read_bytes(result.storage_path) == store.read_bytes("original.zip") == ZIP
