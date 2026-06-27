"""Real-DB parity + honest-absence gate for the S7-B windowable §1 build (DB-PR-1).

Self-skips when TRANSIT_TEST_DATABASE_URL is unset (the `real-db-tests` job sets it):

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@127.0.0.1:54329/transit_test" \
        uv run pytest tests/test_windowable_habits_realdb.py -v

Reuses the rich, calendar-stable seed + the seeded-connection contextmanager from the
spine cutover gate (7 identical closed days; ~3 delay obs per dow×hour cell — well under
MIN_N=30, so the windowed heatmap must honestly suppress, never paint a sea of grey).
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date

import pytest
from sqlalchemy import create_engine, text

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


def test_periods_by_grain_no_histogram_and_prior_matches_identical_prior_day() -> None:
    """periods_by_grain emits the 3 grains; windowed by_shift/by_daytype periods carry NO 21-bin
    histogram (F1). S1: the seed is 7 IDENTICAL days, so the day-grain PRIOR window (anchor-1) is
    an identical day -> prior_observation_count == this period's observation_count (proving the
    prior denominator is known_obs, EDGE-9) and prior_otp_pct == otp_pct."""
    with _seeded_conn() as conn:
        out = {g.grain: g for g in _spine_periods_by_grain(conn, _params())}
    assert set(out) == {"day", "week", "month"}
    for g in out.values():
        for p in (*g.by_shift, *g.by_daytype):
            assert p.delay_histogram is None, "windowed period must suppress the histogram (F1)"
    day = out["day"]
    assert day.by_shift, "day grain produced no by_shift periods"
    checked = 0
    for p in day.by_shift:
        if p.observation_count and p.observation_count > 0:
            assert p.prior_observation_count == p.observation_count, (
                "prior n must equal the identical prior day's known_obs (EDGE-9 denominator)"
            )
            assert p.prior_otp_pct == p.otp_pct, "prior OTP must equal the identical prior day's OTP"
            checked += 1
    assert checked > 0, "no by_shift period had observations to verify the prior against"


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


# --- DENSE seed: rows that CLEAR MIN_N=30, so the matrix / sentinel / rebaseline paths
#     actually execute assertions (the sparse cutover seed suppresses every cell). We seed
#     gold.route_delay_spine DIRECTLY — the habits recomposition reads only the spine. ---
_DENSE_PROVIDER = "stm_dense_habits"
_DENSE_ROUTE = "D1"
_HIST = "{" + ",".join(["60"] + ["0"] * 20) + "}"  # 21-bin smallint[], in-clamp count = 60
_HIST_CAP = "{" + ",".join(["1001"] + ["0"] * 20) + "}"  # in-clamp count = 1001
# Normal cell: severe=2, in_clamp=60, sum=3600 -> avg=60s -> score = 2*10 + 60/60 = 21.0 (clean).
_D_NORMAL = date(2026, 6, 1)
# At-cap cell: severe=1001 -> 1001*10 = 10010 > 9999.9999 -> LEAST clamps -> normalizes to 1.0.
_D_ATCAP = date(2026, 6, 2)


@contextmanager
def _dense_conn():  # noqa: ANN202
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text(
                    "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
                    "VALUES (:p, 'dense habits seed', 'America/Toronto', :p)"
                ),
                {"p": _DENSE_PROVIDER},
            )
            ins = text(
                "INSERT INTO gold.route_delay_spine (provider_id, route_id, service_local_date, "
                "hour_of_day_local, direction_id, observation_count, delay_observation_count, "
                "on_time_observation_count, severe_delay_count, sum_delay_seconds, delay_histogram) "
                "VALUES (:p, :r, :d, :h, 0, :obs, :dobs, :ot, :sev, :sum, CAST(:hist AS smallint[]))"
            )
            conn.execute(
                ins,
                {"p": _DENSE_PROVIDER, "r": _DENSE_ROUTE, "d": _D_NORMAL, "h": 8, "obs": 60,
                 "dobs": 60, "ot": 58, "sev": 2, "sum": 3600, "hist": _HIST},
            )
            conn.execute(
                ins,
                {"p": _DENSE_PROVIDER, "r": _DENSE_ROUTE, "d": _D_ATCAP, "h": 9, "obs": 1001,
                 "dobs": 1001, "ot": 0, "sev": 1001, "sum": 0, "hist": _HIST_CAP},
            )
            yield conn
        finally:
            tx.rollback()
    engine.dispose()


def _dense_params() -> dict:
    return {"provider_id": _DENSE_PROVIDER, "route_id": _DENSE_ROUTE}


def test_dense_recomposition_matches_handcomputed_pooled_formula() -> None:
    """M2: the recomposed score IS the in-clamp pooled mean (severe*10 + ROUND(Σsum/Σin_clamp,2)/60),
    NOT severe-only and NOT the mart's obs-weighted avg-of-averages. Normal cell -> exactly 21.0."""
    with _dense_conn() as conn:
        ws, we = _grain_windows(_D_ATCAP)["month"]  # anchor = max(date) = _D_ATCAP; covers both
        scores = {
            (int(r["day_of_week_iso"]), int(r["hour_of_day_local"])): float(r["repeat_problem_score"])
            for r in conn.execute(
                _ROUTE_HABIT_SPINE_SQL,
                {**_dense_params(), "win_start": ws, "win_end": we},
            ).mappings()
        }
    normal_key = (_D_NORMAL.isoweekday(), 8)
    atcap_key = (_D_ATCAP.isoweekday(), 9)
    assert scores[normal_key] == 21.0, f"pooled-mean rebaseline wrong: {scores[normal_key]}"
    assert scores[atcap_key] == 9999.9999, "at-cap cell must clamp to the 9999.9999 sentinel in SQL"


def test_dense_matrix_bounded_atcap_normalizes_to_one_no_sentinel() -> None:
    """M1: with cells clearing MIN_N, habits is NON-null and every cell is in [0,1]; the at-cap
    cell normalizes to exactly 1.0 (route max) and the raw 9999.9999 NEVER leaks."""
    with _dense_conn() as conn:
        out = {h.grain: h for h in _spine_habits_by_grain(conn, _dense_params())}
    month = out["month"]
    assert month.habits is not None, "dense window must paint a matrix (cells cleared MIN_N)"
    assert month.cells_observed == 2 and month.cells_suppressed == 0
    saw_one = False
    for di, row in enumerate(month.habits.matrix):
        for hi, cell in enumerate(row):
            assert cell is None or (0.0 <= cell <= 1.0), f"cell ({di},{hi})={cell} out of [0,1]"
            assert cell != 9999.9999, "raw sentinel leaked onto the published matrix"
            if cell == 1.0:
                saw_one = True
    # the at-cap cell is the route max -> normalizes to exactly 1.0
    assert month.habits.matrix[_D_ATCAP.isoweekday() - 1][9] == 1.0
    assert saw_one
