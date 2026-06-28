"""Tests for snapshot HISTORIC-tier builders (gold rollups -> /v1 pydantic models).

These tests use FAKE database connections that return canned ``.mappings()``
rows.  No real database is touched — the SQL strings are validated for live
execution separately against a dev DB.  Here we exercise the row -> model
mapping logic: OTP/severe math, seconds->minutes rounding, the merged daily
network-trend series, per-shift scheduled-vs-observed headway + excess wait,
the 7x24 habits matrix, weak-stop ranking, and batched stop reliability.
"""

from __future__ import annotations

import datetime

from transit_ops.snapshots.builders import (
    _RECEIPTS_NETWORK_DAILY_SQL,
    _RECEIPTS_WORST_ROUTE_SQL,
    _RECEIPTS_WORST_STOP_SQL,
    _ROUTE_NAMES_SQL,
    _ROUTE_REL_DAILY_SQL,
    _STOP_NAMES_SQL,
    _TREND_DAILY_SQL,
    _TREND_FACT_SQL,
    _otp_pct,
    _otp_pct_severe_proxy,
    build_alert_history,
    build_hotspots,
    build_network_trend,
    build_provenance,
    build_receipts,
    build_repeat_offenders,
    build_route_reliability,
    build_stop_reliability,
)
from transit_ops.snapshots.builders._helpers import (
    MIN_N_RATE,
    WILSON_Z,
    _wilson_bounds,
    _wilson_hi,
    _wilson_lo,
)
from transit_ops.snapshots.builders.historic import _HOTSPOTS_SQL, _STOP_REL_BY_ROUTE_SQL
from transit_ops.snapshots.contract import (
    AlertHistory,
    Hotspots,
    NetworkTrend,
    Provenance,
    RepeatOffenders,
    StopReliability,
)

# --------------------------------------------------------------------------
# Fakes — a result that supports both .mappings() iteration AND .fetchone()
# (the route/stop builders call _representative_services which uses fetchone
# and bare row[0] iteration for active-services), mirroring test_build_route.
# --------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rows):  # noqa: ANN001
        self._rows = rows

    def mappings(self):  # noqa: ANN201
        outer = self

        class M:
            def fetchone(self):  # noqa: ANN202
                return outer._rows[0] if outer._rows else None

            def __iter__(self):
                return iter(outer._rows)

        return M()

    def __iter__(self):
        # bare row[0]-style iteration (active-services query)
        return iter(self._rows)

    def fetchone(self):  # noqa: ANN201
        return self._rows[0] if self._rows else None

    def scalar_one(self):  # noqa: ANN201
        return self._rows[0] if self._rows else 0


class FakeConn:
    """Dispatch canned result sets by matching a substring of the SQL.

    ``dispatch`` is an ordered list of (needle, rows); first match wins, so put
    more specific needles first.
    """

    def __init__(self, dispatch):  # noqa: ANN001
        self._dispatch = dispatch
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        sql = str(statement)
        self.executed.append(sql)
        for needle, rows in self._dispatch:
            if needle in sql:
                return _FakeResult(rows)
        return _FakeResult([])


class _StopSpineFakeConn:
    """Params-aware mock for build_stop_reliability (DB-0067 Phase 1).

    The re-pointed weekly + monthly reads share IDENTICAL SQL (group by stop_id
    over gold.stop_delay_spine with a :win_start/:win_end window), so they can only
    be told apart by the window param: week win_start = anchor-6, month = anchor-29.
    The anchor query (MAX(service_local_date)) is answered first; by_route is keyed
    on its 'GROUP BY stop_id, route_id'. Everything else returns empty.
    """

    def __init__(self, *, anchor, by_route=None, weekly=None, monthly=None, extra=None):  # noqa: ANN001
        self._anchor = anchor
        self._by_route = by_route or []
        self._weekly = weekly or []
        self._monthly = monthly or []
        self._extra = extra or []  # ordered (needle, rows) for names/etc.
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql = str(statement)
        self.executed.append(sql)
        params = params or {}
        if "MAX(service_local_date)" in sql and "stop_delay_spine" in sql:
            return _FakeResult([{"anchor": self._anchor}])
        for needle, rows in self._extra:
            if needle in sql:
                return _FakeResult(rows)
        if "GROUP BY stop_id, route_id" in sql:
            return _FakeResult(self._by_route)
        if "stop_delay_spine" in sql:
            # week vs month by the trailing-window start (anchor-6 vs anchor-29).
            win_start = params.get("win_start")
            if win_start == self._anchor - datetime.timedelta(days=6):
                return _FakeResult(self._weekly)
            if win_start == self._anchor - datetime.timedelta(days=29):
                return _FakeResult(self._monthly)
            return _FakeResult([])
        return _FakeResult([])


# --------------------------------------------------------------------------
# _otp_pct convention (on_time=47, known=100 -> 47)
# --------------------------------------------------------------------------


def test_otp_pct_on_time_over_known() -> None:
    assert _otp_pct(47, 100) == 47


def test_otp_pct_rounds() -> None:
    assert _otp_pct(2, 3) == 67


def test_otp_pct_zero_known_is_none() -> None:
    assert _otp_pct(0, 0) is None


def test_otp_pct_null_on_time_is_none() -> None:
    assert _otp_pct(None, 100) is None


def test_otp_pct_all_known_on_time_is_100() -> None:
    assert _otp_pct(50, 50) == 100


def test_otp_severe_proxy_for_stops() -> None:
    assert _otp_pct_severe_proxy(80, 8) == 90
    assert "per-stop delay observations" in (_otp_pct_severe_proxy.__doc__ or "")


# _wilson_bounds / _wilson_lo / _wilson_hi: 95% Wilson score interval in PERCENT,
# honest-NULL on missing/zero denominator, ranking on the lower bound (slice-S3).
def test_wilson_constants() -> None:
    assert MIN_N_RATE == 30
    assert WILSON_Z == 1.96


def test_wilson_bounds_known_value() -> None:
    # 50/100 at 95% -> [40.4, 59.6] (textbook Wilson score interval).
    assert _wilson_bounds(50, 100) == (40.4, 59.6)


def test_wilson_bounds_none_numerator_is_none() -> None:
    assert _wilson_bounds(None, 100) is None


def test_wilson_bounds_zero_or_missing_denominator_is_none() -> None:
    assert _wilson_bounds(5, 0) is None
    assert _wilson_bounds(5, None) is None


def test_wilson_bounds_stay_within_0_100() -> None:
    lo, hi = _wilson_bounds(900, 1000)
    assert 0.0 <= lo <= hi <= 100.0


def test_wilson_bounds_clamp_successes_above_n() -> None:
    # defensive: k > n clamps to n (p=1) — never a >100% or negative bound.
    lo, hi = _wilson_bounds(150, 100)
    assert 0.0 <= lo <= hi <= 100.0


def test_wilson_lower_bound_suppresses_tiny_n_fluke() -> None:
    # The whole point: a 1-of-1 "100%" must rank BELOW a 900-of-1000 "90%".
    assert _wilson_lo(1, 1) < _wilson_lo(900, 1000)
    assert _wilson_lo(1, 1) < 50.0


def test_wilson_lo_hi_extract_bounds_and_guard_none() -> None:
    assert _wilson_lo(50, 100) == 40.4
    assert _wilson_hi(50, 100) == 59.6
    assert _wilson_lo(None, 0) is None
    assert _wilson_hi(5, 0) is None


# --------------------------------------------------------------------------
# _pctile_from_hist — CDF interpolation over the 21-bin spine histogram
# (S7-B PR1 Task 3). Bins map to DELAY_HISTOGRAM_EDGES[i]..[i+1]; bin 20 is the
# >=3600s overflow with no upper edge (Finding B terminal floor).
# --------------------------------------------------------------------------


def test_pctile_from_hist_empty_is_none() -> None:
    from transit_ops.snapshots.builders.historic import _pctile_from_hist

    assert _pctile_from_hist([], 0.5) is None
    assert _pctile_from_hist([0] * 21, 0.5) is None  # all-zero == no observations


def test_pctile_from_hist_interpolates_within_bin() -> None:
    from transit_ops.snapshots.builders.historic import _pctile_from_hist

    # All mass in bin 15 = [300, 420) sec. p50 -> 300 + 120*0.5 = 360s = 6.0 min;
    # p90 -> 300 + 120*0.9 = 408s = 6.8 min.
    hist = [0] * 15 + [10] + [0] * 5
    assert _pctile_from_hist(hist, 0.5) == 6.0
    assert _pctile_from_hist(hist, 0.9) == 6.8


def test_pctile_from_hist_terminal_bin_floor() -> None:
    from transit_ops.snapshots.builders.historic import _pctile_from_hist

    # Mass only in the overflow bin 20 ([3600, +inf)); no edges[21] to index.
    # Finding B: pin at the last edge 3600s = 60.0 min (documented tail floor).
    hist = [0] * 20 + [5]
    assert _pctile_from_hist(hist, 0.9) == 60.0
    assert _pctile_from_hist(hist, 0.5) == 60.0  # no IndexError on terminal mass


def test_pctile_from_hist_bin_zero_safe_and_negative() -> None:
    from transit_ops.snapshots.builders.historic import _pctile_from_hist

    # Mass in bin 0 = [-3600, -300) sec (very early). p90 -> -3600 + 3300*0.9 =
    # -630s = -10.5 min. Lower edge exists; never indexes out of range.
    hist = [5] + [0] * 20
    assert _pctile_from_hist(hist, 0.9) == -10.5


def _spine_row(*, known_obs, on_time, severe, sum_delay_sec, hist):  # noqa: ANN001, ANN202
    row = {"obs": known_obs, "known_obs": known_obs, "on_time": on_time,
           "severe": severe, "sum_delay_sec": sum_delay_sec}
    for k in range(1, 22):
        row[f"h{k}"] = hist[k - 1]
    return row


def test_spine_reliability_period_maps_otp_severe_and_rebaselined_avg() -> None:
    from transit_ops.snapshots.builders.historic import _spine_reliability_period

    # 6 in-clamp delays summing to 1100s; otp 4/8=50, severe 2/8=25.0,
    # avg 1100/6/60 = 3.06 -> rounds to 3.1.
    hist = [0] * 8 + [6] + [0] * 12   # all 6 in bin 8 = [30,60)
    p = _spine_reliability_period(
        _spine_row(known_obs=8, on_time=4, severe=2, sum_delay_sec=1100, hist=hist),
        grain="week", date="2026-06-01",
    )
    assert p.grain == "week" and p.date == "2026-06-01"
    assert p.otp_pct == 50
    assert p.severe_pct == 25.0
    assert p.avg_delay_min == 3.1
    assert p.p50_min is not None and p.p90_min is not None  # D3 upgrade: populated
    # S7-B evidence: numerator/denominator + Wilson + the signed-delay distribution.
    assert p.observation_count == 8
    assert p.on_time == 4
    assert p.wilson_lo is not None and p.wilson_hi is not None
    assert p.delay_histogram is not None and len(p.delay_histogram) == 21
    assert sum(b.count for b in p.delay_histogram) == 6
    # bin 8 (0-based) = [30, 60)s carries all 6; the overflow bin has no upper edge.
    assert p.delay_histogram[8].lo_sec == 30 and p.delay_histogram[8].hi_sec == 60
    assert p.delay_histogram[8].count == 6
    assert p.delay_histogram[20].lo_sec == 3600 and p.delay_histogram[20].hi_sec is None


def test_spine_reliability_period_honest_null_when_no_delays() -> None:
    from transit_ops.snapshots.builders.historic import _spine_reliability_period

    # No usable delays: on_time NULL, known_obs 0, empty histogram -> every derived
    # metric is honest-None (never a fabricated 0.0).
    p = _spine_reliability_period(
        _spine_row(known_obs=0, on_time=None, severe=0, sum_delay_sec=0, hist=[0] * 21),
        grain="am_peak", date=None,
    )
    assert p.otp_pct is None
    assert p.severe_pct is None
    assert p.avg_delay_min is None
    assert p.p50_min is None and p.p90_min is None
    # S7-B evidence stays honest under no-data: numerator + distribution are None.
    assert p.on_time is None
    assert p.wilson_lo is None and p.wilson_hi is None
    assert p.delay_histogram is None  # empty histogram -> honest absence, never []


# --------------------------------------------------------------------------
# build_network_trend — merge two daily series; p90/vehicles only where the
# fact table covers the date.
# --------------------------------------------------------------------------


def test_build_network_trend_merges_and_orders() -> None:
    d1 = datetime.date(2026, 6, 1)
    d2 = datetime.date(2026, 6, 2)
    d3 = datetime.date(2026, 6, 3)
    conn = FakeConn(
        [
            # daily hourly rollup: 3 days of OTP + weighted avg delay
            (
                "route_delay_hourly",
                [
                    # 47/100 -> otp 47; weighted 100*120s/100 = 120s -> 2.0min
                    {
                        "local_date": d1,
                        "known_obs": 100,
                        "on_time": 47,
                        "weighted_delay_sec": 12000.0,
                    },
                    # 180/200 -> otp 90; weighted 200*90s/200 = 90s -> 1.5min
                    {
                        "local_date": d2,
                        "known_obs": 200,
                        "on_time": 180,
                        "weighted_delay_sec": 18000.0,
                    },
                    # legacy NULL on-time count -> honest None OTP, but avg delay still known
                    {
                        "local_date": d3,
                        "known_obs": 10,
                        "on_time": None,
                        "weighted_delay_sec": 600.0,
                    },
                ],
            ),
            # fact table only retains the two most recent days (d2, d3)
            (
                "fact_trip_delay_snapshot",
                [
                    {"local_date": d2, "p90_min": 7.25, "vehicles": 310},
                    {"local_date": d3, "p90_min": 9.0, "vehicles": 280},
                ],
            ),
        ]
    )

    out = build_network_trend(conn, provider_id="stm", generated_utc="t")

    assert isinstance(out, NetworkTrend)
    # sorted ascending by date
    assert [p.date for p in out.series] == ["2026-06-01", "2026-06-02", "2026-06-03"]

    p1, p2, p3 = out.series
    # d1: only in the hourly rollup -> no p90/vehicles
    assert p1.otp_pct == 47
    assert p1.avg_delay_min == 2.0
    assert p1.p90_min is None
    assert p1.vehicles is None
    # d2: present in BOTH series
    assert p2.otp_pct == 90
    assert p2.avg_delay_min == 1.5
    assert p2.p90_min == 7.2  # rounded to 1dp
    assert p2.vehicles == 310
    # d3: on_time NULL in rollup (None OTP) but fact covers it (p90/vehicles present)
    assert p3.otp_pct is None
    assert p3.avg_delay_min == 1.0
    assert p3.p90_min == 9.0
    assert p3.vehicles == 280


def test_trend_sql_uses_observation_unit_counts() -> None:
    for sql in (str(_TREND_DAILY_SQL), str(_RECEIPTS_NETWORK_DAILY_SQL)):
        assert "on_time_observation_count" in sql
        assert "delay_observation_count" in sql
        assert "delayed_trip_count" not in sql


def test_trend_fact_sql_caps_p90_delay_input() -> None:
    sql = str(_TREND_FACT_SQL)

    assert "percentile_cont(0.9)" in sql
    assert "ABS(fts.delay_seconds) <= 3600" in sql


def test_build_network_trend_fact_only_date() -> None:
    """A date present only in the fact table still yields a point (rollup fields None)."""
    d = datetime.date(2026, 6, 5)
    conn = FakeConn(
        [
            ("route_delay_hourly", []),
            ("fact_trip_delay_snapshot", [{"local_date": d, "p90_min": 4.0, "vehicles": 12}]),
        ]
    )
    out = build_network_trend(conn, generated_utc="t")
    assert len(out.series) == 1
    pt = out.series[0]
    assert pt.date == "2026-06-05"
    assert pt.otp_pct is None
    assert pt.avg_delay_min is None
    assert pt.p90_min == 4.0
    assert pt.vehicles == 12


# --------------------------------------------------------------------------
# build_route_reliability — periods, headway excess, habits matrix, weak stops
# --------------------------------------------------------------------------


def _route_reliability_dispatch(*, daily=None, weekly=None, monthly=None, headway=None,
                                headway_direction=None,
                                habit=None, weak=None, names=None, schedule=None,
                                route_names=None, dow=None, crowding=None, crosstab=None,
                                occ_dow=None, occ_grain=None):
    """Assemble an ordered dispatch list for build_route_reliability.

    Needles are ordered most-specific-first so they never collide. The schedule
    rows feed the representative-weekday scheduled-headway computation.
    """
    return [
        # dataset version (must precede the rep-dates 'generate_series' needle)
        ("dataset_kind = 'static_schedule'", [{"dataset_version_id": 1}]),
        # rep-dates
        (
            "generate_series",
            [
                {
                    "weekday_date": datetime.date(2026, 6, 3),
                    "weekend_date": datetime.date(2026, 6, 6),
                }
            ],
        ),
        # active-services (bare row[0] iteration)
        ("extract(isodow FROM :repdate)", [("svc_wd",)]),
        # route schedule (first-stop departures) — drives scheduled headway
        ("st.stop_sequence     = 1", schedule or []),
        # tier-3 2D crosstab — discriminator '-- by_shift_daytype'; MUST precede
        # the broader 'route_delay_by_shift' substring.
        ("-- by_shift_daytype", crosstab or []),
        # delay×crowding — MUST precede the daily-view needle (its JOIN contains
        # 'public_route_reliability_daily'); discriminator '-- delay_by_crowding'.
        ("-- delay_by_crowding", crowding or []),
        # S7 crowding rollups — unique comment discriminators ('-- occupancy_by_dow'
        # / '-- occupancy_by_grain'); both read gold.route_occupancy_band_daily.
        ("-- occupancy_by_dow", occ_dow or []),
        ("-- occupancy_by_grain", occ_grain or []),
        # daily public reliability
        ("public_route_reliability_daily", daily or []),
        # weekly / monthly
        ("route_reliability_weekly", weekly or []),
        ("route_reliability_monthly", monthly or []),
        # per-direction + weekday/weekend headway — MUST precede the broader
        # "route_headway_by_shift" needle (it contains "route_headway_by_direction_shift").
        ("route_headway_by_direction_shift", headway_direction or []),
        # observed headway (busiest direction)
        ("route_headway_by_shift", headway or []),
        # habits
        ("route_habit_score", habit or []),
        # weak stops
        ("stop_delay_weekly", weak or []),
        # stop names (current-dim UNION history)
        ("stop_name", names or []),
        # route names (current-dim UNION history)
        ("DISTINCT ON (u.route_id)", route_names or []),
        # per-weekday seasonality (route_delay_day_of_week)
        ("route_delay_day_of_week", dow or []),
    ]


def test_route_reliability_sql_uses_real_otp_columns() -> None:
    # The daily grain reads public_route_reliability_daily (a carve-out, kept);
    # weekly/monthly/by_shift/by_daytype now derive from the spine projector.
    assert "delay_observation_count AS known_obs" in str(_ROUTE_REL_DAILY_SQL)
    assert "on_time_observation_count AS on_time" in str(_ROUTE_REL_DAILY_SQL)


def test_build_route_reliability_headway_excess() -> None:
    # Scheduled: am_peak built from first-stop departures 07:00, 07:08, 07:16
    #   distinct minutes 420,428,436 -> gaps 8,8 -> median 8.0 scheduled.
    # Observed am_peak = 11.0 -> excess = max(0, 11-8) = 3.0
    # Observed midday  = 5.0, no scheduled departures in midday -> excess None
    conn = FakeConn(
        _route_reliability_dispatch(
            schedule=[
                {"direction_id": 0, "is_weekday": True, "departure_time": "07:00:00"},
                {"direction_id": 0, "is_weekday": True, "departure_time": "07:08:00"},
                {"direction_id": 0, "is_weekday": True, "departure_time": "07:16:00"},
            ],
            headway=[
                {"shift": "am_peak", "observed_headway_min": 11.0, "sample_count": 30},
                {"shift": "midday", "observed_headway_min": 5.0, "sample_count": 12},
            ],
        )
    )

    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    by_shift = {h.shift: h for h in out.headway}

    assert by_shift["am_peak"].scheduled_min == 8.0
    assert by_shift["am_peak"].observed_min == 11.0
    assert by_shift["am_peak"].excess_wait_min == 3.0

    # midday has observed but no scheduled -> excess None, scheduled None
    assert by_shift["midday"].observed_min == 5.0
    assert by_shift["midday"].scheduled_min is None
    assert by_shift["midday"].excess_wait_min is None

    # ordered by shift sort: am_peak before midday
    assert [h.shift for h in out.headway][:2] == ["am_peak", "midday"]


def test_build_route_reliability_excess_clamped_at_zero() -> None:
    # observed < scheduled -> excess clamped to 0.0 (never negative)
    conn = FakeConn(
        _route_reliability_dispatch(
            schedule=[
                {"direction_id": 0, "is_weekday": True, "departure_time": "07:00:00"},
                {"direction_id": 0, "is_weekday": True, "departure_time": "07:10:00"},
            ],
            headway=[
                {"shift": "am_peak", "observed_headway_min": 6.0, "sample_count": 30},
            ],
        )
    )
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    am = next(h for h in out.headway if h.shift == "am_peak")
    assert am.scheduled_min == 10.0
    assert am.observed_min == 6.0
    assert am.excess_wait_min == 0.0  # max(0, 6-10)


def test_build_route_reliability_directional_headway_is_typed_not_encoded() -> None:
    # S7-B Pattern A: directional headway rows carry a BARE shift token + typed
    # direction_id / day_type (no {shift}_dir{N}_weekend packed string). Finding H
    # value-preservation: the base token stays in the canonical shift vocabulary and
    # every direction + day-type the source carried survives as a typed field.
    conn = FakeConn(
        _route_reliability_dispatch(
            headway_direction=[
                {"shift": "am_peak", "direction_id": 0, "service_day_kind": "weekday",
                 "observed_headway_min": 7.9},
                {"shift": "am_peak", "direction_id": 1, "service_day_kind": "weekend",
                 "observed_headway_min": 9.1},
            ],
        )
    )
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    directional = [h for h in out.headway if h.direction_id is not None]
    assert len(directional) == 2
    for h in directional:
        assert h.shift in {"am_peak", "midday", "pm_peak", "evening", "night"}
        assert "_dir" not in h.shift and "_weekend" not in h.shift
    by_key = {(h.direction_id, h.day_type): h for h in directional}
    assert by_key[(0, "weekday")].shift == "am_peak" and by_key[(0, "weekday")].observed_min == 7.9
    assert by_key[(1, "weekend")].shift == "am_peak" and by_key[(1, "weekend")].observed_min == 9.1


def test_build_route_reliability_habits_matrix_is_7x24() -> None:
    # Cells are normalized per-route to a fraction of the route's worst (dow,hour)
    # cell (slice-9.1.1x). Here max = 0.9, so 0.9 -> 1.0, 0.4 -> 0.4444, 0.75 -> 0.8333.
    conn = FakeConn(
        _route_reliability_dispatch(
            habit=[
                {"day_of_week_iso": 1, "hour_of_day_local": 0, "repeat_problem_score": 0.9},
                {"day_of_week_iso": 7, "hour_of_day_local": 23, "repeat_problem_score": 0.4},
                {"day_of_week_iso": 3, "hour_of_day_local": 8, "repeat_problem_score": 0.75},
            ],
        )
    )
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.habits is not None
    assert out.habits.scale == "repeat_problem_relative"
    assert len(out.habits.matrix) == 7
    assert all(len(row) == 24 for row in out.habits.matrix)
    # isodow 1 -> row index 0; hour 0 -> col 0; route max -> 1.0
    assert out.habits.matrix[0][0] == 1.0
    # isodow 7 -> row 6; hour 23 -> col 23; 0.4 / 0.9
    assert out.habits.matrix[6][23] == 0.4444
    # isodow 3 -> row 2; hour 8 -> col 8; 0.75 / 0.9
    assert out.habits.matrix[2][8] == 0.8333
    # unobserved cells are null (no service / no data), not 0.0
    assert out.habits.matrix[1][5] is None


def test_build_route_reliability_habits_at_cap_normalizes_to_one() -> None:
    """Regression: the mart's Numeric(8,4) overflow sentinel 9999.9999 must NOT
    reach the public matrix. As the route max it normalizes to 1.0 (slice-9.1.1x)."""
    conn = FakeConn(
        _route_reliability_dispatch(
            habit=[
                # Friday (isodow 5) 17:00 is at the storage cap
                {"day_of_week_iso": 5, "hour_of_day_local": 17, "repeat_problem_score": 9999.9999},
                {"day_of_week_iso": 1, "hour_of_day_local": 8, "repeat_problem_score": 50.0},
            ],
        )
    )
    out = build_route_reliability(conn, route_id="165", generated_utc="t")
    assert out.habits is not None
    cap_cell = out.habits.matrix[4][17]
    assert cap_cell == 1.0
    assert cap_cell != 9999.9999  # the leak is gone
    # 50 / 9999.9999 ~= 0.005
    assert out.habits.matrix[0][8] == 0.005


def test_build_route_reliability_habits_observed_zero_distinct_from_no_data() -> None:
    """An observed cell with a genuine zero score publishes 0.0; a cell the route
    never ran (no row) publishes null (slice-9.1.1x honesty split)."""
    conn = FakeConn(
        _route_reliability_dispatch(
            habit=[
                {"day_of_week_iso": 2, "hour_of_day_local": 9, "repeat_problem_score": 0.0},
                {"day_of_week_iso": 4, "hour_of_day_local": 18, "repeat_problem_score": 80.0},
            ],
        )
    )
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.habits is not None
    assert out.habits.matrix[1][9] == 0.0  # observed-calm -> 0.0, not null
    assert out.habits.matrix[3][18] == 1.0  # route max
    assert out.habits.matrix[0][0] is None  # never observed -> null


def test_build_route_reliability_habits_present_null_score_is_null_not_zero() -> None:
    """A present (dow,hour) row whose repeat_problem_score is NULL is observed-but-
    unknown — it stays null (no data), never a false observed-calm 0.0 (slice-9.1.1x
    honesty rule). Defensive: the mart cannot currently emit a NULL score for a
    present row, but the publisher must not silently invent 0.0 if it ever does."""
    conn = FakeConn(
        _route_reliability_dispatch(
            habit=[
                {"day_of_week_iso": 2, "hour_of_day_local": 9, "repeat_problem_score": None},
                {"day_of_week_iso": 4, "hour_of_day_local": 18, "repeat_problem_score": 60.0},
            ],
        )
    )
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.habits is not None
    assert out.habits.matrix[1][9] is None  # present row, NULL score -> null (not 0.0)
    assert out.habits.matrix[3][18] == 1.0  # route max


def test_build_route_reliability_habits_all_zero_route_no_div_by_zero() -> None:
    """A route whose every observed cell is 0.0 must not divide by zero; observed
    cells stay 0.0 and unobserved cells stay null (slice-9.1.1x)."""
    conn = FakeConn(
        _route_reliability_dispatch(
            habit=[
                {"day_of_week_iso": 1, "hour_of_day_local": 0, "repeat_problem_score": 0.0},
                {"day_of_week_iso": 2, "hour_of_day_local": 5, "repeat_problem_score": 0.0},
            ],
        )
    )
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.habits is not None
    assert out.habits.matrix[0][0] == 0.0
    assert out.habits.matrix[1][5] == 0.0
    assert out.habits.matrix[3][3] is None


def test_build_route_reliability_habits_empty_is_all_null() -> None:
    """A route with no habit rows publishes an all-null 7x24 matrix (slice-9.1.1x)."""
    conn = FakeConn(_route_reliability_dispatch(habit=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.habits is not None
    assert out.habits.scale == "repeat_problem_relative"
    assert len(out.habits.matrix) == 7
    assert all(len(row) == 24 for row in out.habits.matrix)
    assert all(cell is None for row in out.habits.matrix for cell in row)


def test_build_route_reliability_weak_stops_sorted_desc_default_serves_all() -> None:
    # S7: the top-5 cap is raised to a selectable worst-N (default 100), so the
    # default now serves ALL valid stops, sorted desc by avg delay.
    weak = [
        {"stop_id": f"S{i}", "obs": 10, "weighted_delay_sec": delay_sec * 10, "severe": 0}
        for i, delay_sec in enumerate([60, 600, 300, 120, 420, 30])
    ]
    names = [{"stop_id": f"S{i}", "stop_name": f"Stop {i}"} for i in range(6)]
    conn = FakeConn(_route_reliability_dispatch(weak=weak, names=names))

    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert len(out.weak_stops) == 6  # default no longer caps at 5
    delays = [w.avg_delay_min for w in out.weak_stops]
    assert delays == sorted(delays, reverse=True)  # descending
    # worst is S1 (600s -> 10.0 min); name resolved from dim_stop
    assert out.weak_stops[0].id == "S1"
    assert out.weak_stops[0].name == "Stop 1"
    assert out.weak_stops[0].avg_delay_min == 10.0
    # the smallest (S5 = 30s -> 0.5 min) is now INCLUDED, not dropped
    assert out.weak_stops[-1].id == "S5"
    assert out.weak_stops[-1].avg_delay_min == 0.5


def test_build_route_reliability_weak_stops_respects_explicit_limit() -> None:
    # The new weak_stops_limit param caps the served list; a route with fewer
    # stops than the limit returns only what exists (honest, never padded).
    weak = [
        {"stop_id": f"S{i}", "obs": 10, "weighted_delay_sec": delay_sec * 10, "severe": 0}
        for i, delay_sec in enumerate([60, 600, 300, 120, 420, 30])
    ]
    names = [{"stop_id": f"S{i}", "stop_name": f"Stop {i}"} for i in range(6)]

    conn = FakeConn(_route_reliability_dispatch(weak=weak, names=names))
    out = build_route_reliability(conn, route_id="51", generated_utc="t", weak_stops_limit=3)
    assert [w.id for w in out.weak_stops] == ["S1", "S4", "S2"]  # top 3 by delay

    conn2 = FakeConn(_route_reliability_dispatch(weak=weak, names=names))
    out_all = build_route_reliability(
        conn2, route_id="51", generated_utc="t", weak_stops_limit=100
    )
    assert len(out_all.weak_stops) == 6  # limit beyond available returns only what exists


def test_build_route_reliability_delay_by_crowding_dominant_band() -> None:
    # Two days: day1 dominant band = many_seats (50 > others), day2 dominant
    # band = standing (40 > others). Each day's delay is bucketed under its
    # dominant band; avg is observation-weighted by that day's delay_obs.
    crowding = [
        {"d": datetime.date(2026, 6, 1), "empty": 0, "many_seats": 50,
         "few_seats": 30, "standing": 15, "full": 5,
         "avg_delay_sec": 120.0, "delay_obs": 10},
        {"d": datetime.date(2026, 6, 2), "empty": 0, "many_seats": 10,
         "few_seats": 20, "standing": 40, "full": 5,
         "avg_delay_sec": 300.0, "delay_obs": 30},
    ]
    conn = FakeConn(_route_reliability_dispatch(crowding=crowding))

    out = build_route_reliability(conn, route_id="51", generated_utc="t")

    by_band = {c.band: c for c in out.delay_by_crowding}
    assert set(by_band) == {"many_seats", "standing"}
    # many_seats: single day, 120s -> 2.0 min, 10 obs, 1 day
    assert by_band["many_seats"].avg_delay_min == 2.0
    assert by_band["many_seats"].observation_count == 10
    assert by_band["many_seats"].day_count == 1
    # standing: single day, 300s -> 5.0 min, 30 obs, 1 day
    assert by_band["standing"].avg_delay_min == 5.0
    assert by_band["standing"].observation_count == 30
    assert by_band["standing"].day_count == 1
    # no daily percentile rows in this dispatch -> p50_min honest-None
    assert by_band["many_seats"].p50_min is None


def test_build_route_reliability_delay_by_crowding_obs_weighted() -> None:
    # Two days share the SAME dominant band (many_seats); avg_delay_min is
    # observation-weighted by delay_obs, not a plain mean.
    crowding = [
        {"d": datetime.date(2026, 6, 1), "empty": 0, "many_seats": 50,
         "few_seats": 1, "standing": 0, "full": 0,
         "avg_delay_sec": 60.0, "delay_obs": 10},  # 1.0 min, weight 10
        {"d": datetime.date(2026, 6, 2), "empty": 0, "many_seats": 50,
         "few_seats": 1, "standing": 0, "full": 0,
         "avg_delay_sec": 240.0, "delay_obs": 30},  # 4.0 min, weight 30
    ]
    conn = FakeConn(_route_reliability_dispatch(crowding=crowding))

    out = build_route_reliability(conn, route_id="51", generated_utc="t")

    cell = {c.band: c for c in out.delay_by_crowding}["many_seats"]
    # weighted: (60*10 + 240*30) / 40 = 195s -> 3.2 min (NOT plain mean 2.5)
    assert cell.avg_delay_min == 3.2
    assert cell.observation_count == 40
    assert cell.day_count == 2


def test_build_route_reliability_delay_by_crowding_empty_when_no_telemetry() -> None:
    # No occupancy rows -> empty list (honest absence, never a fabricated band).
    conn = FakeConn(_route_reliability_dispatch(crowding=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.delay_by_crowding == []


def test_build_route_reliability_delay_by_crowding_skips_zero_obs_days() -> None:
    # A day with zero band observations has no dominant band -> skipped entirely.
    crowding = [
        {"d": datetime.date(2026, 6, 1), "empty": 0, "many_seats": 0,
         "few_seats": 0, "standing": 0, "full": 0,
         "avg_delay_sec": 120.0, "delay_obs": 10},
    ]
    conn = FakeConn(_route_reliability_dispatch(crowding=crowding))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.delay_by_crowding == []


def test_build_route_reliability_by_shift_daytype_empty_when_absent() -> None:
    # No crosstab rows -> empty list (SPARSE / honest absence, never fabricated).
    conn = FakeConn(_route_reliability_dispatch(crosstab=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.by_shift_daytype == []


def test_build_route_reliability_by_shift_daytype_honest_null_metrics() -> None:
    # A spine crosstab cell with no known-delay observations -> honest-None per metric,
    # but the cell is still emitted (it keeps its shift/day_type identity + obs count).
    # Post-cutover by_shift_daytype derives from _spine_route_crosstab, so feed a
    # SPINE-shaped zero row (needle "AS day_type" is unique to the crosstab SQL).
    from transit_ops.snapshots.builders.historic import _spine_route_crosstab

    row = {"shift": "night", "day_type": "weekend", "known_obs": 0, "obs": 0,
           "on_time": None, "severe": 0, "sum_delay_sec": 0}
    for k in range(1, 22):
        row[f"h{k}"] = 0
    conn = FakeConn([("AS day_type", [row])])
    cells = _spine_route_crosstab(conn, {"provider_id": "stm", "route_id": "51"})
    cell = cells[0]
    assert cell.shift == "night" and cell.day_type == "weekend"
    assert cell.otp_pct is None
    assert cell.avg_delay_min is None
    assert cell.severe_pct is None
    assert cell.observation_count == 0


def test_build_route_reliability_occupancy_by_dow_cells() -> None:
    # S7 §04: per-ISO-weekday crowding mix; one OccupancyByDow per weekday with
    # band telemetry, shares computed from the summed band counts.
    occ_dow = [
        {"day_of_week_iso": 1, "empty": 0, "many_seats": 5,
         "few_seats": 3, "standing": 2, "full": 0},
        {"day_of_week_iso": 6, "empty": 8, "many_seats": 2,
         "few_seats": 0, "standing": 0, "full": 0},
    ]
    conn = FakeConn(_route_reliability_dispatch(occ_dow=occ_dow))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    by = {c.day_of_week_iso: c for c in out.occupancy_by_dow}
    assert set(by) == {1, 6}
    assert by[1].mix is not None
    assert by[1].mix.many_seats == 0.5  # 5/10
    assert by[1].mix.standing == 0.2  # 2/10
    assert by[6].mix.empty == 0.8  # 8/10


def test_build_route_reliability_occupancy_by_dow_honest_none_when_no_bands() -> None:
    # A weekday with data-days but all-zero band counts -> mix is None (honest
    # absence, never a fabricated all-empty mix); the cell is still emitted.
    occ_dow = [
        {"day_of_week_iso": 3, "empty": 0, "many_seats": 0,
         "few_seats": 0, "standing": 0, "full": 0},
    ]
    conn = FakeConn(_route_reliability_dispatch(occ_dow=occ_dow))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert len(out.occupancy_by_dow) == 1
    assert out.occupancy_by_dow[0].day_of_week_iso == 3
    assert out.occupancy_by_dow[0].mix is None


def test_build_route_reliability_occupancy_by_dow_empty_when_absent() -> None:
    conn = FakeConn(_route_reliability_dispatch(occ_dow=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.occupancy_by_dow == []


def test_build_route_reliability_occupancy_by_grain_windows() -> None:
    # S7 §04: grain-aware crowding mix bucketed in Python from trailing-30d daily
    # band rows. day = most recent closed day; week = trailing 7d; month = all 30d.
    occ_grain = [
        {"d": datetime.date(2026, 6, 20), "empty": 0, "many_seats": 10,
         "few_seats": 0, "standing": 0, "full": 0},
        {"d": datetime.date(2026, 6, 15), "empty": 0, "many_seats": 0,
         "few_seats": 10, "standing": 0, "full": 0},
        {"d": datetime.date(2026, 5, 25), "empty": 10, "many_seats": 0,
         "few_seats": 0, "standing": 0, "full": 0},
    ]
    conn = FakeConn(_route_reliability_dispatch(occ_grain=occ_grain))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    g = {c.grain: c for c in out.occupancy_by_grain}
    assert set(g) == {"day", "week", "month"}
    # day = only the most recent day (06-20) -> 100% many_seats
    assert g["day"].mix.many_seats == 1.0
    # week = 06-20 + 06-15 (5 days apart) -> 10 many + 10 few over 20 -> 0.5 each
    assert g["week"].mix.many_seats == 0.5
    assert g["week"].mix.few_seats == 0.5
    # month = all three days -> 10 each over 30 -> ~0.333 empty
    assert round(g["month"].mix.empty, 3) == 0.333


def test_build_route_reliability_occupancy_by_grain_honest_none_when_no_bands() -> None:
    # Data-days exist but carry no band telemetry -> every grain emitted with
    # mix None (honest), never a fabricated mix.
    occ_grain = [
        {"d": datetime.date(2026, 6, 20), "empty": 0, "many_seats": 0,
         "few_seats": 0, "standing": 0, "full": 0},
    ]
    conn = FakeConn(_route_reliability_dispatch(occ_grain=occ_grain))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    g = {c.grain: c for c in out.occupancy_by_grain}
    assert set(g) == {"day", "week", "month"}
    assert all(c.mix is None for c in out.occupancy_by_grain)


def test_build_route_reliability_occupancy_by_grain_empty_when_absent() -> None:
    conn = FakeConn(_route_reliability_dispatch(occ_grain=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.occupancy_by_grain == []


def test_stop_names_sql_unions_history() -> None:
    """Stop-name lookups must fall back to gold.dim_stop_history so ids retired
    by a GTFS drop keep resolving names; current dim (pri 0) wins on ties."""
    sql = str(_STOP_NAMES_SQL)
    assert "gold.dim_stop_history" in sql
    assert "UNION ALL" in sql
    assert "DISTINCT ON (u.stop_id)" in sql


def test_route_names_sql_unions_history() -> None:
    sql = str(_ROUTE_NAMES_SQL)
    assert "gold.dim_route_history" in sql
    assert "UNION ALL" in sql
    assert "DISTINCT ON (u.route_id)" in sql
    assert "COALESCE(route_long_name, route_short_name)" in sql


def test_build_route_reliability_weak_stop_name_from_history() -> None:
    """A weak stop retired from the current dims still gets a display name via
    the history-backed UNION (the fake returns the unioned row set)."""
    weak = [
        {"stop_id": "S_RETIRED", "obs": 10, "weighted_delay_sec": 6000.0, "severe": 0},
        {"stop_id": "S1", "obs": 10, "weighted_delay_sec": 1200.0, "severe": 0},
    ]
    names = [
        {"stop_id": "S1", "stop_name": "Stop 1"},
        # present only in dim_stop_history — surfaced by the UNION query
        {"stop_id": "S_RETIRED", "stop_name": "Ancien arret"},
    ]
    conn = FakeConn(_route_reliability_dispatch(weak=weak, names=names))

    out = build_route_reliability(conn, route_id="51", generated_utc="t")

    by_id = {w.id: w for w in out.weak_stops}
    assert by_id["S_RETIRED"].name == "Ancien arret"
    assert by_id["S1"].name == "Stop 1"


def test_build_route_reliability_name_field() -> None:
    conn = FakeConn(
        _route_reliability_dispatch(
            route_names=[
                {"route_id": "51", "route_name": "Boulevard Saint-Laurent"},
                {"route_id": "9", "route_name": "Autre ligne"},
            ],
        )
    )

    out = build_route_reliability(conn, route_id="51", generated_utc="t")

    assert out.name == "Boulevard Saint-Laurent"


def test_build_route_reliability_unknown_route_name_is_none() -> None:
    conn = FakeConn(_route_reliability_dispatch(route_names=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.name is None


def test_build_route_reliability_no_dataset_version_still_builds() -> None:
    """No current static dataset -> scheduled headway empty, but periods/habits
    from gold rollups still populate (graceful degradation)."""
    conn = FakeConn(
        [
            ("dataset_kind = 'static_schedule'", []),  # no version
            # delay×crowding precedes the daily-view needle (shared substring).
            ("-- delay_by_crowding", []),
            (
                "public_route_reliability_daily",
                [
                    {
                        "d": datetime.date(2026, 6, 1),
                        "known_obs": 100,
                        "on_time": 96,
                        "avg_delay_sec": 60.0,
                        "severe": 4,
                    }
                ],
            ),
            (
                "route_headway_by_shift",
                [{"shift": "am_peak", "observed_headway_min": 7.0, "sample_count": 9}],
            ),
        ]
    )
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    # daily period still present
    assert any(p.grain == "day" for p in out.periods)
    # observed headway present but no scheduled (no dataset) -> excess None
    am = next(h for h in out.headway if h.shift == "am_peak")
    assert am.observed_min == 7.0
    assert am.scheduled_min is None
    assert am.excess_wait_min is None


# --------------------------------------------------------------------------
# build_stop_reliability (BATCH)
# --------------------------------------------------------------------------


def test_build_stop_reliability_batch() -> None:
    # DB-0067 Phase 1: weekly + monthly + by_route all read gold.stop_delay_spine
    # over a trailing window. The weekly/monthly SQL is now identical text (group by
    # stop_id over the spine), so they are distinguished by the window param
    # win_start: week = anchor-6, month = anchor-29 (see _grain_windows). The
    # provider-wide MAX(service_local_date) anchor query is dispatched first.
    conn = _StopSpineFakeConn(
        anchor=datetime.date(2026, 6, 30),
        by_route=[
            {"stop_id": "S1", "route_id": "51", "obs": 100, "weighted_delay_sec": 6000.0},
            {"stop_id": "S1", "route_id": "9", "obs": 50, "weighted_delay_sec": 9000.0},
        ],
        # S1: obs=150, severe=15 -> OTP 90; weighted 12000 over obs 150 -> 80s -> 1.3 min
        weekly=[{"stop_id": "S1", "obs": 150, "weighted_delay_sec": 12000.0, "severe": 15}],
        # S1 monthly: obs=600, sev=30 -> OTP 95; 90000/600 = 150s -> 2.5
        monthly=[{"stop_id": "S1", "obs": 600, "weighted_delay_sec": 90000.0, "severe": 30}],
    )

    out = build_stop_reliability(conn, provider_id="stm", generated_utc="t")

    assert "S1" in out
    s1 = out["S1"]
    assert isinstance(s1, StopReliability)
    assert s1.id == "S1"

    by_grain = {p.grain: p for p in s1.periods}
    assert [p.grain for p in s1.periods] == ["week", "month"]  # ordered week then month

    wk = by_grain["week"]
    assert wk.otp_pct == 90  # (150-15)/150
    assert wk.avg_delay_min == 1.3  # 12000/150 = 80s -> 1.333 -> 1.3
    assert wk.severe_pct == 10.0  # 15/150

    mo = by_grain["month"]
    assert mo.otp_pct == 95  # (600-30)/600
    assert mo.avg_delay_min == 2.5  # 90000/600 = 150s
    assert mo.severe_pct == 5.0  # 30/600

    # by_route natural-sorted: "9" before "51"
    assert [b.route for b in s1.by_route] == ["9", "51"]
    by_route = {b.route: b for b in s1.by_route}
    assert by_route["51"].avg_delay_min == 1.0  # 6000/100 = 60s
    assert by_route["9"].avg_delay_min == 3.0  # 9000/50 = 180s


def test_stop_by_route_sql_excludes_unrouted_sentinel() -> None:
    """A stop's per-route breakdown must not list the '__unrouted__' sentinel.

    stop_delay's feeder COALESCEs a NULL route_id to '__unrouted__', so the
    by-route aggregate would otherwise surface it as a real route at the stop.
    """
    assert "route_id <> '__unrouted__'" in _STOP_REL_BY_ROUTE_SQL.text


def test_build_stop_reliability_weekly_only_stop() -> None:
    """A stop present only in the weekly view still produces a model (month absent)."""
    conn = _StopSpineFakeConn(
        anchor=datetime.date(2026, 6, 30),
        weekly=[{"stop_id": "S2", "obs": 80, "weighted_delay_sec": 4800.0, "severe": 8}],
        monthly=[],
    )
    out = build_stop_reliability(conn, generated_utc="t")
    assert "S2" in out
    s2 = out["S2"]
    assert [p.grain for p in s2.periods] == ["week"]
    assert s2.periods[0].otp_pct == 90  # (80-8)/80
    assert s2.by_route == []


def test_build_stop_reliability_carries_name() -> None:
    """Per-stop files self-describe: name resolved current-dim-first with the
    history fallback; ids with no name anywhere stay None."""
    conn = _StopSpineFakeConn(
        anchor=datetime.date(2026, 6, 30),
        weekly=[
            {"stop_id": "S1", "obs": 150, "weighted_delay_sec": 12000.0, "severe": 15},
            {"stop_id": "S_UNNAMED", "obs": 10, "weighted_delay_sec": 600.0, "severe": 0},
        ],
        monthly=[],
        extra=[("DISTINCT ON (u.stop_id)", [{"stop_id": "S1", "stop_name": "Station Berri"}])],
    )

    out = build_stop_reliability(conn, provider_id="stm", generated_utc="t")

    assert out["S1"].name == "Station Berri"
    assert out["S_UNNAMED"].name is None


def test_build_hotspots_ranks_and_top_20() -> None:
    """Top-20 cap, rank assigned 1..N, week-period selected."""
    # 25 rows — only first 20 should appear (SQL LIMIT enforced by fake order).
    # Every cell carries the network baseline (net_*) on each row, mirroring the
    # CROSS JOIN net in the real query; the first cell also carries its severe
    # proxy counts so its otp_delta_pts computes (the rest stay honest-None).
    rows = [
        {
            "entity_kind": "stop",
            "entity_id": f"S{i}",
            "issue_count": 100 - i,
            "severity_label": "high",
            # route on-time baseline (unused by stop cells, carried on every row)
            "net_on_time": 90,
            "net_known": 100,
            # STOP severe-proxy network baseline: (100-10)/100 -> 90% on every row
            "net_stop_obs": 100,
            "net_stop_severe": 10,
            # first cell only: severe proxy 70/100 -> 30 severe -> OTP 70%
            "stop_obs": 100 if i == 0 else None,
            "stop_severe": 30 if i == 0 else None,
        }
        for i in range(25)
    ]
    conn = FakeConn([("repeated_problem_route_stop", rows[:20])])  # fake returns 20

    out = build_hotspots(conn, provider_id="stm", generated_utc="t")

    assert isinstance(out, Hotspots)
    assert len(out.hotspots) == 20
    # ranks are 1..20
    assert [h.rank for h in out.hotspots] == list(range(1, 21))
    # first hotspot is the highest issue_count row
    first = out.hotspots[0]
    assert first.type == "stop"
    assert first.id == "S0"
    assert first.severity == "high"
    # stop severe-proxy OTP 70 minus network baseline 90 -> -20.0 pts (worse)
    assert first.otp_delta_pts == -20.0
    # a cell whose own OTP is unknown stays honest-None (never 0)
    assert out.hotspots[1].otp_delta_pts is None


def test_build_hotspots_empty_returns_empty() -> None:
    conn = FakeConn([("repeated_problem_route_stop", [])])
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots == []


def test_build_hotspots_week_period_filter() -> None:
    """SQL needle 'repeated_problem_route_stop' matches — verify entity_kind preserved."""
    rows = [
        {"entity_kind": "route", "entity_id": "51", "issue_count": 5, "severity_label": "watch"},
        {"entity_kind": "stop", "entity_id": "3456", "issue_count": 3, "severity_label": "high"},
    ]
    conn = FakeConn([("repeated_problem_route_stop", rows)])
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].type == "route"
    assert out.hotspots[1].type == "stop"
    assert out.hotspots[0].rank == 1
    assert out.hotspots[1].rank == 2


def test_build_hotspots_excludes_sentinel_entities() -> None:
    """Honesty guard (slice-9-honesty-fixes): the __unrouted__ / __unknown_stop__
    NULL-buckets must never surface as a named hotspot, even if a query path returns
    them; survivors re-rank from 1 (defense-in-depth over the publish-SQL filter)."""
    rows = [
        {"entity_kind": "route", "entity_id": "__unrouted__", "issue_count": 99,
         "severity_label": "critical"},
        {"entity_kind": "route", "entity_id": "51", "issue_count": 40, "severity_label": "high"},
        {"entity_kind": "stop", "entity_id": "__unknown_stop__", "issue_count": 30,
         "severity_label": "high"},
        {"entity_kind": "stop", "entity_id": "3456", "issue_count": 10, "severity_label": "watch"},
    ]
    conn = FakeConn([("repeated_problem_route_stop", rows)])
    out = build_hotspots(conn, generated_utc="t")
    ids = [h.id for h in out.hotspots]
    assert "__unrouted__" not in ids
    assert "__unknown_stop__" not in ids
    assert ids == ["51", "3456"]
    assert [h.rank for h in out.hotspots] == [1, 2]


def test_build_hotspots_resolves_names() -> None:
    """Per-kind name resolution: 'route' rows from the route map, 'stop' rows
    from the stop map (history-backed for retired ids); unknown ids stay None."""
    rows = [
        {"entity_kind": "route", "entity_id": "51", "issue_count": 9, "severity_label": "high"},
        {
            "entity_kind": "stop",
            "entity_id": "S_RETIRED",
            "issue_count": 7,
            "severity_label": "watch",
        },
        {
            "entity_kind": "stop",
            "entity_id": "S_UNKNOWN",
            "issue_count": 5,
            "severity_label": "watch",
        },
    ]
    conn = FakeConn(
        [
            ("repeated_problem_route_stop", rows),
            ("DISTINCT ON (u.route_id)", [{"route_id": "51", "route_name": "Saint-Laurent"}]),
            # retired stop id present only via the history half of the UNION
            ("DISTINCT ON (u.stop_id)", [{"stop_id": "S_RETIRED", "stop_name": "Ancien arret"}]),
        ]
    )

    out = build_hotspots(conn, generated_utc="t")

    assert out.hotspots[0].name == "Saint-Laurent"
    assert out.hotspots[1].name == "Ancien arret"
    assert out.hotspots[2].name is None


def test_build_hotspots_otp_delta_route_real_otp_signed_1dp() -> None:
    """A route cell's otp_delta_pts = its REAL OTP (route_reliability_weekly
    on_time/known) minus the network baseline OTP, signed and rounded to 1 dp."""
    rows = [
        {
            "entity_kind": "route",
            "entity_id": "51",
            "issue_count": 9,
            "severity_label": "high",
            # route real OTP: 75 on-time / 100 known -> 75%
            "route_on_time": 75,
            "route_known": 100,
            # stop columns are NULL for a route cell (per-kind JOIN)
            "stop_obs": None,
            "stop_severe": None,
            # network baseline: 825 / 1000 -> 82.5 -> round 82 (int via _otp_pct)
            "net_on_time": 825,
            "net_known": 1000,
        },
    ]
    conn = FakeConn([("repeated_problem_route_stop", rows)])
    out = build_hotspots(conn, generated_utc="t")
    # _otp_pct(825,1000)=round(82.5)=82 ; 75 - 82 = -7.0 pts (worse than network)
    assert out.hotspots[0].otp_delta_pts == -7.0


def test_build_hotspots_otp_delta_stop_uses_severe_proxy() -> None:
    """A stop cell's otp_delta_pts uses the severe(>300s) proxy ((obs-severe)/obs)
    — NOT a route OTP — minus a STOP-grain severe-proxy network baseline (same
    metric on both sides). Stop has no on_time column."""
    rows = [
        {
            "entity_kind": "stop",
            "entity_id": "3456",
            "issue_count": 8,
            "severity_label": "high",
            # route columns NULL for a stop cell (no cross-contamination)
            "route_on_time": None,
            "route_known": None,
            # severe proxy: (200 - 40) / 200 -> 80%
            "stop_obs": 200,
            "stop_severe": 40,
            # route on-time baseline is carried but MUST be ignored for stop cells
            "net_on_time": 90,
            "net_known": 100,
            # stop severe-proxy network baseline: (1000 - 100) / 1000 -> 90%
            "net_stop_obs": 1000,
            "net_stop_severe": 100,
        },
    ]
    conn = FakeConn([("repeated_problem_route_stop", rows)])
    out = build_hotspots(conn, generated_utc="t")
    # 80 - 90 = -10.0 pts (severe-proxy cell vs severe-proxy network)
    assert out.hotspots[0].otp_delta_pts == -10.0


def test_build_hotspots_otp_delta_stop_problem_is_negative_vs_severe_baseline() -> None:
    """Regression: a real problem stop (severe rate ABOVE the network's severe rate)
    must surface a NEGATIVE delta (worse than network), not a fabricated positive.

    The old code subtracted the route ON-TIME net (~82%) from the stop severe-proxy
    (~95-99%), biasing every stop POSITIVE. With a stop-grain severe-proxy baseline
    the comparison is same-metric: a stop with a 5% severe rate vs the network's 2%
    severe rate reads -3.0 pts, the truthful 'worse than network'."""
    rows = [
        {
            "entity_kind": "stop",
            "entity_id": "9999",
            "issue_count": 12,
            "severity_label": "high",
            # realistic problem stop: 5% severe -> proxy OTP 95%
            "stop_obs": 1000,
            "stop_severe": 50,
            # route on-time net ~82% — the OLD baseline; would give +13 (WRONG sign)
            "net_on_time": 8200,
            "net_known": 10000,
            # network severe rate 2% -> severe-proxy baseline 98%
            "net_stop_obs": 100000,
            "net_stop_severe": 2000,
        },
    ]
    conn = FakeConn([("repeated_problem_route_stop", rows)])
    out = build_hotspots(conn, generated_utc="t")
    # 95 - 98 = -3.0 pts: the problem stop reads WORSE than the network (truthful).
    # Under the old route-on-time baseline this was 95 - 82 = +13.0 (the bug).
    assert out.hotspots[0].otp_delta_pts == -3.0


def test_build_hotspots_otp_delta_stop_none_when_severe_baseline_missing() -> None:
    """Honest-None: a stop cell whose stop-grain network severe-proxy baseline is
    unknown yields None — never falls back to the route on-time net baseline."""
    rows = [
        {
            "entity_kind": "stop",
            "entity_id": "3456",
            "issue_count": 8,
            "severity_label": "high",
            "stop_obs": 200,
            "stop_severe": 40,  # cell proxy known (80%)
            # route on-time net is known but MUST NOT be used as the stop baseline
            "net_on_time": 90,
            "net_known": 100,
            # stop severe-proxy baseline unknown -> delta None
            "net_stop_obs": None,
            "net_stop_severe": None,
        },
    ]
    conn = FakeConn([("repeated_problem_route_stop", rows)])
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].otp_delta_pts is None  # honest-None, not 80-90=-10


def test_build_hotspots_otp_delta_cell_otp_unknown_is_none() -> None:
    """Honest-None: a cell whose own OTP cannot be computed (no obs) yields None,
    never 0 — even though the network baseline is known."""
    rows = [
        {
            "entity_kind": "route",
            "entity_id": "99",
            "issue_count": 5,
            "severity_label": "watch",
            "route_on_time": None,  # OTP unknown
            "route_known": None,
            "stop_obs": None,
            "stop_severe": None,
            "net_on_time": 90,  # baseline known
            "net_known": 100,
        },
    ]
    conn = FakeConn([("repeated_problem_route_stop", rows)])
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].otp_delta_pts is None


def test_build_hotspots_otp_delta_network_baseline_null_is_none() -> None:
    """Honest-None: when the network baseline OTP is unknown for the period, the
    delta is None for every cell — a known cell OTP alone is not comparable."""
    rows = [
        {
            "entity_kind": "route",
            "entity_id": "51",
            "issue_count": 9,
            "severity_label": "high",
            "route_on_time": 75,  # cell OTP known
            "route_known": 100,
            "stop_obs": None,
            "stop_severe": None,
            "net_on_time": None,  # baseline unknown
            "net_known": None,
        },
    ]
    conn = FakeConn([("repeated_problem_route_stop", rows)])
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].otp_delta_pts is None


def test_hotspots_sql_per_kind_otp_join_keys() -> None:
    """SQL guards against route/stop OTP cross-contamination: the route join is
    scoped to entity_kind='route' on route_id, the stop join to entity_kind='stop'
    on stop_id, and the route network baseline reads the route delay spine (S7-B)."""
    sql = str(_HOTSPOTS_SQL)
    assert "rp.entity_kind = 'route'" in sql
    assert "rrw.route_id = rp.entity_id" in sql
    assert "rp.entity_kind = 'stop'" in sql
    assert "so.stop_id = rp.entity_id" in sql
    # route network baseline aggregates real OTP over a spine-derived weekly CTE
    assert "net_on_time" in sql and "net_known" in sql
    assert "route_spine_weekly AS" in sql
    assert "gold.route_delay_spine" in sql
    # stop weekly OTP now ALSO derives from a spine-derived weekly CTE (DB-0067
    # Phase 1) — the dropped stop_delay_weekly mart is no longer read here.
    assert "stop_spine_weekly AS" in sql
    assert "gold.stop_delay_spine" in sql
    assert "gold.stop_delay_weekly" not in sql
    # stop network baseline aggregates the severe-proxy over ALL stops (same
    # metric a stop cell uses), so stop deltas are not lenient-vs-strict
    assert "net_stop_obs" in sql and "net_stop_severe" in sql
    assert "net_stop AS" in sql


# --------------------------------------------------------------------------
# build_repeat_offenders
# --------------------------------------------------------------------------


def test_build_repeat_offenders_recurrence_string() -> None:
    """recurrence field is formatted as '{recurrence_days}/{window_days}d'.

    gold.repeat_offender only ever contains 'trip' and 'vehicle' kinds
    (rollups aggregate by trip_id/vehicle_id) — fixtures use the real kinds.
    """
    rows = [
        {
            "entity_kind": "trip",
            "entity_id": "X1",
            "route_id": "51",
            "recurrence_days": 7,
            "window_days": 14,
            "avg_delay_seconds": 180.0,
            "severity_label": "high",
        },
    ]
    conn = FakeConn([("repeat_offender", rows)])
    out = build_repeat_offenders(conn, generated_utc="t")
    assert isinstance(out, RepeatOffenders)
    assert len(out.offenders) == 1
    o = out.offenders[0]
    assert o.recurrence == "7/14d"
    assert o.avg_delay_min == 3.0  # 180s / 60
    assert o.route == "51"
    assert o.type == "trip"
    assert o.id == "X1"


def test_build_repeat_offenders_ordering() -> None:
    """Rows come back pre-ordered by SQL (recurrence_days DESC, delay DESC);
    Python preserves insertion order."""
    rows = [
        {
            "entity_kind": "trip",
            "entity_id": "T9",
            "route_id": "9",
            "recurrence_days": 10,
            "window_days": 14,
            "avg_delay_seconds": 300.0,
            "severity_label": "high",
        },
        {
            "entity_kind": "vehicle",
            "entity_id": "V2",
            "route_id": "51",
            "recurrence_days": 5,
            "window_days": 14,
            "avg_delay_seconds": 600.0,
            "severity_label": "critical",
        },
    ]
    conn = FakeConn([("repeat_offender", rows)])
    out = build_repeat_offenders(conn, generated_utc="t")
    assert out.offenders[0].id == "T9"  # higher recurrence_days comes first
    assert out.offenders[1].id == "V2"


def test_build_repeat_offenders_top_50_cap() -> None:
    """SQL LIMIT 50 enforced — fake returns exactly 50 rows."""
    rows = [
        {
            "entity_kind": "vehicle",
            "entity_id": f"V{i}",
            "route_id": "51",
            "recurrence_days": 50 - i,
            "window_days": 60,
            "avg_delay_seconds": 120.0,
            "severity_label": "watch",
        }
        for i in range(50)
    ]
    conn = FakeConn([("repeat_offender", rows)])
    out = build_repeat_offenders(conn, generated_utc="t")
    assert len(out.offenders) == 50


def test_build_repeat_offenders_resolves_route_name() -> None:
    """Offenders are 'trip'/'vehicle' entities with no display name of their
    own — the ROUTE context gets the resolved name (history-backed for routes
    retired by a GTFS drop); entity ids stay raw."""
    rows = [
        {
            "entity_kind": "trip",
            "entity_id": "281234567",
            "route_id": "51",
            "recurrence_days": 9,
            "window_days": 14,
            "avg_delay_seconds": 240.0,
            "severity_label": "high",
        },
        {
            "entity_kind": "vehicle",
            "entity_id": "39041",
            "route_id": "R_RETIRED",
            "recurrence_days": 6,
            "window_days": 14,
            "avg_delay_seconds": 300.0,
            "severity_label": "critical",
        },
        {
            "entity_kind": "vehicle",
            "entity_id": "39042",
            "route_id": None,
            "recurrence_days": 4,
            "window_days": 14,
            "avg_delay_seconds": 120.0,
            "severity_label": "watch",
        },
    ]
    conn = FakeConn(
        [
            ("repeat_offender", rows),
            (
                "DISTINCT ON (u.route_id)",
                [
                    {"route_id": "51", "route_name": "Boulevard Saint-Laurent"},
                    # present only in dim_route_history — retired at the drop
                    {"route_id": "R_RETIRED", "route_name": "Ancienne ligne"},
                ],
            ),
        ]
    )

    out = build_repeat_offenders(conn, generated_utc="t")

    assert out.offenders[0].route_name == "Boulevard Saint-Laurent"
    assert out.offenders[0].id == "281234567"  # raw trip id, no entity name
    assert out.offenders[1].route_name == "Ancienne ligne"
    assert out.offenders[2].route_name is None  # no route context at all


# --------------------------------------------------------------------------
# build_receipts
# --------------------------------------------------------------------------


def _receipts_dispatch(*, acct=None, net=None, worst_route=None, worst_stop=None,
                       route_names=None, stop_names=None):
    """Build dispatch list for build_receipts; needles matched most-specific first."""
    return [
        ("citizen_accountability_daily", acct or []),
        ("route_delay_hourly", net or []),
        ("public_route_reliability_daily", worst_route or []),
        ("public_stop_delay_daily", worst_stop or []),
        ("DISTINCT ON (u.route_id)", route_names or []),
        ("DISTINCT ON (u.stop_id)", stop_names or []),
    ]


def test_build_receipts_date_driven_by_accountability() -> None:
    """Only dates present in citizen_accountability_daily appear in the output."""
    d1 = datetime.date(2026, 5, 1)
    d2 = datetime.date(2026, 5, 2)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d1,
                    "affected_route_count": 3,
                    "affected_stop_count": 10,
                    "delayed_trip_count": 5,
                    "severe_delay_count": 2,
                    "alert_count": 1,
                    "rider_impact_score": 0.42,
                },
            ],
            # d2 in net but NOT in acct -> should not appear in output
            net=[
                {
                    "local_date": d2,
                    "known_obs": 200,
                    "on_time": 180,
                    "severe": 10,
                    "weighted_delay_sec": 18000.0,
                },
            ],
        )
    )
    out = build_receipts(conn, generated_utc="t")
    assert list(out.keys()) == ["2026-05-01"]
    assert "2026-05-02" not in out


def test_build_receipts_rider_impact_at_cap_is_nulled() -> None:
    """An at-cap rider_impact_score (mart LEAST clamp 9999.9999 reached) means the
    true magnitude overflowed and is unknown — publish honest NULL, not the garbage
    sentinel (slice-9.1.1t)."""
    d = datetime.date(2026, 5, 20)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d,
                    "affected_route_count": 1,
                    "affected_stop_count": 1,
                    "delayed_trip_count": 1,
                    "severe_delay_count": 1,
                    "alert_count": 1,
                    "rider_impact_score": 9999.9999,
                }
            ],
        )
    )
    out = build_receipts(conn, generated_utc="t")
    assert out["2026-05-20"].rider_impact_score is None


def test_build_receipts_rider_impact_below_cap_passthrough() -> None:
    """A below-cap rider_impact_score passes through unchanged (slice-9.1.1t)."""
    d = datetime.date(2026, 5, 21)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d,
                    "affected_route_count": 1,
                    "affected_stop_count": 1,
                    "delayed_trip_count": 1,
                    "severe_delay_count": 1,
                    "alert_count": 1,
                    "rider_impact_score": 9998.5,
                }
            ],
        )
    )
    out = build_receipts(conn, generated_utc="t")
    assert out["2026-05-21"].rider_impact_score == 9998.5


def test_build_receipts_join_miss_publishes_null_affected_counts() -> None:
    """Truth-audit honesty fix: on a date whose route_daily / stop_daily source
    row is absent, the mart now stores affected_route_count / affected_stop_count
    as NULL (not a fabricated 0). The builder must pass that NULL straight through
    to affected_routes / affected_stops (int|None in the contract), never coerce
    it to 0. Pairs with the rollup-SQL fix that drops the COALESCE(...,0) wrappers."""
    d = datetime.date(2026, 5, 25)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d,
                    # join-miss day: counts stored NULL, score stored NULL
                    "affected_route_count": None,
                    "affected_stop_count": None,
                    "delayed_trip_count": 0,
                    "severe_delay_count": 0,
                    "alert_count": 7,
                    "rider_impact_score": None,
                }
            ],
        )
    )
    r = build_receipts(conn, generated_utc="t")["2026-05-25"]
    assert r.affected_routes is None
    assert r.affected_stops is None
    assert r.rider_impact_score is None
    assert r.alerts == 7  # alerts are real and stay populated


def test_build_receipts_genuine_zero_affected_counts_preserved() -> None:
    """Truth-audit honesty fix: when the source row genuinely EXISTS for the date
    (delay telemetry was present) but zero entities crossed the threshold, the mart
    stores a real 0. That real 0 must be preserved as 0 in the receipt — distinct
    from the join-miss NULL above — so a present-and-quiet day still reads honestly."""
    d = datetime.date(2026, 5, 26)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d,
                    "affected_route_count": 0,
                    "affected_stop_count": 0,
                    "delayed_trip_count": 0,
                    "severe_delay_count": 0,
                    "alert_count": 0,
                    "rider_impact_score": 0.0,
                }
            ],
        )
    )
    r = build_receipts(conn, generated_utc="t")["2026-05-26"]
    assert r.affected_routes == 0
    assert r.affected_stops == 0
    assert r.rider_impact_score == 0.0


def test_build_receipts_otp_from_network_hourly() -> None:
    """OTP, avg_delay_min, severe_pct come from route_delay_hourly aggregate."""
    d = datetime.date(2026, 5, 10)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d,
                    "affected_route_count": 5,
                    "affected_stop_count": 20,
                    "delayed_trip_count": 10,
                    "severe_delay_count": 4,
                    "alert_count": 2,
                    "rider_impact_score": 0.7,
                }
            ],
            net=[
                {
                    "local_date": d,
                    "known_obs": 100,
                    "on_time": 60,
                    "severe": 10,
                    "weighted_delay_sec": 12000.0,  # 120s avg -> 2.0 min
                }
            ],
        )
    )
    out = build_receipts(conn, generated_utc="t")
    r = out["2026-05-10"]
    assert r.otp_pct == 60      # 60/100 = 60
    assert r.avg_delay_min == 2.0
    assert r.severe_pct == 10.0  # 10/100
    assert r.vehicles is None   # v1 deferral


def test_build_receipts_worst_route_and_stop_by_max_delay() -> None:
    """worst_route and worst_stop are the rows with max avg_delay_seconds per date."""
    d = datetime.date(2026, 5, 15)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d,
                    "affected_route_count": 2,
                    "affected_stop_count": 5,
                    "delayed_trip_count": 1,
                    "severe_delay_count": 0,
                    "alert_count": 0,
                    "rider_impact_score": None,
                }
            ],
            # network daily OTP for d: 80 on-time / 100 known -> 80%
            net=[
                {
                    "local_date": d,
                    "known_obs": 100,
                    "on_time": 80,
                    "severe": 5,
                    "weighted_delay_sec": 6000.0,
                }
            ],
            # rows ordered DESC by avg_delay_seconds in SQL; first = worst.
            # The worst route (105) carries its own daily OTP 55/100 -> 55%.
            worst_route=[
                {
                    "d": d,
                    "route_id": "105",
                    "avg_delay_seconds": 300.0,
                    "on_time": 55,
                    "known_obs": 100,
                },
                {
                    "d": d,
                    "route_id": "51",
                    "avg_delay_seconds": 120.0,
                    "on_time": 90,
                    "known_obs": 100,
                },
            ],
            worst_stop=[
                {"d": d, "stop_id": "9999", "avg_delay_seconds": 420.0, "max_delay_seconds": 600.0},
                {"d": d, "stop_id": "1234", "avg_delay_seconds": 60.0, "max_delay_seconds": 90.0},
            ],
        )
    )
    out = build_receipts(conn, generated_utc="t")
    r = out["2026-05-15"]
    assert r.worst_route is not None
    assert r.worst_route.id == "105"
    # worst route OTP 55 minus network baseline 80 -> -25.0 pts (worse than network)
    assert r.worst_route.otp_delta_pts == -25.0
    assert r.worst_stop is not None
    assert r.worst_stop.id == "9999"
    assert r.worst_stop.avg_delay_min == 7.0  # 420s / 60


def test_build_receipts_skips_sentinel_worst_entities() -> None:
    """Honesty guard: a routeless/unknown-stop sentinel holding the day's max delay
    must NOT be crowned worst_route/worst_stop; the next real entity wins."""
    d = datetime.date(2026, 5, 15)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d, "affected_route_count": 1,
                    "affected_stop_count": 1, "delayed_trip_count": 0,
                    "severe_delay_count": 0, "alert_count": 0, "rider_impact_score": None,
                }
            ],
            worst_route=[
                {"d": d, "route_id": "__unrouted__", "avg_delay_seconds": 900.0},
                {"d": d, "route_id": "105", "avg_delay_seconds": 300.0},
            ],
            worst_stop=[
                {"d": d, "stop_id": "__unknown_stop__", "avg_delay_seconds": 800.0,
                 "max_delay_seconds": 1000.0},
                {"d": d, "stop_id": "9999", "avg_delay_seconds": 420.0, "max_delay_seconds": 600.0},
            ],
        )
    )
    out = build_receipts(conn, generated_utc="t")
    r = out["2026-05-15"]
    assert r.worst_route is not None and r.worst_route.id == "105"
    assert r.worst_stop is not None and r.worst_stop.id == "9999"


def test_build_receipts_worst_route_otp_delta_none_when_baseline_missing() -> None:
    """Honest-None: when the day's network baseline OTP is unknown (no network
    row), worst_route.otp_delta_pts is None even though the route OTP is known."""
    d = datetime.date(2026, 5, 16)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d, "affected_route_count": 1,
                    "affected_stop_count": 1, "delayed_trip_count": 0,
                    "severe_delay_count": 0, "alert_count": 0, "rider_impact_score": None,
                }
            ],
            # no net row for d -> network baseline OTP unknown
            worst_route=[
                {
                    "d": d,
                    "route_id": "105",
                    "avg_delay_seconds": 300.0,
                    "on_time": 55,
                    "known_obs": 100,
                },
            ],
        )
    )
    r = build_receipts(conn, generated_utc="t")["2026-05-16"]
    assert r.otp_pct is None  # no network telemetry that day
    assert r.worst_route is not None and r.worst_route.id == "105"
    assert r.worst_route.otp_delta_pts is None  # honest-None, not 0


def test_receipts_worst_entity_order_has_deterministic_tiebreaker() -> None:
    route_sql = str(_RECEIPTS_WORST_ROUTE_SQL)
    stop_sql = str(_RECEIPTS_WORST_STOP_SQL)

    assert "avg_delay_seconds DESC, route_id" in route_sql
    assert "avg_delay_seconds DESC, stop_id" in stop_sql
    # slice-9-honesty-fixes: sentinel NULL-buckets filtered at the publish-SQL layer.
    assert "route_id <> '__unrouted__'" in route_sql
    assert "stop_id <> '__unknown_stop__'" in stop_sql


def test_build_receipts_worst_entity_names() -> None:
    """worst_route/worst_stop carry resolved display names (history-backed);
    ids missing from both dim and history stay None."""
    d = datetime.date(2026, 5, 15)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d,
                    "affected_route_count": 2,
                    "affected_stop_count": 5,
                    "delayed_trip_count": 1,
                    "severe_delay_count": 0,
                    "alert_count": 0,
                    "rider_impact_score": None,
                }
            ],
            worst_route=[{"d": d, "route_id": "R_RETIRED", "avg_delay_seconds": 300.0}],
            worst_stop=[
                {"d": d, "stop_id": "S_UNKNOWN", "avg_delay_seconds": 420.0,
                 "max_delay_seconds": 600.0},
            ],
            route_names=[{"route_id": "R_RETIRED", "route_name": "Ancienne ligne"}],
            stop_names=[],
        )
    )

    out = build_receipts(conn, generated_utc="t")
    r = out["2026-05-15"]

    assert r.worst_route is not None and r.worst_route.name == "Ancienne ligne"
    assert r.worst_stop is not None and r.worst_stop.name is None


def test_build_receipts_missing_network_yields_none_otp() -> None:
    """If a date has no network rows, otp/delay fields are None (not crash)."""
    d = datetime.date(2026, 5, 20)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d,
                    "affected_route_count": 1,
                    "affected_stop_count": 2,
                    "delayed_trip_count": 0,
                    "severe_delay_count": 0,
                    "alert_count": 0,
                    "rider_impact_score": 0.1,
                }
            ]
        )
    )
    out = build_receipts(conn, generated_utc="t")
    r = out["2026-05-20"]
    assert r.otp_pct is None
    assert r.avg_delay_min is None
    assert r.severe_pct is None
    assert r.worst_route is None
    assert r.worst_stop is None
    assert r.affected_routes == 1


# --------------------------------------------------------------------------
# build_alert_history
# --------------------------------------------------------------------------


def test_build_alert_history_aggregation() -> None:
    """Routes/stops deduped+sorted, duration_min computed, id content-hashed."""
    import datetime as _dt
    import hashlib

    from transit_ops.snapshots.builders import _severity_code

    start = _dt.datetime(2026, 5, 1, 8, 0, 0, tzinfo=_dt.UTC)
    end = _dt.datetime(2026, 5, 1, 10, 30, 0, tzinfo=_dt.UTC)  # 150 min

    conn = FakeConn(
        [
            (
                "i3_alert_history_reporting",
                [
                    {
                        "alert_header_text": "Votre ligne",
                        "header_text_en": "Your line",
                        "alert_id": None,  # STM feed leaves this NULL — ignored
                        "severity": "WARNING",
                        "routes": ["51", "9", "51"],   # dedup -> ["9","51"]
                        "stops": ["3001", "1002"],
                        "start_utc": start,
                        "end_utc": end,
                    },
                ],
            )
        ]
    )
    out = build_alert_history(conn, generated_utc="t")
    assert isinstance(out, AlertHistory)
    assert len(out.alerts) == 1
    e = out.alerts[0]
    # id is a content-stable hash of header+severity+period (alert_id is NULL)
    basis = "|".join(str(x or "") for x in ("Votre ligne", "WARNING", start, end))
    assert e.id == f"stm-alert-{hashlib.sha1(basis.encode()).hexdigest()[:12]}"
    assert e.severity == _severity_code("WARNING")
    # slice-9.1.1s: header_text + MAX'd EN header pass through; grouping/id basis
    # unchanged (id hashed over header+severity+period, not EN).
    assert e.header_text == "Votre ligne"
    assert e.header_text_en == "Your line"
    assert e.duration_min == 150.0
    assert e.impact_passages is None  # v1 deferral
    # routes natural-sorted: "9" before "51"
    assert e.routes == ["9", "51"]
    # stops sorted
    assert e.stops == ["1002", "3001"]


def test_build_alert_history_breakdown_buckets_by_cause_effect_severity() -> None:
    """Tier-2 breakdown groups distinct alerts by cause/effect/severity with median
    duration; NULL cause/effect fold into 'unknown' (the high-NULL STM reality)."""
    import datetime as _dt

    from transit_ops.snapshots.builders import _severity_code

    def _row(header, sev, cause, effect, start, end):  # noqa: ANN001, ANN202
        return {
            "alert_header_text": header, "header_text_en": None, "alert_id": None,
            "severity": sev, "cause": cause, "effect": effect,
            "routes": [], "stops": [], "start_utc": start, "end_utc": end,
        }

    s = _dt.datetime(2026, 5, 1, 8, 0, 0, tzinfo=_dt.UTC)
    conn = FakeConn(
        [
            (
                "i3_alert_history_reporting",
                [
                    _row("A", "WARNING", "MAINTENANCE", "DETOUR", s, s + _dt.timedelta(minutes=60)),
                    _row("B", "WARNING", "MAINTENANCE", "DETOUR", s, s + _dt.timedelta(minutes=20)),
                    # NULL cause/effect → "unknown" bucket; no window → no duration.
                    _row("C", "INFO", None, None, None, None),
                ],
            )
        ]
    )
    out = build_alert_history(conn, generated_utc="t")
    assert out.breakdown is not None
    cause = {b.key: b for b in out.breakdown.by_cause}
    assert cause["MAINTENANCE"].count == 2
    # median of [60, 20] = 40.0
    assert cause["MAINTENANCE"].median_duration_min == 40.0
    assert cause["unknown"].count == 1
    assert cause["unknown"].median_duration_min is None
    # by_severity uses the mapped contract code; buckets ordered most-frequent-first.
    sev = {b.key: b.count for b in out.breakdown.by_severity}
    assert sev[_severity_code("WARNING")] == 2
    effect = {b.key: b.count for b in out.breakdown.by_effect}
    assert effect["DETOUR"] == 2 and effect["unknown"] == 1


def test_build_alert_history_none_timestamps_yield_none_duration() -> None:
    conn = FakeConn(
        [
            (
                "i3_alert_history_reporting",
                [
                    {
                        "alert_header_text": None,
                        "header_text_en": None,
                        "alert_id": None,
                        "severity": None,
                        "routes": None,
                        "stops": None,
                        "start_utc": None,
                        "end_utc": None,
                    },
                ],
            )
        ]
    )
    out = build_alert_history(conn, generated_utc="t")
    e = out.alerts[0]
    assert e.duration_min is None
    assert e.start_utc is None
    assert e.end_utc is None
    assert e.routes == []
    assert e.stops == []


def test_build_alert_history_negative_window_yields_none_duration() -> None:
    """A malformed alert with end < start has no meaningful duration — publish
    null, never a negative duration (slice-9.1.1y). The raw timestamps still pass
    through; only the derived duration is nulled."""
    import datetime as _dt

    start = _dt.datetime(2026, 5, 1, 10, 30, 0, tzinfo=_dt.UTC)
    end = _dt.datetime(2026, 5, 1, 8, 0, 0, tzinfo=_dt.UTC)  # end BEFORE start
    conn = FakeConn(
        [
            (
                "i3_alert_history_reporting",
                [
                    {
                        "alert_header_text": "Ligne",
                        "header_text_en": "Line",
                        "alert_id": None,
                        "severity": "WARNING",
                        "routes": ["51"],
                        "stops": ["3001"],
                        "start_utc": start,
                        "end_utc": end,
                    },
                ],
            )
        ]
    )
    out = build_alert_history(conn, generated_utc="t")
    e = out.alerts[0]
    assert e.duration_min is None  # end < start -> untrustworthy -> null
    assert e.start_utc is not None  # raw timestamps unaffected
    assert e.end_utc is not None


def test_build_alert_history_200_cap() -> None:
    """SQL LIMIT 200 enforced — fake returns exactly 200 rows."""
    import datetime as _dt

    start = _dt.datetime(2026, 5, 1, tzinfo=_dt.UTC)
    rows = [
        {
            "alert_header_text": f"H{i}",
            "header_text_en": None,
            "alert_id": None,
            "severity": "INFO",
            "routes": None,
            "stops": None,
            "start_utc": start,
            "end_utc": start,
        }
        for i in range(200)
    ]
    conn = FakeConn([("i3_alert_history_reporting", rows)])
    out = build_alert_history(conn, generated_utc="t")
    assert len(out.alerts) == 200


def test_build_alert_history_empty() -> None:
    conn = FakeConn([("i3_alert_history_reporting", [])])
    out = build_alert_history(conn, generated_utc="t")
    assert out.alerts == []


# --------------------------------------------------------------------------
# build_provenance
# --------------------------------------------------------------------------


def test_build_provenance_sources_and_freshness() -> None:
    import datetime as _dt

    loaded = _dt.datetime(2026, 6, 1, 12, 0, 0, tzinfo=_dt.UTC)
    conn = FakeConn(
        [
            (
                "source_lineage_reporting",
                [
                    {
                        "dataset_kind": "static_schedule",
                        "storage_backend": "r2",
                        "storage_path": "stm/static/latest.zip",
                        "source_url": None,
                        "loaded_at_utc": loaded,
                    },
                    {
                        "dataset_kind": "realtime_vehicle_positions",
                        "storage_backend": None,
                        "storage_path": None,
                        "source_url": "https://stm.info/gtfs-rt/vehicles",
                        "loaded_at_utc": loaded,
                    },
                ],
            ),
            (
                "feed_freshness_current",
                [
                    {
                        "endpoint_key": "vehicle_positions",
                        "status": "ok",
                        "completed_age_seconds": 25.0,
                    },
                    {
                        "endpoint_key": "trip_updates",
                        "status": "stale",
                        "completed_age_seconds": None,
                    },
                ],
            ),
        ]
    )

    out = build_provenance(conn, generated_utc="t")
    assert isinstance(out, Provenance)

    # sources
    by_feed = {s.feed: s for s in out.sources}
    assert "static_schedule" in by_feed
    assert by_feed["static_schedule"].chain == "r2:stm/static/latest.zip"
    assert by_feed["realtime_vehicle_positions"].chain == "https://stm.info/gtfs-rt/vehicles"
    assert by_feed["static_schedule"].last_loaded_utc == "2026-06-01T12:00:00Z"

    # freshness
    by_key = {f.feed: f for f in out.freshness}
    assert by_key["vehicle_positions"].status == "ok"
    assert by_key["vehicle_positions"].age_s == 25
    assert by_key["trip_updates"].age_s is None

    # retention
    assert out.retention == {"detail_days": 14, "aggregate_days": 730}

    # methodology keys
    assert "otp_definition" in out.methodology
    assert "delay_unit" in out.methodology
    assert "percentiles" in out.methodology
    assert "headway" in out.methodology
    assert "busiest direction" in out.methodology["headway"]
    assert "weekday" in out.methodology["headway"]

    # gaps
    assert "metro_realtime" in out.gaps


def test_build_provenance_includes_gis_static_source_and_freshness() -> None:
    """Passthrough lock (slice-9.1.1v): the gis_static lineage + freshness heartbeat
    surface in provenance.json with zero code change. gold.source_lineage_reporting
    has no dataset_kind filter, so a future kind-filter regression turns this red."""
    import datetime as _dt

    loaded = _dt.datetime(2026, 6, 10, 6, 5, 0, tzinfo=_dt.UTC)
    conn = FakeConn(
        [
            (
                "source_lineage_reporting",
                [
                    {
                        "dataset_kind": "static_schedule",
                        "storage_backend": "r2",
                        "storage_path": "stm/static/latest.zip",
                        "source_url": None,
                        "loaded_at_utc": loaded,
                    },
                    {
                        "dataset_kind": "gis_static",
                        "storage_backend": "s3",
                        "storage_path": "stm/gis_static/2026/06/10/stm_sig.zip",
                        "source_url": None,
                        "loaded_at_utc": loaded,
                    },
                ],
            ),
            (
                "feed_freshness_current",
                [
                    {
                        "endpoint_key": "gis_static",
                        "status": "succeeded",
                        "completed_age_seconds": 3600.0,
                    },
                ],
            ),
        ]
    )

    out = build_provenance(conn, generated_utc="t")

    by_feed = {s.feed: s for s in out.sources}
    assert "gis_static" in by_feed
    assert by_feed["gis_static"].chain == "s3:stm/gis_static/2026/06/10/stm_sig.zip"
    assert by_feed["gis_static"].last_loaded_utc == "2026-06-10T06:05:00Z"

    by_key = {f.feed: f for f in out.freshness}
    assert by_key["gis_static"].age_s == 3600


def test_provenance_methodology_documents_band() -> None:
    conn = FakeConn(
        [
            ("source_lineage_reporting", []),
            ("feed_freshness_current", []),
        ]
    )
    out = build_provenance(conn, generated_utc="t")
    definition = out.methodology["otp_definition"]
    assert "-60s" in definition
    assert "+300s" in definition
    assert "proxy" in definition
    assert "per-stop delay observations" in definition
    assert "pending per-stop observations" not in definition
    delay_unit = out.methodology["delay_unit"]
    assert "|delay| > 1 hour" in delay_unit
    assert "severe = >300s and <=3600s" in delay_unit


def test_provenance_methodology_documents_closed_period_freeze() -> None:
    conn = FakeConn(
        [
            ("source_lineage_reporting", []),
            ("feed_freshness_current", []),
        ]
    )
    out = build_provenance(conn, generated_utc="t")

    freeze_rule = out.methodology["history_freeze"]
    assert "closed" in freeze_rule
    assert "immutable" in freeze_rule
    assert "10-day open window" in freeze_rule


def test_provenance_methodology_documents_gtfs_service_time_conversion() -> None:
    conn = FakeConn(
        [
            ("source_lineage_reporting", []),
            ("feed_freshness_current", []),
        ]
    )
    out = build_provenance(conn, generated_utc="t")

    service_time = out.methodology["service_time_conversion"]
    assert "GTFS" in service_time
    assert "noon-minus-12h" in service_time
    assert "fall-back" in service_time
    assert "01:00-01:59" in service_time


def test_provenance_methodology_discloses_alert_text_en_honest_null() -> None:
    conn = FakeConn(
        [
            ("source_lineage_reporting", []),
            ("feed_freshness_current", []),
        ]
    )
    out = build_provenance(conn, generated_utc="t")

    alert_en = out.methodology["alert_text_en"]
    # EN text is present only where STM published it / for hashed rows.
    assert "header_text_en" in alert_en
    assert "STM published" in alert_en
    # Honest-NULL otherwise, including the pre-2026-06-09 legacy history tail.
    assert "honest-NULL" in alert_en
    assert "2026-06-09" in alert_en


def test_build_provenance_empty_sources_still_valid() -> None:
    conn = FakeConn(
        [
            ("source_lineage_reporting", []),
            ("feed_freshness_current", []),
        ]
    )
    out = build_provenance(conn, generated_utc="t")
    assert out.sources == []
    assert out.freshness == []
    assert out.gaps == ["metro_realtime"]
    assert out.retention["detail_days"] == 14


def test_provenance_methodology_keys_have_localized_labels() -> None:
    """Drift guard (slice-9.1.1t): the core methodology dimensions documented in
    provenance.json must each have a localized citizen-facing label in BOTH static
    label dicts, so the machine provenance and the localized copy stay in lockstep.

    provenance.methodology keeps the rich English machine documentation (data-trust
    surface, locked by the band/service-time/alert-en tests above); the FR/EN
    labels carry the parallel citizen wording under methodology.<dimension>.
    """
    from transit_ops.snapshots.builders import _STATIC_LABELS_EN, _STATIC_LABELS_FR

    conn = FakeConn(
        [
            ("source_lineage_reporting", []),
            ("feed_freshness_current", []),
        ]
    )
    out = build_provenance(conn, generated_utc="t")
    for dimension in ("otp_definition", "delay_unit", "percentiles"):
        assert dimension in out.methodology
        label_key = f"methodology.{dimension}"
        assert label_key in _STATIC_LABELS_FR
        assert label_key in _STATIC_LABELS_EN
