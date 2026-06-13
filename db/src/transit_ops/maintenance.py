from __future__ import annotations

import logging
from collections.abc import Sequence
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

# Every gold table holding an FK to core.dataset_versions
# (fk_gold_dim_*_dataset_version_id, migrations 0004:33/67/104 + 0011:35).
# A static dataset version still referenced by any of these must NOT be deleted
# by the prune (it would FK-violate); it is deferred until gold dims re-point to
# the current version. Extend this tuple if a future migration adds a gold table
# with an FK to core.dataset_versions.
GOLD_DATASET_REFERENCE_TABLES = (
    "gold.dim_route",
    "gold.dim_stop",
    "gold.dim_date",
    "gold.dim_route_pattern",
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

RAW_BRONZE_METADATA_TABLES = (
    "raw.realtime_snapshot_index",
    "raw.ingestion_objects",
    "raw.ingestion_runs",
)

I3_RETENTION_TABLES = (
    "raw.i3_alert_snapshots",
    "silver.i3_alerts",
    "silver.i3_alert_informed_entities",
)

VACUUM_TABLES = (
    *STATIC_SILVER_TABLES,
    *GIS_SILVER_TABLES,
    *REALTIME_SILVER_TABLES,
    *GOLD_FACT_TABLES,
    "gold.latest_trip_delay_snapshot",
    "gold.latest_vehicle_snapshot",
    *GOLD_AGGREGATE_TABLES,
    *RAW_BRONZE_METADATA_TABLES,
    *I3_RETENTION_TABLES,
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

# Dataset versions still referenced by any gold dim FK-holder
# (GOLD_DATASET_REFERENCE_TABLES). Deferred from pruning so the DELETE on
# core.dataset_versions can never FK-violate. UNION (not UNION ALL) is fine —
# we only need the distinct set of referenced ids.
SELECT_GOLD_REFERENCED_DATASET_VERSION_IDS = text(
    """
    SELECT DISTINCT dataset_version_id FROM gold.dim_route WHERE provider_id = :provider_id
    UNION
    SELECT DISTINCT dataset_version_id FROM gold.dim_stop WHERE provider_id = :provider_id
    UNION
    SELECT DISTINCT dataset_version_id FROM gold.dim_date WHERE provider_id = :provider_id
    UNION
    SELECT DISTINCT dataset_version_id FROM gold.dim_route_pattern WHERE provider_id = :provider_id
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


# Realtime-history DELETEs are BOUNDED to :batch rows/table/cycle. The prune runs
# on every ~57s worker cycle, so an unbounded single-transaction DELETE of the
# accumulated backlog (the unbounded-heavy-op hang class) must never happen. The
# ctid IN (SELECT ctid ... LIMIT :batch) form caps each statement; the retention
# predicate is unchanged, so the one-time backlog drains over many cycles and a
# steady-state delta clears in one pass. (slice-9.1.1g/j retention semantics
# preserved exactly — same cutoff, same latest-snapshot exclusion.)
DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES = text(
    """
    DELETE FROM silver.rt_trip_update_stop_times AS rstu
    WHERE rstu.ctid IN (
        SELECT rstu_old.ctid
        FROM silver.rt_trip_update_stop_times AS rstu_old
        JOIN silver.rt_feed_snapshots AS rfs
            ON rstu_old.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
        WHERE rfs.provider_id = :provider_id
          AND rfs.endpoint_key = 'trip_updates'
          AND rfs.captured_at_utc < :cutoff_utc
          AND rfs.rt_feed_snapshot_id <> COALESCE((
                SELECT max(rfs_latest.rt_feed_snapshot_id)
                FROM silver.rt_feed_snapshots AS rfs_latest
                WHERE rfs_latest.provider_id = :provider_id
                  AND rfs_latest.endpoint_key = 'trip_updates'
            ), -1)
        LIMIT :batch
    )
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
    WHERE rtu.ctid IN (
        SELECT rtu_old.ctid
        FROM silver.rt_trip_updates AS rtu_old
        JOIN silver.rt_feed_snapshots AS rfs
            ON rtu_old.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
        WHERE rfs.provider_id = :provider_id
          AND rfs.endpoint_key = 'trip_updates'
          AND rfs.captured_at_utc < :cutoff_utc
          AND rfs.rt_feed_snapshot_id <> COALESCE((
                SELECT max(rfs_latest.rt_feed_snapshot_id)
                FROM silver.rt_feed_snapshots AS rfs_latest
                WHERE rfs_latest.provider_id = :provider_id
                  AND rfs_latest.endpoint_key = 'trip_updates'
            ), -1)
        LIMIT :batch
    )
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
    WHERE rvp.ctid IN (
        SELECT rvp_old.ctid
        FROM silver.rt_vehicle_positions AS rvp_old
        JOIN silver.rt_feed_snapshots AS rfs
            ON rvp_old.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
        WHERE rfs.provider_id = :provider_id
          AND rfs.endpoint_key = 'vehicle_positions'
          AND rfs.captured_at_utc < :cutoff_utc
          AND rfs.rt_feed_snapshot_id <> COALESCE((
                SELECT max(rfs_latest.rt_feed_snapshot_id)
                FROM silver.rt_feed_snapshots AS rfs_latest
                WHERE rfs_latest.provider_id = :provider_id
                  AND rfs_latest.endpoint_key = 'vehicle_positions'
            ), -1)
        LIMIT :batch
    )
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
    WHERE rte.ctid IN (
        SELECT rte_old.ctid
        FROM silver.rt_entities AS rte_old
        JOIN silver.rt_feed_snapshots AS rfs
            ON rte_old.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
        WHERE rfs.provider_id = :provider_id
          AND rfs.captured_at_utc < :cutoff_utc
          AND rfs.rt_feed_snapshot_id <> COALESCE((
                SELECT max(rfs_latest.rt_feed_snapshot_id)
                FROM silver.rt_feed_snapshots AS rfs_latest
                WHERE rfs_latest.provider_id = :provider_id
                  AND rfs_latest.endpoint_key = rfs.endpoint_key
            ), -1)
        LIMIT :batch
    )
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

# rt_feed_snapshots is the FK parent of rt_entities (which in turn parents
# rt_trip_updates / rt_vehicle_positions / rt_trip_update_stop_times) and NONE of
# those FKs cascade. With per-cycle batching a child table may not be fully
# drained in the same cycle, so the parent DELETE additionally guards on
# NOT EXISTS any surviving rt_entities row — a snapshot is removed only once its
# children are gone (over prior cycles). This preserves FK integrity that the old
# unbounded child-first ordering gave for free, while staying bounded to :batch.
DELETE_OLD_RT_FEED_SNAPSHOTS = text(
    """
    DELETE FROM silver.rt_feed_snapshots AS rfs
    WHERE rfs.ctid IN (
        SELECT rfs_old.ctid
        FROM silver.rt_feed_snapshots AS rfs_old
        WHERE rfs_old.provider_id = :provider_id
          AND rfs_old.captured_at_utc < :cutoff_utc
          AND rfs_old.rt_feed_snapshot_id <> COALESCE((
                SELECT max(rfs_latest.rt_feed_snapshot_id)
                FROM silver.rt_feed_snapshots AS rfs_latest
                WHERE rfs_latest.provider_id = :provider_id
                  AND rfs_latest.endpoint_key = rfs_old.endpoint_key
            ), -1)
          AND NOT EXISTS (
                SELECT 1
                FROM silver.rt_entities AS rte_child
                WHERE rte_child.rt_feed_snapshot_id = rfs_old.rt_feed_snapshot_id
            )
        LIMIT :batch
    )
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
      AND NOT (io.ingestion_object_id = ANY(CAST(:excluded_object_ids AS bigint[])))
    ORDER BY rsi.captured_at_utc ASC, io.ingestion_object_id ASC
    LIMIT :max_objects
    """
)

COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS = text(
    """
    SELECT COUNT(*)
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
      AND NOT (io.ingestion_object_id = ANY(CAST(:excluded_object_ids AS bigint[])))
    ORDER BY ir.started_at_utc ASC, io.ingestion_object_id ASC
    LIMIT :max_objects
    """
)

COUNT_ELIGIBLE_BRONZE_STATIC_OBJECTS = text(
    """
    SELECT COUNT(*)
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

# Age-gated so a worker capture that committed its ingestion_run but has not
# yet registered the object (two-transaction pattern) can never be deleted:
# in-flight runs are seconds old, the phase cutoff is 30/365 days in the past.
DELETE_ORPHANED_INGESTION_RUNS = text(
    """
    DELETE FROM raw.ingestion_runs ir
    WHERE ir.provider_id = :provider_id
      AND ir.started_at_utc < :cutoff_utc
      AND NOT EXISTS (
          SELECT 1 FROM raw.ingestion_objects io
          WHERE io.ingestion_run_id = ir.ingestion_run_id
      )
    """
)

# --- i3 retention SQL (slice-9.1.1l) ---
#
# Raw i3 snapshots are deletable only when no surviving silver.i3_alerts row
# still references them — the fk_silver_i3_alerts_snapshot_id FK is ON DELETE
# CASCADE (0013:200-205), so an unguarded raw delete would silently destroy
# live SCD-2 history. We also keep the per-provider latest snapshot so
# find_latest_i3_raw_snapshot (silver/i3.py) keeps resolving.
MIN_SILVER_I3_CLOSED_RETENTION_DAYS = 30

SELECT_ELIGIBLE_I3_RAW_SNAPSHOTS = text(
    """
    SELECT
        s.i3_alert_snapshot_id,
        s.ingestion_run_id,
        s.ingestion_object_id,
        s.storage_path
    FROM raw.i3_alert_snapshots s
    WHERE s.provider_id = :provider_id
      AND s.captured_at_utc < :cutoff_utc
      AND NOT EXISTS (
          SELECT 1 FROM silver.i3_alerts a
          WHERE a.i3_alert_snapshot_id = s.i3_alert_snapshot_id
      )
      AND s.i3_alert_snapshot_id <> COALESCE((
          SELECT max(s2.i3_alert_snapshot_id)
          FROM raw.i3_alert_snapshots s2
          WHERE s2.provider_id = :provider_id
      ), -1)
    ORDER BY s.captured_at_utc ASC, s.i3_alert_snapshot_id ASC
    LIMIT :max_objects
    """
)

COUNT_ELIGIBLE_I3_RAW_SNAPSHOTS = text(
    """
    SELECT COUNT(*)
    FROM raw.i3_alert_snapshots s
    WHERE s.provider_id = :provider_id
      AND s.captured_at_utc < :cutoff_utc
      AND NOT EXISTS (
          SELECT 1 FROM silver.i3_alerts a
          WHERE a.i3_alert_snapshot_id = s.i3_alert_snapshot_id
      )
      AND s.i3_alert_snapshot_id <> COALESCE((
          SELECT max(s2.i3_alert_snapshot_id)
          FROM raw.i3_alert_snapshots s2
          WHERE s2.provider_id = :provider_id
      ), -1)
    """
)

DELETE_I3_RAW_SNAPSHOTS_BY_IDS = text(
    """
    DELETE FROM raw.i3_alert_snapshots
    WHERE i3_alert_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
    """
)

DELETE_ORPHANED_I3_INGESTION_RUNS = text(
    """
    DELETE FROM raw.ingestion_runs ir
    WHERE ir.provider_id = :provider_id
      AND ir.run_kind = 'i3_alerts'
      AND ir.started_at_utc < :cutoff_utc
      AND NOT EXISTS (
          SELECT 1 FROM raw.ingestion_objects io
          WHERE io.ingestion_run_id = ir.ingestion_run_id
      )
      AND NOT EXISTS (
          SELECT 1 FROM raw.i3_alert_snapshots s
          WHERE s.ingestion_run_id = ir.ingestion_run_id
      )
    """
)

# Closed silver SCD-2 history rows older than the cutoff. Entities are deleted
# explicitly first (so the rowcount is reportable); the alerts delete then runs
# and the (snapshot_id, alert_index) cascade no-ops on already-gone entities.
DELETE_OLD_I3_SILVER_ENTITIES = text(
    """
    DELETE FROM silver.i3_alert_informed_entities e
    USING silver.i3_alerts a
    WHERE a.i3_alert_snapshot_id = e.i3_alert_snapshot_id
      AND a.alert_index = e.alert_index
      AND a.provider_id = :provider_id
      AND a.valid_to IS NOT NULL
      AND a.valid_to < :cutoff_utc
    """
)

DELETE_OLD_I3_SILVER_ALERTS = text(
    """
    DELETE FROM silver.i3_alerts a
    WHERE a.provider_id = :provider_id
      AND a.valid_to IS NOT NULL
      AND a.valid_to < :cutoff_utc
    """
)

COUNT_OLD_I3_SILVER_ENTITIES = text(
    """
    SELECT COUNT(*)
    FROM silver.i3_alert_informed_entities e
    JOIN silver.i3_alerts a
      ON a.i3_alert_snapshot_id = e.i3_alert_snapshot_id
     AND a.alert_index = e.alert_index
    WHERE a.provider_id = :provider_id
      AND a.valid_to IS NOT NULL
      AND a.valid_to < :cutoff_utc
    """
)

COUNT_OLD_I3_SILVER_ALERTS = text(
    """
    SELECT COUNT(*)
    FROM silver.i3_alerts a
    WHERE a.provider_id = :provider_id
      AND a.valid_to IS NOT NULL
      AND a.valid_to < :cutoff_utc
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
    failed_object_counts: dict[str, int]
    batch_counts: dict[str, int]
    exhausted: bool
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
class I3StoragePruneResult:
    provider_id: str
    dry_run: bool
    raw_retention_days: int
    silver_closed_retention_days: int
    raw_cutoff_utc: datetime | None
    silver_cutoff_utc: datetime | None
    deleted_object_counts: dict[str, int]
    deleted_row_counts: dict[str, int]
    failed_object_counts: dict[str, int]
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["raw_cutoff_utc"] = (
            self.raw_cutoff_utc.isoformat() if self.raw_cutoff_utc else None
        )
        payload["silver_cutoff_utc"] = (
            self.silver_cutoff_utc.isoformat() if self.silver_cutoff_utc else None
        )
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
    deferred_dataset_version_ids: list[int]
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


def _zero_static_prune_counts() -> dict[str, int]:
    return {
        **{table_name: 0 for table_name in STATIC_SILVER_TABLES},
        **{table_name: 0 for table_name in STATIC_DATASET_REFERENCE_TABLES},
        "core.dataset_versions": 0,
    }


def prune_static_silver_datasets(
    connection: Connection,
    *,
    provider_id: str,
    retention_count: int,
    dry_run: bool = False,
) -> tuple[list[int], list[int], list[int], dict[str, int]]:
    """Prune superseded static silver datasets, deferring gold-referenced ones.

    Returns (retained, pruned, deferred, deleted_row_counts). A candidate
    version still referenced by any gold dim FK-holder
    (GOLD_DATASET_REFERENCE_TABLES) is DEFERRED — it keeps BOTH its silver rows
    and its core.dataset_versions row (whole-version retention keeps the
    silver/dim joins consistent) — instead of being deleted, which would
    FK-violate. The next worker cycle prunes it once gold dims re-point to the
    current version (slice-9.1.1j).
    """
    if retention_count <= 0:
        retention_count = 1

    dataset_version_rows = connection.execute(
        SELECT_STATIC_DATASET_VERSION_IDS,
        {"provider_id": provider_id},
    )
    dataset_version_ids = [int(row[0]) for row in dataset_version_rows]
    retained_dataset_version_ids = dataset_version_ids[:retention_count]
    candidate_dataset_version_ids = dataset_version_ids[retention_count:]
    if not candidate_dataset_version_ids:
        # No candidates → skip the gold-reference lookup entirely (zero added
        # steady-state cost at the ~57s worker cadence).
        return retained_dataset_version_ids, [], [], _zero_static_prune_counts()

    gold_referenced_ids = {
        int(row[0])
        for row in connection.execute(
            SELECT_GOLD_REFERENCED_DATASET_VERSION_IDS,
            {"provider_id": provider_id},
        )
    }
    deferred_dataset_version_ids = [
        version_id
        for version_id in candidate_dataset_version_ids
        if version_id in gold_referenced_ids
    ]
    pruned_dataset_version_ids = [
        version_id
        for version_id in candidate_dataset_version_ids
        if version_id not in gold_referenced_ids
    ]
    if deferred_dataset_version_ids:
        logger.warning(
            "Deferring prune of static dataset versions %s for provider '%s' — "
            "still referenced by gold dims; will prune once dims re-point.",
            deferred_dataset_version_ids,
            provider_id,
        )
    if not pruned_dataset_version_ids:
        # Everything is deferred — execute no DELETEs/COUNTs.
        return (
            retained_dataset_version_ids,
            [],
            deferred_dataset_version_ids,
            _zero_static_prune_counts(),
        )

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
    return (
        retained_dataset_version_ids,
        pruned_dataset_version_ids,
        deferred_dataset_version_ids,
        deleted_row_counts,
    )


def prune_realtime_silver_history(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    batch_size: int = 50000,
    dry_run: bool = False,
    now_utc: datetime | None = None,
) -> tuple[datetime | None, dict[str, int]]:
    if retention_days <= 0:
        return None, {table_name: 0 for table_name in REALTIME_SILVER_TABLES}

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)
    # Each live DELETE is bounded to :batch rows so a one-time backlog drains over
    # many ~57s worker cycles instead of one unbounded transaction (hang class).
    # batch_size is floored at 1 to avoid a no-op LIMIT 0 that would never drain.
    batch = max(int(batch_size), 1)
    params = {
        "provider_id": provider_id,
        "cutoff_utc": cutoff_utc,
        "batch": batch,
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
    """Prune silver storage in TWO independent transactions (realtime FIRST).

    Realtime 14-day retention and static dataset pruning run in separate
    engine.begin() blocks, realtime first, so a static-prune failure can never
    roll back or starve the realtime retention. (A single shared transaction
    with static-first ordering let an FK abort in the static half kill the
    realtime DELETEs before they ran — the wave-2 prod regression this fixes,
    slice-9.1.1j.)
    """
    settings = settings or get_settings()
    engine = engine or make_engine(settings)

    # Transaction 1: realtime retention — must commit independently of the
    # static prune below.
    with engine.begin() as connection:
        realtime_cutoff_utc, realtime_deleted_row_counts = prune_realtime_silver_history(
            connection,
            provider_id=provider_id,
            retention_days=settings.SILVER_REALTIME_RETENTION_DAYS,
            batch_size=settings.SILVER_REALTIME_PRUNE_BATCH,
            dry_run=dry_run,
        )

    # Transaction 2: static dataset prune (with gold-reference deferral).
    with engine.begin() as connection:
        (
            retained_dataset_version_ids,
            pruned_dataset_version_ids,
            deferred_dataset_version_ids,
            static_deleted_row_counts,
        ) = prune_static_silver_datasets(
            connection,
            provider_id=provider_id,
            retention_count=settings.STATIC_DATASET_RETENTION_COUNT,
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
        deferred_dataset_version_ids=deferred_dataset_version_ids,
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
    max_objects: int = 5000,
    excluded_object_ids: Sequence[int] = (),
) -> tuple[datetime | None, dict[str, int], dict[str, int], set[int]]:
    """Return (cutoff_utc, deleted_object_counts, deleted_metadata_counts, failed_object_ids)."""
    zero_object_counts: dict[str, int] = {"realtime": 0}
    zero_meta_counts: dict[str, int] = {
        "raw.realtime_snapshot_index": 0,
        "raw.ingestion_objects": 0,
        "raw.ingestion_runs": 0,
    }
    if retention_days <= 0:
        return None, zero_object_counts, zero_meta_counts, set()

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)

    if dry_run:
        eligible_count = _safe_scalar_count(
            connection.execute(
                COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
                {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
            )
        )
        return (
            cutoff_utc,
            {"realtime": eligible_count},
            {
                "raw.realtime_snapshot_index": eligible_count,
                "raw.ingestion_objects": eligible_count,
                "raw.ingestion_runs": 0,
            },
            set(),
        )

    rows = list(
        connection.execute(
            SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
            {
                "provider_id": provider_id,
                "cutoff_utc": cutoff_utc,
                "max_objects": max_objects,
                "excluded_object_ids": list(excluded_object_ids),
            },
        )
    )

    if not rows:
        return cutoff_utc, zero_object_counts, zero_meta_counts, set()

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
        return cutoff_utc, {"realtime": 0}, zero_meta_counts, failed_object_ids

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
            {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
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
        failed_object_ids,
    )


def prune_bronze_static_objects(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    bronze_storage: BronzeStorage,
    dry_run: bool = False,
    now_utc: datetime | None = None,
    max_objects: int = 5000,
    excluded_object_ids: Sequence[int] = (),
) -> tuple[datetime | None, dict[str, int], dict[str, int], set[int]]:
    """Return (cutoff_utc, deleted_object_counts, deleted_metadata_counts, failed_object_ids)."""
    zero_object_counts: dict[str, int] = {"static": 0}
    zero_meta_counts: dict[str, int] = {
        "raw.ingestion_objects": 0,
        "raw.ingestion_runs": 0,
    }
    if retention_days <= 0:
        return None, zero_object_counts, zero_meta_counts, set()

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)

    if dry_run:
        eligible_count = _safe_scalar_count(
            connection.execute(
                COUNT_ELIGIBLE_BRONZE_STATIC_OBJECTS,
                {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
            )
        )
        return (
            cutoff_utc,
            {"static": eligible_count},
            {
                "raw.ingestion_objects": eligible_count,
                "raw.ingestion_runs": 0,
            },
            set(),
        )

    rows = list(
        connection.execute(
            SELECT_ELIGIBLE_BRONZE_STATIC_OBJECTS,
            {
                "provider_id": provider_id,
                "cutoff_utc": cutoff_utc,
                "max_objects": max_objects,
                "excluded_object_ids": list(excluded_object_ids),
            },
        )
    )

    if not rows:
        return cutoff_utc, zero_object_counts, zero_meta_counts, set()

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
        return cutoff_utc, {"static": 0}, zero_meta_counts, failed_object_ids

    obj_deleted = _safe_rowcount(
        connection.execute(
            DELETE_INGESTION_OBJECTS_BY_IDS,
            {"ingestion_object_ids": successful_object_ids},
        )
    )
    runs_deleted = _safe_rowcount(
        connection.execute(
            DELETE_ORPHANED_INGESTION_RUNS,
            {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
        )
    )

    return (
        cutoff_utc,
        {"static": deleted_object_count},
        {
            "raw.ingestion_objects": obj_deleted,
            "raw.ingestion_runs": runs_deleted,
        },
        failed_object_ids,
    )


def _run_bronze_prune_phase(
    engine: Engine,
    prune_batch,  # noqa: ANN001 — connection-level prune callable (4-tuple contract)
    *,
    provider_id: str,
    retention_days: int,
    bronze_storage: BronzeStorage,
    max_objects: int,
    max_batches: int,
) -> tuple[datetime | None, dict[str, int], dict[str, int], set[int], int, bool]:
    """Drain one Bronze phase in bounded batches, one transaction per batch.

    Carries failed object ids forward so they are excluded from re-selection
    (a poisoned queue head cannot stall or double-count), and stops early when
    a batch selects rows but deletes none (storage outage guard). Designed to
    be reusable for further raw prune phases (slice-9.1.1l).
    """
    phase_now_utc = utc_now()
    cutoff_utc: datetime | None = None
    object_counts: dict[str, int] = {}
    meta_counts: dict[str, int] = {}
    failed_object_ids: set[int] = set()
    batches = 0
    exhausted = False

    while batches < max_batches:
        with engine.begin() as connection:
            cutoff_utc, batch_object_counts, batch_meta_counts, batch_failed_ids = (
                prune_batch(
                    connection,
                    provider_id=provider_id,
                    retention_days=retention_days,
                    bronze_storage=bronze_storage,
                    dry_run=False,
                    now_utc=phase_now_utc,
                    max_objects=max_objects,
                    excluded_object_ids=sorted(failed_object_ids),
                )
            )
        batches += 1
        for key, value in batch_object_counts.items():
            object_counts[key] = object_counts.get(key, 0) + value
        for key, value in batch_meta_counts.items():
            meta_counts[key] = meta_counts.get(key, 0) + value
        failed_object_ids |= batch_failed_ids

        batch_successes = sum(batch_object_counts.values())
        batch_selected = batch_successes + len(batch_failed_ids)
        if batch_selected < max_objects:
            exhausted = True
            break
        if batch_successes == 0:
            break

    return cutoff_utc, object_counts, meta_counts, failed_object_ids, batches, exhausted


def prune_bronze_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
    max_objects: int | None = None,
    max_batches: int | None = None,
) -> BronzeStoragePruneResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    bronze_storage = get_bronze_storage(settings, project_root=Path(__file__).resolve().parents[2])

    resolved_max_objects = max(
        1,
        max_objects
        if max_objects is not None
        else settings.BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH,
    )
    resolved_max_batches = max(
        1,
        max_batches if max_batches is not None else settings.BRONZE_PRUNE_MAX_BATCHES,
    )

    if dry_run:
        with engine.begin() as connection:
            realtime_cutoff_utc, realtime_object_counts, realtime_meta_counts, _ = (
                prune_bronze_realtime_objects(
                    connection,
                    provider_id=provider_id,
                    retention_days=settings.BRONZE_REALTIME_RETENTION_DAYS,
                    bronze_storage=bronze_storage,
                    dry_run=True,
                )
            )
            static_cutoff_utc, static_object_counts, static_meta_counts, _ = (
                prune_bronze_static_objects(
                    connection,
                    provider_id=provider_id,
                    retention_days=settings.BRONZE_STATIC_RETENTION_DAYS,
                    bronze_storage=bronze_storage,
                    dry_run=True,
                )
            )
        failed_object_counts = {"realtime": 0, "static": 0}
        batch_counts = {"realtime": 0, "static": 0}
        exhausted = (
            sum(realtime_object_counts.values()) == 0
            and sum(static_object_counts.values()) == 0
        )
    else:
        (
            realtime_cutoff_utc,
            realtime_object_counts,
            realtime_meta_counts,
            realtime_failed_ids,
            realtime_batches,
            realtime_exhausted,
        ) = _run_bronze_prune_phase(
            engine,
            prune_bronze_realtime_objects,
            provider_id=provider_id,
            retention_days=settings.BRONZE_REALTIME_RETENTION_DAYS,
            bronze_storage=bronze_storage,
            max_objects=resolved_max_objects,
            max_batches=resolved_max_batches,
        )
        (
            static_cutoff_utc,
            static_object_counts,
            static_meta_counts,
            static_failed_ids,
            static_batches,
            static_exhausted,
        ) = _run_bronze_prune_phase(
            engine,
            prune_bronze_static_objects,
            provider_id=provider_id,
            retention_days=settings.BRONZE_STATIC_RETENTION_DAYS,
            bronze_storage=bronze_storage,
            max_objects=resolved_max_objects,
            max_batches=resolved_max_batches,
        )
        failed_object_counts = {
            "realtime": len(realtime_failed_ids),
            "static": len(static_failed_ids),
        }
        batch_counts = {"realtime": realtime_batches, "static": static_batches}
        exhausted = realtime_exhausted and static_exhausted

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
        failed_object_counts=failed_object_counts,
        batch_counts=batch_counts,
        exhausted=exhausted,
        completed_at_utc=completed_at_utc,
    )


def prune_i3_silver_closed_rows(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    dry_run: bool = False,
    now_utc: datetime | None = None,
) -> tuple[datetime | None, dict[str, int]]:
    """Prune closed (valid_to NOT NULL) silver.i3_alerts SCD-2 history.

    Returns (silver_cutoff_utc, deleted_row_counts). A 30-day floor is enforced
    in code so the alert_history 30d window (build_alert_history) always has
    rows to draw from. retention_days <= 0 disables the prune (house
    convention). Entities are deleted explicitly before alerts so each rowcount
    is reportable; the FK cascade on the alerts delete then no-ops.
    """

    zero_counts = {
        "silver.i3_alert_informed_entities": 0,
        "silver.i3_alerts": 0,
    }
    if retention_days <= 0:
        return None, zero_counts

    effective_days = max(retention_days, MIN_SILVER_I3_CLOSED_RETENTION_DAYS)
    cutoff_utc = (now_utc or utc_now()) - timedelta(days=effective_days)
    params = {"provider_id": provider_id, "cutoff_utc": cutoff_utc}

    if dry_run:
        entity_count = _safe_scalar_count(
            connection.execute(COUNT_OLD_I3_SILVER_ENTITIES, params)
        )
        alert_count = _safe_scalar_count(
            connection.execute(COUNT_OLD_I3_SILVER_ALERTS, params)
        )
        return cutoff_utc, {
            "silver.i3_alert_informed_entities": entity_count,
            "silver.i3_alerts": alert_count,
        }

    entities_deleted = _safe_rowcount(
        connection.execute(DELETE_OLD_I3_SILVER_ENTITIES, params)
    )
    alerts_deleted = _safe_rowcount(
        connection.execute(DELETE_OLD_I3_SILVER_ALERTS, params)
    )
    return cutoff_utc, {
        "silver.i3_alert_informed_entities": entities_deleted,
        "silver.i3_alerts": alerts_deleted,
    }


def prune_i3_raw_snapshots(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    bronze_storage: BronzeStorage,
    dry_run: bool = False,
    now_utc: datetime | None = None,
    max_objects: int = 5000,
) -> tuple[datetime | None, dict[str, int], dict[str, int], set[int]]:
    """Prune raw.i3_alert_snapshots + their R2 JSON, FK-safe.

    Returns (raw_cutoff_utc, deleted_object_counts, deleted_metadata_counts,
    failed_snapshot_ids). Eligible rows are older than the cutoff, no longer
    referenced by any silver.i3_alerts row (the ON DELETE CASCADE trap), and not
    the per-provider latest snapshot (find_latest_i3_raw_snapshot must keep
    working). R2 objects are deleted first with per-object failure-skip (a failed
    delete leaves the DB row for the next run), then metadata deletes run in FK
    order: snapshots -> ingestion_objects -> orphaned i3 ingestion runs.
    """

    zero_object_counts = {"i3_raw": 0}
    zero_meta_counts = {
        "raw.i3_alert_snapshots": 0,
        "raw.ingestion_objects": 0,
        "raw.ingestion_runs": 0,
    }
    if retention_days <= 0:
        return None, zero_object_counts, zero_meta_counts, set()

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)

    if dry_run:
        eligible_count = _safe_scalar_count(
            connection.execute(
                COUNT_ELIGIBLE_I3_RAW_SNAPSHOTS,
                {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
            )
        )
        return (
            cutoff_utc,
            {"i3_raw": eligible_count},
            {
                "raw.i3_alert_snapshots": eligible_count,
                "raw.ingestion_objects": eligible_count,
                "raw.ingestion_runs": 0,
            },
            set(),
        )

    rows = list(
        connection.execute(
            SELECT_ELIGIBLE_I3_RAW_SNAPSHOTS,
            {
                "provider_id": provider_id,
                "cutoff_utc": cutoff_utc,
                "max_objects": max_objects,
            },
        )
    )
    if not rows:
        return cutoff_utc, zero_object_counts, zero_meta_counts, set()

    deleted_object_count = 0
    failed_snapshot_ids: set[int] = set()
    for row in rows:
        snapshot_id = int(row[0])
        storage_path = row[3]
        if storage_path is None:
            # No R2 object to remove (older capture before storage_path was set).
            continue
        try:
            bronze_storage.delete_object(str(storage_path))
            deleted_object_count += 1
        except Exception as exc:
            logger.error(
                "Failed to delete i3 raw object '%s' (i3_alert_snapshot_id=%s): %s",
                storage_path,
                snapshot_id,
                exc,
            )
            failed_snapshot_ids.add(snapshot_id)

    successful_snapshot_ids = [
        int(row[0]) for row in rows if int(row[0]) not in failed_snapshot_ids
    ]
    if not successful_snapshot_ids:
        return cutoff_utc, {"i3_raw": 0}, zero_meta_counts, failed_snapshot_ids

    successful_object_ids = [
        int(row[2])
        for row in rows
        if int(row[0]) in successful_snapshot_ids and row[2] is not None
    ]

    snapshots_deleted = _safe_rowcount(
        connection.execute(
            DELETE_I3_RAW_SNAPSHOTS_BY_IDS,
            {"snapshot_ids": successful_snapshot_ids},
        )
    )
    objects_deleted = 0
    if successful_object_ids:
        objects_deleted = _safe_rowcount(
            connection.execute(
                DELETE_INGESTION_OBJECTS_BY_IDS,
                {"ingestion_object_ids": successful_object_ids},
            )
        )
    runs_deleted = _safe_rowcount(
        connection.execute(
            DELETE_ORPHANED_I3_INGESTION_RUNS,
            {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
        )
    )

    return (
        cutoff_utc,
        {"i3_raw": deleted_object_count},
        {
            "raw.i3_alert_snapshots": snapshots_deleted,
            "raw.ingestion_objects": objects_deleted,
            "raw.ingestion_runs": runs_deleted,
        },
        failed_snapshot_ids,
    )


def prune_i3_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> I3StoragePruneResult:
    """Prune closed silver i3 history, then raw i3 snapshots + their R2 JSON.

    Silver-closed runs FIRST so any raw snapshot whose last referencing silver
    row was just pruned becomes eligible for the raw sweep in the same
    transaction. Both phases run inside one engine.begin().
    """

    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    bronze_storage = get_bronze_storage(
        settings, project_root=Path(__file__).resolve().parents[2]
    )

    silver_retention = settings.SILVER_I3_CLOSED_RETENTION_DAYS
    raw_retention = settings.BRONZE_I3_RETENTION_DAYS

    with engine.begin() as connection:
        silver_cutoff_utc, silver_row_counts = prune_i3_silver_closed_rows(
            connection,
            provider_id=provider_id,
            retention_days=silver_retention,
            dry_run=dry_run,
        )
        raw_cutoff_utc, raw_object_counts, raw_meta_counts, failed_snapshot_ids = (
            prune_i3_raw_snapshots(
                connection,
                provider_id=provider_id,
                retention_days=raw_retention,
                bronze_storage=bronze_storage,
                dry_run=dry_run,
            )
        )
        completed_at_utc = utc_now()

    deleted_row_counts = {**silver_row_counts, **raw_meta_counts}

    return I3StoragePruneResult(
        provider_id=provider_id,
        dry_run=dry_run,
        raw_retention_days=raw_retention,
        silver_closed_retention_days=silver_retention,
        raw_cutoff_utc=raw_cutoff_utc,
        silver_cutoff_utc=silver_cutoff_utc,
        deleted_object_counts=raw_object_counts,
        deleted_row_counts=deleted_row_counts,
        failed_object_counts={"i3_raw": len(failed_snapshot_ids)},
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
    # PARALLEL 0: parallel vacuum workers allocate DSM in /dev/shm, which the
    # A1 VM's postgres container caps at 64MB. PARALLEL is invalid with FULL.
    vacuum_mode = "FULL, ANALYZE" if full else "PARALLEL 0, ANALYZE"

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
