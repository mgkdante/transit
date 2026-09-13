"""Selected Gold projection dirties daily history in the same transaction."""

from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from zoneinfo import ZoneInfo

import pytest
from google.transit import gtfs_realtime_pb2
from realtime_replay_fixtures import PROVIDER, _build_trip_update_bytes, _StubRegistry
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError
from test_delay_days_real_db import metric, watermark
from test_gold_realtime_identity_real_db import _ids, _live, _state
from test_gold_realtime_identity_real_db import capture as capture
from test_gold_snapshot_replay_real_db import _change_archive, _gold_state, _prune_silver, _rows

from transit_ops.gold import delay_days
from transit_ops.gold.realtime import refresh_gold_snapshots
from transit_ops.silver.realtime_gtfs import load_realtime_to_silver

TZ = ZoneInfo("America/Toronto")


@pytest.fixture(autouse=True)
def clean_daily_rows(engine):
    yield
    with engine.begin() as conn:
        for table in delay_days.DAILY_DELAY_TABLES.values():
            conn.execute(text(f"DELETE FROM gold.{table} WHERE provider_id=:p"), {"p": PROVIDER})


@pytest.fixture(params=["live", "replay"])
def project(request, engine, settings):
    def run(*receipts):
        if request.param == "live":
            return _live(engine, settings, *receipts)
        return refresh_gold_snapshots(
            PROVIDER,
            expected_rows={r.realtime_snapshot_id: r.row_counts for r in receipts},
            settings=settings,
            registry=_StubRegistry(),
            engine=engine,
        )

    return run


def _day(receipt):
    return receipt.captured_at_utc.astimezone(TZ).date()


def _build_daily(engine, receipt):
    with engine.begin() as conn:
        for kind in delay_days.DAILY_DELAY_TABLES:
            metric(conn, kind, provider=PROVIDER, day=_day(receipt))


def _assert_dirty(engine, receipt):
    with engine.connect() as conn:
        status = delay_days.daily_delay_status(conn, PROVIDER)
        assert status == {
            "provider_id": PROVIDER,
            "dirty_days": [
                {"date": _day(receipt).isoformat(), "kinds": sorted(delay_days.DAILY_DELAY_TABLES)}
            ],
            "dirty_day_count": 1,
        }
        with pytest.raises(ValueError, match="1 dirty day"):
            delay_days.assert_daily_delay_history_clean(conn, PROVIDER)


def _correct_archive(engine, settings, bronze_root, receipt, *, empty=False):
    message = gtfs_realtime_pb2.FeedMessage.FromString(
        _build_trip_update_bytes(captured_at=receipt.captured_at_utc, delay_seconds=240)
    )
    if empty:
        message.ClearField("entity")
    snapshot = (
        receipt.realtime_snapshot_id,
        receipt.source_ingestion_run_id,
        receipt.source_ingestion_object_id,
        receipt.captured_at_utc,
        240,
    )
    _change_archive(engine, bronze_root, snapshot, message.SerializeToString())
    with engine.begin() as conn:
        _prune_silver(conn, receipt.realtime_snapshot_id)
    return load_realtime_to_silver(
        PROVIDER,
        "trip_updates",
        snapshot_id=receipt.realtime_snapshot_id,
        settings=settings,
        registry=_StubRegistry(),
        engine=engine,
    )


def test_late_insert_dirties_built_day_without_rewinding_serving(
    capture, project, engine, settings
):
    older, newer = capture(0), capture(1)
    _live(engine, settings, newer)
    _build_daily(engine, newer)
    with engine.begin() as conn:
        watermark(conn, provider=PROVIDER, day=_day(newer) - timedelta(days=1))
        watermark(conn, provider=PROVIDER, kind="route_headway_shift_daily", day=_day(newer))
    before = _rows(engine, "route_delay_spine")
    serving = dict(_state(engine))

    project(older)

    _assert_dirty(engine, older)
    assert len(_rows(engine, "fact_trip_delay_snapshot")) == 2
    assert _rows(engine, "route_delay_spine") == before
    assert dict(_state(engine)) == serving
    assert _ids(engine, "latest_trip_delay_snapshot") == [newer.realtime_snapshot_id]
    with engine.connect() as conn:
        assert (
            delay_days.delay_day_state(
                conn, PROVIDER, "route_delay_spine", _day(newer) - timedelta(days=1)
            )
            == "clean"
        )
    assert all(
        row["invalidated_at_utc"] is None
        for row in _rows(engine, "warm_rollup_periods")
        if row["rollup_kind"] == "route_headway_shift_daily"
    )


@pytest.mark.parametrize("empty", [False, True])
def test_corrected_verified_archive_dirties_value_change_or_removal(
    capture, project, engine, settings, bronze_root, empty
):
    receipt = capture(0)
    _live(engine, settings, receipt)
    _build_daily(engine, receipt)
    before = _rows(engine, "route_delay_spine")
    serving = dict(_state(engine))
    corrected = _correct_archive(engine, settings, bronze_root, receipt, empty=empty)

    result = project(corrected)

    _assert_dirty(engine, receipt)
    assert _rows(engine, "route_delay_spine") == before
    assert dict(_state(engine)) == serving
    assert result.row_counts["fact_trip_delay_snapshot"] == (0 if empty else 1)
    assert [row["delay_seconds"] for row in _rows(engine, "fact_trip_delay_snapshot")] == (
        [] if empty else [240]
    )
    assert [row["delay_seconds"] for row in _rows(engine, "latest_trip_delay_snapshot")] == (
        [] if empty else [240]
    )


def test_later_projection_failure_rolls_back_daily_evidence_and_whole_batch(
    capture, project, engine, settings, bronze_root
):
    trip, vehicle = capture(0), capture(1, endpoint="vehicle_positions")
    _live(engine, settings, trip, vehicle)
    _build_daily(engine, trip)
    corrected = _correct_archive(engine, settings, bronze_root, trip)
    before = _gold_state(engine), dict(_state(engine)), _rows(engine, "route_delay_spine")
    failure = RuntimeError("second projection interrupted")
    projections = []

    def interrupt(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO gold.fact_" in statement:
            projections.append(statement)
        if "INSERT INTO gold.fact_vehicle_snapshot" in statement:
            raise failure

    event.listen(engine, "before_cursor_execute", interrupt)
    try:
        with pytest.raises(RuntimeError, match="second projection interrupted") as raised:
            project(corrected, vehicle)
    finally:
        event.remove(engine, "before_cursor_execute", interrupt)
    assert raised.value is failure
    assert len(projections) == 2
    assert (_gold_state(engine), dict(_state(engine)), _rows(engine, "route_delay_spine")) == before
    with engine.connect() as conn:
        assert delay_days.assert_daily_delay_history_clean(conn, PROVIDER)["dirty_day_count"] == 0

    project(corrected, vehicle)
    _assert_dirty(engine, trip)
    assert [row["delay_seconds"] for row in _rows(engine, "fact_trip_delay_snapshot")] == [240]


def test_first_daily_build_forces_actual_gold_entry_to_retry_all_selected_inputs(
    capture, project, engine, settings, bronze_root
):
    trip, vehicle = capture(0), capture(1, endpoint="vehicle_positions")
    _live(engine, settings, trip, vehicle)
    corrected = _correct_archive(engine, settings, bronze_root, trip)
    waiting = Event()
    validations = Counter()
    locks = 0

    def observe(connection, cursor, statement, parameters, context, executemany):
        nonlocal locks
        if "q:mart.replay.source\n" in statement:
            validations[parameters["snapshot_id"]] += 1
        if "q:rollup.delay_day.lock\n" in statement:
            locks += 1
            waiting.set()

    with ThreadPoolExecutor(max_workers=1) as pool:
        with engine.begin() as builder:
            delay_days.lock_delay_day(builder, PROVIDER, _day(trip))
            event.listen(engine, "before_cursor_execute", observe)
            future = pool.submit(project, corrected, vehicle)
            assert waiting.wait(5)
            for kind in delay_days.DAILY_DELAY_TABLES:
                metric(builder, kind, provider=PROVIDER, day=_day(trip))
        try:
            future.result(timeout=5)
        finally:
            event.remove(engine, "before_cursor_execute", observe)

    assert locks == 2
    assert validations == {trip.realtime_snapshot_id: 2, vehicle.realtime_snapshot_id: 2}
    _assert_dirty(engine, trip)
    assert [row["delay_seconds"] for row in _rows(engine, "fact_trip_delay_snapshot")] == [240]
    assert [row["sum_delay_seconds"] for row in _rows(engine, "route_delay_spine")] == [60]
    assert _ids(engine, "latest_trip_delay_snapshot") == [trip.realtime_snapshot_id]
    assert _ids(engine, "latest_vehicle_snapshot") == [vehicle.realtime_snapshot_id]


def test_vehicle_only_projection_leaves_daily_metrics_and_coordination_untouched(
    capture, project, engine, settings
):
    trip = capture(0)
    _live(engine, settings, trip)
    _build_daily(engine, trip)
    before = _rows(engine, "warm_rollup_periods")
    vehicle = capture(1, endpoint="vehicle_positions")

    project(vehicle)

    assert _rows(engine, "warm_rollup_periods") == before
    with engine.connect() as conn:
        assert delay_days.assert_daily_delay_history_clean(conn, PROVIDER)["dirty_day_count"] == 0


def test_replay_takes_all_selected_five_minute_locks_before_daily_locks(capture, engine, settings):
    first, second = capture(0), capture(1, minutes=6)
    calls = []

    def observe(connection, cursor, statement, parameters, context, executemany):
        calls.append(statement)

    event.listen(engine, "before_cursor_execute", observe)
    try:
        refresh_gold_snapshots(
            PROVIDER,
            expected_rows={r.realtime_snapshot_id: r.row_counts for r in (first, second)},
            settings=settings,
            registry=_StubRegistry(),
            engine=engine,
        )
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    hours = [i for i, sql in enumerate(calls) if "q:rollup.route_delay_hourly.lock\n" in sql]
    periods = [
        i for i, sql in enumerate(calls) if "q:rollup.trip_delay.period_lock.acquire\n" in sql
    ]
    days = [i for i, sql in enumerate(calls) if "q:rollup.delay_day.lock\n" in sql]
    deletes = [i for i, sql in enumerate(calls) if "q:mart.replay.delete_trip_updates\n" in sql]
    assert len(hours) == len(days) == 1
    assert len(periods) == len(deletes) == 2
    assert hours[0] < min(periods) <= max(periods) < days[0] < min(deletes)


@pytest.mark.parametrize("sqlstate, attempts", [("40001", 3), ("40P01", 3), ("22012", 1)])
def test_replay_retries_only_transaction_errors_and_preserves_the_last_error(
    capture, engine, settings, sqlstate, attempts
):
    receipt = capture(0)
    failures = []

    def fail(connection, cursor, statement, parameters, context, executemany):
        if "hashtext('gold_marts')" in statement:
            try:
                connection.exec_driver_sql(
                    "DO $$ BEGIN RAISE EXCEPTION 'injected replay transaction failure' "
                    f"USING ERRCODE = '{sqlstate}'; END $$"
                )
            except DBAPIError as error:
                failures.append(error)
                raise

    event.listen(engine, "before_cursor_execute", fail)
    try:
        with pytest.raises(DBAPIError, match="injected replay transaction failure") as raised:
            refresh_gold_snapshots(
                PROVIDER,
                expected_rows={receipt.realtime_snapshot_id: receipt.row_counts},
                settings=settings,
                registry=_StubRegistry(),
                engine=engine,
            )
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    assert len(failures) == attempts
    assert raised.value is failures[-1]
    assert raised.value.orig.sqlstate == sqlstate
    assert not _rows(engine, "fact_trip_delay_snapshot")
    assert not _rows(engine, "warm_rollup_periods")
