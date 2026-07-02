"""The ONE repeat-problem composite score — owner = gold/reader kernel.

S14 SCORE RECONCILIATION (2026-07-02)
=====================================
Before S14 the ``repeat_problem_score`` composite had TWO source-of-truth
copies of its SQL:

  * ``UPSERT_ROUTE_HABIT_SCORE`` (gold/rollups.py) — a whole-history per
    (route, ISO-dow, hour) upsert into the ``gold.route_habit_score`` MART; it
    fed the SCALAR ``RouteReliability.habits`` matrix (via ``route.habit.score``).
  * ``ROUTE_HABIT_SPINE_SQL`` (gold/reader/projector.py) — the SAME composite
    recomposed at read time, windowed by ``:win_start``/``:win_end`` off
    ``gold.route_delay_spine``; it feeds the WINDOWED ``habits_by_grain`` ladders.

The stale divergence note at projector.py claimed the two ``avg`` terms diverged
(a spine in-clamp pooled mean vs a mart "obs-weighted avg-of-averages"). That
mart no longer exists post-GC1: ``UPSERT_ROUTE_HABIT_SCORE`` was re-pointed onto
the SAME spine and the SAME pooled-avg numerator/denominator, so the two scores
became ingredient-identical. This module makes that ONE-formula reality explicit:

FORMULA (verbatim, Postgres numeric — half-away-from-zero rounding, never
Python ``round()`` which is banker's):

    LEAST(
        ROUND(
            severe_delay_count * 10
            + GREATEST(COALESCE(pooled_avg_delay_seconds, 0), 0) / 60,
            4),
        9999.9999)

INGREDIENTS + DENOMINATORS:
  * ``severe_delay_count`` = SUM(severe_delay_count) over the group — the
    additive severe-observation count (byte-identical to the fact path).
  * ``pooled_avg_delay_seconds`` = ROUND(SUM(sum_delay_seconds)
        / NULLIF(SUM(Σ unnest(delay_histogram)), 0), 2) — the in-clamp
    (ghost-excluded) POOLED mean: numerator = SUM(sum_delay_seconds), denominator
    = SUM of the per-cell delay-histogram bin totals (the in-clamp delay count).
    NULLIF guards the zero-delay group (denominator 0 → NULL → GREATEST(COALESCE
    (…, 0), 0) = 0, contributing nothing) — the honest-NULL rule (never a false
    observed-calm 0 from a divide-by-zero).
  * ``* 10`` weights each severe observation as 10 "problem points"; ``/ 60``
    converts the pooled mean seconds to minutes so both terms are commensurate.
  * ``LEAST(…, 9999.9999)`` is the Numeric(8,4) storage-cap OVERFLOW GUARD (an
    at-cap cell is simply the route's worst; ``_build_habits_matrix`` normalizes
    per-route so the cap never leaks onto the public [0,1] matrix — slice-9.1.1x).

OWNER: this module (``gold/reader/score.py``). Both composition sites build from
``REPEAT_PROBLEM_SCORE_EXPR`` / ``POOLED_AVG_DELAY_SECONDS_EXPR`` — there is no
second literal copy of the arithmetic.

COMPOSITION SITES:
  * ``ROUTE_HABIT_SPINE_SQL`` (projector.py) recomposes its byte-identical
    ``route.habit.spine`` body from these fragments (the registered query body is
    pinned by tests/test_gold_reader.py::test_c2_touched_statements_byte_identical
    via a frozen SHA256). It serves BOTH the windowed ``habits_by_grain`` (windowed by
    :win_start/:win_end) AND — post-S14 — the SCALAR whole-history ``habits``
    matrix, read with an ALL-TIME window (win_start = _ALL_TIME_FLOOR epoch floor,
    win_end = the route's spine anchor). The ``gold.route_habit_score`` mart is
    DROPPED (migration 0076); ``route.habit.score`` off the mart is removed.

WINDOW SEMANTICS:
  * ALL-TIME (scalar habits): [_ALL_TIME_FLOOR, spine anchor] — covers the full
    accrued spine, reproducing the dropped whole-history mart cell-for-cell.
  * TRAILING (habits_by_grain): the GrainWindows day/week/month windows anchored
    on the newest closed day.

PARITY PROOF: tests/test_habit_score_reconciliation_realdb.py embeds a FROZEN
copy of the old mart SQL and asserts the old-mart scores == the new all-time
reader scores cell-for-cell (numeric equality), with a mutation-killer (perturb
the frozen /60 divisor → the assertion must fail).

D4 — SEVERITY VOCABULARY (document, do NOT rebaseline)
------------------------------------------------------
Three ``severity`` CASE ladders live in this pipeline. They label DIFFERENT
metrics over DIFFERENT windows — they are NOT one metric diverging, so they are
DELIBERATELY NOT merged:

  1. ``repeated_problem`` (gold.repeated_problem_route_stop, ISO-week grain):
     severity off the weekly ``issue_count`` (recurring-severe-week count).
  2. ``repeat_offender`` (gold.repeat_offender, trailing-14d grain): severity off
     ``recurrence_days`` (distinct severe days) — critical when recurrence_days
     >= 10 OR avg_delay_seconds > 600; high when recurrence_days >= 5; else watch.
  3. ``by_grain`` repeat-offender entries (trailing week/month windows): the SAME
     declared vocabulary as (2) — recurrence >= 10 OR avg > 600 critical; >= 5
     high; else watch — applied to the ENTRY's own trailing window.

Each ladder's thresholds are DECLARED where it is computed; no threshold changes
in S14 (byte parity). The web STOPS re-deriving severity client-side and uses the
published value (absent → honest-absence neutral, never recomputed).
"""

from __future__ import annotations

from datetime import date

# The epoch floor for the ALL-TIME scalar-habits window. The spine's provider_local_date
# is always >= this, so [_ALL_TIME_FLOOR, anchor] covers the entire accrued spine
# (reproducing the dropped whole-history mart's un-windowed aggregate). A fixed floor —
# not the spine MIN(date) — keeps the read a single bounded scan without an extra MIN probe;
# SPINE_WINDOW_CLAUSE binds it as :win_start.
_ALL_TIME_FLOOR = date(1970, 1, 1)


def all_time_window(anchor: date) -> tuple[date, date]:
    """[_ALL_TIME_FLOOR, anchor] — the whole-history window for the scalar habits
    read (win_start floor + the route's spine anchor as win_end)."""
    return (_ALL_TIME_FLOOR, anchor)


# The pooled in-clamp mean delay (seconds) ingredient — ROUND(SUM(sum_delay_seconds)
# / NULLIF(SUM(Σ unnest(delay_histogram)), 0), 2). NULLIF → NULL on a zero-delay group
# (honest-NULL, never a divide-by-zero). Used INSIDE the score expr's GREATEST(COALESCE…).
# Assembled from per-line pieces so no SOURCE line exceeds the 100-char limit while the
# COMPOSED SQL text stays byte-identical to the pre-S14 route.habit.spine body (the one
# NULLIF line is 101 chars in the SQL; it is joined here from two adjacent fragments).
POOLED_AVG_DELAY_SECONDS_EXPR = "\n".join(
    (
        "ROUND(",
        "                    SUM(sum_delay_seconds)::numeric",
        "                    / NULLIF(SUM((SELECT COALESCE(SUM(x), 0) "
        "FROM unnest(delay_histogram) AS x)), 0),",
        "                    2)",
    )
)


# The ONE composite repeat_problem_score expression (severe*10 + pooled_avg/60, clamped).
# Indented to sit under a `SELECT\n        ` (8-space) column list; the trailing
# `AS repeat_problem_score` alias is left to the composition site. Postgres numeric
# rounding throughout (half-away-from-zero) — never Python round().
REPEAT_PROBLEM_SCORE_EXPR = f"""LEAST(
            ROUND(
                SUM(severe_delay_count)::numeric * 10
                + GREATEST(COALESCE({POOLED_AVG_DELAY_SECONDS_EXPR}, 0), 0) / 60,
                4),
            9999.9999)"""
