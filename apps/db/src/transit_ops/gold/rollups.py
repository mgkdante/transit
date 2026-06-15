from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings

SEVERE_DELAY_SECONDS = 300
GHOST_DELAY_ABS_SECONDS = 3600
OPEN_WINDOW_HOURLY_CUTOFF_SQL = (
    "date_trunc('hour', CAST(:built_at_utc AS timestamptz)) "
    "- make_interval(days => :open_window_days)"
)

# ---------------------------------------------------------------------------
# SQL — missing period detection
# ---------------------------------------------------------------------------

SELECT_MISSING_VEHICLE_PERIODS = text(
    """
    SELECT DISTINCT
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') AS period_start_utc
    FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
      AND (
          CAST(:since_utc AS timestamptz) IS NULL
          OR captured_at_utc >= CAST(:since_utc AS timestamptz)
      )
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
      AND (
          CAST(:since_utc AS timestamptz) IS NULL
          OR captured_at_utc >= CAST(:since_utc AS timestamptz)
      )
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
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
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

REPORTING_AGGREGATE_TABLES = (
    "route_delay_hourly",
    "route_delay_day_of_week",
    "stop_delay_hourly",
    "route_reliability_weekly",
    "route_reliability_monthly",
    "stop_delay_weekly",
    "stop_delay_monthly",
    "route_habit_score",
    "repeated_problem_route_stop",
    "citizen_accountability_daily",
    "route_headway_daily",
    "repeat_offender_daily",
)

WINDOWED_HISTORY_TABLES = (
    "route_delay_hourly",
    "stop_delay_hourly",
    "citizen_accountability_daily",
)

DERIVED_REBUILD_TABLES = (
    "route_delay_day_of_week",
    "route_reliability_weekly",
    "route_reliability_monthly",
    "stop_delay_weekly",
    "stop_delay_monthly",
    "route_habit_score",
    "repeated_problem_route_stop",
)

ROLLING_WINDOW_TABLES = (
    "route_headway_daily",
    "repeat_offender_daily",
)

DELETE_REPORTING_AGGREGATES = {
    "route_delay_hourly": text(
        f"""
        DELETE FROM gold.route_delay_hourly
        WHERE provider_id = :provider_id
          AND period_start_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
        """
    ),
    "stop_delay_hourly": text(
        f"""
        DELETE FROM gold.stop_delay_hourly
        WHERE provider_id = :provider_id
          AND period_start_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
        """
    ),
    "citizen_accountability_daily": text(
        """
        DELETE FROM gold.citizen_accountability_daily
        WHERE provider_id = :provider_id
          AND provider_local_date >= (
              SELECT (timezone(dp.timezone, CAST(:built_at_utc AS timestamptz)))::date
                     - :open_window_days
              FROM gold.dim_provider AS dp
              WHERE dp.provider_id = :provider_id
          )
        """
    ),
    **{
        table_name: text(f"DELETE FROM gold.{table_name} WHERE provider_id = :provider_id")
        for table_name in (*DERIVED_REBUILD_TABLES, *ROLLING_WINDOW_TABLES)
    },
}

UPSERT_ROUTE_DELAY_HOURLY = text(
    f"""
    WITH summary AS (
        SELECT
            provider_id,
            date_trunc('hour', period_start_utc) AS period_start_utc,
            COALESCE(route_id, '__unrouted__') AS route_id,
            SUM(trip_count)::integer AS trip_count,
            SUM(observation_count)::integer AS observation_count,
            SUM(delay_observation_count)::integer AS delay_observation_count,
            SUM(severe_delay_observation_count)::integer AS severe_delay_count,
            -- A NULL in any contributing 5m bucket means pre-fix history is unknowable.
            CASE WHEN COUNT(*) = COUNT(on_time_observation_count)
                THEN SUM(on_time_observation_count)::integer
            END AS on_time_observation_count,
            ROUND(
                SUM(avg_delay_seconds_capped * NULLIF(delay_observation_count - outlier_count, 0))
                / NULLIF(SUM(delay_observation_count - outlier_count), 0),
                2
            ) AS avg_delay_seconds,
            MAX(max_delay_seconds_capped) AS max_delay_seconds,
            SUM(delayed_trip_count)::integer AS delayed_trip_count
        FROM gold.trip_delay_summary_5m
        WHERE provider_id = :provider_id
          AND period_start_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
        GROUP BY 1, 2, 3
    )
    INSERT INTO gold.route_delay_hourly (
        provider_id,
        period_start_utc,
        route_id,
        trip_count,
        observation_count,
        delay_observation_count,
        on_time_observation_count,
        avg_delay_seconds,
        max_delay_seconds,
        delayed_trip_count,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        s.provider_id,
        s.period_start_utc,
        s.route_id,
        s.trip_count,
        s.observation_count,
        s.delay_observation_count,
        s.on_time_observation_count,
        s.avg_delay_seconds,
        s.max_delay_seconds,
        s.delayed_trip_count,
        s.severe_delay_count,
        :built_at_utc
    FROM summary AS s
    """
)

UPSERT_ROUTE_DELAY_DAY_OF_WEEK = text(
    """
    INSERT INTO gold.route_delay_day_of_week (
        provider_id,
        day_of_week_iso,
        route_id,
        trip_count,
        observation_count,
        avg_delay_seconds,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        rd.provider_id,
        EXTRACT(ISODOW FROM timezone(dp.timezone, rd.period_start_utc))::integer,
        rd.route_id,
        -- Hourly-distinct-trip sum: upper-bound proxy, not distinct trips per weekday.
        SUM(rd.trip_count)::integer,
        SUM(rd.observation_count)::integer,
        ROUND(
            SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))
            / NULLIF(SUM(rd.delay_observation_count), 0),
            2
        ),
        SUM(rd.severe_delay_count)::integer,
        :built_at_utc
    FROM gold.route_delay_hourly AS rd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = rd.provider_id
    WHERE rd.provider_id = :provider_id
    GROUP BY 1, 2, 3
    ON CONFLICT (provider_id, day_of_week_iso, route_id) DO UPDATE SET
        trip_count = EXCLUDED.trip_count,
        observation_count = EXCLUDED.observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_STOP_DELAY_HOURLY = text(
    f"""
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
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.delay_stop_id IS NOT NULL
      AND f.delay_seconds IS NOT NULL
      AND ABS(f.delay_seconds) <= {GHOST_DELAY_ABS_SECONDS}
      AND f.captured_at_utc >= {OPEN_WINDOW_HOURLY_CUTOFF_SQL}
    GROUP BY 1, 2, 3, 4
    """
)

UPSERT_ROUTE_RELIABILITY_WEEKLY = text(
    """
    INSERT INTO gold.route_reliability_weekly (
        provider_id,
        week_start_local,
        route_id,
        observation_count,
        delay_observation_count,
        on_time_observation_count,
        avg_delay_seconds,
        delayed_trip_count,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        rd.provider_id,
        date_trunc('week', timezone(dp.timezone, rd.period_start_utc))::date,
        rd.route_id,
        SUM(rd.observation_count)::integer,
        SUM(rd.delay_observation_count)::integer,
        -- A NULL in any contributing hour means pre-fix history is unknowable.
        CASE WHEN COUNT(*) = COUNT(rd.on_time_observation_count)
            THEN SUM(rd.on_time_observation_count)::integer
        END,
        ROUND(
            SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))
            / NULLIF(SUM(rd.delay_observation_count), 0),
            2
        ),
        SUM(rd.delayed_trip_count)::integer,
        SUM(rd.severe_delay_count)::integer,
        :built_at_utc
    FROM gold.route_delay_hourly AS rd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = rd.provider_id
    WHERE rd.provider_id = :provider_id
    GROUP BY 1, 2, 3
    ON CONFLICT (provider_id, week_start_local, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        delay_observation_count = EXCLUDED.delay_observation_count,
        on_time_observation_count = EXCLUDED.on_time_observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        delayed_trip_count = EXCLUDED.delayed_trip_count,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_ROUTE_RELIABILITY_MONTHLY = text(
    """
    INSERT INTO gold.route_reliability_monthly (
        provider_id,
        month_start_local,
        route_id,
        observation_count,
        delay_observation_count,
        on_time_observation_count,
        avg_delay_seconds,
        delayed_trip_count,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        rd.provider_id,
        date_trunc('month', timezone(dp.timezone, rd.period_start_utc))::date,
        rd.route_id,
        SUM(rd.observation_count)::integer,
        SUM(rd.delay_observation_count)::integer,
        -- A NULL in any contributing hour means pre-fix history is unknowable.
        CASE WHEN COUNT(*) = COUNT(rd.on_time_observation_count)
            THEN SUM(rd.on_time_observation_count)::integer
        END,
        ROUND(
            SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))
            / NULLIF(SUM(rd.delay_observation_count), 0),
            2
        ),
        SUM(rd.delayed_trip_count)::integer,
        SUM(rd.severe_delay_count)::integer,
        :built_at_utc
    FROM gold.route_delay_hourly AS rd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = rd.provider_id
    WHERE rd.provider_id = :provider_id
    GROUP BY 1, 2, 3
    ON CONFLICT (provider_id, month_start_local, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        delay_observation_count = EXCLUDED.delay_observation_count,
        on_time_observation_count = EXCLUDED.on_time_observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        delayed_trip_count = EXCLUDED.delayed_trip_count,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_STOP_DELAY_WEEKLY = text(
    """
    INSERT INTO gold.stop_delay_weekly (
        provider_id,
        week_start_local,
        stop_id,
        route_id,
        observation_count,
        avg_delay_seconds,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        sd.provider_id,
        date_trunc('week', timezone(dp.timezone, sd.period_start_utc))::date,
        sd.stop_id,
        sd.route_id,
        SUM(sd.observation_count)::integer,
        ROUND(
            SUM(COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
                * NULLIF(sd.observation_count, 0))
            / NULLIF(SUM(sd.observation_count), 0),
            2
        ),
        SUM(sd.severe_delay_count)::integer,
        :built_at_utc
    FROM gold.stop_delay_hourly AS sd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = sd.provider_id
    WHERE sd.provider_id = :provider_id
    GROUP BY 1, 2, 3, 4
    ON CONFLICT (provider_id, week_start_local, stop_id, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_STOP_DELAY_MONTHLY = text(
    """
    INSERT INTO gold.stop_delay_monthly (
        provider_id,
        month_start_local,
        stop_id,
        route_id,
        observation_count,
        avg_delay_seconds,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        sd.provider_id,
        date_trunc('month', timezone(dp.timezone, sd.period_start_utc))::date,
        sd.stop_id,
        sd.route_id,
        SUM(sd.observation_count)::integer,
        ROUND(
            SUM(COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
                * NULLIF(sd.observation_count, 0))
            / NULLIF(SUM(sd.observation_count), 0),
            2
        ),
        SUM(sd.severe_delay_count)::integer,
        :built_at_utc
    FROM gold.stop_delay_hourly AS sd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = sd.provider_id
    WHERE sd.provider_id = :provider_id
    GROUP BY 1, 2, 3, 4
    ON CONFLICT (provider_id, month_start_local, stop_id, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_ROUTE_HABIT_SCORE = text(
    """
    WITH habit AS (
        SELECT
            rd.provider_id,
            rd.route_id,
            EXTRACT(ISODOW FROM timezone(dp.timezone, rd.period_start_utc))::integer
                AS day_of_week_iso,
            EXTRACT(HOUR FROM timezone(dp.timezone, rd.period_start_utc))::integer
                AS hour_of_day_local,
            SUM(rd.observation_count)::integer AS observation_count,
            ROUND(
                SUM(rd.avg_delay_seconds * NULLIF(rd.observation_count, 0))
                / NULLIF(SUM(rd.observation_count), 0),
                2
            ) AS avg_delay_seconds,
            SUM(rd.severe_delay_count)::integer AS severe_delay_count
        FROM gold.route_delay_hourly AS rd
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = rd.provider_id
        WHERE rd.provider_id = :provider_id
        GROUP BY 1, 2, 3, 4
    )
    INSERT INTO gold.route_habit_score (
        provider_id,
        route_id,
        day_of_week_iso,
        hour_of_day_local,
        observation_count,
        avg_delay_seconds,
        severe_delay_count,
        repeat_problem_score,
        built_at_utc
    )
    SELECT
        provider_id,
        route_id,
        day_of_week_iso,
        hour_of_day_local,
        observation_count,
        avg_delay_seconds,
        severe_delay_count,
        LEAST(
            ROUND(
                (
                    severe_delay_count::numeric * 10
                    + GREATEST(COALESCE(avg_delay_seconds, 0), 0) / 60
                ),
                4
            ),
            9999.9999
        ),
        :built_at_utc
    FROM habit
    ON CONFLICT (provider_id, route_id, day_of_week_iso, hour_of_day_local) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        severe_delay_count = EXCLUDED.severe_delay_count,
        repeat_problem_score = EXCLUDED.repeat_problem_score,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_REPEATED_PROBLEM_ROUTE_STOP = text(
    """
    WITH route_week AS (
        SELECT
            r.provider_id,
            'route'::text AS entity_kind,
            COALESCE(r.route_id, '__unrouted__') AS entity_id,
            COALESCE(r.route_id, '__unrouted__') AS route_id,
            'week'::text AS period_grain,
            r.week_start_local AS period_start_local,
            SUM(r.severe_delay_count)::integer AS issue_count,
            ROUND(AVG(r.avg_delay_seconds)::numeric, 2) AS avg_delay_seconds
        FROM gold.route_reliability_weekly AS r
        WHERE r.provider_id = :provider_id
        GROUP BY 1, 2, 3, 4, 5, 6
    ),
    stop_week AS (
        SELECT
            s.provider_id,
            'stop'::text AS entity_kind,
            COALESCE(s.stop_id, '__unknown_stop__') AS entity_id,
            COALESCE(s.route_id, '__unrouted__') AS route_id,
            'week'::text AS period_grain,
            s.week_start_local AS period_start_local,
            SUM(s.severe_delay_count)::integer AS issue_count,
            ROUND(AVG(s.avg_delay_seconds)::numeric, 2) AS avg_delay_seconds
        FROM gold.stop_delay_weekly AS s
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
    """
)

UPSERT_CITIZEN_ACCOUNTABILITY_DAILY = text(
    """
    WITH cutoff AS (
        SELECT
            (timezone(dp.timezone, CAST(:built_at_utc AS timestamptz)))::date
                - :open_window_days AS min_local_date
        FROM gold.dim_provider AS dp
        WHERE dp.provider_id = :provider_id
    ),
    route_daily AS (
        SELECT
            rd.provider_id,
            timezone(dp.timezone, rd.period_start_utc)::date AS provider_local_date,
            COUNT(DISTINCT route_id) FILTER (
                WHERE rd.avg_delay_seconds > 300 OR rd.severe_delay_count > 0
            )::integer AS affected_route_count,
            SUM(rd.delayed_trip_count)::integer AS delayed_trip_count,
            SUM(rd.severe_delay_count)::integer AS severe_delay_count
        FROM gold.route_delay_hourly AS rd
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = rd.provider_id
        WHERE rd.provider_id = :provider_id
          AND rd.period_start_utc >= (
              CAST(:built_at_utc AS timestamptz)
              - make_interval(days => :open_window_days + 2)
          )
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
        COALESCE(r.affected_route_count, 0),
        COALESCE(s.affected_stop_count, 0),
        COALESCE(r.delayed_trip_count, 0),
        COALESCE(r.severe_delay_count, 0),
        COALESCE(ia.alert_count, 0),
        LEAST(
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
        ),
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
    """
)

UPSERT_ROUTE_HEADWAY_DAILY = text(
    """
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
          AND f.captured_at_utc >= now() - interval '14 days'
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
            CASE
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 6 AND 8 THEN 'am_peak'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 9 AND 14 THEN 'midday'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 15 AND 18 THEN 'pm_peak'
                WHEN EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))
                    BETWEEN 19 AND 22 THEN 'evening'
                ELSE 'night'
            END AS shift
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
    )
    INSERT INTO gold.route_headway_daily (
        provider_id,
        route_id,
        shift,
        observed_headway_min,
        sample_count,
        built_at_utc
    )
    SELECT
        provider_id,
        route_id,
        shift,
        ROUND(
            percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_min)::numeric,
            1
        ),
        COUNT(*)::integer,
        :built_at_utc
    FROM gaps
    WHERE gap_min IS NOT NULL
      AND gap_min > 0
      AND gap_min < 240
    GROUP BY provider_id, route_id, shift
    ON CONFLICT (provider_id, route_id, shift) DO UPDATE SET
        observed_headway_min = EXCLUDED.observed_headway_min,
        sample_count = EXCLUDED.sample_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_REPEAT_OFFENDER_DAILY = text(
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
          AND f.captured_at_utc >= now() - interval '14 days'
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
    INSERT INTO gold.repeat_offender_daily (
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
        14,
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
    """
)

REPORTING_AGGREGATE_UPSERTS = {
    "route_delay_hourly": UPSERT_ROUTE_DELAY_HOURLY,
    "route_delay_day_of_week": UPSERT_ROUTE_DELAY_DAY_OF_WEEK,
    "stop_delay_hourly": UPSERT_STOP_DELAY_HOURLY,
    "route_reliability_weekly": UPSERT_ROUTE_RELIABILITY_WEEKLY,
    "route_reliability_monthly": UPSERT_ROUTE_RELIABILITY_MONTHLY,
    "stop_delay_weekly": UPSERT_STOP_DELAY_WEEKLY,
    "stop_delay_monthly": UPSERT_STOP_DELAY_MONTHLY,
    "route_habit_score": UPSERT_ROUTE_HABIT_SCORE,
    "repeated_problem_route_stop": UPSERT_REPEATED_PROBLEM_ROUTE_STOP,
    "citizen_accountability_daily": UPSERT_CITIZEN_ACCOUNTABILITY_DAILY,
    "route_headway_daily": UPSERT_ROUTE_HEADWAY_DAILY,
    "repeat_offender_daily": UPSERT_REPEAT_OFFENDER_DAILY,
}

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
    reporting_aggregate_row_counts: dict[str, int] = field(default_factory=dict)

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "since_utc": self.since_utc.isoformat() if self.since_utc else None,
            "built_vehicle_periods": self.built_vehicle_periods,
            "built_trip_delay_periods": self.built_trip_delay_periods,
            "reporting_aggregate_row_counts": self.reporting_aggregate_row_counts,
            "completed_at_utc": self.completed_at_utc.isoformat(),
        }


# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------


def _safe_rowcount(result) -> int:  # noqa: ANN001
    rowcount = getattr(result, "rowcount", 0)
    return max(int(rowcount or 0), 0)


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
    open_window_days = getattr(settings, "GOLD_REPORTING_OPEN_WINDOW_DAYS", 10)
    fact_retention_days = getattr(settings, "GOLD_FACT_RETENTION_DAYS", 14)
    if not (0 < open_window_days < fact_retention_days):
        raise ValueError(
            "GOLD_REPORTING_OPEN_WINDOW_DAYS must be greater than 0 and less than "
            "GOLD_FACT_RETENTION_DAYS"
        )
    if engine is None:
        engine = make_engine(settings)

    built_vehicle = 0
    built_trip_delay = 0
    reporting_aggregate_row_counts: dict[str, int] = {}
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

        for table_name in REPORTING_AGGREGATE_TABLES:
            delete_params = {"provider_id": provider_id}
            upsert_params = {
                "provider_id": provider_id,
                "built_at_utc": now,
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
            conn.execute(
                DELETE_REPORTING_AGGREGATES[table_name],
                delete_params,
            )
            result = conn.execute(
                REPORTING_AGGREGATE_UPSERTS[table_name],
                upsert_params,
            )
            reporting_aggregate_row_counts[table_name] = _safe_rowcount(result)

    return WarmRollupBuildResult(
        provider_id=provider_id,
        since_utc=since_utc,
        built_vehicle_periods=built_vehicle,
        built_trip_delay_periods=built_trip_delay,
        reporting_aggregate_row_counts=reporting_aggregate_row_counts,
        completed_at_utc=now,
    )
