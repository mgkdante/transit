import gzip
import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from history_fixtures import delete_provider_rows, seed_stored_capture
from sqlalchemy import text

from transit_ops.history import ledger, seal_captures
from transit_ops.history.store import seal
from transit_ops.ingestion.storage import LocalBronzeStorage, ObjectAlreadyExists

PROVIDER = "history_seal_repair_test"
START = datetime(2026, 1, 2, tzinfo=UTC)
DAY = START.date()
PREFIX = f"archive/v1/captures/{PROVIDER}/trip_updates/2026/01/2026-01-02.c"


@pytest.fixture
def engine(real_db_engine, seed_provider, tmp_path):
    try:
        with real_db_engine.begin() as conn:
            delete_provider_rows(conn, PROVIDER)
            seed_provider(conn, PROVIDER, display_name="Seal repair test")
            seed_stored_capture(
                conn,
                tmp_path,
                provider_id=PROVIDER,
                endpoint_key="trip_updates",
                run_id=772001,
                capture_id=772001,
                started_at_utc=START,
                payload=b"capture",
            )
        yield real_db_engine
    finally:
        with real_db_engine.begin() as conn:
            delete_provider_rows(conn, PROVIDER)


def run_seal(engine, storage):
    with engine.connect() as conn:
        return seal(
            conn,
            lambda backend: storage,
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            window_key=DAY.isoformat(),
            archive_backend="local",
            sealed_by="test-commit",
            actor="test",
        )


def copies(engine):
    with engine.begin() as conn:
        return ledger.find_copies(
            conn,
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            start=DAY,
            end=DAY,
        )


def events(engine):
    with engine.begin() as conn:
        return conn.execute(
            text(
                "SELECT kind, content_version, reason FROM core.history_event "
                "WHERE provider_id=:p ORDER BY event_id"
            ),
            {"p": PROVIDER},
        ).all()


def assert_marker(root, copy, reason):
    data = (root / (PREFIX + "1.rejected.json.gz")).read_bytes()
    assert data[4:8] == b"\0\0\0\0"
    assert json.loads(gzip.decompress(data)) == dict(
        content_version=1,
        dataset_id="capture.trip_updates",
        provider_id=PROVIDER,
        reason=reason,
        rejected_at_utc=copy.rejected_at_utc.astimezone(UTC)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z"),
        revision=0,
        window_key="2026-01-02",
    )


@pytest.mark.parametrize("after_both", [False, True])
def test_crash_after_allocation_is_completed_or_rejected(engine, tmp_path, monkeypatch, after_both):
    local = LocalBronzeStorage("local", tmp_path)
    real_event = ledger.record_event

    def crash_event(*args, **kwargs):
        if kwargs["kind"] == "seal":
            raise RuntimeError("crash after manifest")
        return real_event(*args, **kwargs)

    def crash_write(path, key):
        if key.endswith(".manifest.json.gz"):
            raise RuntimeError("crash after pack")
        return local.put_if_absent(path, key)

    with monkeypatch.context() as patch:
        if after_both:
            patch.setattr(seal_captures.ledger, "record_event", crash_event)
        broken = SimpleNamespace(
            put_if_absent=crash_write,
            list_keys=local.list_keys,
            open_stream=local.open_stream,
            exists=local.exists,
        )
        with pytest.raises(RuntimeError, match="crash after"):
            run_seal(engine, local if after_both else broken)
    assert [(c.content_version, c.state) for c in copies(engine)] == [(1, "allocated")]
    assert local.exists(PREFIX + "1.pack.xz")
    assert local.exists(PREFIX + "1.manifest.json.gz") == after_both
    result = run_seal(engine, local)
    assert (result.content_version, result.state) == (1 if after_both else 2, "sealed")
    if after_both:
        assert events(engine) == [("seal", 1, None)]
        assert len(copies(engine)) == 1
        assert not any(key.startswith(PREFIX + "2.") for key in local.list_keys(PREFIX))
    else:
        first, second = copies(engine)
        assert (first.state, first.reject_reason, second.state) == (
            "rejected",
            "incomplete_write",
            "sealed",
        )
        assert_marker(tmp_path, first, "incomplete_write")
        assert events(engine) == [("reject", 1, "incomplete_write"), ("seal", 2, None)]


@pytest.mark.parametrize("own_object", [False, True])
def test_final_key_is_never_overwritten(engine, tmp_path, own_object):
    local = LocalBronzeStorage("local", tmp_path)

    def write(path, key):
        if own_object:
            local.put_if_absent(path, key)
            raise ObjectAlreadyExists("write already landed")
        if key == PREFIX + "1.pack.xz":
            other = tmp_path / "other"
            other.write_bytes(b"someone else's bytes")
            local.put_if_absent(other, key)
        return local.put_if_absent(path, key)

    storage = SimpleNamespace(
        put_if_absent=write,
        list_keys=local.list_keys,
        open_stream=local.open_stream,
        exists=local.exists,
    )
    if own_object:
        result = run_seal(engine, storage)
        assert (result.content_version, result.state) == (1, "sealed")
        assert events(engine) == [("seal", 1, None)]
    else:
        with pytest.raises(ObjectAlreadyExists):
            run_seal(engine, storage)
        assert local.read_bytes(PREFIX + "1.pack.xz") == b"someone else's bytes"
        (first,) = copies(engine)
        assert (first.state, first.reject_reason) == ("rejected", "key_taken")
        assert_marker(tmp_path, first, "key_taken")
        result = run_seal(engine, local)
        assert (result.content_version, result.state) == (2, "sealed")
        assert events(engine) == [("reject", 1, "key_taken"), ("seal", 2, None)]
