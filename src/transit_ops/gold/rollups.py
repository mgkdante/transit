from __future__ import annotations

from dataclasses import dataclass, field
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
)

DELETE_REPORTING_AGGREGATES = {
    table_name: text(f"DELETE FROM gold.{table_name} WHERE provider_id = :provider_id")
    for table_name in REPORTING_AGGREGATE_TABLES
}

UPSERT_ROUTE_DELAY_HOURLY = text(
    """
    WITH summary AS (
        SELECT
            provider_id,
            date_trunc('hour', period_start_utc) AS period_start_utc,
            COALESCE(route_id, '__unrouted__') AS route_id,
            SUM(trip_count)::integer AS trip_count,
            SUM(observation_count)::integer AS observation_count,
            ROUND(
                SUM(avg_delay_seconds * NULLIF(delay_observation_count, 0))
                / NULLIF(SUM(delay_observation_count), 0),
                2
            ) AS avg_delay_seconds,
            MAX(max_delay_seconds) AS max_delay_seconds,
            SUM(delayed_trip_count)::integer AS delayed_trip_count
        FROM gold.trip_delay_summary_5m
        WHERE provider_id = :provider_id
        GROUP BY 1, 2, 3
    ),
    severe AS (
        SELECT
            provider_id,
            date_trunc('hour', captured_at_utc) AS period_start_utc,
            COALESCE(route_id, '__unrouted__') AS route_id,
            COUNT(*) FILTER (WHERE delay_seconds > 300)::integer AS severe_delay_count
        FROM gold.fact_trip_delay_snapshot
        WHERE provider_id = :provider_id
        GROUP BY 1, 2, 3
    )
    INSERT INTO gold.route_delay_hourly (
        provider_id,
        period_start_utc,
        route_id,
        trip_count,
        observation_count,
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
        s.avg_delay_seconds,
        s.max_delay_seconds,
        s.delayed_trip_count,
        COALESCE(severe.severe_delay_count, 0),
        :built_at_utc
    FROM summary AS s
    LEFT JOIN severe
        ON severe.provider_id = s.provider_id
       AND severe.period_start_utc = s.period_start_utc
       AND severe.route_id = s.route_id
    ON CONFLICT (provider_id, period_start_utc, route_id) DO UPDATE SET
        trip_count = EXCLUDED.trip_count,
        observation_count = EXCLUDED.observation_count,
        avg_delay_seconds = EXCLUDED.avg_delay_seconds,
        max_delay_seconds = EXCLUDED.max_delay_seconds,
        delayed_trip_count = EXCLUDED.delayed_trip_count,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
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
        f.provider_id,
        EXTRACT(ISODOW FROM timezone(dp.timezone, f.captured_at_utc))::integer,
        COALESCE(f.route_id, '__unrouted__'),
        COUNT(DISTINCT f.trip_id)::integer,
        COUNT(*)::integer,
        ROUND(AVG(f.delay_seconds::numeric), 2),
        COUNT(*) FILTER (WHERE f.delay_seconds > 300)::integer,
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = f.provider_id
    WHERE f.provider_id = :provider_id
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
        date_trunc('hour', observation_time_utc),
        COALESCE(stop_id, '__unknown_stop__'),
        COALESCE(route_id, '__unrouted__'),
        COUNT(*)::integer,
        ROUND(AVG(arrival_delay_seconds::numeric), 2),
        ROUND(AVG(departure_delay_seconds::numeric), 2),
        COUNT(*) FILTER (
            WHERE COALESCE(arrival_delay_seconds, departure_delay_seconds) > 300
        )::integer,
        :built_at_utc
    FROM gold.fact_stop_time_delay_observation
    WHERE provider_id = :provider_id
    GROUP BY 1, 2, 3, 4
    ON CONFLICT (provider_id, period_start_utc, stop_id, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
        avg_arrival_delay_seconds = EXCLUDED.avg_arrival_delay_seconds,
        avg_departure_delay_seconds = EXCLUDED.avg_departure_delay_seconds,
        severe_delay_count = EXCLUDED.severe_delay_count,
        built_at_utc = EXCLUDED.built_at_utc
    """
)

UPSERT_ROUTE_RELIABILITY_WEEKLY = text(
    """
    INSERT INTO gold.route_reliability_weekly (
        provider_id,
        week_start_local,
        route_id,
        observation_count,
        avg_delay_seconds,
        delayed_trip_count,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        f.provider_id,
        date_trunc('week', timezone(dp.timezone, f.observation_time_utc))::date,
        COALESCE(f.route_id, '__unrouted__'),
        COUNT(*)::integer,
        ROUND(AVG(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds)::numeric), 2),
        COUNT(DISTINCT f.trip_id) FILTER (
            WHERE COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds) > 0
        )::integer,
        COUNT(*) FILTER (
            WHERE COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds) > 300
        )::integer,
        :built_at_utc
    FROM gold.fact_stop_time_delay_observation AS f
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = f.provider_id
    WHERE f.provider_id = :provider_id
    GROUP BY 1, 2, 3
    ON CONFLICT (provider_id, week_start_local, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
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
        avg_delay_seconds,
        delayed_trip_count,
        severe_delay_count,
        built_at_utc
    )
    SELECT
        f.provider_id,
        date_trunc('month', timezone(dp.timezone, f.observation_time_utc))::date,
        COALESCE(f.route_id, '__unrouted__'),
        COUNT(*)::integer,
        ROUND(AVG(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds)::numeric), 2),
        COUNT(DISTINCT f.trip_id) FILTER (
            WHERE COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds) > 0
        )::integer,
        COUNT(*) FILTER (
            WHERE COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds) > 300
        )::integer,
        :built_at_utc
    FROM gold.fact_stop_time_delay_observation AS f
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = f.provider_id
    WHERE f.provider_id = :provider_id
    GROUP BY 1, 2, 3
    ON CONFLICT (provider_id, month_start_local, route_id) DO UPDATE SET
        observation_count = EXCLUDED.observation_count,
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
        f.provider_id,
        date_trunc('week', timezone(dp.timezone, f.observation_time_utc))::date,
        COALESCE(f.stop_id, '__unknown_stop__'),
        COALESCE(f.route_id, '__unrouted__'),
        COUNT(*)::integer,
        ROUND(AVG(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds)::numeric), 2),
        COUNT(*) FILTER (
            WHERE COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds) > 300
        )::integer,
        :built_at_utc
    FROM gold.fact_stop_time_delay_observation AS f
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = f.provider_id
    WHERE f.provider_id = :provider_id
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
        f.provider_id,
        date_trunc('month', timezone(dp.timezone, f.observation_time_utc))::date,
        COALESCE(f.stop_id, '__unknown_stop__'),
        COALESCE(f.route_id, '__unrouted__'),
        COUNT(*)::integer,
        ROUND(AVG(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds)::numeric), 2),
        COUNT(*) FILTER (
            WHERE COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds) > 300
        )::integer,
        :built_at_utc
    FROM gold.fact_stop_time_delay_observation AS f
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = f.provider_id
    WHERE f.provider_id = :provider_id
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
            f.provider_id,
            COALESCE(f.route_id, '__unrouted__') AS route_id,
            EXTRACT(ISODOW FROM timezone(dp.timezone, f.observation_time_utc))::integer
                AS day_of_week_iso,
            EXTRACT(HOUR FROM timezone(dp.timezone, f.observation_time_utc))::integer
                AS hour_of_day_local,
            COUNT(*)::integer AS observation_count,
            ROUND(AVG(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds)::numeric), 2)
                AS avg_delay_seconds,
            COUNT(*) FILTER (
                WHERE COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds) > 300
            )::integer AS severe_delay_count
        FROM gold.fact_stop_time_delay_observation AS f
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = f.provider_id
        WHERE f.provider_id = :provider_id
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
        ROUND(
            (
                severe_delay_count::numeric * 10
                + GREATEST(COALESCE(avg_delay_seconds, 0), 0) / 60
            ),
            4
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
            date_trunc('week', r.provider_local_date)::date AS period_start_local,
            SUM(r.severe_delay_observation_count)::integer AS issue_count,
            ROUND(AVG(r.avg_delay_seconds)::numeric, 2) AS avg_delay_seconds
        FROM gold.public_route_reliability_daily AS r
        WHERE r.provider_id = :provider_id
        GROUP BY 1, 2, 3, 4, 5, 6
    ),
    stop_week AS (
        SELECT
            s.provider_id,
            'stop'::text AS entity_kind,
            COALESCE(s.stop_id, '__unknown_stop__') AS entity_id,
            '__all_routes__'::text AS route_id,
            'week'::text AS period_grain,
            date_trunc('week', s.provider_local_date)::date AS period_start_local,
            COUNT(*) FILTER (
                WHERE s.max_delay_seconds > 300 OR s.avg_delay_seconds > 300
            )::integer AS issue_count,
            ROUND(AVG(s.avg_delay_seconds)::numeric, 2) AS avg_delay_seconds
        FROM gold.public_stop_delay_daily AS s
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
    WITH route_daily AS (
        SELECT
            provider_id,
            provider_local_date,
            COUNT(DISTINCT route_id) FILTER (
                WHERE avg_delay_seconds > 300 OR severe_delay_observation_count > 0
            )::integer AS affected_route_count,
            COUNT(*) FILTER (WHERE avg_delay_seconds > 0)::integer AS delayed_trip_count,
            SUM(severe_delay_observation_count)::integer AS severe_delay_count
        FROM gold.public_route_reliability_daily
        WHERE provider_id = :provider_id
        GROUP BY 1, 2
    ),
    stop_daily AS (
        SELECT
            provider_id,
            provider_local_date,
            COUNT(DISTINCT stop_id) FILTER (
                WHERE avg_delay_seconds > 300 OR max_delay_seconds > 300
            )::integer AS affected_stop_count
        FROM gold.public_stop_delay_daily
        WHERE provider_id = :provider_id
        GROUP BY 1, 2
    ),
    public_alert_daily AS (
        SELECT
            provider_id,
            provider_local_date,
            SUM(alert_count)::integer AS alert_count
        FROM gold.public_alert_impact_daily
        WHERE provider_id = :provider_id
        GROUP BY 1, 2
    ),
    i3_alert_daily AS (
        SELECT
            provider_id,
            provider_local_date,
            COUNT(DISTINCT alert_id)::integer AS alert_count
        FROM gold.i3_alert_history_reporting
        WHERE provider_id = :provider_id
        GROUP BY 1, 2
    ),
    calendar AS (
        SELECT provider_id, provider_local_date FROM route_daily
        UNION
        SELECT provider_id, provider_local_date FROM stop_daily
        UNION
        SELECT provider_id, provider_local_date FROM public_alert_daily
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
        GREATEST(
            COALESCE(pa.alert_count, 0),
            COALESCE(ia.alert_count, 0)
        ),
        ROUND(
            (
                COALESCE(r.affected_route_count, 0)::numeric * 2
                + COALESCE(s.affected_stop_count, 0)::numeric
                + COALESCE(r.delayed_trip_count, 0)::numeric
                + COALESCE(r.severe_delay_count, 0)::numeric * 3
                + GREATEST(COALESCE(pa.alert_count, 0), COALESCE(ia.alert_count, 0))::numeric * 2
            ),
            4
        ),
        :built_at_utc
    FROM calendar AS c
    LEFT JOIN route_daily AS r
        ON r.provider_id = c.provider_id
       AND r.provider_local_date = c.provider_local_date
    LEFT JOIN stop_daily AS s
        ON s.provider_id = c.provider_id
       AND s.provider_local_date = c.provider_local_date
    LEFT JOIN public_alert_daily AS pa
        ON pa.provider_id = c.provider_id
       AND pa.provider_local_date = c.provider_local_date
    LEFT JOIN i3_alert_daily AS ia
        ON ia.provider_id = c.provider_id
       AND ia.provider_local_date = c.provider_local_date
    ON CONFLICT (provider_id, provider_local_date) DO UPDATE SET
        affected_route_count = EXCLUDED.affected_route_count,
        affected_stop_count = EXCLUDED.affected_stop_count,
        delayed_trip_count = EXCLUDED.delayed_trip_count,
        severe_delay_count = EXCLUDED.severe_delay_count,
        alert_count = EXCLUDED.alert_count,
        rider_impact_score = EXCLUDED.rider_impact_score,
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
}

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
            conn.execute(
                DELETE_REPORTING_AGGREGATES[table_name],
                {"provider_id": provider_id},
            )
            result = conn.execute(
                REPORTING_AGGREGATE_UPSERTS[table_name],
                {
                    "provider_id": provider_id,
                    "built_at_utc": now,
                },
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
