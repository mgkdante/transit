from __future__ import annotations

import json

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
    "gold.route_delay_day_of_week",
    "gold.stop_delay_hourly",
    "gold.route_reliability_weekly",
    "gold.route_reliability_monthly",
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
    assert "gold.route_reliability_weekly" in by_family["trip_updates"].gold_outputs
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
    assert "gold.map_gis_line_features" in by_family["gis_static"].gold_outputs

    assert by_family["i3_alerts"].endpoint_key == "i3_alerts"
    assert by_family["i3_alerts"].raw_tables == ("raw.i3_alert_snapshots",)
    assert by_family["i3_alerts"].silver_tables == (
        "silver.i3_alerts",
        "silver.i3_alert_informed_entities",
    )
    assert by_family["i3_alerts"].gold_outputs == (
        "gold.current_i3_alerts",
        "gold.i3_alert_history_reporting",
        "gold.public_alert_impact_daily",
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


def test_reset_source_factory_tables_executes_the_reset_statement() -> None:
    connection = RecordingConnection()

    reset_source_factory_tables(connection)

    assert connection.statements == [build_source_factory_reset_statement()]
