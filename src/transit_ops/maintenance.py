from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings

STATIC_SILVER_TABLES = (
    "silver.stop_times",
    "silver.calendar_dates",
    "silver.calendar",
    "silver.trips",
    "silver.stops",
    "silver.routes",
)

REALTIME_SILVER_TABLES = (
    "silver.trip_update_stop_time_updates",
    "silver.trip_updates",
    "silver.vehicle_positions",
)

GOLD_FACT_TABLES = (
    "gold.fact_trip_delay_snapshot",
    "gold.fact_vehicle_snapshot",
)

VACUUM_TABLES = (
    *STATIC_SILVER_TABLES,
    *REALTIME_SILVER_TABLES,
    *GOLD_FACT_TABLES,
    "gold.latest_trip_delay_snapshot",
    "gold.latest_vehicle_snapshot",
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

DELETE_SILVER_CALENDAR_DATES_BY_DATASET = text(
    """
    DELETE FROM silver.calendar_dates
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

DELETE_SILVER_TRIPS_BY_DATASET = text(
    """
    DELETE FROM silver.trips
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

DELETE_SILVER_ROUTES_BY_DATASET = text(
    """
    DELETE FROM silver.routes
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

DELETE_OLD_TRIP_UPDATE_STOP_TIME_UPDATES = text(
    """
    DELETE FROM silver.trip_update_stop_time_updates AS stu
    USING raw.realtime_snapshot_index AS rsi, core.feed_endpoints AS fe
    WHERE stu.realtime_snapshot_id = rsi.realtime_snapshot_id
      AND fe.feed_endpoint_id = rsi.feed_endpoint_id
      AND rsi.provider_id = :provider_id
      AND fe.endpoint_key = 'trip_updates'
      AND rsi.captured_at_utc < :cutoff_utc
      AND rsi.realtime_snapshot_id <> COALESCE((
            SELECT max(rsi_latest.realtime_snapshot_id)
            FROM raw.realtime_snapshot_index AS rsi_latest
            INNER JOIN core.feed_endpoints AS fe_latest
                ON fe_latest.feed_endpoint_id = rsi_latest.feed_endpoint_id
            WHERE rsi_latest.provider_id = :provider_id
              AND fe_latest.endpoint_key = 'trip_updates'
        ), -1)
    """
)

DELETE_OLD_TRIP_UPDATES = text(
    """
    DELETE FROM silver.trip_updates AS tu
    USING raw.realtime_snapshot_index AS rsi, core.feed_endpoints AS fe
    WHERE tu.realtime_snapshot_id = rsi.realtime_snapshot_id
      AND fe.feed_endpoint_id = rsi.feed_endpoint_id
      AND rsi.provider_id = :provider_id
      AND fe.endpoint_key = 'trip_updates'
      AND rsi.captured_at_utc < :cutoff_utc
      AND rsi.realtime_snapshot_id <> COALESCE((
            SELECT max(rsi_latest.realtime_snapshot_id)
            FROM raw.realtime_snapshot_index AS rsi_latest
            INNER JOIN core.feed_endpoints AS fe_latest
                ON fe_latest.feed_endpoint_id = rsi_latest.feed_endpoint_id
            WHERE rsi_latest.provider_id = :provider_id
              AND fe_latest.endpoint_key = 'trip_updates'
        ), -1)
    """
)

DELETE_OLD_VEHICLE_POSITIONS = text(
    """
    DELETE FROM silver.vehicle_positions AS vp
    USING raw.realtime_snapshot_index AS rsi, core.feed_endpoints AS fe
    WHERE vp.realtime_snapshot_id = rsi.realtime_snapshot_id
      AND fe.feed_endpoint_id = rsi.feed_endpoint_id
      AND rsi.provider_id = :provider_id
      AND fe.endpoint_key = 'vehicle_positions'
      AND rsi.captured_at_utc < :cutoff_utc
      AND rsi.realtime_snapshot_id <> COALESCE((
            SELECT max(rsi_latest.realtime_snapshot_id)
            FROM raw.realtime_snapshot_index AS rsi_latest
            INNER JOIN core.feed_endpoints AS fe_latest
                ON fe_latest.feed_endpoint_id = rsi_latest.feed_endpoint_id
            WHERE rsi_latest.provider_id = :provider_id
              AND fe_latest.endpoint_key = 'vehicle_positions'
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

DELETE_OLD_FACT_VEHICLE_SNAPSHOTS = text(
    """
    DELETE FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
      AND captured_at_utc < :cutoff_utc
    """
)


@dataclass(frozen=True)
class GoldStoragePruneResult:
    provider_id: str
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


def prune_static_silver_datasets(
    connection: Connection,
    *,
    provider_id: str,
    retention_count: int,
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
            "silver.stop_times": 0,
            "silver.calendar_dates": 0,
            "silver.calendar": 0,
            "silver.trips": 0,
            "silver.stops": 0,
            "silver.routes": 0,
            "core.dataset_versions": 0,
        }

    params = {
        "provider_id": provider_id,
        "dataset_version_ids": pruned_dataset_version_ids,
    }
    deleted_row_counts = {
        "silver.stop_times": _safe_rowcount(
            connection.execute(DELETE_SILVER_STOP_TIMES_BY_DATASET, params)
        ),
        "silver.calendar_dates": _safe_rowcount(
            connection.execute(DELETE_SILVER_CALENDAR_DATES_BY_DATASET, params)
        ),
        "silver.calendar": _safe_rowcount(
            connection.execute(DELETE_SILVER_CALENDAR_BY_DATASET, params)
        ),
        "silver.trips": _safe_rowcount(connection.execute(DELETE_SILVER_TRIPS_BY_DATASET, params)),
        "silver.stops": _safe_rowcount(connection.execute(DELETE_SILVER_STOPS_BY_DATASET, params)),
        "silver.routes": _safe_rowcount(
            connection.execute(DELETE_SILVER_ROUTES_BY_DATASET, params)
        ),
        "core.dataset_versions": _safe_rowcount(
            connection.execute(DELETE_DATASET_VERSIONS, params)
        ),
    }
    return retained_dataset_version_ids, pruned_dataset_version_ids, deleted_row_counts


def prune_realtime_silver_history(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    now_utc: datetime | None = None,
) -> tuple[datetime | None, dict[str, int]]:
    if retention_days <= 0:
        return None, {
            "silver.trip_update_stop_time_updates": 0,
            "silver.trip_updates": 0,
            "silver.vehicle_positions": 0,
        }

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)
    params = {
        "provider_id": provider_id,
        "cutoff_utc": cutoff_utc,
    }
    deleted_row_counts = {
        "silver.trip_update_stop_time_updates": _safe_rowcount(
            connection.execute(DELETE_OLD_TRIP_UPDATE_STOP_TIME_UPDATES, params)
        ),
        "silver.trip_updates": _safe_rowcount(connection.execute(DELETE_OLD_TRIP_UPDATES, params)),
        "silver.vehicle_positions": _safe_rowcount(
            connection.execute(DELETE_OLD_VEHICLE_POSITIONS, params)
        ),
    }
    return cutoff_utc, deleted_row_counts


def prune_silver_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> SilverStoragePruneResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)

    with engine.begin() as connection:
        retained_dataset_version_ids, pruned_dataset_version_ids, static_deleted_row_counts = (
            prune_static_silver_datasets(
                connection,
                provider_id=provider_id,
                retention_count=settings.STATIC_DATASET_RETENTION_COUNT,
            )
        )
        realtime_cutoff_utc, realtime_deleted_row_counts = prune_realtime_silver_history(
            connection,
            provider_id=provider_id,
            retention_days=settings.SILVER_REALTIME_RETENTION_DAYS,
        )
        completed_at_utc = utc_now()

    return SilverStoragePruneResult(
        provider_id=provider_id,
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
) -> GoldStoragePruneResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)

    with engine.begin() as connection:
        cutoff_utc, deleted_row_counts = prune_gold_fact_history(
            connection,
            provider_id=provider_id,
            retention_days=settings.GOLD_FACT_RETENTION_DAYS,
        )
        completed_at_utc = utc_now()

    return GoldStoragePruneResult(
        provider_id=provider_id,
        retention_days=settings.GOLD_FACT_RETENTION_DAYS,
        cutoff_utc=cutoff_utc,
        deleted_row_counts=deleted_row_counts,
        completed_at_utc=completed_at_utc,
    )


def vacuum_storage(
    provider_id: str,
    *,
    full: bool = False,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> VacuumResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    vacuum_mode = "FULL, ANALYZE" if full else "ANALYZE"

    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        for table_name in VACUUM_TABLES:
            connection.exec_driver_sql(f"VACUUM ({vacuum_mode}) {table_name}")

    return VacuumResult(
        provider_id=provider_id,
        full=full,
        tables=list(VACUUM_TABLES),
        completed_at_utc=utc_now(),
    )
