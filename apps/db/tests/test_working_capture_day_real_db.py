import json
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
        assert all(p.stage == "gold_facts" for p in record.processing)
        assert bool(record.processing) == (key == "trip_updates")


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
    assert read(conn).polls == before.polls
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


def facts(conn, capture_id, at, count, endpoint="trip_updates"):
    table = "fact_trip_delay_snapshot" if endpoint == "trip_updates" else "fact_vehicle_snapshot"
    extra = ", stop_time_update_count" if endpoint == "trip_updates" else ""
    value = ", 0" if extra else ""
    conn.execute(
        text(
            f"INSERT INTO gold.{table} (provider_id, realtime_snapshot_id, entity_index, "
            f"snapshot_date_key, snapshot_local_date, feed_timestamp_utc, captured_at_utc{extra}) "
            f"SELECT :p, :id, n, :key, :day, :at, :at{value} FROM generate_series(1, :n) n"
        ),
        dict(
            p=PROVIDER, id=capture_id, key=int(at.strftime("%Y%m%d")), day=at.date(), at=at, n=count
        ),
    )


def evidence(conn, day, rows=None, completed=START, **changes):
    details = dict(
        command="test",
        completed_at_utc=completed.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        index_family="realtime_snapshot",
        rows_by_capture=rows or {"1": 100},
    )
    details.update(changes)
    return conn.execute(
        text(
            "INSERT INTO core.history_event "
            "(kind,dataset_id,provider_id,revision,window_key,actor,details) "
            "VALUES ('processing_evidence','capture.trip_updates',:p,0,:day,'test',"
            "CAST(:details AS jsonb)) RETURNING event_id"
        ),
        dict(p=PROVIDER, day=day.isoformat(), details=json.dumps(details)),
    ).scalar_one()


def gold(record):
    return {p.capture_row_id: p for p in record.processing if p.stage == "gold_facts"}


def test_failed_silver_load_is_a_processing_record_not_a_poll(conn):
    endpoint = seed(conn, captured_at_utc=START + timedelta(hours=12))
    conn.execute(
        text(
            "UPDATE core.feed_endpoints SET refresh_interval_seconds=30 WHERE feed_endpoint_id=:e"
        ),
        dict(e=endpoint),
    )
    for run, seconds in [(2, 10), (3, 300)]:
        seed(
            conn,
            run_id=run,
            run_kind="silver_load",
            with_capture=False,
            status="failed",
            started_at_utc=START + timedelta(hours=12, seconds=seconds),
            error_message="broken",
        )
    record = read(conn)
    loads = [p for p in record.processing if p.stage == "silver_load"]
    assert [p.ingestion_run_id for p in record.polls] == [1]
    assert [(p.capture_row_id, p.attribution) for p in loads] == [(1, "by_time"), (None, None)]
    for p, seconds in zip(loads, [10, 300], strict=True):
        assert p.status == "failed" and p.error_message == "broken" and p.rows is None
        assert p.started_at_utc == START + timedelta(hours=12, seconds=seconds)
        assert p.completed_at_utc == p.started_at_utc + timedelta(seconds=4)
    assert [p.ingestion_run_id for p in loads] == [2, 3]


@pytest.mark.parametrize("endpoint", ["trip_updates", "vehicle_positions"])
def test_fact_rows_are_counted_per_capture_and_null_past_the_fact_retention(conn, endpoint):
    at = conn.execute(text("SELECT now()")).scalar_one() - timedelta(hours=1)
    for i in (1, 2):
        seed(conn, endpoint, run_id=i, capture_id=i, started_at_utc=at)
    old = at - timedelta(days=14)
    seed(conn, endpoint, run_id=3, capture_id=3, started_at_utc=old)
    facts(conn, 1, at, 3, endpoint)
    facts(conn, 3, old, 2, endpoint)
    young = gold(read(conn, endpoint, at.date()))
    assert [(young[i].status, young[i].rows) for i in (1, 2)] == [
        ("observed", 3),
        ("none_observed", 0),
    ]
    ancient = gold(read(conn, endpoint, old.date()))[3]
    assert ancient.status == "not_observed" and ancient.rows is None
    for p in [*young.values(), ancient]:
        assert (
            p.attribution,
            p.started_at_utc,
            p.completed_at_utc,
            p.error_message,
            p.ingestion_run_id,
        ) == (None,) * 5
    seed(conn, "i3_alerts", run_id=4, started_at_utc=at)
    assert read(conn, "i3_alerts", at.date()).processing == ()


def test_gold_outcome_is_carried_after_thirteen_days(conn):
    endpoint = seed(conn)
    facts(conn, 1, START, 2)
    record = read(conn)
    carried = replace(
        gold(record)[1], status="observed", rows=5, attribution="recorded", completed_at_utc=START
    )
    current = manifest(replace(record, processing=(carried,)), endpoint)
    assert gold(read(conn, current=current))[1] == carried
    at = conn.execute(text("SELECT now()")).scalar_one() - timedelta(hours=1)
    seed(conn, run_id=2, capture_id=2, started_at_utc=at)
    young = read(conn, day=at.date())
    copy = manifest(young, endpoint)
    facts(conn, 2, at, 3)
    assert gold(read(conn, day=at.date(), current=copy))[2] == gold(young)[2]
    assert gold(young)[2].status == "none_observed"


def test_recorded_evidence_wins_over_the_copy_and_the_count(conn):
    endpoint = seed(conn)
    facts(conn, 1, START, 2)
    current = manifest(read(conn), endpoint)
    evidence(conn, DAY, {"1": 100, "999": 50}, START + timedelta(seconds=20))
    evidence(conn, DAY, {"1": 70}, START + timedelta(seconds=10))
    result = gold(read(conn, current=current))
    assert set(result) == {1}
    assert (result[1].rows, result[1].attribution, result[1].status) == (
        100,
        "recorded",
        "observed",
    )
    assert result[1].completed_at_utc == START + timedelta(seconds=20)
    assert (result[1].started_at_utc, result[1].error_message, result[1].ingestion_run_id) == (
        None,
    ) * 3
    newer = replace(result[1], rows=200, completed_at_utc=START + timedelta(seconds=30))
    copy = manifest(replace(read(conn), processing=(newer,)), endpoint)
    assert gold(read(conn, current=copy))[1] == newer
    equal = replace(newer, completed_at_utc=result[1].completed_at_utc)
    copy = manifest(replace(read(conn), processing=(equal,)), endpoint)
    assert gold(read(conn, current=copy))[1] == equal
    evidence(conn, DAY, {"1": 0}, START + timedelta(seconds=20))
    assert gold(read(conn))[1].status == "none_observed"


def test_digest_is_equal_before_seal_after_seal_and_after_restore(conn):
    at = conn.execute(text("SELECT now()")).scalar_one() - timedelta(hours=1)
    endpoint = seed(conn, started_at_utc=at)
    facts(conn, 1, at, 3)
    seed(
        conn,
        run_id=2,
        run_kind="silver_load",
        with_capture=False,
        status="failed",
        started_at_utc=at + timedelta(seconds=10),
        error_message="broken",
    )
    record = read(conn, day=at.date())
    digest = poll_record_sha256(record)
    assert poll_record_sha256(read(conn, day=at.date())) == digest
    current = decode_manifest(encode_manifest(manifest(record, endpoint)))
    conn.execute(
        text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id=:p"), dict(p=PROVIDER)
    )
    assert poll_record_sha256(read(conn, day=at.date(), current=current)) == digest


@pytest.mark.parametrize(
    "change",
    [
        {"command": None},
        {"index_family": "alert_snapshot"},
        {"completed_at_utc": "2026-01-02T00:00:00"},
        {"rows_by_capture": {"1": -1}},
        {"rows_by_capture": {"1": True}},
        {"rows_by_capture": {"0": 1}},
        {"rows_by_capture": {"-1": 1}},
        {"rows_by_capture": {"1.0": 1}},
        {"extra": "key"},
    ],
)
def test_malformed_evidence_is_refused(conn, change):
    seed(conn)
    event = evidence(conn, DAY, **change)
    with pytest.raises(PollRecordInvalid, match=f"event {event}"):
        read(conn)


def test_evidence_missing_key_is_refused(conn):
    seed(conn)
    event = conn.execute(
        text(
            "INSERT INTO core.history_event "
            "(kind,dataset_id,provider_id,revision,window_key,actor) "
            "VALUES ('processing_evidence','capture.trip_updates',:p,0,:day,'test') "
            "RETURNING event_id"
        ),
        dict(p=PROVIDER, day=DAY.isoformat()),
    ).scalar_one()
    with pytest.raises(PollRecordInvalid, match=f"event {event}"):
        read(conn)


@pytest.mark.parametrize("status", ["succeeded", "pending", "running"])
def test_nonfailed_silver_load_is_refused(conn, status):
    seed(conn, run_kind="silver_load", status=status, with_capture=False)
    with pytest.raises(PollRecordInvalid, match="run 1"):
        read(conn)


def test_silver_attribution_can_name_previous_day_and_uses_latest_capture(conn):
    endpoint = seed(conn, started_at_utc=START - timedelta(seconds=20), captured_at_utc=START)
    seed(
        conn,
        run_id=2,
        capture_id=2,
        started_at_utc=START - timedelta(seconds=15),
        captured_at_utc=START,
    )
    conn.execute(
        text(
            "UPDATE core.feed_endpoints SET refresh_interval_seconds=30 WHERE feed_endpoint_id=:e"
        ),
        dict(e=endpoint),
    )
    seed(
        conn,
        run_id=3,
        run_kind="silver_load",
        with_capture=False,
        status="failed",
        started_at_utc=START + timedelta(seconds=30),
    )
    (load,) = read(conn).processing
    assert (load.capture_row_id, load.attribution) == (2, "by_time")
