"""Capture-day delay cohorts use one DST-safe calendar and explicit bounded recovery."""

import json
from contextlib import contextmanager
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event, text

from transit_ops.gold import rollups
from transit_ops.settings import Settings

PROVIDER = "capture_day_clock_test"
TZ = ZoneInfo("America/Toronto")
DAY = date(2026, 6, 24)
COHORT = (
    (
        "route_delay_percentile_daily",
        "UPSERT_ROUTE_DELAY_PERCENTILE_DAILY",
        "delay_observation_count",
        1,
    ),
    (
        "stop_delay_percentile_daily",
        "UPSERT_STOP_DELAY_PERCENTILE_DAILY",
        "delay_observation_count",
        1,
    ),
    (
        "route_delay_by_crowding_daily",
        "UPSERT_ROUTE_DELAY_BY_CROWDING_DAILY",
        "delay_observation_count",
        1,
    ),
    ("route_delay_spine", "UPSERT_ROUTE_DELAY_SPINE", "observation_count", 1),
    ("stop_delay_spine", "UPSERT_STOP_DELAY_SPINE", "observation_count", 1),
    ("stop_delay_shift_daily", "UPSERT_STOP_DELAY_SHIFT_DAILY", "observation_count", 1),
    ("repeat_offender_daily_spine", "UPSERT_REPEAT_OFFENDER_DAILY_SPINE", "observation_count", 2),
)


class TransactionEngine:
    def __init__(self, connection):
        self.connection = connection

    @contextmanager
    def begin(self):
        with self.connection.begin_nested():
            yield self.connection


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        seed_provider(connection, PROVIDER, display_name="Capture-day clock", timezone=str(TZ))
        try:
            yield connection
        finally:
            transaction.rollback()


def midnight(day, tz=TZ):
    return datetime.combine(day, time(), tzinfo=tz).astimezone(UTC)


def seed(conn, captured, *, feed=None, delay=60, empty=False):
    feed = feed or captured
    feed_day = feed.astimezone(TZ).date()
    snapshot_id = conn.execute(
        text("""
        WITH endpoint AS (
            INSERT INTO core.feed_endpoints (provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            ON CONFLICT (provider_id, endpoint_key) DO UPDATE SET provider_id=EXCLUDED.provider_id
            RETURNING feed_endpoint_id
        ), run AS (
            INSERT INTO raw.ingestion_runs (provider_id, feed_endpoint_id, run_kind, status)
            SELECT :p, feed_endpoint_id, 'trip_updates', 'succeeded' FROM endpoint
            RETURNING ingestion_run_id, feed_endpoint_id
        ), object AS (
            INSERT INTO raw.ingestion_objects
                (provider_id, ingestion_run_id, object_kind, storage_backend,
                 storage_path, checksum_sha256, byte_size)
            SELECT :p, ingestion_run_id, 'trip_updates', 'local',
                   :p || '/' || ingestion_run_id::text, repeat('a',64), 1
            FROM run RETURNING ingestion_object_id, ingestion_run_id
        ), snapshot AS (
            INSERT INTO raw.realtime_snapshot_index
                (provider_id, feed_endpoint_id, ingestion_run_id, ingestion_object_id,
                 feed_timestamp_utc,
                 captured_at_utc, entity_count)
            SELECT :p, feed_endpoint_id, ingestion_run_id, ingestion_object_id,
                   :feed, :captured, :entities FROM run JOIN object USING (ingestion_run_id)
            RETURNING realtime_snapshot_id
        ), fact AS (
        INSERT INTO gold.fact_trip_delay_snapshot
            (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
             snapshot_local_date,
             feed_timestamp_utc, captured_at_utc, entity_id, trip_id, route_id, direction_id,
             start_date, vehicle_id, delay_seconds, stop_time_update_count,
             delay_stop_id, delay_stop_sequence, occupancy_status)
        SELECT :p, realtime_snapshot_id, 0, :date_key, :feed_day, :feed, :captured,
               'entity', 'trip', '51', 0, :service_day, 'vehicle', :delay, 1, 'stop', 1, 5
        FROM snapshot WHERE :entities > 0
        ) SELECT realtime_snapshot_id FROM snapshot
    """),
        {
            "p": PROVIDER,
            "feed": feed,
            "captured": captured,
            "feed_day": feed_day,
            "date_key": int(feed_day.strftime("%Y%m%d")),
            "service_day": captured.astimezone(TZ).date(),
            "delay": delay,
            "entities": 0 if empty else 1,
        },
    ).scalar_one()
    conn.execute(
        text("""
        WITH frame AS (
            INSERT INTO silver.rt_feed_snapshots
                (provider_id,feed_endpoint_id,ingestion_run_id,ingestion_object_id,endpoint_key,
                 captured_at_utc,feed_timestamp_utc,checksum_sha256,byte_size,
                 source_realtime_snapshot_id,manifest_json)
            SELECT provider_id,feed_endpoint_id,ingestion_run_id,ingestion_object_id,'trip_updates',
                   captured_at_utc,feed_timestamp_utc,repeat('a',64),1,realtime_snapshot_id,
                   jsonb_build_object('entity_count',entity_count)
            FROM raw.realtime_snapshot_index WHERE realtime_snapshot_id=:snapshot
            RETURNING rt_feed_snapshot_id
        ), entity AS (
            INSERT INTO silver.rt_entities
                (rt_feed_snapshot_id,entity_index,provider_id,entity_id,entity_kind)
            SELECT rt_feed_snapshot_id,0,:p,'entity','trip_update' FROM frame WHERE :entities > 0
        )
        INSERT INTO silver.rt_trip_updates
            (rt_feed_snapshot_id,entity_index,provider_id,trip_id,route_id,
             captured_at_utc,feed_timestamp_utc)
        SELECT rt_feed_snapshot_id,0,:p,'trip','51',:captured,:feed
        FROM frame WHERE :entities > 0
        """),
        {
            "p": PROVIDER,
            "snapshot": snapshot_id,
            "captured": captured,
            "feed": feed,
            "entities": 0 if empty else 1,
        },
    )
    return snapshot_id


def build_day(conn, day):
    params = {
        "provider_id": PROVIDER,
        "local_date": day,
        "date_key": int(day.strftime("%Y%m%d")),
        "built_at_utc": midnight(day + timedelta(days=2)),
    }
    for _, statement, _, _ in COHORT:
        conn.execute(getattr(rollups, statement), params)


def day_counts(conn, table, column):
    return dict(
        conn.execute(
            text(
                f"SELECT provider_local_date, sum({column}) FROM gold.{table} "
                "WHERE provider_id=:p GROUP BY provider_local_date ORDER BY provider_local_date"
            ),
            {"p": PROVIDER},
        ).all()
    )


def test_midnight_divergence_uses_capture_day_without_changing_fact_dates(conn):
    start, end = midnight(DAY), midnight(DAY + timedelta(days=1))
    seed(conn, start, feed=start - timedelta(seconds=30))
    seed(conn, start - timedelta(seconds=1), feed=start + timedelta(seconds=30))
    seed(conn, end, feed=end - timedelta(seconds=30))
    before = conn.execute(
        text(
            "SELECT realtime_snapshot_id, snapshot_date_key, snapshot_local_date, start_date "
            "FROM gold.fact_trip_delay_snapshot WHERE provider_id=:p "
            "ORDER BY realtime_snapshot_id"
        ),
        {"p": PROVIDER},
    ).all()
    days = [DAY + timedelta(days=offset) for offset in (-1, 0, 1)]
    for day in days:
        build_day(conn, day)
    for table, _, column, factor in COHORT:
        assert day_counts(conn, table, column) == {day: factor for day in days}, table
    assert (
        conn.execute(
            text(
                "SELECT realtime_snapshot_id, snapshot_date_key, snapshot_local_date, start_date "
                "FROM gold.fact_trip_delay_snapshot WHERE provider_id=:p "
                "ORDER BY realtime_snapshot_id"
            ),
            {"p": PROVIDER},
        ).all()
        == before
    )


@pytest.mark.parametrize("day, expected_hours", [(date(2026, 3, 8), 23), (date(2026, 11, 1), 25)])
def test_capture_day_bounds_include_the_whole_dst_day_and_exclude_adjacent_days(
    conn, day, expected_hours
):
    start, end = midnight(day), midnight(day + timedelta(days=1))
    assert (end - start).total_seconds() / 3600 == expected_hours
    for hour in range(expected_hours):
        seed(conn, start + timedelta(hours=hour), feed=start + timedelta(hours=12))
    seed(conn, start - timedelta(microseconds=1), feed=start)
    seed(conn, end, feed=start)
    conn.execute(text("SET LOCAL timezone='Pacific/Auckland'"))
    build_day(conn, day)
    for table, _, column, factor in COHORT:
        assert day_counts(conn, table, column) == {day: expected_hours * factor}, table
    hours = dict(
        conn.execute(
            text(
                "SELECT hour_of_day_local, observation_count FROM gold.route_delay_spine "
                "WHERE provider_id=:p ORDER BY hour_of_day_local"
            ),
            {"p": PROVIDER},
        ).all()
    )
    if expected_hours == 23:
        assert 2 not in hours
        assert len(hours) == 23
    else:
        assert hours[1] == 2
        assert len(hours) == 24


def test_ordinary_day_preserves_existing_delay_denominators_and_values(conn):
    captured = midnight(DAY) + timedelta(hours=12)
    for delay in (-60, 0, 60, 120, 600, 4000, None):
        seed(conn, captured, delay=delay)
    build_day(conn, DAY)
    row = (
        conn.execute(
            text(
                "SELECT observation_count, delay_observation_count, on_time_observation_count, "
                "severe_delay_count, sum_delay_seconds, delay_histogram, delayed_trip_count "
                "FROM gold.route_delay_spine WHERE provider_id=:p"
            ),
            {"p": PROVIDER},
        )
        .mappings()
        .one()
    )
    assert tuple(
        row[key]
        for key in (
            "observation_count",
            "delay_observation_count",
            "on_time_observation_count",
            "severe_delay_count",
            "sum_delay_seconds",
            "delayed_trip_count",
        )
    ) == (7, 6, 4, 1, 720, 1)
    assert sum(row["delay_histogram"]) == 5
    for table in ("route_delay_percentile_daily", "stop_delay_percentile_daily"):
        assert conn.execute(
            text(
                "SELECT delay_observation_count, p50_delay_seconds, p90_delay_seconds "
                f"FROM gold.{table} "
                "WHERE provider_id=:p"
            ),
            {"p": PROVIDER},
        ).one() == (5, Decimal("60"), Decimal("408"))
    for table, _, column, factor in COHORT[2:]:
        expected = 7 if table == "route_delay_spine" else 5 * factor
        assert day_counts(conn, table, column) == {DAY: expected}


def test_capture_calendar_matches_distinct_capture_dates_and_ignores_feed_keys(conn):
    for offset in (-2, -1, 0, 0, 1, 3, 4):
        seed(
            conn,
            midnight(DAY + timedelta(days=offset)) + timedelta(hours=1),
            feed=midnight(DAY - timedelta(days=10)),
        )
    params = {"provider_id": PROVIDER, "floor_key": 20260624, "today_key": 20260628}
    actual = conn.execute(rollups.SELECT_AVAILABLE_CAPTURE_DAYS, params).all()
    expected = conn.execute(
        text("""
        SELECT DISTINCT timezone(:tz, captured_at_utc)::date AS local_date,
               to_char(timezone(:tz, captured_at_utc), 'YYYYMMDD')::integer AS date_key
        FROM gold.fact_trip_delay_snapshot WHERE provider_id=:provider_id
          AND timezone(:tz, captured_at_utc)::date >= :floor_day
          AND timezone(:tz, captured_at_utc)::date < :today
        ORDER BY local_date
    """),
        params | {"tz": str(TZ), "floor_day": DAY, "today": DAY + timedelta(days=4)},
    ).all()
    assert actual == expected
    assert [row.local_date for row in actual] == [
        DAY,
        DAY + timedelta(days=1),
        DAY + timedelta(days=3),
    ]


def test_capture_calendar_and_day_ranges_can_use_the_capture_index(conn):
    seed(conn, midnight(DAY), feed=midnight(DAY - timedelta(days=1)))
    for offset in range(1, 31):
        seed(conn, midnight(DAY - timedelta(days=offset)), feed=midnight(DAY))
    conn.execute(text("ANALYZE gold.fact_trip_delay_snapshot"))
    conn.execute(text("SET LOCAL enable_seqscan=off"))
    plan = conn.execute(
        text("EXPLAIN (FORMAT JSON, COSTS OFF) " + str(rollups.SELECT_AVAILABLE_CAPTURE_DAYS)),
        {
            "provider_id": PROVIDER,
            "floor_key": 20260624,
            "today_key": 20260625,
            "retained_since_utc": None,
        },
    ).scalar_one()

    def index_conditions(node):
        if isinstance(node, dict):
            if "Index Cond" in node:
                yield node["Index Cond"]
            for value in node.values():
                yield from index_conditions(value)
        elif isinstance(node, list):
            for value in node:
                yield from index_conditions(value)

    assert any(
        "captured_at_utc >=" in condition and "captured_at_utc <" in condition
        for condition in index_conditions(plan)
    ), json.dumps(plan, indent=2)


def test_partial_retention_floor_and_existing_watermarks_are_not_implicitly_rebuilt(
    conn, monkeypatch
):
    monkeypatch.setattr(
        rollups, "materialization_time", lambda _: midnight(DAY + timedelta(days=1))
    )
    partial_day = DAY - timedelta(days=1)
    seed(conn, midnight(DAY) - timedelta(seconds=1), feed=midnight(DAY))
    seed(conn, midnight(DAY), feed=midnight(DAY - timedelta(days=2)))
    engine = TransactionEngine(conn)
    kwargs = {
        "provider_id": PROVIDER,
        "rollup_kind": "route_delay_spine",
        "upsert": rollups.UPSERT_ROUTE_DELAY_SPINE,
        "floor_key": 20260624,
        "today_key": 20260625,
        "select_missing": rollups.SELECT_MISSING_CAPTURE_DAYS,
        "now": midnight(DAY + timedelta(days=1)),
    }
    assert rollups._build_percentile_days(engine, **kwargs) == 1
    assert day_counts(conn, "route_delay_spine", "observation_count") == {DAY: 1}

    assert partial_day not in day_counts(conn, "route_delay_spine", "observation_count")
    seed(conn, midnight(DAY) + timedelta(hours=1), feed=midnight(DAY))
    assert rollups._build_percentile_days(engine, **kwargs) == 0
    assert day_counts(conn, "route_delay_spine", "observation_count") == {DAY: 1}


def test_fall_back_cutoff_excludes_a_partially_retained_local_day_before_rebuild(conn, monkeypatch):
    now = datetime(2026, 11, 8, 23, 45, tzinfo=TZ).astimezone(UTC)
    cutoff = now - timedelta(days=14)
    partial_day, complete_day = date(2026, 10, 26), date(2026, 10, 27)
    assert midnight(partial_day) < cutoff < midnight(complete_day)
    seed(conn, cutoff + timedelta(minutes=5))
    seed(conn, midnight(complete_day))
    dates = conn.execute(
        rollups.SELECT_AVAILABLE_CAPTURE_DAYS,
        {
            "provider_id": PROVIDER,
            "floor_key": 20261026,
            "today_key": 20261108,
            "retained_since_utc": cutoff,
        },
    ).all()
    assert [row.local_date for row in dates] == [complete_day]
    monkeypatch.setattr(rollups, "utc_now", lambda: now)
    monkeypatch.setattr(rollups, "materialization_time", lambda _: now.astimezone(TZ))
    monkeypatch.setattr(rollups, "_PROVIDER_TODAY_LOCAL_SQL", text("SELECT DATE '2026-11-08'"))
    with pytest.raises(ValueError, match="partially retained"):
        rollups.rebuild_warm_rollups(
            PROVIDER,
            engine=TransactionEngine(conn),
            settings=Settings.model_construct(),
            from_date=partial_day,
            to_date=complete_day,
            kinds=["route_delay_spine"],
        )
    assert day_counts(conn, "route_delay_spine", "observation_count") == {}
    assert (
        conn.execute(
            text("SELECT count(*) FROM gold.warm_rollup_periods WHERE provider_id=:p"),
            {"p": PROVIDER},
        ).scalar_one()
        == 0
    )


@pytest.mark.parametrize("table, statement, column, factor", COHORT)
def test_buffered_capture_day_is_rechecked_at_materialization(
    conn, monkeypatch, table, statement, column, factor
):
    seed(conn, midnight(DAY))
    before = midnight(DAY) + timedelta(days=14) - timedelta(seconds=1)
    after = before + timedelta(seconds=2)
    available = conn.execute(
        rollups.SELECT_AVAILABLE_CAPTURE_DAYS,
        {
            "provider_id": PROVIDER,
            "floor_key": 20260624,
            "today_key": 20260625,
            "retained_since_utc": before - timedelta(days=14),
        },
    ).all()
    assert [row.local_date for row in available] == [DAY]
    monkeypatch.setattr(rollups, "materialization_time", lambda _: after)
    kind = next(kind for kind in rollups.REBUILDABLE_KINDS.values() if kind.table == table)
    with pytest.raises(ValueError, match="partially retained"):
        rollups._build_percentile_days(
            TransactionEngine(conn),
            provider_id=PROVIDER,
            rollup_kind=kind.rollup_kind,
            upsert=getattr(rollups, statement),
            floor_key=20260624,
            today_key=20260625,
            now=before,
            available_days=available,
            retention_days=14,
        )
    assert day_counts(conn, table, column) == {}
    assert (
        conn.execute(
            text("SELECT count(*) FROM gold.warm_rollup_periods WHERE provider_id=:p"),
            {"p": PROVIDER},
        ).scalar_one()
        == 0
    )


@pytest.mark.parametrize("expiry_check", [2, 4])
def test_rebuild_retention_crossing_preserves_old_rows_and_watermark(
    conn, monkeypatch, expiry_check
):
    seed(conn, midnight(DAY))
    build_day(conn, DAY)
    before = midnight(DAY) + timedelta(days=14) - timedelta(seconds=1)
    after = before + timedelta(seconds=2)
    conn.execute(
        rollups.UPSERT_WARM_ROLLUP_PERIOD,
        {
            "provider_id": PROVIDER,
            "rollup_kind": "route_delay_spine",
            "period_start_utc": datetime.combine(DAY, time(), tzinfo=UTC),
            "built_at_utc": before,
        },
    )
    old_rows = (
        conn.execute(
            text("SELECT to_jsonb(s) FROM gold.route_delay_spine AS s WHERE provider_id=:p"),
            {"p": PROVIDER},
        )
        .scalars()
        .all()
    )
    old_markers = (
        conn.execute(
            text("SELECT to_jsonb(w) FROM gold.warm_rollup_periods AS w WHERE provider_id=:p"),
            {"p": PROVIDER},
        )
        .scalars()
        .all()
    )
    checks, deletes = 0, 0

    def advancing_clock(_connection):
        nonlocal checks
        checks += 1
        return after if checks >= expiry_check else before

    def record_delete(connection, cursor, statement, parameters, context, executemany):
        nonlocal deletes
        if "DELETE FROM gold.route_delay_spine" in statement:
            deletes += 1

    monkeypatch.setattr(rollups, "utc_now", lambda: before)
    monkeypatch.setattr(rollups, "materialization_time", advancing_clock)
    monkeypatch.setattr(rollups, "_PROVIDER_TODAY_LOCAL_SQL", text("SELECT DATE '2026-07-07'"))
    event.listen(conn, "after_cursor_execute", record_delete)
    try:
        with pytest.raises(ValueError, match="partially retained"):
            rollups.rebuild_warm_rollups(
                PROVIDER,
                engine=TransactionEngine(conn),
                settings=Settings.model_construct(),
                from_date=DAY,
                to_date=DAY,
                kinds=["route_delay_spine"],
            )
    finally:
        event.remove(conn, "after_cursor_execute", record_delete)
    assert deletes == (1 if expiry_check == 4 else 0)
    assert (
        conn.execute(
            text("SELECT to_jsonb(s) FROM gold.route_delay_spine AS s WHERE provider_id=:p"),
            {"p": PROVIDER},
        )
        .scalars()
        .all()
        == old_rows
    )
    assert (
        conn.execute(
            text("SELECT to_jsonb(w) FROM gold.warm_rollup_periods AS w WHERE provider_id=:p"),
            {"p": PROVIDER},
        )
        .scalars()
        .all()
        == old_markers
    )


def test_explicit_bounded_rebuild_moves_old_feed_day_rows_and_removes_empty_old_day(
    conn, monkeypatch
):
    old_day = DAY - timedelta(days=1)
    seed(conn, midnight(old_day), empty=True)
    seed(conn, midnight(DAY), feed=midnight(DAY) - timedelta(seconds=30))
    # A historical row/watermark was materialized under feed-day attribution.
    conn.execute(
        text("""
        INSERT INTO gold.route_delay_spine
            (provider_id, route_id, provider_local_date, hour_of_day_local, direction_id,
             observation_count, delay_observation_count, on_time_observation_count,
             severe_delay_count, sum_delay_seconds, delay_histogram, delayed_trip_count)
        VALUES (:p, '51', :old_day, 0, 0, 1, 1, 1, 0, 60,
                ARRAY[0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], 1)
    """),
        {"p": PROVIDER, "old_day": old_day},
    )
    conn.execute(
        rollups.UPSERT_WARM_ROLLUP_PERIOD,
        {
            "provider_id": PROVIDER,
            "rollup_kind": "route_delay_spine",
            "period_start_utc": datetime.combine(old_day, time(), tzinfo=UTC),
            "built_at_utc": midnight(DAY),
        },
    )
    outside_day = DAY - timedelta(days=2)
    conn.execute(
        text(
            "INSERT INTO gold.route_delay_spine SELECT (jsonb_populate_record("
            "NULL::gold.route_delay_spine, to_jsonb(s) || "
            "jsonb_build_object('provider_local_date', CAST(:outside AS date)))).* "
            "FROM gold.route_delay_spine AS s WHERE provider_id=:p"
        ),
        {"p": PROVIDER, "outside": outside_day},
    )
    monkeypatch.setattr(rollups, "_PROVIDER_TODAY_LOCAL_SQL", text("SELECT DATE '2026-06-26'"))
    monkeypatch.setattr(rollups, "utc_now", lambda: midnight(date(2026, 6, 26)))
    monkeypatch.setattr(rollups, "materialization_time", lambda _: midnight(date(2026, 6, 26)))
    result = rollups.rebuild_warm_rollups(
        PROVIDER,
        engine=TransactionEngine(conn),
        settings=Settings.model_construct(),
        from_date=old_day,
        to_date=DAY,
        kinds=["route_delay_spine"],
    )
    assert result.deleted_row_counts["route_delay_spine"] == 1
    assert result.rebuilt_day_counts["route_delay_spine"] == 2
    assert day_counts(conn, "route_delay_spine", "observation_count") == {outside_day: 1, DAY: 1}
