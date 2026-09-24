"""Daily dirty-state core, tested independently of future caller integration."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from threading import Event
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import OperationalError

from transit_ops.gold import delay_days, rollups
from transit_ops.gold.transactions import run_gold_transaction

PROVIDER = "daily_state_core"
OTHER = "daily_state_other"
DAY = date(2026, 6, 20)
TZ = ZoneInfo("America/Toronto")
CAPTURE = datetime(2026, 6, 20, 12, tzinfo=UTC)
BUILT = datetime(2026, 6, 21, 12, tzinfo=UTC)
BUILDERS = {
    "route_percentile_daily": rollups.UPSERT_ROUTE_DELAY_PERCENTILE_DAILY,
    "stop_percentile_daily": rollups.UPSERT_STOP_DELAY_PERCENTILE_DAILY,
    "route_delay_by_crowding_daily": rollups.UPSERT_ROUTE_DELAY_BY_CROWDING_DAILY,
    "route_delay_spine": rollups.UPSERT_ROUTE_DELAY_SPINE,
    "stop_delay_spine": rollups.UPSERT_STOP_DELAY_SPINE,
    "stop_delay_shift_daily": rollups.UPSERT_STOP_DELAY_SHIFT_DAILY,
    "repeat_offender_daily_spine": rollups.UPSERT_REPEAT_OFFENDER_DAILY_SPINE,
}


@pytest.fixture
def engine(real_db_engine, seed_provider):
    with real_db_engine.begin() as conn:
        for provider in (PROVIDER, OTHER):
            seed_provider(conn, provider, display_name="Daily state fixture", timezone=str(TZ))
    try:
        yield real_db_engine
    finally:
        with real_db_engine.begin() as conn:
            for table in (
                *delay_days.DAILY_DELAY_TABLES.values(),
                "warm_rollup_periods",
                "fact_trip_delay_snapshot",
            ):
                conn.execute(
                    text(f"DELETE FROM gold.{table} WHERE provider_id IN (:p,:other)"),
                    {"p": PROVIDER, "other": OTHER},
                )
            for table in (
                "raw.realtime_snapshot_index",
                "raw.ingestion_runs",
                "core.feed_endpoints",
                "core.providers",
            ):
                conn.execute(
                    text(f"DELETE FROM {table} WHERE provider_id IN (:p,:other)"),
                    {"p": PROVIDER, "other": OTHER},
                )


def capture(conn, *, provider=PROVIDER, captured=CAPTURE, old_captured=None, with_fact=True):
    snapshot = conn.execute(
        text("""
        WITH endpoint AS (
            INSERT INTO core.feed_endpoints (provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            ON CONFLICT (provider_id,endpoint_key) DO UPDATE SET provider_id=EXCLUDED.provider_id
            RETURNING feed_endpoint_id
        ), run AS (
            INSERT INTO raw.ingestion_runs (provider_id,feed_endpoint_id,run_kind,status)
            SELECT :p,feed_endpoint_id,'trip_updates','succeeded' FROM endpoint
            RETURNING ingestion_run_id,feed_endpoint_id
        )
        INSERT INTO raw.realtime_snapshot_index
            (provider_id,feed_endpoint_id,ingestion_run_id,feed_timestamp_utc,captured_at_utc,entity_count)
        SELECT :p,feed_endpoint_id,ingestion_run_id,:captured,:captured,:entities FROM run
        RETURNING realtime_snapshot_id
    """),
        {"p": provider, "captured": captured, "entities": int(with_fact)},
    ).scalar_one()
    if with_fact:
        fact_time = old_captured or captured
        local_day = fact_time.astimezone(TZ).date()
        conn.execute(
            text("""
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id,realtime_snapshot_id,entity_index,snapshot_date_key,snapshot_local_date,
                 feed_timestamp_utc,captured_at_utc,entity_id,trip_id,route_id,direction_id,
                 start_date,vehicle_id,delay_seconds,stop_time_update_count,delay_stop_id,
                 delay_stop_sequence,occupancy_status)
            VALUES (:p,:snapshot,0,:key,:day,:captured,:captured,'entity','trip','51',0,
                    :day,'vehicle',60,1,'stop',1,5)
        """),
            {
                "p": provider,
                "snapshot": snapshot,
                "captured": fact_time,
                "key": int(local_day.strftime("%Y%m%d")),
                "day": local_day,
            },
        )
    return snapshot


def watermark(conn, *, provider=PROVIDER, kind="route_delay_spine", day=DAY, dirty=False):
    conn.execute(
        text("""
        INSERT INTO gold.warm_rollup_periods
            (provider_id,rollup_kind,period_start_utc,built_at_utc,invalidated_at_utc)
        VALUES (:p,:kind,:day,:built,:dirty)
        ON CONFLICT (provider_id,rollup_kind,period_start_utc) DO UPDATE
            SET built_at_utc=EXCLUDED.built_at_utc,invalidated_at_utc=EXCLUDED.invalidated_at_utc
    """),
        {
            "p": provider,
            "kind": kind,
            "day": delay_days.day_key(day),
            "built": BUILT,
            "dirty": BUILT + timedelta(seconds=1) if dirty else None,
        },
    )


def metric(conn, kind, *, day=DAY, marker=True, provider=PROVIDER):
    conn.execute(
        BUILDERS[kind],
        {
            "provider_id": provider,
            "local_date": day,
            "date_key": int(day.strftime("%Y%m%d")),
            "built_at_utc": BUILT,
        },
    )
    if marker:
        watermark(conn, provider=provider, kind=kind, day=day)


def rows(conn, table, provider=PROVIDER):
    return (
        conn.execute(
            text(
                f"SELECT to_jsonb(r) FROM gold.{table} AS r "
                "WHERE provider_id=:p ORDER BY to_jsonb(r)::text"
            ),
            {"p": provider},
        )
        .scalars()
        .all()
    )


def test_first_build_race_retries_stale_repeatable_read_before_invalidation(engine):
    with engine.begin() as conn:
        snapshot = capture(conn)
    at_lock = Event()
    attempts = 0

    def observe_lock(connection, cursor, statement, parameters, context, executemany):
        nonlocal attempts
        if parameters and str(parameters.get("lock_key", "")).startswith("transit.delay_day|"):
            attempts += 1
            at_lock.set()

    def correct():
        def operation(conn):
            delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
            conn.execute(
                text(
                    "UPDATE gold.fact_trip_delay_snapshot SET delay_seconds=180 "
                    "WHERE provider_id=:p"
                ),
                {"p": PROVIDER},
            )

        return run_gold_transaction(engine, operation)

    with ThreadPoolExecutor(max_workers=1) as pool:
        with engine.begin() as builder:
            delay_days.lock_delay_day(builder, PROVIDER, DAY)
            event.listen(engine, "before_cursor_execute", observe_lock)
            future = pool.submit(correct)
            assert at_lock.wait(5)
            metric(builder, "stop_delay_spine")
        try:
            future.result(timeout=5)
        finally:
            event.remove(engine, "before_cursor_execute", observe_lock)
    with engine.connect() as conn:
        assert delay_days.delay_day_state(conn, PROVIDER, "stop_delay_spine", DAY) == "dirty"
        assert rows(conn, "stop_delay_spine")[0]["sum_delay_seconds"] == 60
        assert rows(conn, "fact_trip_delay_snapshot")[0]["delay_seconds"] == 180
    assert attempts == 2


@pytest.mark.parametrize("kind", tuple(BUILDERS))
def test_each_legacy_metric_row_without_a_watermark_is_discovered(engine, kind):
    with engine.begin() as conn:
        snapshot = capture(conn)
        metric(conn, kind, marker=False)
        before = rows(conn, delay_days.DAILY_DELAY_TABLES[kind])
        assert before
        delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
        assert delay_days.delay_day_state(conn, PROVIDER, kind, DAY) == "dirty"
        assert rows(conn, delay_days.DAILY_DELAY_TABLES[kind]) == before
        assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_days"] == [
            {"date": DAY.isoformat(), "kinds": [kind]}
        ]


def test_value_only_correction_dirties_all_existing_metrics_without_overwriting_built_time(engine):
    with engine.begin() as conn:
        snapshot = capture(conn)
        for kind in BUILDERS:
            metric(conn, kind)
        delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
        conn.execute(
            text("UPDATE gold.fact_trip_delay_snapshot SET delay_seconds=180 WHERE provider_id=:p"),
            {"p": PROVIDER},
        )
        assert len(rows(conn, "fact_trip_delay_snapshot")) == 1
        states = [
            row for row in rows(conn, "warm_rollup_periods") if row["rollup_kind"] in BUILDERS
        ]
        assert len(states) == 7
        assert all(datetime.fromisoformat(row["built_at_utc"]) == BUILT for row in states)
        assert all(row["invalidated_at_utc"] is not None for row in states)
        assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_days"] == [
            {"date": DAY.isoformat(), "kinds": sorted(BUILDERS)}
        ]


def test_clean_empty_marker_becomes_discoverable_without_gold_rows(engine):
    with engine.begin() as conn:
        snapshot = capture(conn, with_fact=False)
        watermark(conn)
        assert delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", DAY) == "clean"
        delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
        assert not rows(conn, "fact_trip_delay_snapshot")
        assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_day_count"] == 1


def test_removing_every_fact_keeps_the_dirty_day_discoverable(engine):
    with engine.begin() as conn:
        snapshot = capture(conn)
        metric(conn, "route_delay_spine")
        delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
        conn.execute(
            text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id=:p"), {"p": PROVIDER}
        )
    with engine.connect() as conn:
        assert not rows(conn, "fact_trip_delay_snapshot")
        assert rows(conn, "route_delay_spine")[0]["sum_delay_seconds"] == 60
        assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_days"] == [
            {"date": DAY.isoformat(), "kinds": ["route_delay_spine"]}
        ]


@pytest.mark.parametrize("materialized", [False, True])
def test_coordination_cost_is_one_row_write_and_lock_per_day(engine, materialized):
    with engine.begin() as conn:
        snapshot = capture(conn)
        if materialized:
            for kind in BUILDERS:
                metric(conn, kind)
        calls = []

        def record(connection, cursor, statement, parameters, context, executemany):
            calls.append((statement, cursor.rowcount))

        event.listen(conn, "after_cursor_execute", record)
        try:
            delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
        finally:
            event.remove(conn, "after_cursor_execute", record)
        assert len(calls) == 4
        assert sum("pg_advisory_xact_lock" in statement for statement, _ in calls) == 1
        coordinator = [
            (statement, count)
            for statement, count in calls
            if "'delay_day_coordination'" in statement
        ]
        assert len(coordinator) == 1
        assert coordinator[0][1] == 1
        metric_calls = [
            count
            for statement, count in calls
            if "INSERT INTO gold.warm_rollup_periods" in statement
            and "'delay_day_coordination'" not in statement
        ]
        assert metric_calls == [7 if materialized else 0]
        assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_day_count"] == int(materialized)
        assert (
            len(
                [
                    row
                    for row in rows(conn, "warm_rollup_periods")
                    if row["rollup_kind"] == delay_days.DAY_COORDINATION_KIND
                ]
            )
            == 1
        )
        delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
        assert (
            len(
                [
                    row
                    for row in rows(conn, "warm_rollup_periods")
                    if row["rollup_kind"] == delay_days.DAY_COORDINATION_KIND
                ]
            )
            == 1
        )
        with pytest.raises(ValueError, match="capture-day delay kinds"):
            delay_days.delay_day_state(conn, PROVIDER, delay_days.DAY_COORDINATION_KIND, DAY)


def test_foreign_snapshot_ids_cannot_dirty_another_provider(engine):
    with engine.begin() as conn:
        foreign = capture(conn, provider=OTHER)
        watermark(conn)
        watermark(conn, provider=OTHER)
        delay_days.invalidate_delay_days(conn, PROVIDER, [foreign])
        assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_day_count"] == 0
        assert delay_days.daily_delay_status(conn, OTHER)["dirty_day_count"] == 0


def test_fact_removal_and_invalidation_roll_back_together(engine):
    with engine.begin() as conn:
        snapshot = capture(conn)
        metric(conn, "route_delay_spine")
    with engine.connect() as conn:
        before = rows(conn, "warm_rollup_periods"), rows(conn, "fact_trip_delay_snapshot")
    with pytest.raises(RuntimeError, match="projection interrupted"):
        with engine.begin() as conn:
            delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
            conn.execute(
                text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id=:p"),
                {"p": PROVIDER},
            )
            raise RuntimeError("projection interrupted")
    with engine.connect() as conn:
        assert (rows(conn, "warm_rollup_periods"), rows(conn, "fact_trip_delay_snapshot")) == before


def test_old_and_new_capture_dates_lock_in_order_and_leave_unselected_state_alone(engine):
    later = DAY + timedelta(days=1)
    untouched = DAY + timedelta(days=2)
    with engine.begin() as conn:
        snapshot = capture(conn, captured=CAPTURE + timedelta(days=1), old_captured=CAPTURE)
        for day in (DAY, later, untouched):
            watermark(conn, day=day)
        watermark(conn, provider=OTHER)
        watermark(conn, kind="route_headway_shift_daily")
    locks = []

    def record(connection, cursor, statement, parameters, context, executemany):
        if parameters and str(parameters.get("lock_key", "")).startswith("transit.delay_day|"):
            locks.append(parameters["lock_key"])

    event.listen(engine, "before_cursor_execute", record)
    try:
        with engine.begin() as conn:
            delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot, snapshot])
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert locks == [f"transit.delay_day|{PROVIDER}|{day.isoformat()}" for day in (DAY, later)]
    with engine.connect() as conn:
        assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_day_count"] == 2
        assert delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", untouched) == "clean"
        assert delay_days.daily_delay_status(conn, OTHER)["dirty_day_count"] == 0
        assert all(
            row["invalidated_at_utc"] is None
            for row in rows(conn, "warm_rollup_periods")
            if row["rollup_kind"] == "route_headway_shift_daily"
        )


def test_day_locks_exist_without_metrics_and_are_independent_across_days_and_providers(engine):
    with engine.begin() as owner:
        delay_days.lock_delay_day(owner, PROVIDER, DAY)
        with engine.begin() as independent:
            independent.execute(text("SET LOCAL lock_timeout='100ms'"))
            delay_days.lock_delay_day(independent, OTHER, DAY)
            delay_days.lock_delay_day(independent, PROVIDER, DAY + timedelta(days=1))
        with engine.begin() as contender:
            contender.execute(text("SET LOCAL lock_timeout='100ms'"))
            with pytest.raises(OperationalError) as blocked:
                delay_days.lock_delay_day(contender, PROVIDER, DAY)
            assert blocked.value.orig.sqlstate == "55P03"


def test_status_and_assertion_honor_provider_inclusive_dates_and_kind_filters(engine):
    with engine.begin() as conn:
        for day, kind in (
            (DAY, "route_delay_spine"),
            (DAY, "stop_delay_spine"),
            (DAY + timedelta(days=1), "route_delay_spine"),
        ):
            watermark(conn, day=day, kind=kind, dirty=True)
        watermark(conn, provider=OTHER, dirty=True)
        conn.execute(text("SET LOCAL timezone='Pacific/Auckland'"))
        assert delay_days.daily_delay_status(
            conn, PROVIDER, from_date=DAY, to_date=DAY, kinds=["stop_delay_spine"]
        )["dirty_days"] == [{"date": DAY.isoformat(), "kinds": ["stop_delay_spine"]}]
        with pytest.raises(ValueError, match="dirty day"):
            delay_days.assert_daily_delay_history_clean(conn, PROVIDER, to_date=DAY)
        assert (
            delay_days.assert_daily_delay_history_clean(
                conn, PROVIDER, from_date=DAY + timedelta(days=2)
            )["dirty_day_count"]
            == 0
        )
        assert delay_days.daily_delay_status(conn, PROVIDER, kinds=[])["dirty_day_count"] == 0
        with pytest.raises(ValueError, match="capture-day delay kinds"):
            delay_days.daily_delay_status(conn, PROVIDER, kinds=["route_headway_shift_daily"])
        with pytest.raises(ValueError, match="ordered"):
            delay_days.daily_delay_status(
                conn, PROVIDER, from_date=DAY, to_date=DAY - timedelta(days=1)
            )
