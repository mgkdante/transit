from __future__ import annotations

from datetime import UTC, datetime

from transit_ops.maintenance import (
    BronzeStoragePruneResult,
    GoldStoragePruneResult,
    SilverStoragePruneResult,
    prune_bronze_realtime_objects,
    prune_bronze_static_objects,
    prune_gold_fact_history,
    prune_realtime_silver_history,
    prune_static_silver_datasets,
)


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


class RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append(sql_text)
        if "SELECT dataset_version_id" in sql_text:
            return IterableResult([(7,), (6,), (5,)])
        # DELETE statements return rowcount
        if "DELETE FROM silver.stop_times" in sql_text:
            return RowcountResult(12)
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
        if "DELETE FROM core.dataset_versions" in sql_text:
            return RowcountResult(2)
        if "DELETE FROM silver.trip_update_stop_time_updates" in sql_text:
            return RowcountResult(200)
        if "DELETE FROM silver.trip_updates" in sql_text:
            return RowcountResult(20)
        if "DELETE FROM silver.vehicle_positions" in sql_text:
            return RowcountResult(10)
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
        if "SELECT COUNT(*) FROM core.dataset_versions" in sql_text:
            return ScalarResult(2)
        if "SELECT COUNT(*) FROM silver.trip_update_stop_time_updates" in sql_text:
            return ScalarResult(200)
        if "SELECT COUNT(*) FROM silver.trip_updates" in sql_text:
            return ScalarResult(20)
        if "SELECT COUNT(*) FROM silver.vehicle_positions" in sql_text:
            return ScalarResult(10)
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
        "silver.calendar_dates": 4,
        "silver.calendar": 2,
        "silver.trips": 8,
        "silver.stops": 3,
        "silver.routes": 1,
        "core.dataset_versions": 2,
    }


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
        "silver.calendar_dates": 4,
        "silver.calendar": 2,
        "silver.trips": 8,
        "silver.stops": 3,
        "silver.routes": 1,
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
        "silver.trip_update_stop_time_updates": 200,
        "silver.trip_updates": 20,
        "silver.vehicle_positions": 10,
    }


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
        "silver.trip_update_stop_time_updates": 200,
        "silver.trip_updates": 20,
        "silver.vehicle_positions": 10,
    }
    delete_calls = [c for c in connection.calls if "DELETE" in c]
    assert delete_calls == [], f"Expected no DELETE calls in dry_run but got: {delete_calls}"


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
