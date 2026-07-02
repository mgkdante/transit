"""gold.reader kernel gates (S7-close C2).

Byte-identity locks for the extracted spine-reader kernel:
  * the shift / day_type CASE emitters reproduce every historical literal
    shape exactly (frozen strings, indentation-sensitive),
  * the ONE CDF interpolator reproduces both pre-refactor walkers (goldens
    computed from the old functions before the move),
  * every SQL statement C2 touched hashes byte-identical to its pre-refactor
    body (the emitted-SQL lock: published bytes cannot move),
  * gold.reader imports neither transit_ops.snapshots nor gold.rollups
    (the no-cycle law that lets both sides import it),
  * the 2026-07-01 half-away rounding rebaseline semantics (ties away from
    zero, matching Postgres ROUND) on the moved rate/percentile kernels.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from datetime import date, timedelta

import transit_ops.snapshots.builders.historic  # noqa: F401 - registers the C2-touched reads
from transit_ops.gold.reader import (
    SPINE_WINDOW_CLAUSE,
    GrainWindows,
    avg_delay_min,
    bunched_pct,
    cdf_percentile,
    cov_case_sql,
    current_date_trailing_clause,
    daytype_case_sql,
    delay_histogram_bins,
    ewt_min,
    hist_and_avg,
    hist_cols,
    infer_shift,
    otp_pct,
    otp_pct_severe_proxy,
    pctile_min_from_hist,
    round_half_away,
    severe_pct,
    shift_case_sql,
    wilson_bounds,
)
from transit_ops.gold.rollups import (
    DELAY_HISTOGRAM_EDGES as _DELAY_EDGES,
)
from transit_ops.gold.rollups import (
    HEADWAY_GAP_HISTOGRAM_EDGES as _GAP_EDGES,
)
from transit_ops.sql_registry import _REGISTRY

# --------------------------------------------------------------------------
# buckets — frozen emitted-fragment byte-identity (every historical shape)
# --------------------------------------------------------------------------

_TRIP_HOUR = "EXTRACT(HOUR FROM timezone(dp.timezone, ts.trip_start_utc))"
_STOP_TS = "timezone(dp.timezone, sd.period_start_utc)"


def test_shift_case_spine_shape() -> None:
    assert shift_case_sql("hour_of_day_local") == (
        "CASE\n"
        "            WHEN hour_of_day_local BETWEEN 6 AND 8 THEN 'am_peak'\n"
        "            WHEN hour_of_day_local BETWEEN 9 AND 14 THEN 'midday'\n"
        "            WHEN hour_of_day_local BETWEEN 15 AND 18 THEN 'pm_peak'\n"
        "            WHEN hour_of_day_local BETWEEN 19 AND 22 THEN 'evening'\n"
        "            ELSE 'night'\n"
        "        END"
    )


def test_daytype_case_spine_shape() -> None:
    assert daytype_case_sql("service_local_date") == (
        "CASE\n"
        "            WHEN EXTRACT(ISODOW FROM service_local_date)"
        " BETWEEN 1 AND 5 THEN 'weekday'\n"
        "            ELSE 'weekend'\n"
        "        END"
    )


def test_shift_case_headway_wrapped_shape() -> None:
    assert shift_case_sql(_TRIP_HOUR, indent=12, lead=True, wrap=True) == (
        "            CASE\n"
        f"                WHEN {_TRIP_HOUR}\n"
        "                    BETWEEN 6 AND 8 THEN 'am_peak'\n"
        f"                WHEN {_TRIP_HOUR}\n"
        "                    BETWEEN 9 AND 14 THEN 'midday'\n"
        f"                WHEN {_TRIP_HOUR}\n"
        "                    BETWEEN 15 AND 18 THEN 'pm_peak'\n"
        f"                WHEN {_TRIP_HOUR}\n"
        "                    BETWEEN 19 AND 22 THEN 'evening'\n"
        "                ELSE 'night'\n"
        "            END"
    )


def test_shift_case_headway_single_line_shape() -> None:
    assert shift_case_sql(_TRIP_HOUR, indent=12, lead=True) == (
        "            CASE\n"
        f"                WHEN {_TRIP_HOUR} BETWEEN 6 AND 8 THEN 'am_peak'\n"
        f"                WHEN {_TRIP_HOUR} BETWEEN 9 AND 14 THEN 'midday'\n"
        f"                WHEN {_TRIP_HOUR} BETWEEN 15 AND 18 THEN 'pm_peak'\n"
        f"                WHEN {_TRIP_HOUR} BETWEEN 19 AND 22 THEN 'evening'\n"
        "                ELSE 'night'\n"
        "            END"
    )


def test_daytype_case_direction_shape() -> None:
    assert daytype_case_sql("ts.service_date", indent=12, lead=True) == (
        "            CASE\n"
        "                WHEN EXTRACT(ISODOW FROM ts.service_date)"
        " BETWEEN 1 AND 5 THEN 'weekday'\n"
        "                ELSE 'weekend'\n"
        "            END"
    )


def test_stop_grain_wrapped_shapes() -> None:
    assert shift_case_sql(f"EXTRACT(HOUR FROM {_STOP_TS})", indent=15, lead=True, wrap=True) == (
        "               CASE\n"
        f"                   WHEN EXTRACT(HOUR FROM {_STOP_TS})\n"
        "                       BETWEEN 6 AND 8 THEN 'am_peak'\n"
        f"                   WHEN EXTRACT(HOUR FROM {_STOP_TS})\n"
        "                       BETWEEN 9 AND 14 THEN 'midday'\n"
        f"                   WHEN EXTRACT(HOUR FROM {_STOP_TS})\n"
        "                       BETWEEN 15 AND 18 THEN 'pm_peak'\n"
        f"                   WHEN EXTRACT(HOUR FROM {_STOP_TS})\n"
        "                       BETWEEN 19 AND 22 THEN 'evening'\n"
        "                   ELSE 'night'\n"
        "               END"
    )
    assert daytype_case_sql(_STOP_TS, indent=15, lead=True, wrap=True) == (
        "               CASE\n"
        f"                   WHEN EXTRACT(ISODOW FROM {_STOP_TS})\n"
        "                       BETWEEN 1 AND 5 THEN 'weekday'\n"
        "                   ELSE 'weekend'\n"
        "               END"
    )


def test_infer_shift_full_sweep_matches_sql_buckets() -> None:
    # Hour-by-hour twin of the SQL CASE (closed BETWEEN bounds == old half-open ranges).
    expected = (
        ["night"] * 6
        + ["am_peak"] * 3
        + ["midday"] * 6
        + ["pm_peak"] * 4
        + ["evening"] * 4
        + ["night"]
    )
    assert [infer_shift(h) for h in range(24)] == expected


# --------------------------------------------------------------------------
# percentile — golden equality vs BOTH pre-refactor walkers (values captured
# from _pctile_from_hist / _headway_pctile_from_hist before the extraction)
# --------------------------------------------------------------------------


def _delay_hist(**mass: int) -> list[int]:
    h = [0] * 21
    for key, count in mass.items():
        h[int(key.removeprefix("b"))] = count
    return h


def test_delay_percentile_goldens() -> None:
    # terminal bin 20 = [3600, +inf): FLOORS at 3600s -> 60.0 min (Finding B)
    assert pctile_min_from_hist(_delay_hist(b20=7), 0.5, _DELAY_EDGES) == 60.0
    assert pctile_min_from_hist(_delay_hist(b20=7), 0.9, _DELAY_EDGES) == 60.0
    # all mass in bin 0 [-3600,-300): negative-minute interpolation, no index error
    assert pctile_min_from_hist(_delay_hist(b0=4), 0.5, _DELAY_EDGES) == -32.5
    # even mass across [0,30)+[30,60)
    assert pctile_min_from_hist(_delay_hist(b7=10, b8=10), 0.5, _DELAY_EDGES) == 0.5
    assert pctile_min_from_hist(_delay_hist(b7=10, b8=10), 0.9, _DELAY_EDGES) == 0.9
    # mixed mass across [90,120)+[120,150)
    assert pctile_min_from_hist(_delay_hist(b10=6, b11=4), 0.5, _DELAY_EDGES) == 1.9
    assert pctile_min_from_hist(_delay_hist(b10=6, b11=4), 0.9, _DELAY_EDGES) == 2.4
    # honest-None: empty / all-zero
    assert pctile_min_from_hist([], 0.5, _DELAY_EDGES) is None
    assert pctile_min_from_hist([0] * 21, 0.5, _DELAY_EDGES) is None


def test_gap_percentile_goldens_raw_unrounded() -> None:
    def gap_hist(idx: int, count: int) -> list[int]:
        g = [0] * 20
        g[idx] = count
        return g

    # bin 19 = [180,240): raw interpolated minutes, NO rounding (caller half-aways)
    assert cdf_percentile(gap_hist(19, 10), 0.5, _GAP_EDGES) == 210.0
    assert cdf_percentile(gap_hist(19, 10), 0.9, _GAP_EDGES) == 234.0
    # bin 0 = [0,0.5)
    assert cdf_percentile(gap_hist(0, 3), 0.5, _GAP_EDGES) == 0.25
    # even mass across [6,8)+[8,10)
    even = [0] * 20
    even[7] = even[8] = 2
    assert cdf_percentile(even, 0.5, _GAP_EDGES) == 8.0
    assert cdf_percentile(even, 0.9, _GAP_EDGES) == 9.6
    # honest-None: empty / all-zero
    assert cdf_percentile([], 0.5, _GAP_EDGES) is None
    assert cdf_percentile([0] * 20, 0.5, _GAP_EDGES) is None
    # the terminal overflow-floor branch is DEAD for the 20-bin gap histogram:
    # bin_idx caps at 19 over 21 edges, so the walk always interpolates.


def test_cdf_percentile_returns_raw_native_unit() -> None:
    # The core NEVER converts units or rounds — wrappers own that.
    h = _delay_hist(b20=7)
    assert cdf_percentile(h, 0.5, _DELAY_EDGES) == 3600.0


# --------------------------------------------------------------------------
# rounding — the 2026-07-01 half-away rebaseline (ties away from zero)
# --------------------------------------------------------------------------


def test_round_half_away_tie_semantics() -> None:
    assert float(round_half_away(2.5, 0)) == 3.0  # banker's would give 2.0
    assert float(round_half_away(-2.5, 0)) == -3.0  # away from zero on BOTH signs
    assert float(round_half_away(0.625, 2)) == 0.63
    assert float(round_half_away(7.45, 1)) == 7.5


def test_rate_kernel_half_away_ties() -> None:
    assert otp_pct(825, 1000) == 83  # 82.5 tie -> 83 (banker's gave 82)
    assert otp_pct_severe_proxy(1000, 175) == 83  # (1000-175)/1000 = 82.5%
    assert severe_pct(1000, 175) == 17.5
    assert avg_delay_min(15) == 0.3  # 0.25 min tie -> 0.3 (banker's gave 0.2)
    assert avg_delay_min(-15) == -0.3  # away from zero for early running


def test_rate_kernel_honest_none_guards() -> None:
    assert otp_pct(None, 100) is None
    assert otp_pct(5, 0) is None
    assert severe_pct(0, 0) is None
    assert wilson_bounds(None, 100) is None
    assert wilson_bounds(50, 100) == (40.4, 59.6)  # non-tie golden unchanged


# --------------------------------------------------------------------------
# histogram / CoV / EWT
# --------------------------------------------------------------------------


def test_hist_and_avg_ghost_excluded_denominator() -> None:
    row = {f"h{k}": 0 for k in range(1, 22)}
    row["h8"] = 4
    row["sum_delay_sec"] = 120
    hist, avg_sec = hist_and_avg(row)
    assert sum(hist) == 4
    assert avg_sec == 30.0
    empty = {f"h{k}": 0 for k in range(1, 22)}
    empty["sum_delay_sec"] = 120
    assert hist_and_avg(empty)[1] is None  # no in-clamp delays -> honest None


def test_delay_histogram_bins_shape_and_absence() -> None:
    assert delay_histogram_bins([0] * 21, _DELAY_EDGES) is None
    h = [0] * 21
    h[0] = 2
    h[20] = 3
    bins = delay_histogram_bins(h, _DELAY_EDGES)
    assert bins is not None and len(bins) == 21
    assert bins[0] == (-3600, -300, 2)
    assert bins[20] == (3600, None, 3)  # overflow bin has no upper edge


def test_bunched_pct_straddle_and_guards() -> None:
    hist = [0] * 20
    hist[7] = 4  # [6,8): median 7 -> threshold 3.5 -> nothing below
    assert bunched_pct(hist, _GAP_EDGES, 7.0) == 0.0
    assert bunched_pct(hist, _GAP_EDGES, None) is None
    assert bunched_pct([0] * 20, _GAP_EDGES, 7.0) is None


def test_ewt_min_goldens() -> None:
    # AWT = 100/(2*10) = 5.0; sched 8 -> SWT 4 -> EWT 1.0
    assert ewt_min(10.0, 100.0, 8.0) == 1.0
    # frequent-service clamp: AWT < SWT -> honest 0, never negative
    assert ewt_min(10.0, 100.0, 12.0) == 0.0
    assert ewt_min(0.0, 0.0, 8.0) is None  # no gaps
    assert ewt_min(10.0, 100.0, None) is None  # no scheduled headway


def test_cov_fragment_and_hist_cols_frozen() -> None:
    cov = cov_case_sql(n="SUM(gap_count)", total="SUM(sum_gap_min)", total_sq="SUM(sum_gap_sq_min)")
    assert cov + " AS cov," in _REGISTRY["route.headway.window"]
    assert hist_cols("gap_histogram", "g", 2) == (
        "SUM(gap_histogram[1])::bigint AS g1,\n        SUM(gap_histogram[2])::bigint AS g2"
    )


# --------------------------------------------------------------------------
# window policy
# --------------------------------------------------------------------------


def test_grain_windows_frozen_and_prior() -> None:
    anchor = date(2026, 6, 20)
    w = GrainWindows(anchor)
    assert dict(w.items()) == {
        "day": (anchor, anchor),
        "week": (date(2026, 6, 14), anchor),
        "month": (date(2026, 5, 22), anchor),
    }
    for grain, (start, _end) in w.items():
        p_start, p_end = w.prior(grain)
        assert p_end == start - timedelta(days=1)  # abuts, never overlaps
        assert (p_end - p_start) == (w[grain][1] - w[grain][0])  # same length
    assert "week" in w and "quarter" not in w


def test_current_date_trailing_clause_bytes() -> None:
    assert current_date_trailing_clause("rob.provider_local_date") == (
        "rob.provider_local_date >= (now() AT TIME ZONE dp.timezone)::date - 30"
    )
    assert SPINE_WINDOW_CLAUSE == (
        " AND service_local_date >= :win_start AND service_local_date <= :win_end"
    )


# --------------------------------------------------------------------------
# emitted-SQL byte-identity lock (every statement C2 touched)
# --------------------------------------------------------------------------

# sha256 of each registered SQL body, captured from the PRE-C2 code. The kernel
# extraction is a pure refactor: if any of these move, published bytes moved.
_C2_TOUCHED_SQL_SHA256 = {
    "rollup.route_headway.upsert": (
        "624b551f37e63268c7a443c4da56081de3d144a0655d2a8146d982e56dfefd5c"
    ),
    "rollup.route_headway_direction.upsert": (
        "6b0047ab0486b0a477e81f9524f16c8dfe119da06c5c22927bc5012f9df9550a"
    ),
    "rollup.route_headway_shift.upsert": (
        "84f6b7c84ead3be303e25bb145bf59977651238a47850f826667bb34d66913b0"
    ),
    "stop.reliability.by_grain": "bf32fdc8581002e30eb80de94a8a3496ab8d7bbb96b21a5332915574ddf86c79",
    "route.habit.spine": "abb6ca005fa1ac746f747c53885a76fce91b6733a1f18c1eaa9771890df14295",
    "route.headway.window": "f2a44c870f30cea0edc64d1ab9cdb7c4093da7a87de4525624275197a57bec47",
    "route.spine.by_shift": "34421b08ed4d18558cfb9eb3c34dc421ba8209bb98d32e0a7a02aaa5531148f9",
    "route.spine.by_daytype": "6d3a86f5e5134ba4c96d157b7d3a5caadc850d43a04e464ccd43f6b1ad87a525",
    "route.spine.weekly": "9ba699632f5f0e87ca430cbc9f1fc08a00d4412b659b65c4fc8af26c37067d1b",
    "route.spine.monthly": "65fa0808cea30304c6c3738236e9347b1fcf0025195a5ed130075fd0b25d6202",
    "route.spine.dow": "e019f683b17b02d2e1425eb42648e3b0d6d83a2c637081bce17c9e5985c5782a",
    "route.spine.crosstab": "82818ab0fc9a6737a598f224f34d704916c7a2ca3f9605406165d8ba686b9c49",
    "route.spine.by_shift_windowed": (
        "d266633c11e762c886c352bc9c68977034084f496ce39dc1ea22ca8fa835bc3f"
    ),
    "route.spine.by_daytype_windowed": (
        "b7cd2bfa73dc37fe2f1c65f0d6e87438e9eb7d1325070f134493c6173357cdba"
    ),
    "route.spine.dow_windowed": "7f12b91e21557db686ae48ca225ab28503bfc1ed18f5ae4a3f8dc24b5979010e",
    "route.spine.crosstab_windowed": (
        "914d6730c79aa89cfc4e59f4eb96daed022727a666a7a3e57001cc001aa71a99"
    ),
    "network.spine.by_shift": "1d9b382ba661658fadf93d43984bdd34858e7842712b7e02c692228df6bcf48d",
    "network.spine.by_daytype": "91dab384081542549985df524c99276673bd7ef25e4eb198aa882c376431c5c2",
    "route.occupancy.band_window": (
        "71aeadea14a4d11c0c61e8ac9c1a42d15abe46f0bface200b4a286af41e3312d"
    ),
    "route.occupancy.by_dow": "f8363e495d00c54df99c99ce90ae204e5c5c38bee66af0f8e3edbe6daa19af57",
    "route.occupancy.by_grain": "8531c2edaca6e28d5d470083451e1a5fb710bc956d8ff32fc77e8fc9a2b00de8",
    "route.delay.by_crowding": "2e56c8a2b0e241f72563eccd6332ea8ece8f6287d37c94c2dbd00ada728203ff",
    "stop.occupancy.band_window": (
        "d833895c42e44543e95389d8c9c015f0299286b8d0d34becac220f05ecdb0fed"
    ),
    "receipts.accountability": "8a95c3e78aebcfd252373dd7fc8cad9ba496ae9bc3d943e640447721f72332c7",
    "receipts.worst_route": "446fd95112efb2e19080d74d0999e2c15ead10478bf0301d3b6a9e9c1c963d11",
    "receipts.worst_stop": "aeccf30a7d837bb0d1fa71ce07e70e9191ff28db9adf55b5dd0ab1594c0d8230",
    "alerts.history": "59919b6dcea56275a922450bf58b3cb5c4622cd634c20992f7cefc260788ddcb",
    "route.weak_stops.by_grain": "ad0c85f01c2b017469610ceb13f72adf1276e589a766cdbac48d3189bc79a138",
}


def test_c2_touched_statements_byte_identical() -> None:
    drifted = {
        name
        for name, expected in _C2_TOUCHED_SQL_SHA256.items()
        if hashlib.sha256(_REGISTRY[name].encode()).hexdigest() != expected
    }
    assert not drifted, f"emitted SQL drifted from the pre-C2 bytes: {sorted(drifted)}"


# --------------------------------------------------------------------------
# no-cycle law
# --------------------------------------------------------------------------


def test_gold_reader_never_imports_snapshots() -> None:
    # Fresh interpreter: the kernel must be importable without pulling
    # transit_ops.snapshots — the law that lets gold/rollups AND the builders
    # both import it with no cycle. (gold/__init__ pulls marts+rollups as it
    # always has; neither imports snapshots.)
    code = (
        "import sys\n"
        "import transit_ops.gold.reader\n"
        "bad = [m for m in sys.modules if m.startswith('transit_ops.snapshots')]\n"
        "assert not bad, bad\n"
    )
    subprocess.run([sys.executable, "-c", code], check=True)


def test_gold_reader_sources_never_import_rollups() -> None:
    # rollups imports reader.buckets, so reader source must never import
    # rollups back (a module-level cycle would break at interpreter start).
    import pathlib

    import transit_ops.gold.reader as reader_pkg

    pkg_dir = pathlib.Path(reader_pkg.__file__).parent
    offenders = [
        p.name
        for p in pkg_dir.glob("*.py")
        if "transit_ops.gold.rollups" in p.read_text() or "transit_ops.gold.marts" in p.read_text()
    ]
    assert not offenders, f"gold.reader modules import gold.rollups/marts: {offenders}"
