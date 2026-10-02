from __future__ import annotations

from datetime import date

# The fixed epoch floor avoids an extra minimum-date query for whole-history reads.
_ALL_TIME_FLOOR = date(1970, 1, 1)


def all_time_window(anchor: date) -> tuple[date, date]:
    return (_ALL_TIME_FLOOR, anchor)


POOLED_AVG_DELAY_SECONDS_EXPR = "\n".join(
    (
        "ROUND(",
        "                    SUM(sum_delay_seconds)::numeric",
        "                    / NULLIF(SUM((SELECT COALESCE(SUM(x), 0) "
        "FROM unnest(delay_histogram) AS x)), 0),",
        "                    2)",
    )
)


# Use PostgreSQL numeric rounding, which rounds ties away from zero.
REPEAT_PROBLEM_SCORE_EXPR = f"""LEAST(
            ROUND(
                SUM(severe_delay_count)::numeric * 10
                + GREATEST(COALESCE({POOLED_AVG_DELAY_SECONDS_EXPR}, 0), 0) / 60,
                4),
            9999.9999)"""
