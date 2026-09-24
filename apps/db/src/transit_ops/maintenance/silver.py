"""Capture-time retention with bounded, child-first Silver deletion."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine, set_daily_warm_transaction_timeouts
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings

from ._helpers import _safe_rowcount, _safe_scalar_count, require_prune_transaction
from .static import prune_static_silver_datasets

REALTIME_SILVER_TABLES = (
    "silver.rt_trip_update_stop_times",
    "silver.rt_trip_updates",
    "silver.rt_vehicle_positions",
    "silver.rt_entities",
    "silver.rt_feed_snapshots",
)

SELECT_EXPIRED_RT_SNAPSHOTS = text(
    """
    WITH latest AS MATERIALIZED (
        SELECT DISTINCT ON (endpoint_key) endpoint_key, rt_feed_snapshot_id
        FROM silver.rt_feed_snapshots
        WHERE provider_id = :provider_id
        ORDER BY endpoint_key, captured_at_utc DESC,
                 source_realtime_snapshot_id DESC NULLS LAST, rt_feed_snapshot_id DESC
    )
    SELECT s.rt_feed_snapshot_id, s.source_realtime_snapshot_id
    FROM silver.rt_feed_snapshots s
    JOIN latest USING (endpoint_key)
    WHERE s.provider_id = :provider_id
      AND s.captured_at_utc < :cutoff_utc
      AND s.rt_feed_snapshot_id <> latest.rt_feed_snapshot_id
    """
)

DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES = text(
    """
    DELETE FROM silver.rt_trip_update_stop_times AS rstu
    WHERE rstu.ctid IN (
        SELECT rstu_old.ctid
        FROM silver.rt_trip_update_stop_times AS rstu_old
        WHERE rstu_old.provider_id = :provider_id
          AND rstu_old.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
        LIMIT :batch
    )
    """
)

COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES = text(
    """
    SELECT COUNT(*) FROM silver.rt_trip_update_stop_times AS rstu
    WHERE rstu.provider_id = :provider_id
      AND rstu.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
    """
)

DELETE_OLD_RT_TRIP_UPDATES = text(
    """
    DELETE FROM silver.rt_trip_updates AS rtu
    WHERE rtu.ctid IN (
        SELECT rtu_old.ctid
        FROM silver.rt_trip_updates AS rtu_old
        WHERE rtu_old.provider_id = :provider_id
          AND rtu_old.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
          AND NOT EXISTS (
                SELECT 1
                FROM silver.rt_trip_update_stop_times AS rstu_child
                WHERE rstu_child.rt_feed_snapshot_id = rtu_old.rt_feed_snapshot_id
                  AND rstu_child.entity_index = rtu_old.entity_index
            )
        LIMIT :batch
    )
    """
)

COUNT_OLD_RT_TRIP_UPDATES = text(
    """
    SELECT COUNT(*) FROM silver.rt_trip_updates AS rtu
    WHERE rtu.provider_id = :provider_id
      AND rtu.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
    """
)

DELETE_OLD_RT_VEHICLE_POSITIONS = text(
    """
    DELETE FROM silver.rt_vehicle_positions AS rvp
    WHERE rvp.ctid IN (
        SELECT rvp_old.ctid
        FROM silver.rt_vehicle_positions AS rvp_old
        WHERE rvp_old.provider_id = :provider_id
          AND rvp_old.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
        LIMIT :batch
    )
    """
)

COUNT_OLD_RT_VEHICLE_POSITIONS = text(
    """
    SELECT COUNT(*) FROM silver.rt_vehicle_positions AS rvp
    WHERE rvp.provider_id = :provider_id
      AND rvp.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
    """
)

DELETE_OLD_RT_ENTITIES = text(
    """
    DELETE FROM silver.rt_entities AS rte
    WHERE rte.ctid IN (
        SELECT rte_old.ctid
        FROM silver.rt_entities AS rte_old
        WHERE rte_old.provider_id = :provider_id
          AND rte_old.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
          AND NOT EXISTS (
                SELECT 1 FROM silver.rt_trip_updates AS rtu_child
                WHERE rtu_child.rt_feed_snapshot_id = rte_old.rt_feed_snapshot_id
                  AND rtu_child.entity_index = rte_old.entity_index
            )
          AND NOT EXISTS (
                SELECT 1 FROM silver.rt_vehicle_positions AS rvp_child
                WHERE rvp_child.rt_feed_snapshot_id = rte_old.rt_feed_snapshot_id
                  AND rvp_child.entity_index = rte_old.entity_index
            )
        LIMIT :batch
    )
    """
)

COUNT_OLD_RT_ENTITIES = text(
    """
    SELECT COUNT(*) FROM silver.rt_entities AS rte
    WHERE rte.provider_id = :provider_id
      AND rte.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
    """
)

DELETE_OLD_RT_FEED_SNAPSHOTS = text(
    """
    DELETE FROM silver.rt_feed_snapshots AS rfs
    WHERE rfs.ctid IN (
        SELECT rfs_old.ctid
        FROM silver.rt_feed_snapshots AS rfs_old
        WHERE rfs_old.provider_id = :provider_id
          AND rfs_old.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
          AND NOT EXISTS (
                SELECT 1 FROM silver.rt_entities AS rte_child
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
      AND rfs.rt_feed_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
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


def _expired_snapshot_ids(
    connection: Connection, params: dict[str, object], *, dry_run: bool
) -> list[int]:
    snapshots = connection.execute(SELECT_EXPIRED_RT_SNAPSHOTS, params).all()
    if dry_run or not snapshots:
        return [int(row[0]) for row in snapshots]

    # Replay locks Raw before loading Silver; skip active captures in that order.
    locked_sources = {
        int(row[0])
        for row in connection.execute(
            text("""
                SELECT realtime_snapshot_id FROM raw.realtime_snapshot_index
                WHERE provider_id = :provider_id
                  AND realtime_snapshot_id = ANY(CAST(:source_ids AS bigint[]))
                ORDER BY realtime_snapshot_id
                FOR UPDATE SKIP LOCKED
            """),
            params | {"source_ids": [row[1] for row in snapshots if row[1] is not None]},
        ).all()
    }
    candidate_ids = [
        int(snapshot_id)
        for snapshot_id, source_id in snapshots
        if source_id is None or source_id in locked_sources
    ]
    return [
        int(row[0])
        for row in connection.execute(
            text(
                SELECT_EXPIRED_RT_SNAPSHOTS.text
                + """
                AND s.rt_feed_snapshot_id = ANY(CAST(:candidate_ids AS bigint[]))
                ORDER BY s.rt_feed_snapshot_id
                FOR UPDATE OF s SKIP LOCKED
            """
            ),
            params | {"candidate_ids": candidate_ids},
        ).all()
    ]


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

    if not dry_run:
        require_prune_transaction(connection)
    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)
    params: dict[str, object] = {"provider_id": provider_id, "cutoff_utc": cutoff_utc}
    params["snapshot_ids"] = _expired_snapshot_ids(connection, params, dry_run=dry_run)
    if not params["snapshot_ids"]:
        return cutoff_utc, {table_name: 0 for table_name in REALTIME_SILVER_TABLES}
    params["batch"] = max(int(batch_size), 1)
    statements = (
        (
            COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES,
            COUNT_OLD_RT_TRIP_UPDATES,
            COUNT_OLD_RT_VEHICLE_POSITIONS,
            COUNT_OLD_RT_ENTITIES,
            COUNT_OLD_RT_FEED_SNAPSHOTS,
        )
        if dry_run
        else (
            DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES,
            DELETE_OLD_RT_TRIP_UPDATES,
            DELETE_OLD_RT_VEHICLE_POSITIONS,
            DELETE_OLD_RT_ENTITIES,
            DELETE_OLD_RT_FEED_SNAPSHOTS,
        )
    )
    count = _safe_scalar_count if dry_run else _safe_rowcount
    return cutoff_utc, {
        table_name: count(connection.execute(statement, params))
        for table_name, statement in zip(REALTIME_SILVER_TABLES, statements, strict=True)
    }


def prune_silver_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> SilverStoragePruneResult:
    """Prune silver storage in TWO independent transactions (realtime FIRST).

    Realtime retention and static dataset pruning run in separate
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
        set_daily_warm_transaction_timeouts(connection)
        realtime_cutoff_utc, realtime_deleted_row_counts = prune_realtime_silver_history(
            connection,
            provider_id=provider_id,
            retention_days=settings.SILVER_REALTIME_RETENTION_DAYS,
            batch_size=settings.SILVER_REALTIME_PRUNE_BATCH,
            dry_run=dry_run,
        )

    # Transaction 2: static dataset prune (with gold-reference deferral).
    with engine.begin() as connection:
        set_daily_warm_transaction_timeouts(connection)
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
