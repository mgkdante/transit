
from __future__ import annotations

import bisect
import statistics
from contextlib import contextmanager
from datetime import date

from sqlalchemy import text

from transit_ops.gold.rollups import HEADWAY_GAP_HISTOGRAM_EDGES as EDGES
from transit_ops.snapshots.builders.historic._spine import _headway_by_grain

_PROVIDER = "stm_dense_hw"
_ROUTE = "H1"
_D = date(2026, 6, 1)


def _bin(gap: float) -> int:
    return min(max(bisect.bisect_right(EDGES, gap), 1), 20) - 1


def _hist(gaps: list[float]) -> list[int]:
    h = [0] * (len(EDGES) - 1)
    for g in gaps:
        h[_bin(g)] += 1
    return h


def _moments(gaps: list[float]) -> tuple[int, float, float]:
    return len(gaps), float(sum(gaps)), float(sum(g * g for g in gaps))


@contextmanager
def _seeded(rows, real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        try:
            seed_provider(conn, _PROVIDER, display_name="dense headway seed")
            ins = text(
                "INSERT INTO gold.route_headway_shift_daily (provider_id, route_id, "
                "provider_local_date, shift, direction_id, gap_count, sum_gap_min, sum_gap_sq_min, "
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


def _params() -> dict:
    return {"provider_id": _PROVIDER, "route_id": _ROUTE}


def test_cov_recompose_byte_identical_to_sample_sd_over_mean(real_db_engine, seed_provider) -> None:
    gaps = [4.0, 5.0, 6.0, 7.0, 8.0]
    with _seeded([("am_peak", 0, 10, gaps)], real_db_engine, seed_provider) as conn:
        out = {g.grain: g for g in _headway_by_grain(conn, _params(), {"am_peak": 5.0})}
    am = next(p for p in out["month"].headway if p.shift == "am_peak")
    expected_cov = round(statistics.stdev(gaps) / statistics.mean(gaps), 4)
    assert am.cov == expected_cov, f"cov {am.cov} != Bessel n-1 sample sd/mean {expected_cov}"
    assert am.observation_count == 5


def test_busiest_direction_argmax_on_trip_count_not_gap_count(
    real_db_engine, seed_provider
) -> None:
    few_gaps_busy = [5.0, 5.0]
    many_gaps_quiet = [4.0, 5.0, 6.0, 7.0, 8.0]
    with _seeded(
        [("am_peak", 0, 20, few_gaps_busy), ("am_peak", 1, 3, many_gaps_quiet)],
        real_db_engine,
        seed_provider,
    ) as conn:
        out = {g.grain: g for g in _headway_by_grain(conn, _params(), {"am_peak": 5.0})}
    am = next(p for p in out["month"].headway if p.shift == "am_peak")
    assert am.observation_count == 2, "argmax must rank trip_count, NOT gap_count"


def test_median_is_cdf_interp_rebaseline_and_ewt(real_db_engine, seed_provider) -> None:
    gaps = [4.0, 5.0, 6.0, 7.0, 8.0]
    with _seeded([("am_peak", 0, 10, gaps)], real_db_engine, seed_provider) as conn:
        out = {g.grain: g for g in _headway_by_grain(conn, _params(), {"am_peak": 5.0})}
    am = next(p for p in out["month"].headway if p.shift == "am_peak")
    assert am.observed_min is not None and 4.0 <= am.observed_min <= 8.0
    _n, sg, sq = _moments(gaps)
    expected_ewt = round(max(0.0, sq / (2.0 * sg) - 5.0 / 2.0), 1)
    assert expected_ewt == 0.7
    assert am.excess_wait_min == expected_ewt


def test_cross_day_week_grain_pools_moments(real_db_engine, seed_provider) -> None:
    d1, d2 = date(2026, 6, 1), date(2026, 6, 2)
    day1, day2 = [4.0, 6.0], [5.0, 5.0]
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        try:
            seed_provider(conn, _PROVIDER, display_name="dense headway xday")
            ins = text(
                "INSERT INTO gold.route_headway_shift_daily (provider_id, route_id, "
                "provider_local_date, shift, direction_id, gap_count, sum_gap_min, sum_gap_sq_min, "
                "bunched_gap_count, trip_count, gap_histogram) "
                "VALUES (:p, :r, :d, 'am_peak', 0, :n, :sg, :sq, 0, 10, CAST(:h AS smallint[]))"
            )
            for d, gaps in ((d1, day1), (d2, day2)):
                n, sg, sq = _moments(gaps)
                conn.execute(ins, {"p": _PROVIDER, "r": _ROUTE, "d": d, "n": n, "sg": sg, "sq": sq,
                                   "h": "{" + ",".join(str(x) for x in _hist(gaps)) + "}"})
            out = {g.grain: g for g in _headway_by_grain(conn, _params(), {"am_peak": 5.0})}
        finally:
            tx.rollback()
    am = next(p for p in out["week"].headway if p.shift == "am_peak")
    pooled = day1 + day2
    assert am.observation_count == 4, "week grain must POOL both days' gaps, not use one day"
    assert am.cov == round(statistics.stdev(pooled) / statistics.mean(pooled), 4)


def test_honest_absence_empty_window_omits_grain(real_db_engine) -> None:
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        try:
            out = _headway_by_grain(conn, {"provider_id": "nope", "route_id": "x"}, {})
        finally:
            tx.rollback()
    assert out == []


def test_prior_window_attached_when_prior_has_data(real_db_engine, seed_provider) -> None:
    gaps = [4.0, 5.0, 6.0, 7.0, 8.0]
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        try:
            seed_provider(conn, _PROVIDER, display_name="dense headway prior")
            ins = text(
                "INSERT INTO gold.route_headway_shift_daily (provider_id, route_id, "
                "provider_local_date, shift, direction_id, gap_count, sum_gap_min, sum_gap_sq_min, "
                "bunched_gap_count, trip_count, gap_histogram) "
                "VALUES (:p, :r, :d, 'am_peak', 0, :n, :sg, :sq, 0, 10, CAST(:h AS smallint[]))"
            )
            n, sg, sq = _moments(gaps)
            for d in (date(2026, 6, 2), date(2026, 6, 1)):
                conn.execute(ins, {"p": _PROVIDER, "r": _ROUTE, "d": d, "n": n, "sg": sg, "sq": sq,
                                   "h": "{" + ",".join(str(x) for x in _hist(gaps)) + "}"})
            out = {g.grain: g for g in _headway_by_grain(conn, _params(), {"am_peak": 5.0})}
        finally:
            tx.rollback()
    am = next(p for p in out["day"].headway if p.shift == "am_peak")
    assert am.prior_observation_count == 5
    assert am.prior_observed_min == am.observed_min
