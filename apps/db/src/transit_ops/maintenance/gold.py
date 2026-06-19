"""Gold fact + warm-rollup/aggregate retention tier (slice-9.1.1-zeta split)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings

from ._helpers import _safe_rowcount, _safe_scalar_count

GOLD_FACT_TABLES = (
    "gold.fact_trip_delay_snapshot",
    "gold.fact_vehicle_snapshot",
)

GOLD_WARM_ROLLUP_TABLES = (
    "gold.vehicle_summary_5m",
    "gold.trip_delay_summary_5m",
    "gold.occupancy_summary_5m",
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
    "gold.route_delay_by_shift",
    "gold.route_delay_by_daytype",
)

# Append-only daily rollups — NOT in the DELETE+UPSERT reporting registry; they
# accrue forward and are pruned only at GOLD_WARM_ROLLUP_RETENTION_DAYS.
GOLD_APPEND_ONLY_DAILY_TABLES = (
    "gold.route_delay_percentile_daily",
    "gold.stop_delay_percentile_daily",
    "gold.route_cancellation_daily",
    "gold.route_occupancy_band_daily",
    "gold.route_service_span_daily",
    "gold.route_skipped_stop_daily",
)

GOLD_AGGREGATE_TABLES = (
    *GOLD_WARM_ROLLUP_TABLES,
    *GOLD_REPORTING_AGGREGATE_TABLES,
    *GOLD_APPEND_ONLY_DAILY_TABLES,
)

GOLD_AGGREGATE_RETENTION_COLUMNS = (
    ("gold.vehicle_summary_5m", "period_start_utc", False),
    ("gold.trip_delay_summary_5m", "period_start_utc", False),
    ("gold.occupancy_summary_5m", "period_start_utc", False),
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
    ("gold.route_delay_percentile_daily", "provider_local_date", True),
    ("gold.stop_delay_percentile_daily", "provider_local_date", True),
    ("gold.route_cancellation_daily", "provider_local_date", True),
    ("gold.route_occupancy_band_daily", "provider_local_date", True),
    ("gold.route_service_span_daily", "provider_local_date", True),
    ("gold.route_skipped_stop_daily", "provider_local_date", True),
    ("gold.route_delay_by_shift", "built_at_utc", False),
    ("gold.route_delay_by_daytype", "built_at_utc", False),
)

VALID_GOLD_AGGREGATE_RETENTION_TARGETS = frozenset(GOLD_AGGREGATE_RETENTION_COLUMNS)

# Each live gold-fact DELETE is bounded to :batch rows via ctid IN (... LIMIT)
# — same shape as the silver realtime prunes above. The first cycle after a
# worker outage must otherwise drain the entire 18.7M-scale backlog in ONE
# unbounded transaction (long lock hold + WAL/bloat spike — the wave-2 stall
# class); batching drains it over many ~57s cycles while steady-state clears in
# one quick pass. These fact tables are FK leaves (no non-cascading children),
# so no NOT EXISTS child guard is needed. The dry-run COUNT stays unbounded so
# it reports the TRUE backlog, never the per-cycle cap.
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
    # Each live DELETE is bounded to :batch rows so a one-time backlog (the first
    # cycle after a worker outage) drains over many ~57s cycles instead of one
    # unbounded transaction (hang class). batch_size is floored at 1 to avoid a
    # no-op LIMIT 0 that would never drain.
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
