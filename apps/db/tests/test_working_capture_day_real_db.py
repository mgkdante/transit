from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest
from history_fixtures import seed_working_day
from sqlalchemy import text

from transit_ops.history.datasets import UndeclaredDataset
from transit_ops.history.manifest import build_manifest, decode_manifest, encode_manifest
from transit_ops.history.poll_record import PollRecordInvalid, poll_record_sha256
from transit_ops.history.working_captures import CLOSED_UNFINISHED, read_working_day

PROVIDER = "history_working_day_test"
START = datetime(2026, 1, 2, tzinfo=UTC)
DAY = START.date()


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            seed_provider(connection, PROVIDER, display_name="Working day test")
            yield connection
        finally:
            transaction.rollback()


def seed(conn, endpoint="trip_updates", **kwargs):
    return seed_working_day(
        conn,
        provider_id=PROVIDER,
        endpoint_key=endpoint,
        started_at_utc=kwargs.pop("started_at_utc", START),
        **kwargs,
    )


def read(conn, endpoint="trip_updates", day=DAY, **kwargs):
    return read_working_day(
        conn, provider_id=PROVIDER, endpoint_key=endpoint, utc_date=day, **kwargs
    )


def manifest(record, endpoint):
    return build_manifest(
        record,
        feed_endpoint_id=endpoint,
        feed_kind=record.feed_day.endpoint_key,
        content_version=1,
        supersedes=None,
        pack_path=None,
        pack=None,
        sealed_at_utc=START,
        sealed_by="test",
    )


def test_poll_crossing_midnight_belongs_to_the_day_it_started(conn):
    start = START + timedelta(hours=23, minutes=59, seconds=50)
    end = START + timedelta(days=1, seconds=4)
    seed(conn, started_at_utc=start, captured_at_utc=end)
    record = read(conn)
    assert record.polls[0].status == "stored"
    assert record.polls[0].time_utc == end == record.captures[0].captured_at_utc
    tomorrow = read(conn, day=DAY + timedelta(days=1))
    assert tomorrow.polls == tomorrow.captures == ()


def test_feed_timestamp_fallback_is_labelled_capture_time(conn):
    seed(conn, feed_timestamp_utc=START + timedelta(seconds=2))
    seed(conn, run_id=2, capture_id=2, started_at_utc=START + timedelta(seconds=30))
    seed(conn, run_id=3, with_capture=False, status="failed")
    seed(conn, "i3_alerts", run_id=4)
    record = read(conn)
    by_id = {p.ingestion_run_id: p for p in record.polls}
    assert [by_id[i].feed_timestamp_source for i in (1, 2, 3)] == ["header", "capture_time", None]
    assert [c.feed_timestamp_source for c in record.captures] == ["header", "capture_time"]
    assert read(conn, "i3_alerts").captures[0].feed_timestamp_source == "capture_time"
    assert read(conn, "i3_alerts").polls[0].feed_timestamp_source == "capture_time"
    conn.execute(
        text("UPDATE raw.ingestion_runs SET feed_timestamp_utc=NULL WHERE ingestion_run_id=4")
    )
    assert read(conn, "i3_alerts").captures[0].feed_timestamp_utc == START + timedelta(seconds=4)


def test_run_left_running_is_reported_unfinished(conn):
    for i, (status, error) in enumerate(
        [("pending", None), ("running", None), ("failed", CLOSED_UNFINISHED), ("failed", "error")],
        1,
    ):
        seed(conn, run_id=i, with_capture=False, status=status, error_message=error)
    polls = read(conn).polls
    assert [p.status for p in polls] == ["unfinished", "unfinished", "unfinished", "failed"]
    assert [p.run_status for p in polls] == ["pending", "running", "failed", "failed"]
    assert all(p.time_utc == START and p.completed_at_utc is None for p in polls[:2])
    assert polls[2].error_message == CLOSED_UNFINISHED


def test_alert_feed_reads_its_own_index(conn):
    seed(conn)
    seed(conn, "i3_alerts", run_id=2)
    for key, family, run in [
        ("trip_updates", "realtime_snapshot", 1),
        ("i3_alerts", "alert_snapshot", 2),
    ]:
        record = read(conn, key)
        assert record.feed_day.index_family == family
        assert [p.ingestion_run_id for p in record.polls] == [run]
        (capture,) = record.captures
        assert capture.capture_row_id == 1 and capture.index_family == family
        assert (capture.api_version, capture.alert_count) == (
            ("v1", 2) if run == 2 else (None, None)
        )
        assert not capture.packed and capture.stream is None and capture.offset is None
        assert record.processing == ()


def test_silver_load_rows_are_not_polls(conn):
    seed(conn)
    seed(conn, run_id=2, capture_id=2, started_at_utc=START + timedelta(seconds=30))
    before = read(conn)
    seed(
        conn,
        run_id=3,
        run_kind="silver_load",
        with_capture=False,
        status="failed",
        started_at_utc=START + timedelta(seconds=10),
    )
    assert read(conn) == before
    assert before.observed_interval_ms == 30_000


@pytest.mark.parametrize("assignment", ["status='running'", "error_message='changed'"])
def test_status_changed_in_place_changes_the_poll_record_digest(conn, assignment):
    seed(conn, status="pending", with_capture=False)
    before = poll_record_sha256(read(conn))
    conn.execute(text(f"UPDATE raw.ingestion_runs SET {assignment} WHERE ingestion_run_id=1"))
    assert poll_record_sha256(read(conn)) != before


def test_declared_interval_is_read_then_carried(conn):
    endpoint = seed(conn)
    assert read(conn).declared_interval_seconds is None
    conn.execute(
        text(
            "UPDATE core.feed_endpoints SET refresh_interval_seconds=30 WHERE feed_endpoint_id=:e"
        ),
        {"e": endpoint},
    )
    assert read(conn).declared_interval_seconds == 30
    current = manifest(replace(read(conn), declared_interval_seconds=60), endpoint)
    assert read(conn, current=current).declared_interval_seconds == 60
    for changed in [
        replace(current, utc_date=date(2026, 1, 3)),
        replace(current, endpoint_key="vehicle_positions"),
        replace(current, provider_id="other"),
        replace(current, index_family="alert_snapshot"),
    ]:
        with pytest.raises(ValueError):
            read(conn, current=changed)
    with pytest.raises(ValueError):
        read(conn, day=START)


def test_record_round_trips_through_a_manifest(conn):
    endpoint = seed(conn)
    record = read(conn)
    decoded = decode_manifest(encode_manifest(manifest(record, endpoint)))
    assert decoded.poll_record_sha256 == poll_record_sha256(record)
    assert poll_record_sha256(read(conn, current=decoded)) == poll_record_sha256(record)


@pytest.mark.parametrize(
    "endpoint,table,assignment",
    [
        ("trip_updates", "raw.ingestion_runs", "status='failed'"),
        ("trip_updates", "raw.ingestion_runs", "status='running'"),
        ("i3_alerts", "raw.i3_alert_snapshots", "checksum_sha256='different'"),
        ("i3_alerts", "raw.i3_alert_snapshots", "http_status_code=503"),
        ("trip_updates", "raw.realtime_snapshot_index", "ingestion_object_id=NULL"),
        ("trip_updates", "raw.ingestion_objects", "byte_size=NULL"),
        ("trip_updates", "raw.ingestion_objects", "checksum_sha256=NULL"),
    ],
)
def test_rows_one_record_cannot_hold_are_refused(conn, endpoint, table, assignment):
    seed(conn, endpoint, run_id=765, capture_id=876)
    conn.execute(text(f"UPDATE {table} SET {assignment} WHERE ingestion_run_id=765"))
    with pytest.raises(PollRecordInvalid, match="765|876"):
        read(conn, endpoint)


@pytest.mark.parametrize("endpoint", ["trip_updates", "i3_alerts"])
def test_succeeded_run_with_no_capture_row_reads_capture_missing(conn, endpoint):
    seed(conn, endpoint)
    seed(conn, endpoint, run_id=2, with_capture=False)
    record = read(conn, endpoint)
    polls = {p.ingestion_run_id: p for p in record.polls}
    assert polls[1].status == "stored"
    assert polls[2].status == "capture_missing"
    assert polls[2].missing_reason == "capture_row_absent" and polls[2].capture_row_id is None
    assert [c.ingestion_run_id for c in record.captures] == [1]
    assert poll_record_sha256(record) == poll_record_sha256(read(conn, endpoint))


def test_undeclared_or_missing_feed_is_refused(conn):
    with pytest.raises(UndeclaredDataset):
        read(conn, "unknown")
    with pytest.raises(LookupError):
        read(conn)
