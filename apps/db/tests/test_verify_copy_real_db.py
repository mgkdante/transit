import gzip
import importlib
import json
from collections import Counter
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from history_fixtures import delete_provider_rows, seed_stored_capture, seed_working_day
from sqlalchemy import text

from transit_ops.history import ledger, store
from transit_ops.history.manifest import read_copy_manifest
from transit_ops.history.seal_captures import CopyContentMissing
from transit_ops.history.verify import Verification
from transit_ops.ingestion.storage import LocalBronzeStorage

verify_module = importlib.import_module("transit_ops.history.verify")
PROVIDER = "history_verify_test"
START = datetime(2026, 1, 2, tzinfo=UTC)
DAY = START.date()


@pytest.fixture
def engine(real_db_engine, seed_provider):
    try:
        with real_db_engine.begin() as conn:
            delete_provider_rows(conn, PROVIDER)
            seed_provider(conn, PROVIDER, display_name="Verify test")
            conn.execute(
                text("""
                INSERT INTO core.feed_endpoints
                    (provider_id, endpoint_key, feed_kind, source_format)
                VALUES (:p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            """),
                dict(p=PROVIDER),
            )
        yield real_db_engine
    finally:
        with real_db_engine.begin() as conn:
            delete_provider_rows(conn, PROVIDER)


def seed(engine, root, ids=range(773001, 773004), *, failed=False, day=START):
    with engine.begin() as conn:
        for i, identity in enumerate(ids):
            args = dict(
                provider_id=PROVIDER,
                endpoint_key="trip_updates",
                run_id=identity,
                capture_id=identity,
                started_at_utc=day + timedelta(seconds=i * 30),
            )
            if failed:
                seed_working_day(conn, with_capture=False, status="failed", **args)
            else:
                seed_stored_capture(conn, root, payload=f"capture {identity}".encode(), **args)


def seal(engine, root, day=DAY):
    with engine.connect() as conn:
        return store.seal(
            conn,
            lambda backend: LocalBronzeStorage("local", root),
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            window_key=day.isoformat(),
            archive_backend="local",
            sealed_by="test-commit",
        )


def verify(engine, root, copy, storage_type=LocalBronzeStorage):
    with engine.connect() as conn:
        result = store.verify(conn, lambda backend: storage_type("local", root), copy, actor="test")
    assert isinstance(result, Verification)
    return result


def snapshot(engine, copy):
    with engine.begin() as conn:
        args = dict(dataset_id=copy.dataset_id, provider_id=PROVIDER, window_key=copy.window_key)
        window = ledger.window_state(conn, **args)
        copies = ledger.find_copies(
            conn,
            dataset_id=copy.dataset_id,
            provider_id=PROVIDER,
            start=DAY,
            end=DAY + timedelta(days=1),
        )
        row = next(
            c
            for c in copies
            if c.content_version == copy.content_version and c.window_key == copy.window_key
        )
        events = conn.execute(
            text(
                "SELECT kind, content_version, details FROM core.history_event "
                "WHERE provider_id=:p ORDER BY event_id"
            ),
            dict(p=PROVIDER),
        ).all()
    return row, window, events


def marker(root, copy):
    return root / copy.manifest_path.replace(".manifest.json.gz", ".rejected.json.gz")


def flip(root, copy):
    path = root / copy.storage_path
    data = bytearray(path.read_bytes())
    data[len(data) // 2] ^= 1
    path.write_bytes(data)


def raw_rows(engine):
    with engine.begin() as conn:
        return [
            conn.execute(
                text(f"SELECT * FROM {table} WHERE provider_id=:p ORDER BY 1"), dict(p=PROVIDER)
            ).all()
            for table in (
                "raw.ingestion_runs",
                "raw.ingestion_objects",
                "raw.realtime_snapshot_index",
            )
        ]


def by_hand(engine, copy):
    with engine.begin() as conn:
        args = dict(p=PROVIDER, v=copy.content_version, day=copy.window_key)
        conn.execute(
            text(
                "UPDATE core.history_archive_copy SET verified_at_utc=clock_timestamp() "
                "WHERE provider_id=:p AND window_key=:day AND content_version=:v"
            ),
            args,
        )
        conn.execute(
            text(
                "UPDATE core.history_window SET current_version=:v "
                "WHERE provider_id=:p AND window_key=:day"
            ),
            args,
        )


def change(engine):
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE raw.ingestion_runs SET error_message='changed' "
                "WHERE ingestion_run_id=773004"
            )
        )


def test_verify_reads_from_storage_not_from_the_writer(engine, tmp_path):
    seed(engine, tmp_path)
    copy = seal(engine, tmp_path)
    opened, sizes = Counter(), Counter()

    class Recording(LocalBronzeStorage):
        @contextmanager
        def open_stream(self, key, **kwargs):
            opened[key] += 1
            with super().open_stream(key, **kwargs) as stream:

                class Reader:
                    def read(self, size=-1):
                        data = stream.read(size)
                        sizes[key] += len(data)
                        return data

                yield Reader()

    result = verify(engine, tmp_path, copy, Recording)
    assert (result.outcome, result.became_current) == ("verified", True)
    assert opened == {copy.manifest_path: 1, copy.storage_path: 1}
    assert sizes[copy.storage_path] == copy.byte_size
    assert result.copy.verified_at_utc is not None
    assert snapshot(engine, copy)[1].current_version == 1
    tomorrow = START + timedelta(days=1)
    seed(engine, tmp_path, [773005], day=tomorrow)
    other = seal(engine, tmp_path, tomorrow.date())
    (tmp_path / other.storage_path).unlink()
    rejected = verify(engine, tmp_path, other)
    assert (rejected.outcome, rejected.reason) == ("rejected", "corrupt_object")
    assert "pack object absent" in rejected.difference


def test_one_flipped_byte_rejects_the_copy(engine, tmp_path):
    seed(engine, tmp_path)
    copy = seal(engine, tmp_path)
    before = raw_rows(engine)
    flip(tmp_path, copy)
    result = verify(engine, tmp_path, copy)
    row, window, events = snapshot(engine, copy)
    assert (result.outcome, result.reason) == ("rejected", "corrupt_object")
    assert row.rejected_at_utc is not None and row.reject_reason == "corrupt_object"
    assert (
        json.loads(gzip.decompress(marker(tmp_path, copy).read_bytes()))["reason"] == result.reason
    )
    assert [e.kind for e in events] == ["seal", "reject"]
    assert window.current_version is None
    assert raw_rows(engine) == before
    with pytest.raises(ValueError, match="rejected"):
        verify(engine, tmp_path, copy)


def test_row_added_after_seal_rejects_the_copy_as_stale(engine, tmp_path):
    seed(engine, tmp_path)
    copy = seal(engine, tmp_path)
    seed(engine, tmp_path, [773004], day=START + timedelta(minutes=2))
    result = verify(engine, tmp_path, copy)
    assert (result.outcome, result.reason) == ("rejected", "stale")
    assert result.difference == "poll 773004 is in the working rows and not in the copy"
    assert marker(tmp_path, copy).exists()
    assert [e.kind for e in snapshot(engine, copy)[2]] == ["seal", "reject"]
    second = seal(engine, tmp_path)
    assert second.content_version == 2
    assert verify(engine, tmp_path, second).copy.is_current


def test_evidence_recorded_after_the_seal_read_rejects_the_copy_as_stale(engine, tmp_path):
    seed(engine, tmp_path)
    copy = seal(engine, tmp_path)
    with engine.begin() as conn:
        ledger.record_processing_evidence(
            conn,
            dataset_id=copy.dataset_id,
            provider_id=PROVIDER,
            window_key=copy.window_key,
            command="test",
            completed_at_utc=START + timedelta(days=14),
            rows_by_capture={773001: 5},
        )
    result = verify(engine, tmp_path, copy)
    assert result.reason == "stale" and "processing gold_facts 773001" in result.difference


def test_current_moves_only_when_the_new_copy_is_verified(engine, tmp_path):
    seed(engine, tmp_path)
    seed(engine, tmp_path, [773004], failed=True)
    first = seal(engine, tmp_path)
    verify(engine, tmp_path, first)
    change(engine)
    second = seal(engine, tmp_path)
    assert snapshot(engine, second)[1].current_version == 1
    result = verify(engine, tmp_path, second)
    assert result.copy.is_current and result.copy.content_version == 2
    assert snapshot(engine, first)[0].state == "verified"
    events = snapshot(engine, second)[2]
    assert [(e.kind, e.content_version, e.details) for e in events if e.kind != "seal"] == [
        ("verify", 1, {}),
        ("current", 1, {"previous_version": None}),
        ("verify", 2, {}),
        ("current", 2, {"previous_version": 1}),
    ]
    assert verify(engine, tmp_path, second) == result
    assert snapshot(engine, second)[2] == events


@pytest.mark.parametrize("remove_poll", [False, True], ids=["capture", "poll"])
def test_copy_that_lacks_content_of_the_current_one_cannot_replace_it(
    engine, tmp_path, remove_poll
):
    seed(engine, tmp_path)
    first = seal(engine, tmp_path)
    with engine.begin() as conn:
        for table, key in (
            ("raw.realtime_snapshot_index", "realtime_snapshot_id"),
            ("raw.ingestion_objects", "ingestion_object_id"),
            ("raw.ingestion_runs", "ingestion_run_id"),
        ):
            if table == "raw.ingestion_runs" and not remove_poll:
                continue
            conn.execute(text(f"DELETE FROM {table} WHERE {key}=773003"))
    second = seal(engine, tmp_path)
    by_hand(engine, first)
    message = "missing poll 773003" if remove_poll else "missing capture .*773003"
    with pytest.raises(CopyContentMissing, match=message):
        verify(engine, tmp_path, second)
    row, window, events = snapshot(engine, second)
    assert row.state == "sealed" and window.current_version == 1
    assert [e.kind for e in events if e.content_version == 2] == ["seal"]
    assert not marker(tmp_path, second).exists()


def test_verify_refuses_a_copy_that_loses_packed_bytes_of_the_current_one(engine, tmp_path):
    seed(engine, tmp_path, [773001])
    seed(engine, tmp_path, [773004], failed=True)
    first = seal(engine, tmp_path)
    verify(engine, tmp_path, first)

    def resolver(backend):
        return LocalBronzeStorage("local", tmp_path)

    current = read_copy_manifest(resolver, first)
    assert current.captures[0].packed
    (tmp_path / "capture/773001").unlink()
    change(engine)
    second = seal(engine, tmp_path)
    candidate = read_copy_manifest(resolver, second)
    assert not candidate.captures[0].packed
    assert candidate.polls[0].missing_reason == "object_absent"
    before = snapshot(engine, second)
    with pytest.raises(CopyContentMissing, match="packed capture .*773001") as error:
        verify(engine, tmp_path, second)
    assert f"{PROVIDER}/trip_updates/{DAY}" in str(error.value)
    assert snapshot(engine, second) == before
    assert before[0].state == "sealed" and before[1].current_version == 1
    assert not marker(tmp_path, second).exists()
    assert verify_module.read_back_capture_copy(resolver, first) == current


def test_verify_rejects_a_changed_day_as_stale(engine, tmp_path):
    seed(engine, tmp_path, [773001])
    seed(engine, tmp_path, [773004], failed=True)
    first = seal(engine, tmp_path)
    verify(engine, tmp_path, first)
    change(engine)
    second = seal(engine, tmp_path)
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE raw.ingestion_runs SET error_message='changed again' "
                "WHERE ingestion_run_id=773004"
            )
        )
    result = verify(engine, tmp_path, second)
    assert (result.outcome, result.reason, result.became_current) == ("rejected", "stale", False)
    assert result.difference == "poll 773004 differs"
    assert json.loads(gzip.decompress(marker(tmp_path, second).read_bytes()))["reason"] == "stale"
    row, window, events = snapshot(engine, second)
    assert row.state == "rejected" and row.reject_reason == "stale"
    assert window.current_version == 1
    assert [e.kind for e in events if e.content_version == 2] == ["seal", "reject"]


def test_rejection_writes_its_marker_first(engine, tmp_path, monkeypatch):
    seed(engine, tmp_path)
    copy = seal(engine, tmp_path)
    flip(tmp_path, copy)
    original = ledger.record_event

    def fail(conn, **kwargs):
        if kwargs["kind"] == "reject":
            raise RuntimeError("event failed")
        return original(conn, **kwargs)

    monkeypatch.setattr(ledger, "record_event", fail)
    with pytest.raises(RuntimeError, match="event failed"):
        verify(engine, tmp_path, copy)
    assert marker(tmp_path, copy).exists()
    row, _, events = snapshot(engine, copy)
    assert row.state == "sealed" and row.rejected_at_utc is None
    assert [e.kind for e in events] == ["seal"]


def test_verification_time_is_read_under_the_window_lock(engine, tmp_path, monkeypatch):
    seed(engine, tmp_path)
    copy = seal(engine, tmp_path)
    with engine.begin() as conn:
        before = conn.execute(text("SELECT clock_timestamp()")).scalar_one()
    observed = []
    original = verify_module.read_working_day

    def read(conn, **kwargs):
        observed.append(
            conn.execute(
                text(
                    "SELECT clock_timestamp(), count(*) FROM pg_locks "
                    "WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted"
                )
            ).one()
        )
        return original(conn, **kwargs)

    monkeypatch.setattr(verify_module, "read_working_day", read)
    result = verify(engine, tmp_path, copy)
    at, locks = observed[0]
    assert locks >= 1
    assert (
        before.astimezone(UTC) <= result.copy.verified_at_utc.astimezone(UTC) <= at.astimezone(UTC)
    )


def test_older_copy_cannot_replace_the_current_one(engine, tmp_path):
    seed(engine, tmp_path)
    seed(engine, tmp_path, [773004], failed=True)
    first = seal(engine, tmp_path)
    change(engine)
    second = seal(engine, tmp_path)
    verify(engine, tmp_path, second)
    before = snapshot(engine, first)
    with pytest.raises(ValueError, match="1.*2"):
        verify(engine, tmp_path, first)
    assert snapshot(engine, first) == before
    assert not marker(tmp_path, first).exists()


@pytest.mark.parametrize("working_state", ["partial", "trimmed"])
def test_trimmed_or_partly_trimmed_window_is_refused(engine, tmp_path, working_state):
    copy = seal(engine, tmp_path)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE core.history_window SET working_state=:s WHERE provider_id=:p"),
            dict(p=PROVIDER, s=working_state),
        )
    before = snapshot(engine, copy)
    with pytest.raises(NotImplementedError, match="working rows were trimmed"):
        verify(engine, tmp_path, copy)
    assert snapshot(engine, copy) == before
    assert not marker(tmp_path, copy).exists()


def test_manifest_only_copy_of_an_empty_day_is_verified(engine, tmp_path):
    copy = seal(engine, tmp_path)
    assert copy.storage_path is None
    assert verify(engine, tmp_path, copy).copy.is_current
    assert snapshot(engine, copy)[1].working_state == "empty"


def test_verify_needs_a_connection_without_a_transaction(engine, tmp_path):
    copy = seal(engine, tmp_path)
    with engine.begin() as conn, pytest.raises(ValueError, match="without a transaction"):
        store.verify(conn, lambda backend: LocalBronzeStorage("local", tmp_path), copy)


def test_verify_reconciles_a_rejection_marker_left_by_a_crash(engine, tmp_path, monkeypatch):
    seed(engine, tmp_path)
    copy = seal(engine, tmp_path)
    original = ledger.record_event

    def fail(conn, **kwargs):
        raise RuntimeError("event failed")

    with monkeypatch.context() as patch:
        patch.setattr(ledger, "record_event", fail)
        with engine.connect() as conn, pytest.raises(RuntimeError, match="event failed"):
            from transit_ops.history.seal_captures import reject_capture_copy

            reject_capture_copy(
                conn, lambda backend: LocalBronzeStorage("local", tmp_path), copy, reason="stale"
            )
    assert ledger.record_event is original
    stamp = json.loads(gzip.decompress(marker(tmp_path, copy).read_bytes()))["rejected_at_utc"]
    result = verify(engine, tmp_path, copy)
    assert (result.outcome, result.reason, result.difference) == (
        "rejected",
        "stale",
        "rejection marker present",
    )
    assert result.copy.rejected_at_utc.astimezone(UTC) == datetime.fromisoformat(stamp).astimezone(
        UTC
    )
    assert [e.kind for e in snapshot(engine, copy)[2]] == ["seal", "reject"]
    assert snapshot(engine, copy)[1].current_version is None


def test_verify_refuses_when_another_process_acts_first(engine, tmp_path, monkeypatch):
    seed(engine, tmp_path)
    copy = seal(engine, tmp_path)

    def read(storage, row):
        by_hand(engine, row)
        raise verify_module.CopyCorrupt("pack object absent")

    monkeypatch.setattr(verify_module, "read_back_capture_copy", read)
    with pytest.raises(RuntimeError, match="another process acted on it"):
        verify(engine, tmp_path, copy)
    assert snapshot(engine, copy)[0].state == "verified"
    assert not marker(tmp_path, copy).exists()
