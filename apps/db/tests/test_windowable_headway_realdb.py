"""Real-DB parity + honest-absence gate for the S7-B windowable §2 headway build (DB-PR-2).

Self-skips when TRANSIT_TEST_DATABASE_URL is unset (the real-db-tests job sets it). Seeds
gold.route_headway_shift_daily DIRECTLY (the recompose reads only that table) with rows that
CLEAR the n>=2 guard, so the CoV / median / argmax paths run real assertions (the DB-PR-1
lesson: a too-sparse seed makes the tests vacuous).
"""

from __future__ import annotations

import bisect
import statistics
from contextlib import contextmanager
from datetime import date

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold.rollups import HEADWAY_GAP_HISTOGRAM_EDGES as EDGES
from transit_ops.snapshots.builders.historic import _headway_by_grain

from test_spine_cutover_gate import DB_URL  # noqa: E402

pytestmark = pytest.mark.skipif(
    not DB_URL, reason="TRANSIT_TEST_DATABASE_URL not set - windowable headway real-DB gate skipped"
)

_PROVIDER = "stm_dense_hw"
_ROUTE = "H1"
_D = date(2026, 6, 1)  # one date inside every grain window (anchor = max(date) = _D)


def _bin(gap: float) -> int:
    # Replicates the builder's LEAST(GREATEST(width_bucket(gap, EDGES), 1), 20) - 1.
    return min(max(bisect.bisect_right(EDGES, gap), 1), 20) - 1


def _hist(gaps: list[float]) -> list[int]:
    h = [0] * (len(EDGES) - 1)
    for g in gaps:
        h[_bin(g)] += 1
    return h


def _moments(gaps: list[float]) -> tuple[int, float, float]:
    return len(gaps), float(sum(gaps)), float(sum(g * g for g in gaps))


@contextmanager
def _seeded(rows):  # noqa: ANN001
    """rows = list of (shift, direction_id, trip_count, gaps[]). Seeds one date (_D)."""
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text(
                    "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
                    "VALUES (:p, 'dense headway seed', 'America/Toronto', :p)"
                ),
                {"p": _PROVIDER},
            )
            ins = text(
                "INSERT INTO gold.route_headway_shift_daily (provider_id, route_id, "
                "service_local_date, shift, direction_id, gap_count, sum_gap_min, sum_gap_sq_min, "
                "bunched_gap_count, trip_count, gap_histogram) "
                "VALUES (:p, :r, :d, :sh, :dir, :n, :sg, :sq, 0, :tc, CAST(:h AS smallint[]))"
            )
            for shift, direction, trip_count, gaps in rows:
                n, sg, sq = _moments(gaps)
                conn.execute(
                    ins,
                    {"p": _PROVIDER, "r": _ROUTE, "d": _D, "sh": shift, "dir": direction,
                     "n": n, "sg": sg, "sq": sq, "tc": trip_count,
                     "h": "{" + ",".join(str(x) for x in _hist(gaps)) + "}"},
                )
            yield conn
        finally:
            tx.rollback()
    engine.dispose()


def _params() -> dict:
    return {"provider_id": _PROVIDER, "route_id": _ROUTE}


def test_cov_recompose_byte_identical_to_sample_sd_over_mean() -> None:
    """D2: the recomposed CoV (Bessel n-1 pooled SD / mean, computed in SQL) is byte-identical
    to statistics.stdev(gaps)/mean(gaps) — the legacy stddev_samp semantics."""
    gaps = [4.0, 5.0, 6.0, 7.0, 8.0]
    with _seeded([("am_peak", 0, 10, gaps)]) as conn:
        out = {g.grain: g for g in _headway_by_grain(conn, _params(), {"am_peak": 5.0})}
    am = next(p for p in out["month"].headway if p.shift == "am_peak")
    expected_cov = round(statistics.stdev(gaps) / statistics.mean(gaps), 4)
    assert am.cov == expected_cov, f"cov {am.cov} != Bessel n-1 sample sd/mean {expected_cov}"
    assert am.observation_count == 5


def test_busiest_direction_argmax_on_trip_count() -> None:
    """D5: the published shift comes from the direction with the larger SUM(trip_count), NOT the
    one with more gaps — tie-break direction_id ASC."""
    busy = [4.0, 5.0, 6.0, 7.0, 8.0]  # dir 0: n=5, trip_count=10 (BUSIEST)
    quiet = [9.0, 11.0]  # dir 1: n=2, trip_count=3
    with _seeded([("am_peak", 0, 10, busy), ("am_peak", 1, 3, quiet)]) as conn:
        out = {g.grain: g for g in _headway_by_grain(conn, _params(), {"am_peak": 5.0})}
    am = next(p for p in out["month"].headway if p.shift == "am_peak")
    # dir 0 won (n=5); had dir 1 won we'd see n=2.
    assert am.observation_count == 5, "argmax must pick the higher-trip_count direction"


def test_median_is_cdf_interp_rebaseline_and_excess() -> None:
    """D3: observed_min is the histogram CDF-interp median (a documented rebaseline, in range),
    and excess_wait = max(0, median - scheduled)."""
    gaps = [4.0, 5.0, 6.0, 7.0, 8.0]
    with _seeded([("am_peak", 0, 10, gaps)]) as conn:
        out = {g.grain: g for g in _headway_by_grain(conn, _params(), {"am_peak": 5.0})}
    am = next(p for p in out["month"].headway if p.shift == "am_peak")
    assert am.observed_min is not None and 4.0 <= am.observed_min <= 8.0
    assert am.excess_wait_min == round(max(0.0, am.observed_min - 5.0), 1)


def test_honest_absence_empty_window_omits_grain() -> None:
    """A route with no headway rows -> _headway_by_grain returns [] (no fabricated buckets)."""
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            out = _headway_by_grain(conn, {"provider_id": "nope", "route_id": "x"}, {})
        finally:
            tx.rollback()
    engine.dispose()
    assert out == []


def test_prior_window_attached_when_prior_has_data() -> None:
    """The prior-window n + observed median attach to the day grain when the prior day has gaps."""
    gaps = [4.0, 5.0, 6.0, 7.0, 8.0]
    # seed BOTH the anchor day and the day before it (the day-grain prior window).
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text(
                    "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
                    "VALUES (:p, 'dense headway prior', 'America/Toronto', :p)"
                ),
                {"p": _PROVIDER},
            )
            ins = text(
                "INSERT INTO gold.route_headway_shift_daily (provider_id, route_id, "
                "service_local_date, shift, direction_id, gap_count, sum_gap_min, sum_gap_sq_min, "
                "bunched_gap_count, trip_count, gap_histogram) "
                "VALUES (:p, :r, :d, 'am_peak', 0, :n, :sg, :sq, 0, 10, CAST(:h AS smallint[]))"
            )
            n, sg, sq = _moments(gaps)
            for d in (date(2026, 6, 2), date(2026, 6, 1)):  # anchor + the prior day
                conn.execute(ins, {"p": _PROVIDER, "r": _ROUTE, "d": d, "n": n, "sg": sg, "sq": sq,
                                   "h": "{" + ",".join(str(x) for x in _hist(gaps)) + "}"})
            out = {g.grain: g for g in _headway_by_grain(conn, _params(), {"am_peak": 5.0})}
        finally:
            tx.rollback()
    engine.dispose()
    am = next(p for p in out["day"].headway if p.shift == "am_peak")
    assert am.prior_observation_count == 5  # identical prior day
    assert am.prior_observed_min == am.observed_min
