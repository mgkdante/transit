"""Retain referenced Bronze archives and prune expired objects through their recorded backend."""

from __future__ import annotations

from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager, suppress
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine, set_daily_warm_transaction_timeouts
from transit_ops.ingestion.common import utc_now
from transit_ops.ingestion.storage import BronzeStorage, BronzeStorageResolver, BronzeStorageScope
from transit_ops.settings import Settings, get_settings

from ._helpers import _safe_rowcount, _safe_scalar_count, logger, require_prune_transaction

RAW_BRONZE_METADATA_TABLES = (
    "raw.realtime_snapshot_index",
    "raw.ingestion_objects",
    "raw.ingestion_runs",
)

# Bronze / raw retention SQL

_BRONZE_REALTIME_LATEST_CTE = """
WITH latest_by_endpoint_key AS MATERIALIZED (
    SELECT DISTINCT ON (fe_latest.endpoint_key)
        fe_latest.endpoint_key,
        rsi_latest.realtime_snapshot_id AS latest_snapshot_id
    FROM raw.realtime_snapshot_index rsi_latest
    JOIN core.feed_endpoints fe_latest
        ON fe_latest.feed_endpoint_id = rsi_latest.feed_endpoint_id
    WHERE rsi_latest.provider_id = :provider_id
      AND fe_latest.provider_id = rsi_latest.provider_id
    ORDER BY fe_latest.endpoint_key, rsi_latest.captured_at_utc DESC,
             rsi_latest.realtime_snapshot_id DESC
)
"""

_BRONZE_REALTIME_ELIGIBILITY_FROM = """
FROM raw.ingestion_objects io
JOIN raw.realtime_snapshot_index rsi
    ON rsi.ingestion_object_id = io.ingestion_object_id
JOIN core.feed_endpoints fe
    ON fe.feed_endpoint_id = rsi.feed_endpoint_id
LEFT JOIN latest_by_endpoint_key latest
    ON latest.endpoint_key = fe.endpoint_key
WHERE rsi.provider_id = :provider_id
  AND fe.provider_id = rsi.provider_id
  AND io.provider_id = rsi.provider_id
  AND io.ingestion_run_id = rsi.ingestion_run_id
  AND rsi.captured_at_utc < :cutoff_utc
  AND rsi.realtime_snapshot_id <> COALESCE(latest.latest_snapshot_id, -1)
  AND NOT EXISTS (
      SELECT 1 FROM silver.rt_feed_snapshots rfs
      WHERE rfs.source_realtime_snapshot_id = rsi.realtime_snapshot_id
  )
  AND io.ingestion_object_id NOT IN (
      SELECT rfs.ingestion_object_id FROM silver.rt_feed_snapshots rfs
      WHERE rfs.ingestion_object_id IS NOT NULL
  )
  AND NOT EXISTS (
      SELECT 1 FROM gold.fact_trip_delay_snapshot fact
      WHERE fact.realtime_snapshot_id = rsi.realtime_snapshot_id
  )
  AND NOT EXISTS (
      SELECT 1 FROM gold.fact_vehicle_snapshot fact
      WHERE fact.realtime_snapshot_id = rsi.realtime_snapshot_id
  )
  AND NOT EXISTS (
      SELECT 1 FROM gold.latest_trip_delay_snapshot latest
      WHERE latest.realtime_snapshot_id = rsi.realtime_snapshot_id
  )
  AND NOT EXISTS (
      SELECT 1 FROM gold.latest_vehicle_snapshot latest
      WHERE latest.realtime_snapshot_id = rsi.realtime_snapshot_id
  )
"""

SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS = text(
    f"""
    {_BRONZE_REALTIME_LATEST_CTE}
    SELECT
        io.ingestion_object_id,
        io.ingestion_run_id,
        io.storage_path,
        io.storage_backend,
        rsi.realtime_snapshot_id
    {_BRONZE_REALTIME_ELIGIBILITY_FROM}
      AND NOT (io.ingestion_object_id = ANY(CAST(:excluded_object_ids AS bigint[])))
    ORDER BY rsi.captured_at_utc ASC, io.ingestion_object_id ASC
    LIMIT :max_objects
    FOR UPDATE OF rsi SKIP LOCKED
    """
)

RECHECK_ELIGIBLE_BRONZE_REALTIME_OBJECTS = text(
    f"""
    {_BRONZE_REALTIME_LATEST_CTE}
    SELECT io.ingestion_object_id
    {_BRONZE_REALTIME_ELIGIBILITY_FROM}
      AND rsi.realtime_snapshot_id = ANY(CAST(:locked_snapshot_ids AS bigint[]))
    """
)

COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS = text(
    f"""
    {_BRONZE_REALTIME_LATEST_CTE}
    SELECT COUNT(*)
    {_BRONZE_REALTIME_ELIGIBILITY_FROM}
    """
)

_BRONZE_STATIC_ELIGIBILITY_FROM = """
FROM raw.ingestion_objects io
JOIN raw.ingestion_runs ir ON ir.ingestion_run_id = io.ingestion_run_id
WHERE ir.provider_id = :provider_id
  AND ir.run_kind = 'static_schedule'
  AND ir.started_at_utc < :cutoff_utc
  AND NOT EXISTS (
      SELECT 1 FROM core.dataset_versions dv
      WHERE dv.source_ingestion_run_id = io.ingestion_run_id
  )
"""

SELECT_ELIGIBLE_BRONZE_STATIC_OBJECTS = text(
    f"""
    SELECT io.ingestion_object_id, io.ingestion_run_id, io.storage_path, io.storage_backend
    {_BRONZE_STATIC_ELIGIBILITY_FROM}
      AND NOT (io.ingestion_object_id = ANY(CAST(:excluded_object_ids AS bigint[])))
    ORDER BY ir.started_at_utc ASC, io.ingestion_object_id ASC
    LIMIT :max_objects
    FOR UPDATE OF io SKIP LOCKED
    """
)

RECHECK_ELIGIBLE_BRONZE_STATIC_OBJECTS = text(
    f"""
    SELECT io.ingestion_object_id
    {_BRONZE_STATIC_ELIGIBILITY_FROM}
      AND io.ingestion_object_id = ANY(CAST(:locked_object_ids AS bigint[]))
    """
)

COUNT_ELIGIBLE_BRONZE_STATIC_OBJECTS = text(
    f"SELECT COUNT(*) {_BRONZE_STATIC_ELIGIBILITY_FROM}"
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
#
# An i3 run owns its raw.i3_alert_snapshots row (fk_raw_i3_alert_snapshots_-
# ingestion_run_id, 0013:164-166 — non-cascading, 1:1 UNIQUE on ingestion_run_id)
# rather than a raw.ingestion_objects row. An i3 run older than the bronze cutoff
# with no ingestion_objects but a surviving i3_alert_snapshots row (kept under the
# 90-day silver-closed retention) would otherwise match this "orphaned" DELETE and
# FK-violate, aborting the whole bronze-realtime prune. The NOT EXISTS against
# raw.i3_alert_snapshots is the same guard the i3 variant
# (DELETE_ORPHANED_I3_INGESTION_RUNS) already carries.
DELETE_ORPHANED_INGESTION_RUNS = text(
    """
    DELETE FROM raw.ingestion_runs ir
    WHERE ir.provider_id = :provider_id
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


@contextmanager
def _prune_archive_stores(
    settings: Settings, project_root: Path
) -> Iterator[BronzeStorageResolver]:
    scope = BronzeStorageScope(settings, project_root=project_root)
    try:
        yield scope.resolve
    except BaseException:
        with suppress(Exception):
            scope.close()
        raise
    else:
        scope.close()


def _delete_archives_by_backend(
    rows: Sequence[tuple[int, str, str]],
    *,
    storage: BronzeStorage | None,
    resolver: BronzeStorageResolver | None,
) -> set[int]:
    if storage is not None and resolver is not None:
        raise ValueError("Provide one Bronze store or a backend resolver, not both")
    groups: dict[str, list[tuple[int, str]]] = {}
    for row_id, path, backend in rows:
        groups.setdefault(backend, []).append((row_id, path))
    failed: set[int] = set()
    for backend, archives in groups.items():
        try:
            target = resolver(backend) if resolver is not None else storage
            if target is None or target.storage_backend != backend:
                raise ValueError("Bronze store does not match the recorded backend")
            failed_paths = target.delete_objects(path for _, path in archives)
        except Exception as error:
            logger.error(
                "Bronze backend %r unavailable for %d objects (%s); metadata retained",
                backend,
                len(archives),
                type(error).__name__,
            )
            failed.update(row_id for row_id, _ in archives)
        else:
            failed.update(row_id for row_id, path in archives if path in failed_paths)
    return failed


def prune_bronze_realtime_objects(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    bronze_storage: BronzeStorage | None = None,
    bronze_storage_resolver: BronzeStorageResolver | None = None,
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

    require_prune_transaction(connection)
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
    if rows:
        eligible_object_ids = set(
            connection.execute(
                RECHECK_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
                {
                    "provider_id": provider_id,
                    "cutoff_utc": cutoff_utc,
                    "locked_snapshot_ids": [int(row[4]) for row in rows],
                },
            ).scalars()
        )
        rows = [row for row in rows if int(row[0]) in eligible_object_ids]

    if not rows:
        # No eligible objects this cycle, but still sweep aged orphaned runs:
        # slice-o silver_load failure telemetry writes object-less runs that
        # must stay retention-bounded even when no captures are being pruned
        # (e.g. the worker failing every cycle → no objects, but failure runs
        # accumulating). DELETE_ORPHANED_INGESTION_RUNS is age-gated, so
        # in-flight runs are never touched.
        runs_deleted = _safe_rowcount(
            connection.execute(
                DELETE_ORPHANED_INGESTION_RUNS,
                {"provider_id": provider_id, "cutoff_utc": cutoff_utc},
            )
        )
        return (
            cutoff_utc,
            zero_object_counts,
            {
                "raw.realtime_snapshot_index": 0,
                "raw.ingestion_objects": 0,
                "raw.ingestion_runs": runs_deleted,
            },
            set(),
        )

    failed_object_ids = _delete_archives_by_backend(
        [(int(row[0]), str(row[2]), str(row[3])) for row in rows],
        storage=bronze_storage,
        resolver=bronze_storage_resolver,
    )
    if failed_object_ids:
        logger.error(
            "Bronze realtime bulk deletion failed for %s of %s objects; "
            "metadata retained for failed objects",
            len(failed_object_ids),
            len(rows),
        )
    deleted_object_count = len(rows) - len(failed_object_ids)

    successful_object_ids = [int(row[0]) for row in rows if int(row[0]) not in failed_object_ids]
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
    bronze_storage: BronzeStorage | None = None,
    bronze_storage_resolver: BronzeStorageResolver | None = None,
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

    require_prune_transaction(connection)
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

    if rows:
        eligible_object_ids = set(
            connection.execute(
                RECHECK_ELIGIBLE_BRONZE_STATIC_OBJECTS,
                {
                    "provider_id": provider_id,
                    "cutoff_utc": cutoff_utc,
                    "locked_object_ids": [int(row[0]) for row in rows],
                },
            ).scalars()
        )
        rows = [row for row in rows if int(row[0]) in eligible_object_ids]

    if not rows:
        return cutoff_utc, zero_object_counts, zero_meta_counts, set()

    failed_object_ids = _delete_archives_by_backend(
        [(int(row[0]), str(row[2]), str(row[3])) for row in rows],
        storage=bronze_storage,
        resolver=bronze_storage_resolver,
    )
    if failed_object_ids:
        logger.error(
            "Bronze static bulk deletion failed for %s of %s objects; "
            "metadata retained for failed objects",
            len(failed_object_ids),
            len(rows),
        )
    deleted_object_count = len(rows) - len(failed_object_ids)

    successful_object_ids = [int(row[0]) for row in rows if int(row[0]) not in failed_object_ids]
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
    prune_batch: Callable[..., tuple[datetime | None, dict[str, int], dict[str, int], set[int]]],
    *,
    provider_id: str,
    retention_days: int,
    bronze_storage_resolver: BronzeStorageResolver,
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
            set_daily_warm_transaction_timeouts(connection)
            cutoff_utc, batch_object_counts, batch_meta_counts, batch_failed_ids = prune_batch(
                connection,
                provider_id=provider_id,
                retention_days=retention_days,
                bronze_storage_resolver=bronze_storage_resolver,
                dry_run=False,
                now_utc=phase_now_utc,
                max_objects=max_objects,
                excluded_object_ids=sorted(failed_object_ids),
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
    with _prune_archive_stores(settings, Path(__file__).resolve().parents[3]) as resolve_storage:
        resolved_max_objects = max(
            1,
            max_objects if max_objects is not None else settings.BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH,
        )
        resolved_max_batches = max(
            1,
            max_batches if max_batches is not None else settings.BRONZE_PRUNE_MAX_BATCHES,
        )

        if dry_run:
            with engine.begin() as connection:
                set_daily_warm_transaction_timeouts(connection)
                realtime_cutoff_utc, realtime_object_counts, realtime_meta_counts, _ = (
                    prune_bronze_realtime_objects(
                        connection,
                        provider_id=provider_id,
                        retention_days=settings.BRONZE_REALTIME_RETENTION_DAYS,
                        bronze_storage_resolver=resolve_storage,
                        dry_run=True,
                    )
                )
                static_cutoff_utc, static_object_counts, static_meta_counts, _ = (
                    prune_bronze_static_objects(
                        connection,
                        provider_id=provider_id,
                        retention_days=settings.BRONZE_STATIC_RETENTION_DAYS,
                        bronze_storage_resolver=resolve_storage,
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
                bronze_storage_resolver=resolve_storage,
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
                bronze_storage_resolver=resolve_storage,
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
