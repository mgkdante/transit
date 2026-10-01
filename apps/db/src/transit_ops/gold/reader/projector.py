from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.gold.reader.score import REPEAT_PROBLEM_SCORE_EXPR
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.sql.elements import TextClause


def hist_cols(array_col: str, prefix: str, n: int) -> str:
    return ",\n        ".join(
        f"SUM({array_col}[{k}])::bigint AS {prefix}{k}" for k in range(1, n + 1)
    )


# Histogram sums are the in-clamp denominator for pooled means and percentiles.
SPINE_HIST_COLS = hist_cols("delay_histogram", "h", 21)

# Already-local date/hour columns must not be timezone-converted again.
PROJECT_TEMPLATE = """
    SELECT
        {dims}
        SUM(observation_count)::bigint          AS obs,
        SUM(delay_observation_count)::bigint    AS known_obs,
        SUM(on_time_observation_count)::bigint  AS on_time,
        SUM(severe_delay_count)::bigint         AS severe,
        SUM(sum_delay_seconds)::bigint          AS sum_delay_sec,
        {hist_cols}
    FROM gold.route_delay_spine
    WHERE provider_id = :provider_id{entity_clause}{window_clause}
    GROUP BY {group_by}
    ORDER BY {group_by}
"""

ROUTE_ENTITY_CLAUSE = " AND route_id = :route_id"


def spine_project_sql(
    name: str,
    dims: str,
    group_by: str,
    entity_clause: str = ROUTE_ENTITY_CLAUSE,
    window_clause: str = "",
) -> TextClause:
    return named_query(
        name,
        PROJECT_TEMPLATE.format(
            dims=dims,
            hist_cols=SPINE_HIST_COLS,
            group_by=group_by,
            entity_clause=entity_clause,
            window_clause=window_clause,
        ),
    )


# Scalar and windowed habits use the same score expression with different window bounds.
ROUTE_HABIT_SPINE_SQL = named_query(
    "route.habit.spine",
    f"""
    SELECT
        EXTRACT(ISODOW FROM provider_local_date)::integer AS day_of_week_iso,
        hour_of_day_local,
        SUM(delay_observation_count)::bigint AS known_obs,
        {REPEAT_PROBLEM_SCORE_EXPR} AS repeat_problem_score
    FROM gold.route_delay_spine
    WHERE provider_id = :provider_id AND route_id = :route_id
      AND provider_local_date >= :win_start AND provider_local_date <= :win_end
    GROUP BY 1, 2
"""
)
