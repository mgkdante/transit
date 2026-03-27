from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings

# ---------------------------------------------------------------------------
# SQL — missing period detection
# ---------------------------------------------------------------------------

SELECT_MISSING_VEHICLE_PERIODS = text(
    """
    SELECT DISTINCT
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') AS period_start_utc
    FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
      AND (CAST(:since_utc AS timestamptz) IS NULL OR captured_at_utc >= CAST(:since_utc AS timestamptz))
      AND DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') NOT IN (
          SELECT period_start_utc
          FROM gold.warm_rollup_periods
          WHERE provider_id = :provider_id
            AND rollup_kind = 'vehicle_summary_5m'
      )
    ORDER BY 1
    """
)

SELECT_MISSING_TRIP_DELAY_PERIODS = text(
    """
    SELECT DISTINCT
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') AS period_start_utc
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
      AND (CAST(:since_utc AS timestamptz) IS NULL OR captured_at_utc >= CAST(:since_utc AS timestamptz))
      AND DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') NOT IN (
          SELECT period_start_utc
          FROM gold.warm_rollup_periods
          WHERE provider_id = :provider_id
            AND rollup_kind = 'trip_delay_summary_5m'
      )
    ORDER BY 1
    """
)

# ---------------------------------------------------------------------------
# SQL — upserts
# ---------------------------------------------------------------------------

UPSERT_VEHICLE_SUMMARY_5M = text(
    """
    INSERT INTO gold.vehicle_summary_5m (
        provider_id,
        period_start_utc,
        route_id,
        vehicle_count,
        observation_count,
        snapshot_count,
        built_at_utc
    )
    SELECT
        provider_id,
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
        COALESCE(route_id, '__unrouted__'),
        COUNT(DISTINCT vehicle_id)::integer,
        COUNT(*)::integer,
        COUNT(DISTINCT realtime_snapshot_id)::integer,
        :built_at_utc
    FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
      AND DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') = :period_start_utc
    GROUP BY 1, 2, 3
    ON CONFLICT (provider_id, period_start_utc, route_id) DO UPDATE SET
        vehicle_count    = EXCLUDED.vehicle_count,
        observation_count = EXCLUDED.observation_count,
        snapshot_count   = EXCLUDED.snapshot_count,
        built_at_utc     = EXCLUDED.built_at_utc
    """
)

UPSERT_TRIP_DELAY_SUMMARY_5M = text(
    """
    INSERT INTO gold.trip_delay_summary_5m (
        provider_id,
        period_start_utc,
        route_id,
        trip_count,
        observation_count,
        delay_observation_count,
        avg_delay_seconds,
        avg_delay_seconds_capped,
        max_delay_seconds,
        min_delay_seconds,
        delayed_trip_count,
        outlier_count,
        built_at_utc
    )
    SELECT
        provider_id,
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
        COALESCE(route_id, '__unrouted__'),
        COUNT(DISTINCT trip_id)::integer,
        COUNT(*)::integer,
        COUNT(delay_seconds)::integer,
        AVG(delay_seconds::numeric),
        AVG(delay_seconds::numeric) FILTER (WHERE ABS(delay_seconds) <= 3600),
        MAX(delay_seconds),
        MIN(delay_seconds),
        COUNT(DISTINCT trip_id) FILTER (WHERE delay_seconds > 0)::integer,
        COUNT(*) FILTER (WHERE ABS(delay_seconds) > 3600)::integer,
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
      AND DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') = :period_start_utc
    GROUP BY 1, 2, 3
    ON CONFLICT (provider_id, period_start_utc, route_id) DO UPDATE SET
        trip_count              = EXCLUDED.trip_count,
        observation_count       = EXCLUDED.observation_count,
        delay_observation_count = EXCLUDED.delay_observation_count,
        avg_delay_seconds       = EXCLUDED.avg_delay_seconds,
        avg_delay_seconds_capped = EXCLUDED.avg_delay_seconds_capped,
        max_delay_seconds       = EXCLUDED.max_delay_seconds,
        min_delay_seconds       = EXCLUDED.min_delay_seconds,
        delayed_trip_count      = EXCLUDED.delayed_trip_count,
        outlier_count           = EXCLUDED.outlier_count,
        built_at_utc            = EXCLUDED.built_at_utc
    """
)

UPSERT_WARM_ROLLUP_PERIOD = text(
    """
    INSERT INTO gold.warm_rollup_periods (
        provider_id, rollup_kind, period_start_utc, built_at_utc
    )
    VALUES (
        :provider_id, :rollup_kind, :period_start_utc, :built_at_utc
    )
    ON CONFLICT (provider_id, rollup_kind, period_start_utc) DO UPDATE SET
        built_at_utc = EXCLUDED.built_at_utc
    """
)

# ---------------------------------------------------------------------------
# SQL — retention deletes
# ---------------------------------------------------------------------------

DELETE_OLD_VEHICLE_SUMMARY_5M = text(
    """
    DELETE FROM gold.vehicle_summary_5m
    WHERE provider_id = :provider_id
      AND period_start_utc < :cutoff_utc
    """
)

DELETE_OLD_TRIP_DELAY_SUMMARY_5M = text(
    """
    DELETE FROM gold.trip_delay_summary_5m
    WHERE provider_id = :provider_id
      AND period_start_utc < :cutoff_utc
    """
)

DELETE_OLD_WARM_ROLLUP_PERIODS = text(
    """
    DELETE FROM gold.warm_rollup_periods
    WHERE provider_id = :provider_id
      AND period_start_utc < :cutoff_utc
    """
)


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WarmRollupBuildResult:
    provider_id: str
    since_utc: datetime | None
    built_vehicle_periods: int
    built_trip_delay_periods: int
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "since_utc": self.since_utc.isoformat() if self.since_utc else None,
            "built_vehicle_periods": self.built_vehicle_periods,
            "built_trip_delay_periods": self.built_trip_delay_periods,
            "completed_at_utc": self.completed_at_utc.isoformat(),
        }


# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------


def build_warm_rollups(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    since_utc: datetime | None = None,
) -> WarmRollupBuildResult:
    """Build 5-minute warm rollups for missing periods.

    Idempotent: skips any period already recorded in warm_rollup_periods.
    Optionally restricted to periods with captured_at_utc >= since_utc.
    """
    if settings is None:
        settings = get_settings()
    if engine is None:
        engine = make_engine(settings)

    built_vehicle = 0
    built_trip_delay = 0
    now = utc_now()

    with engine.begin() as conn:
        # Vehicle summary
        rows = conn.execute(
            SELECT_MISSING_VEHICLE_PERIODS,
            {"provider_id": provider_id, "since_utc": since_utc},
        ).fetchall()
        for row in rows:
            period = row.period_start_utc
            conn.execute(
                UPSERT_VEHICLE_SUMMARY_5M,
                {
                    "provider_id": provider_id,
                    "period_start_utc": period,
                    "built_at_utc": now,
                },
            )
            conn.execute(
                UPSERT_WARM_ROLLUP_PERIOD,
                {
                    "provider_id": provider_id,
                    "rollup_kind": "vehicle_summary_5m",
                    "period_start_utc": period,
                    "built_at_utc": now,
                },
            )
            built_vehicle += 1

        # Trip delay summary
        rows = conn.execute(
            SELECT_MISSING_TRIP_DELAY_PERIODS,
            {"provider_id": provider_id, "since_utc": since_utc},
        ).fetchall()
        for row in rows:
            period = row.period_start_utc
            conn.execute(
                UPSERT_TRIP_DELAY_SUMMARY_5M,
                {
                    "provider_id": provider_id,
                    "period_start_utc": period,
                    "built_at_utc": now,
                },
            )
            conn.execute(
                UPSERT_WARM_ROLLUP_PERIOD,
                {
                    "provider_id": provider_id,
                    "rollup_kind": "trip_delay_summary_5m",
                    "period_start_utc": period,
                    "built_at_utc": now,
                },
            )
            built_trip_delay += 1

    return WarmRollupBuildResult(
        provider_id=provider_id,
        since_utc=since_utc,
        built_vehicle_periods=built_vehicle,
        built_trip_delay_periods=built_trip_delay,
        completed_at_utc=now,
    )
