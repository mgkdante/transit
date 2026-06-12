from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.sql.elements import TextClause


@dataclass(frozen=True)
class SourceFactorySource:
    family: str
    endpoint_key: str
    required: bool
    bronze_prefix: str
    raw_tables: tuple[str, ...]
    silver_tables: tuple[str, ...]
    gold_outputs: tuple[str, ...]
    backfill_strategy: str
    sibling_group: str | None = None

    def display_dict(self) -> dict[str, object]:
        return {
            "family": self.family,
            "endpoint_key": self.endpoint_key,
            "required": self.required,
            "bronze_prefix": self.bronze_prefix,
            "raw_tables": list(self.raw_tables),
            "silver_tables": list(self.silver_tables),
            "gold_outputs": list(self.gold_outputs),
            "backfill_strategy": self.backfill_strategy,
            "sibling_group": self.sibling_group,
        }


@dataclass(frozen=True)
class SourceFactoryCatalog:
    provider_id: str
    sources: tuple[SourceFactorySource, ...]
    reset_tables: tuple[str, ...]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "sources": [source.display_dict() for source in self.sources],
            "reset_tables": list(self.reset_tables),
        }


IMMUTABLE_RECEIPT_HISTORY_TABLES: tuple[str, ...] = (
    "gold.route_delay_hourly",
    "gold.stop_delay_hourly",
    "gold.citizen_accountability_daily",
)


SOURCE_FACTORY_RESET_TABLES: tuple[str, ...] = (
    "gold.report_labels",
    "gold.repeated_problem_route_stop",
    "gold.route_habit_score",
    "gold.stop_delay_monthly",
    "gold.stop_delay_weekly",
    "gold.route_reliability_monthly",
    "gold.route_reliability_weekly",
    "gold.route_delay_day_of_week",
    "gold.vehicle_summary_5m",
    "gold.trip_delay_summary_5m",
    "gold.warm_rollup_periods",
    "gold.latest_trip_delay_snapshot",
    "gold.latest_vehicle_snapshot",
    "gold.fact_trip_delay_snapshot",
    "gold.fact_vehicle_snapshot",
    "gold.dim_date",
    "gold.dim_direction",
    "gold.dim_route_pattern",
    "gold.dim_stop",
    "gold.dim_route",
    "silver.i3_alert_informed_entities",
    "silver.i3_alerts",
    "silver.gis_gtfs_matches",
    "silver.gis_line_features",
    "silver.gis_stop_features",
    "silver.gis_datasets",
    "silver.gtfs_extra_rows",
    "silver.gtfs_source_members",
    "silver.rt_trip_update_stop_times",
    "silver.rt_trip_updates",
    "silver.rt_vehicle_positions",
    "silver.rt_entities",
    "silver.rt_feed_snapshots",
    "silver.translations",
    "silver.shapes",
    "silver.stop_times",
    "silver.calendar_dates",
    "silver.calendar",
    "silver.trips",
    "silver.route_patterns",
    "silver.directions",
    "silver.stops",
    "silver.routes",
    "silver.feed_info",
    "silver.agency",
    "core.dataset_versions",
    "raw.i3_alert_snapshots",
    "raw.realtime_snapshot_index",
    "raw.ingestion_objects",
    "raw.ingestion_runs",
)

_SOURCE_FACTORY_RESET_STATEMENT = text(
    "TRUNCATE TABLE\n  "
    + ",\n  ".join(SOURCE_FACTORY_RESET_TABLES)
    + "\nRESTART IDENTITY CASCADE"
)


def build_source_factory_catalog(provider_id: str) -> SourceFactoryCatalog:
    return SourceFactoryCatalog(
        provider_id=provider_id,
        sources=(
            SourceFactorySource(
                family="static_schedule",
                endpoint_key="static_schedule",
                required=True,
                bronze_prefix=f"{provider_id}/static_schedule/",
                raw_tables=(
                    "raw.ingestion_runs",
                    "raw.ingestion_objects",
                    "core.dataset_versions",
                ),
                silver_tables=(
                    "silver.agency",
                    "silver.feed_info",
                    "silver.routes",
                    "silver.stops",
                    "silver.directions",
                    "silver.route_patterns",
                    "silver.trips",
                    "silver.calendar",
                    "silver.calendar_dates",
                    "silver.stop_times",
                    "silver.shapes",
                    "silver.translations",
                    "silver.gtfs_source_members",
                    "silver.gtfs_extra_rows",
                ),
                gold_outputs=(
                    "gold.dim_route",
                    "gold.dim_stop",
                    "gold.dim_route_pattern",
                    "gold.dim_direction",
                    "gold.dim_date",
                    "gold.map_stops",
                    "gold.map_route_lines",
                    "gold.fact_stop_time_delay_observation",
                    "gold.current_trip_delay_computed",
                    "gold.public_route_reliability_daily",
                    "gold.public_stop_delay_daily",
                    "gold.route_habit_score",
                    "gold.repeated_problem_route_stop",
                    "gold.citizen_accountability_daily",
                    "gold.report_labels",
                ),
                backfill_strategy="existing_bronze_static_or_live_static_source",
            ),
            SourceFactorySource(
                family="trip_updates",
                endpoint_key="trip_updates",
                required=True,
                bronze_prefix=f"{provider_id}/trip_updates/",
                raw_tables=("raw.realtime_snapshot_index",),
                silver_tables=(
                    "silver.rt_feed_snapshots",
                    "silver.rt_entities",
                    "silver.rt_trip_updates",
                    "silver.rt_trip_update_stop_times",
                ),
                gold_outputs=(
                    "gold.fact_trip_delay_snapshot",
                    "gold.latest_trip_delay_snapshot",
                    "gold.trip_delay_summary_5m",
                    "gold.warm_rollup_periods",
                    "gold.current_trip_delay_computed",
                    "gold.fact_stop_time_delay_observation",
                    "gold.route_delay_hourly",
                    "gold.route_delay_day_of_week",
                    "gold.stop_delay_hourly",
                    "gold.route_reliability_weekly",
                    "gold.route_reliability_monthly",
                    "gold.stop_delay_weekly",
                    "gold.stop_delay_monthly",
                    "gold.repeated_problem_route_stop",
                    "gold.citizen_accountability_daily",
                ),
                backfill_strategy="existing_bronze_realtime_snapshots",
                sibling_group="gtfs_rt",
            ),
            SourceFactorySource(
                family="vehicle_positions",
                endpoint_key="vehicle_positions",
                required=True,
                bronze_prefix=f"{provider_id}/vehicle_positions/",
                raw_tables=("raw.realtime_snapshot_index",),
                silver_tables=(
                    "silver.rt_feed_snapshots",
                    "silver.rt_entities",
                    "silver.rt_vehicle_positions",
                ),
                gold_outputs=(
                    "gold.fact_vehicle_snapshot",
                    "gold.latest_vehicle_snapshot",
                    "gold.current_vehicle_map",
                    "gold.vehicle_summary_5m",
                    "gold.warm_rollup_periods",
                ),
                backfill_strategy="existing_bronze_realtime_snapshots",
                sibling_group="gtfs_rt",
            ),
            SourceFactorySource(
                family="gis_static",
                endpoint_key="gis_static",
                required=False,
                bronze_prefix=f"{provider_id}/gis_static/",
                raw_tables=(
                    "raw.ingestion_runs",
                    "raw.ingestion_objects",
                    "core.dataset_versions",
                ),
                silver_tables=(
                    "silver.gis_datasets",
                    "silver.gis_stop_features",
                    "silver.gis_line_features",
                    "silver.gis_gtfs_matches",
                ),
                gold_outputs=(
                    "gold.map_gis_line_features",
                    "gold.map_route_lines",
                    "gold.map_stops",
                ),
                backfill_strategy="where_available",
            ),
            SourceFactorySource(
                family="i3_alerts",
                endpoint_key="i3_alerts",
                required=False,
                bronze_prefix=f"{provider_id}/i3_alerts/",
                raw_tables=("raw.i3_alert_snapshots",),
                silver_tables=(
                    "silver.i3_alerts",
                    "silver.i3_alert_informed_entities",
                ),
                gold_outputs=(
                    "gold.current_i3_alerts",
                    "gold.i3_alert_history_reporting",
                    "gold.public_alert_impact_daily",
                    "gold.citizen_accountability_daily",
                ),
                backfill_strategy="where_available",
            ),
        ),
        reset_tables=SOURCE_FACTORY_RESET_TABLES,
    )


def build_source_factory_reset_statement() -> TextClause:
    return _SOURCE_FACTORY_RESET_STATEMENT


def reset_source_factory_tables(connection) -> None:  # noqa: ANN001
    connection.execute(build_source_factory_reset_statement())
