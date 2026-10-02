from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine, set_daily_warm_transaction_timeouts
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings
from transit_ops.sql_registry import named_query

from ._helpers import _safe_rowcount, _safe_scalar_count

GOLD_FACT_TABLES = (
    "gold.fact_trip_delay_snapshot",
    "gold.fact_vehicle_snapshot",
)

GOLD_WARM_ROLLUP_TABLES = (
    "gold.trip_delay_summary_5m",
    "gold.warm_rollup_periods",
)

GOLD_REPORTING_AGGREGATE_TABLES = (
    # Keep route_delay_hourly while the public daily reliability view depends on it.
    "gold.route_delay_hourly",
    "gold.stop_delay_hourly",
    "gold.repeated_problem_route_stop",
    "gold.citizen_accountability_daily",
)

# Daily rollups accrue independently of reporting rebuilds and use warm retention.
GOLD_APPEND_ONLY_DAILY_TABLES = (
    "gold.route_delay_percentile_daily",
    "gold.stop_delay_percentile_daily",
    "gold.route_cancellation_daily",
    "gold.route_occupancy_band_daily",
    "gold.route_occupancy_band_hourly",
    "gold.stop_occupancy_band_daily",
    "gold.route_service_span_daily",
    "gold.route_skipped_stop_daily",
    "gold.route_delay_by_crowding_daily",
    "gold.route_delay_spine",
    "gold.route_headway_shift_daily",
    "gold.stop_delay_spine",
    "gold.stop_delay_shift_daily",
    "gold.repeat_offender_daily_spine",
    "gold.route_scheduled_trips_daily",
    # Edition service history is permanent and excluded from aggregate retention.
    "gold.schedule_version_service_summary",
)

GOLD_AGGREGATE_TABLES = (
    *GOLD_WARM_ROLLUP_TABLES,
    *GOLD_REPORTING_AGGREGATE_TABLES,
    *GOLD_APPEND_ONLY_DAILY_TABLES,
)

GOLD_AGGREGATE_RETENTION_COLUMNS = (
    ("gold.trip_delay_summary_5m", "period_start_utc", False),
    ("gold.warm_rollup_periods", "period_start_utc", False),
    ("gold.route_delay_hourly", "period_start_utc", False),
    ("gold.stop_delay_hourly", "period_start_utc", False),
    ("gold.repeated_problem_route_stop", "period_start_local", True),
    ("gold.citizen_accountability_daily", "provider_local_date", True),
    ("gold.route_delay_percentile_daily", "provider_local_date", True),
    ("gold.stop_delay_percentile_daily", "provider_local_date", True),
    ("gold.route_cancellation_daily", "provider_local_date", True),
    ("gold.route_occupancy_band_daily", "provider_local_date", True),
    ("gold.route_occupancy_band_hourly", "provider_local_date", True),
    ("gold.stop_occupancy_band_daily", "provider_local_date", True),
    ("gold.route_service_span_daily", "provider_local_date", True),
    ("gold.route_skipped_stop_daily", "provider_local_date", True),
    ("gold.route_delay_by_crowding_daily", "provider_local_date", True),
    ("gold.route_delay_spine", "provider_local_date", True),
    ("gold.route_headway_shift_daily", "provider_local_date", True),
    ("gold.stop_delay_spine", "provider_local_date", True),
    ("gold.stop_delay_shift_daily", "provider_local_date", True),
    ("gold.repeat_offender_daily_spine", "provider_local_date", True),
    ("gold.route_scheduled_trips_daily", "provider_local_date", True),
)

VALID_GOLD_AGGREGATE_RETENTION_TARGETS = frozenset(GOLD_AGGREGATE_RETENTION_COLUMNS)

# Alert event archives have a separate month-partition lifecycle.
ALERT_ARCHIVE_RETENTION_TABLE = "gold.alert_archive_entry"

_DELETE_EXPIRED_ALERT_ARCHIVE = named_query(
    "retention.alert_archive.delete",
    """
    DELETE FROM gold.alert_archive_entry
    WHERE provider_id = :provider_id
      AND archive_month < :cutoff_month
    """,
)

_COUNT_EXPIRED_ALERT_ARCHIVE = named_query(
    "retention.alert_archive.count",
    """
    SELECT COUNT(*) FROM gold.alert_archive_entry
    WHERE provider_id = :provider_id
      AND archive_month < :cutoff_month
    """,
)

# Bound fact deletes; dry-run counts report the full backlog.
DELETE_OLD_FACT_TRIP_DELAY_SNAPSHOTS = text(
    """
    DELETE FROM gold.fact_trip_delay_snapshot AS fact
    WHERE fact.ctid IN (
        SELECT fact_old.ctid
        FROM gold.fact_trip_delay_snapshot AS fact_old
        WHERE fact_old.provider_id = :provider_id
          AND fact_old.captured_at_utc < :cutoff_utc
        LIMIT :batch
    )
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
    DELETE FROM gold.fact_vehicle_snapshot AS fact
    WHERE fact.ctid IN (
        SELECT fact_old.ctid
        FROM gold.fact_vehicle_snapshot AS fact_old
        WHERE fact_old.provider_id = :provider_id
          AND fact_old.captured_at_utc < :cutoff_utc
        LIMIT :batch
    )
    """
)

COUNT_OLD_FACT_VEHICLE_SNAPSHOTS = text(
    """
    SELECT COUNT(*) FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
      AND captured_at_utc < :cutoff_utc
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


def prune_alert_archive_history(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    dry_run: bool = False,
    now_utc: datetime | None = None,
) -> tuple[date | None, int]:

    if retention_days <= 0:
        return None, 0

    cutoff_day = ((now_utc or utc_now()) - timedelta(days=retention_days)).date()
    cutoff_month = cutoff_day.replace(day=1)
    statement = _COUNT_EXPIRED_ALERT_ARCHIVE if dry_run else _DELETE_EXPIRED_ALERT_ARCHIVE
    params = {"provider_id": provider_id, "cutoff_month": cutoff_month}
    result = connection.execute(statement, params)
    count = _safe_scalar_count(result) if dry_run else _safe_rowcount(result)
    return cutoff_month, count


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


def prune_gold_fact_history(
    connection: Connection,
    *,
    provider_id: str,
    retention_days: int,
    batch_size: int = 50000,
    dry_run: bool = False,
    now_utc: datetime | None = None,
) -> tuple[datetime | None, dict[str, int]]:
    if retention_days <= 0:
        return None, {
            "gold.fact_trip_delay_snapshot": 0,
            "gold.fact_vehicle_snapshot": 0,
        }

    cutoff_utc = (now_utc or utc_now()) - timedelta(days=retention_days)
    # Floor batch_size at one so pruning can always make progress.
    batch = max(int(batch_size), 1)
    params = {
        "provider_id": provider_id,
        "cutoff_utc": cutoff_utc,
        "batch": batch,
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
        set_daily_warm_transaction_timeouts(connection)
        cutoff_utc, deleted_row_counts = prune_gold_fact_history(
            connection,
            provider_id=provider_id,
            retention_days=settings.GOLD_FACT_RETENTION_DAYS,
            batch_size=settings.GOLD_FACT_PRUNE_BATCH,
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


def prune_warm_rollup_storage(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    dry_run: bool = False,
) -> WarmRollupStoragePruneResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)

    retention_days = settings.GOLD_WARM_ROLLUP_RETENTION_DAYS
    if retention_days <= 0:
        return WarmRollupStoragePruneResult(
            provider_id=provider_id,
            dry_run=dry_run,
            retention_days=retention_days,
            cutoff_utc=None,
            deleted_row_counts={
                **{table_name: 0 for table_name in GOLD_AGGREGATE_TABLES},
                ALERT_ARCHIVE_RETENTION_TABLE: 0,
            },
            completed_at_utc=utc_now(),
        )

    now_utc = utc_now()
    cutoff_utc = now_utc - timedelta(days=retention_days)
    params = {"provider_id": provider_id, "cutoff_utc": cutoff_utc}

    with engine.begin() as connection:
        set_daily_warm_transaction_timeouts(connection)
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
        _, archive_count = prune_alert_archive_history(
            connection,
            provider_id=provider_id,
            retention_days=retention_days,
            dry_run=dry_run,
            now_utc=now_utc,
        )
        deleted_row_counts[ALERT_ARCHIVE_RETENTION_TABLE] = archive_count
        completed_at_utc = utc_now()

    return WarmRollupStoragePruneResult(
        provider_id=provider_id,
        dry_run=dry_run,
        retention_days=retention_days,
        cutoff_utc=cutoff_utc,
        deleted_row_counts=deleted_row_counts,
        completed_at_utc=completed_at_utc,
    )
