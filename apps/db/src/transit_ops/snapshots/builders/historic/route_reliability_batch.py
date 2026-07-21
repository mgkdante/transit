"""Set-based provider preload for historic route-reliability payloads.

The public per-route builder remains the only payload assembler. This module
replaces its physical per-route reads with provider-wide typed result sets,
then serves the unchanged assembler through a fail-closed in-memory adapter.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import timedelta
from typing import TYPE_CHECKING

from transit_ops.gold.reader import cov_case_sql
from transit_ops.snapshots.builders._helpers import (
    _ACTIVE_SERVICES_SQL,
    _ALL_ROUTE_SCHEDULES_SQL,
    _CURRENT_DATASET_VERSION_SQL,
    _REP_DATES_SQL,
    _ROUTE_NAMES_SQL,
    _STOP_NAMES_SQL,
)
from transit_ops.snapshots.builders.historic.route_reliability import (
    build_route_reliability,
)
from transit_ops.snapshots.contract import RouteReliability
from transit_ops.sql_registry import named_query, query_name

if TYPE_CHECKING:
    from datetime import date

    from sqlalchemy.engine import Connection


_ROUTE_INVENTORY_SQL = named_query(
    "route.spine.route_ids",
    """
    SELECT route_id, MAX(provider_local_date) AS spine_anchor
    FROM gold.route_delay_spine
    WHERE provider_id = :provider_id AND route_id IS NOT NULL
    GROUP BY route_id
    ORDER BY route_id
    """,
)

_PERCENTILE_DAILY_SQL = named_query(
    "route.reliability.batch.percentile_daily",
    """
    SELECT route_id, provider_local_date, p50_delay_seconds, p90_delay_seconds
    FROM gold.route_delay_percentile_daily
    WHERE provider_id = :provider_id AND route_id IS NOT NULL
    ORDER BY route_id, provider_local_date
    """,
)

_DAILY_SQL = named_query(
    "route.reliability.batch.daily",
    """
    WITH ranked AS (
        SELECT
            route_id,
            provider_local_date AS d,
            delay_observation_count AS known_obs,
            on_time_observation_count AS on_time,
            avg_delay_seconds AS avg_delay_sec,
            severe_delay_observation_count AS severe,
            row_number() OVER (
                PARTITION BY route_id ORDER BY provider_local_date DESC
            ) AS route_rank
        FROM gold.public_route_reliability_daily
        WHERE provider_id = :provider_id AND route_id IS NOT NULL
    )
    SELECT route_id, d, known_obs, on_time, avg_delay_sec, severe
    FROM ranked
    WHERE route_rank <= 30
    ORDER BY route_id, d DESC
    """,
)


_SHIFT_CASE = """
CASE
    WHEN hour_of_day_local BETWEEN 6 AND 8 THEN 'am_peak'
    WHEN hour_of_day_local BETWEEN 9 AND 14 THEN 'midday'
    WHEN hour_of_day_local BETWEEN 15 AND 18 THEN 'pm_peak'
    WHEN hour_of_day_local BETWEEN 19 AND 22 THEN 'evening'
    ELSE 'night'
END
""".strip()

_DAYTYPE_CASE = """
CASE
    WHEN EXTRACT(ISODOW FROM provider_local_date) BETWEEN 1 AND 5 THEN 'weekday'
    ELSE 'weekend'
END
""".strip()

_DELAY_HISTOGRAM_ARRAY = "ARRAY[\n" + ",\n".join(
    f"        SUM(delay_histogram[{index}])::bigint" for index in range(1, 22)
) + "\n    ]::bigint[]"

_SPINE_METRICS = f"""
        SUM(observation_count)::bigint AS obs,
        SUM(delay_observation_count)::bigint AS known_obs,
        SUM(on_time_observation_count)::bigint AS on_time,
        SUM(severe_delay_count)::bigint AS severe,
        SUM(sum_delay_seconds)::bigint AS sum_delay_sec,
        NULL::numeric AS repeat_problem_score,
        {_DELAY_HISTOGRAM_ARRAY} AS delay_histogram
""".strip()

_SPINE_SECTIONS_SQL = named_query(
    "route.reliability.batch.spine_sections",
    f"""
    WITH base AS MATERIALIZED (
        SELECT *
        FROM gold.route_delay_spine
        WHERE provider_id = :provider_id AND route_id IS NOT NULL
    ), anchors AS (
        SELECT route_id, MAX(provider_local_date) AS anchor
        FROM base
        GROUP BY route_id
    ), windows AS (
        SELECT route_id, 'day'::text AS window_grain,
               anchor AS win_start, anchor AS win_end, false AS is_prior
        FROM anchors
        UNION ALL
        SELECT route_id, 'week', anchor - 6, anchor, false FROM anchors
        UNION ALL
        SELECT route_id, 'month', anchor - 29, anchor, false FROM anchors
        UNION ALL
        SELECT route_id, 'day', anchor - 1, anchor - 1, true FROM anchors
        UNION ALL
        SELECT route_id, 'week', anchor - 13, anchor - 7, true FROM anchors
        UNION ALL
        SELECT route_id, 'month', anchor - 59, anchor - 30, true FROM anchors
    )
    SELECT
        route_id, 'route.spine.weekly'::text AS logical_query,
        NULL::date AS win_start, NULL::date AS win_end,
        NULL::text AS grain,
        date_trunc('week', provider_local_date)::date AS d,
        NULL::integer AS day_of_week_iso, NULL::integer AS hour_of_day_local,
        NULL::text AS shift, NULL::text AS day_type,
        {_SPINE_METRICS}
    FROM base
    GROUP BY route_id, date_trunc('week', provider_local_date)::date

    UNION ALL
    SELECT
        route_id, 'route.spine.monthly', NULL::date, NULL::date,
        NULL::text, date_trunc('month', provider_local_date)::date,
        NULL::integer, NULL::integer, NULL::text, NULL::text,
        {_SPINE_METRICS}
    FROM base
    GROUP BY route_id, date_trunc('month', provider_local_date)::date

    UNION ALL
    SELECT
        route_id, 'route.spine.by_shift', NULL::date, NULL::date,
        ({_SHIFT_CASE})::text, NULL::date,
        NULL::integer, NULL::integer, NULL::text, NULL::text,
        {_SPINE_METRICS}
    FROM base
    GROUP BY route_id, {_SHIFT_CASE}

    UNION ALL
    SELECT
        route_id, 'route.spine.by_daytype', NULL::date, NULL::date,
        ({_DAYTYPE_CASE})::text, NULL::date,
        NULL::integer, NULL::integer, NULL::text, NULL::text,
        {_SPINE_METRICS}
    FROM base
    GROUP BY route_id, {_DAYTYPE_CASE}

    UNION ALL
    SELECT
        route_id, 'route.spine.dow', NULL::date, NULL::date,
        NULL::text, NULL::date,
        EXTRACT(ISODOW FROM provider_local_date)::integer,
        NULL::integer, NULL::text, NULL::text,
        {_SPINE_METRICS}
    FROM base
    GROUP BY route_id, EXTRACT(ISODOW FROM provider_local_date)::integer

    UNION ALL
    SELECT
        route_id, 'route.spine.crosstab', NULL::date, NULL::date,
        NULL::text, NULL::date, NULL::integer, NULL::integer,
        ({_SHIFT_CASE})::text, ({_DAYTYPE_CASE})::text,
        {_SPINE_METRICS}
    FROM base
    GROUP BY route_id, {_SHIFT_CASE}, {_DAYTYPE_CASE}

    UNION ALL
    SELECT
        b.route_id, 'route.spine.by_shift_windowed', w.win_start, w.win_end,
        ({_SHIFT_CASE})::text, NULL::date,
        NULL::integer, NULL::integer, NULL::text, NULL::text,
        {_SPINE_METRICS}
    FROM base AS b
    JOIN windows AS w
      ON w.route_id = b.route_id
     AND b.provider_local_date BETWEEN w.win_start AND w.win_end
    GROUP BY b.route_id, w.win_start, w.win_end, {_SHIFT_CASE}

    UNION ALL
    SELECT
        b.route_id, 'route.spine.by_daytype_windowed', w.win_start, w.win_end,
        ({_DAYTYPE_CASE})::text, NULL::date,
        NULL::integer, NULL::integer, NULL::text, NULL::text,
        {_SPINE_METRICS}
    FROM base AS b
    JOIN windows AS w
      ON w.route_id = b.route_id
     AND b.provider_local_date BETWEEN w.win_start AND w.win_end
    GROUP BY b.route_id, w.win_start, w.win_end, {_DAYTYPE_CASE}

    UNION ALL
    SELECT
        b.route_id, 'route.spine.dow_windowed', w.win_start, w.win_end,
        NULL::text, NULL::date,
        EXTRACT(ISODOW FROM b.provider_local_date)::integer,
        NULL::integer, NULL::text, NULL::text,
        {_SPINE_METRICS}
    FROM base AS b
    JOIN windows AS w
      ON w.route_id = b.route_id AND NOT w.is_prior
     AND b.provider_local_date BETWEEN w.win_start AND w.win_end
    GROUP BY b.route_id, w.win_start, w.win_end,
             EXTRACT(ISODOW FROM b.provider_local_date)::integer

    UNION ALL
    SELECT
        b.route_id, 'route.spine.crosstab_windowed', w.win_start, w.win_end,
        NULL::text, NULL::date, NULL::integer, NULL::integer,
        ({_SHIFT_CASE})::text, ({_DAYTYPE_CASE})::text,
        {_SPINE_METRICS}
    FROM base AS b
    JOIN windows AS w
      ON w.route_id = b.route_id AND NOT w.is_prior
     AND b.provider_local_date BETWEEN w.win_start AND w.win_end
    GROUP BY b.route_id, w.win_start, w.win_end,
             {_SHIFT_CASE}, {_DAYTYPE_CASE}

    UNION ALL
    SELECT
        b.route_id, 'route.habit.spine', DATE '1970-01-01', a.anchor,
        NULL::text, NULL::date,
        EXTRACT(ISODOW FROM b.provider_local_date)::integer,
        b.hour_of_day_local, NULL::text, NULL::text,
        NULL::bigint AS obs,
        SUM(b.delay_observation_count)::bigint AS known_obs,
        NULL::bigint AS on_time, NULL::bigint AS severe,
        NULL::bigint AS sum_delay_sec,
        LEAST(
            ROUND(
                SUM(b.severe_delay_count)::numeric * 10
                + GREATEST(COALESCE(ROUND(
                    SUM(b.sum_delay_seconds)::numeric
                    / NULLIF(SUM((SELECT COALESCE(SUM(x), 0)
                                  FROM unnest(b.delay_histogram) AS x)), 0),
                    2), 0), 0) / 60,
                4),
            9999.9999) AS repeat_problem_score,
        NULL::bigint[] AS delay_histogram
    FROM base AS b
    JOIN anchors AS a ON a.route_id = b.route_id
    GROUP BY b.route_id, a.anchor,
             EXTRACT(ISODOW FROM b.provider_local_date)::integer,
             b.hour_of_day_local

    UNION ALL
    SELECT
        b.route_id, 'route.habit.spine', w.win_start, w.win_end,
        NULL::text, NULL::date,
        EXTRACT(ISODOW FROM b.provider_local_date)::integer,
        b.hour_of_day_local, NULL::text, NULL::text,
        NULL::bigint AS obs,
        SUM(b.delay_observation_count)::bigint AS known_obs,
        NULL::bigint AS on_time, NULL::bigint AS severe,
        NULL::bigint AS sum_delay_sec,
        LEAST(
            ROUND(
                SUM(b.severe_delay_count)::numeric * 10
                + GREATEST(COALESCE(ROUND(
                    SUM(b.sum_delay_seconds)::numeric
                    / NULLIF(SUM((SELECT COALESCE(SUM(x), 0)
                                  FROM unnest(b.delay_histogram) AS x)), 0),
                    2), 0), 0) / 60,
                4),
            9999.9999) AS repeat_problem_score,
        NULL::bigint[] AS delay_histogram
    FROM base AS b
    JOIN windows AS w
      ON w.route_id = b.route_id AND NOT w.is_prior
     AND b.provider_local_date BETWEEN w.win_start AND w.win_end
    GROUP BY b.route_id, w.win_start, w.win_end,
             EXTRACT(ISODOW FROM b.provider_local_date)::integer,
             b.hour_of_day_local

    ORDER BY route_id, logical_query, win_start NULLS FIRST, win_end NULLS FIRST
    """,
)

_HEADWAY_OBSERVED_SQL = named_query(
    "route.reliability.batch.headway_observed",
    """
    SELECT route_id, shift, observed_headway_min, sample_count, headway_cov, bunched_count
    FROM gold.route_headway_by_shift
    WHERE provider_id = :provider_id AND route_id IS NOT NULL
    ORDER BY route_id, shift
    """,
)

_HEADWAY_DIRECTION_SQL = named_query(
    "route.reliability.batch.headway_direction",
    """
    SELECT route_id, shift, direction_id, service_day_kind, observed_headway_min
    FROM gold.route_headway_by_direction_shift
    WHERE provider_id = :provider_id AND route_id IS NOT NULL
    ORDER BY route_id, direction_id, service_day_kind, shift
    """,
)

_GAP_HISTOGRAM_ARRAY = "ARRAY[\n" + ",\n".join(
    f"        SUM(gap_histogram[{index}])::bigint" for index in range(1, 21)
) + "\n    ]::bigint[]"

_HEADWAY_COV = cov_case_sql(
    n="SUM(gap_count)",
    total="SUM(sum_gap_min)",
    total_sq="SUM(sum_gap_sq_min)",
)

_HEADWAY_WINDOWS_SQL = named_query(
    "route.reliability.batch.headway_windows",
    f"""
    WITH base AS MATERIALIZED (
        SELECT *
        FROM gold.route_headway_shift_daily
        WHERE provider_id = :provider_id AND route_id IS NOT NULL
    ), anchors AS (
        SELECT route_id, MAX(provider_local_date) AS anchor
        FROM base
        GROUP BY route_id
    ), windows AS (
        SELECT route_id, anchor AS win_start, anchor AS win_end FROM anchors
        UNION ALL SELECT route_id, anchor - 6, anchor FROM anchors
        UNION ALL SELECT route_id, anchor - 29, anchor FROM anchors
        UNION ALL SELECT route_id, anchor - 1, anchor - 1 FROM anchors
        UNION ALL SELECT route_id, anchor - 13, anchor - 7 FROM anchors
        UNION ALL SELECT route_id, anchor - 59, anchor - 30 FROM anchors
    ), window_rows AS (
        SELECT
            b.route_id, 'window'::text AS section,
            w.win_start, w.win_end, NULL::date AS anchor,
            b.direction_id, b.shift,
            SUM(b.gap_count)::bigint AS n,
            SUM(b.trip_count)::bigint AS trips,
            SUM(b.sum_gap_min)::numeric AS sum_gap_min,
            SUM(b.sum_gap_sq_min)::numeric AS sum_gap_sq_min,
            {_HEADWAY_COV} AS cov,
            {_GAP_HISTOGRAM_ARRAY} AS gap_histogram
        FROM base AS b
        JOIN windows AS w
          ON w.route_id = b.route_id
         AND b.provider_local_date BETWEEN w.win_start AND w.win_end
        GROUP BY b.route_id, w.win_start, w.win_end, b.direction_id, b.shift
    )
    SELECT
        route_id, 'anchor'::text AS section,
        NULL::date AS win_start, NULL::date AS win_end, anchor,
        NULL::integer AS direction_id, NULL::text AS shift,
        NULL::bigint AS n, NULL::bigint AS trips,
        NULL::numeric AS sum_gap_min, NULL::numeric AS sum_gap_sq_min,
        NULL::numeric AS cov, NULL::bigint[] AS gap_histogram
    FROM anchors
    UNION ALL
    SELECT route_id, section, win_start, win_end, anchor,
           direction_id, shift, n, trips, sum_gap_min, sum_gap_sq_min, cov, gap_histogram
    FROM window_rows
    ORDER BY route_id, section, win_start NULLS FIRST, direction_id, shift
    """,
)

_WEAK_STOPS_SQL = named_query(
    "route.reliability.batch.weak_stops",
    """
    WITH base AS MATERIALIZED (
        SELECT *
        FROM gold.stop_delay_spine
        WHERE provider_id = :provider_id AND route_id IS NOT NULL
    ), anchors AS (
        SELECT route_id, MAX(provider_local_date) AS anchor
        FROM base
        GROUP BY route_id
    ), windows AS (
        SELECT route_id, 'day'::text AS grain,
               anchor AS win_start, anchor AS win_end FROM anchors
        UNION ALL SELECT route_id, 'week', anchor - 6, anchor FROM anchors
        UNION ALL SELECT route_id, 'month', anchor - 29, anchor FROM anchors
    ), legacy AS (
        SELECT
            b.route_id, 'legacy'::text AS section,
            w.win_start, w.win_end, NULL::date AS anchor,
            NULL::text AS grain, b.stop_id,
            SUM(b.observation_count)::bigint AS obs,
            SUM(b.sum_delay_seconds)::bigint AS weighted_delay_sec,
            SUM(b.severe_delay_count)::bigint AS severe,
            NULL::bigint AS sum_delay_sec
        FROM base AS b
        JOIN windows AS w
          ON w.route_id = b.route_id AND w.grain = 'month'
         AND b.provider_local_date BETWEEN w.win_start AND w.win_end
        GROUP BY b.route_id, w.win_start, w.win_end, b.stop_id
    ), windowed AS (
        SELECT
            b.route_id, 'window'::text AS section,
            w.win_start, w.win_end, NULL::date AS anchor,
            w.grain, b.stop_id,
            SUM(b.observation_count)::bigint AS obs,
            NULL::bigint AS weighted_delay_sec,
            SUM(b.severe_delay_count)::bigint AS severe,
            SUM(b.sum_delay_seconds)::bigint AS sum_delay_sec
        FROM base AS b
        JOIN windows AS w
          ON w.route_id = b.route_id
         AND b.provider_local_date BETWEEN w.win_start AND w.win_end
        GROUP BY b.route_id, w.win_start, w.win_end, w.grain, b.stop_id
    )
    SELECT
        route_id, 'anchor'::text AS section,
        NULL::date AS win_start, NULL::date AS win_end, anchor,
        NULL::text AS grain, NULL::text AS stop_id,
        NULL::bigint AS obs, NULL::bigint AS weighted_delay_sec,
        NULL::bigint AS severe, NULL::bigint AS sum_delay_sec
    FROM anchors
    UNION ALL
    SELECT route_id, section, win_start, win_end, anchor, grain, stop_id,
           obs, weighted_delay_sec, severe, sum_delay_sec
    FROM legacy
    UNION ALL
    SELECT route_id, section, win_start, win_end, anchor, grain, stop_id,
           obs, weighted_delay_sec, severe, sum_delay_sec
    FROM windowed
    ORDER BY route_id, section, win_start NULLS FIRST, stop_id
    """,
)

_CANCELLATIONS_SQL = named_query(
    "route.reliability.batch.cancellations",
    """
    WITH ranked AS (
        SELECT
            route_id, provider_local_date, cancellation_rate_pct,
            canceled_trip_days, total_trip_days, scheduled_trip_days,
            delivered_trip_days, silent_trip_days,
            CASE
                WHEN delivered_trip_days IS NULL OR scheduled_trip_days IS NULL
                     OR scheduled_trip_days = 0 THEN NULL
                ELSE LEAST(
                    100.0,
                    ROUND(100.0 * delivered_trip_days / scheduled_trip_days, 2)
                )
            END AS service_completeness_pct,
            row_number() OVER (
                PARTITION BY route_id ORDER BY provider_local_date DESC
            ) AS route_rank
        FROM gold.route_cancellation_daily
        WHERE provider_id = :provider_id AND route_id IS NOT NULL
    )
    SELECT route_id, provider_local_date, cancellation_rate_pct,
           canceled_trip_days, total_trip_days, scheduled_trip_days,
           delivered_trip_days, silent_trip_days, service_completeness_pct
    FROM ranked
    WHERE route_rank <= 30
    ORDER BY route_id, provider_local_date DESC
    """,
)

_OCCUPANCY_SQL = named_query(
    "route.reliability.batch.occupancy",
    """
    WITH daily AS MATERIALIZED (
        SELECT rob.*
        FROM gold.route_occupancy_band_daily AS rob
        JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
        WHERE rob.provider_id = :provider_id AND rob.route_id IS NOT NULL
          AND rob.provider_local_date >=
              (now() AT TIME ZONE dp.timezone)::date - 30
    ), hourly AS MATERIALIZED (
        SELECT rob.*
        FROM gold.route_occupancy_band_hourly AS rob
        JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
        WHERE rob.provider_id = :provider_id AND rob.route_id IS NOT NULL
          AND rob.provider_local_date >=
              (now() AT TIME ZONE dp.timezone)::date - 30
    )
    SELECT
        route_id, 'band_window'::text AS section,
        NULL::date AS d, NULL::integer AS day_of_week_iso,
        NULL::integer AS hour_of_day_local,
        SUM(empty_count)::bigint AS empty,
        SUM(many_seats_count)::bigint AS many_seats,
        SUM(few_seats_count)::bigint AS few_seats,
        SUM(standing_count)::bigint AS standing,
        SUM(full_count)::bigint AS full
    FROM daily
    GROUP BY route_id
    UNION ALL
    SELECT
        route_id, 'by_dow', NULL::date,
        EXTRACT(ISODOW FROM provider_local_date)::integer,
        NULL::integer,
        SUM(empty_count)::bigint, SUM(many_seats_count)::bigint,
        SUM(few_seats_count)::bigint, SUM(standing_count)::bigint,
        SUM(full_count)::bigint
    FROM daily
    GROUP BY route_id, EXTRACT(ISODOW FROM provider_local_date)::integer
    UNION ALL
    SELECT
        route_id, 'by_grain', provider_local_date,
        NULL::integer, NULL::integer,
        empty_count::bigint, many_seats_count::bigint,
        few_seats_count::bigint, standing_count::bigint, full_count::bigint
    FROM daily
    UNION ALL
    SELECT
        route_id, 'by_hour', NULL::date, NULL::integer,
        hour_of_day_local,
        SUM(empty_count)::bigint, SUM(many_seats_count)::bigint,
        SUM(few_seats_count)::bigint, SUM(standing_count)::bigint,
        SUM(full_count)::bigint
    FROM hourly
    GROUP BY route_id, hour_of_day_local
    ORDER BY route_id, section, d NULLS FIRST, day_of_week_iso, hour_of_day_local
    """,
)

_SERVICE_SPANS_SQL = named_query(
    "route.reliability.batch.service_spans",
    """
    WITH ranked AS (
        SELECT
            route_id, provider_local_date, first_trip_start_utc, last_trip_start_utc,
            service_span_min, first_trip_delay_seconds, last_trip_delay_seconds,
            trip_count,
            row_number() OVER (
                PARTITION BY route_id ORDER BY provider_local_date DESC
            ) AS route_rank
        FROM gold.route_service_span_daily
        WHERE provider_id = :provider_id AND route_id IS NOT NULL
    )
    SELECT route_id, provider_local_date, first_trip_start_utc, last_trip_start_utc,
           service_span_min, first_trip_delay_seconds, last_trip_delay_seconds, trip_count
    FROM ranked
    WHERE route_rank <= 30
    ORDER BY route_id, provider_local_date DESC
    """,
)

_SKIPPED_STOPS_SQL = named_query(
    "route.reliability.batch.skipped_stops",
    """
    WITH ranked AS (
        SELECT
            route_id, provider_local_date, skipped_stop_rate_pct,
            skipped_stop_count, stop_time_update_count,
            row_number() OVER (
                PARTITION BY route_id ORDER BY provider_local_date DESC
            ) AS route_rank
        FROM gold.route_skipped_stop_daily
        WHERE provider_id = :provider_id AND route_id IS NOT NULL
    )
    SELECT route_id, provider_local_date, skipped_stop_rate_pct,
           skipped_stop_count, stop_time_update_count
    FROM ranked
    WHERE route_rank <= 30
    ORDER BY route_id, provider_local_date DESC
    """,
)

_CROWDING_DELAY_SQL = named_query(
    "route.reliability.batch.crowding_delay",
    """
    SELECT
        rdc.route_id, rdc.band,
        SUM(rdc.delay_observation_count) AS delay_obs,
        SUM(rdc.sum_delay_seconds) AS sum_delay_sec,
        SUM(rdc.p50_delay_seconds * rdc.delay_observation_count)
            FILTER (WHERE rdc.p50_delay_seconds IS NOT NULL) AS w_p50_sec,
        SUM(rdc.delay_observation_count)
            FILTER (WHERE rdc.p50_delay_seconds IS NOT NULL) AS p50_obs,
        COUNT(*) AS day_count
    FROM gold.route_delay_by_crowding_daily AS rdc
    JOIN gold.dim_provider AS dp ON dp.provider_id = rdc.provider_id
    WHERE rdc.provider_id = :provider_id AND rdc.route_id IS NOT NULL
      AND rdc.provider_local_date >=
          (now() AT TIME ZONE dp.timezone)::date - 30
    GROUP BY rdc.route_id, rdc.band
    ORDER BY rdc.route_id, rdc.band
    """,
)


_KNOWN_LOGICAL_QUERIES = frozenset(
    {
        "route.percentile.daily",
        "route.reliability.daily",
        "route.spine.weekly",
        "route.spine.monthly",
        "route.spine.by_shift",
        "route.spine.by_daytype",
        "route.headway.observed_by_shift",
        "static.dataset_version",
        "static.rep_dates",
        "static.active_services",
        "static.route_schedule",
        "route.headway.by_direction_shift",
        "route.spine.anchor",
        "route.habit.spine",
        "route.spine.by_shift_windowed",
        "route.spine.by_daytype_windowed",
        "route.spine.dow_windowed",
        "route.spine.crosstab_windowed",
        "route.headway.anchor",
        "route.headway.window",
        "stop.delay.anchor",
        "route.weak_stops.legacy",
        "route.weak_stops.by_grain",
        "route.spine.dow",
        "route.cancellation.daily",
        "route.occupancy.band_window",
        "route.occupancy.by_dow",
        "route.occupancy.by_grain",
        "route.occupancy.by_hour",
        "route.service_span.daily",
        "route.skipped_stop.daily",
        "route.delay.by_crowding",
        "route.spine.crosstab",
    }
)

_RowStore = dict[str, dict[tuple[object, ...], Sequence[object]]]


def _logical_key(name: str, params: Mapping[str, object]) -> tuple[object, ...]:
    return (
        name,
        params.get("win_start"),
        params.get("win_end"),
        params.get("repdate"),
    )


class _MemoryResult:
    def __init__(self, rows: Sequence[object]) -> None:
        self._rows = tuple(rows)

    def mappings(self) -> _MemoryResult:
        return self

    def __iter__(self):
        return iter(self._rows)

    def fetchone(self):  # noqa: ANN201
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[object]:
        return list(self._rows)


class _InMemoryRouteConnection:
    """Known-query-only row adapter with no physical connection fallback."""

    def __init__(
        self,
        *,
        provider_id: str,
        route_id: str,
        rows: Mapping[tuple[object, ...], Sequence[object]],
    ) -> None:
        self._provider_id = provider_id
        self._route_id = route_id
        self._rows = rows

    def execute(self, statement, params=None) -> _MemoryResult:  # noqa: ANN001
        name = query_name(statement)
        if name not in _KNOWN_LOGICAL_QUERIES:
            raise RuntimeError(f"unknown logical route query: {name!r}")
        bound = dict(params or {})
        requested_provider = bound.get("provider_id")
        if requested_provider is not None and str(requested_provider) != self._provider_id:
            raise RuntimeError(
                f"route adapter {self._route_id!r} rejected provider {requested_provider!r}"
            )
        requested_route = bound.get("route_id")
        if requested_route is not None and str(requested_route) != self._route_id:
            raise RuntimeError(
                f"route adapter {self._route_id!r} rejected route {requested_route!r}"
            )
        return _MemoryResult(self._rows.get(_logical_key(name, bound), ()))


def _mapping_rows(result) -> list[dict[str, object]]:  # noqa: ANN001
    return [dict(row) for row in result.mappings()]


def _inventory_rows(result) -> list[dict[str, object]]:  # noqa: ANN001
    rows: list[dict[str, object]] = []
    for row in result.mappings():
        if isinstance(row, Mapping):
            rows.append(dict(row))
            continue
        values = tuple(row)
        rows.append(
            {
                "route_id": values[0] if values else None,
                "spine_anchor": values[1] if len(values) > 1 else None,
            }
        )
    return rows


def _without(row: Mapping[str, object], *keys: str) -> dict[str, object]:
    return {key: value for key, value in row.items() if key not in keys}


def _route_groups(rows: Sequence[Mapping[str, object]]) -> dict[str, list[dict[str, object]]]:
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        route_id = row.get("route_id")
        if route_id is None:
            continue
        grouped[str(route_id)].append(_without(row, "route_id"))
    return grouped


def _expand_histogram(row: dict[str, object], field: str, count: int, prefix: str) -> None:
    histogram = row.pop(field, None)
    values = list(histogram or ())
    for index in range(1, count + 1):
        row[f"{prefix}{index}"] = values[index - 1] if index <= len(values) else 0


def _row_sort_key(name: str, row: Mapping[str, object]) -> tuple[str, ...]:
    if name == "route.headway.by_direction_shift":
        return (
            f"{int(row.get('direction_id') or 0):04d}",
            str(row.get("service_day_kind") or ""),
            str(row.get("shift") or ""),
        )
    if name == "route.headway.observed_by_shift":
        return (str(row.get("shift") or ""),)
    if name == "route.percentile.daily":
        return (str(row.get("provider_local_date") or ""),)
    if name in {"route.spine.weekly", "route.spine.monthly"}:
        return (str(row.get("d") or ""),)
    if name in {
        "route.spine.by_shift",
        "route.spine.by_daytype",
        "route.spine.by_shift_windowed",
        "route.spine.by_daytype_windowed",
    }:
        return (str(row.get("grain") or ""),)
    if name in {"route.spine.dow", "route.spine.dow_windowed"}:
        return (f"{int(row.get('day_of_week_iso') or 0):02d}",)
    if name in {"route.spine.crosstab", "route.spine.crosstab_windowed"}:
        return (str(row.get("shift") or ""), str(row.get("day_type") or ""))
    if name == "route.habit.spine":
        return (
            f"{int(row.get('day_of_week_iso') or 0):02d}",
            f"{int(row.get('hour_of_day_local') or 0):02d}",
        )
    return tuple(str(row.get(key) or "") for key in sorted(row))


def _put(
    stores: _RowStore,
    route_id: str,
    name: str,
    rows: Sequence[object],
    *,
    win_start: date | None = None,
    win_end: date | None = None,
    repdate: date | None = None,
) -> None:
    stores[route_id][
        _logical_key(
            name,
            {"win_start": win_start, "win_end": win_end, "repdate": repdate},
        )
    ] = list(rows)


def _put_shared(
    stores: _RowStore,
    route_ids: Sequence[str],
    name: str,
    rows: Sequence[object],
    *,
    repdate: date | None = None,
) -> None:
    key = _logical_key(name, {"repdate": repdate})
    shared_rows = tuple(rows)
    for route_id in route_ids:
        stores[route_id][key] = shared_rows


def _put_route_rows(
    stores: _RowStore,
    route_ids: frozenset[str],
    name: str,
    rows: Sequence[Mapping[str, object]],
) -> None:
    for route_id, grouped_rows in _route_groups(rows).items():
        if route_id not in route_ids:
            continue
        grouped_rows.sort(key=lambda row: _row_sort_key(name, row))
        _put(stores, route_id, name, grouped_rows)


def _load_spine_rows(
    stores: _RowStore,
    route_ids: frozenset[str],
    rows: Sequence[Mapping[str, object]],
) -> None:
    grouped: dict[tuple[str, str, object, object], list[dict[str, object]]] = defaultdict(list)
    for source in rows:
        route_id = str(source.get("route_id"))
        name = str(source.get("logical_query"))
        if route_id not in route_ids or name not in _KNOWN_LOGICAL_QUERIES:
            continue
        row = _without(source, "route_id", "logical_query", "win_start", "win_end")
        _expand_histogram(row, "delay_histogram", 21, "h")
        grouped[(route_id, name, source.get("win_start"), source.get("win_end"))].append(row)
    for (route_id, name, win_start, win_end), logical_rows in grouped.items():
        logical_rows.sort(key=lambda row: _row_sort_key(name, row))
        _put(
            stores,
            route_id,
            name,
            logical_rows,
            win_start=win_start,  # type: ignore[arg-type]
            win_end=win_end,  # type: ignore[arg-type]
        )


def _load_headway_windows(
    stores: _RowStore,
    route_ids: frozenset[str],
    rows: Sequence[Mapping[str, object]],
) -> None:
    grouped: dict[tuple[str, object, object], list[dict[str, object]]] = defaultdict(list)
    for source in rows:
        route_id = str(source.get("route_id"))
        if route_id not in route_ids:
            continue
        if source.get("section") == "anchor":
            _put(stores, route_id, "route.headway.anchor", [{"anchor": source.get("anchor")}])
            continue
        row = _without(source, "route_id", "section", "win_start", "win_end", "anchor")
        _expand_histogram(row, "gap_histogram", 20, "g")
        grouped[(route_id, source.get("win_start"), source.get("win_end"))].append(row)
    for (route_id, win_start, win_end), logical_rows in grouped.items():
        logical_rows.sort(
            key=lambda row: (
                int(row.get("direction_id") or 0),
                str(row.get("shift")),
            )
        )
        _put(
            stores,
            route_id,
            "route.headway.window",
            logical_rows,
            win_start=win_start,  # type: ignore[arg-type]
            win_end=win_end,  # type: ignore[arg-type]
        )


def _load_weak_stops(
    stores: _RowStore,
    route_ids: frozenset[str],
    rows: Sequence[Mapping[str, object]],
) -> None:
    grouped: dict[tuple[str, str, object, object], list[dict[str, object]]] = defaultdict(list)
    anchors = {
        str(row.get("route_id")): row.get("anchor")
        for row in rows
        if row.get("section") == "anchor"
    }
    for source in rows:
        route_id = str(source.get("route_id"))
        if route_id not in route_ids:
            continue
        section = str(source.get("section"))
        if section == "anchor":
            _put(stores, route_id, "stop.delay.anchor", [{"anchor": source.get("anchor")}])
            continue
        name = "route.weak_stops.legacy" if section == "legacy" else "route.weak_stops.by_grain"
        win_start = source.get("win_start")
        win_end = source.get("win_end")
        if section == "legacy" and win_start is None and win_end is None:
            win_end = anchors.get(route_id)
            if win_end is not None:
                win_start = win_end - timedelta(days=29)  # type: ignore[operator]
        row = _without(
            source,
            "route_id",
            "section",
            "win_start",
            "win_end",
            "anchor",
            "grain",
        )
        grouped[(route_id, name, win_start, win_end)].append(row)
    for (route_id, name, win_start, win_end), logical_rows in grouped.items():
        logical_rows.sort(key=lambda row: str(row.get("stop_id") or ""))
        _put(
            stores,
            route_id,
            name,
            logical_rows,
            win_start=win_start,  # type: ignore[arg-type]
            win_end=win_end,  # type: ignore[arg-type]
        )


def _load_occupancy(
    stores: _RowStore,
    route_ids: frozenset[str],
    rows: Sequence[Mapping[str, object]],
) -> None:
    names = {
        "band_window": "route.occupancy.band_window",
        "by_dow": "route.occupancy.by_dow",
        "by_grain": "route.occupancy.by_grain",
        "by_hour": "route.occupancy.by_hour",
    }
    grouped: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for source in rows:
        route_id = str(source.get("route_id"))
        name = names.get(str(source.get("section")))
        if route_id not in route_ids or name is None:
            continue
        grouped[(route_id, name)].append(_without(source, "route_id", "section"))
    for (route_id, name), logical_rows in grouped.items():
        logical_rows.sort(
            key=lambda row: (
                str(row.get("d") or ""),
                int(row.get("day_of_week_iso") or 0),
                int(row.get("hour_of_day_local") or 0),
            )
        )
        _put(stores, route_id, name, logical_rows)


def build_all_route_reliability(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
) -> dict[str, RouteReliability]:
    """Build every historic route payload with a constant physical query budget."""

    inventory = _inventory_rows(
        conn.execute(_ROUTE_INVENTORY_SQL, {"provider_id": provider_id})
    )
    route_ids_ordered = sorted(
        {str(row["route_id"]) for row in inventory if row.get("route_id") is not None}
    )
    if not route_ids_ordered:
        return {}
    route_ids = frozenset(route_ids_ordered)
    stores: _RowStore = {
        route_id: {} for route_id in route_ids_ordered
    }
    for row in inventory:
        route_id = str(row["route_id"])
        if route_id in route_ids:
            _put(stores, route_id, "route.spine.anchor", [{"anchor": row.get("spine_anchor")}])

    route_name_rows = _mapping_rows(conn.execute(_ROUTE_NAMES_SQL, {"provider_id": provider_id}))
    stop_name_rows = _mapping_rows(conn.execute(_STOP_NAMES_SQL, {"provider_id": provider_id}))
    route_names = {
        str(row["route_id"]): row.get("route_name")
        for row in route_name_rows
        if str(row.get("route_id")) in route_ids
    }
    stop_names = {
        str(row["stop_id"]): row.get("stop_name")
        for row in stop_name_rows
        if row.get("stop_id") is not None
    }

    _put_route_rows(
        stores,
        route_ids,
        "route.percentile.daily",
        _mapping_rows(conn.execute(_PERCENTILE_DAILY_SQL, {"provider_id": provider_id})),
    )
    daily_rows = _mapping_rows(conn.execute(_DAILY_SQL, {"provider_id": provider_id}))
    daily_groups = _route_groups(daily_rows)
    for route_id, rows in daily_groups.items():
        if route_id in route_ids:
            rows.sort(key=lambda row: str(row.get("d") or ""), reverse=True)
            _put(stores, route_id, "route.reliability.daily", rows)

    _load_spine_rows(
        stores,
        route_ids,
        _mapping_rows(conn.execute(_SPINE_SECTIONS_SQL, {"provider_id": provider_id})),
    )
    _put_route_rows(
        stores,
        route_ids,
        "route.headway.observed_by_shift",
        _mapping_rows(conn.execute(_HEADWAY_OBSERVED_SQL, {"provider_id": provider_id})),
    )

    dataset_rows = _mapping_rows(
        conn.execute(_CURRENT_DATASET_VERSION_SQL, {"provider_id": provider_id})
    )
    _put_shared(stores, route_ids_ordered, "static.dataset_version", dataset_rows)
    if dataset_rows:
        dataset_version_id = dataset_rows[0]["dataset_version_id"]
        static_params = {
            "provider_id": provider_id,
            "dataset_version_id": dataset_version_id,
        }
        rep_rows = _mapping_rows(conn.execute(_REP_DATES_SQL, static_params))
        _put_shared(stores, route_ids_ordered, "static.rep_dates", rep_rows)
        weekday_services: list[str] = []
        weekend_services: list[str] = []
        if rep_rows:
            rep = rep_rows[0]
            weekday_date = rep.get("weekday_date")
            weekend_date = rep.get("weekend_date")
            if weekday_date is not None:
                weekday_services = [
                    str(row[0])
                    for row in conn.execute(
                        _ACTIVE_SERVICES_SQL,
                        {**static_params, "repdate": weekday_date},
                    )
                ]
                _put_shared(
                    stores,
                    route_ids_ordered,
                    "static.active_services",
                    tuple((service,) for service in weekday_services),
                    repdate=weekday_date,  # type: ignore[arg-type]
                )
            if weekend_date is not None:
                weekend_services = [
                    str(row[0])
                    for row in conn.execute(
                        _ACTIVE_SERVICES_SQL,
                        {**static_params, "repdate": weekend_date},
                    )
                ]
                _put_shared(
                    stores,
                    route_ids_ordered,
                    "static.active_services",
                    tuple((service,) for service in weekend_services),
                    repdate=weekend_date,  # type: ignore[arg-type]
                )
        schedule_rows = _mapping_rows(
            conn.execute(
                _ALL_ROUTE_SCHEDULES_SQL,
                {
                    **static_params,
                    "weekday_services": weekday_services or [""],
                    "weekend_services": weekend_services or [""],
                },
            )
        )
        schedules = _route_groups(schedule_rows)
        for route_id, rows in schedules.items():
            if route_id not in route_ids:
                continue
            rows.sort(
                key=lambda row: (
                    int(row.get("direction_id") or 0),
                    not bool(row.get("is_weekday")),
                    str(row.get("departure_time") or ""),
                )
            )
            _put(stores, route_id, "static.route_schedule", rows)

    _put_route_rows(
        stores,
        route_ids,
        "route.headway.by_direction_shift",
        _mapping_rows(conn.execute(_HEADWAY_DIRECTION_SQL, {"provider_id": provider_id})),
    )
    _load_headway_windows(
        stores,
        route_ids,
        _mapping_rows(conn.execute(_HEADWAY_WINDOWS_SQL, {"provider_id": provider_id})),
    )
    _load_weak_stops(
        stores,
        route_ids,
        _mapping_rows(conn.execute(_WEAK_STOPS_SQL, {"provider_id": provider_id})),
    )
    _put_route_rows(
        stores,
        route_ids,
        "route.cancellation.daily",
        _mapping_rows(conn.execute(_CANCELLATIONS_SQL, {"provider_id": provider_id})),
    )
    _load_occupancy(
        stores,
        route_ids,
        _mapping_rows(conn.execute(_OCCUPANCY_SQL, {"provider_id": provider_id})),
    )
    _put_route_rows(
        stores,
        route_ids,
        "route.service_span.daily",
        _mapping_rows(conn.execute(_SERVICE_SPANS_SQL, {"provider_id": provider_id})),
    )
    _put_route_rows(
        stores,
        route_ids,
        "route.skipped_stop.daily",
        _mapping_rows(conn.execute(_SKIPPED_STOPS_SQL, {"provider_id": provider_id})),
    )
    _put_route_rows(
        stores,
        route_ids,
        "route.delay.by_crowding",
        _mapping_rows(conn.execute(_CROWDING_DELAY_SQL, {"provider_id": provider_id})),
    )

    return {
        route_id: build_route_reliability(
            _InMemoryRouteConnection(
                provider_id=provider_id,
                route_id=route_id,
                rows=stores[route_id],
            ),  # type: ignore[arg-type]
            provider_id=provider_id,
            route_id=route_id,
            generated_utc=generated_utc,
            route_names=route_names,  # type: ignore[arg-type]
            stop_names=stop_names,  # type: ignore[arg-type]
        )
        for route_id in route_ids_ordered
    }


__all__ = ["build_all_route_reliability"]
