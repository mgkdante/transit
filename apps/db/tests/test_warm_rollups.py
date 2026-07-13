from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, date, datetime

import pytest

from transit_ops.gold import rollups
from transit_ops.gold.rollups import (
    REBUILDABLE_KINDS,
    WarmRollupBuildResult,
    WarmRollupRebuildResult,
    build_warm_rollups,
    rebuild_warm_rollups,
)
from transit_ops.maintenance import WarmRollupStoragePruneResult, prune_warm_rollup_storage
from transit_ops.maintenance.gold import (
    GOLD_AGGREGATE_RETENTION_COLUMNS,
    GOLD_APPEND_ONLY_DAILY_TABLES,
)
from transit_ops.settings import Settings

# Tables pruned by prune_warm_rollup_storage (maintenance.py retention registry).
# These daily marts (route_headway_by_shift, repeat_offender) are full-rebuilt
# each run and are NOT time-window pruned, so they are intentionally absent here.
REPORTING_AGGREGATE_TABLES = (
    "route_delay_hourly",
    "stop_delay_hourly",
    # route_habit_score DROPPED (migration 0076, S14) — recomposed at read time.
    "repeated_problem_route_stop",
    "citizen_accountability_daily",
)

# Tables rebuilt by build_warm_rollups (rollups.py REPORTING_AGGREGATE_TABLES).
# Superset of the prune registry — adds the rolling tables (headway + offender +
# per-direction headway) that are full-rebuilt each cycle but not time-pruned.
BUILD_REPORTING_AGGREGATE_TABLES = (
    *REPORTING_AGGREGATE_TABLES,
    "route_headway_by_shift",
    "repeat_offender",
    "route_headway_by_direction_shift",
)

REPORTING_AGGREGATE_ROWCOUNTS = {
    table_name: index
    for index, table_name in enumerate(REPORTING_AGGREGATE_TABLES, start=10)
}

BUILD_REPORTING_AGGREGATE_ROWCOUNTS = {
    table_name: index
    for index, table_name in enumerate(BUILD_REPORTING_AGGREGATE_TABLES, start=10)
}

# Deterministic ROW-DELETE counts for the append-only daily tables that lack a
# DELETE branch above (the crowding/spine tables already return 13/16/9/4). Used
# only by rebuild_warm_rollups tests.
REBUILD_ROW_DELETE_ROWCOUNTS = {
    "route_delay_percentile_daily": 3,
    "stop_delay_percentile_daily": 5,
    "route_cancellation_daily": 6,
    "route_occupancy_band_daily": 7,
    "stop_occupancy_band_daily": 8,
    "route_service_span_daily": 11,
    "route_skipped_stop_daily": 12,
}


class RowcountResult:
    def __init__(self, rowcount: int) -> None:
        self.rowcount = rowcount


class ScalarResult:
    def __init__(self, value: int) -> None:
        self.value = value

    def scalar_one(self) -> int:
        return self.value


class ScalarOrNoneResult:
    """Result for the cheap provider_is_seeded EXISTS probe.

    scalar_one_or_none() returns 1 when the provider has a gold.dim_provider
    row, None when it does not (the enrolled-but-unseeded case).
    """

    def __init__(self, value: int | None) -> None:
        self.value = value

    def scalar_one_or_none(self) -> int | None:
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


class FakeMissingDayRow:
    """A day yielded by the append-only missing-day SELECT (local_date + date_key)."""

    def __init__(self, local_date, date_key: int) -> None:  # noqa: ANN001
        self.local_date = local_date
        self.date_key = date_key


class FakeConnection:
    def __init__(
        self,
        vehicle_periods: list[datetime] | None = None,
        trip_delay_periods: list[datetime] | None = None,
        occupancy_periods: list[datetime] | None = None,
        seeded: bool = True,
        rebuild_missing_days: list[FakeMissingDayRow] | None = None,
    ) -> None:
        self.vehicle_periods = vehicle_periods or []
        self.trip_delay_periods = trip_delay_periods or []
        self.occupancy_periods = occupancy_periods or []
        # Default seeded=True so every pre-existing test exercises the normal
        # (gold.dim_provider row present) path EXACTLY as before.
        self.seeded = seeded
        # When set, the append-only missing-day SELECTs return these rows instead
        # of the default empty list — so rebuild_warm_rollups actually rebuilds
        # (runs the SET LOCAL + upsert + watermark) and its ordering is testable.
        self.rebuild_missing_days = rebuild_missing_days
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql = str(statement)
        self.executed.append(sql)

        # Cheap provider_is_seeded EXISTS probe (SELECT 1 ... LIMIT 1). Shares
        # the gold.dim_provider table but, unlike the calendar read below, has no
        # "AT TIME ZONE" — match it FIRST so it never falls through to that branch.
        if "gold.dim_provider" in sql and "AT TIME ZONE" not in sql and "LIMIT 1" in sql:
            return ScalarOrNoneResult(1 if self.seeded else None)

        # Provider-local "today" read that anchors the append-only daily-builder
        # snapshot_date_key window.
        if "gold.dim_provider" in sql and "AT TIME ZONE" in sql:
            return ScalarResult(datetime(2026, 3, 26, tzinfo=UTC).date())

        # Occupancy 5m missing-periods SELECT shares the vehicle-fact + DATE_BIN
        # shape; disambiguated by its rollup_kind literal, matched FIRST.
        if (
            "fact_vehicle_snapshot" in sql
            and "occupancy_summary_5m" in sql
            and "NOT IN" in sql
            and "DATE_BIN" in sql
        ):
            return IterableResult([FakeRow(p) for p in self.occupancy_periods])

        if (
            "fact_vehicle_snapshot" in sql
            and "warm_rollup_periods" in sql
            and "NOT IN" in sql
            and "DATE_BIN" in sql
        ):
            return IterableResult([FakeRow(p) for p in self.vehicle_periods])

        if (
            "fact_trip_delay_snapshot" in sql
            and "warm_rollup_periods" in sql
            and "NOT IN" in sql
            and "DATE_BIN" in sql
        ):
            return IterableResult([FakeRow(p) for p in self.trip_delay_periods])

        # Append-only daily missing-days SELECTs (no DATE_BIN; sargable
        # snapshot_date_key window minus the warm_rollup_periods watermark).
        # Default to no missing days so the daily loops are noops here —
        # correctness is covered by the real-DB regression tests. The trip-delay
        # branch also serves the cancellation/service-span/skipped-stop rollups
        # (same source); occupancy uses its own fact_vehicle_snapshot calendar.
        if (
            "fact_vehicle_snapshot" in sql
            and "snapshot_date_key" in sql
            and "warm_rollup_periods" in sql
            and "INSERT" not in sql
        ):
            if self.rebuild_missing_days is not None:
                return IterableResult(list(self.rebuild_missing_days))
            return IterableResult([])

        if (
            "fact_trip_delay_snapshot" in sql
            and "snapshot_date_key" in sql
            and "warm_rollup_periods" in sql
            and "INSERT" not in sql
        ):
            if self.rebuild_missing_days is not None:
                return IterableResult(list(self.rebuild_missing_days))
            return IterableResult([])

        if "INSERT INTO gold.vehicle_summary_5m" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.trip_delay_summary_5m" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.occupancy_summary_5m" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_delay_percentile_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.stop_delay_percentile_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_scheduled_trips_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_cancellation_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_occupancy_band_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_occupancy_band_hourly" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.stop_occupancy_band_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_service_span_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_skipped_stop_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_delay_by_crowding_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_delay_spine" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.route_headway_shift_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.stop_delay_spine" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.stop_delay_shift_daily" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.warm_rollup_periods" in sql:
            return RowcountResult(1)

        # repeat_offender_daily_spine — S14 append-only per-entity offender spine (0075), 730d
        # pruning. MATCHED FIRST: its name shares the `repeat_offender` prefix with the scalar
        # mart, so the generic BUILD_REPORTING_AGGREGATE_ROWCOUNTS substring loop below would
        # otherwise mis-attribute this spine's COUNT/DELETE to the mart.
        if "SELECT COUNT(*)" in sql and "FROM gold.repeat_offender_daily_spine" in sql:
            return ScalarResult(6)

        if "DELETE FROM gold.repeat_offender_daily_spine" in sql:
            return RowcountResult(6)

        # Retained alert archive is lifecycle-managed beside (not inside) the
        # aggregate registry, so its dry-run COUNT needs the scalar-result seam.
        if "SELECT COUNT(*)" in sql and "FROM gold.alert_archive_entry" in sql:
            return ScalarResult(2)

        if "DELETE FROM gold.alert_archive_entry" in sql:
            return RowcountResult(2)

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

        # Windowed watermark DELETE for rebuild_warm_rollups — MORE SPECIFIC than
        # the retention-prune's generic `DELETE FROM gold.warm_rollup_periods`
        # below, so it must be matched FIRST.
        if (
            "DELETE FROM gold.warm_rollup_periods" in sql
            and "rollup_kind = :rollup_kind" in sql
        ):
            return RowcountResult(2)

        # Windowed watermark COUNT (rebuild dry-run) — same rollup_kind guard.
        if (
            "SELECT COUNT(*)" in sql
            and "FROM gold.warm_rollup_periods" in sql
            and "rollup_kind = :rollup_kind" in sql
        ):
            return ScalarResult(2)

        # Append-only ROW DELETE/COUNT for rebuild_warm_rollups. The 4 crowding/
        # spine tables have dedicated DELETE + COUNT branches above; the remaining
        # 7 REBUILD_ROW_DELETE_ROWCOUNTS tables dispatch through this loop.
        for table_name in REBUILD_ROW_DELETE_ROWCOUNTS:
            if f"DELETE FROM gold.{table_name}" in sql:
                return RowcountResult(REBUILD_ROW_DELETE_ROWCOUNTS[table_name])

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

        if ("SELECT COUNT(*)" in sql or "SELECT count(*)" in sql) and (
            "FROM gold.route_delay_percentile_daily" in sql
        ):
            return ScalarResult(7)

        if ("SELECT COUNT(*)" in sql or "SELECT count(*)" in sql) and (
            "FROM gold.stop_delay_percentile_daily" in sql
        ):
            return ScalarResult(11)

        if "SELECT COUNT(*)" in sql and "FROM gold.occupancy_summary_5m" in sql:
            return ScalarResult(6)

        if "SELECT COUNT(*)" in sql and "FROM gold.route_cancellation_daily" in sql:
            return ScalarResult(9)

        if "SELECT COUNT(*)" in sql and "FROM gold.route_occupancy_band_daily" in sql:
            return ScalarResult(10)

        if "SELECT COUNT(*)" in sql and "FROM gold.route_occupancy_band_hourly" in sql:
            return ScalarResult(17)

        if "SELECT COUNT(*)" in sql and "FROM gold.stop_occupancy_band_daily" in sql:
            return ScalarResult(15)

        if "SELECT COUNT(*)" in sql and "FROM gold.route_service_span_daily" in sql:
            return ScalarResult(12)

        if "SELECT COUNT(*)" in sql and "FROM gold.route_skipped_stop_daily" in sql:
            return ScalarResult(14)

        if "SELECT COUNT(*)" in sql and "FROM gold.route_delay_by_crowding_daily" in sql:
            return ScalarResult(13)

        if "DELETE FROM gold.route_delay_by_crowding_daily" in sql:
            return RowcountResult(13)

        if "SELECT COUNT(*)" in sql and "FROM gold.route_delay_spine" in sql:
            return ScalarResult(16)

        if "DELETE FROM gold.route_delay_spine" in sql:
            return RowcountResult(16)

        if "SELECT COUNT(*)" in sql and "FROM gold.route_headway_shift_daily" in sql:
            return ScalarResult(9)

        if "DELETE FROM gold.route_headway_shift_daily" in sql:
            return RowcountResult(9)

        if "SELECT COUNT(*)" in sql and "FROM gold.stop_delay_spine" in sql:
            return ScalarResult(4)

        if "DELETE FROM gold.stop_delay_spine" in sql:
            return RowcountResult(4)

        if "SELECT COUNT(*)" in sql and "FROM gold.stop_delay_shift_daily" in sql:
            return ScalarResult(5)

        if "DELETE FROM gold.stop_delay_shift_daily" in sql:
            return RowcountResult(5)

        # route_scheduled_trips_daily — GC2/H1 append-only scheduled universe (0073), 730d pruning.
        if "SELECT COUNT(*)" in sql and "FROM gold.route_scheduled_trips_daily" in sql:
            return ScalarResult(17)

        if "DELETE FROM gold.route_scheduled_trips_daily" in sql:
            return RowcountResult(17)

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


def test_build_trip_delay_rollup_inserts_new_periods() -> None:
    periods = [
        datetime(2026, 3, 25, 8, 0, tzinfo=UTC),
        datetime(2026, 3, 25, 8, 5, tzinfo=UTC),
        datetime(2026, 3, 25, 8, 10, tzinfo=UTC),
    ]
    conn = FakeConnection(trip_delay_periods=periods)
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.built_trip_delay_periods == 3

    delay_upserts = [s for s in conn.executed if "INSERT INTO gold.trip_delay_summary_5m" in s]
    assert len(delay_upserts) == 3

    period_upserts = [s for s in conn.executed if "INSERT INTO gold.warm_rollup_periods" in s]
    assert len(period_upserts) == 3


def test_build_warm_rollups_empty_facts_is_noop() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.built_trip_delay_periods == 0
    assert result.built_route_cancellation_days == 0
    assert result.built_route_occupancy_days == 0
    assert result.built_stop_occupancy_days == 0
    assert result.built_route_service_span_days == 0
    assert result.built_route_skipped_stop_days == 0
    assert isinstance(result.completed_at_utc, datetime)


def test_provider_is_seeded_true_when_dim_provider_row_present() -> None:
    """The EXISTS probe returns True when scalar_one_or_none yields a row."""
    conn = FakeConnection(seeded=True)

    assert rollups.provider_is_seeded(conn, "stm") is True
    probe = conn.executed[-1]
    assert "gold.dim_provider" in probe
    assert "LIMIT 1" in probe
    # Never the crash-prone scalar_one calendar read.
    assert "AT TIME ZONE" not in probe


def test_provider_is_seeded_false_when_dim_provider_row_absent() -> None:
    """An enrolled-but-unseeded provider (no dim_provider row) probes False —
    WITHOUT raising (scalar_one_or_none, never scalar_one)."""
    conn = FakeConnection(seeded=False)

    assert rollups.provider_is_seeded(conn, "octranspo") is False


def test_build_warm_rollups_skips_unseeded_provider_cleanly() -> None:
    """The crash-site guard: an enrolled-but-unseeded provider must return a
    skipped result (NOT raise NoResultFound on the dp.timezone calendar read)
    so the all-providers Daily Warm Rollups run never aborts on it."""
    conn = FakeConnection(
        vehicle_periods=[datetime(2026, 3, 25, 12, 0, tzinfo=UTC)],
        seeded=False,
    )
    engine = FakeEngine(conn)

    result = build_warm_rollups("octranspo", engine=engine)

    assert isinstance(result, WarmRollupBuildResult)
    assert result.provider_id == "octranspo"
    assert result.skipped_not_seeded is True
    assert result.display_dict()["skipped_not_seeded"] is True
    # Nothing was built or rebuilt.
    assert result.built_trip_delay_periods == 0
    assert result.reporting_aggregate_row_counts == {}

    # The function short-circuited after the seed probe: it never ran the
    # calendar read, any 5m upsert, or any reporting-aggregate DELETE/INSERT.
    assert all("AT TIME ZONE" not in s for s in conn.executed)
    assert all("INSERT INTO gold.trip_delay_summary_5m" not in s for s in conn.executed)
    assert all("DELETE FROM gold." not in s for s in conn.executed)


def test_build_warm_rollups_seeded_provider_unchanged_regression() -> None:
    """Regression guard: a SEEDED provider builds EXACTLY as before — the seed
    probe is a transparent pass-through, never a skip."""
    periods = [
        datetime(2026, 3, 25, 12, 0, tzinfo=UTC),
        datetime(2026, 3, 25, 12, 5, tzinfo=UTC),
    ]
    conn = FakeConnection(vehicle_periods=periods, seeded=True)
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.skipped_not_seeded is False
    # Seeded path still runs the calendar read and the reporting-aggregate rebuild.
    assert any("AT TIME ZONE" in s for s in conn.executed)
    assert result.reporting_aggregate_row_counts == dict(BUILD_REPORTING_AGGREGATE_ROWCOUNTS)


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
    # route_delay_hourly still builds from the 5m rollup (the mart is kept for the
    # public_route_reliability_daily view — see the GC1 / Step G1 blocker note).
    assert any("FROM gold.trip_delay_summary_5m" in statement for statement in aggregate_inserts)
    assert any("FROM gold.fact_trip_delay_snapshot" in statement for statement in aggregate_inserts)
    assert all(
        "FROM gold.fact_vehicle_snapshot" not in statement
        for statement in aggregate_inserts
    )
    # GC1 / Step G1: the habit + accountability marts re-pointed onto gold.route_delay_spine
    # (network trend/receipts read the spine in the historic builders), so no reporting
    # aggregate reads route_delay_hourly anymore even though the mart itself is still built.
    assert all("FROM gold.route_delay_hourly" not in statement for statement in aggregate_inserts)
    assert any("gold.route_delay_spine" in statement for statement in aggregate_inserts)
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
    # GC1 / Step G1: readers re-pointed off route_delay_hourly onto the spine; the mart +
    # its UPSERT stay built for the public_route_reliability_daily view (drop = GC1.5).
    # marts re-point onto gold.route_delay_spine (an append-only reporting surface).
    # route_habit_score DROPPED (migration 0076, S14): no upsert to assert — the scalar
    # habits matrix recomposes the reconciled score from the spine at read time.
    acct_sql = str(rollups.REPORTING_AGGREGATE_UPSERTS["citizen_accountability_daily"])
    assert "FROM gold.route_delay_spine" in acct_sql
    assert "route_habit_score" not in rollups.REPORTING_AGGREGATE_UPSERTS


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


def test_stop_delay_hourly_aggregates_real_per_stop_delays() -> None:
    sql = str(rollups.REPORTING_AGGREGATE_UPSERTS["stop_delay_hourly"])
    compact = " ".join(sql.split())

    assert "FROM gold.fact_trip_delay_snapshot AS f" in sql
    assert "f.delay_stop_id" in sql
    assert "date_trunc('hour', f.captured_at_utc)" in sql
    assert "f.delay_seconds IS NOT NULL" in sql
    assert "ABS(f.delay_seconds) <= 3600" in sql
    assert "delay_seconds > 300 AND ABS(f.delay_seconds) <= 3600" in compact
    assert "ROUND(AVG(f.delay_seconds::numeric), 2)" in sql
    assert "COUNT(*)::integer" in sql
    assert "ON CONFLICT" not in sql
    assert "fact_vehicle_snapshot" not in sql
    assert "route_delay_hourly" not in sql
    assert "max_delay_seconds" not in sql
    assert "THEN sa.observation_count" not in sql


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
    assert "ON CONFLICT" in str(rollups.UPSERT_REPEATED_PROBLEM_ROUTE_STOP)


def test_stop_delay_hourly_scoped_to_open_window() -> None:
    cutoff = getattr(rollups, "OPEN_WINDOW_HOURLY_CUTOFF_SQL", "")
    sql = str(rollups.UPSERT_STOP_DELAY_HOURLY)

    assert cutoff
    assert cutoff in sql
    assert cutoff in str(rollups.DELETE_REPORTING_AGGREGATES["stop_delay_hourly"])
    assert "FROM gold.fact_trip_delay_snapshot AS f" in sql
    assert "LEFT JOIN gold.route_delay_hourly" not in sql
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


def test_citizen_accountability_does_not_fabricate_zero_or_score_on_no_data() -> None:
    """Truth-audit data-honesty guards on the citizen-accountability rollup.

    1. A LEFT-JOIN miss (no route_daily / stop_daily source row for a date) must
       NOT be coerced to a fabricated 0 — the affected_route_count / affected_stop_count
       projections must select the raw column so a genuine join-miss flows through as
       NULL (a present row still carries its real integer, including a real 0).
    2. rider_impact_score must be NULL when the delay telemetry feeding it is absent
       (neither route_daily nor stop_daily row exists), instead of collapsing to a
       pure alerts*2 composite while otp/avg/severe publish honest-NULL.
    """
    sql = str(rollups.UPSERT_CITIZEN_ACCOUNTABILITY_DAILY)
    compact = " ".join(sql.split())

    # Bug 1: the affected-count projections are now bare columns, NOT COALESCE-to-0.
    assert "COALESCE(r.affected_route_count, 0)," not in compact
    assert "COALESCE(s.affected_stop_count, 0)," not in compact
    assert "r.affected_route_count, s.affected_stop_count," in compact

    # Bug 2: rider_impact_score is guarded so it is NULL when BOTH delay-source
    # rows are absent for the date.
    assert (
        "CASE WHEN r.provider_local_date IS NULL "
        "AND s.provider_local_date IS NULL THEN NULL ELSE LEAST(" in compact
    )
    # The 9999.9999 clamp for real days is unchanged.
    assert "9999.9999" in sql
    # delayed/severe/alert terms still COALESCE-to-0 inside the real-day composite
    # (a present route_daily row means those NULLs are genuinely "no such trips").
    assert "COALESCE(r.delayed_trip_count, 0)" in sql
    assert "COALESCE(r.severe_delay_count, 0)" in sql
    assert "COALESCE(ia.alert_count, 0)" in sql


def test_repeat_offender_obs_excludes_outlier_delays() -> None:
    sql = str(rollups.UPSERT_REPEAT_OFFENDER_DAILY)

    assert "AND ABS(f.delay_seconds) <= 3600" in sql
    assert sql.index("AND ABS(f.delay_seconds) <= 3600") < sql.index("agg AS")


def test_route_cancellation_daily_upsert_dedups_and_keeps_scheduled_in_denominator() -> None:
    """Tier-1 cancellation dedup: a trip-day is a distinct (trip_id, start_date),
    collapsed via MAX so multiple polls of one canceled trip count once; and the
    denominator must NOT filter on trip_schedule_relationship IS NOT NULL — GTFS-RT
    omits the field for scheduled trips, so COALESCE(...,0) treats NULL as a normal
    (non-canceled) trip-day rather than dropping it (would inflate the rate)."""
    sql = str(rollups.UPSERT_ROUTE_CANCELLATION_DAILY)
    compact = " ".join(sql.split())

    assert "INSERT INTO gold.route_cancellation_daily" in sql
    assert "FROM gold.fact_trip_delay_snapshot" in sql
    # Distinct-trip-day grain (per-poll over-count collapse).
    assert "GROUP BY f.provider_id, f.route_id, f.trip_id, f.start_date" in compact
    assert "MAX((COALESCE(f.trip_schedule_relationship, 0) = 3)::int)" in compact
    # The inflating denominator filter must be ABSENT.
    assert "trip_schedule_relationship IS NOT NULL" not in compact
    # Rate is None (NULLIF guard) when no trip-days were observed.
    assert "NULLIF(COUNT(*), 0)" in compact


def test_tier1_daily_rollups_are_append_only_not_in_reporting_registry() -> None:
    """Cancellation + occupancy-band daily tables must stay OUT of the DELETE+UPSERT
    reporting registry (a per-provider rebuild would wipe accrued history)."""
    for table_name in ("route_cancellation_daily", "route_occupancy_band_daily"):
        assert table_name not in rollups.REPORTING_AGGREGATE_TABLES
        assert table_name not in rollups.DELETE_REPORTING_AGGREGATES
    assert "occupancy_summary_5m" not in rollups.REPORTING_AGGREGATE_TABLES


def test_occupancy_band_daily_uses_vehicle_fact_missing_day_calendar() -> None:
    """Adversary fix: the occupancy daily reduction reads fact_vehicle_snapshot, so
    its missing-day watermark calendar must scan that same table — NOT the
    trip-delay fact (the two prune independently)."""
    occ_days = str(rollups.SELECT_MISSING_OCCUPANCY_DAYS)
    assert "FROM gold.fact_vehicle_snapshot" in occ_days
    assert "fact_trip_delay_snapshot" not in occ_days
    # Sargable, indexed snapshot_date_key window (not a full-table timezone scan).
    assert "f.snapshot_date_key >= :floor_key" in occ_days
    assert "f.snapshot_date_key < :today_key" in occ_days


def test_stop_occupancy_band_daily_upsert_keys_on_stop_id_not_null_no_sentinel() -> None:
    """Per-stop occupancy band reduction is a clean mirror of the route version but
    keyed by stop_id. CRITICAL difference: a ping with NULL stop_id cannot be
    attributed to a stop, so the upsert FILTERS stop_id IS NOT NULL and GROUPs on
    the raw stop_id — there is NO __unrouted__-style sentinel bucket. Same band
    FILTERs (code 4 folded into standing), same closed-day source/calendar as the
    route occupancy rollup (fact_vehicle_snapshot + snapshot_date_key)."""
    sql = str(rollups.UPSERT_STOP_OCCUPANCY_BAND_DAILY)
    compact = " ".join(sql.split())

    assert "INSERT INTO gold.stop_occupancy_band_daily" in sql
    assert "FROM gold.fact_vehicle_snapshot AS f" in sql
    # Stop-vs-route: NULL stop_id is excluded, grouped on the raw stop_id.
    assert "f.stop_id IS NOT NULL" in sql
    assert "GROUP BY f.provider_id, f.stop_id" in compact
    # No sentinel bucket — the route mirror's __unrouted__ COALESCE must be ABSENT.
    assert "__unrouted__" not in sql
    assert "__unknown_stop__" not in sql
    assert "COALESCE(f.stop_id" not in sql
    # Same band math as the route mirror (CRUSHED_STANDING folds into standing).
    assert "occupancy_status IN (3, 4)" in sql
    assert "occupancy_status IN (0, 1, 2, 3, 4, 5)" in sql
    # Same closed-day filter + idempotent upsert on the stop PK.
    assert "f.snapshot_date_key = :date_key" in sql
    assert "ON CONFLICT (provider_id, provider_local_date, stop_id)" in sql


def test_stop_occupancy_band_daily_is_append_only_not_in_reporting_registry() -> None:
    """Per-stop occupancy-band daily table must stay OUT of the DELETE+UPSERT
    reporting registry (a per-provider rebuild would wipe accrued history),
    exactly like its route sibling."""
    assert "stop_occupancy_band_daily" not in rollups.REPORTING_AGGREGATE_TABLES
    assert "stop_occupancy_band_daily" not in rollups.DELETE_REPORTING_AGGREGATES


def test_build_warm_rollups_wires_stop_occupancy_and_counts_it() -> None:
    """The stop occupancy daily reduction is wired into build_warm_rollups via
    _build_percentile_days (sourced from fact_vehicle_snapshot, same as the route
    occupancy rollup), and its build count is plumbed through the result + display
    dict on built_stop_occupancy_days (mirror of built_route_occupancy_days).

    Scope of this test: the FakeConn harness only verifies WIRING/DISPATCH (the
    upsert is referenced + reads the right fact) and the COUNTER (present + zero,
    not absent). The fake keeps the daily loops noop (no missing days), so the count
    is 0 here — this does NOT exercise band math against real rows. Band-count
    correctness (the GROUP BY stop_id reduction + share derivation) is verified by
    the offline builder/upsert tests, not by any real-DB occupancy-band regression
    (none exists; one would need a live cluster)."""
    conn = FakeConnection()
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    # Counter plumbed through the dataclass AND the display dict (mirror of route).
    assert result.built_stop_occupancy_days == 0
    assert result.display_dict()["built_stop_occupancy_days"] == 0
    assert "built_route_occupancy_days" in result.display_dict()
    # The stop occupancy upsert is referenced in the build_warm_rollups source and
    # reads the same vehicle fact as the route occupancy rollup.
    assert "INSERT INTO gold.stop_occupancy_band_daily" in str(
        rollups.UPSERT_STOP_OCCUPANCY_BAND_DAILY
    )
    assert "FROM gold.fact_vehicle_snapshot" in str(rollups.UPSERT_STOP_OCCUPANCY_BAND_DAILY)


def test_historic_daily_marts_registered_in_registry() -> None:
    """P2/P3 HISTORIC marts are wired into all three rollups registries."""
    from transit_ops.gold import rollups

    for table_name in ("route_headway_by_shift", "repeat_offender"):
        assert table_name in rollups.REPORTING_AGGREGATE_TABLES
        assert table_name in rollups.REPORTING_AGGREGATE_UPSERTS
        assert table_name in rollups.DELETE_REPORTING_AGGREGATES
        # DELETE is scoped to the provider (delete-then-rebuild semantics).
        delete_sql = str(rollups.DELETE_REPORTING_AGGREGATES[table_name])
        assert f"DELETE FROM gold.{table_name}" in delete_sql
        assert "provider_id = :provider_id" in delete_sql


def test_route_headway_by_shift_upsert_shape() -> None:
    """P2 observed-headway mart: per-direction trip-start gaps over weekdays."""
    from transit_ops.gold import rollups

    sql = str(rollups.REPORTING_AGGREGATE_UPSERTS["route_headway_by_shift"])

    assert "INSERT INTO gold.route_headway_by_shift" in sql
    assert "FROM gold.fact_trip_delay_snapshot" in sql
    assert "gold.dim_provider" in sql
    assert "percentile_cont(0.5)" in sql
    # Fact window is now a bind (:fact_retention_days) so it tracks
    # GOLD_FACT_RETENTION_DAYS instead of a drift-prone literal.
    assert "make_interval(days => :fact_retention_days)" in sql
    assert "observed_headway_min" in sql
    assert "sample_count" in sql
    assert "scheduled_headway_min" not in sql
    assert "excess_wait_min" not in sql
    assert "f.delay_seconds IS NOT NULL" in sql
    assert "ABS(f.delay_seconds) <= 3600" in sql
    assert "COALESCE(f.start_date, f.snapshot_local_date)" in sql
    assert (
        "EXTRACT(ISODOW FROM COALESCE(f.start_date, f.snapshot_local_date)) BETWEEN 1 AND 5"
        in sql
    )
    assert "busiest_direction" in sql
    assert "ORDER BY COUNT(*) DESC, direction_id" in sql
    assert "PARTITION BY provider_id, route_id, direction_id, service_date, shift" in sql
    assert "LAG(trip_start_utc)" in sql
    assert "LAG(first_seen)" not in sql
    assert "f.trip_id IS NOT NULL" in sql
    # Shift buckets.
    for shift in ("am_peak", "midday", "pm_peak", "evening", "night"):
        assert f"'{shift}'" in sql
    # Gap sanity filter.
    assert "gap_min > 0" in sql
    assert "gap_min < 240" in sql
    assert "ON CONFLICT (provider_id, route_id, shift)" in sql
    # Tier-2 regularity ride-along: CoV + bunching, refreshed on conflict.
    assert "stddev_samp(gap_min)" in sql
    assert "headway_cov" in sql
    assert "bunched_count" in sql
    assert "0.5 * a.med_gap" in sql
    assert "headway_cov = EXCLUDED.headway_cov" in sql
    assert "bunched_count = EXCLUDED.bunched_count" in sql


def test_route_service_span_daily_upsert_shape() -> None:
    """Tier-2 service-span: per-route GTFS-SERVICE-DAY first/last + span, append-only.

    FIX-2: grain is route x provider_local_date where provider_local_date is the GTFS service
    day (start_date), built from a 2-day INDEXED capture window so the overnight tail is in;
    last delay reads the LAST trip's TERMINAL (latest-obs) deviation, not its first obs."""
    sql = str(rollups.UPSERT_ROUTE_SERVICE_SPAN_DAILY)
    compact = " ".join(sql.split())

    assert "INSERT INTO gold.route_service_span_daily" in sql
    assert "FROM gold.fact_trip_delay_snapshot" in sql
    assert "MIN(f.captured_at_utc) AS trip_start_utc" in compact
    # FIX-2: re-grain on the GTFS service day (start_date), NOT the capture date.
    assert "f.start_date = (CAST(:local_date AS date) - 1)" in compact
    # FIX-2: 2-day INDEXED window (prev date_key + :date_key) keeps the scan sargable.
    assert "f.snapshot_date_key IN (" in compact
    assert "'YYYYMMDD')::integer, :date_key" in compact
    # FIX-2: the LAST trip's terminal (latest captured) delay, not its first observation.
    assert (
        "ARRAY_AGG(f.delay_seconds ORDER BY f.captured_at_utc DESC, "
        "f.entity_index DESC))[1] AS last_obs_delay" in compact
    )
    assert "MAX(last_obs_delay) FILTER (WHERE rn_last = 1)" in compact
    # span derived from first/last observed trip start.
    assert "MAX(trip_start_utc) - MIN(trip_start_utc)" in compact
    assert "ON CONFLICT (provider_id, provider_local_date, route_id)" in sql


def test_route_skipped_stop_daily_upsert_shape() -> None:
    """Tier-2 skipped-stop: sums the fact-carried skip + stop-update counts per
    closed day; rate = skipped / all stop-time updates (denominator NOT filtered)."""
    sql = str(rollups.UPSERT_ROUTE_SKIPPED_STOP_DAILY)
    compact = " ".join(sql.split())

    assert "INSERT INTO gold.route_skipped_stop_daily" in sql
    assert "FROM gold.fact_trip_delay_snapshot" in sql
    assert "SUM(f.skipped_stop_count)" in compact
    assert "SUM(f.stop_time_update_count)" in compact
    # Rate honest-None when no stop-time updates observed.
    assert "NULLIF(SUM(f.stop_time_update_count), 0)" in compact
    assert "f.snapshot_date_key = :date_key" in compact
    assert "ON CONFLICT (provider_id, provider_local_date, route_id)" in sql


def test_repeat_offender_upsert_shape() -> None:
    """P3 repeat-offender mart: trips + vehicles with >=3 severe-delay days in 14d."""
    from transit_ops.gold import rollups

    sql = str(rollups.REPORTING_AGGREGATE_UPSERTS["repeat_offender"])

    assert "INSERT INTO gold.repeat_offender" in sql
    assert "FROM gold.fact_trip_delay_snapshot" in sql
    assert "gold.dim_provider" in sql
    # Fact window is now a bind (:fact_retention_days) so it tracks
    # GOLD_FACT_RETENTION_DAYS instead of a drift-prone literal.
    assert "make_interval(days => :fact_retention_days)" in sql
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
    conn = FakeConnection(trip_delay_periods=[datetime(2026, 3, 25, 12, 0, tzinfo=UTC)])
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)
    d = result.display_dict()

    assert d["provider_id"] == "stm"
    assert d["built_trip_delay_periods"] == 1
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

    delay_deletes = [s for s in conn.executed if "DELETE FROM gold.trip_delay_summary_5m" in s]
    assert len(delay_deletes) == 1

    period_deletes = [s for s in conn.executed if "DELETE FROM gold.warm_rollup_periods" in s]
    assert len(period_deletes) == 1

    assert result.deleted_row_counts["gold.trip_delay_summary_5m"] == 3
    assert result.deleted_row_counts["gold.warm_rollup_periods"] == 8


def test_prune_warm_rollup_storage_dry_run_counts_without_deletes() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)
    settings = _fake_settings()

    result = prune_warm_rollup_storage("stm", settings=settings, engine=engine, dry_run=True)

    assert result.dry_run is True
    assert result.deleted_row_counts["gold.trip_delay_summary_5m"] == 3
    assert result.deleted_row_counts["gold.warm_rollup_periods"] == 8
    for table_name, expected_count in REPORTING_AGGREGATE_ROWCOUNTS.items():
        assert result.deleted_row_counts[f"gold.{table_name}"] == expected_count

    deletes = [s for s in conn.executed if "DELETE FROM gold." in s]
    assert deletes == []

    assert result.deleted_row_counts["gold.route_delay_percentile_daily"] == 7
    assert result.deleted_row_counts["gold.stop_delay_percentile_daily"] == 11
    # Tier-1 append-only tables prune at the same 730d boundary.
    assert result.deleted_row_counts["gold.route_cancellation_daily"] == 9
    assert result.deleted_row_counts["gold.route_occupancy_band_daily"] == 10
    # GC2/H3 hour-grain crowding spine (0074) — same append-only retention as the daily.
    assert result.deleted_row_counts["gold.route_occupancy_band_hourly"] == 17
    # The per-STOP occupancy-band twin is now registered for retention pruning too
    # (provider_local_date boundary, mirroring route_occupancy_band_daily).
    assert result.deleted_row_counts["gold.stop_occupancy_band_daily"] == 15
    # Tier-2 append-only tables.
    assert result.deleted_row_counts["gold.route_service_span_daily"] == 12
    assert result.deleted_row_counts["gold.route_skipped_stop_daily"] == 14
    # route_delay_spine — the S7-B append-only delay rollup, registered for 365d pruning.
    assert result.deleted_row_counts["gold.route_delay_spine"] == 16
    # route_headway_shift_daily — the S7-B append-only HEADWAY rollup (DB-PR-2), 730d pruning.
    assert result.deleted_row_counts["gold.route_headway_shift_daily"] == 9
    # stop_delay_spine — the S7-B append-only STOP-DELAY rollup (DB-PR-3), 730d pruning.
    assert result.deleted_row_counts["gold.stop_delay_spine"] == 4
    # stop_delay_shift_daily — the GC1/G4 append-only STOP-DELAY shift grain (0071), 730d pruning.
    assert result.deleted_row_counts["gold.stop_delay_shift_daily"] == 5
    # route_scheduled_trips_daily — the GC2/H1 append-only scheduled universe (0073), 730d pruning.
    assert result.deleted_row_counts["gold.route_scheduled_trips_daily"] == 17
    # repeat_offender_daily_spine — the S14 append-only per-entity offender
    # spine (0075), 730d pruning.
    assert result.deleted_row_counts["gold.repeat_offender_daily_spine"] == 6
    assert result.deleted_row_counts["gold.alert_archive_entry"] == 2

    count_queries = [s for s in conn.executed if "SELECT COUNT(*)" in s or "SELECT count(*)" in s]
    # 23 prior MINUS the 6 route delay-cube fold tables (dropped in 0064) MINUS the 2 stop_delay
    # weekly/monthly folds (dropped in 0067) PLUS the S7-B route_headway_shift_daily (DB-PR-2) +
    # stop_delay_spine (DB-PR-3) PLUS the FIX-3 route_delay_by_crowding_daily PLUS the GC1/G4
    # stop_delay_shift_daily (0071) PLUS the GC2/H1 route_scheduled_trips_daily (0073) PLUS the
    # GC2/H3 route_occupancy_band_hourly (0074) PLUS the S14 repeat_offender_daily_spine (0075)
    # MINUS the S14 route_habit_score drop (0076 — no longer retention-registered); each
    # retention-registered table emits one dry-run COUNT.
    assert len(count_queries) == 22


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


# --- S7-B route_delay_spine builder (PR1 Task 2) ---


def test_route_delay_spine_edges_are_the_21_contract_edges() -> None:
    from transit_ops.gold import rollups

    assert rollups.DELAY_HISTOGRAM_EDGES == (
        -3600, -300, -180, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180,
        240, 300, 420, 600, 900, 1800, 3600,
    )
    assert len(rollups.DELAY_HISTOGRAM_EDGES) == 21


def test_route_delay_spine_upsert_shape() -> None:
    from transit_ops.gold import rollups

    sql = str(rollups.UPSERT_ROUTE_DELAY_SPINE)
    compact = " ".join(sql.split())

    assert "INSERT INTO gold.route_delay_spine" in sql
    assert "FROM gold.fact_trip_delay_snapshot" in sql
    assert "f.route_id IS NOT NULL" in sql
    assert "f.snapshot_date_key = :date_key" in compact
    # Finest-grain GROUP BY (hour x direction); provider_local_date = :local_date.
    # GC1 / Step G1: the main aggregation now selects from `binned AS b` LEFT JOIN the
    # per-5m distinct-delayed CTE `delayed AS d`, so the GROUP BY carries the `b.` alias
    # (+ d.delayed_trip_count, functionally dependent on the grain).
    assert ":local_date" in compact
    assert (
        "GROUP BY b.provider_id, b.route_id, b.hour_of_day_local, b.direction_id, "
        "d.delayed_trip_count" in compact
    )
    assert (
        "ON CONFLICT (provider_id, route_id, provider_local_date, "
        "hour_of_day_local, direction_id)" in compact
    )
    # Finding D: unknown direction COALESCEs to 0 (matching the existing directional builder).
    assert "COALESCE(f.direction_id, 0)" in compact
    # Correction #1 / Finding A: the headline-share counts come from the EXACT live
    # delay_seconds predicates, NOT from histogram bins. (GC1 aliased the aggregation
    # source to `b`, so the outer count FILTERs carry the b. prefix.)
    assert "b.delay_seconds >= -60 AND b.delay_seconds < 300" in compact
    assert "b.delay_seconds > 300" in compact
    assert "ABS(b.delay_seconds) <= 3600" in compact
    # The histogram is a SEPARATE 21-bin array via width_bucket (p50/p90 + the chart only).
    assert "width_bucket" in compact
    assert "::smallint[]" in compact
    # GC1 / Step G1: delayed_trip_count is now an additive spine column, computed as the
    # SUM over 5m sub-buckets of COUNT(DISTINCT trip_id) FILTER (delay>0) to reproduce the
    # legacy route_delay_hourly SUM chain byte-for-byte (predicate mirrors the 5m builder:
    # delay_seconds > 0, no ghost clamp).
    assert "delayed_trip_count" in sql
    assert "COUNT(DISTINCT f.trip_id) FILTER (WHERE f.delay_seconds > 0)" in compact
    assert "DATE_BIN('5 minutes', f.captured_at_utc, TIMESTAMPTZ '2000-01-01')" in compact


def test_build_warm_rollups_wires_route_delay_spine_and_counts_it() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.built_route_delay_spine_days == 0
    assert "built_route_delay_spine_days" in result.display_dict()


def test_route_delay_spine_is_append_only_not_in_reporting_registry() -> None:
    from transit_ops.gold import rollups

    assert "route_delay_spine" not in rollups.REPORTING_AGGREGATE_TABLES


def test_build_percentile_days_elevates_workmem_and_disables_nestloop() -> None:
    """Every finest-grain day-build must run under elevated work_mem + enable_nestloop=off.

    Regression gate for the S7-B prod hang: at the 4MB cluster default the per-trip dedup
    sort spilled to disk (external merge), and the un-sargable EXTRACT(isodow ...) / ABS(delay)
    filters' ~600x post-filter row underestimate drove O(n^2) nested-loop joins over the
    materialized CTEs -> route_headway_shift_daily hung ~45 min/day (the deploy blocker).
    The fix issues both GUCs (SET LOCAL, transaction-scoped) before each day's upsert; on prod
    EXPLAIN ANALYZE the headway day-build then runs ~9 s in-memory. Asserting the statements
    are issued -- in order, before the upsert, inside the per-day transaction -- guards the fix
    from silent removal. Mirrors migration 0034's heavy-build session tuning.
    """
    from datetime import date

    from sqlalchemy import text as _text

    from transit_ops.gold import rollups

    class _Row:
        local_date = date(2026, 6, 26)
        date_key = 20260626

    class _Conn:
        def __init__(self) -> None:
            self.executed: list[str] = []

        def execute(self, statement, params=None):  # noqa: ANN001, ANN206
            self.executed.append(str(statement))

            class _Result:
                @staticmethod
                def fetchall() -> list:
                    return [_Row()]

            return _Result()

    class _Engine:
        def __init__(self) -> None:
            self.conn = _Conn()

        @contextmanager
        def begin(self):  # noqa: ANN202
            yield self.conn

    engine = _Engine()
    sentinel = _text("INSERT INTO gold.route_headway_shift_daily /* sentinel-upsert */ SELECT 1")

    built = rollups._build_percentile_days(
        engine,
        provider_id="stm",
        rollup_kind="route_headway_shift_daily",
        upsert=sentinel,
        today_key=20260627,
        floor_key=20260613,
        now=datetime(2026, 6, 27, tzinfo=UTC),
    )
    assert built == 1

    ex = engine.conn.executed
    workmem_idx = next(i for i, s in enumerate(ex) if "SET LOCAL work_mem" in s)
    nestloop_idx = next(i for i, s in enumerate(ex) if "SET LOCAL enable_nestloop = off" in s)
    upsert_idx = next(i for i, s in enumerate(ex) if "sentinel-upsert" in s)

    # work_mem is lifted off the 4MB cluster default that spilled the dedup sort.
    assert "4MB" not in ex[workmem_idx]
    # Both planner overrides precede the heavy upsert (they only bind inside its transaction).
    assert workmem_idx < upsert_idx
    assert nestloop_idx < upsert_idx


# ---------------------------------------------------------------------------
# rebuild_warm_rollups — windowed correction of present-but-wrong closed days
# ---------------------------------------------------------------------------

# The FakeConnection calendar read yields today_local = 2026-03-26, so the
# fact-retention floor (today - (14 - 1)) is 2026-03-13 and a valid ROW window is
# [2026-03-13, 2026-03-25]. These bounds sit safely inside it.
REBUILD_FROM = date(2026, 3, 20)
REBUILD_TO = date(2026, 3, 22)


def test_rebuildable_kinds_registry_covers_all_append_only_builders() -> None:
    """The registry is the exact set of append-only daily builder kinds, each
    mapped to a real append-only table with a retention date column that matches."""
    expected = {
        "route_percentile_daily",
        "stop_percentile_daily",
        "route_cancellation_daily",
        "route_occupancy_band_daily",
        "route_occupancy_band_hourly",
        "stop_occupancy_band_daily",
        "route_service_span_daily",
        "route_skipped_stop_daily",
        "route_delay_by_crowding_daily",
        "route_delay_spine",
        "route_headway_shift_daily",
        "stop_delay_spine",
        "stop_delay_shift_daily",
        "repeat_offender_daily_spine",
        "route_scheduled_trips_daily",
    }
    assert set(REBUILDABLE_KINDS) == expected

    retention_columns = {
        table_name: (column, date_only)
        for table_name, column, date_only in GOLD_AGGREGATE_RETENTION_COLUMNS
    }
    for kind in REBUILDABLE_KINDS.values():
        assert kind.rollup_kind == kind.rollup_kind  # key == field invariant
        assert f"gold.{kind.table}" in GOLD_APPEND_ONLY_DAILY_TABLES
        column, _date_only = retention_columns[f"gold.{kind.table}"]
        assert kind.date_column == column
    # Only route_service_span_daily carries the run-vs-row service-day offset.
    assert REBUILDABLE_KINDS["route_service_span_daily"].service_day_offset == 1
    for name, kind in REBUILDABLE_KINDS.items():
        if name != "route_service_span_daily":
            assert kind.service_day_offset == 0


def test_rebuild_refuses_reporting_marts_and_5m() -> None:
    """Reporting marts + the 5m rollup are refused with an alternative pointer."""
    conn = FakeConnection()
    engine = FakeEngine(conn)
    with pytest.raises(ValueError, match="build-warm-rollups"):
        rebuild_warm_rollups(
            "stm",
            settings=_fake_settings(),
            engine=engine,
            from_date=REBUILD_FROM,
            to_date=REBUILD_TO,
            kinds=["route_delay_hourly"],
        )
    with pytest.raises(ValueError, match="build-warm-rollups"):
        rebuild_warm_rollups(
            "stm",
            settings=_fake_settings(),
            engine=engine,
            from_date=REBUILD_FROM,
            to_date=REBUILD_TO,
            kinds=["trip_delay_summary_5m"],
        )


def test_rebuild_unknown_kind_rejected() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)
    with pytest.raises(ValueError, match="Unknown rebuildable kind"):
        rebuild_warm_rollups(
            "stm",
            settings=_fake_settings(),
            engine=engine,
            from_date=REBUILD_FROM,
            to_date=REBUILD_TO,
            kinds=["not_a_kind"],
        )


def test_rebuild_refuses_from_after_to() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)
    with pytest.raises(ValueError, match="--from must be on or before --to"):
        rebuild_warm_rollups(
            "stm",
            settings=_fake_settings(),
            engine=engine,
            from_date=REBUILD_TO,
            to_date=REBUILD_FROM,
        )
    # Guardrail runs before any DB access.
    assert conn.executed == []


def test_rebuild_refuses_window_beyond_fact_retention() -> None:
    """A --from older than today - (fact_retention - 1) would rebuild EMPTY days."""
    conn = FakeConnection()
    engine = FakeEngine(conn)
    with pytest.raises(ValueError, match="fact-retention floor"):
        rebuild_warm_rollups(
            "stm",
            settings=_fake_settings(),
            engine=engine,
            from_date=date(2026, 3, 1),  # older than the 2026-03-13 floor
            to_date=date(2026, 3, 2),
        )


def test_rebuild_refuses_window_touching_open_current_day() -> None:
    """For offset-0 kinds --to must be strictly before today_local (still open)."""
    conn = FakeConnection()
    engine = FakeEngine(conn)
    with pytest.raises(ValueError, match="too recent for kind"):
        rebuild_warm_rollups(
            "stm",
            settings=_fake_settings(),
            engine=engine,
            from_date=date(2026, 3, 25),
            to_date=date(2026, 3, 26),  # == today_local
            kinds=["route_percentile_daily"],
        )


def test_rebuild_refuses_offset_kind_run_date_landing_on_today() -> None:
    """route_service_span_daily has service_day_offset=1, so to_date=today-1 maps
    its RUN date onto today_local (the still-open capture day) — must be rejected
    even though a flat to_date < today_local passes."""
    conn = FakeConnection()
    engine = FakeEngine(conn)
    with pytest.raises(ValueError, match="too recent for kind 'route_service_span_daily'"):
        rebuild_warm_rollups(
            "stm",
            settings=_fake_settings(),
            engine=engine,
            from_date=date(2026, 3, 24),
            to_date=date(2026, 3, 25),  # today_local - 1; run date = today
            kinds=["route_service_span_daily"],
        )
    # The max legal --to for an offset-1 kind is today_local - 2.
    with pytest.raises(ValueError, match="Max legal --to for this kind is 2026-03-24"):
        rebuild_warm_rollups(
            "stm",
            settings=_fake_settings(),
            engine=engine,
            from_date=date(2026, 3, 24),
            to_date=date(2026, 3, 25),
            kinds=["route_service_span_daily"],
        )
    # Nothing mutated before the guard raises.
    assert all("DELETE FROM" not in s for s in conn.executed)


def test_rebuild_dry_run_counts_no_deletes() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)
    result = rebuild_warm_rollups(
        "stm",
        settings=_fake_settings(),
        engine=engine,
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        kinds=["route_percentile_daily"],
        dry_run=True,
    )
    assert result.dry_run is True
    assert result.aborted is False
    # Row COUNT reuses the append-only COUNT branch (route_delay_percentile_daily -> 7);
    # watermark COUNT is the windowed rollup_kind branch (-> 2).
    assert result.deleted_row_counts == {"route_percentile_daily": 7}
    assert result.deleted_watermark_counts == {"route_percentile_daily": 2}
    assert result.rebuilt_day_counts == {}
    # Dry-run mutates NOTHING.
    assert all("DELETE FROM" not in s for s in conn.executed)


def test_rebuild_dry_run_does_not_prompt() -> None:
    """--dry-run must never invoke the confirm callback."""
    conn = FakeConnection()
    engine = FakeEngine(conn)
    called = {"n": 0}

    def _confirm(_plan) -> bool:  # noqa: ANN001
        called["n"] += 1
        return True

    rebuild_warm_rollups(
        "stm",
        settings=_fake_settings(),
        engine=engine,
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        kinds=["route_percentile_daily"],
        dry_run=True,
        confirm=_confirm,
    )
    assert called["n"] == 0


def test_rebuild_confirm_declined_aborts() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)
    result = rebuild_warm_rollups(
        "stm",
        settings=_fake_settings(),
        engine=engine,
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        kinds=["route_percentile_daily"],
        confirm=lambda _plan: False,
    )
    assert result.aborted is True
    assert result.deleted_row_counts == {}
    # After the calendar read + guardrails, a declined confirm mutates nothing.
    assert all("DELETE FROM" not in s for s in conn.executed)


def test_rebuild_confirm_plan_carries_per_kind_counts() -> None:
    """When a confirm callback is supplied (no --yes), the plan it receives is
    pre-populated by a dry-run COUNT pass so the prompt can show total rows +
    watermarks per kind."""
    conn = FakeConnection()
    engine = FakeEngine(conn)
    seen: dict[str, dict[str, int]] = {}

    def _confirm(plan) -> bool:  # noqa: ANN001
        seen["rows"] = dict(plan.deleted_row_counts)
        seen["watermarks"] = dict(plan.deleted_watermark_counts)
        return False

    rebuild_warm_rollups(
        "stm",
        settings=_fake_settings(),
        engine=engine,
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        kinds=["route_percentile_daily"],
        confirm=_confirm,
    )
    # route_delay_percentile_daily COUNT branch -> 7; windowed watermark COUNT -> 2.
    assert seen["rows"] == {"route_percentile_daily": 7}
    assert seen["watermarks"] == {"route_percentile_daily": 2}
    # The preview pass is COUNT-only; the declined confirm deletes nothing.
    assert all("DELETE FROM" not in s for s in conn.executed)


def test_rebuild_yes_fast_path_skips_count_pass() -> None:
    """--yes maps to confirm=None: no preview COUNT pass runs, so the plan-count
    SELECTs never execute — only the delete + rebuild statements do."""
    conn = FakeConnection(rebuild_missing_days=[FakeMissingDayRow(date(2026, 3, 20), 20260320)])
    engine = FakeEngine(conn)
    result = rebuild_warm_rollups(
        "stm",
        settings=_fake_settings(),
        engine=engine,
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        kinds=["route_percentile_daily"],
        confirm=None,
    )
    assert result.aborted is False
    # No preview COUNT pass: the only row-table SELECT COUNT would be the dry-run
    # count sql; with confirm=None it must not run.
    assert not any(
        "SELECT COUNT(*) FROM gold.route_delay_percentile_daily" in s for s in conn.executed
    )


def test_rebuild_prompt_renders_per_kind_counts() -> None:
    """_rebuild_prompt surfaces the plan's per-kind rows/watermarks in the text."""
    from transit_ops.cli import _rebuild_prompt

    plan = WarmRollupRebuildResult(
        provider_id="stm",
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        dry_run=False,
        aborted=False,
        completed_at_utc=datetime(2026, 3, 26, tzinfo=UTC),
        deleted_row_counts={"route_percentile_daily": 7},
        deleted_watermark_counts={"route_percentile_daily": 2},
    )
    prompt = _rebuild_prompt(plan)
    assert "route_percentile_daily: 7 rows / 2 watermarks" in prompt
    assert "Continue?" in prompt


def test_rebuild_deletes_rows_then_watermarks_then_rebuilds() -> None:
    """Per kind: row DELETE < watermark DELETE < the rebuild upsert, and the
    _build_percentile_days SET LOCAL tuning precedes the rebuild upsert."""
    missing = [FakeMissingDayRow(date(2026, 3, 20), 20260320)]
    conn = FakeConnection(rebuild_missing_days=missing)
    engine = FakeEngine(conn)
    result = rebuild_warm_rollups(
        "stm",
        settings=_fake_settings(),
        engine=engine,
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        kinds=["route_percentile_daily"],
        confirm=lambda _plan: True,
    )
    assert result.aborted is False
    assert result.deleted_row_counts == {"route_percentile_daily": 3}
    assert result.deleted_watermark_counts == {"route_percentile_daily": 2}
    assert result.rebuilt_day_counts == {"route_percentile_daily": 1}

    ex = conn.executed
    row_delete_idx = next(
        i for i, s in enumerate(ex) if "DELETE FROM gold.route_delay_percentile_daily" in s
    )
    wm_delete_idx = next(
        i
        for i, s in enumerate(ex)
        if "DELETE FROM gold.warm_rollup_periods" in s and "rollup_kind = :rollup_kind" in s
    )
    upsert_idx = next(
        i for i, s in enumerate(ex) if "INSERT INTO gold.route_delay_percentile_daily" in s
    )
    workmem_idx = next(i for i, s in enumerate(ex) if "SET LOCAL work_mem" in s)
    assert row_delete_idx < wm_delete_idx < upsert_idx
    assert workmem_idx < upsert_idx


def test_rebuild_service_span_uses_offset_date_window() -> None:
    """route_service_span_daily: ROW delete on the ROW window, but its watermark
    delete + rebuild window shift +1 day (run date = row date + 1)."""
    missing = [FakeMissingDayRow(date(2026, 3, 21), 20260321)]
    conn = FakeConnection(rebuild_missing_days=missing)
    engine = FakeEngine(conn)
    result = rebuild_warm_rollups(
        "stm",
        settings=_fake_settings(),
        engine=engine,
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        kinds=["route_service_span_daily"],
        confirm=lambda _plan: True,
    )
    assert result.deleted_row_counts == {"route_service_span_daily": 11}
    assert result.deleted_watermark_counts == {"route_service_span_daily": 2}
    assert result.rebuilt_day_counts == {"route_service_span_daily": 1}

    # The rebuild-phase missing-day SELECT is bound to the RUN window (ROW + 1).
    kind = REBUILDABLE_KINDS["route_service_span_daily"]
    from_utc, to_utc = rollups._rebuild_watermark_window(REBUILD_FROM, REBUILD_TO, kind)
    assert from_utc == datetime(2026, 3, 21, tzinfo=UTC)  # 2026-03-20 + 1
    assert to_utc == datetime(2026, 3, 23, tzinfo=UTC)  # 2026-03-22 + 1


def test_rebuild_all_kinds_default_covers_registry() -> None:
    """With no --kinds, every registered kind is deleted + rebuilt."""
    conn = FakeConnection(rebuild_missing_days=[FakeMissingDayRow(date(2026, 3, 20), 20260320)])
    engine = FakeEngine(conn)
    result = rebuild_warm_rollups(
        "stm",
        settings=_fake_settings(),
        engine=engine,
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        confirm=lambda _plan: True,
    )
    assert set(result.deleted_row_counts) == set(REBUILDABLE_KINDS)
    assert set(result.deleted_watermark_counts) == set(REBUILDABLE_KINDS)
    assert set(result.rebuilt_day_counts) == set(REBUILDABLE_KINDS)


def test_rebuild_result_display_dict_is_json_shaped() -> None:
    result = WarmRollupRebuildResult(
        provider_id="stm",
        from_date=REBUILD_FROM,
        to_date=REBUILD_TO,
        dry_run=True,
        aborted=False,
        completed_at_utc=datetime(2026, 3, 27, tzinfo=UTC),
        deleted_row_counts={"route_percentile_daily": 7},
    )
    payload = result.display_dict()
    assert payload["from_date"] == "2026-03-20"
    assert payload["to_date"] == "2026-03-22"
    assert payload["dry_run"] is True
    assert payload["deleted_row_counts"] == {"route_percentile_daily": 7}
    assert payload["completed_at_utc"] == "2026-03-27T00:00:00+00:00"
