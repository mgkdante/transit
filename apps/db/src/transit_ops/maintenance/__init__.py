"""Pipeline storage-retention maintenance: per-tier prune + vacuum entry points.

Each ``prune_*_storage`` function applies a retention policy to one medallion
tier (bronze/silver/gold) or the i3-alerts subsystem, deleting aged rows and the
R2 objects they index. ``vacuum_storage`` reclaims dead-tuple bloat afterward.

This package was split from a single ``maintenance.py`` module (slice-9.1.1-zeta)
into per-tier submodules with a shared helper leaf — a pure mechanical refactor,
zero behavior change.  The dependency graph is acyclic:
``__init__ -> {vacuum} -> {silver, gold, bronze, i3} -> static -> _helpers`` (with
i3 also depending on bronze for the shared ingestion-objects DELETE, and silver on
static for the static-dataset prune).

  * :mod:`._helpers` — ``_safe_rowcount`` / ``_safe_scalar_count`` count coercion
    and the package ``logger``, shared across every tier.
  * :mod:`.static`   — superseded static-schedule dataset prune (gold-FK deferral).
  * :mod:`.silver`   — realtime silver-history prune + the silver entry point.
  * :mod:`.gold`     — gold fact-history + warm-rollup/aggregate retention.
  * :mod:`.bronze`   — raw object + metadata retention (realtime + static).
  * :mod:`.i3`       — i3 raw snapshots + closed silver SCD-2 history retention.
  * :mod:`.vacuum`   — VACUUM (ANALYZE) over the maintained table set.

Names are re-exported here so importers can keep using
``transit_ops.maintenance`` (both ``from ... import name`` and the
``maintenance_module.<name>`` attribute access used by the tests) unchanged.
"""

from __future__ import annotations

from transit_ops.ingestion.storage import get_bronze_storage

from ._helpers import _safe_rowcount, _safe_scalar_count
from .bronze import (
    COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
    COUNT_ELIGIBLE_BRONZE_STATIC_OBJECTS,
    DELETE_INGESTION_OBJECTS_BY_IDS,
    DELETE_ORPHANED_INGESTION_RUNS,
    DELETE_REALTIME_SNAPSHOT_INDEX_BY_OBJECT_IDS,
    RAW_BRONZE_METADATA_TABLES,
    SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
    SELECT_ELIGIBLE_BRONZE_STATIC_OBJECTS,
    BronzeStoragePruneResult,
    prune_bronze_realtime_objects,
    prune_bronze_static_objects,
    prune_bronze_storage,
)
from .gold import (
    ALERT_ARCHIVE_RETENTION_TABLE,
    COUNT_OLD_FACT_TRIP_DELAY_SNAPSHOTS,
    COUNT_OLD_FACT_VEHICLE_SNAPSHOTS,
    DELETE_OLD_FACT_TRIP_DELAY_SNAPSHOTS,
    DELETE_OLD_FACT_VEHICLE_SNAPSHOTS,
    GOLD_AGGREGATE_RETENTION_COLUMNS,
    GOLD_AGGREGATE_TABLES,
    GOLD_FACT_TABLES,
    GOLD_REPORTING_AGGREGATE_TABLES,
    GOLD_WARM_ROLLUP_TABLES,
    VALID_GOLD_AGGREGATE_RETENTION_TARGETS,
    GoldStoragePruneResult,
    WarmRollupStoragePruneResult,
    _gold_aggregate_retention_statement,
    prune_alert_archive_history,
    prune_gold_fact_history,
    prune_gold_storage,
    prune_warm_rollup_storage,
)
from .i3 import (
    COUNT_ELIGIBLE_I3_RAW_SNAPSHOTS,
    COUNT_OLD_I3_SILVER_ALERTS,
    COUNT_OLD_I3_SILVER_ENTITIES,
    DELETE_I3_RAW_SNAPSHOTS_BY_IDS,
    DELETE_OLD_I3_SILVER_ALERTS,
    DELETE_OLD_I3_SILVER_ENTITIES,
    DELETE_ORPHANED_I3_INGESTION_RUNS,
    I3_RETENTION_TABLES,
    MIN_SILVER_I3_CLOSED_RETENTION_DAYS,
    SELECT_ELIGIBLE_I3_RAW_SNAPSHOTS,
    I3StoragePruneResult,
    prune_i3_raw_snapshots,
    prune_i3_silver_closed_rows,
    prune_i3_storage,
)
from .silver import (
    COUNT_OLD_RT_ENTITIES,
    COUNT_OLD_RT_FEED_SNAPSHOTS,
    COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES,
    COUNT_OLD_RT_TRIP_UPDATES,
    COUNT_OLD_RT_VEHICLE_POSITIONS,
    DELETE_OLD_RT_ENTITIES,
    DELETE_OLD_RT_FEED_SNAPSHOTS,
    DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES,
    DELETE_OLD_RT_TRIP_UPDATES,
    DELETE_OLD_RT_VEHICLE_POSITIONS,
    REALTIME_SILVER_TABLES,
    SilverStoragePruneResult,
    prune_realtime_silver_history,
    prune_silver_storage,
)
from .static import (
    COUNT_DATASET_VERSIONS,
    DELETE_DATASET_VERSIONS,
    GIS_SILVER_TABLES,
    GOLD_DATASET_REFERENCE_TABLES,
    SELECT_GOLD_REFERENCED_DATASET_VERSION_IDS,
    SELECT_STATIC_DATASET_VERSION_IDS,
    STATIC_DATASET_REFERENCE_TABLES,
    STATIC_SILVER_TABLES,
    _dataset_table_statement,
    _static_dataset_reference_statement,
    _zero_static_prune_counts,
    prune_static_silver_datasets,
)
from .vacuum import VACUUM_TABLES, VacuumResult, vacuum_storage

__all__ = [
    # storage factory (re-exported so tests can monkeypatch it on the package)
    "get_bronze_storage",
    # helpers (private, re-exported for tests)
    "_safe_rowcount",
    "_safe_scalar_count",
    # static tier
    "STATIC_SILVER_TABLES",
    "STATIC_DATASET_REFERENCE_TABLES",
    "GOLD_DATASET_REFERENCE_TABLES",
    "GIS_SILVER_TABLES",
    "SELECT_STATIC_DATASET_VERSION_IDS",
    "SELECT_GOLD_REFERENCED_DATASET_VERSION_IDS",
    "DELETE_DATASET_VERSIONS",
    "COUNT_DATASET_VERSIONS",
    "_dataset_table_statement",
    "_static_dataset_reference_statement",
    "_zero_static_prune_counts",
    "prune_static_silver_datasets",
    # silver tier
    "REALTIME_SILVER_TABLES",
    "DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES",
    "COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES",
    "DELETE_OLD_RT_TRIP_UPDATES",
    "COUNT_OLD_RT_TRIP_UPDATES",
    "DELETE_OLD_RT_VEHICLE_POSITIONS",
    "COUNT_OLD_RT_VEHICLE_POSITIONS",
    "DELETE_OLD_RT_ENTITIES",
    "COUNT_OLD_RT_ENTITIES",
    "DELETE_OLD_RT_FEED_SNAPSHOTS",
    "COUNT_OLD_RT_FEED_SNAPSHOTS",
    "SilverStoragePruneResult",
    "prune_realtime_silver_history",
    "prune_silver_storage",
    # gold tier
    "ALERT_ARCHIVE_RETENTION_TABLE",
    "GOLD_FACT_TABLES",
    "GOLD_WARM_ROLLUP_TABLES",
    "GOLD_REPORTING_AGGREGATE_TABLES",
    "GOLD_AGGREGATE_TABLES",
    "GOLD_AGGREGATE_RETENTION_COLUMNS",
    "VALID_GOLD_AGGREGATE_RETENTION_TARGETS",
    "DELETE_OLD_FACT_TRIP_DELAY_SNAPSHOTS",
    "COUNT_OLD_FACT_TRIP_DELAY_SNAPSHOTS",
    "DELETE_OLD_FACT_VEHICLE_SNAPSHOTS",
    "COUNT_OLD_FACT_VEHICLE_SNAPSHOTS",
    "_gold_aggregate_retention_statement",
    "GoldStoragePruneResult",
    "WarmRollupStoragePruneResult",
    "prune_gold_fact_history",
    "prune_alert_archive_history",
    "prune_gold_storage",
    "prune_warm_rollup_storage",
    # bronze tier
    "RAW_BRONZE_METADATA_TABLES",
    "SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS",
    "COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS",
    "SELECT_ELIGIBLE_BRONZE_STATIC_OBJECTS",
    "COUNT_ELIGIBLE_BRONZE_STATIC_OBJECTS",
    "DELETE_REALTIME_SNAPSHOT_INDEX_BY_OBJECT_IDS",
    "DELETE_INGESTION_OBJECTS_BY_IDS",
    "DELETE_ORPHANED_INGESTION_RUNS",
    "BronzeStoragePruneResult",
    "prune_bronze_realtime_objects",
    "prune_bronze_static_objects",
    "prune_bronze_storage",
    # i3 tier
    "I3_RETENTION_TABLES",
    "MIN_SILVER_I3_CLOSED_RETENTION_DAYS",
    "SELECT_ELIGIBLE_I3_RAW_SNAPSHOTS",
    "COUNT_ELIGIBLE_I3_RAW_SNAPSHOTS",
    "DELETE_I3_RAW_SNAPSHOTS_BY_IDS",
    "DELETE_ORPHANED_I3_INGESTION_RUNS",
    "DELETE_OLD_I3_SILVER_ENTITIES",
    "DELETE_OLD_I3_SILVER_ALERTS",
    "COUNT_OLD_I3_SILVER_ENTITIES",
    "COUNT_OLD_I3_SILVER_ALERTS",
    "I3StoragePruneResult",
    "prune_i3_silver_closed_rows",
    "prune_i3_raw_snapshots",
    "prune_i3_storage",
    # vacuum tier
    "VACUUM_TABLES",
    "VacuumResult",
    "vacuum_storage",
]
