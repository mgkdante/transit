import hashlib
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from history_fixtures import seed_working_day
from sqlalchemy import text

from transit_ops.history import ledger
from transit_ops.history.datasets import UndeclaredDataset
from transit_ops.history.manifest import build_manifest, encode_manifest
from transit_ops.history.poll_record import poll_record_sha256
from transit_ops.history.reader import (
    ArchiveNotVerified,
    WindowNotAvailable,
    WorkingRowsMissing,
    open_window,
)
from transit_ops.history.working_captures import read_working_day, rows_fingerprint
from transit_ops.ingestion.storage import LocalBronzeStorage

PROVIDER = "history_reader_test"
START = datetime(2026, 1, 2, tzinfo=UTC)


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            seed_provider(connection, PROVIDER, display_name="Reader test")
            yield connection
        finally:
            transaction.rollback()


def no_storage(backend):
    raise AssertionError("plan read storage")


def plan(conn, feeds=("trip_updates",), start=START, end=None, storage=no_storage):
    return open_window(
        PROVIDER,
        feeds,
        start,
        end or start + timedelta(days=1),
        connection=conn,
        storage=storage,
    )


def seed(conn, feed="trip_updates", at=START, **kwargs):
    endpoint = seed_working_day(
        conn, provider_id=PROVIDER, endpoint_key=feed, started_at_utc=at, **kwargs
    )
    conn.execute(
        text("UPDATE core.feed_endpoints SET created_at_utc=:at WHERE feed_endpoint_id=:e"),
        dict(at=START - timedelta(days=1), e=endpoint),
    )
    return endpoint


def window_row(conn, at=START, state="empty", current=None):
    conn.execute(
        text(
            "INSERT INTO core.history_window "
            "(dataset_id,provider_id,revision,window_key,window_start,working_state,"
            "working_changed_at_utc,current_version) "
            "VALUES ('capture.trip_updates',:p,0,:key,:day,:state,now(),:current)"
        ),
        dict(p=PROVIDER, key=at.date().isoformat(), day=at.date(), state=state, current=current),
    )


def test_plan_is_complete_before_any_object_is_read(conn):
    seed(conn)
    seed(conn, at=START + timedelta(days=1), run_id=2, capture_id=2)
    seed(conn, "vehicle_positions", run_id=3, capture_id=3)
    result = plan(conn, ("vehicle_positions", "trip_updates"), end=START + timedelta(days=2))
    assert [(d.utc_date, d.endpoint_key) for d in result.days] == [
        (at.date(), feed)
        for at in (START, START + timedelta(days=1))
        for feed in ("trip_updates", "vehicle_positions")
    ]
    assert [d.form for d in result.days] == ["objects", "objects", "objects", None]
    assert result.days[-1].reason == "pruned_before_archive"
    assert result.unreadable == []


def test_each_reason_for_not_available(conn):
    seed(conn, at=START + timedelta(days=3))
    window_row(conn)
    today = (
        conn.execute(text("SELECT now()"))
        .scalar_one()
        .replace(hour=0, minute=0, second=0, microsecond=0)
    )
    assert plan(conn, start=today).days[0].reason == "still_open"
    assert plan(conn).days[0].reason == "no_polls"
    assert plan(conn, start=START + timedelta(days=1)).days[0].reason == "pruned_before_archive"
    conn.execute(
        text("UPDATE core.feed_endpoints SET created_at_utc=:at WHERE provider_id=:p"),
        dict(at=START + timedelta(days=2), p=PROVIDER),
    )
    assert plan(conn, start=START + timedelta(days=1)).days[0].reason == "never_collected"
    assert plan(conn, ("vehicle_positions",)).days[0].reason == "never_collected"
    day = plan(conn, ("vehicle_positions",)).days[0]
    assert (
        day.form,
        day.content_version,
        day.poll_count,
        day.capture_count,
        day.first_time_utc,
        day.last_time_utc,
        day.declared_interval_seconds,
        day.observed_interval_seconds,
        day.poll_record_sha256,
    ) == (None,) * 9
    assert not day.pending_change and not day.bytes_verified


def test_require_available_raises_before_reading(conn):
    seed(conn)
    result = plan(conn, ("trip_updates", "vehicle_positions"))
    with pytest.raises(WindowNotAvailable) as error:
        result.require_available()
    assert error.value.days == tuple(d for d in result.days if d.state == "not_available")
    assert plan(conn).require_available() is None


def test_window_just_after_midnight_lists_the_day_before(conn):
    seed(conn, at=START - timedelta(seconds=2), captured_at_utc=START + timedelta(seconds=3))
    result = plan(conn, end=START + timedelta(minutes=10))
    assert [d.utc_date for d in result.days] == [(START - timedelta(days=1)).date(), START.date()]
    assert result.days[0].form == "objects"


def test_objects_form_day_gives_its_working_poll_record(conn):
    seed(conn)
    seed(conn, at=START + timedelta(seconds=30), run_id=2, capture_id=2)
    record = read_working_day(
        conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=START.date()
    )
    day = plan(conn).days[0]
    assert (day.poll_count, day.capture_count) == (len(record.polls), len(record.captures))
    assert (day.first_time_utc, day.last_time_utc) == (
        record.polls[0].time_utc,
        record.polls[-1].time_utc,
    )
    assert day.declared_interval_seconds == record.declared_interval_seconds
    assert day.observed_interval_seconds == record.observed_interval_ms / 1000
    assert day.poll_record_sha256 == poll_record_sha256(record)
    assert not day.bytes_verified


def seed_fact(conn, at):
    conn.execute(
        text(
            "INSERT INTO gold.fact_trip_delay_snapshot (provider_id,realtime_snapshot_id,"
            "entity_index,snapshot_date_key,snapshot_local_date,feed_timestamp_utc,"
            "captured_at_utc,stop_time_update_count) VALUES (:p,1,1,:key,:day,:at,:at,0)"
        ),
        dict(p=PROVIDER, key=int(at.strftime("%Y%m%d")), day=at.date(), at=at),
    )


def test_current_copy_outcomes_are_carried_into_the_digest(conn, tmp_path):
    now = conn.execute(text("SELECT now()")).scalar_one()
    at = (now - timedelta(days=2)).replace(hour=12, minute=0, second=0, microsecond=0)
    endpoint = seed(conn, at=at)
    seed_fact(conn, at)

    def read(**kwargs):
        return read_working_day(
            conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=at.date(), **kwargs
        )

    current = build_manifest(
        replace(read(), declared_interval_seconds=60),
        feed_endpoint_id=endpoint,
        feed_kind="trip_updates",
        content_version=1,
        supersedes=None,
        pack_path=None,
        pack=None,
        sealed_at_utc=now,
        sealed_by="test",
    )
    data = encode_manifest(current)
    (tmp_path / "manifest.gz").write_bytes(data)
    storage = LocalBronzeStorage(storage_backend="local", root=tmp_path)
    window_row(conn, at, "present", 1)
    conn.execute(
        text(
            "INSERT INTO core.history_archive_copy (dataset_id,provider_id,revision,window_key,"
            "content_version,schema_version,storage_backend,manifest_path,manifest_sha256,"
            "allocated_at_utc,sealed_at_utc,verified_at_utc,details) "
            "VALUES ('capture.trip_updates',:p,0,:key,1,1,'local','manifest.gz',:sha,"
            "now(),now(),now(),CAST(:details AS jsonb))"
        ),
        dict(
            p=PROVIDER,
            key=at.date().isoformat(),
            sha=hashlib.sha256(data).hexdigest(),
            details='{"rows_fingerprint":"changed","declared_interval_seconds":60,'
            '"observed_interval_ms":null}',
        ),
    )
    conn.execute(
        text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id=:p"), dict(p=PROVIDER)
    )
    conn.execute(
        text("UPDATE raw.ingestion_runs SET error_message='changed' WHERE ingestion_run_id=1")
    )
    day = plan(conn, start=at, storage=lambda backend: storage).days[0]
    assert day.poll_record_sha256 == poll_record_sha256(read(current=current))
    assert day.poll_record_sha256 != poll_record_sha256(read())


def test_rows_after_empty_seal_are_available(conn):
    seed(conn)
    window_row(conn)
    assert plan(conn).days[0].form == "objects"


@pytest.mark.parametrize(
    "method,packet", [("polls", "H06a4"), ("captures", "H06a4"), ("processing", "H06b")]
)
def test_iteration_is_refused_until_implemented(conn, method, packet):
    result = plan(conn)
    with pytest.raises(NotImplementedError, match=packet):
        list(getattr(result, method)())


def test_window_arguments_are_checked():
    for provider, feeds, start, end, error in [
        ("", ["trip_updates"], START, START + timedelta(days=1), ValueError),
        (PROVIDER, [], START, START + timedelta(days=1), ValueError),
        (PROVIDER, ["trip_updates"] * 2, START, START + timedelta(days=1), ValueError),
        (PROVIDER, ["trip_updates"], START.replace(tzinfo=None), START, ValueError),
        (PROVIDER, ["trip_updates"], START, START.replace(tzinfo=None), ValueError),
        (PROVIDER, ["trip_updates"], START, START, ValueError),
        (PROVIDER, ["trip_updates"], START, START - timedelta(seconds=1), ValueError),
        (PROVIDER, ["undeclared"], START, START + timedelta(days=1), UndeclaredDataset),
    ]:
        with pytest.raises(error):
            open_window(provider, feeds, start, end, connection=None, storage=no_storage)


def fingerprint(conn, at=START):
    return rows_fingerprint(
        conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=at.date()
    )


def copy_manifest(conn, record):
    data = encode_manifest(
        build_manifest(
            record,
            feed_endpoint_id=conn.execute(
                text(
                    "SELECT feed_endpoint_id FROM core.feed_endpoints "
                    "WHERE provider_id=:p AND endpoint_key='trip_updates'"
                ),
                dict(p=PROVIDER),
            ).scalar_one(),
            feed_kind="trip_updates",
            content_version=1,
            supersedes=None,
            pack_path=None,
            pack=None,
            sealed_at_utc=conn.execute(text("SELECT now()")).scalar_one(),
            sealed_by="test",
        )
    )
    return data


def copy_values(conn, at, record, data):
    return dict(
        p=PROVIDER,
        key=at.date().isoformat(),
        sha=hashlib.sha256(data).hexdigest(),
        polls=len(record.polls),
        captures=len(record.captures),
        first=record.polls[0].time_utc if record.polls else None,
        last=record.polls[-1].time_utc if record.polls else None,
        digest=poll_record_sha256(record),
        details=json.dumps(
            dict(
                rows_fingerprint=fingerprint(conn, at),
                declared_interval_seconds=record.declared_interval_seconds,
                observed_interval_ms=record.observed_interval_ms,
            ),
            sort_keys=True,
        ),
    )


def copy_day(conn, at=START, state="present", root=None):
    record = read_working_day(
        conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=at.date()
    )
    window_row(conn, at, state)
    identity = dict(p=PROVIDER, key=at.date().isoformat())
    conn.execute(
        text(
            "UPDATE core.history_window SET working_changed_at_utc=now()-interval '1 hour' "
            "WHERE provider_id=:p AND window_key=:key"
        ),
        identity,
    )
    data = copy_manifest(conn, record)
    if root is not None:
        (root / "manifest.gz").write_bytes(data)
    conn.execute(
        text("""
        INSERT INTO core.history_archive_copy
        (dataset_id,provider_id,revision,window_key,content_version,schema_version,
         storage_backend,manifest_path,manifest_sha256,allocated_at_utc,sealed_at_utc,
         verified_at_utc,poll_count,record_count,first_time_utc,last_time_utc,
         poll_record_sha256,details)
        VALUES ('capture.trip_updates',:p,0,:key,1,1,'local','manifest.gz',:sha,
                clock_timestamp(),NULL,NULL,:polls,:captures,:first,:last,:digest,
                CAST(:details AS jsonb))
    """),
        copy_values(conn, at, record, data),
    )
    for table, assignment in (
        ("history_archive_copy", "sealed_at_utc=clock_timestamp()"),
        ("history_archive_copy", "verified_at_utc=clock_timestamp()"),
        ("history_window", "current_version=1"),
    ):
        conn.execute(
            text(f"UPDATE core.{table} SET {assignment} WHERE provider_id=:p AND window_key=:key"),
            identity,
        )
    return record


def trim_rows(conn, at=START, keep=None, event=True):
    for table in ("raw.realtime_snapshot_index", "raw.ingestion_objects", "raw.ingestion_runs"):
        conn.execute(
            text(
                f"DELETE FROM {table} WHERE provider_id=:p AND ingestion_run_id "
                "IN (SELECT ingestion_run_id FROM raw.ingestion_runs "
                "WHERE provider_id=:p AND started_at_utc>=:at "
                "AND started_at_utc<:end AND ingestion_run_id<>:keep)"
            ),
            dict(p=PROVIDER, at=at, end=at + timedelta(days=1), keep=keep or -1),
        )
    if event:
        ledger.record_event(
            conn,
            kind="trim",
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            revision=0,
            window_key=at.date().isoformat(),
            details={"remainder_fingerprint": fingerprint(conn, at)},
        )


def test_poll_record_digest_is_equal_from_both_forms(conn):
    seed(conn)
    seed(conn, at=START + timedelta(seconds=30), run_id=2, capture_id=2)
    before = plan(conn).days[0]
    record = copy_day(conn)
    result = plan(conn)
    day = result.days[0]
    assert before.form == "objects"
    assert day.form == "archive_copy" and day.content_version == 1 and day.bytes_verified
    assert day.poll_record_sha256 == before.poll_record_sha256
    assert (day.poll_count, day.capture_count, day.first_time_utc, day.last_time_utc) == (
        before.poll_count,
        before.capture_count,
        before.first_time_utc,
        before.last_time_utc,
    )
    assert day.declared_interval_seconds == record.declared_interval_seconds
    assert day.observed_interval_seconds == record.observed_interval_ms / 1000
    assert not day.pending_change


@pytest.mark.parametrize("change", ["row", "mark"])
def test_present_day_that_changed_is_read_from_objects(conn, tmp_path, change):
    seed(conn)
    copy_day(conn, root=tmp_path)
    if change == "row":
        conn.execute(
            text("UPDATE raw.ingestion_runs SET error_message='changed' WHERE provider_id=:p"),
            dict(p=PROVIDER),
        )
    else:
        ledger.lock_window(
            conn,
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            window_key=START.date().isoformat(),
        )
    storage = LocalBronzeStorage(storage_backend="local", root=tmp_path)
    day = plan(conn, storage=lambda backend: storage).days[0]
    assert day.form == "objects" and not day.bytes_verified and not day.pending_change


def test_day_is_chosen_by_manifest_bounds_not_by_a_look_back(conn):
    for n in (3, 2):
        at = START - timedelta(days=n)
        seed(conn, at=at, run_id=n, capture_id=n)
        copy_day(conn, at, "trimmed")
        trim_rows(conn, at)
    conn.execute(
        text("UPDATE core.history_archive_copy SET last_time_utc=:last WHERE window_key=:key"),
        dict(last=START, key=(START - timedelta(days=3)).date().isoformat()),
    )
    days = plan(conn).days
    assert [d.utc_date for d in days] == [(START - timedelta(days=3)).date(), START.date()]
    assert days[0].form == "archive_copy" and not days[0].pending_change


def test_unverified_copy_of_a_rebuilt_ledger_raises(conn):
    seed(conn)
    copy_day(conn, state="trimmed")
    trim_rows(conn, event=False)
    conn.execute(text("UPDATE core.history_archive_copy SET verified_at_utc=NULL"))
    conn.execute(text("UPDATE core.history_window SET current_version=NULL"))
    ledger.hold(
        conn,
        dataset_id="capture.trip_updates",
        provider_id=PROVIDER,
        window_key=START.date().isoformat(),
        until_utc=ledger.HOLD_NO_END,
        reason="ledger_rebuilt",
    )
    with pytest.raises(ArchiveNotVerified, match="trip_updates.*2026-01-02"):
        plan(conn)


@pytest.mark.parametrize("event", [True, False])
def test_trimmed_day_is_not_a_pending_change(conn, event):
    seed(conn)
    copy_day(conn, state="trimmed")
    trim_rows(conn, event=event)
    day = plan(conn).days[0]
    assert day.form == "archive_copy" and not day.pending_change


@pytest.mark.parametrize("event", [True, False])
def test_partly_trimmed_day_is_not_a_pending_change(conn, event):
    seed(conn)
    seed(conn, at=START + timedelta(seconds=30), run_id=2, capture_id=2)
    copy_day(conn, state="partial")
    trim_rows(conn, keep=1, event=event)
    day = plan(conn).days[0]
    assert day.form == "archive_copy" and day.pending_change is (not event)


def test_late_row_in_a_trimmed_day_is_a_pending_change(conn):
    seed(conn)
    copy_day(conn, state="trimmed")
    trim_rows(conn)
    seed(conn, run_id=2, capture_id=2, with_capture=False, status="failed")
    day = plan(conn).days[0]
    assert day.form == "archive_copy" and day.pending_change


@pytest.mark.parametrize(
    "key", ["rows_fingerprint", "declared_interval_seconds", "observed_interval_ms"]
)
def test_current_copy_requires_all_details(conn, key):
    seed(conn)
    copy_day(conn)
    conn.execute(text("UPDATE core.history_archive_copy SET details=details-:key"), dict(key=key))
    with pytest.raises(ValueError, match=key):
        plan(conn)


def test_open_window_takes_no_window_lock(conn, real_db_engine):
    seed(conn)
    copy_day(conn)
    assert plan(conn).days[0].form == "archive_copy"
    pid = conn.execute(text("SELECT pg_backend_pid()")).scalar_one()
    with real_db_engine.connect() as observer:
        assert not observer.execute(
            text("SELECT EXISTS (SELECT FROM pg_locks WHERE locktype='advisory' AND pid=:pid)"),
            dict(pid=pid),
        ).scalar_one()
    assert conn.in_transaction()


def test_present_day_whose_rows_left_without_a_trim_raises(conn):
    seed(conn)
    copy_day(conn)
    trim_rows(conn, event=False)
    with pytest.raises(WorkingRowsMissing, match="trip_updates.*2026-01-02"):
        plan(conn)


def test_marked_empty_day_with_an_empty_copy_reads_no_polls(conn):
    seed(conn)
    trim_rows(conn, event=False)
    record = copy_day(conn)
    assert record.polls == ()
    conn.execute(
        text(
            "UPDATE core.history_window SET working_changed_at_utc=clock_timestamp() "
            "WHERE provider_id=:p AND window_key=:key"
        ),
        dict(p=PROVIDER, key=START.date().isoformat()),
    )
    day = plan(conn).days[0]
    assert day.state == "not_available" and day.reason == "no_polls"
