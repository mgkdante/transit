from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.ingestion.storage import BronzeStorage, get_bronze_storage
from transit_ops.settings import Settings, get_settings

logger = logging.getLogger(__name__)

STATIC_SILVER_TABLES = (
    "silver.stop_times",
    "silver.translations",
    "silver.shapes",
    "silver.route_patterns",
    "silver.directions",
    "silver.calendar_dates",
    "silver.calendar",
    "silver.trips",
    "silver.stops",
    "silver.routes",
    "silver.feed_info",
    "silver.agency",
    "silver.gtfs_extra_rows",
    "silver.gtfs_source_members",
)

STATIC_DATASET_REFERENCE_TABLES = (
    "silver.gis_gtfs_matches",
)

GIS_SILVER_TABLES = (
    "silver.gis_gtfs_matches",
    "silver.gis_line_features",
    "silver.gis_stop_features",
    "silver.gis_datasets",
)

REALTIME_SILVER_TABLES = (
    "silver.rt_trip_update_stop_times",
    "silver.rt_trip_updates",
    "silver.rt_vehicle_positions",
    "silver.rt_entities",
    "silver.rt_feed_snapshots",
)

GOLD_FACT_TABLES = (
    "gold.fact_trip_delay_snapshot",
    "gold.fact_vehicle_snapshot",
)

GOLD_WARM_ROLLUP_TABLES = (
    "gold.vehicle_summary_5m",
    "gold.trip_delay_summary_5m",
    "gold.warm_rollup_periods",
)

GOLD_REPORTING_AGGREGATE_TABLES = (
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
)

GOLD_AGGREGATE_TABLES = (
    *GOLD_WARM_ROLLUP_TABLES,
    *GOLD_REPORTING_AGGREGATE_TABLES,
)

GOLD_AGGREGATE_RETENTION_COLUMNS = (
    ("gold.vehicle_summary_5m", "period_start_utc", False),
    ("gold.trip_delay_summary_5m", "period_start_utc", False),
    ("gold.warm_rollup_periods", "period_start_utc", False),
    ("gold.route_delay_hourly", "period_start_utc", False),
    ("gold.route_delay_day_of_week", "built_at_utc", False),
    ("gold.stop_delay_hourly", "period_start_utc", False),
    ("gold.route_reliability_weekly", "week_start_local", True),
    ("gold.route_reliability_monthly", "month_start_local", True),
    ("gold.stop_delay_weekly", "week_start_local", True),
    ("gold.stop_delay_monthly", "month_start_local", True),
    ("gold.route_habit_score", "built_at_utc", False),
    ("gold.repeated_problem_route_stop", "period_start_local", True),
    ("gold.citizen_accountability_daily", "provider_local_date", True),
)

VALID_GOLD_AGGREGATE_RETENTION_TARGETS = frozenset(GOLD_AGGREGATE_RETENTION_COLUMNS)

VACUUM_TABLES = (
    *STATIC_SILVER_TABLES,
    *GIS_SILVER_TABLES,
    *REALTIME_SILVER_TABLES,
    *GOLD_FACT_TABLES,
    "gold.latest_trip_delay_snapshot",
    "gold.latest_vehicle_snapshot",
    *GOLD_AGGREGATE_TABLES,
)

SELECT_STATIC_DATASET_VERSION_IDS = text(
    """
    SELECT dataset_version_id
    FROM core.dataset_versions
    WHERE provider_id = :provider_id
      AND dataset_kind = 'static_schedule'
    ORDER BY is_current DESC, loaded_at_utc DESC, dataset_version_id DESC
    """
)

DELETE_SILVER_STOP_TIMES_BY_DATASET = text(
    """
    DELETE FROM silver.stop_times
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

COUNT_SILVER_STOP_TIMES_BY_DATASET = text(
    """
    SELECT COUNT(*) FROM silver.stop_times
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

DELETE_SILVER_CALENDAR_DATES_BY_DATASET = text(
    """
    DELETE FROM silver.calendar_dates
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

COUNT_SILVER_CALENDAR_DATES_BY_DATASET = text(
    """
    SELECT COUNT(*) FROM silver.calendar_dates
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

DELETE_SILVER_CALENDAR_BY_DATASET = text(
    """
    DELETE FROM silver.calendar
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

COUNT_SILVER_CALENDAR_BY_DATASET = text(
    """
    SELECT COUNT(*) FROM silver.calendar
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

DELETE_SILVER_TRIPS_BY_DATASET = text(
    """
    DELETE FROM silver.trips
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

COUNT_SILVER_TRIPS_BY_DATASET = text(
    """
    SELECT COUNT(*) FROM silver.trips
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

DELETE_SILVER_STOPS_BY_DATASET = text(
    """
    DELETE FROM silver.stops
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

COUNT_SILVER_STOPS_BY_DATASET = text(
    """
    SELECT COUNT(*) FROM silver.stops
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

DELETE_SILVER_ROUTES_BY_DATASET = text(
    """
    DELETE FROM silver.routes
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

COUNT_SILVER_ROUTES_BY_DATASET = text(
    """
    SELECT COUNT(*) FROM silver.routes
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

DELETE_DATASET_VERSIONS = text(
    """
    DELETE FROM core.dataset_versions
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

COUNT_DATASET_VERSIONS = text(
    """
    SELECT COUNT(*) FROM core.dataset_versions
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)


def _dataset_table_statement(table_name: str, *, dry_run: bool) -> object:
    operation = "SELECT COUNT(*) FROM" if dry_run else "DELETE FROM"
    return text(
        f"""
        {operation} {table_name}
        WHERE provider_id = :provider_id
          AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
        """
    )


def _static_dataset_reference_statement(table_name: str, *, dry_run: bool) -> object:
    operation = "SELECT COUNT(*) FROM" if dry_run else "DELETE FROM"
    return text(
        f"""
        {operation} {table_name}
        WHERE provider_id = :provider_id
          AND static_dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
        """
    )


DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES = text(
    """
    DELETE FROM silver.rt_trip_update_stop_times AS rstu
    USING silver.rt_feed_snapshots AS rfs
    WHERE rstu.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
      AND rfs.provider_id = :provider_id
      AND rfs.endpoint_key = 'trip_updates'
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = 'trip_updates'
        ), -1)
    """
)

COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES = text(
    """
    SELECT COUNT(*) FROM silver.rt_trip_update_stop_times AS rstu
    JOIN silver.rt_feed_snapshots AS rfs
        ON rstu.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
    WHERE rfs.provider_id = :provider_id
      AND rfs.endpoint_key = 'trip_updates'
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = 'trip_updates'
        ), -1)
    """
)

DELETE_OLD_RT_TRIP_UPDATES = text(
    """
    DELETE FROM silver.rt_trip_updates AS rtu
    USING silver.rt_feed_snapshots AS rfs
    WHERE rtu.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
      AND rfs.provider_id = :provider_id
      AND rfs.endpoint_key = 'trip_updates'
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = 'trip_updates'
        ), -1)
    """
)

COUNT_OLD_RT_TRIP_UPDATES = text(
    """
    SELECT COUNT(*) FROM silver.rt_trip_updates AS rtu
    JOIN silver.rt_feed_snapshots AS rfs
        ON rtu.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
    WHERE rfs.provider_id = :provider_id
      AND rfs.endpoint_key = 'trip_updates'
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = 'trip_updates'
        ), -1)
    """
)

DELETE_OLD_RT_VEHICLE_POSITIONS = text(
    """
    DELETE FROM silver.rt_vehicle_positions AS rvp
    USING silver.rt_feed_snapshots AS rfs
    WHERE rvp.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
      AND rfs.provider_id = :provider_id
      AND rfs.endpoint_key = 'vehicle_positions'
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = 'vehicle_positions'
        ), -1)
    """
)

COUNT_OLD_RT_VEHICLE_POSITIONS = text(
    """
    SELECT COUNT(*) FROM silver.rt_vehicle_positions AS rvp
    JOIN silver.rt_feed_snapshots AS rfs
        ON rvp.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
    WHERE rfs.provider_id = :provider_id
      AND rfs.endpoint_key = 'vehicle_positions'
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = 'vehicle_positions'
        ), -1)
    """
)

DELETE_OLD_RT_ENTITIES = text(
    """
    DELETE FROM silver.rt_entities AS rte
    USING silver.rt_feed_snapshots AS rfs
    WHERE rte.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
      AND rfs.provider_id = :provider_id
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = rfs.endpoint_key
        ), -1)
    """
)

COUNT_OLD_RT_ENTITIES = text(
    """
    SELECT COUNT(*) FROM silver.rt_entities AS rte
    JOIN silver.rt_feed_snapshots AS rfs
        ON rte.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
    WHERE rfs.provider_id = :provider_id
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = rfs.endpoint_key
        ), -1)
    """
)

DELETE_OLD_RT_FEED_SNAPSHOTS = text(
    """
    DELETE FROM silver.rt_feed_snapshots AS rfs
    WHERE rfs.provider_id = :provider_id
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = rfs.endpoint_key
        ), -1)
    """
)

COUNT_OLD_RT_FEED_SNAPSHOTS = text(
    """
    SELECT COUNT(*) FROM silver.rt_feed_snapshots AS rfs
    WHERE rfs.provider_id = :provider_id
      AND rfs.captured_at_utc < :cutoff_utc
      AND rfs.rt_feed_snapshot_id <> COALESCE((
            SELECT max(rfs_latest.rt_feed_snapshot_id)
            FROM silver.rt_feed_snapshots AS rfs_latest
            WHERE rfs_latest.provider_id = :provider_id
              AND rfs_latest.endpoint_key = rfs.endpoint_key
        ), -1)
    """
)

DELETE_OLD_FACT_TRIP_DELAY_SNAPSHOTS = text(
    """
    DELETE FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
      AND captured_at_utc < :cutoff_utc
    """
)

COUNT_OLD_FACT_TRIP_DELAY_SNAPSHOTS = text(
    """
    SELECT COUNT(*) FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
      AND captured_at_utc < :cutoff_utc
    """
)

DELETE_OLD_FACT_VEHICLE_SNAPSHOTS = text(
    """
    DELETE FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
      AND captured_at_utc < :cutoff_utc
    """
)

COUNT_OLD_FACT_VEHICLE_SNAPSHOTS = text(
    """
    SELECT COUNT(*) FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
      AND captured_at_utc < :cutoff_utc
    """
)

# Bronze / raw retention SQL

SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS = text(
    """
    SELECT
        io.ingestion_object_id,
        io.ingestion_run_id,
        io.storage_path,
        io.storage_backend,
        rsi.realtime_snapshot_id
    FROM raw.ingestion_objects io
    JOIN raw.realtime_snapshot_index rsi
        ON rsi.ingestion_object_id = io.ingestion_object_id
    JOIN core.feed_endpoints fe
        ON fe.feed_endpoint_id = rsi.feed_endpoint_id
    WHERE rsi.provider_id = :provider_id
      AND rsi.captured_at_utc < :cutoff_utc
      AND NOT EXISTS (
          SELECT 1 FROM silver.rt_feed_snapshots rfs
          WHERE rfs.source_realtime_snapshot_id = rsi.realtime_snapshot_id
             OR rfs.ingestion_object_id = io.ingestion_object_id
      )
      AND rsi.realtime_snapshot_id <> COALESCE((
          SELECT MAX(rsi_latest.realtime_snapshot_id)
          FROM raw.realtime_snapshot_index rsi_latest
          INNER JOIN core.feed_endpoints fe_latest
              ON fe_latest.feed_endpoint_id = rsi_latest.feed_endpoint_id
          WHERE rsi_latest.provider_id = :provider_id
            AND fe_latest.endpoint_key = fe.endpoint_key
      ), -1)
    """
)

SELECT_ELIGIBLE_BRONZE_STATIC_OBJECTS = text(
    """
    SELECT
        io.ingestion_object_id,
        io.ingestion_run_id,
        io.storage_path,
        io.storage_backend
    FROM raw.ingestion_objects io
    JOIN raw.ingestion_runs ir
        ON ir.ingestion_run_id = io.ingestion_run_id
    WHERE ir.provider_id = :provider_id
      AND ir.run_kind = 'static_schedule'
      AND ir.started_at_utc < :cutoff_utc
      AND NOT EXISTS (
          SELECT 1 FROM core.dataset_versions dv
          WHERE dv.source_ingestion_run_id = io.ingestion_run_id
      )
    """
)

DELETE_REALTIME_SNAPSHOT_INDEX_BY_OBJECT_IDS = text(
    """
    DELETE FROM raw.realtime_snapshot_index
    WHERE ingestion_object_id = ANY(CAST(:ingestion_object_ids AS bigint[]))
    """
)

DELETE_INGESTION_OBJECTS_BY_IDS = text(
    """
    DELETE FROM raw.ingestion_objects
    WHERE ingestion_object_id = ANY(CAST(:ingestion_object_ids AS bigint[]))
    """
)

DELETE_ORPHANED_INGESTION_RUNS = text(
    """
    DELETE FROM raw.ingestion_runs ir
    WHERE ir.provider_id = :provider_id
      AND NOT EXISTS (
          SELECT 1 FROM raw.ingestion_objects io
          WHERE io.ingestion_run_id = ir.ingestion_run_id
      )
    """
)

COUNT_OLD_VEHICLE_SUMMARY_5M = text(
    """
    SELECT COUNT(*) FROM gold.vehicle_summary_5m
    WHERE provider_id = :provider_id
      AND period_start_utc < :cutoff_utc
    """
)

COUNT_OLD_TRIP_DELAY_SUMMARY_5M = text(
    """
    SELECT COUNT(*) FROM gold.trip_delay_summary_5m
    WHERE provider_id = :provider_id
      AND period_start_utc < :cutoff_utc
    """
)

COUNT_OLD_WARM_ROLLUP_PERIODS = text(
    """
    SELECT COUNT(*) FROM gold.warm_rollup_periods
    WHERE provider_id = :provider_id
      AND period_start_utc < :cutoff_utc
    """
)


def _gold_aggregate_retention_statement(
    table_name: str,
    retention_column: str,
    *,
    date_only: bool,
    dry_run: bool,
) -> object:
    if (
        table_name,
        retention_column,
        date_only,
    ) not in VALID_GOLD_AGGREGATE_RETENTION_TARGETS:
        raise ValueError(
            "Unknown Gold aggregate retention target: "
            f"{table_name}.{retention_column} date_only={date_only}"
        )

    operation = "DELETE FROM"
    if dry_run:
        operation = (
            "SELECT count(*) FROM"
            if table_name in GOLD_REPORTING_AGGREGATE_TABLES
            else "SELECT COUNT(*) FROM"
        )
    cutoff_expression = "CAST(:cutoff_utc AS date)" if date_only else ":cutoff_utc"
    return text(
        f"""
        {operation} {table_name}
        WHERE provider_id = :provider_id
          AND {retention_column} < {cutoff_expression}
        """
    )


@dataclass(frozen=True)
class BronzeStoragePruneResult:
    provider_id: str
    dry_run: bool
    realtime_retention_days: int
    static_retention_days: int
    realtime_cutoff_utc: datetime | None
    static_cutoff_utc: datetime | None
    deleted_object_counts: dict[str, int]
    deleted_metadata_counts: dict[str, int]
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["realtime_cutoff_utc"] = (
            self.realtime_cutoff_utc.isoformat() if self.realtime_cutoff_utc else None
        )
        payload["static_cutoff_utc"] = (
            self.static_cutoff_utc.isoformat() if self.static_cutoff_utc else None
        )
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


@dataclass(frozen=True)
class GoldStoragePruneResult:
    provider_id: str
    dry_run: bool
    retention_days: int
    cutoff_utc: datetime | None
    deleted_row_counts: dict[str, int]
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["cutoff_utc"] = self.cutoff_utc.isoformat() if self.cutoff_utc else None
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


@dataclass(frozen=True)
class SilverStoragePruneResult:
    provider_id: str
    dry_run: bool
    static_dataset_retention_count: int
    realtime_retention_days: int
    retained_dataset_version_ids: list[int]
    pruned_dataset_version_ids: list[int]
    realtime_cutoff_utc: datetime | None
    deleted_row_counts: dict[str, int]
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["realtime_cutoff_utc"] = (
            self.realtime_cutoff_utc.isoformat() if self.realtime_cutoff_utc else None
        )
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


@dataclass(frozen=True)
class VacuumResult:
    provider_id: str
    full: bool
    tables: list[str]
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


def _safe_rowcount(result) -> int:  # noqa: ANN001
    rowcount = getattr(result, "rowcount", 0)
    return max(int(rowcount or 0), 0)


def _safe_scalar_count(result) -> int:  # noqa: ANN001
    if not hasattr(result, "scalar_one"):
        raise TypeError("Dry-run count result must provide scalar_one()")
    value = result.scalar_one()
    return max(int(value or 0), 0)


def prune_static_silver_datasets(
    connection: Connection,
    *,
    provider_id: str,
    retention_count: int,
    dry_run: bool = False,
) -> tuple[list[int], list[int], dict[str, int]]:
    if retention_count <= 0:
        retention_count = 1

    dataset_version_rows = connection.execute(
        SELECT_STATIC_DATASET_VERSION_IDS,
        {"provider_id": provider_id},
    )
    dataset_version_ids = [int(row[0]) for row in dataset_version_rows]
    retained_dataset_version_ids = dataset_version_ids[:retention_count]
    pruned_dataset_version_ids = dataset_version_ids[retention_count:]
    if not pruned_dataset_version_ids:
        return retained_dataset_version_ids, [], {
            **{table_name: 0 for table_name in STATIC_SILVER_TABLES},
            **{table_name: 0 for table_name in STATIC_DATASET_REFERENCE_TABLES},
            "core.dataset_versions": 0,
        }

    params = {
        "provider_id": provider_id,
        "dataset_version_ids": pruned_dataset_version_ids,
    }

    counter = _safe_scalar_count if dry_run else _safe_rowcount
    deleted_row_counts = {
        table_name: counter(
            connection.execute(_dataset_table_statement(table_name, dry_run=dry_run), params)
        )
        for table_name in STATIC_SILVER_TABLES
    }
    deleted_row_counts.update(
        {
            table_name: counter(
                connection.execute(
                    _static_dataset_reference_statement(table_name, dry_run=dry_run),
                    params,
                )
            )
            for table_name in STATIC_DATASET_REFERENCE_TABLES
        }
    )
    deleted_row_counts["core.dataset_versions"] = counter(
        connection.execute(
            COUNT_DATASET_VERSIONS if dry_run else DELETE_DATASET_VERSIONS,
            params,
        )
    )
    return retained_dataset_version_ids, pruned_dataset_version_ids, deleted_row_counts


def prune_realtime_silver_history(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    dry_run: bool = False,
    now_utc: datetime | None = None,
) -> tuple[datetime | None, dict[str, int]]:
    if retention_days <= 0:
        return None, {table_name: 0 for table_name in REALTIME_SILVER_TABLES}

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)
    params = {
        "provider_id": provider_id,
        "cutoff_utc": cutoff_utc,
    }

    if dry_run:
        deleted_row_counts = {
            "silver.rt_trip_update_stop_times": _safe_scalar_count(
                connection.execute(COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES, params)
            ),
            "silver.rt_trip_updates": _safe_scalar_count(
                connection.execute(COUNT_OLD_RT_TRIP_UPDATES, params)
            ),
            "silver.rt_vehicle_positions": _safe_scalar_count(
                connection.execute(COUNT_OLD_RT_VEHICLE_POSITIONS, params)
            ),
            "silver.rt_entities": _safe_scalar_count(
                connection.execute(COUNT_OLD_RT_ENTITIES, params)
            ),
            "silver.rt_feed_snapshots": _safe_scalar_count(
                connection.execute(COUNT_OLD_RT_FEED_SNAPSHOTS, params)
            ),
        }
    else:
        deleted_row_counts = {
            "silver.rt_trip_update_stop_times": _safe_rowcount(
                connection.execute(DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES, params)
            ),
            "silver.rt_trip_updates": _safe_rowcount(
                connection.execute(DELETE_OLD_RT_TRIP_UPDATES, params)
            ),
            "silver.rt_vehicle_positions": _safe_rowcount(
                connection.execute(DELETE_OLD_RT_VEHICLE_POSITIONS, params)
            ),
            "silver.rt_entities": _safe_rowcount(
                connection.execute(DELETE_OLD_RT_ENTITIES, params)
            ),
            "silver.rt_feed_snapshots": _safe_rowcount(
                connection.execute(DELETE_OLD_RT_FEED_SNAPSHOTS, params)
            ),
        }
    return cutoff_utc, deleted_row_counts


def prune_silver_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> SilverStoragePruneResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)

    with engine.begin() as connection:
        retained_dataset_version_ids, pruned_dataset_version_ids, static_deleted_row_counts = (
            prune_static_silver_datasets(
                connection,
                provider_id=provider_id,
                retention_count=settings.STATIC_DATASET_RETENTION_COUNT,
                dry_run=dry_run,
            )
        )
        realtime_cutoff_utc, realtime_deleted_row_counts = prune_realtime_silver_history(
            connection,
            provider_id=provider_id,
            retention_days=settings.SILVER_REALTIME_RETENTION_DAYS,
            dry_run=dry_run,
        )
        completed_at_utc = utc_now()

    return SilverStoragePruneResult(
        provider_id=provider_id,
        dry_run=dry_run,
        static_dataset_retention_count=settings.STATIC_DATASET_RETENTION_COUNT,
        realtime_retention_days=settings.SILVER_REALTIME_RETENTION_DAYS,
        retained_dataset_version_ids=retained_dataset_version_ids,
        pruned_dataset_version_ids=pruned_dataset_version_ids,
        realtime_cutoff_utc=realtime_cutoff_utc,
        deleted_row_counts=static_deleted_row_counts | realtime_deleted_row_counts,
        completed_at_utc=completed_at_utc,
    )


def prune_gold_fact_history(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    dry_run: bool = False,
    now_utc: datetime | None = None,
) -> tuple[datetime | None, dict[str, int]]:
    if retention_days <= 0:
        return None, {
            "gold.fact_trip_delay_snapshot": 0,
            "gold.fact_vehicle_snapshot": 0,
        }

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)
    params = {
        "provider_id": provider_id,
        "cutoff_utc": cutoff_utc,
    }

    if dry_run:
        deleted_row_counts = {
            "gold.fact_trip_delay_snapshot": _safe_scalar_count(
                connection.execute(COUNT_OLD_FACT_TRIP_DELAY_SNAPSHOTS, params)
            ),
            "gold.fact_vehicle_snapshot": _safe_scalar_count(
                connection.execute(COUNT_OLD_FACT_VEHICLE_SNAPSHOTS, params)
            ),
        }
    else:
        deleted_row_counts = {
            "gold.fact_trip_delay_snapshot": _safe_rowcount(
                connection.execute(DELETE_OLD_FACT_TRIP_DELAY_SNAPSHOTS, params)
            ),
            "gold.fact_vehicle_snapshot": _safe_rowcount(
                connection.execute(DELETE_OLD_FACT_VEHICLE_SNAPSHOTS, params)
            ),
        }
    return cutoff_utc, deleted_row_counts


def prune_gold_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> GoldStoragePruneResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)

    with engine.begin() as connection:
        cutoff_utc, deleted_row_counts = prune_gold_fact_history(
            connection,
            provider_id=provider_id,
            retention_days=settings.GOLD_FACT_RETENTION_DAYS,
            dry_run=dry_run,
        )
        completed_at_utc = utc_now()

    return GoldStoragePruneResult(
        provider_id=provider_id,
        dry_run=dry_run,
        retention_days=settings.GOLD_FACT_RETENTION_DAYS,
        cutoff_utc=cutoff_utc,
        deleted_row_counts=deleted_row_counts,
        completed_at_utc=completed_at_utc,
    )


def prune_bronze_realtime_objects(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    bronze_storage: BronzeStorage,
    dry_run: bool = False,
    now_utc: datetime | None = None,
) -> tuple[datetime | None, dict[str, int], dict[str, int]]:
    """Return (cutoff_utc, deleted_object_counts, deleted_metadata_counts)."""
    zero_object_counts: dict[str, int] = {"realtime": 0}
    zero_meta_counts: dict[str, int] = {
        "raw.realtime_snapshot_index": 0,
        "raw.ingestion_objects": 0,
        "raw.ingestion_runs": 0,
    }
    if retention_days <= 0:
        return None, zero_object_counts, zero_meta_counts

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)
    rows = list(
        connection.execute(
            SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
            {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
        )
    )

    if dry_run:
        return (
            cutoff_utc,
            {"realtime": len(rows)},
            {
                "raw.realtime_snapshot_index": len(rows),
                "raw.ingestion_objects": len(rows),
                "raw.ingestion_runs": 0,
            },
        )

    if not rows:
        return cutoff_utc, zero_object_counts, zero_meta_counts

    deleted_object_count = 0
    failed_object_ids: set[int] = set()
    for row in rows:
        ingestion_object_id = int(row[0])
        storage_path = str(row[2])
        try:
            bronze_storage.delete_object(storage_path)
            deleted_object_count += 1
        except Exception as exc:
            logger.error(
                "Failed to delete Bronze realtime object '%s' (ingestion_object_id=%s): %s",
                storage_path,
                ingestion_object_id,
                exc,
            )
            failed_object_ids.add(ingestion_object_id)

    successful_object_ids = [
        int(row[0]) for row in rows if int(row[0]) not in failed_object_ids
    ]
    if not successful_object_ids:
        return cutoff_utc, {"realtime": 0}, zero_meta_counts

    rsi_deleted = _safe_rowcount(
        connection.execute(
            DELETE_REALTIME_SNAPSHOT_INDEX_BY_OBJECT_IDS,
            {"ingestion_object_ids": successful_object_ids},
        )
    )
    obj_deleted = _safe_rowcount(
        connection.execute(
            DELETE_INGESTION_OBJECTS_BY_IDS,
            {"ingestion_object_ids": successful_object_ids},
        )
    )
    runs_deleted = _safe_rowcount(
        connection.execute(
            DELETE_ORPHANED_INGESTION_RUNS,
            {"provider_id": provider_id},
        )
    )

    return (
        cutoff_utc,
        {"realtime": deleted_object_count},
        {
            "raw.realtime_snapshot_index": rsi_deleted,
            "raw.ingestion_objects": obj_deleted,
            "raw.ingestion_runs": runs_deleted,
        },
    )


def prune_bronze_static_objects(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    bronze_storage: BronzeStorage,
    dry_run: bool = False,
    now_utc: datetime | None = None,
) -> tuple[datetime | None, dict[str, int], dict[str, int]]:
    """Return (cutoff_utc, deleted_object_counts, deleted_metadata_counts)."""
    zero_object_counts: dict[str, int] = {"static": 0}
    zero_meta_counts: dict[str, int] = {
        "raw.ingestion_objects": 0,
        "raw.ingestion_runs": 0,
    }
    if retention_days <= 0:
        return None, zero_object_counts, zero_meta_counts

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)
    rows = list(
        connection.execute(
            SELECT_ELIGIBLE_BRONZE_STATIC_OBJECTS,
            {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
        )
    )

    if dry_run:
        return (
            cutoff_utc,
            {"static": len(rows)},
            {
                "raw.ingestion_objects": len(rows),
                "raw.ingestion_runs": 0,
            },
        )

    if not rows:
        return cutoff_utc, zero_object_counts, zero_meta_counts

    deleted_object_count = 0
    failed_object_ids: set[int] = set()
    for row in rows:
        ingestion_object_id = int(row[0])
        storage_path = str(row[2])
        try:
            bronze_storage.delete_object(storage_path)
            deleted_object_count += 1
        except Exception as exc:
            logger.error(
                "Failed to delete Bronze static object '%s' (ingestion_object_id=%s): %s",
                storage_path,
                ingestion_object_id,
                exc,
            )
            failed_object_ids.add(ingestion_object_id)

    successful_object_ids = [
        int(row[0]) for row in rows if int(row[0]) not in failed_object_ids
    ]
    if not successful_object_ids:
        return cutoff_utc, {"static": 0}, zero_meta_counts

    obj_deleted = _safe_rowcount(
        connection.execute(
            DELETE_INGESTION_OBJECTS_BY_IDS,
            {"ingestion_object_ids": successful_object_ids},
        )
    )
    runs_deleted = _safe_rowcount(
        connection.execute(
            DELETE_ORPHANED_INGESTION_RUNS,
            {"provider_id": provider_id},
        )
    )

    return (
        cutoff_utc,
        {"static": deleted_object_count},
        {
            "raw.ingestion_objects": obj_deleted,
            "raw.ingestion_runs": runs_deleted,
        },
    )


def prune_bronze_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> BronzeStoragePruneResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    bronze_storage = get_bronze_storage(settings, project_root=Path(__file__).resolve().parents[2])

    with engine.begin() as connection:
        realtime_cutoff_utc, realtime_object_counts, realtime_meta_counts = (
            prune_bronze_realtime_objects(
                connection,
                provider_id=provider_id,
                retention_days=settings.BRONZE_REALTIME_RETENTION_DAYS,
                bronze_storage=bronze_storage,
                dry_run=dry_run,
            )
        )
        static_cutoff_utc, static_object_counts, static_meta_counts = (
            prune_bronze_static_objects(
                connection,
                provider_id=provider_id,
                retention_days=settings.BRONZE_STATIC_RETENTION_DAYS,
                bronze_storage=bronze_storage,
                dry_run=dry_run,
            )
        )
        completed_at_utc = utc_now()

    deleted_object_counts = realtime_object_counts | static_object_counts
    deleted_metadata_counts = {
        "raw.realtime_snapshot_index": realtime_meta_counts.get(
            "raw.realtime_snapshot_index", 0
        ),
        "raw.ingestion_objects": (
            realtime_meta_counts.get("raw.ingestion_objects", 0)
            + static_meta_counts.get("raw.ingestion_objects", 0)
        ),
        "raw.ingestion_runs": (
            realtime_meta_counts.get("raw.ingestion_runs", 0)
            + static_meta_counts.get("raw.ingestion_runs", 0)
        ),
    }

    return BronzeStoragePruneResult(
        provider_id=provider_id,
        dry_run=dry_run,
        realtime_retention_days=settings.BRONZE_REALTIME_RETENTION_DAYS,
        static_retention_days=settings.BRONZE_STATIC_RETENTION_DAYS,
        realtime_cutoff_utc=realtime_cutoff_utc,
        static_cutoff_utc=static_cutoff_utc,
        deleted_object_counts=deleted_object_counts,
        deleted_metadata_counts=deleted_metadata_counts,
        completed_at_utc=completed_at_utc,
    )


@dataclass(frozen=True)
class WarmRollupStoragePruneResult:
    provider_id: str
    dry_run: bool
    retention_days: int
    cutoff_utc: datetime | None
    deleted_row_counts: dict[str, int]
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["cutoff_utc"] = self.cutoff_utc.isoformat() if self.cutoff_utc else None
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


def prune_warm_rollup_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> WarmRollupStoragePruneResult:
    """Delete warm rollup rows older than GOLD_WARM_ROLLUP_RETENTION_DAYS."""
    settings = settings or get_settings()
    engine = engine or make_engine(settings)

    retention_days = settings.GOLD_WARM_ROLLUP_RETENTION_DAYS
    if retention_days <= 0:
        return WarmRollupStoragePruneResult(
            provider_id=provider_id,
            dry_run=dry_run,
            retention_days=retention_days,
            cutoff_utc=None,
            deleted_row_counts={table_name: 0 for table_name in GOLD_AGGREGATE_TABLES},
            completed_at_utc=utc_now(),
        )

    cutoff_utc = utc_now() - timedelta(days=retention_days)
    params = {"provider_id": provider_id, "cutoff_utc": cutoff_utc}

    with engine.begin() as connection:
        counter = _safe_scalar_count if dry_run else _safe_rowcount
        deleted_row_counts = {
            table_name: counter(
                connection.execute(
                    _gold_aggregate_retention_statement(
                        table_name,
                        retention_column,
                        date_only=date_only,
                        dry_run=dry_run,
                    ),
                    params,
                )
            )
            for table_name, retention_column, date_only in GOLD_AGGREGATE_RETENTION_COLUMNS
        }
        completed_at_utc = utc_now()

    return WarmRollupStoragePruneResult(
        provider_id=provider_id,
        dry_run=dry_run,
        retention_days=retention_days,
        cutoff_utc=cutoff_utc,
        deleted_row_counts=deleted_row_counts,
        completed_at_utc=completed_at_utc,
    )


def vacuum_storage(
    provider_id: str,
    *,
    full: bool = False,
    tables: list[str] | None = None,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> VacuumResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    vacuum_mode = "FULL, ANALYZE" if full else "ANALYZE"

    target_tables = tables if tables is not None else list(VACUUM_TABLES)
    invalid = [t for t in target_tables if t not in VACUUM_TABLES]
    if invalid:
        raise ValueError(
            f"Unknown vacuum table(s): {invalid}. Must be one of: {list(VACUUM_TABLES)}"
        )

    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        for table_name in target_tables:
            connection.exec_driver_sql(f"VACUUM ({vacuum_mode}) {table_name}")

    return VacuumResult(
        provider_id=provider_id,
        full=full,
        tables=target_tables,
        completed_at_utc=utc_now(),
    )
