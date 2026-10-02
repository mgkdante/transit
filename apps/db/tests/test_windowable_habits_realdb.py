
from __future__ import annotations

from contextlib import contextmanager
from datetime import date

import pytest
from sqlalchemy import text
from test_spine_cutover_gate import (  # noqa: E402
    PROVIDER,
    ROUTE,
    _anchor_today,
    _build,
    _seed,
)

from transit_ops.snapshots.builders.historic._spine import (
    _ROUTE_HABIT_SPINE_SQL,
    _grain_windows,
    _spine_habits_by_grain,
    _spine_periods_by_grain,
)


@pytest.fixture()
def conn(real_db_engine):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            _seed(connection)
            _build(connection)
            yield connection
        finally:
            transaction.rollback()


def _params() -> dict:
    return {"provider_id": PROVIDER, "route_id": ROUTE}


def test_windowed_habits_matrix_bounded_and_no_sentinel_leak(conn) -> None:
    out = _spine_habits_by_grain(conn, _params())
    assert {h.grain for h in out} == {"day", "week", "month"}
    for h in out:
        if h.habits is None:
            continue
        for row in h.habits.matrix:
            for cell in row:
                assert cell is None or (0.0 <= cell <= 1.0), f"cell {cell} out of [0,1]"
                assert cell != 9999.9999, "raw sentinel leaked onto the matrix"


def test_windowed_habits_honest_absence_under_min_n(conn) -> None:
    out = {h.grain: h for h in _spine_habits_by_grain(conn, _params())}
    m = out["month"]
    assert m.habits is None, "too-sparse window must suppress the heatmap entirely (no grey grid)"
    assert m.cells_suppressed > 0
    assert m.cells_observed == 0


def test_periods_by_grain_no_histogram_and_prior_matches_identical_prior_day(conn) -> None:
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
            assert p.prior_otp_pct == p.otp_pct, (
                "prior OTP must equal the identical prior day's OTP"
            )
            checked += 1
    assert checked > 0, "no by_shift period had observations to verify the prior against"


def test_recomposition_sql_runs_and_clamps_in_range(conn) -> None:
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


_DENSE_PROVIDER = "stm_dense_habits"
_DENSE_ROUTE = "D1"
_HIST = "{" + ",".join(["60"] + ["0"] * 20) + "}"
_HIST_CAP = "{" + ",".join(["1001"] + ["0"] * 20) + "}"
_D_NORMAL = date(2026, 6, 1)
_D_ATCAP = date(2026, 6, 2)


@contextmanager
def _dense_conn(real_db_engine, seed_provider):  # noqa: ANN001, ANN202
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        try:
            seed_provider(conn, _DENSE_PROVIDER, display_name="dense habits seed")
            ins = text(
                "INSERT INTO gold.route_delay_spine (provider_id, route_id, provider_local_date, "
                "hour_of_day_local, direction_id, observation_count, delay_observation_count, "
                "on_time_observation_count, severe_delay_count, sum_delay_seconds, "
                "delay_histogram) VALUES (:p, :r, :d, :h, 0, :obs, :dobs, :ot, "
                ":sev, :sum, CAST(:hist AS smallint[]))"
            )
            conn.execute(
                ins,
                {
                    "p": _DENSE_PROVIDER,
                    "r": _DENSE_ROUTE,
                    "d": _D_NORMAL,
                    "h": 8,
                    "obs": 60,
                    "dobs": 60,
                    "ot": 58,
                    "sev": 2,
                    "sum": 3600,
                    "hist": _HIST,
                },
            )
            conn.execute(
                ins,
                {
                    "p": _DENSE_PROVIDER,
                    "r": _DENSE_ROUTE,
                    "d": _D_ATCAP,
                    "h": 9,
                    "obs": 1001,
                    "dobs": 1001,
                    "ot": 0,
                    "sev": 1001,
                    "sum": 0,
                    "hist": _HIST_CAP,
                },
            )
            yield conn
        finally:
            tx.rollback()


def _dense_params() -> dict:
    return {"provider_id": _DENSE_PROVIDER, "route_id": _DENSE_ROUTE}


def test_dense_recomposition_matches_handcomputed_pooled_formula(
    real_db_engine, seed_provider
) -> None:
    with _dense_conn(real_db_engine, seed_provider) as conn:
        ws, we = _grain_windows(_D_ATCAP)["month"]
        scores = {
            (int(r["day_of_week_iso"]), int(r["hour_of_day_local"])): float(
                r["repeat_problem_score"]
            )
            for r in conn.execute(
                _ROUTE_HABIT_SPINE_SQL,
                {**_dense_params(), "win_start": ws, "win_end": we},
            ).mappings()
        }
    normal_key = (_D_NORMAL.isoweekday(), 8)
    atcap_key = (_D_ATCAP.isoweekday(), 9)
    assert scores[normal_key] == 21.0, f"pooled-mean rebaseline wrong: {scores[normal_key]}"
    assert scores[atcap_key] == 9999.9999, "at-cap cell must clamp to the 9999.9999 sentinel in SQL"


def test_dense_matrix_bounded_atcap_normalizes_to_one_no_sentinel(
    real_db_engine, seed_provider
) -> None:
    with _dense_conn(real_db_engine, seed_provider) as conn:
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
    assert month.habits.matrix[_D_ATCAP.isoweekday() - 1][9] == 1.0
    assert saw_one
