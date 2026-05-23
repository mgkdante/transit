from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from transit_ops.rebuild.parity import (
    FRESHNESS_TARGETS,
    KPI_VIEWS,
    PARITY_ROW_COUNT_TABLES,
    ParityEvidenceReport,
    collect_parity_evidence,
)

EXPECTED_ROW_COUNT_TABLES = (
    "raw.ingestion_runs",
    "raw.ingestion_objects",
    "raw.realtime_snapshot_index",
    "silver.routes",
    "silver.stops",
    "silver.trips",
    "silver.stop_times",
    "silver.calendar",
    "silver.calendar_dates",
    "silver.trip_updates",
    "silver.trip_update_stop_time_updates",
    "silver.vehicle_positions",
    "gold.dim_route",
    "gold.dim_stop",
    "gold.dim_date",
    "gold.dim_direction",
    "gold.fact_vehicle_snapshot",
    "gold.fact_trip_delay_snapshot",
    "gold.latest_vehicle_snapshot",
    "gold.latest_trip_delay_snapshot",
    "gold.vehicle_summary_5m",
    "gold.trip_delay_summary_5m",
    "gold.warm_rollup_periods",
)

EXPECTED_FRESHNESS_TARGETS = (
    "raw.ingestion_runs.completed_at_utc",
    "raw.realtime_snapshot_index.captured_at_utc",
    "silver.trip_updates.captured_at_utc",
    "silver.vehicle_positions.captured_at_utc",
    "gold.fact_trip_delay_snapshot.captured_at_utc",
    "gold.fact_vehicle_snapshot.captured_at_utc",
    "gold.latest_trip_delay_snapshot.captured_at_utc",
    "gold.latest_vehicle_snapshot.captured_at_utc",
    "gold.vehicle_summary_5m.period_start_utc",
    "gold.trip_delay_summary_5m.period_start_utc",
    "gold.warm_rollup_periods.period_start_utc",
)

EXPECTED_KPI_VIEWS = (
    "gold.kpi_active_vehicles_latest",
    "gold.kpi_routes_with_live_vehicles_latest",
    "gold.kpi_avg_trip_delay_latest",
    "gold.kpi_max_trip_delay_latest",
    "gold.kpi_delayed_trip_count_latest",
)


class FakeResult:
    def __init__(
        self,
        *,
        scalar_value: object | None = None,
        mapping_rows: list[dict[str, object]] | None = None,
    ) -> None:
        self.scalar_value = scalar_value
        self.mapping_rows = mapping_rows or []

    def scalar_one(self) -> object:
        return self.scalar_value

    def scalar_one_or_none(self) -> object | None:
        return self.scalar_value

    def mappings(self) -> FakeResult:
        return self

    def __iter__(self):  # noqa: ANN204
        return iter(self.mapping_rows)


class RecordingParityConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.counts = {table: index for index, table in enumerate(EXPECTED_ROW_COUNT_TABLES, 1)}
        self.freshness = {
            target: datetime(2026, 5, 20, 12, index, tzinfo=UTC)
            for index, target in enumerate(EXPECTED_FRESHNESS_TARGETS)
        }
        self.kpi_rows = {
            view: [
                {
                    "provider_id": "stm",
                    "realtime_snapshot_id": 9,
                    "feed_timestamp_utc": datetime(2026, 5, 20, 12, 0, tzinfo=UTC),
                    "metric_date": date(2026, 5, 20),
                    "metric_value": Decimal("12.50"),
                    "captured_at_utc": datetime(2026, 5, 20, 12, 5, tzinfo=UTC),
                }
            ]
            for view in EXPECTED_KPI_VIEWS
        }
        self.kpi_rows["gold.kpi_active_vehicles_latest"] = [
            {
                "provider_id": "stm",
                "realtime_snapshot_id": 3,
                "feed_timestamp_utc": datetime(2026, 5, 20, 12, 1, tzinfo=UTC),
                "captured_at_utc": datetime(2026, 5, 20, 12, 6, tzinfo=UTC),
                "active_vehicle_count": 30,
            },
            {
                "provider_id": "stm",
                "realtime_snapshot_id": 2,
                "feed_timestamp_utc": datetime(2026, 5, 20, 12, 0, tzinfo=UTC),
                "captured_at_utc": datetime(2026, 5, 20, 12, 5, tzinfo=UTC),
                "active_vehicle_count": 20,
            },
        ]
        self.gold_relations = [
            {"relation_name": "kpi_active_vehicles_latest", "relation_type": "VIEW"},
            {"relation_name": "dim_route", "relation_type": "BASE TABLE"},
            {"relation_name": "fact_vehicle_snapshot", "relation_type": "BASE TABLE"},
        ]

    def execute(self, statement, params=None):  # noqa: ANN001, ANN201
        sql = str(statement)
        call_params = dict(params or {})
        self.calls.append((sql, call_params))

        if "SELECT count(*)" in sql:
            return FakeResult(scalar_value=self.counts[_table_from_count_sql(sql)])

        if "SELECT max(" in sql:
            return FakeResult(scalar_value=self.freshness[_target_from_freshness_sql(sql)])

        for view, rows in self.kpi_rows.items():
            if f"FROM {view}" in sql:
                if (
                    "ORDER BY provider_id, realtime_snapshot_id, "
                    "captured_at_utc, feed_timestamp_utc"
                ) in sql:
                    rows = sorted(
                        rows,
                        key=lambda row: (
                            row["provider_id"],
                            row["realtime_snapshot_id"],
                            row["captured_at_utc"],
                            row["feed_timestamp_utc"],
                        ),
                    )
                return FakeResult(mapping_rows=rows)

        if "information_schema.tables" in sql:
            return FakeResult(mapping_rows=self.gold_relations)

        raise AssertionError(f"Unexpected SQL: {sql}")


def _table_from_count_sql(sql: str) -> str:
    if "raw.ingestion_objects AS io" in sql:
        return "raw.ingestion_objects"

    from_fragment = sql.split("FROM ", maxsplit=1)[1]
    return from_fragment.split()[0]


def _target_from_freshness_sql(sql: str) -> str:
    column = sql.split("SELECT max(", maxsplit=1)[1].split(")", maxsplit=1)[0]
    table = sql.split("FROM ", maxsplit=1)[1].split()[0]
    return f"{table}.{column}"


def test_collect_parity_counts_all_required_tables_by_fully_qualified_name() -> None:
    connection = RecordingParityConnection()

    report = collect_parity_evidence(
        connection,
        provider_id="stm",
        captured_at_utc=datetime(2026, 5, 20, 13, 0, tzinfo=UTC),
    )

    assert PARITY_ROW_COUNT_TABLES == EXPECTED_ROW_COUNT_TABLES
    assert tuple(report.row_counts) == EXPECTED_ROW_COUNT_TABLES
    assert report.row_counts == connection.counts


def test_ingestion_objects_count_joins_ingestion_runs_for_provider_scope() -> None:
    connection = RecordingParityConnection()

    collect_parity_evidence(connection, provider_id="stm")

    sql, params = next(
        call for call in connection.calls if "FROM raw.ingestion_objects AS io" in call[0]
    )
    assert "JOIN raw.ingestion_runs AS ir" in sql
    assert "io.ingestion_run_id = ir.ingestion_run_id" in sql
    assert "io.provider_id = :provider_id" in sql
    assert "ir.provider_id = :provider_id" in sql
    assert params == {"provider_id": "stm"}


def test_provider_scoped_row_counts_use_provider_filter() -> None:
    connection = RecordingParityConnection()

    collect_parity_evidence(connection, provider_id="stm")

    for table in EXPECTED_ROW_COUNT_TABLES:
        if table == "raw.ingestion_objects":
            continue
        sql, params = next(
            call for call in connection.calls if "SELECT count(*)" in call[0] and table in call[0]
        )
        assert f"FROM {table}" in sql
        assert "WHERE provider_id = :provider_id" in sql
        assert params == {"provider_id": "stm"}


def test_kpi_views_are_whitelisted_provider_scoped_and_json_safe() -> None:
    connection = RecordingParityConnection()

    report = collect_parity_evidence(connection, provider_id="stm")
    display = report.display_dict()

    assert KPI_VIEWS == EXPECTED_KPI_VIEWS
    for view in EXPECTED_KPI_VIEWS:
        sql, params = next(call for call in connection.calls if f"FROM {view}" in call[0])
        assert f"SELECT * FROM {view}" in sql
        assert "WHERE provider_id = :provider_id" in sql
        assert (
            "ORDER BY provider_id, realtime_snapshot_id, captured_at_utc, feed_timestamp_utc"
            in sql
        )
        assert params == {"provider_id": "stm"}

    first_row = display["kpi_rows"]["gold.kpi_active_vehicles_latest"][0]
    assert first_row == {
        "active_vehicle_count": 20,
        "captured_at_utc": "2026-05-20T12:05:00+00:00",
        "feed_timestamp_utc": "2026-05-20T12:00:00+00:00",
        "provider_id": "stm",
        "realtime_snapshot_id": 2,
    }


def test_gold_relation_inventory_filters_gold_schema_only_and_orders_output() -> None:
    connection = RecordingParityConnection()

    report = collect_parity_evidence(connection, provider_id="stm")

    sql, params = next(call for call in connection.calls if "information_schema.tables" in call[0])
    assert "WHERE table_schema = 'gold'" in sql
    assert "ORDER BY relation_name, relation_type" in sql
    assert params == {}
    assert report.display_dict()["gold_relations"] == [
        {"relation_name": "dim_route", "relation_type": "BASE TABLE"},
        {"relation_name": "fact_vehicle_snapshot", "relation_type": "BASE TABLE"},
        {"relation_name": "kpi_active_vehicles_latest", "relation_type": "VIEW"},
    ]


def test_display_dict_serializes_captured_at_and_nested_values_safely() -> None:
    report = ParityEvidenceReport(
        provider_id="stm",
        captured_at_utc=datetime(2026, 5, 20, 13, 0, tzinfo=UTC),
        row_counts={"silver.routes": 2, "raw.ingestion_runs": 1},
        freshness={
            "silver.trip_updates.captured_at_utc": datetime(2026, 5, 20, 12, 30, tzinfo=UTC),
            "gold.dim_date.service_date": date(2026, 5, 20),
        },
        kpi_rows={
            "gold.kpi_avg_trip_delay_latest": [
                {
                    "provider_id": "stm",
                    "avg_delay_seconds": Decimal("90.5"),
                    "captured_at_utc": datetime(2026, 5, 20, 12, 45, tzinfo=UTC),
                }
            ]
        },
        gold_relations=[
            {"relation_type": "VIEW", "relation_name": "z_view"},
            {"relation_type": "BASE TABLE", "relation_name": "a_table"},
        ],
    )

    assert FRESHNESS_TARGETS == EXPECTED_FRESHNESS_TARGETS
    assert report.display_dict() == {
        "provider_id": "stm",
        "captured_at_utc": "2026-05-20T13:00:00+00:00",
        "row_counts": {
            "raw.ingestion_runs": 1,
            "silver.routes": 2,
        },
        "freshness": {
            "gold.dim_date.service_date": "2026-05-20",
            "silver.trip_updates.captured_at_utc": "2026-05-20T12:30:00+00:00",
        },
        "kpi_rows": {
            "gold.kpi_avg_trip_delay_latest": [
                {
                    "avg_delay_seconds": "90.5",
                    "captured_at_utc": "2026-05-20T12:45:00+00:00",
                    "provider_id": "stm",
                }
            ]
        },
        "gold_relations": [
            {"relation_name": "a_table", "relation_type": "BASE TABLE"},
            {"relation_name": "z_view", "relation_type": "VIEW"},
        ],
    }
