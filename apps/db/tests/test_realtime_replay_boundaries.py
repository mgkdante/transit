from __future__ import annotations

import hashlib
from dataclasses import replace
from io import BytesIO

import pytest
from realtime_replay_fixtures import (
    PROVIDER,
    REALTIME_SILVER_TABLES,
    SNAPSHOTS,
    WINDOW_END,
    WINDOW_START,
    _seed_provider_and_static,
    _seed_raw_realtime_snapshots,
    _silver_counts,
    _storage_path,
    _StubRegistry,
)
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from transit_ops.ingestion import storage as storage_module
from transit_ops.ingestion.storage import BronzeStorageError, get_bronze_storage
from transit_ops.silver.realtime_gtfs import (
    BronzeRealtimeSnapshot,
    find_realtime_bronze_snapshots,
    load_realtime_snapshots_to_silver,
    replay_realtime_silver_window,
)


def test_provider_mismatch_rejects_the_whole_batch_before_archive_io():
    snapshot = BronzeRealtimeSnapshot(
        provider_id=PROVIDER,
        endpoint_key="trip_updates",
        storage_backend="local",
        feed_endpoint_id=1,
        ingestion_run_id=1,
        ingestion_object_id=1,
        realtime_snapshot_id=1,
        storage_path="capture.pb",
        archive_full_path="capture.pb",
        source_url=None,
        checksum_sha256=hashlib.sha256(b"").hexdigest(),
        byte_size=0,
        feed_timestamp_utc=WINDOW_START,
        captured_at_utc=WINDOW_START,
    )

    def resolve_storage(backend):
        pytest.fail(f"Provider validation must precede {backend} archive access")

    with pytest.raises(ValueError, match="requested provider"):
        load_realtime_snapshots_to_silver(
            object(),
            provider_id=PROVIDER,
            snapshots=[snapshot, replace(snapshot, provider_id="another_provider")],
            bronze_storage_resolver=resolve_storage,
            skip_existing=True,
            repair_incomplete=True,
        )


class _InterruptedBody(BytesIO):
    def __init__(self, payload, *, fail_close=False):
        super().__init__(payload)
        self.read_error = OSError("interrupted archive stream")
        self.fail_close = fail_close
        self.close_calls = 0

    def read(self, *args, **kwargs):
        raise self.read_error

    def close(self):
        self.close_calls += 1
        super().close()
        if self.fail_close:
            raise OSError("archive close failed")


class _ArchiveClient:
    def __init__(self, key, body):
        self.key = key
        self.body = body
        self.requests = []
        self.close_calls = 0

    def get_object(self, *, Bucket, Key):
        self.requests.append((Bucket, Key))
        assert Key == self.key
        return {"Body": self.body}

    def close(self):
        self.close_calls += 1


@pytest.mark.parametrize("fault", ["read", "read_and_close", "checksum"])
def test_mixed_backend_replay_closes_archive_resources_and_rolls_back_on_failure(
    engine, settings, seed_provider, bronze_root, monkeypatch, fault
):
    second_snapshot_id, _, second_object_id, _, _ = SNAPSHOTS[1]
    key = _storage_path(second_snapshot_id)
    payload = (bronze_root / key).read_bytes()
    read_fails = fault != "checksum"
    body = (
        _InterruptedBody(payload, fail_close=fault == "read_and_close")
        if read_fails
        else BytesIO(payload[:-1] + bytes([payload[-1] ^ 1]))
    )
    client = _ArchiveClient(key, body)
    constructions = []

    def build_client(configuration):
        constructions.append(configuration.BRONZE_S3_BUCKET)
        return client

    monkeypatch.setattr(storage_module, "build_s3_client", build_client)
    configuration = settings.model_copy(
        update={
            "BRONZE_S3_ENDPOINT": "https://bronze.example.invalid",
            "BRONZE_S3_BUCKET": "replay-test",
            "BRONZE_S3_ACCESS_KEY": "test-access",
            "BRONZE_S3_SECRET_KEY": "test-secret",
        }
    )
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)
        _seed_raw_realtime_snapshots(connection)
        connection.execute(
            text(
                "UPDATE raw.ingestion_objects SET storage_backend='s3' "
                "WHERE ingestion_object_id=:object_id"
            ),
            {"object_id": second_object_id},
        )

    exception = BronzeStorageError if read_fails else ValueError
    message = "interrupted archive stream" if read_fails else "checksum mismatch"
    with pytest.raises(exception, match=message) as failure:
        replay_realtime_silver_window(
            PROVIDER,
            start_utc=WINDOW_START,
            end_utc=WINDOW_END,
            settings=configuration,
            registry=_StubRegistry(),
            engine=engine,
        )

    assert constructions == ["replay-test"]
    assert client.requests == [("replay-test", key)]
    assert client.close_calls == 1
    with engine.connect() as connection:
        assert _silver_counts(connection) == dict.fromkeys(REALTIME_SILVER_TABLES, 0)
    assert body.closed
    if read_fails:
        assert failure.value.__cause__ is body.read_error
        assert body.close_calls == 1
        assert "archive close failed" not in str(failure.value)


@pytest.mark.parametrize("already_complete", [False, True])
def test_cooperating_snapshot_writer_waits_until_first_replay_rolls_back(
    engine, settings, seed_provider, bronze_root, already_complete
):
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)
        _seed_raw_realtime_snapshots(connection)
    with engine.connect() as connection:
        snapshots = find_realtime_bronze_snapshots(
            connection,
            provider_id=PROVIDER,
            start_utc=WINDOW_START,
            end_utc=WINDOW_END,
            settings=settings,
            project_root=bronze_root,
        )[:1]
    storage = get_bronze_storage(settings, project_root=bronze_root)

    def replay(connection):
        return load_realtime_snapshots_to_silver(
            connection,
            provider_id=PROVIDER,
            snapshots=snapshots,
            bronze_storage_resolver=lambda _backend: storage,
            skip_existing=True,
            repair_incomplete=True,
        )

    if already_complete:
        with engine.begin() as connection:
            assert replay(connection).loaded_count == 1

    with engine.connect() as owner, engine.connect() as contender:
        transaction = owner.begin()
        try:
            first = replay(owner)
            assert first.loaded_count == (0 if already_complete else 1)
            with pytest.raises(OperationalError) as blocked:
                with contender.begin():
                    contender.execute(text("SET LOCAL lock_timeout='150ms'"))
                    replay(contender)
            assert blocked.value.orig.sqlstate == "55P03"
        finally:
            transaction.rollback()
        with contender.begin():
            retried = replay(contender)
            assert retried.loaded_count == (0 if already_complete else 1)
            assert retried.verified_row_counts == first.verified_row_counts

    with engine.connect() as connection:
        assert _silver_counts(connection) == {
            table: (0 if table == "silver.rt_vehicle_positions" else 1)
            for table in REALTIME_SILVER_TABLES
        }
