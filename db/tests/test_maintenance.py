from __future__ import annotations

import inspect
from datetime import UTC, datetime, timedelta

import pytest

from transit_ops import maintenance as maintenance_module
from transit_ops.maintenance import (
    COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
    COUNT_ELIGIBLE_BRONZE_STATIC_OBJECTS,
    COUNT_OLD_FACT_TRIP_DELAY_SNAPSHOTS,
    COUNT_OLD_FACT_VEHICLE_SNAPSHOTS,
    COUNT_OLD_RT_ENTITIES,
    COUNT_OLD_RT_FEED_SNAPSHOTS,
    COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES,
    COUNT_OLD_RT_TRIP_UPDATES,
    COUNT_OLD_RT_VEHICLE_POSITIONS,
    DELETE_OLD_FACT_TRIP_DELAY_SNAPSHOTS,
    DELETE_OLD_FACT_VEHICLE_SNAPSHOTS,
    DELETE_OLD_RT_ENTITIES,
    DELETE_OLD_RT_FEED_SNAPSHOTS,
    DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES,
    DELETE_OLD_RT_TRIP_UPDATES,
    DELETE_OLD_RT_VEHICLE_POSITIONS,
    DELETE_ORPHANED_INGESTION_RUNS,
    MIN_SILVER_I3_CLOSED_RETENTION_DAYS,
    REALTIME_SILVER_TABLES,
    SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
    SELECT_ELIGIBLE_BRONZE_STATIC_OBJECTS,
    SELECT_ELIGIBLE_I3_RAW_SNAPSHOTS,
    VACUUM_TABLES,
    BronzeStoragePruneResult,
    GoldStoragePruneResult,
    I3StoragePruneResult,
    SilverStoragePruneResult,
    WarmRollupStoragePruneResult,
    prune_bronze_realtime_objects,
    prune_bronze_static_objects,
    prune_bronze_storage,
    prune_gold_fact_history,
    prune_gold_storage,
    prune_i3_raw_snapshots,
    prune_i3_silver_closed_rows,
    prune_realtime_silver_history,
    prune_static_silver_datasets,
    prune_warm_rollup_storage,
)

DROPPED_LEGACY_SILVER_REALTIME_TABLES = (
    "silver." + "trip_update_stop_time_updates",
    "silver." + "trip_updates",
    "silver." + "vehicle_positions",
)

EXPECTED_NORMALIZED_REALTIME_SILVER_TABLES = (
    "silver.rt_trip_update_stop_times",
    "silver.rt_trip_updates",
    "silver.rt_vehicle_positions",
    "silver.rt_entities",
    "silver.rt_feed_snapshots",
)

EXPECTED_GOLD_AGGREGATE_TABLE_COUNTS = {
    "gold.vehicle_summary_5m": 5,
    "gold.trip_delay_summary_5m": 3,
    "gold.warm_rollup_periods": 8,
    "gold.route_delay_hourly": 11,
    "gold.route_delay_day_of_week": 12,
    "gold.stop_delay_hourly": 13,
    "gold.route_reliability_weekly": 14,
    "gold.route_reliability_monthly": 15,
    "gold.stop_delay_weekly": 16,
    "gold.stop_delay_monthly": 17,
    "gold.route_habit_score": 18,
    "gold.repeated_problem_route_stop": 19,
    "gold.citizen_accountability_daily": 20,
}


class ScalarResult:
    def __init__(self, value: int) -> None:
        self.value = value
        self.rowcount = 0

    def scalar_one(self) -> int:
        return self.value


class IterableResult:
    def __init__(self, rows: list[tuple]) -> None:
        self.rows = rows
        self.rowcount = len(rows)

    def __iter__(self):
        return iter(self.rows)


class RowcountResult:
    def __init__(self, rowcount: int) -> None:
        self.rowcount = rowcount


class RecordingEngine:
    def __init__(self, connection: RecordingConnection) -> None:
        self.connection = connection
        self.begin_calls = 0

    def begin(self) -> RecordingConnection:
        self.begin_calls += 1
        return self.connection


class RecordingConnection:
    def __init__(self, gold_referenced_rows: list[tuple] | None = None) -> None:
        self.calls: list[str] = []
        self.executed: list[tuple[str, dict | None]] = []
        # Dataset version ids that gold dims still reference (FK holders). The
        # default [(7,)] keeps the existing dataset fixture [7, 6, 5] with
        # retention 1 producing deferred==[] (7 is retained, never a candidate).
        self.gold_referenced_rows = (
            gold_referenced_rows if gold_referenced_rows is not None else [(7,)]
        )

    def __enter__(self) -> RecordingConnection:
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:  # noqa: ANN001
        return None

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append(sql_text)
        self.executed.append((sql_text, params))
        # Gold-reference lookup (UNION over gold.dim_route/stop/date/route_pattern)
        # MUST be routed before the generic 'SELECT dataset_version_id' branch.
        if "gold.dim_route" in sql_text and "SELECT DISTINCT dataset_version_id" in sql_text:
            return IterableResult(self.gold_referenced_rows)
        for table_name, rowcount in EXPECTED_GOLD_AGGREGATE_TABLE_COUNTS.items():
            if f"DELETE FROM {table_name}" in sql_text:
                return RowcountResult(rowcount)
            if (
                ("SELECT COUNT(*)" in sql_text or "SELECT count(*)" in sql_text)
                and f"FROM {table_name}" in sql_text
            ):
                return ScalarResult(rowcount)
        if "SELECT dataset_version_id" in sql_text:
            return IterableResult([(7,), (6,), (5,)])
        # DELETE statements return rowcount
        if "DELETE FROM silver.stop_times" in sql_text:
            return RowcountResult(12)
        if "DELETE FROM silver.translations" in sql_text:
            return RowcountResult(9)
        if "DELETE FROM silver.shapes" in sql_text:
            return RowcountResult(7)
        if "DELETE FROM silver.route_patterns" in sql_text:
            return RowcountResult(6)
        if "DELETE FROM silver.directions" in sql_text:
            return RowcountResult(5)
        if "DELETE FROM silver.calendar_dates" in sql_text:
            return RowcountResult(4)
        if "DELETE FROM silver.calendar" in sql_text:
            return RowcountResult(2)
        if "DELETE FROM silver.trips" in sql_text:
            return RowcountResult(8)
        if "DELETE FROM silver.stops" in sql_text:
            return RowcountResult(3)
        if "DELETE FROM silver.routes" in sql_text:
            return RowcountResult(1)
        if "DELETE FROM silver.feed_info" in sql_text:
            return RowcountResult(1)
        if "DELETE FROM silver.agency" in sql_text:
            return RowcountResult(1)
        if "DELETE FROM silver.gtfs_extra_rows" in sql_text:
            return RowcountResult(11)
        if "DELETE FROM silver.gtfs_source_members" in sql_text:
            return RowcountResult(10)
        if "DELETE FROM silver.gis_gtfs_matches" in sql_text:
            return RowcountResult(13)
        if "DELETE FROM core.dataset_versions" in sql_text:
            return RowcountResult(2)
        if "DELETE FROM silver.rt_trip_update_stop_times" in sql_text:
            return RowcountResult(400)
        if "DELETE FROM silver.rt_trip_updates" in sql_text:
            return RowcountResult(40)
        if "DELETE FROM silver.rt_vehicle_positions" in sql_text:
            return RowcountResult(30)
        if "DELETE FROM silver.rt_entities" in sql_text:
            return RowcountResult(60)
        if "DELETE FROM silver.rt_feed_snapshots" in sql_text:
            return RowcountResult(50)
        if "DELETE FROM gold.fact_trip_delay_snapshot" in sql_text:
            return RowcountResult(500)
        if "DELETE FROM gold.fact_vehicle_snapshot" in sql_text:
            return RowcountResult(300)
        if "DELETE FROM raw.realtime_snapshot_index" in sql_text:
            return RowcountResult(3)
        if "DELETE FROM raw.ingestion_objects" in sql_text:
            return RowcountResult(3)
        if "DELETE FROM raw.ingestion_runs" in sql_text:
            return RowcountResult(1)
        # COUNT statements return ScalarResult
        if "SELECT COUNT(*) FROM silver.stop_times" in sql_text:
            return ScalarResult(12)
        if "SELECT COUNT(*) FROM silver.translations" in sql_text:
            return ScalarResult(9)
        if "SELECT COUNT(*) FROM silver.shapes" in sql_text:
            return ScalarResult(7)
        if "SELECT COUNT(*) FROM silver.route_patterns" in sql_text:
            return ScalarResult(6)
        if "SELECT COUNT(*) FROM silver.directions" in sql_text:
            return ScalarResult(5)
        if "SELECT COUNT(*) FROM silver.calendar_dates" in sql_text:
            return ScalarResult(4)
        if "SELECT COUNT(*) FROM silver.calendar" in sql_text:
            return ScalarResult(2)
        if "SELECT COUNT(*) FROM silver.trips" in sql_text:
            return ScalarResult(8)
        if "SELECT COUNT(*) FROM silver.stops" in sql_text:
            return ScalarResult(3)
        if "SELECT COUNT(*) FROM silver.routes" in sql_text:
            return ScalarResult(1)
        if "SELECT COUNT(*) FROM silver.feed_info" in sql_text:
            return ScalarResult(1)
        if "SELECT COUNT(*) FROM silver.agency" in sql_text:
            return ScalarResult(1)
        if "SELECT COUNT(*) FROM silver.gtfs_extra_rows" in sql_text:
            return ScalarResult(11)
        if "SELECT COUNT(*) FROM silver.gtfs_source_members" in sql_text:
            return ScalarResult(10)
        if "SELECT COUNT(*) FROM silver.gis_gtfs_matches" in sql_text:
            return ScalarResult(13)
        if "SELECT COUNT(*) FROM core.dataset_versions" in sql_text:
            return ScalarResult(2)
        if "SELECT COUNT(*) FROM silver.rt_trip_update_stop_times" in sql_text:
            return ScalarResult(400)
        if "SELECT COUNT(*) FROM silver.rt_trip_updates" in sql_text:
            return ScalarResult(40)
        if "SELECT COUNT(*) FROM silver.rt_vehicle_positions" in sql_text:
            return ScalarResult(30)
        if "SELECT COUNT(*) FROM silver.rt_entities" in sql_text:
            return ScalarResult(60)
        if "SELECT COUNT(*) FROM silver.rt_feed_snapshots" in sql_text:
            return ScalarResult(50)
        if "SELECT COUNT(*) FROM gold.fact_trip_delay_snapshot" in sql_text:
            return ScalarResult(500)
        if "SELECT COUNT(*) FROM gold.fact_vehicle_snapshot" in sql_text:
            return ScalarResult(300)
        # --- i3 retention (slice-9.1.1l) ---
        # i3 raw eligible COUNT references silver.i3_alerts in a NOT EXISTS
        # guard, so it MUST be matched before the silver.i3_alerts COUNT below.
        if "SELECT COUNT(*)" in sql_text and "raw.i3_alert_snapshots" in sql_text:
            return ScalarResult(9876)
        # i3 silver-closed prune: entities + alerts DELETE / COUNT.
        if "DELETE FROM silver.i3_alert_informed_entities" in sql_text:
            return RowcountResult(7)
        if "DELETE FROM silver.i3_alerts" in sql_text:
            return RowcountResult(4)
        if (
            "SELECT COUNT(*)" in sql_text
            and "silver.i3_alert_informed_entities" in sql_text
        ):
            return ScalarResult(7)
        if "SELECT COUNT(*)" in sql_text and "silver.i3_alerts" in sql_text:
            return ScalarResult(4)
        # i3 raw eligible row select (live path).
        if (
            "raw.i3_alert_snapshots" in sql_text
            and "SELECT" in sql_text
            and "DELETE" not in sql_text
            and "COUNT" not in sql_text
        ):
            # (i3_alert_snapshot_id, ingestion_run_id, ingestion_object_id, storage_path)
            return IterableResult(
                [
                    (5001, 6001, 7001, "stm/i3_alerts/captured_at_utc=2026-01-01/a.json"),
                    (5002, 6002, 7002, "stm/i3_alerts/captured_at_utc=2026-01-02/b.json"),
                    (5003, 6003, None, None),
                ]
            )
        if "DELETE FROM raw.i3_alert_snapshots" in sql_text:
            return RowcountResult(3)
        # Bronze eligible COUNT statements (dry-run, unbounded) — must precede
        # the row-returning eligible-select heuristics below, which would
        # otherwise swallow them.
        if "SELECT COUNT(*)" in sql_text and "raw.realtime_snapshot_index" in sql_text:
            return ScalarResult(12345)
        if "SELECT COUNT(*)" in sql_text and "static_schedule" in sql_text:
            return ScalarResult(678)
        # Bronze eligible object selects (return rows with 5 columns each)
        if "SELECT_ELIGIBLE_BRONZE_REALTIME" in sql_text or (
            "ingestion_object_id" in sql_text
            and "realtime_snapshot_id" in sql_text
            and "SELECT" in sql_text
            and "DELETE" not in sql_text
        ):
            return IterableResult(
                [
                    (10, 1, "stm/trip_updates/captured_at_utc=2026-01-01/key1.pb", "s3", 100),
                    (11, 2, "stm/vehicle_positions/captured_at_utc=2026-01-01/key2.pb", "s3", 101),
                    (12, 3, "stm/trip_updates/captured_at_utc=2026-01-02/key3.pb", "s3", 102),
                ]
            )
        if "SELECT_ELIGIBLE_BRONZE_STATIC" in sql_text or (
            "run_kind" in sql_text
            and "static_schedule" in sql_text
            and "SELECT" in sql_text
            and "DELETE" not in sql_text
        ):
            return IterableResult(
                [
                    (20, 5, "stm/static_schedule/ingested_at_utc=2026-01-01/file.zip", "s3"),
                ]
            )
        return RowcountResult(0)


class FakeBronzeStorage:
    """Bronze storage stub that records calls without doing I/O."""

    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.fail_on: set[str] = set()

    def delete_object(self, storage_path: str) -> None:
        if storage_path in self.fail_on:
            raise OSError(f"Simulated failure for {storage_path}")
        self.deleted.append(storage_path)

    def storage_backend(self) -> str:
        return "local"


def test_prune_static_silver_datasets_keeps_only_retained_versions() -> None:
    connection = RecordingConnection()

    (
        retained_dataset_version_ids,
        pruned_dataset_version_ids,
        deferred_dataset_version_ids,
        deleted_row_counts,
    ) = prune_static_silver_datasets(
        connection,
        provider_id="stm",
        retention_count=1,
    )

    assert retained_dataset_version_ids == [7]
    assert pruned_dataset_version_ids == [6, 5]
    assert deferred_dataset_version_ids == []
    assert deleted_row_counts == {
        "silver.stop_times": 12,
        "silver.translations": 9,
        "silver.shapes": 7,
        "silver.route_patterns": 6,
        "silver.directions": 5,
        "silver.calendar_dates": 4,
        "silver.calendar": 2,
        "silver.trips": 8,
        "silver.stops": 3,
        "silver.routes": 1,
        "silver.feed_info": 1,
        "silver.agency": 1,
        "silver.gtfs_extra_rows": 11,
        "silver.gtfs_source_members": 10,
        "silver.gis_gtfs_matches": 13,
        "core.dataset_versions": 2,
    }
    gis_match_delete_index = next(
        index
        for index, sql in enumerate(connection.calls)
        if "DELETE FROM silver.gis_gtfs_matches" in sql
    )
    dataset_delete_index = next(
        index for index, sql in enumerate(connection.calls)
        if "DELETE FROM core.dataset_versions" in sql
    )
    assert gis_match_delete_index < dataset_delete_index


def test_prune_static_silver_datasets_dry_run_returns_counts_without_deleting() -> None:
    connection = RecordingConnection()

    retained_ids, pruned_ids, deferred_ids, counts = prune_static_silver_datasets(
        connection,
        provider_id="stm",
        retention_count=1,
        dry_run=True,
    )

    assert retained_ids == [7]
    assert pruned_ids == [6, 5]
    assert deferred_ids == []
    assert counts == {
        "silver.stop_times": 12,
        "silver.translations": 9,
        "silver.shapes": 7,
        "silver.route_patterns": 6,
        "silver.directions": 5,
        "silver.calendar_dates": 4,
        "silver.calendar": 2,
        "silver.trips": 8,
        "silver.stops": 3,
        "silver.routes": 1,
        "silver.feed_info": 1,
        "silver.agency": 1,
        "silver.gtfs_extra_rows": 11,
        "silver.gtfs_source_members": 10,
        "silver.gis_gtfs_matches": 13,
        "core.dataset_versions": 2,
    }
    # No DELETE statements should appear in calls
    delete_calls = [c for c in connection.calls if "DELETE" in c]
    assert delete_calls == [], f"Expected no DELETE calls in dry_run but got: {delete_calls}"


def test_prune_static_silver_datasets_defers_versions_still_referenced_by_gold_dims() -> None:
    # versions [7, 6, 5] with retention 1 → candidates [6, 5]; gold dims still
    # reference version 6, so it is deferred (NOT deleted), only 5 is pruned.
    connection = RecordingConnection(gold_referenced_rows=[(6,)])

    (
        retained,
        pruned,
        deferred,
        counts,
    ) = prune_static_silver_datasets(
        connection,
        provider_id="stm",
        retention_count=1,
    )

    assert retained == [7]
    assert deferred == [6]
    assert pruned == [5]
    # No executed statement may delete the gold-referenced version 6.
    delete_dataset_versions_params = [
        params
        for sql, params in connection.executed
        if "DELETE FROM core.dataset_versions" in sql
    ]
    assert delete_dataset_versions_params == [
        {"provider_id": "stm", "dataset_version_ids": [5]}
    ]
    for sql, params in connection.executed:
        if "DELETE" in sql and params and "dataset_version_ids" in params:
            assert 6 not in params["dataset_version_ids"]
    assert counts["core.dataset_versions"] == 2


def test_prune_static_silver_datasets_skips_gold_reference_lookup_when_no_candidates() -> None:
    # A single version (retention 1) leaves no prune candidates, so the
    # gold-reference UNION lookup must never run (zero steady-state cost).
    connection = RecordingConnection()
    connection.gold_referenced_rows = [(9,)]

    # Override the dataset-version listing to a single id.
    original_execute = connection.execute

    def single_version_execute(statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        if (
            "SELECT dataset_version_id" in sql_text
            and "gold.dim_route" not in sql_text
        ):
            connection.calls.append(sql_text)
            connection.executed.append((sql_text, params))
            return IterableResult([(9,)])
        return original_execute(statement, params)

    connection.execute = single_version_execute  # type: ignore[method-assign]

    retained, pruned, deferred, counts = prune_static_silver_datasets(
        connection,
        provider_id="stm",
        retention_count=1,
    )

    assert retained == [9]
    assert pruned == []
    assert deferred == []
    assert not any("gold.dim_route" in sql for sql in connection.calls)
    # No DELETE statements at all when there are no candidates.
    assert not any("DELETE" in sql for sql in connection.calls)


def test_prune_static_silver_datasets_all_candidates_deferred_executes_no_deletes() -> None:
    # Both candidate versions (6, 5) are still referenced by gold dims → all
    # deferred, nothing pruned, and no DELETE statement is executed.
    connection = RecordingConnection(gold_referenced_rows=[(6,), (5,)])

    retained, pruned, deferred, counts = prune_static_silver_datasets(
        connection,
        provider_id="stm",
        retention_count=1,
    )

    assert retained == [7]
    assert deferred == [6, 5]
    assert pruned == []
    assert not any("DELETE" in sql for sql in connection.calls)


def test_prune_static_silver_datasets_dry_run_counts_exclude_deferred_versions() -> None:
    # Dry-run with version 6 deferred: the COUNT statements must scope to the
    # pruned set [5] only, never the deferred version 6.
    connection = RecordingConnection(gold_referenced_rows=[(6,)])

    retained, pruned, deferred, counts = prune_static_silver_datasets(
        connection,
        provider_id="stm",
        retention_count=1,
        dry_run=True,
    )

    assert retained == [7]
    assert deferred == [6]
    assert pruned == [5]
    delete_calls = [c for c in connection.calls if "DELETE" in c]
    assert delete_calls == []
    for sql, params in connection.executed:
        if "SELECT COUNT(*)" in sql and params and "dataset_version_ids" in params:
            assert params["dataset_version_ids"] == [5]


def test_select_gold_referenced_dataset_version_ids_covers_all_fk_dims() -> None:
    sql = str(maintenance_module.SELECT_GOLD_REFERENCED_DATASET_VERSION_IDS)
    for table_name in (
        "gold.dim_route",
        "gold.dim_stop",
        "gold.dim_date",
        "gold.dim_route_pattern",
    ):
        assert table_name in sql
    # Four provider filters (one per dim), UNION-combined.
    assert sql.count(":provider_id") == 4
    assert "UNION" in sql
    # Lock-in: the reference tuple lists exactly those four FK-holding dims.
    assert maintenance_module.GOLD_DATASET_REFERENCE_TABLES == (
        "gold.dim_route",
        "gold.dim_stop",
        "gold.dim_date",
        "gold.dim_route_pattern",
    )


def test_prune_realtime_silver_history_deletes_rows_older_than_cutoff() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, deleted_row_counts = prune_realtime_silver_history(
        connection,
        provider_id="stm",
        retention_days=2,
        now_utc=now_utc,
    )

    assert cutoff_utc == datetime(2026, 3, 24, 20, 0, 0, tzinfo=UTC)
    assert deleted_row_counts == {
        "silver.rt_trip_update_stop_times": 400,
        "silver.rt_trip_updates": 40,
        "silver.rt_vehicle_positions": 30,
        "silver.rt_entities": 60,
        "silver.rt_feed_snapshots": 50,
    }
    assert all(
        dropped_table not in deleted_row_counts
        for dropped_table in DROPPED_LEGACY_SILVER_REALTIME_TABLES
    )


def test_prune_realtime_silver_history_dry_run_returns_counts_without_deleting() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, counts = prune_realtime_silver_history(
        connection,
        provider_id="stm",
        retention_days=2,
        dry_run=True,
        now_utc=now_utc,
    )

    assert cutoff_utc == datetime(2026, 3, 24, 20, 0, 0, tzinfo=UTC)
    assert counts == {
        "silver.rt_trip_update_stop_times": 400,
        "silver.rt_trip_updates": 40,
        "silver.rt_vehicle_positions": 30,
        "silver.rt_entities": 60,
        "silver.rt_feed_snapshots": 50,
    }
    delete_calls = [c for c in connection.calls if "DELETE" in c]
    assert delete_calls == [], f"Expected no DELETE calls in dry_run but got: {delete_calls}"


def test_prune_realtime_silver_history_zero_retention_is_noop() -> None:
    connection = RecordingConnection()

    cutoff_utc, deleted_row_counts = prune_realtime_silver_history(
        connection,
        provider_id="stm",
        retention_days=0,
    )

    assert cutoff_utc is None
    assert deleted_row_counts == {
        "silver.rt_trip_update_stop_times": 0,
        "silver.rt_trip_updates": 0,
        "silver.rt_vehicle_positions": 0,
        "silver.rt_entities": 0,
        "silver.rt_feed_snapshots": 0,
    }
    assert connection.calls == []


REALTIME_HISTORY_DELETE_STATEMENTS = (
    ("silver.rt_trip_update_stop_times", DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES),
    ("silver.rt_trip_updates", DELETE_OLD_RT_TRIP_UPDATES),
    ("silver.rt_vehicle_positions", DELETE_OLD_RT_VEHICLE_POSITIONS),
    ("silver.rt_entities", DELETE_OLD_RT_ENTITIES),
    ("silver.rt_feed_snapshots", DELETE_OLD_RT_FEED_SNAPSHOTS),
)


@pytest.mark.parametrize("table_name,statement", REALTIME_HISTORY_DELETE_STATEMENTS)
def test_realtime_history_delete_is_bounded_per_cycle(table_name, statement) -> None:  # noqa: ANN001
    """Each realtime-history DELETE must cap rows/cycle via ctid IN (... LIMIT :batch).

    The prune runs on every ~57s worker cycle; an unbounded single-transaction
    DELETE of the accumulated backlog (e.g. ~252M-row rt_trip_update_stop_times
    after a redeploy) is the unbounded-heavy-op hang class. The bounded ctid form
    drains the one-time backlog over many cycles instead.
    """
    sql = str(statement)

    assert "DELETE" in sql
    assert ".ctid IN (" in sql, f"{table_name} DELETE must be batched via ctid IN (...)"
    assert "LIMIT :batch" in sql, f"{table_name} DELETE must cap rows with LIMIT :batch"
    # Retention predicate is preserved exactly — same cutoff + latest exclusion.
    assert "captured_at_utc < :cutoff_utc" in sql
    assert "provider_id = :provider_id" in sql


@pytest.mark.parametrize(
    "statement",
    [
        COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES,
        COUNT_OLD_RT_TRIP_UPDATES,
        COUNT_OLD_RT_VEHICLE_POSITIONS,
        COUNT_OLD_RT_ENTITIES,
        COUNT_OLD_RT_FEED_SNAPSHOTS,
    ],
)
def test_realtime_history_count_statements_report_unbounded_backlog(statement) -> None:  # noqa: ANN001
    """Dry-run COUNT must report the TRUE backlog — never the per-cycle batch cap."""
    sql = str(statement)

    assert "SELECT COUNT(*)" in sql
    assert "LIMIT" not in sql
    assert ":batch" not in sql


def test_rt_feed_snapshots_delete_guards_on_surviving_children() -> None:
    """The parent snapshot DELETE must not orphan-violate non-cascading child FKs.

    rt_entities (and transitively rt_trip_updates / rt_vehicle_positions /
    rt_trip_update_stop_times) FK to rt_feed_snapshots with NO ON DELETE CASCADE.
    Under per-cycle batching a child table may not be fully drained in the same
    cycle, so a snapshot is only deletable once no rt_entities row survives.
    """
    sql = str(DELETE_OLD_RT_FEED_SNAPSHOTS)

    assert "NOT EXISTS" in sql
    assert "silver.rt_entities" in sql


def test_prune_realtime_silver_history_binds_batch_param() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    prune_realtime_silver_history(
        connection,
        provider_id="stm",
        retention_days=2,
        batch_size=12345,
        now_utc=now_utc,
    )

    delete_params = [
        params for sql, params in connection.executed if "DELETE" in sql
    ]
    assert delete_params, "expected live DELETE executions"
    assert all(params.get("batch") == 12345 for params in delete_params)


def test_prune_realtime_silver_history_floors_batch_at_one() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    prune_realtime_silver_history(
        connection,
        provider_id="stm",
        retention_days=2,
        batch_size=0,
        now_utc=now_utc,
    )

    delete_params = [
        params for sql, params in connection.executed if "DELETE" in sql
    ]
    assert delete_params
    # batch floored at 1 — a LIMIT 0 would never drain the backlog.
    assert all(params.get("batch") == 1 for params in delete_params)


def test_prune_silver_storage_threads_realtime_prune_batch_setting() -> None:
    from transit_ops.maintenance import prune_silver_storage

    class BatchedSilverPruneSettings:
        STATIC_DATASET_RETENTION_COUNT = 1
        SILVER_REALTIME_RETENTION_DAYS = 2
        SILVER_REALTIME_PRUNE_BATCH = 7777

    engine = PerBeginRecordingEngine()

    prune_silver_storage(
        "stm",
        settings=BatchedSilverPruneSettings(),  # type: ignore[arg-type]
        engine=engine,  # type: ignore[arg-type]
    )

    realtime_conn = engine.connections[0]
    rt_delete_params = [
        params
        for sql, params in realtime_conn.executed
        if "DELETE FROM silver.rt_" in sql
    ]
    assert rt_delete_params, "expected realtime DELETE executions in tx1"
    assert all(params.get("batch") == 7777 for params in rt_delete_params)


def test_bronze_realtime_prune_waits_for_source_snapshot_rows_to_be_gone() -> None:
    sql = str(SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS)

    assert "silver.rt_feed_snapshots" in sql
    assert "source_realtime_snapshot_id" in sql
    for dropped_table in DROPPED_LEGACY_SILVER_REALTIME_TABLES:
        assert dropped_table not in sql


def test_eligible_bronze_selects_order_oldest_first_limit_and_exclude() -> None:
    realtime_sql = str(SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS)
    static_sql = str(SELECT_ELIGIBLE_BRONZE_STATIC_OBJECTS)

    assert "ORDER BY rsi.captured_at_utc ASC, io.ingestion_object_id ASC" in realtime_sql
    assert "LIMIT :max_objects" in realtime_sql
    assert ":excluded_object_ids" in realtime_sql

    assert "ORDER BY ir.started_at_utc ASC, io.ingestion_object_id ASC" in static_sql
    assert "LIMIT :max_objects" in static_sql
    assert ":excluded_object_ids" in static_sql


def test_count_eligible_bronze_statements_are_unbounded() -> None:
    realtime_sql = str(COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS)
    static_sql = str(COUNT_ELIGIBLE_BRONZE_STATIC_OBJECTS)

    # Same eligibility guards as the batched selects…
    assert "SELECT COUNT(*)" in realtime_sql
    assert "NOT EXISTS" in realtime_sql
    assert "silver.rt_feed_snapshots" in realtime_sql
    assert "source_realtime_snapshot_id" in realtime_sql
    assert "rsi_latest" in realtime_sql
    assert "SELECT COUNT(*)" in static_sql
    assert "NOT EXISTS" in static_sql
    assert "core.dataset_versions" in static_sql
    assert "'static_schedule'" in static_sql
    # …but no batching: dry-run must report the true unbounded backlog.
    assert "LIMIT" not in realtime_sql
    assert ":excluded_object_ids" not in realtime_sql
    assert "LIMIT" not in static_sql
    assert ":excluded_object_ids" not in static_sql


def test_delete_orphaned_ingestion_runs_is_age_gated() -> None:
    sql = str(DELETE_ORPHANED_INGESTION_RUNS)

    # The age gate keeps the prune from racing a worker capture whose
    # ingestion_run committed seconds ago but whose object has not yet.
    assert "started_at_utc < :cutoff_utc" in sql
    assert "NOT EXISTS" in sql
    assert "raw.ingestion_objects" in sql


def test_delete_orphaned_ingestion_runs_guards_surviving_i3_alert_snapshots() -> None:
    """An i3 run owns its raw.i3_alert_snapshots row, not a raw.ingestion_objects row.

    fk_raw_i3_alert_snapshots_ingestion_run_id (0013:164-166) is non-cascading
    with a 1:1 UNIQUE on ingestion_run_id. An i3 run older than the bronze cutoff
    with no ingestion_objects but a surviving i3_alert_snapshots row (kept under
    the 90-day silver-closed retention) would otherwise match the "orphaned"
    DELETE and FK-violate, aborting the whole bronze-realtime prune. The DELETE
    must also guard NOT EXISTS any surviving i3_alert_snapshots child
    (ops-core#4), mirroring DELETE_ORPHANED_I3_INGESTION_RUNS.
    """
    sql = str(DELETE_ORPHANED_INGESTION_RUNS)

    assert "raw.i3_alert_snapshots" in sql
    # The guard is on the run-owning FK column (1:1 ownership of the snapshot).
    assert "s.ingestion_run_id = ir.ingestion_run_id" in sql
    # Both child guards must be present: objects AND i3 snapshots.
    assert sql.count("NOT EXISTS") >= 2


def test_orphan_run_prune_retains_recent_failed_silver_load_rows() -> None:
    """slice-9.1.1o: the new run_kind='silver_load' failure rows (and every
    capture-failure row) carry zero ingestion_objects, so they look "orphaned".
    The age gate is the retention guard: only orphans OLDER than the bronze
    cutoff are deleted, so a recently-written failure row survives for the full
    retention window and is queryable by the freshness probe. This pins that
    the age gate (not a status filter) is what protects fresh failure rows —
    no separate status='failed' predicate is needed or present.
    """
    sql = str(DELETE_ORPHANED_INGESTION_RUNS)
    # Deletion is bounded to rows strictly older than the cutoff.
    assert "ir.started_at_utc < :cutoff_utc" in sql
    # The guard is purely age-based; it must NOT special-case status, otherwise
    # aged failure rows would never purge (they would accumulate forever).
    assert "status" not in sql


def test_prune_bronze_realtime_binds_cutoff_on_orphan_run_delete() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, _objects, _meta, _failed = prune_bronze_realtime_objects(
        connection,
        provider_id="stm",
        retention_days=7,
        bronze_storage=storage,
        dry_run=False,
        now_utc=now_utc,
    )

    orphan_calls = [
        (sql, params)
        for sql, params in connection.executed
        if "DELETE FROM raw.ingestion_runs" in sql
    ]
    assert len(orphan_calls) == 1
    _sql, params = orphan_calls[0]
    assert params is not None
    assert params["provider_id"] == "stm"
    # cutoff is bound so the age gate fires — recent failure rows are retained.
    assert params["cutoff_utc"] == cutoff_utc


def test_prune_bronze_static_binds_cutoff_on_orphan_run_delete() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, _objects, _meta, _failed = prune_bronze_static_objects(
        connection,
        provider_id="stm",
        retention_days=7,
        bronze_storage=storage,
        dry_run=False,
        now_utc=now_utc,
    )

    orphan_calls = [
        (sql, params)
        for sql, params in connection.executed
        if "DELETE FROM raw.ingestion_runs" in sql
    ]
    assert len(orphan_calls) == 1
    _sql, params = orphan_calls[0]
    assert params is not None
    assert params["cutoff_utc"] == cutoff_utc


def test_maintenance_has_no_dropped_legacy_silver_realtime_sql() -> None:
    source = inspect.getsource(maintenance_module)

    assert REALTIME_SILVER_TABLES == EXPECTED_NORMALIZED_REALTIME_SILVER_TABLES
    for dropped_table in DROPPED_LEGACY_SILVER_REALTIME_TABLES:
        assert dropped_table not in source
        assert dropped_table not in VACUUM_TABLES


def test_vacuum_tables_include_normalized_silver_and_gold_aggregates_only() -> None:
    for table_name in EXPECTED_NORMALIZED_REALTIME_SILVER_TABLES:
        assert table_name in VACUUM_TABLES
    for table_name in EXPECTED_GOLD_AGGREGATE_TABLE_COUNTS:
        assert table_name in VACUUM_TABLES
    for dropped_table in DROPPED_LEGACY_SILVER_REALTIME_TABLES:
        assert dropped_table not in VACUUM_TABLES


def test_vacuum_tables_include_raw_bronze_metadata_tables() -> None:
    for table_name in (
        "raw.realtime_snapshot_index",
        "raw.ingestion_objects",
        "raw.ingestion_runs",
    ):
        assert table_name in VACUUM_TABLES


class VacuumRecordingConnection:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execution_options(self, **kwargs):  # noqa: ANN003
        return self

    def __enter__(self) -> VacuumRecordingConnection:
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:  # noqa: ANN001
        return None

    def exec_driver_sql(self, statement: str) -> None:
        self.statements.append(statement)


class VacuumRecordingEngine:
    def __init__(self, connection: VacuumRecordingConnection) -> None:
        self.connection = connection

    def connect(self) -> VacuumRecordingConnection:
        return self.connection


def test_vacuum_storage_uses_parallel_zero_for_non_full_mode() -> None:
    # The Oracle A1 VM's postgres container ships /dev/shm at 64MB; parallel
    # vacuum workers allocate DSM there and crash. PARALLEL 0 is house law.
    connection = VacuumRecordingConnection()

    maintenance_module.vacuum_storage(
        "stm",
        tables=["raw.ingestion_objects"],
        settings=object(),  # type: ignore[arg-type]
        engine=VacuumRecordingEngine(connection),  # type: ignore[arg-type]
    )

    assert connection.statements == [
        "VACUUM (PARALLEL 0, ANALYZE) raw.ingestion_objects"
    ]

    full_connection = VacuumRecordingConnection()

    maintenance_module.vacuum_storage(
        "stm",
        full=True,
        tables=["raw.ingestion_objects"],
        settings=object(),  # type: ignore[arg-type]
        engine=VacuumRecordingEngine(full_connection),  # type: ignore[arg-type]
    )

    # PARALLEL is invalid alongside FULL — the full path stays unchanged.
    assert full_connection.statements == [
        "VACUUM (FULL, ANALYZE) raw.ingestion_objects"
    ]


class PerBeginRecordingEngine:
    """Engine stub that hands out a FRESH RecordingConnection per begin().

    Distinct from RecordingEngine (which returns one seeded connection) so the
    two-transaction split in prune_silver_storage can be observed: each
    engine.begin() corresponds to a separate transaction, and we record what
    each saw to assert realtime ran in tx1 and static in tx2.
    """

    def __init__(self) -> None:
        self.begin_count = 0
        self.connections: list[RecordingConnection] = []

    def begin(self) -> RecordingConnection:
        self.begin_count += 1
        connection = RecordingConnection()
        self.connections.append(connection)
        return connection


class SilverPruneSettings:
    STATIC_DATASET_RETENTION_COUNT = 1
    SILVER_REALTIME_RETENTION_DAYS = 2
    SILVER_REALTIME_PRUNE_BATCH = 50000


def test_prune_silver_storage_runs_realtime_and_static_in_separate_transactions() -> None:
    from transit_ops.maintenance import prune_silver_storage

    engine = PerBeginRecordingEngine()

    prune_silver_storage(
        "stm",
        settings=SilverPruneSettings(),  # type: ignore[arg-type]
        engine=engine,  # type: ignore[arg-type]
    )

    assert engine.begin_count == 2
    realtime_conn, static_conn = engine.connections

    # tx1 (realtime first) ran only the silver.rt_* DELETEs — never touched
    # core.dataset_versions or the static silver tables.
    assert any(
        "DELETE FROM silver.rt_feed_snapshots" in sql for sql in realtime_conn.calls
    )
    assert not any(
        "DELETE FROM core.dataset_versions" in sql for sql in realtime_conn.calls
    )
    assert not any(
        "DELETE FROM silver.stop_times" in sql for sql in realtime_conn.calls
    )

    # tx2 ran the static-dataset statements and no rt_* DELETEs.
    assert any(
        "DELETE FROM core.dataset_versions" in sql for sql in static_conn.calls
    )
    assert not any(
        "DELETE FROM silver.rt_feed_snapshots" in sql for sql in static_conn.calls
    )


def test_prune_silver_storage_result_reports_deferred_dataset_version_ids() -> None:
    from transit_ops.maintenance import prune_silver_storage

    engine = PerBeginRecordingEngine()

    result = prune_silver_storage(
        "stm",
        settings=SilverPruneSettings(),  # type: ignore[arg-type]
        engine=engine,  # type: ignore[arg-type]
    )

    # Default fixture: versions [7, 6, 5], gold references [7] → 6, 5 prunable,
    # none deferred.
    assert result.deferred_dataset_version_ids == []
    assert "deferred_dataset_version_ids" in result.display_dict()


def test_prune_result_display_dict_formats_timestamps() -> None:
    result = SilverStoragePruneResult(
        provider_id="stm",
        dry_run=False,
        static_dataset_retention_count=1,
        realtime_retention_days=2,
        retained_dataset_version_ids=[7],
        pruned_dataset_version_ids=[6, 5],
        deferred_dataset_version_ids=[],
        realtime_cutoff_utc=datetime(2026, 3, 24, 20, 0, 0, tzinfo=UTC),
        deleted_row_counts={"silver.stop_times": 12},
        completed_at_utc=datetime(2026, 3, 26, 20, 10, 0, tzinfo=UTC),
    )

    assert result.display_dict()["realtime_cutoff_utc"] == "2026-03-24T20:00:00+00:00"
    assert result.display_dict()["completed_at_utc"] == "2026-03-26T20:10:00+00:00"
    assert result.display_dict()["dry_run"] is False
    assert result.display_dict()["deferred_dataset_version_ids"] == []


# ---------------------------------------------------------------------------
# prune_gold_fact_history
# ---------------------------------------------------------------------------


def test_prune_gold_fact_history_deletes_rows_older_than_cutoff() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, deleted_row_counts = prune_gold_fact_history(
        connection,
        provider_id="stm",
        retention_days=2,
        now_utc=now_utc,
    )

    assert cutoff_utc == datetime(2026, 3, 24, 20, 0, 0, tzinfo=UTC)
    assert deleted_row_counts == {
        "gold.fact_trip_delay_snapshot": 500,
        "gold.fact_vehicle_snapshot": 300,
    }


def test_prune_gold_fact_history_dry_run_returns_counts_without_deleting() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, counts = prune_gold_fact_history(
        connection,
        provider_id="stm",
        retention_days=2,
        dry_run=True,
        now_utc=now_utc,
    )

    assert cutoff_utc == datetime(2026, 3, 24, 20, 0, 0, tzinfo=UTC)
    assert counts == {
        "gold.fact_trip_delay_snapshot": 500,
        "gold.fact_vehicle_snapshot": 300,
    }
    delete_calls = [c for c in connection.calls if "DELETE" in c]
    assert delete_calls == [], f"Expected no DELETE calls in dry_run but got: {delete_calls}"


def test_prune_gold_fact_history_zero_retention_is_noop() -> None:
    connection = RecordingConnection()

    cutoff_utc, deleted_row_counts = prune_gold_fact_history(
        connection,
        provider_id="stm",
        retention_days=0,
    )

    assert cutoff_utc is None
    assert deleted_row_counts == {
        "gold.fact_trip_delay_snapshot": 0,
        "gold.fact_vehicle_snapshot": 0,
    }
    assert len(connection.calls) == 0


GOLD_FACT_HISTORY_DELETE_STATEMENTS = (
    ("gold.fact_trip_delay_snapshot", DELETE_OLD_FACT_TRIP_DELAY_SNAPSHOTS),
    ("gold.fact_vehicle_snapshot", DELETE_OLD_FACT_VEHICLE_SNAPSHOTS),
)


@pytest.mark.parametrize("table_name,statement", GOLD_FACT_HISTORY_DELETE_STATEMENTS)
def test_gold_fact_history_delete_is_bounded_per_cycle(table_name, statement) -> None:  # noqa: ANN001
    """Each gold-fact DELETE must cap rows/cycle via ctid IN (... LIMIT :batch).

    prune_gold_fact_history runs on every ~57s worker cycle. An unbounded single
    DELETE of the accumulated backlog (the first cycle after a worker outage must
    drain the entire 18.7M-scale fact_trip_delay_snapshot in ONE transaction —
    long lock hold + WAL/bloat spike) is the unbounded-heavy-op hang class the
    silver prunes were already batched to avoid (ops-core#3 / x-perf#3).
    """
    sql = str(statement)

    assert "DELETE" in sql
    assert ".ctid IN (" in sql, f"{table_name} DELETE must be batched via ctid IN (...)"
    assert "LIMIT :batch" in sql, f"{table_name} DELETE must cap rows with LIMIT :batch"
    # Retention predicate is preserved exactly — same provider + cutoff filter.
    assert "captured_at_utc < :cutoff_utc" in sql
    assert "provider_id = :provider_id" in sql


@pytest.mark.parametrize(
    "statement",
    [COUNT_OLD_FACT_TRIP_DELAY_SNAPSHOTS, COUNT_OLD_FACT_VEHICLE_SNAPSHOTS],
)
def test_gold_fact_history_count_statements_report_unbounded_backlog(statement) -> None:  # noqa: ANN001
    """Dry-run COUNT must report the TRUE backlog — never the per-cycle batch cap."""
    sql = str(statement)

    assert "SELECT COUNT(*)" in sql
    assert "LIMIT" not in sql
    assert ":batch" not in sql


def test_prune_gold_fact_history_binds_batch_param() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    prune_gold_fact_history(
        connection,
        provider_id="stm",
        retention_days=2,
        batch_size=24680,
        now_utc=now_utc,
    )

    delete_params = [
        params for sql, params in connection.executed if "DELETE" in sql
    ]
    assert delete_params, "expected live DELETE executions"
    assert all(params.get("batch") == 24680 for params in delete_params)


def test_prune_gold_fact_history_floors_batch_at_one() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    prune_gold_fact_history(
        connection,
        provider_id="stm",
        retention_days=2,
        batch_size=0,
        now_utc=now_utc,
    )

    delete_params = [
        params for sql, params in connection.executed if "DELETE" in sql
    ]
    assert delete_params
    # batch floored at 1 — a LIMIT 0 would never drain the backlog.
    assert all(params.get("batch") == 1 for params in delete_params)


def test_prune_gold_storage_threads_gold_fact_prune_batch_setting() -> None:
    class BatchedGoldPruneSettings:
        GOLD_FACT_RETENTION_DAYS = 2
        GOLD_FACT_PRUNE_BATCH = 9999

    engine = PerBeginRecordingEngine()

    prune_gold_storage(
        "stm",
        settings=BatchedGoldPruneSettings(),  # type: ignore[arg-type]
        engine=engine,  # type: ignore[arg-type]
    )

    connection = engine.connections[0]
    fact_delete_params = [
        params
        for sql, params in connection.executed
        if "DELETE FROM gold.fact_" in sql
    ]
    assert fact_delete_params, "expected live gold-fact DELETE executions"
    assert all(params.get("batch") == 9999 for params in fact_delete_params)


def test_gold_prune_result_display_dict_formats_timestamps() -> None:
    result = GoldStoragePruneResult(
        provider_id="stm",
        dry_run=False,
        retention_days=2,
        cutoff_utc=datetime(2026, 3, 24, 20, 0, 0, tzinfo=UTC),
        deleted_row_counts={"gold.fact_trip_delay_snapshot": 500},
        completed_at_utc=datetime(2026, 3, 26, 20, 10, 0, tzinfo=UTC),
    )

    assert result.display_dict()["cutoff_utc"] == "2026-03-24T20:00:00+00:00"
    assert result.display_dict()["completed_at_utc"] == "2026-03-26T20:10:00+00:00"
    assert result.display_dict()["dry_run"] is False


class WarmRollupSettings:
    GOLD_WARM_ROLLUP_RETENTION_DAYS = 365


def test_prune_warm_rollup_storage_applies_aggregate_retention_to_reporting_marts() -> None:
    connection = RecordingConnection()
    engine = RecordingEngine(connection)

    result = prune_warm_rollup_storage(
        "stm",
        settings=WarmRollupSettings(),  # type: ignore[arg-type]
        engine=engine,  # type: ignore[arg-type]
        dry_run=True,
    )

    assert isinstance(result, WarmRollupStoragePruneResult)
    assert result.retention_days == 365
    assert result.deleted_row_counts == EXPECTED_GOLD_AGGREGATE_TABLE_COUNTS
    for table_name in EXPECTED_GOLD_AGGREGATE_TABLE_COUNTS:
        assert any(f"FROM {table_name}" in sql for sql in connection.calls)
    assert all("DELETE" not in sql for sql in connection.calls)


def test_gold_aggregate_retention_statement_rejects_unlisted_table_or_column() -> None:
    with pytest.raises(ValueError, match="Unknown Gold aggregate retention target"):
        maintenance_module._gold_aggregate_retention_statement(
            "gold.not_a_real_aggregate",
            "period_start_utc",
            date_only=False,
            dry_run=True,
        )

    with pytest.raises(ValueError, match="Unknown Gold aggregate retention target"):
        maintenance_module._gold_aggregate_retention_statement(
            "gold.route_delay_hourly",
            "unsafe_column",
            date_only=False,
            dry_run=True,
        )


def test_safe_scalar_count_requires_scalar_result() -> None:
    with pytest.raises(TypeError, match="scalar_one"):
        maintenance_module._safe_scalar_count(RowcountResult(12))


# ---------------------------------------------------------------------------
# prune_bronze_realtime_objects
# ---------------------------------------------------------------------------


def test_prune_bronze_realtime_objects_dry_run_returns_eligible_count_without_deleting() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, meta_counts, failed_object_ids = prune_bronze_realtime_objects(
        connection,
        provider_id="stm",
        retention_days=7,
        bronze_storage=storage,
        dry_run=True,
        now_utc=now_utc,
    )

    assert cutoff_utc is not None
    # Scalar COUNT returned by mock — dry-run no longer materializes rows
    assert object_counts == {"realtime": 12345}
    assert meta_counts["raw.realtime_snapshot_index"] == 12345
    assert meta_counts["raw.ingestion_objects"] == 12345
    assert failed_object_ids == set()
    # No actual deletions
    assert storage.deleted == []
    delete_calls = [c for c in connection.calls if "DELETE" in c]
    assert delete_calls == []


def test_prune_bronze_realtime_objects_dry_run_counts_unbounded_backlog() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    _cutoff, object_counts, _meta, _failed = prune_bronze_realtime_objects(
        connection,
        provider_id="stm",
        retention_days=7,
        bronze_storage=storage,
        dry_run=True,
        now_utc=now_utc,
    )

    # The dry-run count is the true backlog: no LIMIT, no exclusion binding.
    assert object_counts == {"realtime": 12345}
    assert all("LIMIT :max_objects" not in sql for sql, _ in connection.executed)
    count_params = next(
        params
        for sql, params in connection.executed
        if "SELECT COUNT(*)" in sql and "raw.realtime_snapshot_index" in sql
    )
    assert set(count_params) == {"provider_id", "cutoff_utc"}


def test_prune_bronze_realtime_objects_live_deletes_r2_then_metadata() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, meta_counts, failed_object_ids = prune_bronze_realtime_objects(
        connection,
        provider_id="stm",
        retention_days=7,
        bronze_storage=storage,
        dry_run=False,
        now_utc=now_utc,
    )

    assert cutoff_utc is not None
    # 3 eligible objects → 3 R2 deletes
    assert object_counts["realtime"] == 3
    assert len(storage.deleted) == 3
    assert failed_object_ids == set()
    # Metadata DELETEs executed
    rsi_deletes = [c for c in connection.calls if "DELETE FROM raw.realtime_snapshot_index" in c]
    obj_deletes = [c for c in connection.calls if "DELETE FROM raw.ingestion_objects" in c]
    assert len(rsi_deletes) == 1
    assert len(obj_deletes) == 1
    assert meta_counts["raw.realtime_snapshot_index"] == 3
    assert meta_counts["raw.ingestion_objects"] == 3


def test_prune_bronze_realtime_objects_skips_failed_r2_deletes() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    storage.fail_on = {
        "stm/trip_updates/captured_at_utc=2026-01-01/key1.pb",
    }
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, _meta, failed_object_ids = prune_bronze_realtime_objects(
        connection,
        provider_id="stm",
        retention_days=7,
        bronze_storage=storage,
        dry_run=False,
        now_utc=now_utc,
    )

    # Only 2 of 3 objects deleted (one failed)
    assert object_counts["realtime"] == 2
    assert len(storage.deleted) == 2
    assert failed_object_ids == {10}


def test_prune_bronze_realtime_objects_disabled_when_zero_retention() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()

    cutoff_utc, object_counts, meta_counts, failed_object_ids = prune_bronze_realtime_objects(
        connection,
        provider_id="stm",
        retention_days=0,
        bronze_storage=storage,
    )

    assert cutoff_utc is None
    assert object_counts == {"realtime": 0}
    assert failed_object_ids == set()
    assert len(connection.calls) == 0
    assert storage.deleted == []


# ---------------------------------------------------------------------------
# prune_bronze_static_objects
# ---------------------------------------------------------------------------


def test_prune_bronze_static_objects_dry_run_returns_eligible_count_without_deleting() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, meta_counts, failed_object_ids = prune_bronze_static_objects(
        connection,
        provider_id="stm",
        retention_days=30,
        bronze_storage=storage,
        dry_run=True,
        now_utc=now_utc,
    )

    assert cutoff_utc is not None
    # Scalar COUNT returned by mock — dry-run no longer materializes rows
    assert object_counts == {"static": 678}
    assert meta_counts["raw.ingestion_objects"] == 678
    assert failed_object_ids == set()
    assert storage.deleted == []
    delete_calls = [c for c in connection.calls if "DELETE" in c]
    assert delete_calls == []


def test_prune_bronze_static_objects_live_deletes_r2_then_metadata() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, meta_counts, failed_object_ids = prune_bronze_static_objects(
        connection,
        provider_id="stm",
        retention_days=30,
        bronze_storage=storage,
        dry_run=False,
        now_utc=now_utc,
    )

    assert cutoff_utc is not None
    assert object_counts["static"] == 1
    assert len(storage.deleted) == 1
    assert failed_object_ids == set()
    obj_deletes = [c for c in connection.calls if "DELETE FROM raw.ingestion_objects" in c]
    assert len(obj_deletes) == 1
    assert meta_counts["raw.ingestion_objects"] == 3  # mock rowcount


def test_prune_bronze_static_objects_disabled_when_zero_retention() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()

    cutoff_utc, object_counts, _meta, failed_object_ids = prune_bronze_static_objects(
        connection,
        provider_id="stm",
        retention_days=0,
        bronze_storage=storage,
    )

    assert cutoff_utc is None
    assert object_counts == {"static": 0}
    assert failed_object_ids == set()
    assert len(connection.calls) == 0


# ---------------------------------------------------------------------------
# prune_bronze_storage (engine-level batch loop)
# ---------------------------------------------------------------------------


MOCK_REALTIME_PATHS = (
    "stm/trip_updates/captured_at_utc=2026-01-01/key1.pb",
    "stm/vehicle_positions/captured_at_utc=2026-01-01/key2.pb",
    "stm/trip_updates/captured_at_utc=2026-01-02/key3.pb",
)


class BronzePruneSettings:
    BRONZE_REALTIME_RETENTION_DAYS = 30
    BRONZE_STATIC_RETENTION_DAYS = 365
    BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH = 5000
    BRONZE_PRUNE_MAX_BATCHES = 1


def _patch_bronze_storage(monkeypatch, storage: FakeBronzeStorage) -> None:  # noqa: ANN001
    monkeypatch.setattr(
        maintenance_module,
        "get_bronze_storage",
        lambda settings, project_root=None: storage,
    )


def _realtime_eligible_select_params(connection: RecordingConnection) -> list[dict]:
    return [
        params
        for sql, params in connection.executed
        if "LIMIT :max_objects" in sql and "raw.realtime_snapshot_index" in sql
    ]


def test_prune_bronze_storage_opens_one_transaction_per_batch(monkeypatch) -> None:
    connection = RecordingConnection()
    engine = RecordingEngine(connection)
    storage = FakeBronzeStorage()
    _patch_bronze_storage(monkeypatch, storage)

    result = prune_bronze_storage(
        "stm",
        settings=BronzePruneSettings(),  # type: ignore[arg-type]
        engine=engine,  # type: ignore[arg-type]
        max_objects=3,
        max_batches=3,
    )

    # Realtime mock always selects 3 rows == max_objects → 3 full batches;
    # static selects 1 row < max_objects → exhausted after a single batch.
    assert engine.begin_calls == 4
    assert result.batch_counts == {"realtime": 3, "static": 1}
    assert result.deleted_object_counts == {"realtime": 9, "static": 1}
    assert result.failed_object_counts == {"realtime": 0, "static": 0}
    assert result.exhausted is False


def test_prune_bronze_storage_sets_exhausted_only_when_both_phases_under_limit(
    monkeypatch,
) -> None:
    storage = FakeBronzeStorage()
    _patch_bronze_storage(monkeypatch, storage)

    # Default knobs (5000 per batch): both phases drain below the limit.
    both_under_limit = prune_bronze_storage(
        "stm",
        settings=BronzePruneSettings(),  # type: ignore[arg-type]
        engine=RecordingEngine(RecordingConnection()),  # type: ignore[arg-type]
    )
    assert both_under_limit.batch_counts == {"realtime": 1, "static": 1}
    assert both_under_limit.exhausted is True

    # Realtime fills its only batch exactly → cannot prove exhaustion.
    realtime_full = prune_bronze_storage(
        "stm",
        settings=BronzePruneSettings(),  # type: ignore[arg-type]
        engine=RecordingEngine(RecordingConnection()),  # type: ignore[arg-type]
        max_objects=3,
        max_batches=1,
    )
    assert realtime_full.exhausted is False


def test_prune_bronze_storage_excludes_failed_ids_from_next_batch(monkeypatch) -> None:
    connection = RecordingConnection()
    engine = RecordingEngine(connection)
    storage = FakeBronzeStorage()
    storage.fail_on = {MOCK_REALTIME_PATHS[0]}  # ingestion_object_id 10
    _patch_bronze_storage(monkeypatch, storage)

    result = prune_bronze_storage(
        "stm",
        settings=BronzePruneSettings(),  # type: ignore[arg-type]
        engine=engine,  # type: ignore[arg-type]
        max_objects=3,
        max_batches=2,
    )

    select_params = _realtime_eligible_select_params(connection)
    assert len(select_params) == 2
    assert select_params[0]["excluded_object_ids"] == []
    assert select_params[1]["excluded_object_ids"] == [10]
    # The poisoned id is counted ONCE even though the mock re-returns it.
    assert result.failed_object_counts == {"realtime": 1, "static": 0}
    assert result.batch_counts == {"realtime": 2, "static": 1}


def test_prune_bronze_storage_breaks_loop_when_all_r2_deletes_fail(monkeypatch) -> None:
    connection = RecordingConnection()
    engine = RecordingEngine(connection)
    storage = FakeBronzeStorage()
    storage.fail_on = set(MOCK_REALTIME_PATHS)
    _patch_bronze_storage(monkeypatch, storage)

    result = prune_bronze_storage(
        "stm",
        settings=BronzePruneSettings(),  # type: ignore[arg-type]
        engine=engine,  # type: ignore[arg-type]
        max_objects=3,
        max_batches=5,
    )

    # A full batch with zero successful deletes (creds down) stops the loop
    # instead of burning the remaining batches on doomed HTTP calls.
    assert result.batch_counts["realtime"] == 1
    assert result.deleted_object_counts["realtime"] == 0
    assert result.failed_object_counts["realtime"] == 3
    assert result.exhausted is False


def test_prune_bronze_storage_dry_run_reports_unbounded_backlog_and_zero_batches(
    monkeypatch,
) -> None:
    connection = RecordingConnection()
    engine = RecordingEngine(connection)
    storage = FakeBronzeStorage()
    _patch_bronze_storage(monkeypatch, storage)

    result = prune_bronze_storage(
        "stm",
        settings=BronzePruneSettings(),  # type: ignore[arg-type]
        engine=engine,  # type: ignore[arg-type]
        dry_run=True,
    )

    assert result.deleted_object_counts == {"realtime": 12345, "static": 678}
    assert result.batch_counts == {"realtime": 0, "static": 0}
    assert result.failed_object_counts == {"realtime": 0, "static": 0}
    assert result.exhausted is False
    assert storage.deleted == []
    assert all("DELETE" not in sql for sql in connection.calls)


# ---------------------------------------------------------------------------
# BronzeStoragePruneResult
# ---------------------------------------------------------------------------


def test_bronze_prune_result_display_dict_formats_timestamps() -> None:
    result = BronzeStoragePruneResult(
        provider_id="stm",
        dry_run=True,
        realtime_retention_days=7,
        static_retention_days=30,
        realtime_cutoff_utc=datetime(2026, 3, 19, 20, 0, 0, tzinfo=UTC),
        static_cutoff_utc=datetime(2026, 2, 24, 20, 0, 0, tzinfo=UTC),
        deleted_object_counts={"realtime": 5, "static": 2},
        deleted_metadata_counts={"raw.ingestion_objects": 7},
        failed_object_counts={"realtime": 0, "static": 0},
        batch_counts={"realtime": 1, "static": 1},
        exhausted=True,
        completed_at_utc=datetime(2026, 3, 26, 20, 10, 0, tzinfo=UTC),
    )

    d = result.display_dict()
    assert d["dry_run"] is True
    assert d["realtime_cutoff_utc"] == "2026-03-19T20:00:00+00:00"
    assert d["static_cutoff_utc"] == "2026-02-24T20:00:00+00:00"
    assert d["completed_at_utc"] == "2026-03-26T20:10:00+00:00"
    assert d["deleted_object_counts"] == {"realtime": 5, "static": 2}


def test_bronze_prune_result_display_dict_includes_failed_batches_exhausted() -> None:
    result = BronzeStoragePruneResult(
        provider_id="stm",
        dry_run=False,
        realtime_retention_days=30,
        static_retention_days=365,
        realtime_cutoff_utc=datetime(2026, 5, 11, 7, 0, 0, tzinfo=UTC),
        static_cutoff_utc=datetime(2025, 6, 10, 7, 0, 0, tzinfo=UTC),
        deleted_object_counts={"realtime": 4998, "static": 0},
        deleted_metadata_counts={"raw.ingestion_objects": 4998},
        failed_object_counts={"realtime": 2, "static": 0},
        batch_counts={"realtime": 1, "static": 1},
        exhausted=False,
        completed_at_utc=datetime(2026, 6, 11, 7, 5, 0, tzinfo=UTC),
    )

    d = result.display_dict()
    assert d["failed_object_counts"] == {"realtime": 2, "static": 0}
    assert d["batch_counts"] == {"realtime": 1, "static": 1}
    assert d["exhausted"] is False


# ---------------------------------------------------------------------------
# i3 retention (slice-9.1.1l): prune_i3_raw_snapshots + prune_i3_silver_closed_rows
# ---------------------------------------------------------------------------


def test_vacuum_tables_include_i3_tables() -> None:
    for table_name in (
        "raw.i3_alert_snapshots",
        "silver.i3_alerts",
        "silver.i3_alert_informed_entities",
    ):
        assert table_name in VACUUM_TABLES


def test_prune_i3_raw_snapshots_sql_guards_silver_refs_and_latest() -> None:
    sql = str(SELECT_ELIGIBLE_I3_RAW_SNAPSHOTS)
    # FK-cascade trap guard: never delete a raw snapshot a silver row references.
    assert "NOT EXISTS" in sql
    assert "silver.i3_alerts" in sql
    # find_latest_i3_raw_snapshot guard: keep the per-provider latest snapshot.
    assert "<> COALESCE((" in sql
    assert "max(s2.i3_alert_snapshot_id)" in sql


def test_prune_i3_raw_snapshots_dry_run_counts_without_deleting() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 6, 13, 7, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, meta_counts, failed_ids = prune_i3_raw_snapshots(
        connection,
        provider_id="stm",
        retention_days=30,
        bronze_storage=storage,
        dry_run=True,
        now_utc=now_utc,
    )

    assert cutoff_utc == now_utc - timedelta(days=30)
    assert object_counts == {"i3_raw": 9876}
    assert meta_counts["raw.i3_alert_snapshots"] == 9876
    assert meta_counts["raw.ingestion_objects"] == 9876
    assert failed_ids == set()
    assert storage.deleted == []
    assert [c for c in connection.calls if "DELETE" in c] == []


def test_prune_i3_raw_snapshots_live_deletes_r2_then_metadata_in_fk_order() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 6, 13, 7, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, meta_counts, failed_ids = prune_i3_raw_snapshots(
        connection,
        provider_id="stm",
        retention_days=30,
        bronze_storage=storage,
        dry_run=False,
        now_utc=now_utc,
    )

    assert cutoff_utc is not None
    # 2 of the 3 eligible rows carry a storage_path (third is NULL path).
    assert object_counts["i3_raw"] == 2
    assert len(storage.deleted) == 2
    assert failed_ids == set()
    # Snapshots delete BEFORE ingestion_objects delete (FK order: snapshots ->
    # ingestion_objects -> ingestion_runs).
    snap_idx = next(
        i for i, c in enumerate(connection.calls)
        if "DELETE FROM raw.i3_alert_snapshots" in c
    )
    obj_idx = next(
        i for i, c in enumerate(connection.calls)
        if "DELETE FROM raw.ingestion_objects" in c
    )
    run_idx = next(
        i for i, c in enumerate(connection.calls)
        if "DELETE FROM raw.ingestion_runs" in c
    )
    assert snap_idx < obj_idx < run_idx
    assert meta_counts["raw.i3_alert_snapshots"] == 3


def test_prune_i3_raw_snapshots_skips_failed_r2_deletes() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    storage.fail_on = {"stm/i3_alerts/captured_at_utc=2026-01-01/a.json"}
    now_utc = datetime(2026, 6, 13, 7, 0, 0, tzinfo=UTC)

    _cutoff, object_counts, _meta, failed_ids = prune_i3_raw_snapshots(
        connection,
        provider_id="stm",
        retention_days=30,
        bronze_storage=storage,
        dry_run=False,
        now_utc=now_utc,
    )

    # One of the two path-bearing rows failed → only 1 deleted, snapshot 5001 skipped.
    assert object_counts["i3_raw"] == 1
    assert failed_ids == {5001}


def test_prune_i3_raw_snapshots_disabled_when_zero_retention() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()

    cutoff_utc, object_counts, _meta, failed_ids = prune_i3_raw_snapshots(
        connection,
        provider_id="stm",
        retention_days=0,
        bronze_storage=storage,
    )

    assert cutoff_utc is None
    assert object_counts == {"i3_raw": 0}
    assert failed_ids == set()
    assert len(connection.calls) == 0
    assert storage.deleted == []


def test_prune_i3_silver_closed_rows_deletes_entities_then_alerts() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 6, 13, 7, 0, 0, tzinfo=UTC)

    cutoff_utc, row_counts = prune_i3_silver_closed_rows(
        connection,
        provider_id="stm",
        retention_days=90,
        dry_run=False,
        now_utc=now_utc,
    )

    assert cutoff_utc == now_utc - timedelta(days=90)
    assert row_counts == {
        "silver.i3_alert_informed_entities": 7,
        "silver.i3_alerts": 4,
    }
    ent_idx = next(
        i for i, c in enumerate(connection.calls)
        if "DELETE FROM silver.i3_alert_informed_entities" in c
    )
    alert_idx = next(
        i for i, c in enumerate(connection.calls)
        if "DELETE FROM silver.i3_alerts" in c
    )
    assert ent_idx < alert_idx


def test_prune_i3_silver_closed_rows_floors_retention_at_30_days() -> None:
    connection = RecordingConnection()
    now_utc = datetime(2026, 6, 13, 7, 0, 0, tzinfo=UTC)

    cutoff_utc, _row_counts = prune_i3_silver_closed_rows(
        connection,
        provider_id="stm",
        retention_days=7,
        dry_run=True,
        now_utc=now_utc,
    )

    assert MIN_SILVER_I3_CLOSED_RETENTION_DAYS == 30
    # 7d requested but the 30d floor applies.
    assert cutoff_utc == now_utc - timedelta(days=30)


def test_prune_i3_silver_closed_rows_zero_retention_is_noop() -> None:
    connection = RecordingConnection()

    cutoff_utc, row_counts = prune_i3_silver_closed_rows(
        connection,
        provider_id="stm",
        retention_days=0,
    )

    assert cutoff_utc is None
    assert row_counts == {
        "silver.i3_alert_informed_entities": 0,
        "silver.i3_alerts": 0,
    }
    assert len(connection.calls) == 0


def test_i3_prune_result_display_dict_formats_timestamps() -> None:
    result = I3StoragePruneResult(
        provider_id="stm",
        dry_run=False,
        raw_retention_days=30,
        silver_closed_retention_days=90,
        raw_cutoff_utc=datetime(2026, 5, 14, 7, 0, 0, tzinfo=UTC),
        silver_cutoff_utc=datetime(2026, 3, 15, 7, 0, 0, tzinfo=UTC),
        deleted_object_counts={"i3_raw": 5},
        deleted_row_counts={
            "silver.i3_alert_informed_entities": 7,
            "silver.i3_alerts": 4,
            "raw.i3_alert_snapshots": 5,
            "raw.ingestion_objects": 5,
            "raw.ingestion_runs": 1,
        },
        failed_object_counts={"i3_raw": 0},
        completed_at_utc=datetime(2026, 6, 13, 7, 10, 0, tzinfo=UTC),
    )

    d = result.display_dict()
    assert d["raw_cutoff_utc"] == "2026-05-14T07:00:00+00:00"
    assert d["silver_cutoff_utc"] == "2026-03-15T07:00:00+00:00"
    assert d["completed_at_utc"] == "2026-06-13T07:10:00+00:00"
    assert d["deleted_object_counts"] == {"i3_raw": 5}
