from __future__ import annotations

import json

import pytest
from sqlalchemy.sql.elements import TextClause

from transit_ops.source_factory import catalog as catalog_module
from transit_ops.source_factory.catalog import (
    SOURCE_FACTORY_RESET_TABLES,
    build_source_factory_catalog,
    build_source_factory_reset_statement,
    reset_source_factory_tables,
)


def _silver_table(table_name: str) -> str:
    return f"silver.{table_name}"


LEGACY_SILVER_REALTIME_TABLES = {
    _silver_table("trip_" + "updates"),
    _silver_table("trip_update_stop_time_" + "updates"),
    _silver_table("vehicle_" + "positions"),
}

REPORTING_AGGREGATE_TABLES = (
    "gold.route_delay_hourly",
    "gold.stop_delay_hourly",
    "gold.stop_delay_weekly",
    "gold.stop_delay_monthly",
    "gold.route_habit_score",
    "gold.repeated_problem_route_stop",
    "gold.citizen_accountability_daily",
    "gold.report_labels",
)


class RecordingConnection:
    def __init__(self) -> None:
        self.statements: list[object] = []

    def execute(self, statement: object) -> None:
        self.statements.append(statement)


class _ProviderScopedResult:
    def __init__(self, first_value: object, rowcount: int = 0) -> None:
        self._first = first_value
        self.rowcount = rowcount

    def first(self) -> object:
        return self._first


class _ProviderScopedConnection:
    """Fake connection for the per-provider reset path.

    Answers the ``information_schema`` provider_id probes (every table is scoped
    except those passed in ``tables_without_provider_id``) and records each
    DELETE the reset issues, so the test can assert what got deleted, in what
    order, and with which bound parameters — without a real database.
    """

    def __init__(self, tables_without_provider_id: set[str]) -> None:
        self._tables_without_provider_id = tables_without_provider_id
        self.deletes: list[tuple[str, dict[str, object]]] = []
        self.delete_sql: list[str] = []

    def execute(
        self, statement: object, parameters: dict[str, object] | None = None
    ) -> _ProviderScopedResult:
        sql = str(statement)
        params = parameters or {}
        if "information_schema.columns" in sql:
            qualified = f"{params['schema']}.{params['table']}"
            has_provider_id = qualified not in self._tables_without_provider_id
            return _ProviderScopedResult((1,) if has_provider_id else None)
        # DELETE FROM <schema.table> WHERE provider_id = :provider_id
        table = sql.split("DELETE FROM ", 1)[1].split(" WHERE", 1)[0].strip()
        self.deletes.append((table, params))
        self.delete_sql.append(sql)
        return _ProviderScopedResult(None, rowcount=0)


def test_catalog_covers_expected_stm_source_families() -> None:
    catalog = build_source_factory_catalog("stm")

    by_family = {source.family: source for source in catalog.sources}

    assert list(by_family) == [
        "static_schedule",
        "trip_updates",
        "vehicle_positions",
        "gis_static",
        "i3_alerts",
    ]
    assert by_family["static_schedule"].required is True
    assert by_family["trip_updates"].required is True
    assert by_family["vehicle_positions"].required is True
    assert by_family["gis_static"].required is False
    assert by_family["i3_alerts"].required is False
    assert by_family["trip_updates"].sibling_group == "gtfs_rt"
    assert by_family["vehicle_positions"].sibling_group == "gtfs_rt"
    assert by_family["gis_static"].sibling_group is None
    assert by_family["i3_alerts"].sibling_group is None


def test_catalog_marks_realtime_optional_for_static_only_provider() -> None:
    # A static-only / static+alerts provider has no trip/vehicle bronze, so the
    # rebuild must not hard-require those sources.
    catalog = build_source_factory_catalog(
        "sts", present_feed_kinds={"static_schedule", "service_alerts"}
    )

    by_family = {source.family: source for source in catalog.sources}
    assert by_family["static_schedule"].required is True
    assert by_family["trip_updates"].required is False
    assert by_family["vehicle_positions"].required is False


def test_catalog_keeps_realtime_required_when_provider_publishes_them() -> None:
    catalog = build_source_factory_catalog(
        "stm",
        present_feed_kinds={"static_schedule", "trip_updates", "vehicle_positions"},
    )

    by_family = {source.family: source for source in catalog.sources}
    assert by_family["trip_updates"].required is True
    assert by_family["vehicle_positions"].required is True


def test_catalog_uses_provider_scoped_bronze_prefixes_and_strategies() -> None:
    catalog = build_source_factory_catalog("stm")

    by_family = {source.family: source for source in catalog.sources}

    assert by_family["static_schedule"].bronze_prefix == "stm/static_schedule/"
    assert by_family["trip_updates"].bronze_prefix == "stm/trip_updates/"
    assert by_family["vehicle_positions"].bronze_prefix == "stm/vehicle_positions/"
    assert by_family["gis_static"].bronze_prefix == "stm/gis_static/"
    assert by_family["i3_alerts"].bronze_prefix == "stm/i3_alerts/"
    assert (
        by_family["static_schedule"].backfill_strategy
        == "existing_bronze_static_or_live_static_source"
    )
    assert by_family["gis_static"].backfill_strategy == "where_available"
    assert by_family["i3_alerts"].backfill_strategy == "where_available"


def test_catalog_declares_source_table_contract_by_family() -> None:
    catalog = build_source_factory_catalog("stm")
    by_family = {source.family: source for source in catalog.sources}

    assert by_family["static_schedule"].endpoint_key == "static_schedule"
    assert by_family["static_schedule"].raw_tables == (
        "raw.ingestion_runs",
        "raw.ingestion_objects",
        "core.dataset_versions",
    )
    assert "silver.gtfs_source_members" in by_family["static_schedule"].silver_tables
    assert "gold.fact_stop_time_delay_observation" in by_family["static_schedule"].gold_outputs

    assert by_family["trip_updates"].endpoint_key == "trip_updates"
    assert by_family["trip_updates"].raw_tables == ("raw.realtime_snapshot_index",)
    assert {
        "silver.rt_feed_snapshots",
        "silver.rt_entities",
        "silver.rt_trip_updates",
        "silver.rt_trip_update_stop_times",
    }.issubset(set(by_family["trip_updates"].silver_tables))
    assert LEGACY_SILVER_REALTIME_TABLES.isdisjoint(
        by_family["trip_updates"].silver_tables
    )
    assert "gold.fact_trip_delay_snapshot" in by_family["trip_updates"].gold_outputs
    assert "gold.trip_delay_summary_5m" in by_family["trip_updates"].gold_outputs
    assert "gold.route_delay_hourly" in by_family["trip_updates"].gold_outputs
    assert "gold.stop_delay_hourly" in by_family["trip_updates"].gold_outputs
    assert "gold.stop_delay_weekly" in by_family["trip_updates"].gold_outputs
    assert "gold.stop_delay_monthly" in by_family["trip_updates"].gold_outputs

    assert by_family["vehicle_positions"].endpoint_key == "vehicle_positions"
    assert by_family["vehicle_positions"].raw_tables == ("raw.realtime_snapshot_index",)
    assert {
        "silver.rt_feed_snapshots",
        "silver.rt_entities",
        "silver.rt_vehicle_positions",
    }.issubset(set(by_family["vehicle_positions"].silver_tables))
    assert LEGACY_SILVER_REALTIME_TABLES.isdisjoint(
        by_family["vehicle_positions"].silver_tables
    )
    assert "gold.fact_vehicle_snapshot" in by_family["vehicle_positions"].gold_outputs
    assert "gold.current_vehicle_map" in by_family["vehicle_positions"].gold_outputs

    assert by_family["gis_static"].endpoint_key == "gis_static"
    assert by_family["gis_static"].raw_tables == (
        "raw.ingestion_runs",
        "raw.ingestion_objects",
        "core.dataset_versions",
    )
    assert by_family["gis_static"].silver_tables == (
        "silver.gis_datasets",
        "silver.gis_stop_features",
        "silver.gis_line_features",
        "silver.gis_gtfs_matches",
    )
    # map_gis_line_features + map_stops were dropped (migration 0059 — probe-only, no reader).
    assert by_family["gis_static"].gold_outputs == ("gold.map_route_lines",)

    assert by_family["i3_alerts"].endpoint_key == "i3_alerts"
    assert by_family["i3_alerts"].raw_tables == ("raw.i3_alert_snapshots",)
    assert by_family["i3_alerts"].silver_tables == (
        "silver.i3_alerts",
        "silver.i3_alert_informed_entities",
    )
    assert by_family["i3_alerts"].gold_outputs == (
        "gold.current_i3_alerts",
        "gold.i3_alert_history_reporting",
        "gold.citizen_accountability_daily",
    )


def test_catalog_declares_clean_reporting_outputs_without_legacy_silver() -> None:
    catalog = build_source_factory_catalog("stm")

    all_silver_tables = {
        table for source in catalog.sources for table in source.silver_tables
    }
    all_gold_outputs = {
        output for source in catalog.sources for output in source.gold_outputs
    }

    assert LEGACY_SILVER_REALTIME_TABLES.isdisjoint(all_silver_tables)
    assert set(REPORTING_AGGREGATE_TABLES).issubset(all_gold_outputs)
    assert "gold.report_labels" in all_gold_outputs


def test_catalog_display_dict_json_dumps_cleanly() -> None:
    catalog = build_source_factory_catalog("stm")

    payload = catalog.display_dict()

    json.dumps(payload, sort_keys=True)
    assert payload["provider_id"] == "stm"
    assert payload["reset_tables"] == list(SOURCE_FACTORY_RESET_TABLES)
    assert payload["sources"][0]["family"] == "static_schedule"


def test_reset_table_list_includes_source_abundance_gis_and_i3_tables() -> None:
    assert "silver.gtfs_extra_rows" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.gtfs_source_members" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.rt_feed_snapshots" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.rt_entities" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.rt_trip_updates" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.rt_trip_update_stop_times" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.rt_vehicle_positions" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.gis_datasets" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.gis_stop_features" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.gis_line_features" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.gis_gtfs_matches" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.i3_alerts" in SOURCE_FACTORY_RESET_TABLES
    assert "silver.i3_alert_informed_entities" in SOURCE_FACTORY_RESET_TABLES
    assert "raw.i3_alert_snapshots" in SOURCE_FACTORY_RESET_TABLES
    assert "core.providers" not in SOURCE_FACTORY_RESET_TABLES
    assert "core.feed_endpoints" not in SOURCE_FACTORY_RESET_TABLES


def test_reset_table_list_matches_clean_reporting_foundation() -> None:
    immutable_receipt_history = getattr(
        catalog_module,
        "IMMUTABLE_RECEIPT_HISTORY_TABLES",
        (),
    )

    assert immutable_receipt_history == (
        "gold.route_delay_hourly",
        "gold.stop_delay_hourly",
        "gold.citizen_accountability_daily",
    )
    assert LEGACY_SILVER_REALTIME_TABLES.isdisjoint(SOURCE_FACTORY_RESET_TABLES)
    assert set(immutable_receipt_history).isdisjoint(SOURCE_FACTORY_RESET_TABLES)
    assert (
        set(REPORTING_AGGREGATE_TABLES) - set(immutable_receipt_history)
    ).issubset(SOURCE_FACTORY_RESET_TABLES)
    assert "gold.route_delay_hourly" not in str(build_source_factory_reset_statement())
    assert "gold.stop_delay_hourly" not in str(build_source_factory_reset_statement())
    assert "gold.citizen_accountability_daily" not in str(
        build_source_factory_reset_statement()
    )
    assert SOURCE_FACTORY_RESET_TABLES.index("gold.report_labels") < (
        SOURCE_FACTORY_RESET_TABLES.index("gold.dim_date")
    )


def test_reset_statement_truncates_all_source_factory_tables() -> None:
    statement = build_source_factory_reset_statement()
    sql = str(statement)

    assert isinstance(statement, TextClause)
    assert "TRUNCATE TABLE" in sql
    assert "RESTART IDENTITY CASCADE" in sql
    for table_name in SOURCE_FACTORY_RESET_TABLES:
        assert table_name in sql
    for table_name in LEGACY_SILVER_REALTIME_TABLES:
        assert table_name not in sql


def test_reset_all_providers_executes_the_truncate_statement() -> None:
    connection = RecordingConnection()

    summary = reset_source_factory_tables(connection, all_providers=True)

    assert connection.statements == [build_source_factory_reset_statement()]
    assert summary["mode"] == "all_providers"


def test_reset_requires_provider_id_without_all_providers() -> None:
    connection = RecordingConnection()

    with pytest.raises(ValueError, match="requires a provider_id"):
        reset_source_factory_tables(connection)

    assert connection.statements == []


def test_reset_per_provider_deletes_only_scoped_rows_and_skips_shared_seeds() -> None:
    # gold.report_labels is the one reset table with no provider_id column; it is
    # a shared seed and must survive a single-provider rebuild.
    connection = _ProviderScopedConnection(
        tables_without_provider_id={"gold.report_labels"}
    )

    summary = reset_source_factory_tables(connection, "sto")

    assert summary["mode"] == "per_provider"
    assert summary["provider_id"] == "sto"
    assert summary["skipped_tables"] == ["gold.report_labels"]

    # Every scoped table is deleted exactly once, in the catalog's child->parent
    # order, scoped to the provider; the shared seed is never deleted.
    expected_deleted = [
        table for table in SOURCE_FACTORY_RESET_TABLES if table != "gold.report_labels"
    ]
    assert [table for table, _ in connection.deletes] == expected_deleted
    assert set(summary["deleted_row_counts"]) == set(expected_deleted)
    assert all(params == {"provider_id": "sto"} for _, params in connection.deletes)
    assert not any("report_labels" in sql for sql in connection.delete_sql)
    assert all("WHERE provider_id = :provider_id" in sql for sql in connection.delete_sql)
