"""i3 alert raw + silver-closed retention tier (slice-9.1.1-zeta split)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

import transit_ops.maintenance as _maintenance_pkg
from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.ingestion.storage import BronzeStorage
from transit_ops.settings import Settings, get_settings

from ._helpers import _safe_rowcount, _safe_scalar_count, logger
from .bronze import DELETE_INGESTION_OBJECTS_BY_IDS

I3_RETENTION_TABLES = (
    "raw.i3_alert_snapshots",
    "silver.i3_alerts",
    "silver.i3_alert_informed_entities",
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
    # Resolve get_bronze_storage through the package (not a direct import) so a
    # monkeypatch of transit_ops.maintenance.get_bronze_storage reaches this call,
    # matching the pre-split module-global behavior and bronze.prune_bronze_storage.
    # parents[3]: this module sits one directory deeper than the old maintenance.py.
    bronze_storage = _maintenance_pkg.get_bronze_storage(
        settings, project_root=Path(__file__).resolve().parents[3]
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
