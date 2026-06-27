"""Real-DB parity + honest-absence gate for the S7-B windowable §1 build (DB-PR-1).

Self-skips when TRANSIT_TEST_DATABASE_URL is unset (the `real-db-tests` job sets it):

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@127.0.0.1:54329/transit_test" \
        uv run pytest tests/test_windowable_habits_realdb.py -v

Reuses the rich, calendar-stable seed + the seeded-connection contextmanager from the
spine cutover gate (7 identical closed days; ~3 delay obs per dow×hour cell — well under
MIN_N=30, so the windowed heatmap must honestly suppress, never paint a sea of grey).
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from transit_ops.snapshots.builders.historic import (
    _ROUTE_HABIT_SPINE_SQL,
    _grain_windows,
    _spine_habits_by_grain,
    _spine_periods_by_grain,
)

# The cutover gate owns the seed + the disposable-connection contextmanager; reuse them.
from test_spine_cutover_gate import (  # noqa: E402
    DB_URL,
    PROVIDER,
    ROUTE,
    _anchor_today,
    _seeded_conn,
)

pytestmark = pytest.mark.skipif(
    not DB_URL, reason="TRANSIT_TEST_DATABASE_URL not set - windowable habits real-DB gate skipped"
)


def _params() -> dict:
    return {"provider_id": PROVIDER, "route_id": ROUTE}


def test_habits_severe_term_byte_identical_to_mart() -> None:
    """The severe*10 BASE of the spine recomposition is byte-identical to route_habit_score
    (both SUM the exact severe predicate over the same day-set). Only the avg/60 term is the
    documented rebaseline — NOT asserted here."""
    with _seeded_conn() as conn:
        anchor = _anchor_today(conn)
        ws, we = _grain_windows(anchor)["month"]  # covers all 7 seeded days = full accrual
        spine = {
            (int(r["dow"]), int(r["hour"])): int(r["severe"])
            for r in conn.execute(
                text(
                    "SELECT EXTRACT(ISODOW FROM service_local_date)::int AS dow, "
                    "hour_of_day_local AS hour, SUM(severe_delay_count)::int AS severe "
                    "FROM gold.route_delay_spine "
                    "WHERE provider_id=:p AND route_id=:r "
                    "AND service_local_date BETWEEN :ws AND :we GROUP BY 1, 2"
                ),
                {"p": PROVIDER, "r": ROUTE, "ws": ws, "we": we},
            ).mappings()
        }
        mart = {
            (int(r["day_of_week_iso"]), int(r["hour_of_day_local"])): int(r["severe_delay_count"])
            for r in conn.execute(
                text(
                    "SELECT day_of_week_iso, hour_of_day_local, severe_delay_count "
                    "FROM gold.route_habit_score WHERE provider_id=:p AND route_id=:r"
                ),
                {"p": PROVIDER, "r": ROUTE},
            ).mappings()
        }
    assert mart, "seed produced no route_habit_score rows"
    assert spine == mart, "spine severe term diverges from the route_habit_score mart"


def test_windowed_habits_matrix_bounded_and_no_sentinel_leak() -> None:
    """Every emitted matrix cell is in [0,1] (or None) — the 9999.9999 storage cap never leaks
    (the slice-9.1.1x sentinel guard, via _build_habits_matrix normalization)."""
    with _seeded_conn() as conn:
        out = _spine_habits_by_grain(conn, _params())
    assert {h.grain for h in out} == {"day", "week", "month"}
    for h in out:
        if h.habits is None:
            continue
        for row in h.habits.matrix:
            for cell in row:
                assert cell is None or (0.0 <= cell <= 1.0), f"cell {cell} out of [0,1]"
                assert cell != 9999.9999, "raw sentinel leaked onto the matrix"


def test_windowed_habits_honest_absence_under_min_n() -> None:
    """The seed's ~3 obs/cell is far below MIN_N=30, so every cell is suppressed: habits=None
    + cells_suppressed>0 + cells_observed==0 (one honest chip, never a grey 7x24 grid)."""
    with _seeded_conn() as conn:
        out = {h.grain: h for h in _spine_habits_by_grain(conn, _params())}
    m = out["month"]
    assert m.habits is None, "too-sparse window must suppress the heatmap entirely (no grey grid)"
    assert m.cells_suppressed > 0
    assert m.cells_observed == 0


def test_periods_by_grain_windowed_no_histogram_and_prior_safe() -> None:
    """periods_by_grain emits the 3 grains; windowed by_shift/by_daytype periods carry NO
    21-bin histogram (F1 payload guard); prior_* fields are valid-int-or-None (never crash)."""
    with _seeded_conn() as conn:
        out = {g.grain: g for g in _spine_periods_by_grain(conn, _params())}
    assert set(out) == {"day", "week", "month"}
    for g in out.values():
        for p in (*g.by_shift, *g.by_daytype):
            assert p.delay_histogram is None, "windowed period must suppress the histogram (F1)"
            assert p.prior_observation_count is None or isinstance(p.prior_observation_count, int)
            assert p.prior_otp_pct is None or isinstance(p.prior_otp_pct, int)


def test_recomposition_sql_runs_and_clamps_in_range() -> None:
    """The raw recomposition SQL executes and every score is within [0, 9999.9999] (the SQL
    LEAST clamp), proving the numeric composite + sentinel clamp fire server-side."""
    with _seeded_conn() as conn:
        anchor = _anchor_today(conn)
        ws, we = _grain_windows(anchor)["month"]
        rows = list(
            conn.execute(
                _ROUTE_HABIT_SPINE_SQL,
                {"provider_id": PROVIDER, "route_id": ROUTE, "win_start": ws, "win_end": we},
            ).mappings()
        )
    assert rows, "recomposition produced no rows over the full window"
    for r in rows:
        score = float(r["repeat_problem_score"])
        assert 0.0 <= score <= 9999.9999
