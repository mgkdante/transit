import hashlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from history_fixtures import seed_working_day
from sqlalchemy import text

from transit_ops.history.datasets import UndeclaredDataset
from transit_ops.history.manifest import build_manifest, encode_manifest
from transit_ops.history.poll_record import poll_record_sha256
from transit_ops.history.reader import WindowNotAvailable, open_window
from transit_ops.history.working_captures import read_working_day
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
            "allocated_at_utc,sealed_at_utc,verified_at_utc) "
            "VALUES ('capture.trip_updates',:p,0,:key,1,1,'local','manifest.gz',:sha,"
            "now(),now(),now())"
        ),
        dict(p=PROVIDER, key=at.date().isoformat(), sha=hashlib.sha256(data).hexdigest()),
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


@pytest.mark.parametrize("state,current", [("partial", None), ("trimmed", None), ("present", 1)])
def test_archive_only_plan_is_refused_until_h06a3(conn, state, current):
    seed(conn, at=START + timedelta(days=1))
    window_row(conn, state=state, current=current)
    with pytest.raises(NotImplementedError, match="H06a3"):
        plan(conn)


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
