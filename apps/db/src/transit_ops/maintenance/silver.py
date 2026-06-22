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

# ---------------------------------------------------------------------------
# Fast prune via rt_feed_snapshot_id RANGES (PR-B / slice-9.8-pruner-service).
#
# The realtime-history child tables (esp. silver.rt_trip_update_stop_times, the
# 99GB/748M-row hot table) all FK up to silver.rt_feed_snapshots and lead their
# PK with rt_feed_snapshot_id. The retention boundary is a function of
# captured_at_utc, but rt_feed_snapshots is TINY (~24k rows) and its serial
# rt_feed_snapshot_id is created in capture-time order — i.e. monotonic with
# captured_at_utc. So we resolve, per endpoint_key, the OLDEST snapshot id to
# KEEP from the tiny snapshot table, then delete children by an id-range
# (rt_feed_snapshot_id < :keep_from_id) — an index range scan on the PK leading
# column instead of the old ctid-JOIN-on-captured_at that scanned the 99GB child.
#
# RETENTION EXACTNESS vs the prior captured_at predicate (byte-identical effect):
#   keep_from_id := COALESCE(
#       min(rt_feed_snapshot_id) WHERE captured_at_utc >= cutoff,   -- oldest kept
#       max(rt_feed_snapshot_id))                                   -- dead feed: keep latest
#   per endpoint_key. Then "rt_feed_snapshot_id < keep_from_id" is the delete set.
#   1. min-of-keep boundary (NOT max-of-old) is the strictly safer choice under a
#      rare captured_at/id inversion straddling the boundary: it can only UNDER-
#      delete a straddling old-id/new-captured-at row (re-evaluated next cycle),
#      never OVER-delete a row the captured_at version would keep. No over-deletion.
#   2. keep_from_id is computed PER endpoint_key — preserving the prior
#      per-(provider_id, endpoint_key) "keep the latest snapshot for this endpoint"
#      semantics exactly.
#   3. latest always kept: a live feed's latest snapshot has captured_at >= cutoff,
#      so keep_from_id <= latest.id, so "id < keep_from_id" never includes it. For a
#      DEAD feed (no snapshot in the keep-window, min(...) IS NULL) we fall back to
#      keep_from_id = max(id), so "id < max(id)" still spares the single latest row
#      — identical to the prior COALESCE(max(id), -1) latest-exclusion.
#
# DELETEs stay BOUNDED to :batch rows/table/cycle (LIMIT via ctid sub-select) so a
# one-time backlog drains over many passes — never an unbounded single-transaction
# DELETE (the 0034 unbounded-heavy-op hang class). FK-safe order is unchanged
# (children -> parents) and the NOT EXISTS parent guards are preserved so a
# partially-drained child in one pass can never orphan a parent delete.
# ---------------------------------------------------------------------------

# Per-endpoint cutoff resolution against the TINY snapshot table. Returns, for
# each endpoint_key, the oldest rt_feed_snapshot_id to KEEP (see exactness note).
SELECT_KEEP_FROM_IDS = text(
    """
    SELECT
        endpoint_key,
        COALESCE(
            min(rt_feed_snapshot_id) FILTER (WHERE captured_at_utc >= :cutoff_utc),
            max(rt_feed_snapshot_id)
        ) AS keep_from_id
    FROM silver.rt_feed_snapshots
    WHERE provider_id = :provider_id
    GROUP BY endpoint_key
    """
)

DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES = text(
    """
    DELETE FROM silver.rt_trip_update_stop_times AS rstu
    WHERE rstu.ctid IN (
        SELECT rstu_old.ctid
        FROM silver.rt_trip_update_stop_times AS rstu_old
        WHERE rstu_old.provider_id = :provider_id
          AND rstu_old.rt_feed_snapshot_id < :keep_from_trip_updates
        LIMIT :batch
    )
    """
)

COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES = text(
    """
    SELECT COUNT(*) FROM silver.rt_trip_update_stop_times AS rstu
    WHERE rstu.provider_id = :provider_id
      AND rstu.rt_feed_snapshot_id < :keep_from_trip_updates
    """
)

DELETE_OLD_RT_TRIP_UPDATES = text(
    """
    DELETE FROM silver.rt_trip_updates AS rtu
    WHERE rtu.ctid IN (
        SELECT rtu_old.ctid
        FROM silver.rt_trip_updates AS rtu_old
        WHERE rtu_old.provider_id = :provider_id
          AND rtu_old.rt_feed_snapshot_id < :keep_from_trip_updates
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
      AND rtu.rt_feed_snapshot_id < :keep_from_trip_updates
    """
)

DELETE_OLD_RT_VEHICLE_POSITIONS = text(
    """
    DELETE FROM silver.rt_vehicle_positions AS rvp
    WHERE rvp.ctid IN (
        SELECT rvp_old.ctid
        FROM silver.rt_vehicle_positions AS rvp_old
        WHERE rvp_old.provider_id = :provider_id
          AND rvp_old.rt_feed_snapshot_id < :keep_from_vehicle_positions
        LIMIT :batch
    )
    """
)

COUNT_OLD_RT_VEHICLE_POSITIONS = text(
    """
    SELECT COUNT(*) FROM silver.rt_vehicle_positions AS rvp
    WHERE rvp.provider_id = :provider_id
      AND rvp.rt_feed_snapshot_id < :keep_from_vehicle_positions
    """
)

# rt_entities is keyed per endpoint_key: a row is eligible when its snapshot's id
# is below the keep_from_id of ITS OWN endpoint_key. The per-endpoint keep map is
# materialized as a VALUES list and joined so each endpoint applies its own
# boundary (preserving the prior per-(provider, endpoint) latest-exclusion).
DELETE_OLD_RT_ENTITIES = text(
    """
    DELETE FROM silver.rt_entities AS rte
    WHERE rte.ctid IN (
        SELECT rte_old.ctid
        FROM silver.rt_entities AS rte_old
        JOIN silver.rt_feed_snapshots AS rfs
            ON rte_old.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
        JOIN (
            SELECT * FROM (VALUES {keep_map}) AS km(endpoint_key, keep_from_id)
        ) AS km
            ON km.endpoint_key = rfs.endpoint_key
        WHERE rfs.provider_id = :provider_id
          AND rfs.rt_feed_snapshot_id < km.keep_from_id
          AND NOT EXISTS (
                SELECT 1
                FROM silver.rt_trip_updates AS rtu_child
                WHERE rtu_child.rt_feed_snapshot_id = rte_old.rt_feed_snapshot_id
                  AND rtu_child.entity_index = rte_old.entity_index
            )
          AND NOT EXISTS (
                SELECT 1
                FROM silver.rt_vehicle_positions AS rvp_child
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
    JOIN silver.rt_feed_snapshots AS rfs
        ON rte.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
    JOIN (
        SELECT * FROM (VALUES {keep_map}) AS km(endpoint_key, keep_from_id)
    ) AS km
        ON km.endpoint_key = rfs.endpoint_key
    WHERE rfs.provider_id = :provider_id
      AND rfs.rt_feed_snapshot_id < km.keep_from_id
    """
)

# rt_feed_snapshots is the FK parent of rt_entities (which in turn parents
# rt_trip_updates / rt_vehicle_positions / rt_trip_update_stop_times) and NONE of
# those FKs cascade. With per-cycle batching a child table may not be fully
# drained in the same cycle, so the parent DELETE additionally guards on
# NOT EXISTS any surviving rt_entities row — a snapshot is removed only once its
# children are gone (over prior cycles). This preserves FK integrity that the old
# unbounded child-first ordering gave for free, while staying bounded to :batch.
# The id-range boundary is per endpoint_key (via the keep map), matching the prior
# per-(provider, endpoint) latest-exclusion exactly.
DELETE_OLD_RT_FEED_SNAPSHOTS = text(
    """
    DELETE FROM silver.rt_feed_snapshots AS rfs
    WHERE rfs.ctid IN (
        SELECT rfs_old.ctid
        FROM silver.rt_feed_snapshots AS rfs_old
        JOIN (
            SELECT * FROM (VALUES {keep_map}) AS km(endpoint_key, keep_from_id)
        ) AS km
            ON km.endpoint_key = rfs_old.endpoint_key
        WHERE rfs_old.provider_id = :provider_id
          AND rfs_old.rt_feed_snapshot_id < km.keep_from_id
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
    JOIN (
        SELECT * FROM (VALUES {keep_map}) AS km(endpoint_key, keep_from_id)
    ) AS km
        ON km.endpoint_key = rfs.endpoint_key
    WHERE rfs.provider_id = :provider_id
      AND rfs.rt_feed_snapshot_id < km.keep_from_id
    """
)

# Endpoint keys whose CHILD deletes (steps 1-3) bind a single scalar keep_from_id.
# trip_updates feeds rt_trip_updates + rt_trip_update_stop_times; vehicle_positions
# feeds rt_vehicle_positions. (rt_entities / rt_feed_snapshots span all endpoints,
# so they use the full per-endpoint keep map instead.)
_TRIP_UPDATES_ENDPOINT = "trip_updates"
_VEHICLE_POSITIONS_ENDPOINT = "vehicle_positions"


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


# A keep_from_id of 0 deletes nothing for that endpoint (no row has id < 0). Used
# as the absence fallback so a table whose endpoint never appears in the snapshot
# table prunes nothing rather than erroring on a missing scalar.
_NO_DELETE_KEEP_FROM_ID = 0


def _resolve_keep_from_ids(
    connection: Connection,
    *,
    provider_id: str,
    cutoff_utc: datetime,
) -> dict[str, int]:
    """Per-endpoint oldest snapshot id to KEEP (see the exactness note above).

    Reads the TINY silver.rt_feed_snapshots table once; returns {endpoint_key:
    keep_from_id}. A NULL keep_from_id (no snapshot for the endpoint at all) is
    dropped — its child tables then bind the no-delete fallback.
    """
    rows = connection.execute(
        SELECT_KEEP_FROM_IDS,
        {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
    ).all()
    return {
        str(endpoint_key): int(keep_from_id)
        for endpoint_key, keep_from_id in rows
        if keep_from_id is not None
    }


def _render_keep_map(
    statement_sql: str,
    keep_from_ids: dict[str, int],
    params: dict[str, object],
) -> text:
    """Render the {keep_map} VALUES placeholder with bound endpoint/id params.

    The endpoint keys and ids are NOT interpolated as literals — each becomes a
    named bind parameter (:km_key_N / :km_id_N) added to ``params`` in place. An
    empty keep map renders a single (NULL, NULL) row cast to (text, bigint) so the
    join matches nothing (deletes zero rows) without a malformed empty VALUES.
    """
    if not keep_from_ids:
        return text(statement_sql.format(keep_map="(NULL::text, NULL::bigint)"))
    tuples: list[str] = []
    for index, (endpoint_key, keep_from_id) in enumerate(keep_from_ids.items()):
        key_param = f"km_key_{index}"
        id_param = f"km_id_{index}"
        params[key_param] = endpoint_key
        params[id_param] = keep_from_id
        tuples.append(f"(:{key_param}, CAST(:{id_param} AS bigint))")
    return text(statement_sql.format(keep_map=", ".join(tuples)))


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
    # many worker/pruner passes instead of one unbounded transaction (hang class).
    # batch_size is floored at 1 to avoid a no-op LIMIT 0 that would never drain.
    batch = max(int(batch_size), 1)

    # Step 1: resolve the per-endpoint oldest-to-keep snapshot ids from the tiny
    # snapshot table. Child deletes then run as PK-leading id-range scans (no JOIN
    # onto the 99GB child by captured_at).
    keep_from_ids = _resolve_keep_from_ids(
        connection, provider_id=provider_id, cutoff_utc=cutoff_utc
    )
    keep_from_trip_updates = keep_from_ids.get(_TRIP_UPDATES_ENDPOINT, _NO_DELETE_KEEP_FROM_ID)
    keep_from_vehicle_positions = keep_from_ids.get(
        _VEHICLE_POSITIONS_ENDPOINT, _NO_DELETE_KEEP_FROM_ID
    )

    # Scalar-id params drive the trip_updates/vehicle_positions child tables.
    scalar_params: dict[str, object] = {
        "provider_id": provider_id,
        "batch": batch,
        "keep_from_trip_updates": keep_from_trip_updates,
        "keep_from_vehicle_positions": keep_from_vehicle_positions,
    }

    if dry_run:
        # rt_entities / rt_feed_snapshots span all endpoints -> per-endpoint keep map.
        entities_params: dict[str, object] = {"provider_id": provider_id}
        entities_count_sql = _render_keep_map(
            COUNT_OLD_RT_ENTITIES.text, keep_from_ids, entities_params
        )
        snapshots_params: dict[str, object] = {"provider_id": provider_id}
        snapshots_count_sql = _render_keep_map(
            COUNT_OLD_RT_FEED_SNAPSHOTS.text, keep_from_ids, snapshots_params
        )
        deleted_row_counts = {
            "silver.rt_trip_update_stop_times": _safe_scalar_count(
                connection.execute(COUNT_OLD_RT_TRIP_UPDATE_STOP_TIMES, scalar_params)
            ),
            "silver.rt_trip_updates": _safe_scalar_count(
                connection.execute(COUNT_OLD_RT_TRIP_UPDATES, scalar_params)
            ),
            "silver.rt_vehicle_positions": _safe_scalar_count(
                connection.execute(COUNT_OLD_RT_VEHICLE_POSITIONS, scalar_params)
            ),
            "silver.rt_entities": _safe_scalar_count(
                connection.execute(entities_count_sql, entities_params)
            ),
            "silver.rt_feed_snapshots": _safe_scalar_count(
                connection.execute(snapshots_count_sql, snapshots_params)
            ),
        }
    else:
        entities_params = {"provider_id": provider_id, "batch": batch}
        entities_delete_sql = _render_keep_map(
            DELETE_OLD_RT_ENTITIES.text, keep_from_ids, entities_params
        )
        snapshots_params = {"provider_id": provider_id, "batch": batch}
        snapshots_delete_sql = _render_keep_map(
            DELETE_OLD_RT_FEED_SNAPSHOTS.text, keep_from_ids, snapshots_params
        )
        # FK-safe order: children (stop_times -> trip_updates -> vehicle_positions)
        # -> rt_entities -> rt_feed_snapshots parent.
        deleted_row_counts = {
            "silver.rt_trip_update_stop_times": _safe_rowcount(
                connection.execute(DELETE_OLD_RT_TRIP_UPDATE_STOP_TIMES, scalar_params)
            ),
            "silver.rt_trip_updates": _safe_rowcount(
                connection.execute(DELETE_OLD_RT_TRIP_UPDATES, scalar_params)
            ),
            "silver.rt_vehicle_positions": _safe_rowcount(
                connection.execute(DELETE_OLD_RT_VEHICLE_POSITIONS, scalar_params)
            ),
            "silver.rt_entities": _safe_rowcount(
                connection.execute(entities_delete_sql, entities_params)
            ),
            "silver.rt_feed_snapshots": _safe_rowcount(
                connection.execute(snapshots_delete_sql, snapshots_params)
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
