from __future__ import annotations

import inspect
from datetime import UTC, datetime

import pytest

from transit_ops import maintenance as maintenance_module
from transit_ops.maintenance import (
    REALTIME_SILVER_TABLES,
    SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
    VACUUM_TABLES,
    BronzeStoragePruneResult,
    GoldStoragePruneResult,
    SilverStoragePruneResult,
    WarmRollupStoragePruneResult,
    prune_bronze_realtime_objects,
    prune_bronze_static_objects,
    prune_gold_fact_history,
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

    def begin(self) -> RecordingConnection:
        return self.connection


class RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def __enter__(self) -> RecordingConnection:
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:  # noqa: ANN001
        return None

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append(sql_text)
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

    retained_dataset_version_ids, pruned_dataset_version_ids, deleted_row_counts = (
        prune_static_silver_datasets(
            connection,
            provider_id="stm",
            retention_count=1,
        )
    )

    assert retained_dataset_version_ids == [7]
    assert pruned_dataset_version_ids == [6, 5]
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

    retained_ids, pruned_ids, counts = prune_static_silver_datasets(
        connection,
        provider_id="stm",
        retention_count=1,
        dry_run=True,
    )

    assert retained_ids == [7]
    assert pruned_ids == [6, 5]
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


def test_bronze_realtime_prune_waits_for_source_snapshot_rows_to_be_gone() -> None:
    sql = str(SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS)

    assert "silver.rt_feed_snapshots" in sql
    assert "source_realtime_snapshot_id" in sql
    for dropped_table in DROPPED_LEGACY_SILVER_REALTIME_TABLES:
        assert dropped_table not in sql


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


def test_prune_result_display_dict_formats_timestamps() -> None:
    result = SilverStoragePruneResult(
        provider_id="stm",
        dry_run=False,
        static_dataset_retention_count=1,
        realtime_retention_days=2,
        retained_dataset_version_ids=[7],
        pruned_dataset_version_ids=[6, 5],
        realtime_cutoff_utc=datetime(2026, 3, 24, 20, 0, 0, tzinfo=UTC),
        deleted_row_counts={"silver.stop_times": 12},
        completed_at_utc=datetime(2026, 3, 26, 20, 10, 0, tzinfo=UTC),
    )

    assert result.display_dict()["realtime_cutoff_utc"] == "2026-03-24T20:00:00+00:00"
    assert result.display_dict()["completed_at_utc"] == "2026-03-26T20:10:00+00:00"
    assert result.display_dict()["dry_run"] is False


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

    cutoff_utc, object_counts, meta_counts = prune_bronze_realtime_objects(
        connection,
        provider_id="stm",
        retention_days=7,
        bronze_storage=storage,
        dry_run=True,
        now_utc=now_utc,
    )

    assert cutoff_utc is not None
    # 3 rows returned by mock
    assert object_counts == {"realtime": 3}
    assert meta_counts["raw.realtime_snapshot_index"] == 3
    assert meta_counts["raw.ingestion_objects"] == 3
    # No actual deletions
    assert storage.deleted == []
    delete_calls = [c for c in connection.calls if "DELETE" in c]
    assert delete_calls == []


def test_prune_bronze_realtime_objects_live_deletes_r2_then_metadata() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, meta_counts = prune_bronze_realtime_objects(
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

    cutoff_utc, object_counts, _meta = prune_bronze_realtime_objects(
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


def test_prune_bronze_realtime_objects_disabled_when_zero_retention() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()

    cutoff_utc, object_counts, meta_counts = prune_bronze_realtime_objects(
        connection,
        provider_id="stm",
        retention_days=0,
        bronze_storage=storage,
    )

    assert cutoff_utc is None
    assert object_counts == {"realtime": 0}
    assert len(connection.calls) == 0
    assert storage.deleted == []


# ---------------------------------------------------------------------------
# prune_bronze_static_objects
# ---------------------------------------------------------------------------


def test_prune_bronze_static_objects_dry_run_returns_eligible_count_without_deleting() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, meta_counts = prune_bronze_static_objects(
        connection,
        provider_id="stm",
        retention_days=30,
        bronze_storage=storage,
        dry_run=True,
        now_utc=now_utc,
    )

    assert cutoff_utc is not None
    assert object_counts == {"static": 1}
    assert meta_counts["raw.ingestion_objects"] == 1
    assert storage.deleted == []
    delete_calls = [c for c in connection.calls if "DELETE" in c]
    assert delete_calls == []


def test_prune_bronze_static_objects_live_deletes_r2_then_metadata() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()
    now_utc = datetime(2026, 3, 26, 20, 0, 0, tzinfo=UTC)

    cutoff_utc, object_counts, meta_counts = prune_bronze_static_objects(
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
    obj_deletes = [c for c in connection.calls if "DELETE FROM raw.ingestion_objects" in c]
    assert len(obj_deletes) == 1
    assert meta_counts["raw.ingestion_objects"] == 3  # mock rowcount


def test_prune_bronze_static_objects_disabled_when_zero_retention() -> None:
    connection = RecordingConnection()
    storage = FakeBronzeStorage()

    cutoff_utc, object_counts, _ = prune_bronze_static_objects(
        connection,
        provider_id="stm",
        retention_days=0,
        bronze_storage=storage,
    )

    assert cutoff_utc is None
    assert object_counts == {"static": 0}
    assert len(connection.calls) == 0


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
        completed_at_utc=datetime(2026, 3, 26, 20, 10, 0, tzinfo=UTC),
    )

    d = result.display_dict()
    assert d["dry_run"] is True
    assert d["realtime_cutoff_utc"] == "2026-03-19T20:00:00+00:00"
    assert d["static_cutoff_utc"] == "2026-02-24T20:00:00+00:00"
    assert d["completed_at_utc"] == "2026-03-26T20:10:00+00:00"
    assert d["deleted_object_counts"] == {"realtime": 5, "static": 2}
