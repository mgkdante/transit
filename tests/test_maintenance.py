from __future__ import annotations

from datetime import UTC, datetime

from transit_ops.maintenance import (
    GoldStoragePruneResult,
    SilverStoragePruneResult,
    prune_gold_fact_history,
    prune_realtime_silver_history,
    prune_static_silver_datasets,
)


class IterableResult:
    def __init__(self, rows: list[tuple[int]]) -> None:
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
        return RowcountResult(0)


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


def test_prune_result_display_dict_formats_timestamps() -> None:
    result = SilverStoragePruneResult(
        provider_id="stm",
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
        retention_days=2,
        cutoff_utc=datetime(2026, 3, 24, 20, 0, 0, tzinfo=UTC),
        deleted_row_counts={"gold.fact_trip_delay_snapshot": 500},
        completed_at_utc=datetime(2026, 3, 26, 20, 10, 0, tzinfo=UTC),
    )

    assert result.display_dict()["cutoff_utc"] == "2026-03-24T20:00:00+00:00"
    assert result.display_dict()["completed_at_utc"] == "2026-03-26T20:10:00+00:00"
