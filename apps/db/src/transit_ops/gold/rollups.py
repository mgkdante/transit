from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import bindparam
from sqlalchemy.engine import Engine, Row

from transit_ops.db.connection import make_engine, set_daily_warm_transaction_timeouts
from transit_ops.gold.delay_cohorts import delay_window_is_complete
from transit_ops.gold.delay_days import (
    DAILY_DELAY_TABLES,
    assert_daily_delay_history_clean,
    daily_delay_status,
    delay_day_state,
    lock_delay_day,
)
from transit_ops.gold.delay_hours import delay_hour_statement, refresh_changed_delay_hours
from transit_ops.gold.delay_periods import (
    GHOST_DELAY_ABS_SECONDS,
    SEVERE_DELAY_SECONDS,
    UPSERT_WARM_ROLLUP_PERIOD,
    PeriodBuildProgress,
    build_delay_periods,
    lock_delay_hours,
    materialization_time,
)
from transit_ops.gold.delay_periods import (
    UPSERT_TRIP_DELAY_SUMMARY_5M as UPSERT_TRIP_DELAY_SUMMARY_5M,
)
from transit_ops.gold.reader.buckets import daytype_case_sql, shift_case_sql
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings
from transit_ops.sql_registry import named_query

logger = logging.getLogger(__name__)


def provider_is_seeded(conn, provider_id: str) -> bool:  # noqa: ANN001
    sql = named_query(
        "rollup.provider.exists",
        "SELECT 1 FROM gold.dim_provider WHERE provider_id = :provider_id LIMIT 1",
    )
    params = {"provider_id": provider_id}
    if isinstance(conn, Engine):
        with conn.connect() as connection:
            set_daily_warm_transaction_timeouts(connection)
            return connection.execute(sql, params).scalar_one_or_none() is not None
    set_daily_warm_transaction_timeouts(conn)
    return conn.execute(sql, params).scalar_one_or_none() is not None


OPEN_WINDOW_HOURLY_CUTOFF_SQL = (
    "date_trunc('hour', CAST(:built_at_utc AS timestamptz)) "
    "- make_interval(days => :open_window_days)"
)


def _feed_day_calendar(name: str, fact_table: str, *, missing: bool = False):
    # Vehicle and trip calendars remain separate because their facts prune independently.
    watermark_filter = (
        """
      AND timezone('UTC', f.snapshot_local_date::timestamp) NOT IN (
          SELECT period_start_utc
          FROM gold.warm_rollup_periods
          WHERE provider_id = :provider_id
            AND rollup_kind = :rollup_kind
      )
    """
        if missing
        else ""
    )
    return named_query(
        name,
        f"""
        SELECT DISTINCT f.snapshot_local_date AS local_date, f.snapshot_date_key AS date_key
        FROM gold.{fact_table} AS f
        WHERE f.provider_id = :provider_id
          AND f.snapshot_date_key >= :floor_key
          AND f.snapshot_date_key < :today_key
          {watermark_filter}
        ORDER BY f.snapshot_local_date
        """,
    )


SELECT_MISSING_PERCENTILE_DAYS = _feed_day_calendar(
    "rollup.percentile.missing_days", "fact_trip_delay_snapshot", missing=True
)
SELECT_MISSING_OCCUPANCY_DAYS = _feed_day_calendar(
    "rollup.occupancy.missing_days", "fact_vehicle_snapshot", missing=True
)
SELECT_AVAILABLE_PERCENTILE_DAYS = _feed_day_calendar(
    "rollup.percentile.available_days", "fact_trip_delay_snapshot"
)
SELECT_AVAILABLE_OCCUPANCY_DAYS = _feed_day_calendar(
    "rollup.occupancy.available_days", "fact_vehicle_snapshot"
)


# Convert both local midnights independently so DST days need not last 24 hours.
_CAPTURE_DAY_PREDICATE_SQL = """
      f.captured_at_utc >= timezone(
          (SELECT timezone FROM gold.dim_provider WHERE provider_id = :provider_id),
          CAST(:local_date AS date)::timestamp)
      AND f.captured_at_utc < timezone(
          (SELECT timezone FROM gold.dim_provider WHERE provider_id = :provider_id),
          (CAST(:local_date AS date) + 1)::timestamp)
""".strip()

_CAPTURE_DAY_CALENDAR_SQL = """
    WITH days AS (
        SELECT d.local_midnight::date AS local_date,
               to_char(d.local_midnight, 'YYYYMMDD')::integer AS date_key,
               timezone(p.timezone, d.local_midnight) AS from_utc,
               timezone(p.timezone, d.local_midnight + INTERVAL '1 day') AS until_utc
        FROM gold.dim_provider AS p
        CROSS JOIN generate_series(
            to_date(CAST(:floor_key AS text), 'YYYYMMDD')::timestamp,
            to_date(CAST(:today_key AS text), 'YYYYMMDD')::timestamp - INTERVAL '1 day',
            INTERVAL '1 day'
        ) AS d(local_midnight)
        WHERE p.provider_id = :provider_id
    )
    SELECT d.local_date, d.date_key
    FROM days AS d
    CROSS JOIN LATERAL (
        SELECT 1 FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.captured_at_utc >= d.from_utc AND f.captured_at_utc < d.until_utc
        LIMIT 1
    ) AS observed
    WHERE (CAST(:retained_since_utc AS timestamptz) IS NULL
           OR d.from_utc >= :retained_since_utc)
"""
SELECT_AVAILABLE_CAPTURE_DAYS = named_query(
    "rollup.capture.available_days",
    _CAPTURE_DAY_CALENDAR_SQL + " ORDER BY d.local_date",
).bindparams(bindparam("retained_since_utc", value=None))
SELECT_MISSING_CAPTURE_DAYS = named_query(
    "rollup.capture.missing_days",
    _CAPTURE_DAY_CALENDAR_SQL
    + """
      AND NOT EXISTS (
          SELECT 1 FROM gold.warm_rollup_periods AS w
          WHERE w.provider_id = :provider_id AND w.rollup_kind = :rollup_kind
            AND w.period_start_utc = timezone('UTC', d.local_date::timestamp)
      )
    ORDER BY d.local_date
    """,
).bindparams(bindparam("retained_since_utc", value=None))

_CAPTURE_DAY_BOUNDS = named_query(
    "rollup.capture.day_bounds",
    """
    SELECT timezone(timezone, CAST(:local_date AS date)::timestamp),
           timezone(timezone, (CAST(:local_date AS date) + 1)::timestamp)
    FROM gold.dim_provider WHERE provider_id = :provider_id
    """,
)

SELECT_BUILT_DAILY_DAYS = named_query(
    "rollup.daily.built_days",
    """
    SELECT (period_start_utc AT TIME ZONE 'UTC')::date AS local_date
    FROM gold.warm_rollup_periods
    WHERE provider_id = :provider_id
      AND rollup_kind = :rollup_kind
    """,
)

SELECT_BUILT_DAILY_CALENDARS = named_query(
    "rollup.daily.built_calendars",
    """
    SELECT rollup_kind, (period_start_utc AT TIME ZONE 'UTC')::date AS local_date
    FROM gold.warm_rollup_periods
    WHERE provider_id = :provider_id
      AND rollup_kind = ANY(:rollup_kinds)
      AND period_start_utc = ANY(:period_starts)
    """,
)


def _daily_percentile_upsert(entity: str, source_column: str):
    return named_query(
        f"rollup.{entity}_percentile.upsert",
        f"""
        INSERT INTO gold.{entity}_delay_percentile_daily (
            provider_id, provider_local_date, {entity}_id,
            delay_observation_count, p50_delay_seconds, p90_delay_seconds, built_at_utc
        )
        SELECT f.provider_id, :local_date, f.{source_column}, COUNT(*)::integer,
            ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY f.delay_seconds)::numeric, 2),
            ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY f.delay_seconds)::numeric, 2),
            :built_at_utc
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.{source_column} IS NOT NULL
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
          AND {_CAPTURE_DAY_PREDICATE_SQL}
        GROUP BY f.provider_id, f.{source_column}
        ON CONFLICT (provider_id, provider_local_date, {entity}_id) DO UPDATE SET
            delay_observation_count = EXCLUDED.delay_observation_count,
            p50_delay_seconds = EXCLUDED.p50_delay_seconds,
            p90_delay_seconds = EXCLUDED.p90_delay_seconds,
            built_at_utc = EXCLUDED.built_at_utc
        """,
    )


UPSERT_ROUTE_DELAY_PERCENTILE_DAILY = _daily_percentile_upsert("route", "route_id")
UPSERT_STOP_DELAY_PERCENTILE_DAILY = _daily_percentile_upsert("stop", "delay_stop_id")


# Trip service days may span two capture dates; NULL relationships are scheduled.
UPSERT_ROUTE_CANCELLATION_DAILY = named_query(
    "rollup.route_cancellation.upsert",
    """
    WITH trip_day AS (
        SELECT
            f.provider_id,
            f.route_id,
            f.trip_id,
            f.start_date AS service_date,
            MAX((COALESCE(f.trip_schedule_relationship, 0) = 3)::int) AS was_canceled
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          AND f.start_date IS NOT NULL
          -- TWO-day indexed CAPTURE window: daytime (date_key D) + overnight tail
          -- (date_key D+1), both sargable on ix_..._provider_date_key (a 2-key IN).
          AND f.snapshot_date_key IN (
              :date_key,
              to_char((CAST(:local_date AS date) + 1), 'YYYYMMDD')::integer
          )
          -- Attribute by GTFS SERVICE day, not capture day, so the observed universe
          -- matches the scheduled denominator (both = service-day :local_date). GC2.
          AND f.start_date = CAST(:local_date AS date)
        GROUP BY f.provider_id, f.route_id, f.trip_id, f.start_date
    ),
    obs AS (
        -- RT-observed counts per route. The aggregation SHAPE is byte-identical to the
        -- pre-H1 SELECT (same COUNT / FILTER / rate formula); total/canceled/rate keep
        -- their RT-observed DEFINITION. What shifts is the universe underneath: on
        -- cross-midnight routes the trip_day CTE now excludes the mis-attributed
        -- neighbouring-service-day tail, so total_trip_days (and the rate derived from
        -- it) is CORRECTED — not bit-identical to the old value, just self-consistent
        -- with the scheduled denominator it now shares. The scheduled FULL JOIN below
        -- only ADDS columns + sch-only dark rows; it never filters or mutates this CTE
        -- (rows that already have an obs match keep this aggregate's value, FIX-4).
        SELECT
            provider_id,
            route_id,
            COUNT(*)::integer AS total_trip_days,
            COUNT(*) FILTER (WHERE was_canceled = 1)::integer AS canceled_trip_days,
            ROUND(100.0 * COUNT(*) FILTER (WHERE was_canceled = 1) / NULLIF(COUNT(*), 0), 2)
                AS cancellation_rate_pct
        FROM trip_day
        GROUP BY provider_id, route_id
    )
    INSERT INTO gold.route_cancellation_daily (
        provider_id, provider_local_date, route_id,
        total_trip_days, canceled_trip_days, cancellation_rate_pct, built_at_utc,
        scheduled_trip_days, delivered_trip_days, silent_trip_days
    )
    SELECT
        -- FULL JOIN key coalesce: a scheduled-but-fully-dark route-day has NO obs row,
        -- so identity + provider_local_date fall back to the sch side (FIX-4). route_id
        -- is schedule-derived, so it always exists in dim_route.
        COALESCE(obs.provider_id, sch.provider_id),
        :local_date,
        COALESCE(obs.route_id, sch.route_id),
        -- RT-observed totals: 0 on a fully-dark day (scheduled trips, none observed).
        COALESCE(obs.total_trip_days, 0),
        COALESCE(obs.canceled_trip_days, 0),
        -- cancellation_rate_pct stays honest-NULL on a dark day — no RT denominator to
        -- divide (obs.cancellation_rate_pct is NULL when the obs row is absent).
        obs.cancellation_rate_pct,
        :built_at_utc,
        -- scheduled universe (NULL = unknown: no scheduled rollup for this date).
        sch.scheduled_trip_count,
        -- delivered = RT-observed non-cancelled (0 on a fully-dark day).
        (COALESCE(obs.total_trip_days, 0) - COALESCE(obs.canceled_trip_days, 0))::integer,
        -- silent = scheduled minus ALL RT-observed, clamped at 0 (over-delivery hidden).
        -- NULL when scheduled unknown, never a fabricated 0. On a dark day silent==scheduled.
        CASE WHEN sch.scheduled_trip_count IS NULL THEN NULL
             ELSE GREATEST(sch.scheduled_trip_count - COALESCE(obs.total_trip_days, 0), 0)::integer
        END
    FROM obs
    FULL JOIN gold.route_scheduled_trips_daily AS sch
        ON sch.provider_id = obs.provider_id
       AND sch.provider_local_date = :local_date
       AND sch.route_id = obs.route_id
    -- The FULL JOIN's sch side is unfiltered in the ON clause, so bound the sch-only
    -- (dark) rows to THIS provider + date here — obs-side rows already satisfy it via
    -- the join key, so this never drops a row that had RT observations.
    WHERE COALESCE(obs.provider_id, sch.provider_id) = :provider_id
      AND (sch.provider_local_date IS NULL OR sch.provider_local_date = :local_date)
    ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET
        total_trip_days = EXCLUDED.total_trip_days,
        canceled_trip_days = EXCLUDED.canceled_trip_days,
        cancellation_rate_pct = EXCLUDED.cancellation_rate_pct,
        built_at_utc = EXCLUDED.built_at_utc,
        -- Recompute the scheduled-aware split from the freshly-joined scheduled
        -- rollup on every rebuild (GC2 H1). Old RT-observed fields above are
        -- untouched — the split reads scheduled/total/canceled, never mutates them.
        scheduled_trip_days = EXCLUDED.scheduled_trip_days,
        delivered_trip_days = EXCLUDED.delivered_trip_days,
        silent_trip_days = EXCLUDED.silent_trip_days
    """,
)

# Scheduled counts include calendar_dates-only service and trips absent from realtime.
UPSERT_ROUTE_SCHEDULED_TRIPS_DAILY = named_query(
    "rollup.route_scheduled_trips.upsert",
    """
    WITH edition AS (
        -- CURRENT static edition only — never a rolled-back / non-current version
        -- (same guard 0069/marts.py:150 warns about).
        SELECT dataset_version_id
        FROM core.dataset_versions
        WHERE provider_id = :provider_id
          AND dataset_kind = 'static_schedule'
          AND is_current = true
        ORDER BY loaded_at_utc DESC
        LIMIT 1
    ),
    active_service AS (
        -- canonical GTFS service-on-date resolution for D = :local_date, shared with
        -- _helpers.py _REP_DATES_SQL. Weekly pattern (minus type-2 removals) UNION
        -- type-1 additions handles calendar_dates-only feeds.
        SELECT c.service_id
        FROM edition e
        JOIN silver.calendar c
          ON c.dataset_version_id = e.dataset_version_id
         AND c.provider_id = :provider_id
         AND CAST(:local_date AS date) BETWEEN c.start_date AND c.end_date
         AND CASE EXTRACT(ISODOW FROM CAST(:local_date AS date))
               WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
               WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
               ELSE c.sunday END
        WHERE NOT EXISTS (
            SELECT 1 FROM silver.calendar_dates cd
            WHERE cd.dataset_version_id = e.dataset_version_id
              AND cd.provider_id = :provider_id
              AND cd.service_id = c.service_id
              AND cd.service_date = CAST(:local_date AS date)
              AND cd.exception_type = 2
        )
        UNION
        SELECT cd.service_id
        FROM edition e
        JOIN silver.calendar_dates cd
          ON cd.dataset_version_id = e.dataset_version_id
         AND cd.provider_id = :provider_id
         AND cd.service_date = CAST(:local_date AS date)
         AND cd.exception_type = 1
    )
    INSERT INTO gold.route_scheduled_trips_daily (
        provider_id, provider_local_date, route_id,
        scheduled_trip_count, dataset_version_id, built_at_utc
    )
    SELECT
        :provider_id,
        :local_date,
        t.route_id,
        COUNT(DISTINCT t.trip_id)::integer,
        e.dataset_version_id,
        :built_at_utc
    FROM edition e
    JOIN silver.trips t
      ON t.dataset_version_id = e.dataset_version_id
     AND t.provider_id = :provider_id
    JOIN active_service a
      ON a.service_id = t.service_id
    WHERE t.route_id IS NOT NULL
    GROUP BY t.route_id, e.dataset_version_id
    ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET
        scheduled_trip_count = EXCLUDED.scheduled_trip_count,
        dataset_version_id = EXCLUDED.dataset_version_id,
        built_at_utc = EXCLUDED.built_at_utc
    """,
)


def _occupancy_upsert(entity: str, *, hourly: bool = False):
    # Stop attribution excludes NULL; route attribution retains an unrouted bucket.
    identity = "f.stop_id" if entity == "stop" else "COALESCE(f.route_id, '__unrouted__')"
    hour = "EXTRACT(HOUR FROM timezone(dp.timezone, f.captured_at_utc))"
    keys = ["provider_id", "provider_local_date", f"{entity}_id"]
    values = ["f.provider_id", ":local_date", identity]
    groups = ["f.provider_id", identity]
    if hourly:
        keys = ["provider_id", "route_id", "provider_local_date", "hour_of_day_local"]
        values = ["f.provider_id", identity, ":local_date", f"{hour}::smallint"]
        groups.append(hour)
    bands = {
        "observation_count": "IN (0, 1, 2, 3, 4, 5)",
        "empty_count": "= 0",
        "many_seats_count": "= 1",
        "few_seats_count": "= 2",
        "standing_count": "IN (3, 4)",
        "full_count": "= 5",
    }
    values += [
        f"COUNT(*) FILTER (WHERE f.occupancy_status {condition})::integer"
        for condition in bands.values()
    ]
    columns = [*keys, *bands, "built_at_utc"]
    updates = ", ".join(f"{column} = EXCLUDED.{column}" for column in [*bands, "built_at_utc"])
    suffix = "hourly" if hourly else "daily"
    query = f"rollup.{entity}_occupancy{'_hourly' if hourly else ''}.upsert"
    provider_join = (
        "INNER JOIN gold.dim_provider AS dp ON dp.provider_id = f.provider_id" if hourly else ""
    )
    stop_filter = "AND f.stop_id IS NOT NULL" if entity == "stop" else ""
    return named_query(
        query,
        f"""
        INSERT INTO gold.{entity}_occupancy_band_{suffix} ({", ".join(columns)})
        SELECT {", ".join([*values, ":built_at_utc"])}
        FROM gold.fact_vehicle_snapshot AS f
        {provider_join}
        WHERE f.provider_id = :provider_id
          AND f.snapshot_date_key = :date_key
          {stop_filter}
        GROUP BY {", ".join(groups)}
        ON CONFLICT ({", ".join(keys)}) DO UPDATE SET {updates}
        """,
    )


UPSERT_ROUTE_OCCUPANCY_BAND_DAILY = _occupancy_upsert("route")
UPSERT_ROUTE_OCCUPANCY_BAND_HOURLY = _occupancy_upsert("route", hourly=True)
UPSERT_STOP_OCCUPANCY_BAND_DAILY = _occupancy_upsert("stop")


# Pool sums and counts; daily medians cannot be pooled exactly.
UPSERT_ROUTE_DELAY_BY_CROWDING_DAILY = named_query(
    "rollup.route_crowding.upsert",
    f"""
    WITH co_observed AS (
        SELECT
            f.provider_id,
            f.route_id,
            CASE f.occupancy_status
                WHEN 0 THEN 'empty'
                WHEN 1 THEN 'many_seats'
                WHEN 2 THEN 'few_seats'
                WHEN 3 THEN 'standing'
                WHEN 4 THEN 'standing'
                WHEN 5 THEN 'full'
            END AS band,
            f.delay_seconds
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.route_id IS NOT NULL
          AND f.occupancy_status IN (0, 1, 2, 3, 4, 5)
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
          AND {_CAPTURE_DAY_PREDICATE_SQL}
    )
    INSERT INTO gold.route_delay_by_crowding_daily (
        provider_id, provider_local_date, route_id, band,
        delay_observation_count, sum_delay_seconds, p50_delay_seconds, built_at_utc
    )
    SELECT
        provider_id,
        :local_date,
        route_id,
        band,
        COUNT(*)::integer,
        SUM(delay_seconds)::numeric,
        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_seconds)::numeric, 2),
        :built_at_utc
    FROM co_observed
    GROUP BY provider_id, route_id, band
    ON CONFLICT (provider_id, provider_local_date, route_id, band) DO UPDATE SET
        delay_observation_count = EXCLUDED.delay_observation_count,
        sum_delay_seconds = EXCLUDED.sum_delay_seconds,
        p50_delay_seconds = EXCLUDED.p50_delay_seconds,
        built_at_utc = EXCLUDED.built_at_utc
    """,
)

# Lag one closed capture day to include overnight trips on their service day.
UPSERT_ROUTE_SERVICE_SPAN_DAILY = named_query(
    "rollup.route_service_span.upsert",
    """
    WITH trip_starts AS (
        SELECT
            f.provider_id,
            f.route_id,
            f.trip_id,
            MIN(f.captured_at_utc) AS trip_start_utc,
            (ARRAY_AGG(f.delay_seconds ORDER BY f.captured_at_utc ASC, f.entity_index ASC))[1]
                AS first_obs_delay,
            (ARRAY_AGG(f.delay_seconds ORDER BY f.captured_at_utc DESC, f.entity_index DESC))[1]
                AS last_obs_delay
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          -- TWO-day indexed window: daytime (date_key D) + overnight tail (date_key D+1).
          AND f.snapshot_date_key IN (
              to_char((CAST(:local_date AS date) - 1), 'YYYYMMDD')::integer,
              :date_key
          )
          -- Attribute by GTFS service day, not capture day (= local_date - 1, the just-completed
          -- service day whose tail finished within :local_date). NULL start_date drops out.
          AND f.start_date = (CAST(:local_date AS date) - 1)
        GROUP BY f.provider_id, f.route_id, f.trip_id
    ),
    ranked AS (
        SELECT
            provider_id,
            route_id,
            trip_start_utc,
            first_obs_delay,
            last_obs_delay,
            ROW_NUMBER() OVER (
                PARTITION BY provider_id, route_id ORDER BY trip_start_utc ASC, first_obs_delay ASC
            ) AS rn_first,
            ROW_NUMBER() OVER (
                PARTITION BY provider_id, route_id ORDER BY trip_start_utc DESC, first_obs_delay ASC
            ) AS rn_last
        FROM trip_starts
    )
    INSERT INTO gold.route_service_span_daily (
        provider_id, provider_local_date, route_id,
        first_trip_start_utc, last_trip_start_utc, service_span_min,
        first_trip_delay_seconds, last_trip_delay_seconds, trip_count, built_at_utc
    )
    SELECT
        provider_id,
        (CAST(:local_date AS date) - 1),
        route_id,
        MIN(trip_start_utc),
        MAX(trip_start_utc),
        ROUND(EXTRACT(EPOCH FROM (MAX(trip_start_utc) - MIN(trip_start_utc))) / 60.0)::integer,
        MAX(first_obs_delay) FILTER (WHERE rn_first = 1),
        MAX(last_obs_delay) FILTER (WHERE rn_last = 1),
        COUNT(*)::integer,
        :built_at_utc
    FROM ranked
    GROUP BY provider_id, route_id
    ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET
        first_trip_start_utc = EXCLUDED.first_trip_start_utc,
        last_trip_start_utc = EXCLUDED.last_trip_start_utc,
        service_span_min = EXCLUDED.service_span_min,
        first_trip_delay_seconds = EXCLUDED.first_trip_delay_seconds,
        last_trip_delay_seconds = EXCLUDED.last_trip_delay_seconds,
        trip_count = EXCLUDED.trip_count,
        built_at_utc = EXCLUDED.built_at_utc
    """,
)

# Skipped-stop rates include all observed stop-time updates, including NULL relationships.
UPSERT_ROUTE_SKIPPED_STOP_DAILY = named_query(
    "rollup.route_skipped_stop.upsert",
    """
    INSERT INTO gold.route_skipped_stop_daily (
        provider_id, provider_local_date, route_id,
        stop_time_update_count, skipped_stop_count, skipped_stop_rate_pct, built_at_utc
    )
    SELECT
        f.provider_id,
        :local_date,
        f.route_id,
        SUM(f.stop_time_update_count)::bigint,
        SUM(f.skipped_stop_count)::bigint,
        ROUND(
            100.0 * SUM(f.skipped_stop_count) / NULLIF(SUM(f.stop_time_update_count), 0),
            2
        ),
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.route_id IS NOT NULL
      AND f.snapshot_date_key = :date_key
    GROUP BY f.provider_id, f.route_id
    ON CONFLICT (provider_id, provider_local_date, route_id) DO UPDATE SET
        stop_time_update_count = EXCLUDED.stop_time_update_count,
        skipped_stop_count = EXCLUDED.skipped_stop_count,
        skipped_stop_rate_pct = EXCLUDED.skipped_stop_rate_pct,
        built_at_utc = EXCLUDED.built_at_utc
    """,
)


# Compute strict severe-delay shares from count predicates, not histogram edges.
DELAY_HISTOGRAM_EDGES = (
    -3600,
    -300,
    -180,
    -120,
    -90,
    -60,
    -30,
    0,
    30,
    60,
    90,
    120,
    150,
    180,
    240,
    300,
    420,
    600,
    900,
    1800,
    3600,
)

_SPINE_HIST_EDGES_SQL = (
    "ARRAY[-3600,-300,-180,-120,-90,-60,-30,0,30,60,90,120,150,180,240,300,420,600,900,1800,3600]"
)

# Headway bins cover 0<gap<240 minutes without an overflow bin.
HEADWAY_GAP_HISTOGRAM_EDGES = (
    0.0,
    0.5,
    1,
    2,
    3,
    4,
    5,
    6,
    8,
    10,
    12,
    15,
    20,
    25,
    30,
    40,
    60,
    90,
    120,
    180,
    240,
)

_HEADWAY_GAP_HIST_EDGES_SQL = "ARRAY[0.0,0.5,1,2,3,4,5,6,8,10,12,15,20,25,30,40,60,90,120,180,240]"

# Count distinct delayed trips per five-minute sub-bucket; then sum at hour/direction grain.
# Different direction rows can count a trip twice; delayed_trip_count has no ghost clamp.
UPSERT_ROUTE_DELAY_SPINE = named_query(
    "rollup.route_delay_spine.upsert",
    f"""
    -- Keep the closed-day filter as an optimizer boundary. Without MATERIALIZED,
    -- PostgreSQL can chase route-order incremental sorting through this CTE, walk the
    -- provider/route index across the full fact, and apply the capture range afterward.
    WITH day_rows AS MATERIALIZED (
        SELECT
            f.provider_id,
            f.route_id,
            EXTRACT(HOUR FROM timezone(dp.timezone, f.captured_at_utc))::smallint
                AS hour_of_day_local,
            COALESCE(f.direction_id, 0) AS direction_id,
            DATE_BIN(
                '5 minutes', f.captured_at_utc, TIMESTAMPTZ '2000-01-01'
            ) AS bucket_5m,
            f.trip_id,
            f.delay_seconds AS delay_seconds,
            CASE
                WHEN f.delay_seconds IS NULL
                     OR ABS(f.delay_seconds) > {GHOST_DELAY_ABS_SECONDS}
                THEN NULL
                ELSE LEAST(
                    GREATEST(width_bucket(f.delay_seconds, {_SPINE_HIST_EDGES_SQL}), 1),
                    21
                ) - 1
            END AS bin_idx
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN gold.dim_provider AS dp ON dp.provider_id = f.provider_id
        WHERE f.provider_id = :provider_id
          AND f.route_id IS NOT NULL
          AND {_CAPTURE_DAY_PREDICATE_SQL}
    ),
    -- Reduce the filtered day ONCE at the required 5-minute distinct-trip grain. Every
    -- other metric is additive, so the outer hour fold is exact while avoiding a second
    -- fact-table scan solely for delayed_trip_count.
    per5m AS (
        SELECT
            s.provider_id,
            s.route_id,
            s.hour_of_day_local,
            s.direction_id,
            s.bucket_5m,
            COUNT(*) AS observation_count,
            COUNT(s.delay_seconds) AS delay_observation_count,
            COUNT(*) FILTER (
                WHERE s.delay_seconds >= -60 AND s.delay_seconds < 300
            ) AS on_time_observation_count,
            COUNT(*) FILTER (
                WHERE s.delay_seconds > {SEVERE_DELAY_SECONDS}
                  AND ABS(s.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
            ) AS severe_delay_count,
            SUM(s.delay_seconds) FILTER (WHERE s.bin_idx IS NOT NULL) AS sum_delay_seconds,
            COUNT(*) FILTER (WHERE s.bin_idx = 0) AS bin_0_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 1) AS bin_1_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 2) AS bin_2_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 3) AS bin_3_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 4) AS bin_4_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 5) AS bin_5_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 6) AS bin_6_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 7) AS bin_7_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 8) AS bin_8_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 9) AS bin_9_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 10) AS bin_10_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 11) AS bin_11_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 12) AS bin_12_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 13) AS bin_13_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 14) AS bin_14_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 15) AS bin_15_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 16) AS bin_16_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 17) AS bin_17_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 18) AS bin_18_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 19) AS bin_19_count,
            COUNT(*) FILTER (WHERE s.bin_idx = 20) AS bin_20_count,
            COUNT(DISTINCT s.trip_id) FILTER (
                WHERE s.delay_seconds > 0
            ) AS delayed_trip_count
        FROM day_rows AS s
        GROUP BY s.provider_id, s.route_id, s.hour_of_day_local, s.direction_id, s.bucket_5m
    )
    INSERT INTO gold.route_delay_spine (
        provider_id, route_id, provider_local_date, hour_of_day_local, direction_id,
        observation_count, delay_observation_count, on_time_observation_count,
        severe_delay_count, sum_delay_seconds, delay_histogram, delayed_trip_count,
        built_at_utc
    )
    SELECT
        p.provider_id,
        p.route_id,
        :local_date,
        p.hour_of_day_local,
        p.direction_id,
        -- observation_count: every fact row in the grain (delay may be NULL).
        SUM(p.observation_count)::integer,
        -- delay_observation_count: every non-null delay (ghost-INCLUSIVE), matching the 5m.
        SUM(p.delay_observation_count)::integer,
        -- on-time = delay in [-60, 300) via the EXACT live predicate (NOT bins).
        -- NULL-guarded: no usable delay -> on-time unknowable -> NULL (honest absence).
        CASE
            WHEN SUM(p.delay_observation_count) = 0 THEN NULL
            ELSE SUM(p.on_time_observation_count)::integer
        END,
        -- severe = delay > 300s via the EXACT live predicate (byte-identical to the 5m).
        SUM(p.severe_delay_count)::integer,
        -- pooled numerator for the rebaselined avg (ghost-excluded = in-clamp delays).
        COALESCE(SUM(p.sum_delay_seconds), 0)::bigint,
        ARRAY[
            SUM(p.bin_0_count),  SUM(p.bin_1_count),  SUM(p.bin_2_count),
            SUM(p.bin_3_count),  SUM(p.bin_4_count),  SUM(p.bin_5_count),
            SUM(p.bin_6_count),  SUM(p.bin_7_count),  SUM(p.bin_8_count),
            SUM(p.bin_9_count),  SUM(p.bin_10_count), SUM(p.bin_11_count),
            SUM(p.bin_12_count), SUM(p.bin_13_count), SUM(p.bin_14_count),
            SUM(p.bin_15_count), SUM(p.bin_16_count), SUM(p.bin_17_count),
            SUM(p.bin_18_count), SUM(p.bin_19_count), SUM(p.bin_20_count)
        ]::smallint[],
        -- delayed_trip_count: SUM of the exact per-5m distinct positive-delay trip counts.
        SUM(p.delayed_trip_count)::integer,
        :built_at_utc
    FROM per5m AS p
    GROUP BY p.provider_id, p.route_id, p.hour_of_day_local, p.direction_id
    ON CONFLICT (provider_id, route_id, provider_local_date, hour_of_day_local, direction_id)
    DO UPDATE SET
        observation_count        = EXCLUDED.observation_count,
        delay_observation_count  = EXCLUDED.delay_observation_count,
        on_time_observation_count = EXCLUDED.on_time_observation_count,
        severe_delay_count       = EXCLUDED.severe_delay_count,
        sum_delay_seconds        = EXCLUDED.sum_delay_seconds,
        delay_histogram          = EXCLUDED.delay_histogram,
        delayed_trip_count       = EXCLUDED.delayed_trip_count,
        built_at_utc             = EXCLUDED.built_at_utc
    """,
)


# Stop counts and pooled means share the same in-clamp row set, including unrouted observations.
UPSERT_STOP_DELAY_SPINE = named_query(
    "rollup.stop_delay_spine.upsert",
    f"""
    INSERT INTO gold.stop_delay_spine (
        provider_id, stop_id, route_id, provider_local_date,
        observation_count, severe_delay_count, sum_delay_seconds, built_at_utc
    )
    SELECT
        f.provider_id,
        f.delay_stop_id AS stop_id,
        COALESCE(f.route_id, '__unrouted__') AS route_id,
        :local_date,
        -- in-clamp delay count: the WHERE already filters delay non-null + |delay|<=3600.
        COUNT(*)::integer,
        -- severe = delay > 300 (and <= 3600, already guaranteed by the WHERE clamp).
        COUNT(*) FILTER (WHERE f.delay_seconds > {SEVERE_DELAY_SECONDS})::integer,
        -- pooled in-clamp numerator for the rebaselined avg.
        COALESCE(SUM(f.delay_seconds), 0)::bigint,
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND {_CAPTURE_DAY_PREDICATE_SQL}
      AND f.delay_stop_id IS NOT NULL
      AND f.delay_seconds IS NOT NULL
      AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}    -- GHOST clamp (ghosts + nulls out)
    GROUP BY f.provider_id, f.delay_stop_id, COALESCE(f.route_id, '__unrouted__')
    ON CONFLICT (provider_id, stop_id, route_id, provider_local_date)
    DO UPDATE SET
        observation_count  = EXCLUDED.observation_count,
        severe_delay_count = EXCLUDED.severe_delay_count,
        sum_delay_seconds  = EXCLUDED.sum_delay_seconds,
        built_at_utc       = EXCLUDED.built_at_utc
    """,
)


# Compute shift once from provider-local capture time; shifted totals match the stop spine.
_STOP_DELAY_SHIFT_HOUR_SQL = "EXTRACT(HOUR FROM timezone(dp.timezone, f.captured_at_utc))::int"
UPSERT_STOP_DELAY_SHIFT_DAILY = named_query(
    "rollup.stop_delay_shift_daily.upsert",
    f"""
    INSERT INTO gold.stop_delay_shift_daily (
        provider_id, stop_id, route_id, provider_local_date, shift,
        observation_count, severe_delay_count, sum_delay_seconds, built_at_utc
    )
    SELECT
        b.provider_id,
        b.stop_id,
        b.route_id,
        :local_date,
        b.shift,
        -- in-clamp delay count: the WHERE already filters delay non-null + |delay|<=3600.
        COUNT(*)::integer,
        -- severe = delay > 300 (and <= 3600, already guaranteed by the WHERE clamp).
        COUNT(*) FILTER (WHERE b.delay_seconds > {SEVERE_DELAY_SECONDS})::integer,
        -- pooled in-clamp numerator for the rebaselined avg.
        COALESCE(SUM(b.delay_seconds), 0)::bigint,
        :built_at_utc
    FROM (
        SELECT
            f.provider_id,
            f.delay_stop_id AS stop_id,
            COALESCE(f.route_id, '__unrouted__') AS route_id,
            f.delay_seconds AS delay_seconds,
            -- shift derived ONCE at build time from the provider-localized capture hour, via
            -- the ONE gold.reader.buckets CASE (byte-identical to the route projector's
            -- _SPINE_SHIFT_CASE). Distinct hours in the same shift collapse to one grain row.
{shift_case_sql(_STOP_DELAY_SHIFT_HOUR_SQL, indent=12)} AS shift
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN gold.dim_provider AS dp ON dp.provider_id = f.provider_id
        WHERE f.provider_id = :provider_id
          AND {_CAPTURE_DAY_PREDICATE_SQL}
          AND f.delay_stop_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}  -- GHOST clamp (ghosts + nulls out)
    ) AS b
    GROUP BY b.provider_id, b.stop_id, b.route_id, b.shift
    ON CONFLICT (provider_id, stop_id, route_id, provider_local_date, shift)
    DO UPDATE SET
        observation_count  = EXCLUDED.observation_count,
        severe_delay_count = EXCLUDED.severe_delay_count,
        sum_delay_seconds  = EXCLUDED.sum_delay_seconds,
        built_at_utc       = EXCLUDED.built_at_utc
    """,
)


# Each fact contributes to both trip and vehicle kinds; recurrence counts severe days.
_REPEAT_OFFENDER_DATE_PREDICATE_SQL = f"          AND {_CAPTURE_DAY_PREDICATE_SQL}"
_REPEAT_OFFENDER_GHOST_PREDICATE_SQL = (
    f"          AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}    "
    "-- GHOST clamp (ghosts + nulls out)"
)
UPSERT_REPEAT_OFFENDER_DAILY_SPINE = named_query(
    "rollup.repeat_offender_daily_spine.upsert",
    f"""
    INSERT INTO gold.repeat_offender_daily_spine (
        provider_id, entity_kind, entity_id, route_id, provider_local_date,
        observation_count, severe_delay_count, sum_delay_seconds, built_at_utc
    )
    SELECT
        provider_id, entity_kind, entity_id, route_id, :local_date,
        -- in-clamp delay count: the WHERE already filters delay non-null + |delay|<=3600.
        COUNT(*)::integer,
        -- severe = delay > 300 (and <= 3600, already guaranteed by the WHERE clamp).
        COUNT(*) FILTER (WHERE delay_seconds > {SEVERE_DELAY_SECONDS})::integer,
        -- pooled in-clamp numerator for the rebaselined avg.
        COALESCE(SUM(delay_seconds), 0)::bigint,
        :built_at_utc
    FROM (
        SELECT
            f.provider_id,
            'trip'::text AS entity_kind,
            f.trip_id    AS entity_id,
            f.route_id,
            f.delay_seconds
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
{_REPEAT_OFFENDER_DATE_PREDICATE_SQL}
          AND f.trip_id IS NOT NULL
          AND f.route_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL
{_REPEAT_OFFENDER_GHOST_PREDICATE_SQL}
        UNION ALL
        SELECT
            f.provider_id,
            'vehicle'::text,
            f.vehicle_id,
            f.route_id,
            f.delay_seconds
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
{_REPEAT_OFFENDER_DATE_PREDICATE_SQL}
          AND f.vehicle_id IS NOT NULL
          AND f.route_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL
{_REPEAT_OFFENDER_GHOST_PREDICATE_SQL}
    ) AS e
    GROUP BY provider_id, entity_kind, entity_id, route_id
    ON CONFLICT (provider_id, entity_kind, entity_id, route_id, provider_local_date)
    DO UPDATE SET
        observation_count  = EXCLUDED.observation_count,
        severe_delay_count = EXCLUDED.severe_delay_count,
        sum_delay_seconds  = EXCLUDED.sum_delay_seconds,
        built_at_utc       = EXCLUDED.built_at_utc
    """,
)


REPORTING_AGGREGATE_TABLES = (
    "route_delay_hourly",
    "stop_delay_hourly",
    "repeated_problem_route_stop",
    "citizen_accountability_daily",
    "route_headway_by_shift",
    "repeat_offender",
    "route_headway_by_direction_shift",
)

WINDOWED_HISTORY_TABLES = (
    "route_delay_hourly",
    "stop_delay_hourly",
    "citizen_accountability_daily",
)

DERIVED_REBUILD_TABLES = (
    "repeated_problem_route_stop",
)

ROLLING_WINDOW_TABLES = (
    "route_headway_by_shift",
    "repeat_offender",
    "route_headway_by_direction_shift",
)

DELETE_REPORTING_AGGREGATES = {
    "route_delay_hourly": named_query(
        "rollup.route_delay_hourly.delete",
        f"""
        DELETE FROM gold.route_delay_hourly
        WHERE provider_id = :provider_id
          AND period_start_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
        """,
    ),
    "stop_delay_hourly": named_query(
        "rollup.stop_delay_hourly.delete",
        f"""
        DELETE FROM gold.stop_delay_hourly AS target
        WHERE target.provider_id = :provider_id
          AND target.period_start_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
          AND NOT EXISTS (
              SELECT 1
              FROM stop_delay_hourly_source_summary AS source
              WHERE source.provider_id = target.provider_id
                AND source.period_start_utc = target.period_start_utc
                AND source.stop_id = target.stop_id
                AND source.route_id = target.route_id
          )
        """,
    ),
    "citizen_accountability_daily": named_query(
        "rollup.accountability.delete",
        """
        DELETE FROM gold.citizen_accountability_daily
        WHERE provider_id = :provider_id
          AND provider_local_date >= (
              SELECT (timezone(dp.timezone, CAST(:built_at_utc AS timestamptz)))::date
                     - :open_window_days
              FROM gold.dim_provider AS dp
              WHERE dp.provider_id = :provider_id
          )
        """,
    ),
    **{
        table_name: named_query(
            f"rollup.{table_name}.delete_all",
            f"DELETE FROM gold.{table_name} WHERE provider_id = :provider_id",
        )
        for table_name in (*DERIVED_REBUILD_TABLES, *ROLLING_WINDOW_TABLES)
    },
}

# Keep hourly rows for the public daily view; they include an unrouted bucket absent from the spine.
UPSERT_ROUTE_DELAY_HOURLY = delay_hour_statement(
    "rollup.route_delay_hourly.upsert",
    f"period_start_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}",
)

DROP_STOP_DELAY_HOURLY_SOURCE_SUMMARY = named_query(
    "rollup.stop_delay_hourly.drop_source_summary",
    "DROP TABLE IF EXISTS pg_temp.stop_delay_hourly_source_summary",
)

CREATE_STOP_DELAY_HOURLY_SOURCE_SUMMARY = named_query(
    "rollup.stop_delay_hourly.create_source_summary",
    f"""
    CREATE TEMP TABLE stop_delay_hourly_source_summary ON COMMIT DROP AS
    SELECT
        f.provider_id,
        date_trunc('hour', f.captured_at_utc) AS period_start_utc,
        f.delay_stop_id AS stop_id,
        COALESCE(f.route_id, '__unrouted__') AS route_id,
        COUNT(*)::integer AS observation_count,
        -- delay_seconds is a single trip-update delay; stop consumers coalesce
        -- arrival/departure, so both average columns carry the same value.
        ROUND(AVG(f.delay_seconds::numeric), 2) AS avg_arrival_delay_seconds,
        ROUND(AVG(f.delay_seconds::numeric), 2) AS avg_departure_delay_seconds,
        COUNT(*) FILTER (
            WHERE f.delay_seconds > {SEVERE_DELAY_SECONDS}
              AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
        )::integer AS severe_delay_count,
        :built_at_utc AS built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.delay_stop_id IS NOT NULL
      AND f.delay_seconds IS NOT NULL
      AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
      AND f.captured_at_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
    GROUP BY 1, 2, 3, 4
    """,
)

ANALYZE_STOP_DELAY_HOURLY_SOURCE_SUMMARY = named_query(
    "rollup.stop_delay_hourly.analyze_source_summary",
    "ANALYZE stop_delay_hourly_source_summary",
)

SET_STOP_DELAY_HOURLY_WORK_MEM = named_query(
    "rollup.stop_delay_hourly.work_mem",
    "SET LOCAL work_mem = '384MB'",
)

TRY_STOP_DELAY_HOURLY_LOCK = named_query(
    "rollup.stop_delay_hourly.try_lock",
    """
    SELECT pg_try_advisory_xact_lock(
        hashtext('transit.warm_rollup.stop_delay_hourly'),
        hashtext(:provider_id)
    )
    """,
)

UPSERT_STOP_DELAY_HOURLY = named_query(
    "rollup.stop_delay_hourly.upsert",
    """
    INSERT INTO gold.stop_delay_hourly (
        provider_id,
        period_start_utc,
        stop_id,
        route_id,
        observation_count,
        avg_arrival_delay_seconds,
        avg_departure_delay_seconds,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        provider_id,
        period_start_utc,
        stop_id,
        route_id,
        observation_count,
        avg_arrival_delay_seconds,
        avg_departure_delay_seconds,
        severe_delay_count,
        built_at_utc
    FROM stop_delay_hourly_source_summary
    ON CONFLICT (provider_id, period_start_utc, stop_id, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        avg_arrival_delay_seconds = EXCLUDED.avg_arrival_delay_seconds,
        avg_departure_delay_seconds = EXCLUDED.avg_departure_delay_seconds,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
    WHERE (
        stop_delay_hourly.observation_count,
        stop_delay_hourly.avg_arrival_delay_seconds,
        stop_delay_hourly.avg_departure_delay_seconds,
        stop_delay_hourly.severe_delay_count
    ) IS DISTINCT FROM (
        EXCLUDED.observation_count,
        EXCLUDED.avg_arrival_delay_seconds,
        EXCLUDED.avg_departure_delay_seconds,
        EXCLUDED.severe_delay_count
    )
    """,
)

UPSERT_REPEATED_PROBLEM_ROUTE_STOP = named_query(
    "rollup.repeated_problem.upsert",
    """
    -- Route-grain weekly recurrence derived from the route delay spine (S7-B): the
    -- ISO-week SUM of severe_delay_count is byte-identical to the (dropped)
    -- route_reliability_weekly.severe_delay_count, so issue_count and the
    -- issue_count-driven severity are unchanged. avg_delay_seconds rebaselines to the
    -- ghost-excluded pooled mean (sum_delay_seconds / Σ histogram bins) — it only
    -- influences severity at the 300/600s thresholds for low-severe rows. The spine
    -- filters route_id IS NOT NULL, so the '__unrouted__' sentinel never appears.
    WITH route_week AS (
        SELECT
            sp.provider_id,
            'route'::text AS entity_kind,
            sp.route_id AS entity_id,
            sp.route_id AS route_id,
            'week'::text AS period_grain,
            date_trunc('week', sp.provider_local_date)::date AS period_start_local,
            SUM(sp.severe_delay_count)::integer AS issue_count,
            ROUND(
                SUM(sp.sum_delay_seconds)::numeric
                / NULLIF(SUM((SELECT COALESCE(SUM(x), 0) FROM unnest(sp.delay_histogram) AS x)), 0),
                2
            ) AS avg_delay_seconds
        FROM gold.route_delay_spine AS sp
        WHERE sp.provider_id = :provider_id
        GROUP BY 1, 2, 3, 4, 5, 6
    ),
    -- Stop-grain weekly recurrence derived from the stop delay spine (DB-0067
    -- Phase 1), mirroring route_week above: the ISO-week SUM(severe_delay_count)
    -- per (stop, route, week) is byte-identical to the (dropped) stop_delay_weekly
    -- column, so issue_count + the issue_count-driven severity are unchanged.
    -- avg_delay_seconds rebaselines to the ghost-excluded pooled mean
    -- (SUM(sum_delay_seconds) / SUM(observation_count), where observation_count IS
    -- the in-clamp count) vs the mart's AVG-of-stored-weekly-averages — it only
    -- influences severity at the 300/600s thresholds for low-severe rows. The
    -- spine PK keeps stop_id NOT NULL and COALESCEs route_id to '__unrouted__';
    -- the defensive COALESCEs preserve the sentinel grain byte-for-byte.
    stop_week AS (
        SELECT
            s.provider_id,
            'stop'::text AS entity_kind,
            COALESCE(s.stop_id, '__unknown_stop__') AS entity_id,
            COALESCE(s.route_id, '__unrouted__') AS route_id,
            'week'::text AS period_grain,
            date_trunc('week', s.provider_local_date)::date AS period_start_local,
            SUM(s.severe_delay_count)::integer AS issue_count,
            ROUND(
                SUM(s.sum_delay_seconds)::numeric
                / NULLIF(SUM(s.observation_count), 0),
                2
            ) AS avg_delay_seconds
        FROM gold.stop_delay_spine AS s
        WHERE s.provider_id = :provider_id
        GROUP BY 1, 2, 3, 4, 5, 6
    ),
    problems AS (
        SELECT * FROM route_week
        UNION ALL
        SELECT * FROM stop_week
    )
    INSERT INTO gold.repeated_problem_route_stop (
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        period_grain,
        period_start_local,
        issue_count,
        avg_delay_seconds,
        severity_label,
        built_at_utc
    )
    SELECT
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        period_grain,
        period_start_local,
        issue_count,
        avg_delay_seconds,
        CASE
            WHEN issue_count >= 10 OR avg_delay_seconds > 600 THEN 'critical'
            WHEN issue_count > 0 OR avg_delay_seconds > 300 THEN 'high'
            ELSE 'watch'
        END,
        :built_at_utc
    FROM problems
    WHERE issue_count > 0 OR avg_delay_seconds > 300
    ON CONFLICT (
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        period_grain,
        period_start_local
    ) DO UPDATE SET
        issue_count = EXCLUDED.issue_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severity_label = EXCLUDED.severity_label,
        built_at_utc = EXCLUDED.built_at_utc
    """,
)

UPSERT_CITIZEN_ACCOUNTABILITY_DAILY = named_query(
    "rollup.accountability.upsert",
    """
    WITH cutoff AS (
        SELECT
            (timezone(dp.timezone, CAST(:built_at_utc AS timestamptz)))::date
                - :open_window_days AS min_local_date
        FROM gold.dim_provider AS dp
        WHERE dp.provider_id = :provider_id
    ),
    -- GC1 / Step G1: re-pointed off gold.route_delay_hourly onto the append-only
    -- gold.route_delay_spine (route_delay_hourly is KEPT for public_route_reliability_daily;
    -- GC1.5 owns the drop). The spine stores provider_local_date directly,
    -- so the day grain drops the timezone()::date cast and the window is a local-date
    -- lower bound (built_at's provider-local date - (open_window_days + 2)), matching the
    -- legacy period_start_utc >= built_at - (open_window_days+2 days) intent one day-grain
    -- coarser (harmless: accountability re-grains to the local day anyway).
    --
    -- Parity (all EXACT, no rebaseline):
    --  * delayed_trip_count = SUM(spine.delayed_trip_count) reproduces the legacy
    --    route_delay_hourly SUM byte-for-byte (the spine column mirrors the 5m
    --    SUM-of-per-5m-distinct chain; proven on an adversarial multi-bucket seed).
    --  * severe_delay_count = SUM(severe_delay_count) — identical additive count.
    --  * affected_route_count is EXACT: the legacy condition per hourly bucket was
    --    (avg_delay_seconds > 300 OR severe > 0). The avg branch can NEVER fire without
    --    severe also firing — a pooled/weighted average above 300s requires at least one
    --    in-clamp delay > 300s, which IS a severe observation in that same (route, hour) —
    --    so a route is affected iff it has severe > 0 on the day, a pure additive count.
    --    The route-hour pooled avg (Σ sum_delay_seconds / Σ histogram bins, ROUND 2 to
    --    match the legacy hourly ROUND) is kept in the FILTER for exact-behaviour fidelity;
    --    it selects the identical route set (verified on the seed: zero drift).
    route_hour AS (
        SELECT
            sp.provider_id,
            sp.route_id,
            sp.provider_local_date,
            SUM(sp.severe_delay_count)::integer AS severe_delay_count,
            SUM(sp.delayed_trip_count)::integer AS delayed_trip_count,
            ROUND(
                SUM(sp.sum_delay_seconds)::numeric
                / NULLIF(SUM((SELECT COALESCE(SUM(x), 0)
                             FROM unnest(sp.delay_histogram) AS x)), 0),
                2
            ) AS avg_delay_seconds
        FROM gold.route_delay_spine AS sp
        WHERE sp.provider_id = :provider_id
          AND sp.provider_local_date >= (
              (timezone(
                  (SELECT dp.timezone FROM gold.dim_provider AS dp
                   WHERE dp.provider_id = :provider_id),
                  CAST(:built_at_utc AS timestamptz)
              ))::date - (:open_window_days + 2)
          )
        GROUP BY sp.provider_id, sp.route_id, sp.provider_local_date, sp.hour_of_day_local
    ),
    route_daily AS (
        SELECT
            rh.provider_id,
            rh.provider_local_date,
            COUNT(DISTINCT rh.route_id) FILTER (
                WHERE rh.avg_delay_seconds > 300 OR rh.severe_delay_count > 0
            )::integer AS affected_route_count,
            SUM(rh.delayed_trip_count)::integer AS delayed_trip_count,
            SUM(rh.severe_delay_count)::integer AS severe_delay_count
        FROM route_hour AS rh
        GROUP BY 1, 2
    ),
    stop_daily AS (
        SELECT
            sd.provider_id,
            timezone(dp.timezone, sd.period_start_utc)::date AS provider_local_date,
            COUNT(DISTINCT stop_id) FILTER (
                WHERE COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds) > 300
                   OR sd.severe_delay_count > 0
            )::integer AS affected_stop_count
        FROM gold.stop_delay_hourly AS sd
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = sd.provider_id
        WHERE sd.provider_id = :provider_id
          AND sd.period_start_utc >= (
              CAST(:built_at_utc AS timestamptz)
              - make_interval(days => :open_window_days + 2)
          )
        GROUP BY 1, 2
    ),
    i3_alert_daily AS (
        SELECT
            provider_id,
            provider_local_date,
            COUNT(DISTINCT effective_content_hash)::integer AS alert_count
        FROM gold.i3_alert_history_reporting
        WHERE provider_id = :provider_id
          AND provider_local_date >= (SELECT min_local_date FROM cutoff)
        GROUP BY 1, 2
    ),
    calendar AS (
        SELECT provider_id, provider_local_date FROM route_daily
        UNION
        SELECT provider_id, provider_local_date FROM stop_daily
        UNION
        SELECT provider_id, provider_local_date FROM i3_alert_daily
    )
    INSERT INTO gold.citizen_accountability_daily (
        provider_id,
        provider_local_date,
        affected_route_count,
        affected_stop_count,
        delayed_trip_count,
        severe_delay_count,
        alert_count,
        rider_impact_score,
        built_at_utc
    )
    SELECT
        c.provider_id,
        c.provider_local_date,
        -- Honesty (truth-audit): a LEFT-JOIN miss means "no delay telemetry for
        -- this date", NOT "zero entities affected". Do NOT COALESCE the miss to 0
        -- (that fabricates an honest-looking zero). A present source row already
        -- carries its real integer, including a genuine 0 when telemetry existed
        -- and no entity crossed the threshold; that real 0 is preserved untouched.
        -- affected_route_count / affected_stop_count are int|None in the Receipt
        -- contract, so emitting NULL on a miss is contract-valid honest "no data".
        r.affected_route_count,
        s.affected_stop_count,
        COALESCE(r.delayed_trip_count, 0),
        COALESCE(r.severe_delay_count, 0),
        COALESCE(ia.alert_count, 0),
        -- Honesty (truth-audit): rider_impact_score is a composite of the
        -- delay/severe/route/stop terms. When the delay telemetry feeding it is
        -- absent for the date (neither the route_daily nor the stop_daily source
        -- row exists — the calendar date is present only because alerts arrived),
        -- every reliability term is a join-miss and the score would collapse to
        -- pure alerts*2 while otp/avg/severe publish honest-NULL. That is
        -- internally inconsistent, so we emit NULL (float|None in the contract)
        -- to match the honest-NULL reliability inputs on the same receipt. The
        -- 9999.9999 clamp is unchanged for real days.
        CASE
            WHEN r.provider_local_date IS NULL
                 AND s.provider_local_date IS NULL
            THEN NULL
            ELSE LEAST(
                ROUND(
                    (
                        COALESCE(r.affected_route_count, 0)::numeric * 2
                        + COALESCE(s.affected_stop_count, 0)::numeric
                        + COALESCE(r.delayed_trip_count, 0)::numeric
                        + COALESCE(r.severe_delay_count, 0)::numeric * 3
                        + COALESCE(ia.alert_count, 0)::numeric * 2
                    ),
                    4
                ),
                9999.9999
            )
        END,
        :built_at_utc
    FROM calendar AS c
    LEFT JOIN route_daily AS r
        ON r.provider_id = c.provider_id
       AND r.provider_local_date = c.provider_local_date
    LEFT JOIN stop_daily AS s
        ON s.provider_id = c.provider_id
       AND s.provider_local_date = c.provider_local_date
    LEFT JOIN i3_alert_daily AS ia
        ON ia.provider_id = c.provider_id
       AND ia.provider_local_date = c.provider_local_date
    WHERE c.provider_local_date >= (SELECT min_local_date FROM cutoff)
    """,
)

_TRIP_START_HOUR_EXPR = "EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))"
_TRIP_SHIFT_CASE_WRAPPED = shift_case_sql(_TRIP_START_HOUR_EXPR, indent=12, lead=True, wrap=True)
_TRIP_SHIFT_CASE = shift_case_sql(_TRIP_START_HOUR_EXPR, indent=12, lead=True)
_SERVICE_DAYTYPE_CASE = daytype_case_sql("ts.service_date", indent=12, lead=True)

UPSERT_ROUTE_HEADWAY_DAILY = named_query(
    "rollup.route_headway.upsert",
    f"""
    WITH trip_starts AS (
        -- Observed headway uses trip instances, not pooled vehicle pings:
        -- first in-service realtime observation per trip/service day, weekday
        -- service only, then the busiest direction to match scheduled parity.
        SELECT
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0) AS direction_id,
            COALESCE(f.start_date, f.snapshot_local_date) AS service_date,
            f.trip_id,
            MIN(f.captured_at_utc) AS trip_start_utc
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.captured_at_utc >= now() - make_interval(days => :fact_retention_days)
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= 3600
          AND EXTRACT(ISODOW FROM COALESCE(f.start_date, f.snapshot_local_date)) BETWEEN 1 AND 5
        GROUP BY
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0),
            COALESCE(f.start_date, f.snapshot_local_date),
            f.trip_id
    ),
    busiest_direction AS (
        SELECT
            provider_id,
            route_id,
            direction_id
        FROM (
            SELECT
                provider_id,
                route_id,
                direction_id,
                ROW_NUMBER() OVER (
                    PARTITION BY provider_id, route_id
                    ORDER BY COUNT(*) DESC, direction_id
                ) AS direction_rank
            FROM trip_starts
            GROUP BY provider_id, route_id, direction_id
        ) AS ranked
        WHERE direction_rank = 1
    ),
    shifted AS (
        SELECT
            ts.provider_id,
            ts.route_id,
            ts.direction_id,
            ts.service_date,
            ts.trip_start_utc,
{_TRIP_SHIFT_CASE_WRAPPED} AS shift
        FROM trip_starts AS ts
        INNER JOIN busiest_direction AS bd
            ON bd.provider_id = ts.provider_id
           AND bd.route_id = ts.route_id
           AND bd.direction_id = ts.direction_id
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = ts.provider_id
    ),
    gaps AS (
        SELECT
            provider_id,
            route_id,
            direction_id,
            service_date,
            shift,
            EXTRACT(
                EPOCH FROM (
                    trip_start_utc - LAG(trip_start_utc) OVER (
                        PARTITION BY provider_id, route_id, direction_id, service_date, shift
                        ORDER BY trip_start_utc
                    )
                )
            ) / 60.0 AS gap_min
        FROM shifted
    ),
    -- Single shared sanity filter so the median, CoV, and bunching are all
    -- computed over the IDENTICAL gap sample (no numerator/denominator drift).
    filtered AS (
        SELECT provider_id, route_id, shift, gap_min
        FROM gaps
        WHERE gap_min IS NOT NULL
          AND gap_min > 0
          AND gap_min < 240
    ),
    agg AS (
        SELECT
            provider_id,
            route_id,
            shift,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min) AS med_gap,
            avg(gap_min) AS mean_gap,
            stddev_samp(gap_min) AS sd_gap,
            COUNT(*) AS n
        FROM filtered
        GROUP BY provider_id, route_id, shift
    ),
    -- Bunching = gaps under half the shift median; joins the per-group median
    -- back onto the same filtered gaps (an aggregate can't be referenced inside
    -- another aggregate's FILTER at the same level).
    bunch AS (
        SELECT
            f.provider_id,
            f.route_id,
            f.shift,
            COUNT(*) FILTER (WHERE f.gap_min < 0.5 * a.med_gap) AS bunched_count
        FROM filtered AS f
        JOIN agg AS a USING (provider_id, route_id, shift)
        GROUP BY f.provider_id, f.route_id, f.shift
    )
    INSERT INTO gold.route_headway_by_shift (
        provider_id,
        route_id,
        shift,
        observed_headway_min,
        sample_count,
        headway_cov,
        bunched_count,
        built_at_utc
    )
    SELECT
        a.provider_id,
        a.route_id,
        a.shift,
        ROUND(a.med_gap::numeric, 1),
        a.n::integer,
        -- CoV undefined for a single gap; mean=0 guard avoids div-by-zero.
        CASE WHEN a.n >= 2 AND a.mean_gap > 0
            THEN ROUND((a.sd_gap / a.mean_gap)::numeric, 4)
        END,
        COALESCE(b.bunched_count, 0)::integer,
        :built_at_utc
    FROM agg AS a
    LEFT JOIN bunch AS b USING (provider_id, route_id, shift)
    ON CONFLICT (provider_id, route_id, shift) DO UPDATE SET
        observed_headway_min = EXCLUDED.observed_headway_min,
        sample_count = EXCLUDED.sample_count,
        headway_cov = EXCLUDED.headway_cov,
        bunched_count = EXCLUDED.bunched_count,
        built_at_utc = EXCLUDED.built_at_utc
    """,
)

UPSERT_ROUTE_HEADWAY_DIRECTION_DAILY = named_query(
    "rollup.route_headway_direction.upsert",
    f"""
    WITH trip_starts AS (
        SELECT
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0) AS direction_id,
            COALESCE(f.start_date, f.snapshot_local_date) AS service_date,
            f.trip_id,
            MIN(f.captured_at_utc) AS trip_start_utc
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.captured_at_utc >= now() - make_interval(days => :fact_retention_days)
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= 3600
        GROUP BY
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0),
            COALESCE(f.start_date, f.snapshot_local_date),
            f.trip_id
    ),
    shifted AS (
        SELECT
            ts.provider_id,
            ts.route_id,
            ts.direction_id,
            ts.service_date,
            ts.trip_start_utc,
{_SERVICE_DAYTYPE_CASE} AS service_day_kind,
{_TRIP_SHIFT_CASE_WRAPPED} AS shift
        FROM trip_starts AS ts
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = ts.provider_id
    ),
    gaps AS (
        SELECT
            provider_id,
            route_id,
            direction_id,
            service_day_kind,
            service_date,
            shift,
            EXTRACT(
                EPOCH FROM (
                    trip_start_utc - LAG(trip_start_utc) OVER (
                        PARTITION BY
                            provider_id, route_id, direction_id, service_day_kind,
                            service_date, shift
                        ORDER BY trip_start_utc
                    )
                )
            ) / 60.0 AS gap_min
        FROM shifted
    )
    INSERT INTO gold.route_headway_by_direction_shift (
        provider_id, route_id, direction_id, shift, service_day_kind,
        observed_headway_min, sample_count, built_at_utc
    )
    SELECT
        provider_id,
        route_id,
        direction_id,
        shift,
        service_day_kind,
        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min)::numeric, 1),
        COUNT(*)::integer,
        :built_at_utc
    FROM gaps
    WHERE gap_min IS NOT NULL
      AND gap_min > 0
      AND gap_min < 240
    GROUP BY provider_id, route_id, direction_id, shift, service_day_kind
    ON CONFLICT (provider_id, route_id, direction_id, shift, service_day_kind) DO UPDATE SET
        observed_headway_min = EXCLUDED.observed_headway_min,
        sample_count = EXCLUDED.sample_count,
        built_at_utc = EXCLUDED.built_at_utc
    """,
)

_HEADWAY_HISTOGRAM_BIN_SQL = (
    "            LEAST(GREATEST(width_bucket(gap_min, "
    f"{_HEADWAY_GAP_HIST_EDGES_SQL}), 1), 20) - 1 AS bin_idx"
)
UPSERT_ROUTE_HEADWAY_SHIFT_DAILY = named_query(
    "rollup.route_headway_shift.upsert",
    f"""
    WITH day_starts AS MATERIALIZED (
        -- trip start = first in-service realtime observation per trip/service day.
        SELECT
            f.provider_id,
            f.route_id,
            COALESCE(f.direction_id, 0) AS direction_id,
            COALESCE(f.start_date, f.snapshot_local_date) AS service_date,
            f.trip_id,
            MIN(f.captured_at_utc) AS trip_start_utc,
            BOOL_AND(f.start_date IS NOT NULL) AS explicit_instance
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.snapshot_date_key = :date_key          -- sargable closed day (NOT now()-interval)
          AND f.route_id IS NOT NULL
          AND f.trip_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= 3600
          -- Inner weekday filter on each trip's GTFS SERVICE day (byte-identical to the legacy
          -- route_headway_by_shift builder). Distinct from the outer :local_date guard below:
          -- this drops a weekend-service trip whose facts spilled into a weekday snapshot day
          -- (cross-midnight night service / feed lag), so weekend gaps never pool into a
          -- weekday night-shift row.
          AND EXTRACT(ISODOW FROM COALESCE(f.start_date, f.snapshot_local_date)) BETWEEN 1 AND 5
        GROUP BY
            f.provider_id, f.route_id, COALESCE(f.direction_id, 0),
            COALESCE(f.start_date, f.snapshot_local_date), f.trip_id
    ),
    -- One retained-context reduction, not a history probe per daily candidate.
    retained_starts AS MATERIALIZED (
        SELECT
            f.provider_id, f.route_id, COALESCE(f.direction_id, 0) AS direction_id,
            f.start_date AS service_date, f.trip_id, MIN(f.captured_at_utc) AS trip_start_utc
        FROM gold.fact_trip_delay_snapshot AS f
        WHERE f.provider_id = :provider_id
          AND f.captured_at_utc < (
              SELECT MAX(trip_start_utc) FROM day_starts WHERE explicit_instance
          )
          AND f.start_date IN (SELECT service_date FROM day_starts WHERE explicit_instance)
          AND f.route_id IS NOT NULL AND f.trip_id IS NOT NULL
          AND f.delay_seconds IS NOT NULL AND ABS(f.delay_seconds) <= 3600
        GROUP BY f.provider_id, f.route_id, COALESCE(f.direction_id, 0), f.start_date, f.trip_id
    ),
    trip_starts AS (
        -- Earlier eligible evidence vetoes a phantom start; it never enters today's LAG.
        -- Missing/mixed start_date groups retain the existing, unverified fallback.
        -- No retained witness is not proof of complete context or frequency-trip identity.
        SELECT d.* FROM day_starts AS d
        LEFT JOIN retained_starts AS r
          ON r.provider_id = d.provider_id AND r.route_id = d.route_id
         AND r.direction_id = d.direction_id AND r.service_date = d.service_date
         AND r.trip_id = d.trip_id AND r.trip_start_utc < d.trip_start_utc
        WHERE NOT d.explicit_instance OR r.trip_id IS NULL
    ),
    shifted AS (
        SELECT
            ts.provider_id, ts.route_id, ts.direction_id, ts.service_date, ts.trip_start_utc,
{_TRIP_SHIFT_CASE} AS shift
        FROM trip_starts AS ts
        INNER JOIN gold.dim_provider AS dp ON dp.provider_id = ts.provider_id
    ),
    gaps AS (
        SELECT
            provider_id, route_id, direction_id, shift,
            EXTRACT(EPOCH FROM (
                trip_start_utc - LAG(trip_start_utc) OVER (
                    PARTITION BY provider_id, route_id, direction_id, service_date, shift
                    ORDER BY trip_start_utc)
            )) / 60.0 AS gap_min
        FROM shifted
    ),
    -- ONE shared clamp feeds histogram + moments + bunching (no num/denom drift),
    -- byte-identical to the legacy filtered CTE.
    filtered AS (
        SELECT
            provider_id, route_id, direction_id, shift, gap_min,
{_HEADWAY_HISTOGRAM_BIN_SQL}
        FROM gaps
        WHERE gap_min IS NOT NULL AND gap_min > 0 AND gap_min < 240
    ),
    agg AS MATERIALIZED (
        SELECT
            provider_id, route_id, direction_id, shift,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min) AS med_gap
        FROM filtered
        GROUP BY provider_id, route_id, direction_id, shift
    ),
    -- per-DAY bunched, against the per-day-per-group median (NOT summed across a window).
    bunch AS MATERIALIZED (
        SELECT
            f.provider_id, f.route_id, f.direction_id, f.shift,
            COUNT(*) FILTER (WHERE f.gap_min < 0.5 * a.med_gap) AS bunched_count
        FROM filtered AS f
        JOIN agg AS a USING (provider_id, route_id, direction_id, shift)
        GROUP BY f.provider_id, f.route_id, f.direction_id, f.shift
    ),
    -- raw trip-instance count per grain (pre-gap): the read-time argmax basis (D5).
    trips AS MATERIALIZED (
        SELECT provider_id, route_id, direction_id, shift, COUNT(*) AS trip_n
        FROM shifted
        GROUP BY provider_id, route_id, direction_id, shift
    )
    INSERT INTO gold.route_headway_shift_daily (
        provider_id, route_id, provider_local_date, shift, direction_id,
        gap_count, sum_gap_min, sum_gap_sq_min, bunched_gap_count, trip_count,
        gap_histogram, built_at_utc
    )
    SELECT
        f.provider_id, f.route_id, :local_date, f.shift, f.direction_id,
        COUNT(*)::integer                                AS gap_count,
        COALESCE(SUM(f.gap_min), 0)::numeric             AS sum_gap_min,
        COALESCE(SUM(f.gap_min * f.gap_min), 0)::numeric AS sum_gap_sq_min,
        COALESCE(MAX(b.bunched_count), 0)::integer       AS bunched_gap_count,
        COALESCE(MAX(t.trip_n), 0)::integer              AS trip_count,
        ARRAY[
            COUNT(*) FILTER (WHERE f.bin_idx = 0),  COUNT(*) FILTER (WHERE f.bin_idx = 1),
            COUNT(*) FILTER (WHERE f.bin_idx = 2),  COUNT(*) FILTER (WHERE f.bin_idx = 3),
            COUNT(*) FILTER (WHERE f.bin_idx = 4),  COUNT(*) FILTER (WHERE f.bin_idx = 5),
            COUNT(*) FILTER (WHERE f.bin_idx = 6),  COUNT(*) FILTER (WHERE f.bin_idx = 7),
            COUNT(*) FILTER (WHERE f.bin_idx = 8),  COUNT(*) FILTER (WHERE f.bin_idx = 9),
            COUNT(*) FILTER (WHERE f.bin_idx = 10), COUNT(*) FILTER (WHERE f.bin_idx = 11),
            COUNT(*) FILTER (WHERE f.bin_idx = 12), COUNT(*) FILTER (WHERE f.bin_idx = 13),
            COUNT(*) FILTER (WHERE f.bin_idx = 14), COUNT(*) FILTER (WHERE f.bin_idx = 15),
            COUNT(*) FILTER (WHERE f.bin_idx = 16), COUNT(*) FILTER (WHERE f.bin_idx = 17),
            COUNT(*) FILTER (WHERE f.bin_idx = 18), COUNT(*) FILTER (WHERE f.bin_idx = 19)
        ]::smallint[]                                    AS gap_histogram,
        :built_at_utc
    FROM filtered AS f
    LEFT JOIN bunch  AS b USING (provider_id, route_id, direction_id, shift)
    LEFT JOIN trips  AS t USING (provider_id, route_id, direction_id, shift)
    -- D7 weekend-leak guard: only attribute to a WEEKDAY :local_date.
    WHERE EXTRACT(ISODOW FROM CAST(:local_date AS date)) BETWEEN 1 AND 5
    GROUP BY f.provider_id, f.route_id, f.shift, f.direction_id
    ON CONFLICT (provider_id, route_id, provider_local_date, shift, direction_id) DO UPDATE SET
        gap_count         = EXCLUDED.gap_count,
        sum_gap_min       = EXCLUDED.sum_gap_min,
        sum_gap_sq_min    = EXCLUDED.sum_gap_sq_min,
        bunched_gap_count = EXCLUDED.bunched_gap_count,
        trip_count        = EXCLUDED.trip_count,
        gap_histogram     = EXCLUDED.gap_histogram,
        built_at_utc      = EXCLUDED.built_at_utc
    """,
)

UPSERT_REPEAT_OFFENDER_DAILY = named_query(
    "rollup.repeat_offender.upsert",
    """
    WITH obs AS (
        SELECT
            f.provider_id,
            f.route_id,
            f.trip_id,
            f.vehicle_id,
            f.delay_seconds,
            timezone(dp.timezone, f.captured_at_utc)::date AS local_day
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = f.provider_id
        WHERE f.provider_id = :provider_id
          AND f.captured_at_utc >= now() - make_interval(days => :fact_retention_days)
          AND f.delay_seconds IS NOT NULL
          AND ABS(f.delay_seconds) <= 3600
          AND f.route_id IS NOT NULL
    ),
    agg AS (
        SELECT
            'trip'::text AS entity_kind,
            trip_id AS entity_id,
            route_id,
            provider_id,
            COUNT(DISTINCT local_day) FILTER (WHERE delay_seconds > 300)
                AS recurrence_days,
            ROUND(AVG(delay_seconds)::numeric, 1) AS avg_delay_seconds
        FROM obs
        WHERE trip_id IS NOT NULL
        GROUP BY provider_id, route_id, trip_id
        UNION ALL
        SELECT
            'vehicle'::text,
            vehicle_id,
            route_id,
            provider_id,
            COUNT(DISTINCT local_day) FILTER (WHERE delay_seconds > 300),
            ROUND(AVG(delay_seconds)::numeric, 1)
        FROM obs
        WHERE vehicle_id IS NOT NULL
        GROUP BY provider_id, route_id, vehicle_id
    )
    INSERT INTO gold.repeat_offender (
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        recurrence_days,
        window_days,
        avg_delay_seconds,
        severity_label,
        built_at_utc
    )
    SELECT
        provider_id,
        entity_kind,
        entity_id,
        route_id,
        recurrence_days,
        :fact_retention_days,
        avg_delay_seconds,
        CASE
            WHEN recurrence_days >= 10 OR avg_delay_seconds > 600 THEN 'critical'
            WHEN recurrence_days >= 5 THEN 'high'
            ELSE 'watch'
        END,
        :built_at_utc
    FROM agg
    WHERE recurrence_days >= 3
    ON CONFLICT (provider_id, entity_kind, entity_id, route_id) DO UPDATE SET
        recurrence_days = EXCLUDED.recurrence_days,
        window_days = EXCLUDED.window_days,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severity_label = EXCLUDED.severity_label,
        built_at_utc = EXCLUDED.built_at_utc
    """,
)

REPORTING_AGGREGATE_UPSERTS = {
    "route_delay_hourly": UPSERT_ROUTE_DELAY_HOURLY,
    "stop_delay_hourly": UPSERT_STOP_DELAY_HOURLY,
    "repeated_problem_route_stop": UPSERT_REPEATED_PROBLEM_ROUTE_STOP,
    "citizen_accountability_daily": UPSERT_CITIZEN_ACCOUNTABILITY_DAILY,
    "route_headway_by_shift": UPSERT_ROUTE_HEADWAY_DAILY,
    "repeat_offender": UPSERT_REPEAT_OFFENDER_DAILY,
    "route_headway_by_direction_shift": UPSERT_ROUTE_HEADWAY_DIRECTION_DAILY,
}


@dataclass(frozen=True)
class WarmRollupStageReceipt:
    provider_id: str
    stage: str
    kind: str
    table: str
    duration_seconds: float
    rows: int

    def display_dict(self) -> dict[str, object]:
        return {
            "event": "warm_rollup_stage",
            "provider_id": self.provider_id,
            "stage": self.stage,
            "kind": self.kind,
            "table": self.table,
            "status": "completed",
            "duration_seconds": self.duration_seconds,
            "rows": self.rows,
        }


@dataclass(frozen=True)
class WarmRollupBuildResult:
    provider_id: str
    since_utc: datetime | None
    built_trip_delay_periods: int
    completed_at_utc: datetime
    reporting_aggregate_row_counts: dict[str, int] = field(default_factory=dict)
    refreshed_delay_hours: int = 0
    built_route_percentile_days: int = 0
    built_stop_percentile_days: int = 0
    built_route_scheduled_trips_days: int = 0
    built_route_cancellation_days: int = 0
    built_route_occupancy_days: int = 0
    built_route_occupancy_hourly_days: int = 0
    built_stop_occupancy_days: int = 0
    built_route_service_span_days: int = 0
    built_route_skipped_stop_days: int = 0
    built_route_delay_by_crowding_days: int = 0
    built_route_delay_spine_days: int = 0
    built_route_headway_shift_daily_days: int = 0
    built_stop_delay_spine_days: int = 0
    built_stop_delay_shift_daily_days: int = 0
    built_repeat_offender_daily_spine_days: int = 0
    skipped_not_seeded: bool = False
    completed_stage_receipts: tuple[WarmRollupStageReceipt, ...] = field(default_factory=tuple)
    daily_delay_state: dict[str, object] = field(default_factory=dict)

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "skipped_not_seeded": self.skipped_not_seeded,
            "since_utc": self.since_utc.isoformat() if self.since_utc else None,
            "built_trip_delay_periods": self.built_trip_delay_periods,
            "built_route_percentile_days": self.built_route_percentile_days,
            "built_stop_percentile_days": self.built_stop_percentile_days,
            "built_route_scheduled_trips_days": self.built_route_scheduled_trips_days,
            "built_route_cancellation_days": self.built_route_cancellation_days,
            "built_route_occupancy_days": self.built_route_occupancy_days,
            "built_route_occupancy_hourly_days": self.built_route_occupancy_hourly_days,
            "built_stop_occupancy_days": self.built_stop_occupancy_days,
            "built_route_service_span_days": self.built_route_service_span_days,
            "built_route_skipped_stop_days": self.built_route_skipped_stop_days,
            "built_route_delay_by_crowding_days": self.built_route_delay_by_crowding_days,
            "built_route_delay_spine_days": self.built_route_delay_spine_days,
            "built_route_headway_shift_daily_days": self.built_route_headway_shift_daily_days,
            "built_stop_delay_spine_days": self.built_stop_delay_spine_days,
            "built_stop_delay_shift_daily_days": self.built_stop_delay_shift_daily_days,
            "built_repeat_offender_daily_spine_days": self.built_repeat_offender_daily_spine_days,
            "reporting_aggregate_row_counts": self.reporting_aggregate_row_counts,
            "refreshed_delay_hours": self.refreshed_delay_hours,
            "daily_delay_state": self.daily_delay_state,
            "completed_at_utc": self.completed_at_utc.isoformat(),
            "completed_stage_receipts": [
                receipt.display_dict() for receipt in self.completed_stage_receipts
            ],
        }


def _safe_rowcount(result) -> int:  # noqa: ANN001
    rowcount = getattr(result, "rowcount", 0)
    return max(int(rowcount or 0), 0)


def _run_warm_rollup_stage(
    *,
    provider_id: str,
    stage: str,
    kind: str,
    table: str,
    operation: Callable[[], int],
    progress: PeriodBuildProgress | None = None,
) -> WarmRollupStageReceipt:
    identity: dict[str, object] = {
        "event": "warm_rollup_stage",
        "provider_id": provider_id,
        "stage": stage,
        "kind": kind,
        "table": table,
    }
    logger.info("%s", json.dumps({**identity, "status": "started"}, sort_keys=True))
    started_at = time.perf_counter()
    try:
        rows = operation()
    except Exception:
        duration_seconds = round(time.perf_counter() - started_at, 3)
        error_payload: dict[str, object] = {
            **identity,
            "status": "error",
            "duration_seconds": duration_seconds,
        }
        if progress is not None:
            error_payload["rows"] = progress.committed_rows
        logger.exception(
            "%s",
            json.dumps(error_payload, sort_keys=True),
        )
        raise

    receipt = WarmRollupStageReceipt(
        provider_id=provider_id,
        stage=stage,
        kind=kind,
        table=table,
        duration_seconds=round(time.perf_counter() - started_at, 3),
        rows=rows,
    )
    logger.info("%s", json.dumps(receipt.display_dict(), sort_keys=True))
    return receipt


def _check_retained_capture_day(
    conn, provider_id: str, local_date: date, retention_days: int
) -> tuple[datetime, datetime]:
    start_utc, end_utc = conn.execute(
        _CAPTURE_DAY_BOUNDS, {"provider_id": provider_id, "local_date": local_date}
    ).one()
    cutoff = materialization_time(conn).astimezone(UTC) - timedelta(days=retention_days)
    if start_utc < cutoff:
        raise ValueError(
            f"Capture day {local_date.isoformat()} begins before the UTC fact-retention "
            f"cutoff {cutoff.isoformat()}; its source day is partially retained."
        )
    return start_utc, end_utc


def _write_daily_rollup(
    conn,
    *,
    provider_id: str,
    rollup_kind: str,
    upsert,
    local_date: date,
    date_key: int,
    now: datetime,
    retention_days: int,
) -> None:
    period_start_utc = datetime(local_date.year, local_date.month, local_date.day, tzinfo=UTC)
    # Transaction-local sort memory and disabled nested loops prevent repeated fact scans.
    conn.execute(named_query("rollup.session.work_mem", "SET LOCAL work_mem = '512MB'"))
    conn.execute(named_query("rollup.session.nestloop_off", "SET LOCAL enable_nestloop = off"))
    kind = REBUILDABLE_KINDS.get(rollup_kind)
    if kind is not None and kind.select_missing is SELECT_MISSING_CAPTURE_DAYS:
        _check_retained_capture_day(conn, provider_id, local_date, retention_days)
    conn.execute(
        upsert,
        {
            "provider_id": provider_id,
            "local_date": local_date,
            "date_key": date_key,
            "built_at_utc": now,
        },
    )
    conn.execute(
        UPSERT_WARM_ROLLUP_PERIOD,
        {
            "provider_id": provider_id,
            "rollup_kind": rollup_kind,
            "period_start_utc": period_start_utc,
            "built_at_utc": now,
        },
    )
    if rollup_kind in DAILY_DELAY_TABLES:
        _check_retained_capture_day(conn, provider_id, local_date, retention_days)


def _build_percentile_days(
    engine,  # noqa: ANN001
    *,
    provider_id: str,
    rollup_kind: str,
    upsert,  # noqa: ANN001
    today_key: int,
    floor_key: int,
    now: datetime,
    select_missing=SELECT_MISSING_PERCENTILE_DAYS,  # noqa: ANN001
    available_days=None,  # noqa: ANN001
    built_dates: set[date] | None = None,
    retained_since_utc: datetime | None = None,
    retention_days: int = 14,
) -> int:
    with engine.begin() as conn:
        set_daily_warm_transaction_timeouts(conn)
        if rollup_kind in DAILY_DELAY_TABLES:
            assert_daily_delay_history_clean(
                conn,
                provider_id,
                from_date=datetime.strptime(str(floor_key), "%Y%m%d").date(),
                to_date=datetime.strptime(str(today_key), "%Y%m%d").date() - timedelta(days=1),
                kinds=[rollup_kind],
            )
        if available_days is None:
            rows = conn.execute(
                select_missing,
                {
                    "provider_id": provider_id,
                    "rollup_kind": rollup_kind,
                    "today_key": today_key,
                    "floor_key": floor_key,
                    "retained_since_utc": retained_since_utc,
                },
            ).fetchall()
        else:
            if built_dates is None:
                built_dates = {
                    row.local_date
                    for row in conn.execute(
                        SELECT_BUILT_DAILY_DAYS,
                        {"provider_id": provider_id, "rollup_kind": rollup_kind},
                    ).fetchall()
                }
            rows = [row for row in available_days if row.local_date not in built_dates]
    built = 0
    for row in rows:
        local_date = row.local_date
        with engine.begin() as conn:
            set_daily_warm_transaction_timeouts(conn)
            if rollup_kind in DAILY_DELAY_TABLES:
                lock_delay_day(conn, provider_id, local_date)
                state = delay_day_state(conn, provider_id, rollup_kind, local_date)
                if state == "clean":
                    continue
                if state == "dirty":
                    raise ValueError(
                        f"Daily delay kind {rollup_kind} has a dirty day {local_date}; "
                        "explicit repair requires complete recorded cohorts."
                    )
                # Missing facts cannot authorize an empty first build; explicit repair must prove
                # it.
                present = conn.execute(
                    SELECT_AVAILABLE_CAPTURE_DAYS,
                    {
                        "provider_id": provider_id,
                        "floor_key": row.date_key,
                        "today_key": int((local_date + timedelta(days=1)).strftime("%Y%m%d")),
                    },
                ).first()
                if present is None:
                    continue
            _write_daily_rollup(
                conn,
                provider_id=provider_id,
                rollup_kind=rollup_kind,
                upsert=upsert,
                local_date=local_date,
                date_key=row.date_key,
                now=now,
                retention_days=retention_days,
            )
        built += 1
    return built


@dataclass(frozen=True)
class DailyRollupCalendars:
    """Source dates buffered before five-minute materialization begins."""

    capture: Sequence[Row[tuple[date, int]]]
    feed: Sequence[Row[tuple[date, int]]]
    occupancy: Sequence[Row[tuple[date, int]]]


# Build scheduled trips before cancellation; repairs preserve their registry order.
DAILY_BUILD_ORDER = (
    "route_percentile_daily",
    "stop_percentile_daily",
    "route_scheduled_trips_daily",
    "route_cancellation_daily",
    "route_occupancy_band_daily",
    "route_occupancy_band_hourly",
    "stop_occupancy_band_daily",
    "route_service_span_daily",
    "route_skipped_stop_daily",
    "route_delay_by_crowding_daily",
    "route_delay_spine",
    "route_headway_shift_daily",
    "stop_delay_spine",
    "stop_delay_shift_daily",
    "repeat_offender_daily_spine",
)


def build_daily_rollups(
    engine: Engine,
    provider_id: str,
    *,
    calendars: DailyRollupCalendars,
    today_local: date,
    now: datetime,
    retention_days: int,
) -> dict[str, WarmRollupStageReceipt]:
    calendars_by_source: dict[object, Sequence[Row[tuple[date, int]]]] = {
        SELECT_MISSING_CAPTURE_DAYS: calendars.capture,
        SELECT_MISSING_PERCENTILE_DAYS: calendars.feed,
        SELECT_MISSING_OCCUPANCY_DAYS: calendars.occupancy,
    }
    today_key = int(today_local.strftime("%Y%m%d"))
    floor_key = int((today_local - timedelta(days=retention_days - 1)).strftime("%Y%m%d"))
    built_dates: dict[str, set[date]] = {name: set() for name in DAILY_BUILD_ORDER}
    period_starts = sorted(
        {
            datetime.combine(row.local_date, datetime.min.time(), tzinfo=UTC)
            for calendar in calendars_by_source.values()
            for row in calendar
        }
    )
    if period_starts:
        with engine.begin() as conn:
            set_daily_warm_transaction_timeouts(conn)
            for row in conn.execute(
                SELECT_BUILT_DAILY_CALENDARS,
                {
                    "provider_id": provider_id,
                    "rollup_kinds": list(DAILY_BUILD_ORDER),
                    "period_starts": period_starts,
                },
            ).fetchall():
                built_dates[row.rollup_kind].add(row.local_date)
    receipts: dict[str, WarmRollupStageReceipt] = {}
    for kind_name in DAILY_BUILD_ORDER:
        kind = REBUILDABLE_KINDS[kind_name]
        receipts[kind_name] = _run_warm_rollup_stage(
            provider_id=provider_id,
            stage="append_only_daily",
            kind=kind.rollup_kind,
            table=kind.table,
            operation=lambda kind=kind: _build_percentile_days(
                engine,
                provider_id=provider_id,
                rollup_kind=kind.rollup_kind,
                upsert=kind.upsert,
                today_key=today_key,
                floor_key=floor_key,
                now=now,
                select_missing=kind.select_missing,
                available_days=calendars_by_source[kind.select_missing],
                built_dates=built_dates[kind.rollup_kind],
                retention_days=retention_days,
            ),
        )
    return receipts


def build_warm_rollups(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    since_utc: datetime | None = None,
) -> WarmRollupBuildResult:
    if settings is None:
        settings = get_settings()
    open_window_days = getattr(settings, "GOLD_REPORTING_OPEN_WINDOW_DAYS", 10)
    fact_retention_days = getattr(settings, "GOLD_FACT_RETENTION_DAYS", 14)
    if not (0 < open_window_days < fact_retention_days):
        raise ValueError(
            "GOLD_REPORTING_OPEN_WINDOW_DAYS must be greater than 0 and less than "
            "GOLD_FACT_RETENTION_DAYS"
        )
    if engine is None:
        engine = make_engine(settings)

    with engine.begin() as conn:
        seeded = provider_is_seeded(conn, provider_id)
    if not seeded:
        logger.info(
            "provider %r not seeded (no gold.dim_provider row) — skipping build-warm-rollups",
            provider_id,
        )
        return WarmRollupBuildResult(
            provider_id=provider_id,
            since_utc=since_utc,
            built_trip_delay_periods=0,
            completed_at_utc=utc_now(),
            skipped_not_seeded=True,
        )
    reporting_aggregate_row_counts: dict[str, int] = {}
    completed_stage_receipts: list[WarmRollupStageReceipt] = []
    now = utc_now()

    # Check UTC capture cutoffs as well as local dates near DST retention boundaries.
    percentile_lookback_days = fact_retention_days - 1
    with engine.begin() as conn:
        set_daily_warm_transaction_timeouts(conn)
        today_local = conn.execute(
            _PROVIDER_TODAY_LOCAL_SQL,
            {"provider_id": provider_id},
        ).scalar_one()
    today_key = int(today_local.strftime("%Y%m%d"))
    floor_key = int((today_local - timedelta(days=percentile_lookback_days)).strftime("%Y%m%d"))

    calendar_params = {
        "provider_id": provider_id,
        "today_key": today_key,
        "floor_key": floor_key,
        "retained_since_utc": now - timedelta(days=fact_retention_days),
    }
    with engine.begin() as conn:
        set_daily_warm_transaction_timeouts(conn)
        capture_available_days = conn.execute(
            SELECT_AVAILABLE_CAPTURE_DAYS,
            calendar_params,
        ).fetchall()
        trip_available_days = conn.execute(
            SELECT_AVAILABLE_PERCENTILE_DAYS,
            calendar_params,
        ).fetchall()
        vehicle_available_days = conn.execute(
            SELECT_AVAILABLE_OCCUPANCY_DAYS,
            calendar_params,
        ).fetchall()

    trip_delay_progress = PeriodBuildProgress()
    trip_delay_receipt = _run_warm_rollup_stage(
        provider_id=provider_id,
        stage="trip_delay_5m",
        kind="trip_delay_summary_5m",
        table="trip_delay_summary_5m",
        operation=lambda: build_delay_periods(
            engine,
            provider_id=provider_id,
            since_utc=since_utc,
            now=now,
            progress=trip_delay_progress,
            retention_days=fact_retention_days,
        ),
        progress=trip_delay_progress,
    )
    completed_stage_receipts.append(trip_delay_receipt)
    built_trip_delay = trip_delay_receipt.rows

    daily_receipts = build_daily_rollups(
        engine,
        provider_id,
        calendars=DailyRollupCalendars(
            capture=capture_available_days,
            feed=trip_available_days,
            occupancy=vehicle_available_days,
        ),
        today_local=today_local,
        now=now,
        retention_days=fact_retention_days,
    )
    completed_stage_receipts.extend(daily_receipts.values())

    # Commit each reporting aggregate independently so later failure preserves completed refreshes.
    for table_name in REPORTING_AGGREGATE_TABLES:

        def refresh_reporting_aggregate(table_name: str = table_name) -> int:
            delete_params = {"provider_id": provider_id}
            upsert_params = {
                "provider_id": provider_id,
                "built_at_utc": now,
                "fact_retention_days": fact_retention_days,
            }
            if table_name in WINDOWED_HISTORY_TABLES:
                delete_params = {
                    **delete_params,
                    "built_at_utc": now,
                    "open_window_days": open_window_days,
                }
                upsert_params = {
                    **upsert_params,
                    "open_window_days": open_window_days,
                }
            with engine.begin() as conn:
                set_daily_warm_transaction_timeouts(conn)
                if table_name == "route_delay_hourly":
                    lock_delay_hours(conn, provider_id)
                    built_at = materialization_time(conn)
                    upsert_params["materialized_at_utc"] = built_at
                if table_name == "stop_delay_hourly":
                    conn.execute(SET_STOP_DELAY_HOURLY_WORK_MEM)
                    lock_acquired = conn.execute(
                        TRY_STOP_DELAY_HOURLY_LOCK,
                        {"provider_id": provider_id},
                    ).scalar_one()
                    if not lock_acquired:
                        raise RuntimeError(
                            f"stop_delay_hourly refresh already running for {provider_id!r}"
                        )
                    conn.execute(DROP_STOP_DELAY_HOURLY_SOURCE_SUMMARY)
                    conn.execute(CREATE_STOP_DELAY_HOURLY_SOURCE_SUMMARY, upsert_params)
                    conn.execute(ANALYZE_STOP_DELAY_HOURLY_SOURCE_SUMMARY)
                conn.execute(
                    DELETE_REPORTING_AGGREGATES[table_name],
                    delete_params,
                )
                result = conn.execute(
                    REPORTING_AGGREGATE_UPSERTS[table_name],
                    upsert_params,
                )
                return _safe_rowcount(result)

        receipt = _run_warm_rollup_stage(
            provider_id=provider_id,
            stage="reporting_aggregate",
            kind="reporting_aggregate",
            table=table_name,
            operation=refresh_reporting_aggregate,
        )
        completed_stage_receipts.append(receipt)
        reporting_aggregate_row_counts[table_name] = receipt.rows

    changed_hours = _run_warm_rollup_stage(
        provider_id=provider_id,
        stage="changed_delay_hours",
        kind="changed_delay_hours",
        table="route_delay_hourly",
        operation=lambda: refresh_changed_delay_hours(
            engine, provider_id, now - timedelta(days=fact_retention_days - 1), now
        ),
    )
    completed_stage_receipts.append(changed_hours)

    with engine.begin() as conn:
        set_daily_warm_transaction_timeouts(conn)
        remaining_daily_state = daily_delay_status(conn, provider_id)

    return WarmRollupBuildResult(
        provider_id=provider_id,
        since_utc=since_utc,
        built_trip_delay_periods=built_trip_delay,
        reporting_aggregate_row_counts=reporting_aggregate_row_counts,
        refreshed_delay_hours=changed_hours.rows,
        completed_at_utc=now,
        built_route_percentile_days=daily_receipts["route_percentile_daily"].rows,
        built_stop_percentile_days=daily_receipts["stop_percentile_daily"].rows,
        built_route_scheduled_trips_days=daily_receipts["route_scheduled_trips_daily"].rows,
        built_route_cancellation_days=daily_receipts["route_cancellation_daily"].rows,
        built_route_occupancy_days=daily_receipts["route_occupancy_band_daily"].rows,
        built_route_occupancy_hourly_days=daily_receipts["route_occupancy_band_hourly"].rows,
        built_stop_occupancy_days=daily_receipts["stop_occupancy_band_daily"].rows,
        built_route_service_span_days=daily_receipts["route_service_span_daily"].rows,
        built_route_skipped_stop_days=daily_receipts["route_skipped_stop_daily"].rows,
        built_route_delay_by_crowding_days=daily_receipts["route_delay_by_crowding_daily"].rows,
        built_route_delay_spine_days=daily_receipts["route_delay_spine"].rows,
        built_route_headway_shift_daily_days=daily_receipts["route_headway_shift_daily"].rows,
        built_stop_delay_spine_days=daily_receipts["stop_delay_spine"].rows,
        built_stop_delay_shift_daily_days=daily_receipts["stop_delay_shift_daily"].rows,
        built_repeat_offender_daily_spine_days=daily_receipts["repeat_offender_daily_spine"].rows,
        completed_stage_receipts=tuple(completed_stage_receipts),
        daily_delay_state=remaining_daily_state,
    )


# Rebuild bounds are row dates; service spans use run date = row date + 1.
@dataclass(frozen=True)
class RebuildableKind:
    rollup_kind: str
    table: str
    date_column: str
    upsert: object
    select_missing: object
    service_day_offset: int


REBUILDABLE_KINDS: dict[str, RebuildableKind] = {
    "route_percentile_daily": RebuildableKind(
        "route_percentile_daily",
        "route_delay_percentile_daily",
        "provider_local_date",
        UPSERT_ROUTE_DELAY_PERCENTILE_DAILY,
        SELECT_MISSING_CAPTURE_DAYS,
        0,
    ),
    "stop_percentile_daily": RebuildableKind(
        "stop_percentile_daily",
        "stop_delay_percentile_daily",
        "provider_local_date",
        UPSERT_STOP_DELAY_PERCENTILE_DAILY,
        SELECT_MISSING_CAPTURE_DAYS,
        0,
    ),
    "route_cancellation_daily": RebuildableKind(
        "route_cancellation_daily",
        "route_cancellation_daily",
        "provider_local_date",
        UPSERT_ROUTE_CANCELLATION_DAILY,
        SELECT_MISSING_PERCENTILE_DAYS,
        0,
    ),
    "route_occupancy_band_daily": RebuildableKind(
        "route_occupancy_band_daily",
        "route_occupancy_band_daily",
        "provider_local_date",
        UPSERT_ROUTE_OCCUPANCY_BAND_DAILY,
        SELECT_MISSING_OCCUPANCY_DAYS,
        0,
    ),
    "route_occupancy_band_hourly": RebuildableKind(
        "route_occupancy_band_hourly",
        "route_occupancy_band_hourly",
        "provider_local_date",
        UPSERT_ROUTE_OCCUPANCY_BAND_HOURLY,
        SELECT_MISSING_OCCUPANCY_DAYS,
        0,
    ),
    "stop_occupancy_band_daily": RebuildableKind(
        "stop_occupancy_band_daily",
        "stop_occupancy_band_daily",
        "provider_local_date",
        UPSERT_STOP_OCCUPANCY_BAND_DAILY,
        SELECT_MISSING_OCCUPANCY_DAYS,
        0,
    ),
    "route_service_span_daily": RebuildableKind(
        "route_service_span_daily",
        "route_service_span_daily",
        "provider_local_date",
        UPSERT_ROUTE_SERVICE_SPAN_DAILY,
        SELECT_MISSING_PERCENTILE_DAYS,
        1,
    ),
    "route_skipped_stop_daily": RebuildableKind(
        "route_skipped_stop_daily",
        "route_skipped_stop_daily",
        "provider_local_date",
        UPSERT_ROUTE_SKIPPED_STOP_DAILY,
        SELECT_MISSING_PERCENTILE_DAYS,
        0,
    ),
    "route_delay_by_crowding_daily": RebuildableKind(
        "route_delay_by_crowding_daily",
        "route_delay_by_crowding_daily",
        "provider_local_date",
        UPSERT_ROUTE_DELAY_BY_CROWDING_DAILY,
        SELECT_MISSING_CAPTURE_DAYS,
        0,
    ),
    "route_delay_spine": RebuildableKind(
        "route_delay_spine",
        "route_delay_spine",
        "provider_local_date",
        UPSERT_ROUTE_DELAY_SPINE,
        SELECT_MISSING_CAPTURE_DAYS,
        0,
    ),
    "route_headway_shift_daily": RebuildableKind(
        "route_headway_shift_daily",
        "route_headway_shift_daily",
        "provider_local_date",
        UPSERT_ROUTE_HEADWAY_SHIFT_DAILY,
        SELECT_MISSING_PERCENTILE_DAYS,
        0,
    ),
    "stop_delay_spine": RebuildableKind(
        "stop_delay_spine",
        "stop_delay_spine",
        "provider_local_date",
        UPSERT_STOP_DELAY_SPINE,
        SELECT_MISSING_CAPTURE_DAYS,
        0,
    ),
    "stop_delay_shift_daily": RebuildableKind(
        "stop_delay_shift_daily",
        "stop_delay_shift_daily",
        "provider_local_date",
        UPSERT_STOP_DELAY_SHIFT_DAILY,
        SELECT_MISSING_CAPTURE_DAYS,
        0,
    ),
    "route_scheduled_trips_daily": RebuildableKind(
        "route_scheduled_trips_daily",
        "route_scheduled_trips_daily",
        "provider_local_date",
        UPSERT_ROUTE_SCHEDULED_TRIPS_DAILY,
        SELECT_MISSING_PERCENTILE_DAYS,
        0,
    ),
    "repeat_offender_daily_spine": RebuildableKind(
        "repeat_offender_daily_spine",
        "repeat_offender_daily_spine",
        "provider_local_date",
        UPSERT_REPEAT_OFFENDER_DAILY_SPINE,
        SELECT_MISSING_CAPTURE_DAYS,
        0,
    ),
}

_NON_REBUILDABLE_KINDS: dict[str, str] = {
    "trip_delay_summary_5m": (
        "trip_delay_summary_5m is a 5-minute grain, not a closed-day rollup; "
        "rebuild it with build-warm-rollups."
    ),
    **{
        table_name: (
            f"{table_name} is a full DELETE+UPSERT reporting mart refreshed every "
            "build-warm-rollups run; re-run build-warm-rollups to refresh it."
        )
        for table_name in REPORTING_AGGREGATE_TABLES
    },
}


def _rebuild_row_delete_sql(kind: RebuildableKind, *, dry_run: bool) -> object:
    # Table/date identifiers come from the trusted registry; bind date bounds.
    operation = "SELECT COUNT(*) FROM" if dry_run else "DELETE FROM"
    verb = "count" if dry_run else "delete"
    return named_query(
        f"rollup.rebuild_row.{kind.table}.{verb}",
        f"""
        {operation} gold.{kind.table}
        WHERE provider_id = :provider_id
          AND {kind.date_column} >= :from_date
          AND {kind.date_column} <= :to_date
        """,
    )


_PROVIDER_TODAY_LOCAL_SQL = named_query(
    "rollup.provider.today_local",
    "SELECT (now() AT TIME ZONE dp.timezone)::date "
    "FROM gold.dim_provider AS dp WHERE dp.provider_id = :provider_id",
)

_REBUILD_WATERMARK_DELETE = named_query(
    "rollup.rebuild_watermark.delete",
    """
    DELETE FROM gold.warm_rollup_periods
    WHERE provider_id = :provider_id
      AND rollup_kind = :rollup_kind
      AND period_start_utc >= :from_utc
      AND period_start_utc <= :to_utc
    """,
)

_REBUILD_WATERMARK_COUNT = named_query(
    "rollup.rebuild_watermark.count",
    """
    SELECT COUNT(*) FROM gold.warm_rollup_periods
    WHERE provider_id = :provider_id
      AND rollup_kind = :rollup_kind
      AND period_start_utc >= :from_utc
      AND period_start_utc <= :to_utc
    """,
)


@dataclass(frozen=True)
class WarmRollupRebuildResult:
    provider_id: str
    from_date: date
    to_date: date
    dry_run: bool
    aborted: bool
    completed_at_utc: datetime
    deleted_row_counts: dict[str, int] = field(default_factory=dict)
    deleted_watermark_counts: dict[str, int] = field(default_factory=dict)
    rebuilt_day_counts: dict[str, int] = field(default_factory=dict)

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "from_date": self.from_date.isoformat(),
            "to_date": self.to_date.isoformat(),
            "dry_run": self.dry_run,
            "aborted": self.aborted,
            "deleted_row_counts": self.deleted_row_counts,
            "deleted_watermark_counts": self.deleted_watermark_counts,
            "rebuilt_day_counts": self.rebuilt_day_counts,
            "completed_at_utc": self.completed_at_utc.isoformat(),
        }


def _resolve_rebuild_kinds(kinds: list[str] | None) -> list[RebuildableKind]:
    if kinds is None:
        return list(REBUILDABLE_KINDS.values())
    resolved: list[RebuildableKind] = []
    for raw in kinds:
        name = raw.strip()
        if name in REBUILDABLE_KINDS:
            resolved.append(REBUILDABLE_KINDS[name])
        elif name in _NON_REBUILDABLE_KINDS:
            raise ValueError(_NON_REBUILDABLE_KINDS[name])
        else:
            raise ValueError(
                f"Unknown rebuildable kind {name!r}. Valid kinds: "
                f"{', '.join(sorted(REBUILDABLE_KINDS))}"
            )
    return resolved


def rebuild_warm_rollups(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    from_date: date,
    to_date: date,
    kinds: list[str] | None = None,
    dry_run: bool = False,
    confirm: Callable[[WarmRollupRebuildResult], bool] | None = None,
) -> WarmRollupRebuildResult:
    if settings is None:
        settings = get_settings()
    if from_date > to_date:
        raise ValueError("--from must be on or before --to")
    fact_retention_days = getattr(settings, "GOLD_FACT_RETENTION_DAYS", 14)
    if engine is None:
        engine = make_engine(settings)

    target_kinds = _resolve_rebuild_kinds(kinds)
    now = utc_now()

    with engine.begin() as conn:
        set_daily_warm_transaction_timeouts(conn)
        today_local = conn.execute(
            _PROVIDER_TODAY_LOCAL_SQL,
            {"provider_id": provider_id},
        ).scalar_one()
    floor_local = today_local - timedelta(days=fact_retention_days - 1)
    if from_date < floor_local:
        raise ValueError(
            f"--from {from_date.isoformat()} is older than the fact-retention floor "
            f"{floor_local.isoformat()} (GOLD_FACT_RETENTION_DAYS={fact_retention_days}); "
            "the underlying facts are already pruned, so those days would rebuild EMPTY."
        )
    retained_since_utc = now - timedelta(days=fact_retention_days)
    if any(kind.select_missing is SELECT_MISSING_CAPTURE_DAYS for kind in target_kinds):
        with engine.begin() as conn:
            set_daily_warm_transaction_timeouts(conn)
            _check_retained_capture_day(conn, provider_id, from_date, fact_retention_days)
    # Open-day guards apply to run dates, including service-day offsets.
    for kind in target_kinds:
        max_to = today_local - timedelta(days=kind.service_day_offset + 1)
        if to_date > max_to:
            raise ValueError(
                f"--to {to_date.isoformat()} is too recent for kind "
                f"{kind.rollup_kind!r} (service_day_offset={kind.service_day_offset}): "
                f"its run date would land on or after today ({today_local.isoformat()}) "
                f"and rebuild the still-open capture day. Max legal --to for this kind "
                f"is {max_to.isoformat()}."
            )

    if dry_run:
        deleted_rows, deleted_watermarks = _count_rebuild_window(
            engine,
            provider_id=provider_id,
            from_date=from_date,
            to_date=to_date,
            target_kinds=target_kinds,
        )
        return WarmRollupRebuildResult(
            provider_id=provider_id,
            from_date=from_date,
            to_date=to_date,
            dry_run=True,
            aborted=False,
            completed_at_utc=now,
            deleted_row_counts=deleted_rows,
            deleted_watermark_counts=deleted_watermarks,
        )

    # Preview counts precede confirmation; confirm=None skips both.
    plan_rows: dict[str, int] = {}
    plan_watermarks: dict[str, int] = {}
    if confirm is not None:
        plan_rows, plan_watermarks = _count_rebuild_window(
            engine,
            provider_id=provider_id,
            from_date=from_date,
            to_date=to_date,
            target_kinds=target_kinds,
        )
    plan = WarmRollupRebuildResult(
        provider_id=provider_id,
        from_date=from_date,
        to_date=to_date,
        dry_run=False,
        aborted=False,
        completed_at_utc=now,
        deleted_row_counts=plan_rows,
        deleted_watermark_counts=plan_watermarks,
    )
    if confirm is not None and not confirm(plan):
        return WarmRollupRebuildResult(
            provider_id=provider_id,
            from_date=from_date,
            to_date=to_date,
            dry_run=False,
            aborted=True,
            completed_at_utc=utc_now(),
        )

    deleted_rows = {}
    deleted_watermarks = {}
    rebuilt_days: dict[str, int] = {}
    capture_kinds = [kind for kind in target_kinds if kind.rollup_kind in DAILY_DELAY_TABLES]
    for kind in capture_kinds:
        deleted_rows[kind.rollup_kind] = 0
        deleted_watermarks[kind.rollup_kind] = 0
        rebuilt_days[kind.rollup_kind] = 0
    for offset in range((to_date - from_date).days + 1) if capture_kinds else ():
        local_date = from_date + timedelta(days=offset)
        day_rows, day_watermarks = {}, {}
        with engine.begin() as conn:
            set_daily_warm_transaction_timeouts(conn)
            lock_delay_day(conn, provider_id, local_date)
            start_utc, end_utc = _check_retained_capture_day(
                conn, provider_id, local_date, fact_retention_days
            )
            if not delay_window_is_complete(conn, provider_id, start_utc, end_utc):
                raise ValueError(
                    f"Capture day {local_date} lacks a complete recorded trip-update cohort; "
                    "preserving daily rows and dirty evidence."
                )
            _check_retained_capture_day(conn, provider_id, local_date, fact_retention_days)
            for kind in capture_kinds:
                from_utc, to_utc = _rebuild_watermark_window(local_date, local_date, kind)
                day_rows[kind.rollup_kind] = _safe_rowcount(
                    conn.execute(
                        _rebuild_row_delete_sql(kind, dry_run=False),
                        {
                            "provider_id": provider_id,
                            "from_date": local_date,
                            "to_date": local_date,
                        },
                    )
                )
                day_watermarks[kind.rollup_kind] = _safe_rowcount(
                    conn.execute(
                        _REBUILD_WATERMARK_DELETE,
                        {
                            "provider_id": provider_id,
                            "rollup_kind": kind.rollup_kind,
                            "from_utc": from_utc,
                            "to_utc": to_utc,
                        },
                    )
                )
                _write_daily_rollup(
                    conn,
                    provider_id=provider_id,
                    rollup_kind=kind.rollup_kind,
                    upsert=kind.upsert,
                    local_date=local_date,
                    date_key=int(local_date.strftime("%Y%m%d")),
                    now=now,
                    retention_days=fact_retention_days,
                )
        for kind in capture_kinds:
            deleted_rows[kind.rollup_kind] += day_rows[kind.rollup_kind]
            deleted_watermarks[kind.rollup_kind] += day_watermarks[kind.rollup_kind]
            rebuilt_days[kind.rollup_kind] += 1

    for kind in target_kinds:
        if kind.rollup_kind in DAILY_DELAY_TABLES:
            continue
        from_utc, to_utc = _rebuild_watermark_window(from_date, to_date, kind)
        with engine.begin() as conn:
            set_daily_warm_transaction_timeouts(conn)
            deleted_rows[kind.rollup_kind] = _safe_rowcount(
                conn.execute(
                    _rebuild_row_delete_sql(kind, dry_run=False),
                    {
                        "provider_id": provider_id,
                        "from_date": from_date,
                        "to_date": to_date,
                    },
                )
            )
            deleted_watermarks[kind.rollup_kind] = _safe_rowcount(
                conn.execute(
                    _REBUILD_WATERMARK_DELETE,
                    {
                        "provider_id": provider_id,
                        "rollup_kind": kind.rollup_kind,
                        "from_utc": from_utc,
                        "to_utc": to_utc,
                    },
                )
            )
        run_from = from_date + timedelta(days=kind.service_day_offset)
        run_to = to_date + timedelta(days=kind.service_day_offset)
        rebuilt_days[kind.rollup_kind] = _build_percentile_days(
            engine,
            provider_id=provider_id,
            rollup_kind=kind.rollup_kind,
            upsert=kind.upsert,
            today_key=int((run_to + timedelta(days=1)).strftime("%Y%m%d")),
            floor_key=int(run_from.strftime("%Y%m%d")),
            now=now,
            select_missing=kind.select_missing,
            retained_since_utc=retained_since_utc,
            retention_days=fact_retention_days,
        )

    return WarmRollupRebuildResult(
        provider_id=provider_id,
        from_date=from_date,
        to_date=to_date,
        dry_run=False,
        aborted=False,
        completed_at_utc=now,
        deleted_row_counts=deleted_rows,
        deleted_watermark_counts=deleted_watermarks,
        rebuilt_day_counts=rebuilt_days,
    )


def _rebuild_watermark_window(
    from_date: date, to_date: date, kind: RebuildableKind
) -> tuple[datetime, datetime]:
    # Watermarks use midnight UTC of the run date, including the service-day offset.
    run_from = from_date + timedelta(days=kind.service_day_offset)
    run_to = to_date + timedelta(days=kind.service_day_offset)
    from_utc = datetime(run_from.year, run_from.month, run_from.day, tzinfo=UTC)
    to_utc = datetime(run_to.year, run_to.month, run_to.day, tzinfo=UTC)
    return from_utc, to_utc


def _count_rebuild_window(
    engine: Engine,
    *,
    provider_id: str,
    from_date: date,
    to_date: date,
    target_kinds: list[RebuildableKind],
) -> tuple[dict[str, int], dict[str, int]]:
    deleted_rows: dict[str, int] = {}
    deleted_watermarks: dict[str, int] = {}
    with engine.begin() as conn:
        set_daily_warm_transaction_timeouts(conn)
        for kind in target_kinds:
            from_utc, to_utc = _rebuild_watermark_window(from_date, to_date, kind)
            deleted_rows[kind.rollup_kind] = _safe_scalar(
                conn.execute(
                    _rebuild_row_delete_sql(kind, dry_run=True),
                    {
                        "provider_id": provider_id,
                        "from_date": from_date,
                        "to_date": to_date,
                    },
                )
            )
            deleted_watermarks[kind.rollup_kind] = _safe_scalar(
                conn.execute(
                    _REBUILD_WATERMARK_COUNT,
                    {
                        "provider_id": provider_id,
                        "rollup_kind": kind.rollup_kind,
                        "from_utc": from_utc,
                        "to_utc": to_utc,
                    },
                )
            )
    return deleted_rows, deleted_watermarks


def _safe_scalar(result) -> int:  # noqa: ANN001
    value = result.scalar_one()
    return max(int(value or 0), 0)
