from datetime import UTC, datetime, timedelta

from sqlalchemy import Connection, Engine, bindparam
from sqlalchemy.sql.elements import TextClause

from transit_ops.db.connection import set_daily_warm_transaction_timeouts
from transit_ops.gold.delay_periods import lock_delay_hours, lock_delay_period, materialization_time
from transit_ops.sql_registry import named_query


def delay_hour_statement(name: str, period_filter: str) -> TextClause:
    return named_query(
        name,
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
            CASE WHEN COUNT(*) = COUNT(on_time_observation_count)
                THEN SUM(on_time_observation_count)::integer
            END AS on_time_observation_count,
            SUM(delay_observation_count - outlier_count)::bigint
                AS usable_delay_observation_count,
            CASE WHEN BOOL_AND(
                delay_observation_count = outlier_count OR usable_delay_sum_seconds IS NOT NULL
            ) THEN COALESCE(SUM(usable_delay_sum_seconds), 0)::bigint
            END AS usable_delay_sum_seconds,
            ROUND(
                SUM(avg_delay_seconds_capped * NULLIF(delay_observation_count - outlier_count, 0))
                / NULLIF(SUM(delay_observation_count - outlier_count), 0),
                2
            ) AS avg_delay_seconds,
            MAX(max_delay_seconds_capped) AS max_delay_seconds,
            SUM(delayed_trip_count)::integer AS delayed_trip_count
        FROM gold.trip_delay_summary_5m
        WHERE provider_id = :provider_id
          AND {period_filter}
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
        usable_delay_observation_count,
        usable_delay_sum_seconds,
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
        s.usable_delay_observation_count,
        s.usable_delay_sum_seconds,
        COALESCE(CAST(:materialized_at_utc AS timestamptz), :built_at_utc)
    FROM summary AS s
    """,
    ).bindparams(bindparam("materialized_at_utc", value=None))


_REPLACE_HOUR = delay_hour_statement(
    "rollup.route_delay_hourly.replace_hour",
    "period_start_utc >= :hour AND period_start_utc < :hour + INTERVAL '1 hour'",
)
_DELETE_HOUR = named_query(
    "rollup.route_delay_hourly.delete_hour",
    """
    DELETE FROM gold.route_delay_hourly
    WHERE provider_id = :provider_id AND period_start_utc = :hour
    """,
)
_HOUR_STATE_SQL = """
    child AS (
        SELECT date_trunc('hour', period_start_utc) AS hour, MAX(built_at_utc) AS built_at
        FROM gold.warm_rollup_periods
        WHERE provider_id = :provider_id AND rollup_kind = 'trip_delay_summary_5m'
          AND invalidated_at_utc IS NULL
          {period_filter}
        GROUP BY 1
    ), parent AS (
        SELECT period_start_utc AS hour, MIN(built_at_utc) AS built_at
        FROM gold.route_delay_hourly
        WHERE provider_id = :provider_id
          {period_filter}
        GROUP BY 1
    )
"""
_LAGGING_HOUR_SQL = """
    SELECT c.hour FROM child AS c LEFT JOIN parent AS p USING (hour)
    WHERE (p.built_at IS NULL OR c.built_at > p.built_at)
      AND (p.built_at IS NOT NULL OR EXISTS (
        SELECT 1 FROM gold.trip_delay_summary_5m AS b
        WHERE b.provider_id = :provider_id
          AND b.period_start_utc >= c.hour AND b.period_start_utc < c.hour + INTERVAL '1 hour'
      ))
"""
_DIRTY_HOURS = named_query(
    "rollup.route_delay_hourly.dirty_hours",
    "WITH " + _HOUR_STATE_SQL.format(
        period_filter="AND period_start_utc >= :from_utc AND period_start_utc < :until_utc"
    ) + _LAGGING_HOUR_SQL + " ORDER BY c.hour",
)
_HISTORIC_PERIOD_FILTER = """
    AND EXISTS (
        SELECT 1 FROM history_days AS d
        WHERE d.local_date =
            timezone((SELECT timezone FROM provider_zone), period_start_utc)::date
    )
"""
_HISTORIC_MEANS_PENDING = named_query(
    "rollup.route_delay_hourly.historic_dependencies_pending",
    """
    WITH provider_zone AS (
        SELECT timezone FROM gold.dim_provider WHERE provider_id = :provider_id
    ), history_days AS MATERIALIZED (
        SELECT DISTINCT provider_local_date AS local_date FROM gold.route_delay_spine
        WHERE provider_id = :provider_id
        UNION
        SELECT (period_start_utc AT TIME ZONE 'UTC')::date
        FROM gold.warm_rollup_periods
        WHERE provider_id = :provider_id AND rollup_kind = 'route_delay_spine'
    ),
    """ + _HOUR_STATE_SQL.format(period_filter=_HISTORIC_PERIOD_FILTER) + """
    SELECT EXISTS (
        SELECT 1 FROM gold.warm_rollup_periods
        WHERE provider_id = :provider_id AND rollup_kind = 'trip_delay_summary_5m'
          AND invalidated_at_utc IS NOT NULL
    """ + _HISTORIC_PERIOD_FILTER + ") OR EXISTS (" + _LAGGING_HOUR_SQL + ")",
)


def assert_historic_delay_means_current(conn: Connection, provider_id: str) -> None:
    """Reject recorded pending mean dependencies for represented history, including empty days."""
    if conn.execute(_HISTORIC_MEANS_PENDING, {"provider_id": provider_id}).scalar_one():
        raise ValueError(
            f"Historic delay means for {provider_id!r} need five-minute/hourly reporting refresh; "
            "run build-warm-rollups after daily repair"
        )


def refresh_changed_delay_hours(
    engine: Engine, provider_id: str, from_utc: datetime, until_utc: datetime
) -> int:
    params = {
        "provider_id": provider_id,
        "from_utc": from_utc.astimezone(UTC).replace(minute=0, second=0, microsecond=0),
        "until_utc": until_utc.astimezone(UTC),
    }
    with engine.begin() as conn:
        set_daily_warm_transaction_timeouts(conn)
        hours = conn.execute(_DIRTY_HOURS, params).scalars().all()
    for hour in hours:
        with engine.begin() as conn:
            set_daily_warm_transaction_timeouts(conn)
            lock_delay_hours(conn, provider_id)
            for minute in range(0, 60, 5):
                lock_delay_period(conn, provider_id, hour + timedelta(minutes=minute))
            hourly_params = {
                "provider_id": provider_id,
                "hour": hour,
                "built_at_utc": materialization_time(conn),
            }
            conn.execute(_DELETE_HOUR, hourly_params)
            conn.execute(_REPLACE_HOUR, hourly_params)
    return len(hours)
