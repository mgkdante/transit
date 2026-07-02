from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection
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
    "gold.trip_delay_summary_5m",
    "gold.warm_rollup_periods",
    "gold.latest_trip_delay_snapshot",
    "gold.latest_vehicle_snapshot",
    "gold.fact_trip_delay_snapshot",
    "gold.fact_vehicle_snapshot",
    "gold.dim_date",
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


def build_source_factory_catalog(
    provider_id: str,
    *,
    present_feed_kinds: set[str] | None = None,
) -> SourceFactoryCatalog:
    # The realtime feeds are required for the rebuild only when the provider
    # actually publishes them. A static-only / static+alerts agency (e.g. STS)
    # has no trip/vehicle bronze, so marking those sources required=True would
    # fail its rebuild on a legitimately-absent feed. When present_feed_kinds is
    # None (legacy callers / tests) the historical "required" behavior is kept.
    def _rt_required(feed_kind: str) -> bool:
        if present_feed_kinds is None:
            return True
        return feed_kind in present_feed_kinds

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
                    "gold.dim_date",
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
                required=_rt_required("trip_updates"),
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
                    # GC1 / Step G1 added delayed_trip_count to the spine so the delay-metric
                    # readers re-point onto it (route_delay_hourly stays for the public view).
                    "gold.route_delay_spine",
                    "gold.stop_delay_hourly",
                    "gold.repeated_problem_route_stop",
                    "gold.citizen_accountability_daily",
                ),
                backfill_strategy="existing_bronze_realtime_snapshots",
                sibling_group="gtfs_rt",
            ),
            SourceFactorySource(
                family="vehicle_positions",
                endpoint_key="vehicle_positions",
                required=_rt_required("vehicle_positions"),
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
                gold_outputs=("gold.map_route_lines",),
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
                    "gold.citizen_accountability_daily",
                ),
                backfill_strategy="where_available",
            ),
        ),
        reset_tables=SOURCE_FACTORY_RESET_TABLES,
    )


def build_source_factory_reset_statement() -> TextClause:
    """Whole-database TRUNCATE; used only for an explicit all-providers reset."""
    return _SOURCE_FACTORY_RESET_STATEMENT


def _table_has_provider_id(connection: Connection, qualified_table: str) -> bool:
    schema, _, table = qualified_table.partition(".")
    row = connection.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = :schema "
            "AND table_name = :table "
            "AND column_name = 'provider_id' "
            "LIMIT 1"
        ),
        {"schema": schema, "table": table},
    ).first()
    return row is not None


def reset_source_factory_tables(
    connection: Connection,
    provider_id: str | None = None,
    *,
    all_providers: bool = False,
) -> dict[str, object]:
    """Clear the source-factory tables ahead of a rebuild.

    Per-provider (the default): DELETE only ``provider_id``'s rows from every
    reset table that carries a ``provider_id`` column, walking the list
    child-to-parent so foreign keys hold. Tables with no ``provider_id`` column
    (shared seeds such as ``gold.report_labels``) are left untouched — rebuilding
    one provider must NEVER wipe another provider's rows or shared seed data.

    ``all_providers=True``: the legacy whole-database
    ``TRUNCATE ... RESTART IDENTITY CASCADE`` (every provider's rows plus a
    sequence reset). Kept as an explicit, opt-in escape hatch for a full
    teardown; never the default now that the database is multi-tenant.
    """
    if all_providers:
        connection.execute(build_source_factory_reset_statement())
        return {
            "mode": "all_providers",
            "truncated_tables": list(SOURCE_FACTORY_RESET_TABLES),
        }

    if not provider_id:
        raise ValueError(
            "reset_source_factory_tables requires a provider_id unless "
            "all_providers=True is set."
        )

    deleted_row_counts: dict[str, int] = {}
    skipped_tables: list[str] = []
    for qualified_table in SOURCE_FACTORY_RESET_TABLES:
        if not _table_has_provider_id(connection, qualified_table):
            skipped_tables.append(qualified_table)
            continue
        # qualified_table is a fixed identifier from SOURCE_FACTORY_RESET_TABLES
        # (never user input); the provider_id value is bound as a parameter.
        result = connection.execute(
            text(f"DELETE FROM {qualified_table} WHERE provider_id = :provider_id"),
            {"provider_id": provider_id},
        )
        deleted_row_counts[qualified_table] = (
            result.rowcount if result.rowcount is not None else -1
        )
    return {
        "mode": "per_provider",
        "provider_id": provider_id,
        "deleted_row_counts": deleted_row_counts,
        "skipped_tables": skipped_tables,
    }
