"""The spine projector factory + the spine-windowed habit-score read.

ONE parameterized template derives every route/network delay-cube breakdown
(by_shift / by_daytype / weekly / monthly / day_of_week / crosstab) at READ
time from gold.route_delay_spine, instead of one stored fold table per
breakdown. The count/share columns are plain SUMs of the spine's additive
counts, so otp_pct / severe_pct / observation_count are BYTE-IDENTICAL to the
fact path; avg_delay_min (pooled sum / in-clamp count) and p50/p90 (CDF
interpolation over the summed histogram) are the allowed rebaseline.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.gold.reader.score import REPEAT_PROBLEM_SCORE_EXPR
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.sql.elements import TextClause


def hist_cols(array_col: str, prefix: str, n: int) -> str:
    """The n element-wise histogram bin SUM columns (Postgres arrays are 1-based)."""
    return ",\n        ".join(
        f"SUM({array_col}[{k}])::bigint AS {prefix}{k}" for k in range(1, n + 1)
    )


# The 21 delay-spine bin sums. Their sum is the in-clamp (ghost-excluded) delay
# count = the pooled-avg denominator; the full vector feeds the p50/p90 CDF walk.
SPINE_HIST_COLS = hist_cols("delay_histogram", "h", 21)

# ONE projector template. {dims} selects the grain column(s) (aliased to what each
# consumer reads); {group_by} is the matching positional GROUP BY + ORDER BY (the
# ORDER BY makes the spine's row order deterministic for byte-stable output).
# on_time is a PLAIN SUM, NOT the fold's CASE WHEN COUNT(*)=COUNT(on_time) guard:
# a spine cell's on_time is NULL iff it has zero delays (delay_obs=0), which adds
# nothing to SUM(on_time) AND nothing to SUM(known_obs), so SUM(on_time)/
# SUM(known_obs) reproduces the fold otp_pct exactly — even for an hour where one
# direction has delays and another is silent (route_delay_hourly merges
# directions, so the fold guard never sees that per-direction NULL). NO window
# clause: the spine accrues forward and every breakdown reads the full accrual —
# the deliberate fix for the "monthly can't hold a month" bug; the cutover gate
# seeds closed days inside the shared window so both paths cover identical days.
# {entity_clause} = ROUTE_ENTITY_CLAUSE for the per-route reads; "" for the
# network reads (aggregate the spine across ALL routes by shift / day_type).
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
    """Format the ONE projector template for a fold (dims carry their trailing comma).

    window_clause defaults to "" so every pre-baked constant formats to text BYTE-IDENTICAL
    to the pre-windowable statements; a windowed read passes SPINE_WINDOW_CLAUSE (bounded
    :win_start/:win_end). `name` is the registry identity tests dispatch on (C1). NOTE:
    the template MUST carry the {window_clause} slot or .format() KeyErrors.
    """
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


# Windowed habits recomposition. reconciled S14 2026-07-02: ONE repeat_problem_score
# formula, owner = gold/reader (see gold/reader/score.py for the dated methodology note,
# ingredients + denominators, composition sites, window semantics, D4 severity vocabulary,
# and the parity-proof pointer). The composite expr + its pooled-avg ingredient are imported
# fragments; this body is recomposed byte-identically from them (the '-- q:route.habit.spine'
# registry body is pinned by tests/test_gold_reader.py::test_c2_touched_statements_byte_identical
# via its frozen SHA256). dow = EXTRACT(ISODOW FROM provider_local_date) + hour_of_day_local
# — both already provider-local (DST-safe; no timestamp reconstruction). Serves BOTH the
# windowed habits_by_grain (trailing GrainWindows) AND — post-S14 — the SCALAR whole-history
# habits matrix, read with an ALL-TIME window (score.all_time_window(anchor)); the
# gold.route_habit_score mart it used to read is dropped (migration 0076).
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
