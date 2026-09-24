from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine

from transit_ops.db.connection import make_engine, set_daily_warm_transaction_timeouts
from transit_ops.gold.delay_periods import lock_delay_hours, lock_delay_period
from transit_ops.settings import Settings, get_settings
from transit_ops.sql_registry import named_query

_RECOVERY_HOURS = named_query(
    "delay_sums.recovery_hours",
    """
    SELECT DISTINCT date_trunc('hour', period_start_utc) AS hour
    FROM gold.trip_delay_summary_5m
    WHERE provider_id = :provider_id AND usable_delay_sum_seconds IS NULL
      AND period_start_utc >= :from_utc AND period_start_utc < :until_utc
    UNION
    SELECT period_start_utc FROM gold.route_delay_hourly
    WHERE provider_id = :provider_id
      AND (usable_delay_observation_count IS NULL OR usable_delay_sum_seconds IS NULL)
      AND period_start_utc >= :from_utc AND period_start_utc < :until_utc
    ORDER BY hour
    """,
)

_RECOVERABLE_SUMS = named_query(
    "delay_sums.recoverable",
    """
    WITH facts AS (
        SELECT DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') AS period,
               COALESCE(route_id, '__unrouted__') AS route_id,
               COUNT(DISTINCT trip_id) AS trips,
               COUNT(*) AS observations, COUNT(delay_seconds) AS known,
               COUNT(*) FILTER (WHERE ABS(delay_seconds) > 3600) AS outliers,
               COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300) AS on_time,
               COUNT(DISTINCT trip_id) FILTER (WHERE delay_seconds > 0) AS delayed_trips,
               COUNT(*) FILTER (WHERE delay_seconds > 300 AND delay_seconds <= 3600) AS severe,
               MAX(delay_seconds) AS maximum, MIN(delay_seconds) AS minimum,
               MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600) AS capped_maximum,
               ROUND(AVG(delay_seconds::numeric), 2) AS mean,
               ROUND(AVG(delay_seconds::numeric) FILTER (WHERE ABS(delay_seconds) <= 3600), 2)
                   AS capped_mean,
               COALESCE(SUM(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600), 0) AS sum
        FROM gold.fact_trip_delay_snapshot
        WHERE provider_id = :provider_id
          AND captured_at_utc >= :hour AND captured_at_utc < :hour + INTERVAL '1 hour'
          AND EXISTS (
              SELECT 1 FROM gold.trip_delay_summary_5m
              WHERE provider_id = :provider_id AND usable_delay_sum_seconds IS NULL
                AND delay_observation_count > outlier_count
                AND period_start_utc >= :hour AND period_start_utc < :hour + INTERVAL '1 hour'
          )
        GROUP BY 1, 2
    ), buckets AS (
        SELECT b.*, b.ctid::text AS row_locator, b.xmin::text AS row_version,
               b.delay_observation_count - b.outlier_count AS usable_count,
               COALESCE(b.usable_delay_sum_seconds, CASE
                   WHEN b.delay_observation_count = b.outlier_count THEN 0
                   WHEN (b.trip_count, b.observation_count, b.delay_observation_count,
                         b.outlier_count, b.delayed_trip_count, b.severe_delay_observation_count,
                         b.max_delay_seconds, b.min_delay_seconds, b.max_delay_seconds_capped,
                         b.avg_delay_seconds, b.avg_delay_seconds_capped)
                        IS NOT DISTINCT FROM
                        (f.trips, f.observations, f.known, f.outliers, f.delayed_trips, f.severe,
                         f.maximum, f.minimum, f.capped_maximum, f.mean, f.capped_mean)
                        AND (b.on_time_observation_count IS NULL
                             OR b.on_time_observation_count = f.on_time)
                   THEN f.sum
               END) AS exact_sum
        FROM gold.trip_delay_summary_5m AS b
        LEFT JOIN facts AS f ON f.period = b.period_start_utc AND f.route_id = b.route_id
        WHERE b.provider_id = :provider_id
          AND b.period_start_utc >= :hour AND b.period_start_utc < :hour + INTERVAL '1 hour'
    ), hourly AS (
        SELECT route_id, SUM(trip_count) AS trips, SUM(observation_count) AS observations,
               SUM(delay_observation_count) AS known, SUM(delayed_trip_count) AS delayed_trips,
               SUM(severe_delay_observation_count) AS severe,
               MAX(max_delay_seconds_capped) AS maximum,
               CASE WHEN COUNT(*) = COUNT(on_time_observation_count)
                   THEN SUM(on_time_observation_count) END AS on_time,
               ROUND(
                   SUM(avg_delay_seconds_capped * NULLIF(usable_count, 0))
                   / NULLIF(SUM(usable_count), 0), 2
               ) AS legacy_mean,
               SUM(usable_count)::bigint AS usable_count,
               CASE WHEN BOOL_AND(usable_count = 0 OR exact_sum IS NOT NULL)
                   THEN COALESCE(SUM(exact_sum), 0)::bigint END AS exact_sum
        FROM buckets GROUP BY route_id
    ), recoverable_hours AS (
        SELECT h.*, h.ctid::text AS row_locator, h.xmin::text AS row_version,
               CASE WHEN population.is_empty THEN 0
                    WHEN (h.trip_count, h.observation_count, h.delay_observation_count,
                          h.delayed_trip_count, h.severe_delay_count, h.max_delay_seconds,
                          h.avg_delay_seconds)
                         IS NOT DISTINCT FROM
                         (s.trips, s.observations, s.known, s.delayed_trips, s.severe, s.maximum,
                          s.legacy_mean)
                         AND (h.on_time_observation_count IS NULL
                              OR h.on_time_observation_count = s.on_time)
                         AND (h.usable_delay_observation_count IS NULL
                              OR h.usable_delay_observation_count = s.usable_count)
                         AND (h.usable_delay_sum_seconds IS NULL
                              OR h.usable_delay_sum_seconds = s.exact_sum)
                    THEN s.usable_count END AS usable_count,
               CASE WHEN population.is_empty THEN 0 ELSE s.exact_sum END AS exact_sum
        FROM gold.route_delay_hourly AS h
        LEFT JOIN hourly AS s ON s.route_id = h.route_id
        CROSS JOIN LATERAL (
            SELECT h.usable_delay_observation_count = 0 OR (
                h.observation_count = 0 AND h.delay_observation_count = 0
                AND h.trip_count = 0 AND h.delayed_trip_count = 0 AND h.severe_delay_count = 0
                AND h.avg_delay_seconds IS NULL AND h.max_delay_seconds IS NULL
            ) AS is_empty
        ) AS population
        WHERE h.provider_id = :provider_id AND h.period_start_utc = :hour
          AND (h.usable_delay_observation_count IS NULL OR h.usable_delay_sum_seconds IS NULL)
    )
    SELECT 'five_minute' AS grain, period_start_utc AS period, route_id,
           row_locator, row_version, usable_count, exact_sum
    FROM buckets WHERE usable_delay_sum_seconds IS NULL
    UNION ALL
    SELECT 'hourly', period_start_utc, route_id, row_locator, row_version, usable_count, exact_sum
    FROM recoverable_hours
    """,
)

_UPDATE_SUMS = {
    "five_minute": named_query(
        "delay_sums.update_5m",
        """
        UPDATE gold.trip_delay_summary_5m SET usable_delay_sum_seconds = :exact_sum
        WHERE provider_id = :provider_id AND period_start_utc = :period AND route_id = :route_id
          AND ctid = CAST(:row_locator AS tid) AND xmin = CAST(:row_version AS xid)
          AND usable_delay_sum_seconds IS NULL
        """,
    ),
    "hourly": named_query(
        "delay_sums.update_hourly",
        """
        UPDATE gold.route_delay_hourly
        SET usable_delay_observation_count =
                COALESCE(usable_delay_observation_count, :usable_count),
            usable_delay_sum_seconds = COALESCE(usable_delay_sum_seconds, :exact_sum)
        WHERE provider_id = :provider_id AND period_start_utc = :period AND route_id = :route_id
          AND ctid = CAST(:row_locator AS tid) AND xmin = CAST(:row_version AS xid)
          AND (usable_delay_observation_count IS NULL OR usable_delay_sum_seconds IS NULL)
          AND (usable_delay_observation_count IS NULL
               OR usable_delay_observation_count = :usable_count)
          AND (usable_delay_sum_seconds IS NULL OR usable_delay_sum_seconds = :exact_sum)
        """,
    ),
}


@dataclass
class DelaySumRecovery:
    provider_id: str
    from_utc: datetime
    until_utc: datetime
    dry_run: bool
    hours: int = 0
    recoverable: dict[str, int] = field(default_factory=lambda: {"five_minute": 0, "hourly": 0})
    recovered: dict[str, int] = field(default_factory=lambda: {"five_minute": 0, "hourly": 0})
    unknown: dict[str, int] = field(default_factory=lambda: {"five_minute": 0, "hourly": 0})
    concurrent_changes: int = 0


def recover_delay_sums(
    provider_id: str,
    *,
    from_utc: datetime,
    until_utc: datetime,
    dry_run: bool = True,
    engine: Engine | None = None,
    settings: Settings | None = None,
) -> DelaySumRecovery:
    if from_utc.utcoffset() is None or until_utc.utcoffset() is None:
        raise ValueError("Recovery bounds must be timezone-aware whole UTC hours")
    from_utc, until_utc = from_utc.astimezone(UTC), until_utc.astimezone(UTC)
    for boundary in (from_utc, until_utc):
        if any((boundary.minute, boundary.second, boundary.microsecond)):
            raise ValueError("Recovery bounds must be timezone-aware whole UTC hours")
    if not from_utc < until_utc:
        raise ValueError("Recovery start must precede its exclusive end")
    engine = engine or make_engine(settings or get_settings())
    result = DelaySumRecovery(provider_id, from_utc, until_utc, dry_run)
    with engine.begin() as conn:
        set_daily_warm_transaction_timeouts(conn)
        hours = (
            conn.execute(
                _RECOVERY_HOURS,
                {
                    "provider_id": provider_id,
                    "from_utc": from_utc,
                    "until_utc": until_utc,
                },
            )
            .scalars()
            .all()
        )
    for hour in hours:
        with engine.begin() as conn:
            set_daily_warm_transaction_timeouts(conn)
            if not dry_run:
                lock_delay_hours(conn, provider_id)
                for minute in range(0, 60, 5):
                    lock_delay_period(conn, provider_id, hour + timedelta(minutes=minute))
            proposals = (
                conn.execute(
                    _RECOVERABLE_SUMS,
                    {
                        "provider_id": provider_id,
                        "hour": hour,
                    },
                )
                .mappings()
                .all()
            )
            pending: dict[str, list[dict[str, object]]] = {grain: [] for grain in _UPDATE_SUMS}
            for row in proposals:
                grain = row["grain"]
                if row["usable_count"] is None or row["exact_sum"] is None:
                    result.unknown[grain] += 1
                    continue
                pending[grain].append({**row, "provider_id": provider_id})
            for grain, rows in pending.items():
                result.recoverable[grain] += len(rows)
                if rows and not dry_run:
                    written = conn.execute(_UPDATE_SUMS[grain], rows).rowcount
                    result.recovered[grain] += written
                    result.concurrent_changes += len(rows) - written
        result.hours += 1
    return result
