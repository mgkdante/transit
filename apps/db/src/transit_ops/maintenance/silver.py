"""Realtime + static silver storage prune tier (slice-9.1.1-zeta split)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings

from ._helpers import _safe_rowcount, _safe_scalar_count
from .static import prune_static_silver_datasets

REALTIME_SILVER_TABLES = (
    "silver.rt_trip_update_stop_times",
    "silver.rt_trip_updates",
    "silver.rt_vehicle_positions",
    "silver.rt_entities",
    "silver.rt_feed_snapshots",
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
