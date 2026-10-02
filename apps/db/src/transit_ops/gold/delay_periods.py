from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

from sqlalchemy import Connection, Engine

from transit_ops.db.connection import set_daily_warm_transaction_timeouts
from transit_ops.gold.delay_cohorts import delay_period_is_complete
from transit_ops.ingestion.common import utc_now
from transit_ops.sql_registry import named_query

SEVERE_DELAY_SECONDS = 300
GHOST_DELAY_ABS_SECONDS = 3600


@dataclass
class PeriodBuildProgress:
    committed_rows: int = 0
    incomplete_periods: int = 0


_PERIOD_LOCK = named_query(
    "rollup.trip_delay.period_lock.acquire",
    "SELECT pg_advisory_xact_lock(hashtextextended(CAST(:lock_key AS text), 0))",
)

_PARENT_LOCK = named_query(
    "rollup.route_delay_hourly.lock",
    "SELECT pg_advisory_xact_lock(hashtext('transit.route_delay_hourly'), hashtext(:provider_id))",
)
_MATERIALIZATION_TIME = named_query("rollup.materialization_time", "SELECT clock_timestamp()")


def lock_delay_hours(conn: Connection, provider_id: str) -> None:
    conn.execute(_PARENT_LOCK, {"provider_id": provider_id})


def materialization_time(conn: Connection) -> datetime:
    return cast(datetime, conn.execute(_MATERIALIZATION_TIME).scalar_one())


def lock_delay_period(conn: Connection, provider_id: str, period: datetime) -> None:
    period_utc = period.astimezone(UTC).isoformat()
    key = f"transit.warm_rollup.trip_delay_summary_5m|{provider_id}|{period_utc}"
    conn.execute(_PERIOD_LOCK, {"lock_key": key})


def period_start(captured_at: datetime) -> datetime:
    if captured_at.utcoffset() is None:
        raise ValueError("Capture timestamp must be timezone-aware")
    captured_at = captured_at.astimezone(UTC)
    return captured_at.replace(minute=captured_at.minute // 5 * 5, second=0, microsecond=0)


_SNAPSHOT_PERIODS = named_query(
    "rollup.trip_delay.snapshot_periods",
    """
    SELECT DISTINCT DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')
    FROM (
        SELECT captured_at_utc FROM raw.realtime_snapshot_index
        WHERE provider_id = :provider_id AND realtime_snapshot_id = :snapshot_id
        UNION ALL
        SELECT captured_at_utc FROM gold.fact_trip_delay_snapshot
        WHERE provider_id = :provider_id AND realtime_snapshot_id = :snapshot_id
    ) AS captures ORDER BY 1
    """,
)

_INVALIDATE_PERIOD = named_query(
    "rollup.trip_delay.invalidate_period",
    """
    INSERT INTO gold.warm_rollup_periods
        (provider_id, rollup_kind, period_start_utc, built_at_utc, invalidated_at_utc)
    VALUES (:provider_id, 'trip_delay_summary_5m', :period_start_utc,
            clock_timestamp(), clock_timestamp())
    ON CONFLICT (provider_id, rollup_kind, period_start_utc) DO UPDATE
        SET invalidated_at_utc = EXCLUDED.invalidated_at_utc
    """,
)


def invalidate_delay_snapshot(conn: Connection, provider_id: str, snapshot_id: int) -> None:
    periods = (
        conn.execute(_SNAPSHOT_PERIODS, {"provider_id": provider_id, "snapshot_id": snapshot_id})
        .scalars()
        .all()
    )
    for period in periods:
        lock_delay_period(conn, provider_id, period)
        conn.execute(_INVALIDATE_PERIOD, {"provider_id": provider_id, "period_start_utc": period})


SELECT_MISSING_TRIP_DELAY_PERIODS = named_query(
    "rollup.trip_delay.missing_periods",
    """
    SELECT DISTINCT period_start_utc FROM (
        SELECT DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')
            AS period_start_utc
        FROM gold.fact_trip_delay_snapshot
        WHERE provider_id = :provider_id
          AND captured_at_utc >= :since_utc AND captured_at_utc < :closed_before
        UNION
        SELECT period_start_utc FROM gold.trip_delay_summary_5m
        WHERE provider_id = :provider_id
          AND period_start_utc >= :since_utc AND period_start_utc < :closed_before
        UNION
        SELECT period_start_utc FROM gold.warm_rollup_periods
        WHERE provider_id = :provider_id AND rollup_kind = 'trip_delay_summary_5m'
          AND invalidated_at_utc IS NOT NULL
          AND period_start_utc >= :since_utc AND period_start_utc < :closed_before
    ) AS periods
    WHERE period_start_utc NOT IN (
          SELECT period_start_utc
          FROM gold.warm_rollup_periods
          WHERE provider_id = :provider_id
            AND rollup_kind = 'trip_delay_summary_5m'
            AND invalidated_at_utc IS NULL
            AND (NOT :repair_premature OR built_at_utc >= period_start_utc + INTERVAL '5 minutes')
      )
    ORDER BY 1
    """,
)

_DELETE_PERIOD_SUMMARIES = named_query(
    "rollup.trip_delay.replace_period",
    """
    DELETE FROM gold.trip_delay_summary_5m
    WHERE provider_id = :provider_id AND period_start_utc = :period_start_utc
    """,
)

_REPLACEMENT_NEEDS_PROOF = named_query(
    "rollup.trip_delay.needs_cohort_proof",
    """
    SELECT EXISTS (
        SELECT 1 FROM gold.trip_delay_summary_5m
        WHERE provider_id = :provider_id AND period_start_utc = :period_start_utc
    )
    OR NOT EXISTS (
        SELECT 1 FROM gold.fact_trip_delay_snapshot
        WHERE provider_id = :provider_id
          AND captured_at_utc >= :period_start_utc
          AND captured_at_utc < :period_start_utc + INTERVAL '5 minutes'
    )
    """,
)

SELECT_TRIP_DELAY_ROLLUP_PERIOD_BUILT = named_query(
    "rollup.trip_delay.period_built",
    """
    SELECT EXISTS (
        SELECT 1
        FROM gold.warm_rollup_periods
        WHERE provider_id = :provider_id
          AND rollup_kind = 'trip_delay_summary_5m'
          AND period_start_utc = :period_start_utc
          AND invalidated_at_utc IS NULL
          AND (NOT :repair_premature OR built_at_utc >= period_start_utc + INTERVAL '5 minutes')
    )
    """,
)

UPSERT_TRIP_DELAY_SUMMARY_5M = named_query(
    "rollup.trip_delay.upsert_5m",
    f"""
    INSERT INTO gold.trip_delay_summary_5m (
        provider_id,
        period_start_utc,
        route_id,
        trip_count,
        observation_count,
        delay_observation_count,
        on_time_observation_count,
        avg_delay_seconds,
        avg_delay_seconds_capped,
        max_delay_seconds,
        max_delay_seconds_capped,
        min_delay_seconds,
        delayed_trip_count,
        outlier_count,
        severe_delay_observation_count,
        usable_delay_sum_seconds,
        built_at_utc
    )
    SELECT
        provider_id,
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
        COALESCE(route_id, '__unrouted__'),
        COUNT(DISTINCT trip_id)::integer,
        COUNT(*)::integer,
        COUNT(delay_seconds)::integer,
        COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer,
        AVG(delay_seconds::numeric),
        AVG(delay_seconds::numeric) FILTER (WHERE ABS(delay_seconds) <= 3600),
        MAX(delay_seconds),
        MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600),
        MIN(delay_seconds),
        COUNT(DISTINCT trip_id) FILTER (WHERE delay_seconds > 0)::integer,
        COUNT(*) FILTER (WHERE ABS(delay_seconds) > 3600)::integer,
        COUNT(*) FILTER (
            WHERE delay_seconds > {SEVERE_DELAY_SECONDS}
              AND ABS(delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
        )::integer,
        COALESCE(SUM(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600), 0),
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
      -- Sargable range bound (logically identical to the DATE_BIN bin, but
      -- index-usable on (provider_id, captured_at_utc)) so a per-period upsert is
      -- an index range scan of one 5-min slice, NOT a full seq scan of the fact.
      AND captured_at_utc >= :period_start_utc
      AND captured_at_utc < :period_start_utc + INTERVAL '5 minutes'
      AND DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') = :period_start_utc
    GROUP BY 1, 2, 3
    ON CONFLICT (provider_id, period_start_utc, route_id) DO UPDATE SET
        trip_count              = EXCLUDED.trip_count,
        observation_count       = EXCLUDED.observation_count,
        delay_observation_count = EXCLUDED.delay_observation_count,
        on_time_observation_count = EXCLUDED.on_time_observation_count,
        avg_delay_seconds       = EXCLUDED.avg_delay_seconds,
        avg_delay_seconds_capped = EXCLUDED.avg_delay_seconds_capped,
        max_delay_seconds       = EXCLUDED.max_delay_seconds,
        max_delay_seconds_capped = EXCLUDED.max_delay_seconds_capped,
        min_delay_seconds       = EXCLUDED.min_delay_seconds,
        delayed_trip_count      = EXCLUDED.delayed_trip_count,
        outlier_count           = EXCLUDED.outlier_count,
        severe_delay_observation_count = EXCLUDED.severe_delay_observation_count,
        usable_delay_sum_seconds = EXCLUDED.usable_delay_sum_seconds,
        built_at_utc            = EXCLUDED.built_at_utc
    """,
)

UPSERT_WARM_ROLLUP_PERIOD = named_query(
    "rollup.warm_period.upsert",
    """
    INSERT INTO gold.warm_rollup_periods (
        provider_id, rollup_kind, period_start_utc, built_at_utc
    )
    VALUES (
        :provider_id, :rollup_kind, :period_start_utc, :built_at_utc
    )
    ON CONFLICT (provider_id, rollup_kind, period_start_utc) DO UPDATE SET
        built_at_utc = EXCLUDED.built_at_utc,
        invalidated_at_utc = NULL
    """,
)


def build_delay_periods(
    engine: Engine,
    *,
    provider_id: str,
    since_utc: datetime | None,
    now: datetime,
    progress: PeriodBuildProgress,
    retention_days: int = 14,
    until_utc: datetime | None = None,
    repair_premature: bool = False,
    dry_run: bool = False,
) -> int:
    if retention_days < 2:
        raise ValueError("Delay period builds require at least two days of retained facts")
    closed_before = period_start(now)
    retained_since = period_start(now - timedelta(days=retention_days - 1))
    if repair_premature:
        if since_utc is None or until_utc is None:
            raise ValueError("Premature-period repair requires explicit bounds")
        if since_utc != period_start(since_utc) or until_utc != period_start(until_utc):
            raise ValueError("Repair bounds must be aligned to five-minute UTC intervals")
        if not retained_since <= since_utc < until_utc <= closed_before:
            raise ValueError("Repair bounds must lie within closed, fully retained intervals")
    if until_utc is not None:
        closed_before = min(closed_before, period_start(until_utc))
    since_utc = max(period_start(since_utc), retained_since) if since_utc else retained_since
    with engine.begin() as conn:
        set_daily_warm_transaction_timeouts(conn)
        rows = conn.execute(
            SELECT_MISSING_TRIP_DELAY_PERIODS,
            {
                "provider_id": provider_id,
                "since_utc": since_utc,
                "closed_before": closed_before,
                "repair_premature": repair_premature,
            },
        ).fetchall()

    built = 0
    for row in rows:
        period = row.period_start_utc
        with engine.begin() as conn:
            set_daily_warm_transaction_timeouts(conn)
            lock_delay_hours(conn, provider_id)
            lock_delay_period(conn, provider_id, period)
            if period < max(now, utc_now()) - timedelta(days=retention_days):
                continue
            already_built = conn.execute(
                SELECT_TRIP_DELAY_ROLLUP_PERIOD_BUILT,
                {
                    "provider_id": provider_id,
                    "period_start_utc": period,
                    "repair_premature": repair_premature,
                },
            ).scalar_one()
            if already_built:
                continue
            needs_proof = conn.execute(
                _REPLACEMENT_NEEDS_PROOF,
                {"provider_id": provider_id, "period_start_utc": period},
            ).scalar_one()
            if (needs_proof or repair_premature) and not delay_period_is_complete(
                conn, provider_id, period
            ):
                progress.incomplete_periods += 1
                continue
            if dry_run:
                built += 1
                continue
            built_at = materialization_time(conn)
            conn.execute(
                _DELETE_PERIOD_SUMMARIES,
                {"provider_id": provider_id, "period_start_utc": period},
            )
            conn.execute(
                UPSERT_TRIP_DELAY_SUMMARY_5M,
                {
                    "provider_id": provider_id,
                    "period_start_utc": period,
                    "built_at_utc": built_at,
                },
            )
            conn.execute(
                UPSERT_WARM_ROLLUP_PERIOD,
                {
                    "provider_id": provider_id,
                    "rollup_kind": "trip_delay_summary_5m",
                    "period_start_utc": period,
                    "built_at_utc": built_at,
                },
            )
        built += 1
        progress.committed_rows = built
    if progress.incomplete_periods:
        raise ValueError(
            f"Retained capture evidence is incomplete for {progress.incomplete_periods} "
            "delay periods; previous summaries were preserved. "
            "Restore the complete cohort and retry."
        )
    return built
