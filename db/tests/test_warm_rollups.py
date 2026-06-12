from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime

from transit_ops.gold import rollups
from transit_ops.gold.rollups import WarmRollupBuildResult, build_warm_rollups
from transit_ops.maintenance import WarmRollupStoragePruneResult, prune_warm_rollup_storage
from transit_ops.settings import Settings

# Tables pruned by prune_warm_rollup_storage (maintenance.py retention registry).
# These daily marts (route_headway_daily, repeat_offender_daily) are full-rebuilt
# each run and are NOT time-window pruned, so they are intentionally absent here.
REPORTING_AGGREGATE_TABLES = (
    "route_delay_hourly",
    "route_delay_day_of_week",
    "stop_delay_hourly",
    "route_reliability_weekly",
    "route_reliability_monthly",
    "stop_delay_weekly",
    "stop_delay_monthly",
    "route_habit_score",
    "repeated_problem_route_stop",
    "citizen_accountability_daily",
)

# Tables rebuilt by build_warm_rollups (rollups.py REPORTING_AGGREGATE_TABLES).
# Superset of the prune registry — adds the HISTORIC-tier daily marts.
BUILD_REPORTING_AGGREGATE_TABLES = (
    *REPORTING_AGGREGATE_TABLES,
    "route_headway_daily",
    "repeat_offender_daily",
)

REPORTING_AGGREGATE_ROWCOUNTS = {
    table_name: index
    for index, table_name in enumerate(REPORTING_AGGREGATE_TABLES, start=10)
}

BUILD_REPORTING_AGGREGATE_ROWCOUNTS = {
    table_name: index
    for index, table_name in enumerate(BUILD_REPORTING_AGGREGATE_TABLES, start=10)
}


class RowcountResult:
    def __init__(self, rowcount: int) -> None:
        self.rowcount = rowcount


class ScalarResult:
    def __init__(self, value: int) -> None:
        self.value = value

    def scalar_one(self) -> int:
        return self.value


class IterableResult:
    def __init__(self, rows: list) -> None:
        self.rows = rows
        self.rowcount = len(rows)

    def fetchall(self) -> list:
        return self.rows


class FakeRow:
    def __init__(self, period_start_utc: datetime) -> None:
        self.period_start_utc = period_start_utc


class FakeConnection:
    def __init__(
        self,
        vehicle_periods: list[datetime] | None = None,
        trip_delay_periods: list[datetime] | None = None,
    ) -> None:
        self.vehicle_periods = vehicle_periods or []
        self.trip_delay_periods = trip_delay_periods or []
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql = str(statement)
        self.executed.append(sql)

        if "fact_vehicle_snapshot" in sql and "warm_rollup_periods" in sql and "NOT IN" in sql:
            return IterableResult([FakeRow(p) for p in self.vehicle_periods])

        if "fact_trip_delay_snapshot" in sql and "warm_rollup_periods" in sql and "NOT IN" in sql:
            return IterableResult([FakeRow(p) for p in self.trip_delay_periods])

        if "INSERT INTO gold.vehicle_summary_5m" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.trip_delay_summary_5m" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.warm_rollup_periods" in sql:
            return RowcountResult(1)

        for table_name, rowcount in BUILD_REPORTING_AGGREGATE_ROWCOUNTS.items():
            if f"INSERT INTO gold.{table_name}" in sql:
                return RowcountResult(rowcount)
            if (
                ("SELECT COUNT(*)" in sql or "SELECT count(*)" in sql)
                and f"FROM gold.{table_name}" in sql
            ):
                return ScalarResult(rowcount)
            if f"DELETE FROM gold.{table_name}" in sql:
                return RowcountResult(rowcount)

        if "DELETE FROM gold.vehicle_summary_5m" in sql:
            return RowcountResult(5)

        if "DELETE FROM gold.trip_delay_summary_5m" in sql:
            return RowcountResult(3)

        if "DELETE FROM gold.warm_rollup_periods" in sql:
            return RowcountResult(8)

        if "SELECT COUNT(*)" in sql and "FROM gold.vehicle_summary_5m" in sql:
            return ScalarResult(5)

        if "SELECT COUNT(*)" in sql and "FROM gold.trip_delay_summary_5m" in sql:
            return ScalarResult(3)

        if "SELECT COUNT(*)" in sql and "FROM gold.warm_rollup_periods" in sql:
            return ScalarResult(8)

        return RowcountResult(0)


class FakeEngine:
    def __init__(self, connection: FakeConnection) -> None:
        self._connection = connection

    @contextmanager
    def begin(self):
        yield self._connection


def _fake_settings(**kwargs) -> Settings:
    defaults = {
        "DATABASE_URL": None,
        "GOLD_FACT_RETENTION_DAYS": 14,
        "GOLD_REPORTING_OPEN_WINDOW_DAYS": 10,
        "GOLD_WARM_ROLLUP_RETENTION_DAYS": 90,
    }
    defaults.update(kwargs)
    return Settings.model_construct(**defaults)


def test_build_vehicle_rollup_inserts_new_periods() -> None:
    periods = [
        datetime(2026, 3, 25, 12, 0, tzinfo=UTC),
        datetime(2026, 3, 25, 12, 5, tzinfo=UTC),
    ]
    conn = FakeConnection(vehicle_periods=periods)
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert isinstance(result, WarmRollupBuildResult)
    assert result.provider_id == "stm"
    assert result.built_vehicle_periods == 2
    assert result.built_trip_delay_periods == 0

    vehicle_upserts = [s for s in conn.executed if "INSERT INTO gold.vehicle_summary_5m" in s]
    assert len(vehicle_upserts) == 2

    period_upserts = [s for s in conn.executed if "INSERT INTO gold.warm_rollup_periods" in s]
    assert len(period_upserts) == 2


def test_build_vehicle_rollup_skips_already_built_periods() -> None:
    """Idempotency: no missing periods → 0 built."""
    conn = FakeConnection(vehicle_periods=[], trip_delay_periods=[])
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.built_vehicle_periods == 0
    assert result.built_trip_delay_periods == 0

    vehicle_upserts = [s for s in conn.executed if "INSERT INTO gold.vehicle_summary_5m" in s]
    assert len(vehicle_upserts) == 0


def test_build_trip_delay_rollup_inserts_new_periods() -> None:
    periods = [
        datetime(2026, 3, 25, 8, 0, tzinfo=UTC),
        datetime(2026, 3, 25, 8, 5, tzinfo=UTC),
        datetime(2026, 3, 25, 8, 10, tzinfo=UTC),
    ]
    conn = FakeConnection(trip_delay_periods=periods)
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.built_vehicle_periods == 0
    assert result.built_trip_delay_periods == 3

    delay_upserts = [s for s in conn.executed if "INSERT INTO gold.trip_delay_summary_5m" in s]
    assert len(delay_upserts) == 3

    period_upserts = [s for s in conn.executed if "INSERT INTO gold.warm_rollup_periods" in s]
    assert len(period_upserts) == 3


def test_build_warm_rollups_empty_facts_is_noop() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.built_vehicle_periods == 0
    assert result.built_trip_delay_periods == 0
    assert isinstance(result.completed_at_utc, datetime)


def test_build_warm_rollups_rebuilds_reporting_aggregate_marts() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.reporting_aggregate_row_counts == {
        table_name: rowcount
        for table_name, rowcount in BUILD_REPORTING_AGGREGATE_ROWCOUNTS.items()
    }
    for table_name in BUILD_REPORTING_AGGREGATE_TABLES:
        delete_index = next(
            index
            for index, statement in enumerate(conn.executed)
            if f"DELETE FROM gold.{table_name}" in statement
        )
        insert_index = next(
            index
            for index, statement in enumerate(conn.executed)
            if f"INSERT INTO gold.{table_name}" in statement
        )
        assert delete_index < insert_index


def test_open_window_guard_rejects_window_gte_fact_retention() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)

    try:
        build_warm_rollups(
            "stm",
            engine=engine,
            settings=_fake_settings(
                GOLD_REPORTING_OPEN_WINDOW_DAYS=14,
                GOLD_FACT_RETENTION_DAYS=14,
            ),
        )
    except ValueError as exc:
        assert "GOLD_REPORTING_OPEN_WINDOW_DAYS" in str(exc)
    else:
        raise AssertionError("expected open-window guard to reject fact-retention overlap")


def test_reporting_aggregate_builders_read_gold_reporting_surfaces_only() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)

    build_warm_rollups("stm", engine=engine)

    aggregate_inserts = [
        statement
        for statement in conn.executed
        if any(
            f"INSERT INTO gold.{table_name}" in statement
            for table_name in BUILD_REPORTING_AGGREGATE_TABLES
        )
    ]
    assert len(aggregate_inserts) == len(BUILD_REPORTING_AGGREGATE_TABLES)
    assert all(" silver." not in statement.lower() for statement in aggregate_inserts)
    assert any("FROM gold.trip_delay_summary_5m" in statement for statement in aggregate_inserts)
    assert any("FROM gold.fact_trip_delay_snapshot" in statement for statement in aggregate_inserts)
    assert any("FROM gold.fact_vehicle_snapshot" in statement for statement in aggregate_inserts)
    assert any("FROM gold.route_delay_hourly" in statement for statement in aggregate_inserts)
    assert any("FROM gold.stop_delay_hourly" in statement for statement in aggregate_inserts)
    assert any("LEAST(" in statement for statement in aggregate_inserts)
    assert any(
        "FROM gold.i3_alert_history_reporting" in statement
        for statement in aggregate_inserts
    )
    assert any("gold.dim_provider" in statement for statement in aggregate_inserts)
    assert all(
        "FROM gold.public_alert_impact_daily" not in statement
        for statement in aggregate_inserts
    )
    assert all(
        "gold.fact_stop_time_delay_observation" not in statement
        for statement in aggregate_inserts
    )
    assert all(
        "gold.public_route_reliability_daily" not in statement
        for statement in aggregate_inserts
    )
    assert all(
        "gold.public_stop_delay_daily" not in statement
        for statement in aggregate_inserts
    )
    assert all(
        "gold.current_trip_delay_computed" not in statement
        for statement in aggregate_inserts
    )
    route_hourly_sql = str(rollups.UPSERT_ROUTE_DELAY_HOURLY)
    assert "FROM gold.fact_trip_delay_snapshot" not in route_hourly_sql


def test_citizen_accountability_alert_count_uses_content_hash() -> None:
    sql = str(rollups.REPORTING_AGGREGATE_UPSERTS["citizen_accountability_daily"])

    assert "COUNT(DISTINCT effective_content_hash)" in sql
    assert "COUNT(DISTINCT alert_id)" not in sql
    assert "FROM gold.i3_alert_history_reporting" in sql
    assert "provider_id = :provider_id" in sql


def test_citizen_accountability_single_alert_count_source() -> None:
    sql = str(rollups.REPORTING_AGGREGATE_UPSERTS["citizen_accountability_daily"])

    assert "GREATEST(" not in sql
    assert "public_alert_impact_daily" not in sql
    assert "COALESCE(ia.alert_count, 0)::numeric * 2" in sql
    assert "ON CONFLICT (provider_id, provider_local_date)" not in sql


def test_trip_delay_summary_5m_counts_on_time_band() -> None:
    sql = str(rollups.UPSERT_TRIP_DELAY_SUMMARY_5M)
    assert "on_time_observation_count" in sql
    assert "COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer" in sql
    assert "on_time_observation_count = EXCLUDED.on_time_observation_count" in sql


def test_trip_delay_summary_5m_persists_severe_count() -> None:
    sql = str(rollups.UPSERT_TRIP_DELAY_SUMMARY_5M)
    severe_threshold = getattr(rollups, "SEVERE_DELAY_SECONDS", 300)
    compact = " ".join(sql.split())

    assert "severe_delay_observation_count" in sql
    assert "COUNT(*) FILTER" in compact
    assert f"delay_seconds > {severe_threshold} AND ABS(delay_seconds) <= 3600" in compact
    assert ")::integer" in compact
    assert (
        "severe_delay_observation_count = "
        "EXCLUDED.severe_delay_observation_count"
    ) in sql


def test_route_delay_hourly_carries_observation_unit_counts() -> None:
    sql = str(rollups.UPSERT_ROUTE_DELAY_HOURLY)
    compact = " ".join(sql.split())
    assert "SUM(delay_observation_count)::integer AS delay_observation_count" in sql
    assert (
        "CASE WHEN COUNT(*) = COUNT(on_time_observation_count) "
        "THEN SUM(on_time_observation_count)::integer END AS on_time_observation_count"
    ) in compact
    assert "delay_observation_count" in sql
    assert "on_time_observation_count" in sql


def test_trip_delay_summary_5m_writes_capped_max() -> None:
    sql = str(rollups.UPSERT_TRIP_DELAY_SUMMARY_5M)

    assert "max_delay_seconds_capped" in sql
    assert "MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600)" in sql
    assert "max_delay_seconds_capped = EXCLUDED.max_delay_seconds_capped" in sql


def test_route_delay_hourly_avg_uses_capped_column() -> None:
    sql = str(rollups.UPSERT_ROUTE_DELAY_HOURLY)

    assert "avg_delay_seconds_capped * NULLIF(delay_observation_count - outlier_count, 0)" in sql
    assert "NULLIF(SUM(delay_observation_count - outlier_count), 0)" in sql
    assert "SUM(avg_delay_seconds * " not in sql


def test_route_delay_hourly_max_uses_capped_column() -> None:
    sql = str(rollups.UPSERT_ROUTE_DELAY_HOURLY)

    assert "MAX(max_delay_seconds_capped)" in sql
    assert "MAX(max_delay_seconds)" not in sql


def test_trip_delay_summary_5m_severe_excludes_outliers() -> None:
    sql = " ".join(str(rollups.UPSERT_TRIP_DELAY_SUMMARY_5M).split())

    assert "delay_seconds > 300 AND ABS(delay_seconds) <= 3600" in sql


def test_route_delay_day_of_week_uses_durable_capped_hourly_inputs() -> None:
    sql = str(rollups.UPSERT_ROUTE_DELAY_DAY_OF_WEEK)

    assert "FROM gold.route_delay_hourly" in sql
    assert "fact_trip_delay_snapshot" not in sql
    assert "SUM(rd.severe_delay_count)" in sql
    assert (
        "Hourly-distinct-trip sum: upper-bound proxy, "
        "not distinct trips per weekday."
    ) in sql
    assert "rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0)" in sql
    assert "NULLIF(SUM(rd.delay_observation_count), 0)" in sql
    assert "rd.avg_delay_seconds * NULLIF(rd.observation_count, 0)" not in sql


def test_route_delay_hourly_severe_single_sourced_from_5m() -> None:
    sql = str(rollups.UPSERT_ROUTE_DELAY_HOURLY)

    assert "FROM gold.fact_trip_delay_snapshot" not in sql
    assert "LEFT JOIN" not in sql
    assert "severe_delay_observation_count" in sql
    assert ":open_window_days" in sql


def test_windowed_cutoffs_share_hour_aligned_expression() -> None:
    cutoff = getattr(rollups, "OPEN_WINDOW_HOURLY_CUTOFF_SQL", "")

    assert "date_trunc('hour', CAST(:built_at_utc" in cutoff
    for table_name in ("route_delay_hourly", "stop_delay_hourly"):
        delete_sql = str(rollups.DELETE_REPORTING_AGGREGATES[table_name])
        upsert_sql = str(rollups.REPORTING_AGGREGATE_UPSERTS[table_name])
        assert cutoff in delete_sql
        assert cutoff in upsert_sql


def test_windowed_history_inserts_have_no_on_conflict() -> None:
    for table_name in (
        "route_delay_hourly",
        "stop_delay_hourly",
        "citizen_accountability_daily",
    ):
        assert "ON CONFLICT" not in str(rollups.REPORTING_AGGREGATE_UPSERTS[table_name])

    assert "ON CONFLICT" in str(rollups.UPSERT_TRIP_DELAY_SUMMARY_5M)
    assert "ON CONFLICT" in str(rollups.UPSERT_ROUTE_RELIABILITY_WEEKLY)


def test_stop_delay_hourly_scoped_to_open_window() -> None:
    cutoff = getattr(rollups, "OPEN_WINDOW_HOURLY_CUTOFF_SQL", "")
    sql = str(rollups.UPSERT_STOP_DELAY_HOURLY)

    assert cutoff
    assert cutoff in sql
    assert cutoff in str(rollups.DELETE_REPORTING_AGGREGATES["stop_delay_hourly"])
    assert "LEFT JOIN gold.route_delay_hourly" in sql
    assert "ON CONFLICT" not in sql


def test_citizen_accountability_rebuilds_only_open_local_dates() -> None:
    sql = str(rollups.UPSERT_CITIZEN_ACCOUNTABILITY_DAILY)
    delete_sql = str(rollups.DELETE_REPORTING_AGGREGATES["citizen_accountability_daily"])

    assert "cutoff AS" in sql
    assert "min_local_date" in sql
    assert "provider_local_date >= (SELECT min_local_date FROM cutoff)" in sql
    assert "i3_alert_daily" in sql
    assert "provider_local_date >= (SELECT min_local_date FROM cutoff)" in sql
    assert "provider_local_date >=" in delete_sql
    assert "timezone(dp.timezone, CAST(:built_at_utc AS timestamptz))" in delete_sql
    assert "ON CONFLICT" not in sql


def test_repeat_offender_obs_excludes_outlier_delays() -> None:
    sql = str(rollups.UPSERT_REPEAT_OFFENDER_DAILY)

    assert "AND ABS(f.delay_seconds) <= 3600" in sql
    assert sql.index("AND ABS(f.delay_seconds) <= 3600") < sql.index("agg AS")


def test_route_reliability_weekly_monthly_carry_otp_counts_and_weights() -> None:
    for sql in (
        str(rollups.UPSERT_ROUTE_RELIABILITY_WEEKLY),
        str(rollups.UPSERT_ROUTE_RELIABILITY_MONTHLY),
    ):
        compact = " ".join(sql.split())
        assert "SUM(rd.delay_observation_count)::integer" in sql
        assert (
            "CASE WHEN COUNT(*) = COUNT(rd.on_time_observation_count) "
            "THEN SUM(rd.on_time_observation_count)::integer END"
        ) in compact
        assert "rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0)" in sql
        assert "delay_observation_count = EXCLUDED.delay_observation_count" in sql
        assert "on_time_observation_count = EXCLUDED.on_time_observation_count" in sql


def test_historic_daily_marts_registered_in_registry() -> None:
    """P2/P3 HISTORIC marts are wired into all three rollups registries."""
    from transit_ops.gold import rollups

    for table_name in ("route_headway_daily", "repeat_offender_daily"):
        assert table_name in rollups.REPORTING_AGGREGATE_TABLES
        assert table_name in rollups.REPORTING_AGGREGATE_UPSERTS
        assert table_name in rollups.DELETE_REPORTING_AGGREGATES
        # DELETE is scoped to the provider (delete-then-rebuild semantics).
        delete_sql = str(rollups.DELETE_REPORTING_AGGREGATES[table_name])
        assert f"DELETE FROM gold.{table_name}" in delete_sql
        assert "provider_id = :provider_id" in delete_sql


def test_route_headway_daily_upsert_shape() -> None:
    """P2 observed-headway mart: median trip-gap per route/shift over 14d."""
    from transit_ops.gold import rollups

    sql = str(rollups.REPORTING_AGGREGATE_UPSERTS["route_headway_daily"])

    assert "INSERT INTO gold.route_headway_daily" in sql
    assert "FROM gold.fact_trip_delay_snapshot" in sql
    assert "gold.dim_provider" in sql
    # Observed headway = median of successive distinct-trip first-seen gaps.
    assert "percentile_cont(0.5)" in sql
    assert "LAG(first_seen)" in sql
    assert "interval '14 days'" in sql
    # Only observed_headway_min + sample_count populated; the other cols stay NULL.
    assert "observed_headway_min" in sql
    assert "sample_count" in sql
    assert "scheduled_headway_min" not in sql
    assert "excess_wait_min" not in sql
    # Shift buckets.
    for shift in ("am_peak", "midday", "pm_peak", "evening", "night"):
        assert f"'{shift}'" in sql
    # Gap sanity filter.
    assert "gap_min < 240" in sql
    assert "ON CONFLICT (provider_id, route_id, shift)" in sql


def test_repeat_offender_daily_upsert_shape() -> None:
    """P3 repeat-offender mart: trips + vehicles with >=3 severe-delay days in 14d."""
    from transit_ops.gold import rollups

    sql = str(rollups.REPORTING_AGGREGATE_UPSERTS["repeat_offender_daily"])

    assert "INSERT INTO gold.repeat_offender_daily" in sql
    assert "FROM gold.fact_trip_delay_snapshot" in sql
    assert "gold.dim_provider" in sql
    assert "interval '14 days'" in sql
    # Two entity kinds via UNION ALL.
    assert "'trip'::text" in sql
    assert "'vehicle'::text" in sql
    assert "UNION ALL" in sql
    assert "vehicle_id IS NOT NULL" in sql
    # Severe-delay day = delay_seconds > 300, distinct local day.
    assert "COUNT(DISTINCT local_day) FILTER (WHERE delay_seconds > 300)" in sql
    # Only repeat offenders kept.
    assert "WHERE recurrence_days >= 3" in sql
    # Severity tiers.
    assert "'critical'" in sql
    assert "'high'" in sql
    assert "'watch'" in sql
    assert "recurrence_days >= 10 OR avg_delay_seconds > 600" in sql
    assert "ON CONFLICT (provider_id, entity_kind, entity_id, route_id)" in sql


def test_build_warm_rollups_result_display_dict() -> None:
    conn = FakeConnection(vehicle_periods=[datetime(2026, 3, 25, 12, 0, tzinfo=UTC)])
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)
    d = result.display_dict()

    assert d["provider_id"] == "stm"
    assert d["built_vehicle_periods"] == 1
    assert d["since_utc"] is None
    assert d["reporting_aggregate_row_counts"] == {
        table_name: rowcount
        for table_name, rowcount in BUILD_REPORTING_AGGREGATE_ROWCOUNTS.items()
    }
    assert "completed_at_utc" in d


def test_prune_warm_rollup_storage_deletes_old_periods() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)
    settings = _fake_settings()

    result = prune_warm_rollup_storage("stm", settings=settings, engine=engine)

    assert isinstance(result, WarmRollupStoragePruneResult)
    assert result.provider_id == "stm"
    assert result.retention_days == 90
    assert result.cutoff_utc is not None

    vehicle_deletes = [s for s in conn.executed if "DELETE FROM gold.vehicle_summary_5m" in s]
    assert len(vehicle_deletes) == 1

    delay_deletes = [s for s in conn.executed if "DELETE FROM gold.trip_delay_summary_5m" in s]
    assert len(delay_deletes) == 1

    period_deletes = [s for s in conn.executed if "DELETE FROM gold.warm_rollup_periods" in s]
    assert len(period_deletes) == 1

    assert result.deleted_row_counts["gold.vehicle_summary_5m"] == 5
    assert result.deleted_row_counts["gold.trip_delay_summary_5m"] == 3
    assert result.deleted_row_counts["gold.warm_rollup_periods"] == 8


def test_prune_warm_rollup_storage_dry_run_counts_without_deletes() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)
    settings = _fake_settings()

    result = prune_warm_rollup_storage("stm", settings=settings, engine=engine, dry_run=True)

    assert result.dry_run is True
    assert result.deleted_row_counts["gold.vehicle_summary_5m"] == 5
    assert result.deleted_row_counts["gold.trip_delay_summary_5m"] == 3
    assert result.deleted_row_counts["gold.warm_rollup_periods"] == 8
    for table_name, expected_count in REPORTING_AGGREGATE_ROWCOUNTS.items():
        assert result.deleted_row_counts[f"gold.{table_name}"] == expected_count

    deletes = [s for s in conn.executed if "DELETE FROM gold." in s]
    assert deletes == []

    count_queries = [s for s in conn.executed if "SELECT COUNT(*)" in s or "SELECT count(*)" in s]
    assert len(count_queries) == 13


def test_prune_warm_rollup_storage_display_dict_includes_dry_run() -> None:
    result = WarmRollupStoragePruneResult(
        provider_id="stm",
        dry_run=True,
        retention_days=90,
        cutoff_utc=datetime(2026, 3, 1, tzinfo=UTC),
        deleted_row_counts={
            "gold.vehicle_summary_5m": 5,
            "gold.trip_delay_summary_5m": 3,
            "gold.warm_rollup_periods": 8,
        },
        completed_at_utc=datetime(2026, 3, 27, tzinfo=UTC),
    )

    assert result.display_dict()["dry_run"] is True
