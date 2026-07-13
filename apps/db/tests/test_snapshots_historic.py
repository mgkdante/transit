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
import re

from _sqlfakes import NamedQueryConn

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
from transit_ops.snapshots.builders.historic import (
    _HOTSPOTS_SQL,
    _RECEIPTS_ACCOUNTABILITY_SQL,
    _RECEIPTS_NOT_REPORTED_ROUTES_SQL,
    _RECEIPTS_SERVICE_STATES_SQL,
    _RECEIPTS_SHIFT_DAILY_SQL,
    _STOP_REL_BY_ROUTE_SQL,
    _hotspots_by_grain,
)
from transit_ops.snapshots.builders.historic.small_surfaces import (
    _MIN_N_OFFENDER,
    _offender_severity,
    _repeat_offenders_by_grain,
)
from transit_ops.snapshots.contract import (
    AlertHistory,
    Hotspots,
    NetworkTrend,
    Provenance,
    RepeatOffenders,
    StopReliability,
)
from transit_ops.sql_registry import query_name

# --------------------------------------------------------------------------
# Fakes — a result that supports both .mappings() iteration AND .fetchone()
# (the route/stop builders call _representative_services which uses fetchone
# and bare row[0] iteration for active-services), mirroring test_build_route.
# --------------------------------------------------------------------------


class FakeConn(NamedQueryConn):
    """Dispatch canned result sets by exact `-- q:<name>` registry marker.

    Accepts a {query_name: rows} dict (or an iterable of (name, rows) pairs).
    Unmapped names fall through to an empty result.
    """

    def __init__(self, mapping=None):  # noqa: ANN001
        super().__init__(dict(mapping) if mapping is not None else {})
        self.executed_query_params: list[tuple[str | None, dict]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        self.executed_query_params.append((query_name(statement), dict(params or {})))
        return super().execute(statement, params)


def _stop_spine_conn(*, anchor, by_route=None, weekly=None, monthly=None, extra=None):  # noqa: ANN001, ANN202
    """Name-dispatch mock for build_stop_reliability.

    weekly + monthly now carry DISTINCT registry names (stop.reliability.weekly /
    .monthly), so no param sniffing is needed. ``extra`` overlays extra {name: rows}.
    """
    mapping = {
        "stop.reliability.anchor": [{"anchor": anchor}],
        "stop.reliability.by_route": by_route or [],
        "stop.reliability.weekly": weekly or [],
        "stop.reliability.monthly": monthly or [],
    }
    mapping.update(extra or {})
    return FakeConn(mapping)


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
    row = {
        "obs": known_obs,
        "known_obs": known_obs,
        "on_time": on_time,
        "severe": severe,
        "sum_delay_sec": sum_delay_sec,
    }
    for k in range(1, 22):
        row[f"h{k}"] = hist[k - 1]
    return row


def test_spine_reliability_period_maps_otp_severe_and_rebaselined_avg() -> None:
    from transit_ops.snapshots.builders.historic import _spine_reliability_period

    # 6 in-clamp delays summing to 1100s; otp 4/8=50, severe 2/8=25.0,
    # avg 1100/6/60 = 3.06 -> rounds to 3.1.
    hist = [0] * 8 + [6] + [0] * 12  # all 6 in bin 8 = [30,60)
    p = _spine_reliability_period(
        _spine_row(known_obs=8, on_time=4, severe=2, sum_delay_sec=1100, hist=hist),
        grain="week",
        date="2026-06-01",
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
        grain="am_peak",
        date=None,
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
            # daily spine rollup (GC1 re-point): 3 days of OTP + pooled avg delay.
            # avg = pooled_delay_sec / inclamp_obs (ghost-excluded pooled mean).
            (
                "network.trend.daily_hourly",
                [
                    # 47/100 -> otp 47; pooled 12000s/100 = 120s -> 2.0min
                    {
                        "local_date": d1,
                        "known_obs": 100,
                        "on_time": 47,
                        "pooled_delay_sec": 12000.0,
                        "inclamp_obs": 100,
                    },
                    # 180/200 -> otp 90; pooled 18000s/200 = 90s -> 1.5min
                    {
                        "local_date": d2,
                        "known_obs": 200,
                        "on_time": 180,
                        "pooled_delay_sec": 18000.0,
                        "inclamp_obs": 200,
                    },
                    # NULL on-time (plain SUM of all-NULL cells) -> honest None OTP,
                    # but avg delay still known: pooled 600s/10 = 60s -> 1.0min
                    {
                        "local_date": d3,
                        "known_obs": 10,
                        "on_time": None,
                        "pooled_delay_sec": 600.0,
                        "inclamp_obs": 10,
                    },
                ],
            ),
            # fact table only retains the two most recent days (d2, d3)
            (
                "network.trend.daily_p90",
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


def test_build_network_trend_service_completeness_clamped_at_100() -> None:
    """Over-delivery (Σdelivered > Σscheduled) clamps service_completeness_rate at 100
    (FIX-1) rather than emitting >100% (which the gate's 0-100 rate check would abort)."""
    d = datetime.date(2026, 6, 7)
    conn = FakeConn(
        {
            "network.trend.daily_hourly": [],
            "network.trend.daily_p90": [],
            # delivered 250 vs scheduled 100 -> raw 250% -> clamped to 100.0
            "network.trend.daily_cancel": [
                {"local_date": d, "canceled": 0, "total": 250, "delivered": 250, "scheduled": 100},
            ],
            "network.trend.daily_occupancy": [],
        }
    )
    out = build_network_trend(conn, generated_utc="t")
    assert len(out.series) == 1
    assert out.series[0].service_completeness_rate == 100.0


def test_build_network_trend_weekly_monthly_vary_not_flat() -> None:
    """FLAT-vs-VARYING guard (S9B): the coarse weekly/monthly buckets carry DISTINCT
    per-bucket OTP + avg-delay values when fed DISTINCT SUM inputs. This pins the
    premise of the S9B UI fix — the "goes flat on Week/Month" the operator sees is a
    UI axis-domain problem, NOT a builder aggregation bug: the builder DOES vary (a
    future GROUP BY regression that collapsed the buckets to one value would fail here).
    """
    wk1 = datetime.date(2026, 6, 1)  # ISO-week-start bucket keys
    wk2 = datetime.date(2026, 6, 8)
    mo1 = datetime.date(2026, 5, 1)  # calendar-month-start bucket keys
    mo2 = datetime.date(2026, 6, 1)
    conn = FakeConn(
        {
            # WEEKLY re-group: two buckets, DISTINCT on_time/known -> otp 87 vs 88,
            # DISTINCT pooled/inclamp -> avg 1.0 vs 1.1 min (60s vs 66s).
            "network.trend.week_hourly": [
                {
                    "local_date": wk1,
                    "known_obs": 1000,
                    "on_time": 870,
                    "pooled_delay_sec": 60000.0,
                    "inclamp_obs": 1000,
                },
                {
                    "local_date": wk2,
                    "known_obs": 1000,
                    "on_time": 880,
                    "pooled_delay_sec": 66000.0,
                    "inclamp_obs": 1000,
                },
            ],
            # MONTHLY re-group: two buckets, DISTINCT otp 87 vs 89, avg 0.9 vs 1.2 min.
            "network.trend.month_hourly": [
                {
                    "local_date": mo1,
                    "known_obs": 2000,
                    "on_time": 1740,
                    "pooled_delay_sec": 108000.0,
                    "inclamp_obs": 2000,
                },
                {
                    "local_date": mo2,
                    "known_obs": 2000,
                    "on_time": 1780,
                    "pooled_delay_sec": 144000.0,
                    "inclamp_obs": 2000,
                },
            ],
        }
    )

    out = build_network_trend(conn, generated_utc="t")

    # Weekly buckets carry the two DISTINCT otp + DISTINCT avg values (never flat-repeated).
    weekly_otp = [p.otp_pct for p in out.weekly]
    weekly_avg = [p.avg_delay_min for p in out.weekly]
    assert weekly_otp == [87, 88]
    assert weekly_avg == [1.0, 1.1]
    assert len(set(weekly_otp)) == 2 and len(set(weekly_avg)) == 2
    # p90/vehicles stay None on the coarse grain (the ~14d fact window is not composable).
    assert all(p.p90_min is None and p.vehicles is None for p in out.weekly)

    # Monthly buckets likewise vary.
    monthly_otp = [p.otp_pct for p in out.monthly]
    monthly_avg = [p.avg_delay_min for p in out.monthly]
    assert monthly_otp == [87, 89]
    assert monthly_avg == [0.9, 1.2]
    assert len(set(monthly_otp)) == 2 and len(set(monthly_avg)) == 2


def test_build_network_trend_fact_only_date() -> None:
    """A date present only in the fact table still yields a point (rollup fields None)."""
    d = datetime.date(2026, 6, 5)
    conn = FakeConn(
        [
            ("network.trend.daily_hourly", []),
            ("network.trend.daily_p90", [{"local_date": d, "p90_min": 4.0, "vehicles": 12}]),
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


def _route_reliability_dispatch(
    *,
    daily=None,
    weekly=None,
    monthly=None,
    headway=None,
    headway_direction=None,
    habit=None,
    weak=None,
    names=None,
    schedule=None,
    route_names=None,
    dow=None,
    crowding=None,
    crosstab=None,
    occ_dow=None,
    occ_grain=None,
    occ_hour=None,
):
    """Assemble the name-keyed dispatch map for build_route_reliability.

    Each query dispatches on its `-- q:<name>` registry marker (no ordering). The
    schedule rows feed the representative-weekday scheduled-headway computation. The
    crosstab / dow / weekly / monthly reads run the (windowed) spine projectors and
    default to [] — preserving the empty fall-through the old dead needles gave.

    S14: the SCALAR habits matrix reads gold/reader `route.habit.spine` over an
    ALL-TIME window (the dropped gold.route_habit_score mart's 'route.habit.score'
    read is gone). ``route.spine.anchor`` is mapped so the scalar read runs; the
    habit rows get a below-MIN_N ``known_obs`` default so the SAME `route.habit.spine`
    dispatch fed to the windowed habits_by_grain path is suppressed there (these tests
    assert on the scalar matrix, whose _build_habits_matrix applies no obs floor).
    """
    habit_rows = [{"known_obs": 0, **r} for r in (habit or [])]
    return {
        # S14: scalar habits reads route.habit.spine over an all-time window; anchor drives it.
        "route.spine.anchor": [{"anchor": datetime.date(2026, 6, 30)}],
        "route.habit.spine": habit_rows,
        "static.dataset_version": [{"dataset_version_id": 1}],
        "static.rep_dates": [
            {
                "weekday_date": datetime.date(2026, 6, 3),
                "weekend_date": datetime.date(2026, 6, 6),
            }
        ],
        "static.active_services": [("svc_wd",)],
        "static.route_schedule": schedule or [],
        # tier-3 2D crosstab — the windowed spine projector.
        "route.spine.crosstab_windowed": crosstab or [],
        "route.delay.by_crowding": crowding or [],
        "route.occupancy.by_dow": occ_dow or [],
        "route.occupancy.by_grain": occ_grain or [],
        "route.occupancy.by_hour": occ_hour or [],
        "route.reliability.daily": daily or [],
        "route.spine.weekly": weekly or [],
        "route.spine.monthly": monthly or [],
        "route.headway.by_direction_shift": headway_direction or [],
        "route.headway.observed_by_shift": headway or [],
        # weak stops — the per-route worst-N reads gold.stop_delay_spine over the
        # trailing window (DB-0067 Phase 2). The stop-delay anchor is answered here; the
        # windowed §1 reads (by_shift/by_daytype windowed) default to [] and produce empty
        # grain output.
        "stop.delay.anchor": [{"anchor": datetime.date(2026, 6, 30)}],
        "route.weak_stops.legacy": weak or [],
        "static.stop_names": names or [],
        "static.route_names": route_names or [],
        # per-weekday seasonality — windowed spine dow projector.
        "route.spine.dow_windowed": dow or [],
    }


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
                {
                    "shift": "am_peak",
                    "direction_id": 0,
                    "service_day_kind": "weekday",
                    "observed_headway_min": 7.9,
                },
                {
                    "shift": "am_peak",
                    "direction_id": 1,
                    "service_day_kind": "weekend",
                    "observed_headway_min": 9.1,
                },
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
    out_all = build_route_reliability(conn2, route_id="51", generated_utc="t", weak_stops_limit=100)
    assert len(out_all.weak_stops) == 6  # limit beyond available returns only what exists


def test_build_route_reliability_delay_by_crowding_co_observes_all_bands() -> None:
    # FIX-3: each band carries its OWN co-observed delay (the rollup pre-aggregates per band over
    # the window), so the full/standing tail is NO LONGER censored by a day's dominant band. The
    # read SQL returns one row per band: {band, delay_obs, sum_delay_sec, w_p50_sec, p50_obs,
    # day_count}; the shaper emits avg = sum/obs and obs-weighted p50, in canonical band order.
    crowding = [
        {
            "band": "many_seats",
            "delay_obs": 100,
            "sum_delay_sec": 6000.0,
            "w_p50_sec": None,
            "p50_obs": 0,
            "day_count": 5,
        },  # 60s -> 1.0 min
        {
            "band": "standing",
            "delay_obs": 40,
            "sum_delay_sec": 9600.0,
            "w_p50_sec": None,
            "p50_obs": 0,
            "day_count": 5,
        },  # 240s -> 4.0 min
        {
            "band": "full",
            "delay_obs": 10,
            "sum_delay_sec": 3000.0,
            "w_p50_sec": None,
            "p50_obs": 0,
            "day_count": 3,
        },  # 300s -> 5.0 min
    ]
    conn = FakeConn(_route_reliability_dispatch(crowding=crowding))

    out = build_route_reliability(conn, route_id="51", generated_utc="t")

    by_band = {c.band: c for c in out.delay_by_crowding}
    # ALL three bands emitted, in canonical order — the high-crowding tail is observable.
    assert [c.band for c in out.delay_by_crowding] == ["many_seats", "standing", "full"]
    assert by_band["many_seats"].avg_delay_min == 1.0
    assert by_band["standing"].avg_delay_min == 4.0
    assert by_band["full"].avg_delay_min == 5.0  # the previously-CENSORED tail, now real
    assert by_band["full"].observation_count == 10
    assert by_band["full"].day_count == 3
    assert by_band["many_seats"].p50_min is None  # no p50 obs -> honest None


def test_build_route_reliability_delay_by_crowding_avg_and_p50() -> None:
    # avg_delay_min = sum_delay_sec / delay_obs / 60; p50_min = (w_p50_sec / p50_obs) / 60 (an
    # obs-weighted mean of the daily band p50s the rollup carries).
    crowding = [
        {
            "band": "many_seats",
            "delay_obs": 40,
            "sum_delay_sec": 7200.0,  # 180s -> 3.0 min
            "w_p50_sec": 3600.0,
            "p50_obs": 40,
            "day_count": 2,
        },  # 90s -> 1.5 min
    ]
    conn = FakeConn(_route_reliability_dispatch(crowding=crowding))

    out = build_route_reliability(conn, route_id="51", generated_utc="t")

    cell = {c.band: c for c in out.delay_by_crowding}["many_seats"]
    assert cell.avg_delay_min == 3.0
    assert cell.p50_min == 1.5
    assert cell.observation_count == 40
    assert cell.day_count == 2


def test_build_route_reliability_delay_by_crowding_empty_when_no_telemetry() -> None:
    # No co-observed rows -> empty list (honest absence, never a fabricated band).
    conn = FakeConn(_route_reliability_dispatch(crowding=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.delay_by_crowding == []


def test_build_route_reliability_delay_by_crowding_skips_null_band() -> None:
    # A row whose band is NULL (occupancy_status outside the 0-5 band map) is skipped, never
    # emitted; only mapped bands surface.
    crowding = [
        {
            "band": None,
            "delay_obs": 5,
            "sum_delay_sec": 600.0,
            "w_p50_sec": None,
            "p50_obs": 0,
            "day_count": 1,
        },
        {
            "band": "standing",
            "delay_obs": 20,
            "sum_delay_sec": 4800.0,
            "w_p50_sec": None,
            "p50_obs": 0,
            "day_count": 2,
        },
    ]
    conn = FakeConn(_route_reliability_dispatch(crowding=crowding))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert [c.band for c in out.delay_by_crowding] == ["standing"]
    assert out.delay_by_crowding[0].avg_delay_min == 4.0  # 4800/20/60


def test_build_route_reliability_by_shift_daytype_empty_when_absent() -> None:
    # No crosstab rows -> empty list (SPARSE / honest absence, never fabricated).
    conn = FakeConn(_route_reliability_dispatch(crosstab=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.by_shift_daytype == []


def test_build_route_reliability_by_shift_daytype_honest_null_metrics() -> None:
    # A spine crosstab cell with no known-delay observations -> honest-None per metric,
    # but the cell is still emitted (it keeps its shift/day_type identity + obs count).
    # Post-cutover by_shift_daytype derives from _spine_route_crosstab, so feed a
    # SPINE-shaped zero row (dispatched on the whole-history crosstab projector name).
    from transit_ops.snapshots.builders.historic import _spine_route_crosstab

    row = {
        "shift": "night",
        "day_type": "weekend",
        "known_obs": 0,
        "obs": 0,
        "on_time": None,
        "severe": 0,
        "sum_delay_sec": 0,
    }
    for k in range(1, 22):
        row[f"h{k}"] = 0
    conn = FakeConn({"route.spine.crosstab": [row]})
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
        {
            "day_of_week_iso": 1,
            "empty": 0,
            "many_seats": 5,
            "few_seats": 3,
            "standing": 2,
            "full": 0,
        },
        {
            "day_of_week_iso": 6,
            "empty": 8,
            "many_seats": 2,
            "few_seats": 0,
            "standing": 0,
            "full": 0,
        },
    ]
    conn = FakeConn(_route_reliability_dispatch(occ_dow=occ_dow))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    by = {c.day_of_week_iso: c for c in out.occupancy_by_dow}
    assert set(by) == {1, 6}
    assert by[1].mix is not None
    assert by[1].mix.many_seats == 0.5  # 5/10
    assert by[1].mix.standing == 0.2  # 2/10
    assert by[6].mix.empty == 0.8  # 8/10
    # FIX-5: n = the per-weekday band-observation total (the share denominator), so the
    # web can trip-weight the weekday/weekend fold.
    assert by[1].n == 10  # 0+5+3+2+0
    assert by[6].n == 10  # 8+2+0+0+0


def test_build_route_reliability_occupancy_by_dow_honest_none_when_no_bands() -> None:
    # A weekday with data-days but all-zero band counts -> mix is None (honest
    # absence, never a fabricated all-empty mix); the cell is still emitted.
    occ_dow = [
        {
            "day_of_week_iso": 3,
            "empty": 0,
            "many_seats": 0,
            "few_seats": 0,
            "standing": 0,
            "full": 0,
        },
    ]
    conn = FakeConn(_route_reliability_dispatch(occ_dow=occ_dow))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert len(out.occupancy_by_dow) == 1
    assert out.occupancy_by_dow[0].day_of_week_iso == 3
    assert out.occupancy_by_dow[0].mix is None
    # FIX-5: a real 0 count (data-day present, zero band telemetry) — NOT None, so a
    # consumer can tell "no data-days" (row omitted) from "0 band obs" (row present, n=0).
    assert out.occupancy_by_dow[0].n == 0


def test_build_route_reliability_occupancy_by_dow_empty_when_absent() -> None:
    conn = FakeConn(_route_reliability_dispatch(occ_dow=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.occupancy_by_dow == []


def test_build_route_reliability_occupancy_by_hour_cells() -> None:
    # GC2 H3 §04: per-LOCAL-hour crowding mix; one OccupancyByHour per hour with band
    # telemetry, shares computed from the summed band counts (clone of the by_dow pair).
    occ_hour = [
        {
            "hour_of_day_local": 8,
            "empty": 0,
            "many_seats": 5,
            "few_seats": 3,
            "standing": 2,
            "full": 0,
        },
        {
            "hour_of_day_local": 12,
            "empty": 8,
            "many_seats": 2,
            "few_seats": 0,
            "standing": 0,
            "full": 0,
        },
    ]
    conn = FakeConn(_route_reliability_dispatch(occ_hour=occ_hour))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    by = {c.hour_of_day_local: c for c in out.occupancy_by_hour}
    assert set(by) == {8, 12}
    assert by[8].mix is not None
    assert by[8].mix.many_seats == 0.5  # 5/10
    assert by[8].mix.standing == 0.2  # 2/10
    assert by[12].mix.empty == 0.8  # 8/10
    # n = the per-hour band-observation total (the share denominator).
    assert by[8].n == 10  # 0+5+3+2+0
    assert by[12].n == 10  # 8+2+0+0+0


def test_build_route_reliability_occupancy_by_hour_honest_none_when_no_bands() -> None:
    # An hour with data-days but all-zero band counts -> mix is None (honest absence,
    # never a fabricated all-empty mix); the cell is still emitted with a real n=0.
    occ_hour = [
        {
            "hour_of_day_local": 3,
            "empty": 0,
            "many_seats": 0,
            "few_seats": 0,
            "standing": 0,
            "full": 0,
        },
    ]
    conn = FakeConn(_route_reliability_dispatch(occ_hour=occ_hour))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert len(out.occupancy_by_hour) == 1
    assert out.occupancy_by_hour[0].hour_of_day_local == 3
    assert out.occupancy_by_hour[0].mix is None
    assert out.occupancy_by_hour[0].n == 0


def test_build_route_reliability_occupancy_by_hour_empty_when_absent() -> None:
    conn = FakeConn(_route_reliability_dispatch(occ_hour=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.occupancy_by_hour == []


def test_build_route_reliability_occupancy_by_grain_windows() -> None:
    # S7 §04: grain-aware crowding mix bucketed in Python from trailing-30d daily
    # band rows. day = most recent closed day; week = trailing 7d; month = all 30d.
    occ_grain = [
        {
            "d": datetime.date(2026, 6, 20),
            "empty": 0,
            "many_seats": 10,
            "few_seats": 0,
            "standing": 0,
            "full": 0,
        },
        {
            "d": datetime.date(2026, 6, 15),
            "empty": 0,
            "many_seats": 0,
            "few_seats": 10,
            "standing": 0,
            "full": 0,
        },
        {
            "d": datetime.date(2026, 5, 25),
            "empty": 10,
            "many_seats": 0,
            "few_seats": 0,
            "standing": 0,
            "full": 0,
        },
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
        {
            "d": datetime.date(2026, 6, 20),
            "empty": 0,
            "many_seats": 0,
            "few_seats": 0,
            "standing": 0,
            "full": 0,
        },
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
            ("static.dataset_version", []),  # no version
            ("route.delay.by_crowding", []),
            (
                "route.reliability.daily",
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
                "route.headway.observed_by_shift",
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
    # over a trailing window; each carries a DISTINCT registry name so the fake
    # dispatches by name (no window-param sniffing).
    conn = _stop_spine_conn(
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
    conn = _stop_spine_conn(
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
    conn = _stop_spine_conn(
        anchor=datetime.date(2026, 6, 30),
        weekly=[
            {"stop_id": "S1", "obs": 150, "weighted_delay_sec": 12000.0, "severe": 15},
            {"stop_id": "S_UNNAMED", "obs": 10, "weighted_delay_sec": 600.0, "severe": 0},
        ],
        monthly=[],
        extra={"static.stop_names": [{"stop_id": "S1", "stop_name": "Station Berri"}]},
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
    conn = FakeConn({"hotspots.list": rows[:20]})  # fake returns 20

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
    conn = FakeConn({"hotspots.list": []})
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots == []


def test_build_hotspots_week_period_filter() -> None:
    """SQL needle 'repeated_problem_route_stop' matches — verify entity_kind preserved."""
    rows = [
        {"entity_kind": "route", "entity_id": "51", "issue_count": 5, "severity_label": "watch"},
        {"entity_kind": "stop", "entity_id": "3456", "issue_count": 3, "severity_label": "high"},
    ]
    conn = FakeConn({"hotspots.list": rows})
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
        {
            "entity_kind": "route",
            "entity_id": "__unrouted__",
            "issue_count": 99,
            "severity_label": "critical",
        },
        {"entity_kind": "route", "entity_id": "51", "issue_count": 40, "severity_label": "high"},
        {
            "entity_kind": "stop",
            "entity_id": "__unknown_stop__",
            "issue_count": 30,
            "severity_label": "high",
        },
        {"entity_kind": "stop", "entity_id": "3456", "issue_count": 10, "severity_label": "watch"},
    ]
    conn = FakeConn({"hotspots.list": rows})
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
            ("hotspots.list", rows),
            ("static.route_names", [{"route_id": "51", "route_name": "Saint-Laurent"}]),
            # retired stop id present only via the history half of the UNION
            ("static.stop_names", [{"stop_id": "S_RETIRED", "stop_name": "Ancien arret"}]),
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
            # network baseline: 825 / 1000 -> 82.5 -> 83 (half-away tie; the
            # 2026-07-01 S7-B rounding rebaseline — banker's round() gave 82)
            "net_on_time": 825,
            "net_known": 1000,
        },
    ]
    conn = FakeConn({"hotspots.list": rows})
    out = build_hotspots(conn, generated_utc="t")
    # _otp_pct(825,1000)=half_away(82.5)=83 ; 75 - 83 = -8.0 pts (worse than network)
    assert out.hotspots[0].otp_delta_pts == -8.0


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
    conn = FakeConn({"hotspots.list": rows})
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
    conn = FakeConn({"hotspots.list": rows})
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
    conn = FakeConn({"hotspots.list": rows})
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
    conn = FakeConn({"hotspots.list": rows})
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
    conn = FakeConn({"hotspots.list": rows})
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
# S12 _hotspots_by_grain — re-granulated evidence ladders
# --------------------------------------------------------------------------
import datetime as _dt  # noqa: E402


def _by_grain_conn(
    *,
    route_anchor=_dt.date(2026, 6, 20),
    stop_anchor=_dt.date(2026, 6, 20),
    route_rows=None,
    stop_rows=None,
    route_shift=None,
    stop_shift=None,
    route_names=None,
    stop_names=None,
):  # noqa: ANN001, ANN202
    """Name-dispatch FakeConn for _hotspots_by_grain. Every window-grain read returns the
    SAME rows (the fixture is grain-agnostic), so the ladders are identical across grains —
    fine for unit-testing the ranking/tray/absence logic."""
    mapping = {
        "hotspots.route.anchor": [{"anchor": route_anchor}] if route_anchor else [],
        "hotspots.stop.anchor": [{"anchor": stop_anchor}] if stop_anchor else [],
        "hotspots.route.by_grain": route_rows or [],
        "hotspots.stop.by_grain": stop_rows or [],
        "hotspots.route.by_shift": route_shift if route_shift is not None else (route_rows or []),
        "hotspots.stop.by_shift": stop_shift if stop_shift is not None else (stop_rows or []),
    }
    return FakeConn(mapping), (route_names or {}), (stop_names or {})


def test_hotspots_by_grain_per_kind_ranking() -> None:
    """WEB2: route and stop are ranked on SEPARATE ladders — rank RESTARTS per kind. Both a
    route and a stop carry rank=1 in the same grain's entries[] (a mixed array, route first),
    and total_ranked_routes/total_ranked_stops carry the pre-truncation per-kind counts."""
    # route 99 = 2% severe (high-n, mild); stop S1 = 90% severe (chronic, low Wilson LB)
    route_rows = [{"route_id": "99", "obs": 1000, "severe": 20, "sum_delay_sec": 60000}]
    stop_rows = [{"stop_id": "S1", "obs": 40, "severe": 36, "sum_delay_sec": 90000}]
    conn, rn, sn = _by_grain_conn(route_rows=route_rows, stop_rows=stop_rows)
    grains = _hotspots_by_grain(conn, "stm", rn, sn)
    assert [g.grain for g in grains] == ["day", "week", "month", "shift"]
    day = grains[0]
    # rank restarts per kind: route 99 is its kind's #1, stop S1 is its kind's #1 (mixed array).
    assert [(e.rank, e.type, e.id) for e in day.entries] == [(1, "route", "99"), (1, "stop", "S1")]
    assert day.total_ranked_routes == 1
    assert day.total_ranked_stops == 1


def test_hotspots_by_grain_min_n_goes_to_tray_not_ranked() -> None:
    """A sub-MIN_N entity is EXCLUDED from the ranked ladder and lands in the un-ranked
    tray (rank=None, wilson None below the floor) — never a fabricated ranked entry."""
    route_rows = [
        {"route_id": "99", "obs": 50, "severe": 10, "sum_delay_sec": 30000},  # >=30 -> ranked
        {"route_id": "7", "obs": 12, "severe": 6, "sum_delay_sec": 3000},  # <30 -> tray
    ]
    conn, rn, sn = _by_grain_conn(route_rows=route_rows, stop_rows=[])
    day = _hotspots_by_grain(conn, "stm", rn, sn)[0]
    assert [e.id for e in day.entries] == ["99"]
    assert day.entries[0].rank == 1
    assert [e.id for e in day.tray] == ["7"]
    assert day.tray[0].rank is None
    assert day.tray[0].wilson_lo is None  # Wilson uninformative below MIN_N
    assert day.tray[0].observation_count == 12  # counts still honest


def test_hotspots_by_grain_honest_absence_omits_empty() -> None:
    """No route/stop rows at all -> no grain is emitted (honest absence, never an empty
    fabricated ladder). No spine anchor at all -> empty list."""
    conn, rn, sn = _by_grain_conn(route_rows=[], stop_rows=[])
    assert _hotspots_by_grain(conn, "stm", rn, sn) == []
    conn2, rn2, sn2 = _by_grain_conn(route_anchor=None, stop_anchor=None)
    assert _hotspots_by_grain(conn2, "stm", rn2, sn2) == []


def test_hotspots_by_grain_evidence_fields_and_windows() -> None:
    """Every evidence field is populated + the window START/END dates are the trailing
    grain windows (day=anchor; week=anchor-6..anchor; month=anchor-29..anchor); the
    'shift' grain carries date=None (a time-of-day cut, not a trailing window)."""
    stop_rows = [{"stop_id": "S1", "obs": 100, "severe": 30, "sum_delay_sec": 120000}]
    conn, rn, sn = _by_grain_conn(
        route_rows=[], stop_rows=stop_rows, stop_names={"S1": "Berri-UQAM"}
    )
    grains = {g.grain: g for g in _hotspots_by_grain(conn, "stm", rn, sn)}
    assert grains["day"].date == "2026-06-20" and grains["day"].window_end == "2026-06-20"
    assert grains["week"].date == "2026-06-14" and grains["week"].window_end == "2026-06-20"
    assert grains["month"].date == "2026-05-22" and grains["month"].window_end == "2026-06-20"
    assert grains["shift"].date is None and grains["shift"].window_end is None
    e = grains["week"].entries[0]
    assert e.type == "stop" and e.id == "S1" and e.name == "Berri-UQAM"
    assert e.observation_count == 100
    assert e.severe_count == 30
    assert e.severe_pct == 30.0
    assert e.avg_delay_min == 20.0  # 120000/100 = 1200s = 20.0 min
    assert e.wilson_lo is not None and e.wilson_hi is not None
    # otp_delta_pts vs the single-entity network baseline (net severe 30% -> both 70%) -> 0
    assert e.otp_delta_pts == 0.0


def test_hotspots_by_grain_otp_delta_vs_network_severe_baseline() -> None:
    """otp_delta_pts = the entity's severe-proxy OTP minus the WINDOW's network
    severe-proxy OTP (same metric). A worse-than-network entity is negative."""
    stop_rows = [
        {"stop_id": "S1", "obs": 100, "severe": 50, "sum_delay_sec": 60000},  # 50% severe -> OTP 50
        {"stop_id": "S2", "obs": 100, "severe": 10, "sum_delay_sec": 6000},  # 10% severe -> OTP 90
    ]
    # network severe = 60/200 = 30% -> network OTP 70; S1 delta = 50-70 = -20
    conn, rn, sn = _by_grain_conn(route_rows=[], stop_rows=stop_rows)
    day = _hotspots_by_grain(conn, "stm", rn, sn)[0]
    by_id = {e.id: e for e in day.entries}
    assert by_id["S1"].otp_delta_pts == -20.0
    assert by_id["S2"].otp_delta_pts == 20.0


def test_hotspots_by_grain_tray_is_severe_desc_union_with_total() -> None:
    """FIX-6: the tray is the cross-kind UNION of the sub-MIN_N rows, sorted by severe_pct
    DESC then capped; tray_total is the PRE-cap union size. A worse (higher-severe) tray
    row sorts ahead of a milder one regardless of kind."""
    # all sub-MIN_N (<30 obs) -> all land in the tray. R7 = 80% severe, S9 = 20%, R3 = 50%.
    route_rows = [
        {"route_id": "R7", "obs": 10, "severe": 8, "sum_delay_sec": 6000},  # 80% severe
        {"route_id": "R3", "obs": 10, "severe": 5, "sum_delay_sec": 4000},  # 50% severe
    ]
    stop_rows = [{"stop_id": "S9", "obs": 10, "severe": 2, "sum_delay_sec": 1000}]  # 20% severe
    conn, rn, sn = _by_grain_conn(route_rows=route_rows, stop_rows=stop_rows)
    day = _hotspots_by_grain(conn, "stm", rn, sn)[0]
    assert day.entries == []  # nothing clears MIN_N
    assert [e.id for e in day.tray] == ["R7", "R3", "S9"]  # severe DESC across kinds
    assert all(e.rank is None for e in day.tray)
    assert day.tray_total == 3
    assert day.total_ranked_routes == 0 and day.total_ranked_stops == 0


def test_hotspots_by_grain_scalar_list_byte_identical() -> None:
    """PARITY: adding by_grain must NOT perturb the scalar hotspots[] bytes. The scalar
    array serializes IDENTICALLY whether or not by_grain is populated."""
    import json

    scalar_rows = [
        {"entity_kind": "route", "entity_id": "51", "issue_count": 9, "severity_label": "high"},
        {"entity_kind": "stop", "entity_id": "3456", "issue_count": 3, "severity_label": "watch"},
    ]
    # (a) scalar only, no spine
    a = build_hotspots(FakeConn({"hotspots.list": scalar_rows}), generated_utc="t")
    # (b) same scalar + a populated by_grain spine
    mapping = {
        "hotspots.list": scalar_rows,
        "hotspots.route.anchor": [{"anchor": _dt.date(2026, 6, 20)}],
        "hotspots.stop.anchor": [{"anchor": _dt.date(2026, 6, 20)}],
        "hotspots.route.by_grain": [
            {"route_id": "99", "obs": 50, "severe": 10, "sum_delay_sec": 30000}
        ],
        "hotspots.stop.by_grain": [],
        "hotspots.route.by_shift": [
            {"route_id": "99", "obs": 50, "severe": 10, "sum_delay_sec": 30000}
        ],
        "hotspots.stop.by_shift": [],
    }
    b = build_hotspots(FakeConn(mapping), generated_utc="t")
    assert b.by_grain, "expected a populated by_grain in fixture (b)"
    dump_a = json.dumps([h.model_dump(mode="json") for h in a.hotspots], sort_keys=True)
    dump_b = json.dumps([h.model_dump(mode="json") for h in b.hotspots], sort_keys=True)
    assert dump_a == dump_b  # scalar list byte-identical regardless of by_grain


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
    conn = FakeConn({"repeat.offenders": rows})
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
    conn = FakeConn({"repeat.offenders": rows})
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
    conn = FakeConn({"repeat.offenders": rows})
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
            ("repeat.offenders", rows),
            (
                "static.route_names",
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


def test_build_repeat_offenders_scalar_additive_fields_and_order_stable() -> None:
    """S14 additive: the scalar offenders[] gains recurrence_days/window_days/severity from the
    columns the mart query already selects — WITHOUT changing the legacy fields or the order."""
    rows = [
        {
            "entity_kind": "trip",
            "entity_id": "T9",
            "route_id": "9",
            "recurrence_days": 10,
            "window_days": 14,
            "avg_delay_seconds": 300.0,
            "severity_label": "critical",
        },
        {
            "entity_kind": "vehicle",
            "entity_id": "V2",
            "route_id": "51",
            "recurrence_days": 5,
            "window_days": 14,
            "avg_delay_seconds": 600.0,
            "severity_label": "high",
        },
    ]
    conn = FakeConn({"repeat.offenders": rows})
    out = build_repeat_offenders(conn, generated_utc="t")
    # order byte-stable (SQL-ordered, insertion-preserved)
    assert [o.id for o in out.offenders] == ["T9", "V2"]
    o0 = out.offenders[0]
    # legacy fields UNCHANGED
    assert o0.recurrence == "10/14d"
    assert o0.avg_delay_min == 5.0  # 300/60
    # additive structured twins present
    assert o0.recurrence_days == 10
    assert o0.window_days == 14
    assert o0.severity == "critical"
    assert out.offenders[1].severity == "high"


# --------------------------------------------------------------------------
# S14 — _offender_severity vocabulary (D4: same declared thresholds as the mart)
# --------------------------------------------------------------------------


def test_offender_severity_matches_mart_vocabulary() -> None:
    # avg_sec is the UN-ROUNDED pooled mean in SECONDS (S14 review F2).
    assert _offender_severity(10, 0.0) == "critical"  # recurrence >= 10
    assert _offender_severity(0, 601.2) == "critical"  # avg 601.2s > 600s
    assert _offender_severity(1, 600.0) in ("high", "watch")
    assert _offender_severity(5, 0.0) == "high"  # recurrence >= 5
    assert _offender_severity(4, 300.0) == "watch"  # below both ladders
    assert _offender_severity(None, None) is None  # honest-None, never 'watch'


def test_offender_severity_avg_boundary_is_strict_gt_600s() -> None:
    """The mart CASE is avg_delay_seconds > 600 (strict) — 600s exactly is NOT critical on avg,
    and the comparison happens on UN-ROUNDED pooled seconds: 600.4s must be critical even though
    it display-rounds to 10.0 min (S14 review F2 boundary case)."""
    assert _offender_severity(0, 600.0) == "watch"  # exactly 600s -> not critical
    assert _offender_severity(0, 600.4) == "critical"  # inside the minute-rounding tolerance
    assert _offender_severity(0, 601.2) == "critical"


# --------------------------------------------------------------------------
# S14 — _repeat_offenders_by_grain (0075 offender spine recomposition)
# --------------------------------------------------------------------------

_OFFENDER_ANCHOR = datetime.date(2026, 6, 30)


def _offender_grain_conn(spine_rows, route_names=None):  # noqa: ANN001, ANN202
    """Name-dispatch mock for _repeat_offenders_by_grain. The window SQL result is the same
    for both week+month calls (the mock ignores binds); window_days is derived in Python."""
    return FakeConn(
        {
            "repeat.offenders.spine.anchor": [{"anchor": _OFFENDER_ANCHOR}],
            "repeat.offenders.by_grain": spine_rows,
            "static.route_names": route_names or [],
        }
    )


def _offender_spine_row(kind, eid, route, *, obs, severe, sum_sec, recurrence_days, observed_days):  # noqa: ANN001, ANN202
    return {
        "entity_kind": kind,
        "entity_id": eid,
        "route_id": route,
        "obs": obs,
        "severe": severe,
        "sum_delay_sec": sum_sec,
        "recurrence_days": recurrence_days,
        "observed_days": observed_days,
    }


def test_by_grain_ranks_per_kind_and_sets_window_days() -> None:
    """Two grains (week=7d, month=30d) each carry a per-kind (trip|vehicle) ranked ladder off
    the 0075 spine. rank restarts per kind; window_days = the trailing window length."""
    rows = [
        # a clearly-severe trip (100 obs, 60 severe) and a clean trip (100 obs, 2 severe)
        _offender_spine_row(
            "trip",
            "T_BAD",
            "9",
            obs=100,
            severe=60,
            sum_sec=48000,
            recurrence_days=6,
            observed_days=6,
        ),
        _offender_spine_row(
            "trip", "T_OK", "9", obs=100, severe=2, sum_sec=6000, recurrence_days=1, observed_days=6
        ),
        _offender_spine_row(
            "vehicle",
            "V_BAD",
            "51",
            obs=80,
            severe=40,
            sum_sec=40000,
            recurrence_days=5,
            observed_days=5,
        ),
    ]
    conn = _offender_grain_conn(rows, route_names=[{"route_id": "9", "route_name": "Route Nine"}])
    grains = _repeat_offenders_by_grain(conn, "stm", {"9": "Route Nine"})
    assert [g.grain for g in grains] == ["week", "month"]
    week = next(g for g in grains if g.grain == "week")
    month = next(g for g in grains if g.grain == "month")
    assert week.window_days == 7
    assert month.window_days == 30
    # per-kind ladders: 2 trips + 1 vehicle -> ranks restart per kind
    trips = [e for e in week.entries if e.type == "trip"]
    vehs = [e for e in week.entries if e.type == "vehicle"]
    assert [e.rank for e in trips] == [1, 2]  # worst-first, rank restarts per kind
    assert [e.rank for e in vehs] == [1]
    assert week.total_ranked_trips == 2
    assert week.total_ranked_vehicles == 1
    # the worst trip ranks first (lowest not-severe Wilson LB)
    assert trips[0].id == "T_BAD"
    # route name resolved from context; entity id stays raw
    assert trips[0].route_name == "Route Nine"
    # evidence channel present
    assert trips[0].recurrence_days == 6
    assert trips[0].observed_days == 6
    assert trips[0].severe_pct == 60.0
    assert trips[0].wilson_lo is not None and trips[0].wilson_hi is not None
    assert trips[0].avg_delay_min == 8.0  # 48000/100/60


def test_by_grain_min_n_floor_routes_to_tray_only_when_recurred() -> None:
    """MIN_N mutation-killer: an entity with obs < MIN_N_RATE is EXCLUDED from the ranked
    ladder. It reaches the tray ONLY if it still recurred (recurrence_days >= 2); a single-day
    sub-floor fluke is dropped entirely."""
    assert _MIN_N_OFFENDER == 30  # pins the floor the test depends on
    rows = [
        # sub-floor but recurrent -> tray
        _offender_spine_row(
            "trip",
            "T_TRAY",
            "9",
            obs=_MIN_N_OFFENDER - 1,
            severe=10,
            sum_sec=9000,
            recurrence_days=3,
            observed_days=3,
        ),
        # sub-floor single-day fluke -> dropped (not ranked, not tray)
        _offender_spine_row(
            "trip", "T_DROP", "9", obs=5, severe=5, sum_sec=6000, recurrence_days=1, observed_days=1
        ),
        # clears the floor -> ranked
        _offender_spine_row(
            "vehicle",
            "V_RANKED",
            "51",
            obs=_MIN_N_OFFENDER,
            severe=15,
            sum_sec=12000,
            recurrence_days=4,
            observed_days=4,
        ),
    ]
    conn = _offender_grain_conn(rows)
    week = next(g for g in _repeat_offenders_by_grain(conn, "stm", {}) if g.grain == "week")
    ranked_ids = {e.id for e in week.entries}
    tray_ids = {e.id for e in week.tray}
    assert ranked_ids == {"V_RANKED"}  # only the >=MIN_N entity is ranked
    assert tray_ids == {"T_TRAY"}  # sub-floor + recurrent -> tray
    assert "T_DROP" not in ranked_ids and "T_DROP" not in tray_ids  # fluke dropped
    assert week.tray_total == 1
    # tray entries carry evidence but NO Wilson band (uninformative below the floor)
    tray_e = week.tray[0]
    assert tray_e.rank is None
    assert tray_e.wilson_lo is None and tray_e.wilson_hi is None
    assert tray_e.recurrence_days == 3


def test_by_grain_omits_grain_on_honest_absence() -> None:
    """A grain with no qualifying entity (no ranked entry AND no tray entry) is OMITTED, and an
    empty spine yields NO grains at all (never a fabricated zero)."""
    # empty spine -> no anchor rows either
    empty = FakeConn(
        {"repeat.offenders.spine.anchor": [{"anchor": None}], "repeat.offenders.by_grain": []}
    )
    assert _repeat_offenders_by_grain(empty, "stm", {}) == []
    # anchor present but only a sub-floor single-day fluke -> both grains omitted
    rows = [
        _offender_spine_row(
            "trip", "T", "9", obs=3, severe=3, sum_sec=1000, recurrence_days=1, observed_days=1
        )
    ]
    conn = _offender_grain_conn(rows)
    assert _repeat_offenders_by_grain(conn, "stm", {}) == []


def test_by_grain_pooled_avg_honest_none_on_zero_denominator() -> None:
    """A tray row with zero observations yields honest-None avg (never a divide-by-zero)."""
    # zero-obs but recurrence marked (defensive/degenerate) -> tray with None avg
    rows = [
        _offender_spine_row(
            "trip", "T0", "9", obs=0, severe=0, sum_sec=0, recurrence_days=2, observed_days=2
        )
    ]
    conn = _offender_grain_conn(rows)
    grains = _repeat_offenders_by_grain(conn, "stm", {})
    week = next(g for g in grains if g.grain == "week")
    assert week.tray[0].avg_delay_min is None


# --------------------------------------------------------------------------
# build_receipts
# --------------------------------------------------------------------------


def _receipts_dispatch(
    *,
    acct=None,
    net=None,
    worst_route=None,
    worst_stop=None,
    route_names=None,
    stop_names=None,
    shift=None,
    service_states=None,
    not_reported=None,
):
    """Build the name-keyed dispatch map for build_receipts."""
    return {
        "receipts.accountability": acct or [],
        "receipts.network_daily": net or [],
        "receipts.worst_route": worst_route or [],
        "receipts.worst_stop": worst_stop or [],
        "receipts.shift_daily": shift or [],
        "receipts.service_states": service_states or [],
        "receipts.not_reported_routes": not_reported or [],
        "static.route_names": route_names or [],
        "static.stop_names": stop_names or [],
    }


def test_receipt_queries_follow_retained_accountability_span_policy() -> None:
    accountability_sql = str(_RECEIPTS_ACCOUNTABILITY_SQL).lower()
    assert "current_date" not in accountability_sql
    assert "now()" not in accountability_sql
    assert not re.search(r"-\s*(?:30|31)\b", accountability_sql)
    assert not re.search(r"\blimit\b", accountability_sql)

    supplemental_queries = {
        _RECEIPTS_NETWORK_DAILY_SQL: "sp.provider_local_date",
        _RECEIPTS_WORST_ROUTE_SQL: "provider_local_date",
        _RECEIPTS_WORST_STOP_SQL: "provider_local_date",
        _RECEIPTS_SHIFT_DAILY_SQL: "sp.provider_local_date",
        _RECEIPTS_SERVICE_STATES_SQL: "rcd.provider_local_date",
        _RECEIPTS_NOT_REPORTED_ROUTES_SQL: "rcd.provider_local_date",
    }
    for query, date_field in supplemental_queries.items():
        sql = str(query).lower()
        assert f"{date_field} >= :receipt_start" in sql
        assert f"{date_field} <= :receipt_end" in sql
        assert "current_date" not in sql
        assert "now()" not in sql
        assert not re.search(r"-\s*(?:30|31)\b", sql)


def test_receipt_worst_entity_queries_bound_to_one_row_per_date_in_sql() -> None:
    expected = (
        (_RECEIPTS_WORST_ROUTE_SQL, "prr", "route_id"),
        (_RECEIPTS_WORST_STOP_SQL, "psd", "stop_id"),
    )
    for query, alias, entity_id in expected:
        sql = " ".join(str(query).lower().split())
        assert f"select distinct on ({alias}.provider_local_date)" in sql
        assert (
            f"order by {alias}.provider_local_date, "
            f"{alias}.avg_delay_seconds desc, {alias}.{entity_id}"
        ) in sql


def test_build_receipts_uses_full_accountability_span_and_bounds_supplements() -> None:
    old_date = datetime.date(2025, 1, 2)
    recent_date = datetime.date(2026, 6, 17)
    supplement_only_date = datetime.date(2025, 8, 3)
    net_rows = [
        {
            "local_date": day,
            "known_obs": 10,
            "on_time": 9,
            "severe": 1,
            "pooled_delay_sec": 600.0,
            "inclamp_obs": 10,
        }
        for day in (old_date, recent_date, supplement_only_date)
    ]
    conn = FakeConn(
        _receipts_dispatch(
            acct=[_acct_row(old_date), _acct_row(recent_date)],
            net=net_rows,
            worst_route=[
                {
                    "d": supplement_only_date,
                    "route_id": "51",
                    "avg_delay_seconds": 120,
                    "on_time": 8,
                    "known_obs": 10,
                }
            ],
            worst_stop=[
                {
                    "d": supplement_only_date,
                    "stop_id": "50001",
                    "avg_delay_seconds": 180,
                    "max_delay_seconds": 300,
                }
            ],
            shift=[
                {
                    "local_date": supplement_only_date,
                    "shift": "midday",
                    "known_obs": 10,
                    "severe": 1,
                    "pooled_delay_sec": 600.0,
                    "inclamp_obs": 10,
                }
            ],
            service_states=[
                {
                    "local_date": supplement_only_date,
                    "scheduled_trip_days": 10,
                    "delivered_trip_days": 9,
                    "cancelled_trip_days": 0,
                    "silent_trip_days": 1,
                    "service_completeness_pct": 90.0,
                }
            ],
            not_reported=[
                {
                    "local_date": supplement_only_date,
                    "route_id": "24",
                    "scheduled_trip_days": 1,
                }
            ],
        )
    )

    receipts = build_receipts(conn, provider_id="stm", generated_utc="t")

    assert list(receipts) == [old_date.isoformat(), recent_date.isoformat()]
    assert receipts[old_date.isoformat()].otp_pct == 90
    assert receipts[recent_date.isoformat()].otp_pct == 90
    assert supplement_only_date.isoformat() not in receipts

    supplemental_names = {
        "receipts.network_daily",
        "receipts.worst_route",
        "receipts.worst_stop",
        "receipts.shift_daily",
        "receipts.service_states",
        "receipts.not_reported_routes",
    }
    observed = {
        name: params for name, params in conn.executed_query_params if name in supplemental_names
    }
    assert set(observed) == supplemental_names
    for params in observed.values():
        assert params == {
            "provider_id": "stm",
            "receipt_start": old_date,
            "receipt_end": recent_date,
        }


def test_build_receipts_empty_accountability_short_circuits_supplements() -> None:
    supplement_date = datetime.date(2026, 6, 17)
    conn = FakeConn(
        _receipts_dispatch(
            net=[
                {
                    "local_date": supplement_date,
                    "known_obs": 10,
                    "on_time": 9,
                    "severe": 1,
                    "pooled_delay_sec": 600.0,
                    "inclamp_obs": 10,
                }
            ],
            service_states=[
                {
                    "local_date": supplement_date,
                    "scheduled_trip_days": 10,
                    "delivered_trip_days": 9,
                    "cancelled_trip_days": 0,
                    "silent_trip_days": 1,
                    "service_completeness_pct": 90.0,
                }
            ],
        )
    )

    assert build_receipts(conn, provider_id="stm", generated_utc="t") == {}
    executed_names = {name for name, _params in conn.executed_query_params}
    assert "receipts.accountability" in executed_names
    assert executed_names.isdisjoint(
        {
            "receipts.network_daily",
            "receipts.worst_route",
            "receipts.worst_stop",
            "receipts.shift_daily",
            "receipts.service_states",
            "receipts.not_reported_routes",
        }
    )


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
                    "pooled_delay_sec": 18000.0,
                    "inclamp_obs": 200,
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
                    "pooled_delay_sec": 12000.0,  # 120s avg -> 2.0 min
                    "inclamp_obs": 100,
                }
            ],
        )
    )
    out = build_receipts(conn, generated_utc="t")
    r = out["2026-05-10"]
    assert r.otp_pct == 60  # 60/100 = 60
    assert r.avg_delay_min == 2.0
    assert r.severe_pct == 10.0  # 10/100
    assert r.vehicles is None  # v1 deferral


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
                    "pooled_delay_sec": 6000.0,
                    "inclamp_obs": 100,
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
                    "provider_local_date": d,
                    "affected_route_count": 1,
                    "affected_stop_count": 1,
                    "delayed_trip_count": 0,
                    "severe_delay_count": 0,
                    "alert_count": 0,
                    "rider_impact_score": None,
                }
            ],
            worst_route=[
                {"d": d, "route_id": "__unrouted__", "avg_delay_seconds": 900.0},
                {"d": d, "route_id": "105", "avg_delay_seconds": 300.0},
            ],
            worst_stop=[
                {
                    "d": d,
                    "stop_id": "__unknown_stop__",
                    "avg_delay_seconds": 800.0,
                    "max_delay_seconds": 1000.0,
                },
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
                    "provider_local_date": d,
                    "affected_route_count": 1,
                    "affected_stop_count": 1,
                    "delayed_trip_count": 0,
                    "severe_delay_count": 0,
                    "alert_count": 0,
                    "rider_impact_score": None,
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

    assert "prr.avg_delay_seconds DESC, prr.route_id" in route_sql
    assert "psd.avg_delay_seconds DESC, psd.stop_id" in stop_sql
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
                {
                    "d": d,
                    "stop_id": "S_UNKNOWN",
                    "avg_delay_seconds": 420.0,
                    "max_delay_seconds": 600.0,
                },
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
# S13 build_receipts re-granulation: by_shift, service_states, availability
# --------------------------------------------------------------------------


def _acct_row(d, **over):
    base = {
        "provider_local_date": d,
        "affected_route_count": 1,
        "affected_stop_count": 1,
        "delayed_trip_count": 0,
        "severe_delay_count": 0,
        "alert_count": 0,
        "rider_impact_score": None,
    }
    base.update(over)
    return base


def test_receipts_by_shift_ordered_by_canonical_shift_order() -> None:
    """by_shift cuts render in the kernel SHIFT_BOUNDS order regardless of row order."""
    d = datetime.date(2026, 6, 1)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[_acct_row(d)],
            # rows deliberately out of order
            shift=[
                {
                    "local_date": d,
                    "shift": "evening",
                    "known_obs": 100,
                    "severe": 5,
                    "pooled_delay_sec": 6000.0,
                    "inclamp_obs": 100,
                },
                {
                    "local_date": d,
                    "shift": "am_peak",
                    "known_obs": 200,
                    "severe": 10,
                    "pooled_delay_sec": 12000.0,
                    "inclamp_obs": 200,
                },
                {
                    "local_date": d,
                    "shift": "night",
                    "known_obs": 50,
                    "severe": 1,
                    "pooled_delay_sec": 1500.0,
                    "inclamp_obs": 50,
                },
            ],
        )
    )
    r = build_receipts(conn, generated_utc="t")["2026-06-01"]
    assert [c.shift for c in r.by_shift] == ["am_peak", "evening", "night"]


def test_receipts_by_shift_pooled_avg_matches_day_scalar_methodology() -> None:
    """A single-shift cut's pooled avg == the day-level scalar's pooled avg when the
    day's ONLY observations fall in that shift (identical Σsec/Σinclamp methodology)."""
    d = datetime.date(2026, 6, 2)
    net = [
        {
            "local_date": d,
            "known_obs": 300,
            "on_time": 250,
            "severe": 12,
            "pooled_delay_sec": 27000.0,
            "inclamp_obs": 300,
        }
    ]
    shift = [
        {
            "local_date": d,
            "shift": "midday",
            "known_obs": 300,
            "severe": 12,
            "pooled_delay_sec": 27000.0,
            "inclamp_obs": 300,
        }
    ]
    conn = FakeConn(_receipts_dispatch(acct=[_acct_row(d)], net=net, shift=shift))
    r = build_receipts(conn, generated_utc="t")["2026-06-02"]
    assert len(r.by_shift) == 1
    assert r.by_shift[0].avg_delay_min == r.avg_delay_min
    assert r.by_shift[0].observation_count == 300


def test_receipts_by_shift_zero_inclamp_yields_none_avg() -> None:
    """A shift with observations but zero in-clamp bins honest-Nones its avg (not 0)."""
    d = datetime.date(2026, 6, 3)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[_acct_row(d)],
            shift=[
                {
                    "local_date": d,
                    "shift": "night",
                    "known_obs": 10,
                    "severe": 0,
                    "pooled_delay_sec": None,
                    "inclamp_obs": 0,
                }
            ],
        )
    )
    r = build_receipts(conn, generated_utc="t")["2026-06-03"]
    assert r.by_shift[0].avg_delay_min is None
    assert r.by_shift[0].observation_count == 10


def test_receipts_service_states_silent_vs_cancelled_distinct() -> None:
    """not_reported (total=0, scheduled>0) is DISTINCT from cancelled (canceled>0)."""
    d = datetime.date(2026, 6, 4)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[_acct_row(d)],
            service_states=[
                {
                    "local_date": d,
                    "scheduled_trip_days": 100,
                    "delivered_trip_days": 80,
                    "cancelled_trip_days": 5,
                    "silent_trip_days": 15,
                    "service_completeness_pct": 80.0,
                }
            ],
            not_reported=[
                {"local_date": d, "route_id": "51", "scheduled_trip_days": 12},
                {"local_date": d, "route_id": "24", "scheduled_trip_days": 8},
            ],
            route_names=[{"route_id": "51", "route_name": "Édouard-Montpetit"}],
        )
    )
    r = build_receipts(conn, generated_utc="t")["2026-06-04"]
    ss = r.service_states
    assert ss is not None
    assert ss.cancelled_trip_days == 5
    assert ss.silent_trip_days == 15
    assert ss.service_completeness_pct == 80.0
    assert ss.not_reported_route_count == 2
    assert [nr.id for nr in ss.not_reported_routes] == ["51", "24"]
    assert ss.not_reported_routes[0].name == "Édouard-Montpetit"
    assert ss.not_reported_routes[0].scheduled_trip_days == 12


def test_receipts_not_reported_cap_and_precap_count() -> None:
    """The not_reported list caps at NOT_REPORTED_ROUTES_CAP; the count is PRE-cap."""
    from transit_ops.snapshots.contract import NOT_REPORTED_ROUTES_CAP

    d = datetime.date(2026, 6, 5)
    n = NOT_REPORTED_ROUTES_CAP + 20
    conn = FakeConn(
        _receipts_dispatch(
            acct=[_acct_row(d)],
            service_states=[
                {
                    "local_date": d,
                    "scheduled_trip_days": 500,
                    "delivered_trip_days": 0,
                    "cancelled_trip_days": 0,
                    "silent_trip_days": 500,
                    "service_completeness_pct": 0.0,
                }
            ],
            not_reported=[
                {"local_date": d, "route_id": f"R{i:03d}", "scheduled_trip_days": n - i}
                for i in range(n)
            ],
        )
    )
    r = build_receipts(conn, generated_utc="t")["2026-06-05"]
    ss = r.service_states
    assert len(ss.not_reported_routes) == NOT_REPORTED_ROUTES_CAP
    assert ss.not_reported_route_count == n  # honest pre-cap total


def test_receipts_not_reported_excludes_sentinel() -> None:
    """A sentinel route id never leaks into not_reported (defense-in-depth), and is
    excluded from the pre-cap count too."""
    d = datetime.date(2026, 6, 6)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[_acct_row(d)],
            service_states=[
                {
                    "local_date": d,
                    "scheduled_trip_days": 10,
                    "delivered_trip_days": 0,
                    "cancelled_trip_days": 0,
                    "silent_trip_days": 10,
                    "service_completeness_pct": 0.0,
                }
            ],
            not_reported=[
                {"local_date": d, "route_id": "__unrouted__", "scheduled_trip_days": 99},
                {"local_date": d, "route_id": "747", "scheduled_trip_days": 3},
            ],
        )
    )
    r = build_receipts(conn, generated_utc="t")["2026-06-06"]
    ids = [nr.id for nr in r.service_states.not_reported_routes]
    assert "__unrouted__" not in ids
    assert ids == ["747"]
    assert r.service_states.not_reported_route_count == 1


def test_receipts_service_states_honest_null_when_scheduled_unknown() -> None:
    """Pre-0073 history (scheduled NULL) → completeness None, never a fabricated 0/100."""
    d = datetime.date(2026, 6, 7)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[_acct_row(d)],
            service_states=[
                {
                    "local_date": d,
                    "scheduled_trip_days": None,
                    "delivered_trip_days": None,
                    "cancelled_trip_days": 2,
                    "silent_trip_days": None,
                    "service_completeness_pct": None,
                }
            ],
        )
    )
    r = build_receipts(conn, generated_utc="t")["2026-06-07"]
    ss = r.service_states
    assert ss.scheduled_trip_days is None
    assert ss.service_completeness_pct is None
    assert ss.cancelled_trip_days == 2
    assert ss.not_reported_route_count is None  # no not-reported rows this date


def test_receipts_additive_only_parity_no_new_rows() -> None:
    """PARITY: a receipt built with NO shift/service_states rows serializes with the S13
    fields at their empty/None defaults, so a pre-S13 golden re-serializes byte-identical.
    """
    d = datetime.date(2026, 6, 8)
    conn = FakeConn(_receipts_dispatch(acct=[_acct_row(d, alert_count=3)]))
    r = build_receipts(conn, generated_utc="t")["2026-06-08"]
    assert r.by_shift == []
    assert r.service_states is None
    dumped = r.model_dump()
    assert dumped["by_shift"] == []
    assert dumped["service_states"] is None


def test_receipt_full_payload_under_byte_ceiling() -> None:
    """S13 worst-case receipt (5 shift cuts + a full NOT_REPORTED_ROUTES_CAP list with
    wide accented names) stays under RECEIPT_BYTE_CEILING."""
    from transit_ops.snapshots.contract import (
        NOT_REPORTED_ROUTES_CAP,
        RECEIPT_BYTE_CEILING,
        Receipt,
        ReceiptNotReportedRoute,
        ReceiptServiceStates,
        ReceiptShiftCut,
        ReceiptWorstRoute,
        ReceiptWorstStop,
    )

    wide = "Ligne à correspondance interrompue — desservie partiellement" * 2
    r = Receipt(
        generated_utc="2026-06-08T00:00:00Z",
        date="2026-06-08",
        otp_pct=50,
        avg_delay_min=9.9,
        severe_pct=12.3,
        worst_route=ReceiptWorstRoute(id="999", name=wide, otp_delta_pts=-40.0),
        worst_stop=ReceiptWorstStop(id="99999", name=wide, avg_delay_min=30.0),
        affected_routes=200,
        affected_stops=2000,
        alerts=50,
        rider_impact_score=1234.5,
        by_shift=[
            ReceiptShiftCut(
                shift=s,
                observation_count=99999,
                severe_count=9999,
                severe_pct=12.34,
                avg_delay_min=9.87,
            )
            for s in ("am_peak", "midday", "pm_peak", "evening", "night")
        ],
        service_states=ReceiptServiceStates(
            scheduled_trip_days=99999,
            delivered_trip_days=88888,
            cancelled_trip_days=1111,
            silent_trip_days=9999,
            not_reported_route_count=200,
            service_completeness_pct=88.88,
            not_reported_routes=[
                ReceiptNotReportedRoute(id=f"R{i:04d}", name=wide, scheduled_trip_days=999 - i)
                for i in range(NOT_REPORTED_ROUTES_CAP)
            ],
        ),
    )
    size = len(r.model_dump_json().encode("utf-8"))
    assert size <= RECEIPT_BYTE_CEILING, f"{size}B exceeds {RECEIPT_BYTE_CEILING}B"


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
                "alerts.history",
                [
                    {
                        "alert_header_text": "Votre ligne",
                        "header_text_en": "Your line",
                        "alert_id": None,  # STM feed leaves this NULL — ignored
                        "severity": "WARNING",
                        "routes": ["51", "9", "51"],  # dedup -> ["9","51"]
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
            "alert_header_text": header,
            "header_text_en": None,
            "alert_id": None,
            "severity": sev,
            "cause": cause,
            "effect": effect,
            "routes": [],
            "stops": [],
            "start_utc": start,
            "end_utc": end,
        }

    s = _dt.datetime(2026, 5, 1, 8, 0, 0, tzinfo=_dt.UTC)
    conn = FakeConn(
        [
            (
                "alerts.history",
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
                "alerts.history",
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
                "alerts.history",
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
    conn = FakeConn({"alerts.history": rows})
    out = build_alert_history(conn, generated_utc="t")
    assert len(out.alerts) == 200


def test_build_alert_history_empty() -> None:
    conn = FakeConn({"alerts.history": []})
    out = build_alert_history(conn, generated_utc="t")
    assert out.alerts == []


# --------------------------------------------------------------------------
# S15: windowed builder — window disclosure, active_periods, url, cap
# --------------------------------------------------------------------------


def test_alert_history_sql_uses_windowed_binds_not_now_clause() -> None:
    """S15: the builder SQL is bound by explicit :win_start/:win_end (not a now()-
    anchored trailing clause), LIMIT 500, and aggregates active_periods."""
    from transit_ops.snapshots.builders.historic.small_surfaces import _ALERT_HISTORY_SQL

    sql = str(_ALERT_HISTORY_SQL)
    assert ":win_start" in sql and ":win_end" in sql
    assert "now() AT TIME ZONE" not in sql  # the trailing clause is gone
    assert "LIMIT 500" in sql
    assert "active_periods" in sql and "json_agg" in sql


def test_build_alert_history_window_fields_from_anchor() -> None:
    """window_start/window_end are the trailing SILVER_I3_CLOSED_RETENTION_DAYS
    span off the DB anchor; total_in_window is the count; not truncated under cap."""
    import datetime as _dt

    from transit_ops.settings import get_settings

    anchor = _dt.date(2026, 7, 1)
    conn = FakeConn(
        {
            "alerts.history.anchor": [{"anchor": anchor}],
            "alerts.history.count": [{"total": 1}],
            "alerts.history": [
                {
                    "alert_header_text": "H",
                    "header_text_en": None,
                    "alert_id": None,
                    "severity": "INFO",
                    "routes": None,
                    "stops": None,
                    "start_utc": _dt.datetime(2026, 6, 20, tzinfo=_dt.UTC),
                    "end_utc": _dt.datetime(2026, 6, 20, tzinfo=_dt.UTC),
                }
            ],
        }
    )
    out = build_alert_history(conn, generated_utc="t")
    days = get_settings().SILVER_I3_CLOSED_RETENTION_DAYS
    assert out.window_end == "2026-07-01"
    assert out.window_start == (anchor - _dt.timedelta(days=days)).isoformat()
    assert out.total_in_window == 1
    assert out.truncated is False


def test_build_alert_history_active_periods_from_child_json() -> None:
    """A post-0077 entry surfaces its full active_periods list (json_agg), with
    the timestamps normalized to the canonical 'Z' rendering + additive
    cause/effect/severity_level/url passthroughs."""
    import datetime as _dt

    start = _dt.datetime(2026, 6, 1, 8, tzinfo=_dt.UTC)
    conn = FakeConn(
        {
            "alerts.history.anchor": [{"anchor": _dt.date(2026, 7, 1)}],
            "alerts.history": [
                {
                    "alert_header_text": "Fermeture",
                    "header_text_en": None,
                    "alert_id": None,
                    "severity": "WARNING",
                    "cause": "CONSTRUCTION",
                    "effect": "DETOUR",
                    "url": "https://stm.info/avis/x",
                    "routes": [],
                    "stops": [],
                    "start_utc": start,
                    "end_utc": start + _dt.timedelta(hours=2),
                    "active_periods": [
                        {
                            "start_utc": "2026-06-01T08:00:00+00:00",
                            "end_utc": "2026-06-01T10:00:00+00:00",
                        },
                        {
                            "start_utc": "2026-06-08T08:00:00+00:00",
                            "end_utc": "2026-06-08T10:00:00+00:00",
                        },
                    ],
                }
            ],
        }
    )
    out = build_alert_history(conn, generated_utc="t")
    e = out.alerts[0]
    assert e.cause == "CONSTRUCTION"
    assert e.effect == "DETOUR"
    assert e.severity_level == "WARNING"
    assert e.url == "https://stm.info/avis/x"
    assert len(e.active_periods) == 2
    assert e.active_periods[0].start_utc == "2026-06-01T08:00:00Z"
    assert e.active_periods[1].end_utc == "2026-06-08T10:00:00Z"


def test_build_alert_history_pre_0077_falls_back_to_scalar_period() -> None:
    """A pre-0077 row (active_periods json is NULL) falls back to the scalar pair
    as a 1-element active_periods list; url is honest-NULL."""
    import datetime as _dt

    start = _dt.datetime(2026, 5, 1, 8, tzinfo=_dt.UTC)
    conn = FakeConn(
        {
            "alerts.history.anchor": [{"anchor": _dt.date(2026, 7, 1)}],
            "alerts.history": [
                {
                    "alert_header_text": "Legacy",
                    "header_text_en": None,
                    "alert_id": None,
                    "severity": "INFO",
                    "routes": None,
                    "stops": None,
                    "start_utc": start,
                    "end_utc": start + _dt.timedelta(hours=1),
                    "active_periods": None,  # pre-0077: no child rows
                }
            ],
        }
    )
    out = build_alert_history(conn, generated_utc="t")
    e = out.alerts[0]
    assert e.url is None
    assert len(e.active_periods) == 1
    assert e.active_periods[0].start_utc == "2026-05-01T08:00:00Z"
    assert e.active_periods[0].end_utc == "2026-05-01T09:00:00Z"


def test_build_alert_history_500_cap_and_truncation_disclosed() -> None:
    """SQL LIMIT 500 enforced; total_in_window is the TRUE pre-cap count from the
    dedicated count query (S15 review F1), so it can EXCEED the emitted length and
    truncated fires only when the window genuinely held more than was served."""
    import datetime as _dt

    start = _dt.datetime(2026, 6, 1, tzinfo=_dt.UTC)
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
        for i in range(500)
    ]
    conn = FakeConn(
        {
            "alerts.history.anchor": [{"anchor": _dt.date(2026, 7, 1)}],
            "alerts.history.count": [{"total": 512}],
            "alerts.history": rows,
        }
    )
    out = build_alert_history(conn, generated_utc="t")
    assert len(out.alerts) == 500
    assert out.total_in_window == 512  # the TRUE window size, not the cap
    assert out.truncated is True


def test_build_alert_history_exact_cap_fill_is_not_truncated() -> None:
    """A window holding EXACTLY the cap serves everything — truncated must be
    False (total == emitted), never a false 'there may be more'."""
    import datetime as _dt

    start = _dt.datetime(2026, 6, 1, tzinfo=_dt.UTC)
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
        for i in range(500)
    ]
    conn = FakeConn(
        {
            "alerts.history.anchor": [{"anchor": _dt.date(2026, 7, 1)}],
            "alerts.history.count": [{"total": 500}],
            "alerts.history": rows,
        }
    )
    out = build_alert_history(conn, generated_utc="t")
    assert out.total_in_window == 500
    assert out.truncated is False


# --------------------------------------------------------------------------
# build_provenance
# --------------------------------------------------------------------------


def test_build_provenance_sources_and_freshness() -> None:
    import datetime as _dt

    loaded = _dt.datetime(2026, 6, 1, 12, 0, 0, tzinfo=_dt.UTC)
    conn = FakeConn(
        [
            (
                "provenance.sources",
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
                "provenance.freshness",
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
                "provenance.sources",
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
                "provenance.freshness",
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
            ("provenance.sources", []),
            ("provenance.freshness", []),
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
            ("provenance.sources", []),
            ("provenance.freshness", []),
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
            ("provenance.sources", []),
            ("provenance.freshness", []),
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
            ("provenance.sources", []),
            ("provenance.freshness", []),
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
            ("provenance.sources", []),
            ("provenance.freshness", []),
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
            ("provenance.sources", []),
            ("provenance.freshness", []),
        ]
    )
    out = build_provenance(conn, generated_utc="t")
    for dimension in ("otp_definition", "delay_unit", "percentiles"):
        assert dimension in out.methodology
        label_key = f"methodology.{dimension}"
        assert label_key in _STATIC_LABELS_FR
        assert label_key in _STATIC_LABELS_EN
