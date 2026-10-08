
from __future__ import annotations

import datetime
import re
from unittest.mock import Mock

import pytest
from _sqlfakes import NamedQueryConn

from transit_ops.snapshots.builders import (
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
    _ROUTE_NAMES_SQL,
    _STOP_NAMES_SQL,
    MIN_N_RATE,
    WILSON_Z,
    _otp_pct,
    _otp_pct_severe_proxy,
    _wilson_bounds,
    _wilson_hi,
    _wilson_lo,
)
from transit_ops.snapshots.builders.historic.network_trend import _TREND_DAILY_SQL, _TREND_FACT_SQL
from transit_ops.snapshots.builders.historic.ranking_kernel import (
    MIN_N_OFFENDER,
    build_hotspot_kind_ladder,
    build_offender_kind_ladder,
    offender_severity,
)
from transit_ops.snapshots.builders.historic.route_reliability import _ROUTE_REL_DAILY_SQL
from transit_ops.snapshots.builders.historic.small_surfaces import (
    _HOTSPOTS_SQL,
    _RECEIPTS_ACCOUNTABILITY_SQL,
    _RECEIPTS_NETWORK_DAILY_SQL,
    _RECEIPTS_NOT_REPORTED_ROUTES_SQL,
    _RECEIPTS_SERVICE_STATES_SQL,
    _RECEIPTS_SHIFT_DAILY_SQL,
    _RECEIPTS_WORST_ROUTE_SQL,
    _RECEIPTS_WORST_STOP_SQL,
    _hotspots_by_grain,
    _repeat_offenders_by_grain,
)
from transit_ops.snapshots.builders.historic.stop_reliability import _STOP_REL_BY_ROUTE_SQL
from transit_ops.snapshots.contract import (
    AlertHistory,
    Hotspots,
    NetworkTrend,
    Provenance,
    RepeatOffenders,
    StopReliability,
)
from transit_ops.sql_registry import query_name


class FakeConn(NamedQueryConn):

    def __init__(self, mapping=None):  # noqa: ANN001
        super().__init__(dict(mapping) if mapping is not None else {})
        self.executed_query_params: list[tuple[str | None, dict]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        self.executed_query_params.append((query_name(statement), dict(params or {})))
        return super().execute(statement, params)


def _stop_spine_conn(*, anchor, by_route=None, weekly=None, monthly=None, extra=None):  # noqa: ANN001, ANN202
    mapping = {
        "stop.reliability.anchor": [{"anchor": anchor}],
        "stop.reliability.by_route": by_route or [],
        "stop.reliability.weekly": weekly or [],
        "stop.reliability.monthly": monthly or [],
    }
    mapping.update(extra or {})
    return FakeConn(mapping)


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


def test_wilson_constants() -> None:
    assert MIN_N_RATE == 30
    assert WILSON_Z == 1.96


def test_wilson_bounds_known_value() -> None:
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
    lo, hi = _wilson_bounds(150, 100)
    assert 0.0 <= lo <= hi <= 100.0


def test_wilson_lower_bound_suppresses_tiny_n_fluke() -> None:
    assert _wilson_lo(1, 1) < _wilson_lo(900, 1000)
    assert _wilson_lo(1, 1) < 50.0


def test_wilson_lo_hi_extract_bounds_and_guard_none() -> None:
    assert _wilson_lo(50, 100) == 40.4
    assert _wilson_hi(50, 100) == 59.6
    assert _wilson_lo(None, 0) is None
    assert _wilson_hi(5, 0) is None


def test_pctile_from_hist_empty_is_none() -> None:
    from transit_ops.snapshots.builders.historic._spine import _pctile_from_hist

    assert _pctile_from_hist([], 0.5) is None
    assert _pctile_from_hist([0] * 21, 0.5) is None


def test_pctile_from_hist_interpolates_within_bin() -> None:
    from transit_ops.snapshots.builders.historic._spine import _pctile_from_hist

    hist = [0] * 15 + [10] + [0] * 5
    assert _pctile_from_hist(hist, 0.5) == 6.0
    assert _pctile_from_hist(hist, 0.9) == 6.8


def test_pctile_from_hist_terminal_bin_floor() -> None:
    from transit_ops.snapshots.builders.historic._spine import _pctile_from_hist

    hist = [0] * 20 + [5]
    assert _pctile_from_hist(hist, 0.9) == 60.0
    assert _pctile_from_hist(hist, 0.5) == 60.0


def test_pctile_from_hist_bin_zero_safe_and_negative() -> None:
    from transit_ops.snapshots.builders.historic._spine import _pctile_from_hist

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
    from transit_ops.snapshots.builders.historic._spine import _spine_reliability_period

    hist = [0] * 8 + [6] + [0] * 12
    p = _spine_reliability_period(
        _spine_row(known_obs=8, on_time=4, severe=2, sum_delay_sec=1100, hist=hist),
        grain="week",
        date="2026-06-01",
    )
    assert p.grain == "week" and p.date == "2026-06-01"
    assert p.otp_pct == 50
    assert p.severe_pct == 25.0
    assert p.avg_delay_min == 3.1
    assert p.p50_min is not None and p.p90_min is not None
    assert p.observation_count == 8
    assert p.on_time == 4
    assert p.wilson_lo is not None and p.wilson_hi is not None
    assert p.delay_histogram is not None and len(p.delay_histogram) == 21
    assert sum(b.count for b in p.delay_histogram) == 6
    assert p.delay_histogram[8].lo_sec == 30 and p.delay_histogram[8].hi_sec == 60
    assert p.delay_histogram[8].count == 6
    assert p.delay_histogram[20].lo_sec == 3600 and p.delay_histogram[20].hi_sec is None


def test_spine_reliability_period_honest_null_when_no_delays() -> None:
    from transit_ops.snapshots.builders.historic._spine import _spine_reliability_period

    p = _spine_reliability_period(
        _spine_row(known_obs=0, on_time=None, severe=0, sum_delay_sec=0, hist=[0] * 21),
        grain="am_peak",
        date=None,
    )
    assert p.otp_pct is None
    assert p.severe_pct is None
    assert p.avg_delay_min is None
    assert p.p50_min is None and p.p90_min is None
    assert p.on_time is None
    assert p.wilson_lo is None and p.wilson_hi is None
    assert p.delay_histogram is None


def test_build_network_trend_merges_and_orders() -> None:
    d1 = datetime.date(2026, 6, 1)
    d2 = datetime.date(2026, 6, 2)
    d3 = datetime.date(2026, 6, 3)
    conn = FakeConn(
        [
            (
                "network.trend.daily_hourly",
                [
                    {
                        "local_date": d1,
                        "known_obs": 100,
                        "on_time": 47,
                        "pooled_delay_sec": 12000.0,
                        "inclamp_obs": 100,
                    },
                    {
                        "local_date": d2,
                        "known_obs": 200,
                        "on_time": 180,
                        "pooled_delay_sec": 18000.0,
                        "inclamp_obs": 200,
                    },
                    {
                        "local_date": d3,
                        "known_obs": 10,
                        "on_time": None,
                        "pooled_delay_sec": 600.0,
                        "inclamp_obs": 10,
                    },
                ],
            ),
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
    assert [p.date for p in out.series] == ["2026-06-01", "2026-06-02", "2026-06-03"]

    p1, p2, p3 = out.series
    assert p1.otp_pct == 47
    assert p1.avg_delay_min == 2.0
    assert p1.p90_min is None
    assert p1.vehicles is None
    assert p2.otp_pct == 90
    assert p2.avg_delay_min == 1.5
    assert p2.p90_min == 7.3
    assert p2.vehicles == 310
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
    d = datetime.date(2026, 6, 7)
    conn = FakeConn(
        {
            "network.trend.daily_hourly": [],
            "network.trend.daily_p90": [],
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
    wk1 = datetime.date(2026, 6, 1)
    wk2 = datetime.date(2026, 6, 8)
    mo1 = datetime.date(2026, 5, 1)
    mo2 = datetime.date(2026, 6, 1)
    conn = FakeConn(
        {
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

    weekly_otp = [p.otp_pct for p in out.weekly]
    weekly_avg = [p.avg_delay_min for p in out.weekly]
    assert weekly_otp == [87, 88]
    assert weekly_avg == [1.0, 1.1]
    assert len(set(weekly_otp)) == 2 and len(set(weekly_avg)) == 2
    assert all(p.p90_min is None and p.vehicles is None for p in out.weekly)

    monthly_otp = [p.otp_pct for p in out.monthly]
    monthly_avg = [p.avg_delay_min for p in out.monthly]
    assert monthly_otp == [87, 89]
    assert monthly_avg == [0.9, 1.2]
    assert len(set(monthly_otp)) == 2 and len(set(monthly_avg)) == 2


def test_build_network_trend_fact_only_date() -> None:
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
    habit_rows = [{"known_obs": 0, **r} for r in (habit or [])]
    return {
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
        "stop.delay.anchor": [{"anchor": datetime.date(2026, 6, 30)}],
        "route.weak_stops.legacy": weak or [],
        "static.stop_names": names or [],
        "static.route_names": route_names or [],
        "route.spine.dow_windowed": dow or [],
    }


def test_route_reliability_sql_uses_real_otp_columns() -> None:
    assert "delay_observation_count AS known_obs" in str(_ROUTE_REL_DAILY_SQL)
    assert "on_time_observation_count AS on_time" in str(_ROUTE_REL_DAILY_SQL)


def test_build_route_reliability_headway_excess() -> None:
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

    assert by_shift["midday"].observed_min == 5.0
    assert by_shift["midday"].scheduled_min is None
    assert by_shift["midday"].excess_wait_min is None

    assert [h.shift for h in out.headway][:2] == ["am_peak", "midday"]


def test_build_route_reliability_excess_clamped_at_zero() -> None:
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
    assert am.excess_wait_min == 0.0


def test_build_route_reliability_directional_headway_is_typed_not_encoded() -> None:
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
    assert out.habits.matrix[0][0] == 1.0
    assert out.habits.matrix[6][23] == 0.4444
    assert out.habits.matrix[2][8] == 0.8333
    assert out.habits.matrix[1][5] is None


def test_build_route_reliability_habits_at_cap_normalizes_to_one() -> None:
    conn = FakeConn(
        _route_reliability_dispatch(
            habit=[
                {"day_of_week_iso": 5, "hour_of_day_local": 17, "repeat_problem_score": 9999.9999},
                {"day_of_week_iso": 1, "hour_of_day_local": 8, "repeat_problem_score": 50.0},
            ],
        )
    )
    out = build_route_reliability(conn, route_id="165", generated_utc="t")
    assert out.habits is not None
    cap_cell = out.habits.matrix[4][17]
    assert cap_cell == 1.0
    assert cap_cell != 9999.9999
    assert out.habits.matrix[0][8] == 0.005


def test_build_route_reliability_habits_observed_zero_distinct_from_no_data() -> None:
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
    assert out.habits.matrix[1][9] == 0.0
    assert out.habits.matrix[3][18] == 1.0
    assert out.habits.matrix[0][0] is None


def test_build_route_reliability_habits_present_null_score_is_null_not_zero() -> None:
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
    assert out.habits.matrix[1][9] is None
    assert out.habits.matrix[3][18] == 1.0


def test_build_route_reliability_habits_all_zero_route_no_div_by_zero() -> None:
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
    conn = FakeConn(_route_reliability_dispatch(habit=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.habits is not None
    assert out.habits.scale == "repeat_problem_relative"
    assert len(out.habits.matrix) == 7
    assert all(len(row) == 24 for row in out.habits.matrix)
    assert all(cell is None for row in out.habits.matrix for cell in row)


def test_build_route_reliability_weak_stops_sorted_desc_default_serves_all() -> None:
    weak = [
        {"stop_id": f"S{i}", "obs": 10, "weighted_delay_sec": delay_sec * 10, "severe": 0}
        for i, delay_sec in enumerate([60, 600, 300, 120, 420, 30])
    ]
    names = [{"stop_id": f"S{i}", "stop_name": f"Stop {i}"} for i in range(6)]
    conn = FakeConn(_route_reliability_dispatch(weak=weak, names=names))

    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert len(out.weak_stops) == 6
    delays = [w.avg_delay_min for w in out.weak_stops]
    assert delays == sorted(delays, reverse=True)
    assert out.weak_stops[0].id == "S1"
    assert out.weak_stops[0].name == "Stop 1"
    assert out.weak_stops[0].avg_delay_min == 10.0
    assert out.weak_stops[-1].id == "S5"
    assert out.weak_stops[-1].avg_delay_min == 0.5


def test_build_route_reliability_weak_stops_equal_averages_have_stable_bytes() -> None:
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    weak = [
        {"stop_id": "Z9", "obs": 3, "weighted_delay_sec": 0, "severe": 0},
        {"stop_id": "A1", "obs": 12, "weighted_delay_sec": 0, "severe": 0},
    ]
    names = [
        {"stop_id": "A1", "stop_name": "Alpha"},
        {"stop_id": "Z9", "stop_name": "Zulu"},
    ]

    forward = build_route_reliability(
        FakeConn(_route_reliability_dispatch(weak=weak, names=names)),
        route_id="51",
        generated_utc="t",
    )
    reversed_input = build_route_reliability(
        FakeConn(_route_reliability_dispatch(weak=list(reversed(weak)), names=names)),
        route_id="51",
        generated_utc="t",
    )

    assert [stop.id for stop in forward.weak_stops] == ["A1", "Z9"]
    assert snapshot_json_bytes(forward) == snapshot_json_bytes(reversed_input)


def test_build_route_reliability_weak_stops_respects_explicit_limit() -> None:
    weak = [
        {"stop_id": f"S{i}", "obs": 10, "weighted_delay_sec": delay_sec * 10, "severe": 0}
        for i, delay_sec in enumerate([60, 600, 300, 120, 420, 30])
    ]
    names = [{"stop_id": f"S{i}", "stop_name": f"Stop {i}"} for i in range(6)]

    conn = FakeConn(_route_reliability_dispatch(weak=weak, names=names))
    out = build_route_reliability(conn, route_id="51", generated_utc="t", weak_stops_limit=3)
    assert [w.id for w in out.weak_stops] == ["S1", "S4", "S2"]

    conn2 = FakeConn(_route_reliability_dispatch(weak=weak, names=names))
    out_all = build_route_reliability(conn2, route_id="51", generated_utc="t", weak_stops_limit=100)
    assert len(out_all.weak_stops) == 6


def test_build_route_reliability_delay_by_crowding_co_observes_all_bands() -> None:
    crowding = [
        {
            "band": "many_seats",
            "delay_obs": 100,
            "sum_delay_sec": 6000.0,
            "w_p50_sec": None,
            "p50_obs": 0,
            "day_count": 5,
        },
        {
            "band": "standing",
            "delay_obs": 40,
            "sum_delay_sec": 9600.0,
            "w_p50_sec": None,
            "p50_obs": 0,
            "day_count": 5,
        },
        {
            "band": "full",
            "delay_obs": 10,
            "sum_delay_sec": 3000.0,
            "w_p50_sec": None,
            "p50_obs": 0,
            "day_count": 3,
        },
    ]
    conn = FakeConn(_route_reliability_dispatch(crowding=crowding))

    out = build_route_reliability(conn, route_id="51", generated_utc="t")

    by_band = {c.band: c for c in out.delay_by_crowding}
    assert [c.band for c in out.delay_by_crowding] == ["many_seats", "standing", "full"]
    assert by_band["many_seats"].avg_delay_min == 1.0
    assert by_band["standing"].avg_delay_min == 4.0
    assert by_band["full"].avg_delay_min == 5.0
    assert by_band["full"].observation_count == 10
    assert by_band["full"].day_count == 3
    assert by_band["many_seats"].p50_min is None


def test_build_route_reliability_delay_by_crowding_avg_and_p50() -> None:
    crowding = [
        {
            "band": "many_seats",
            "delay_obs": 40,
            "sum_delay_sec": 7200.0,
            "w_p50_sec": 3600.0,
            "p50_obs": 40,
            "day_count": 2,
        },
    ]
    conn = FakeConn(_route_reliability_dispatch(crowding=crowding))

    out = build_route_reliability(conn, route_id="51", generated_utc="t")

    cell = {c.band: c for c in out.delay_by_crowding}["many_seats"]
    assert cell.avg_delay_min == 3.0
    assert cell.p50_min == 1.5
    assert cell.observation_count == 40
    assert cell.day_count == 2


def test_build_route_reliability_delay_by_crowding_empty_when_no_telemetry() -> None:
    conn = FakeConn(_route_reliability_dispatch(crowding=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.delay_by_crowding == []


def test_build_route_reliability_delay_by_crowding_skips_null_band() -> None:
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
    assert out.delay_by_crowding[0].avg_delay_min == 4.0


def test_build_route_reliability_by_shift_daytype_empty_when_absent() -> None:
    conn = FakeConn(_route_reliability_dispatch(crosstab=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.by_shift_daytype == []


def test_build_route_reliability_by_shift_daytype_honest_null_metrics() -> None:
    from transit_ops.snapshots.builders.historic._spine import _spine_route_crosstab

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
    assert by[1].mix.many_seats == 0.5
    assert by[1].mix.standing == 0.2
    assert by[6].mix.empty == 0.8
    assert by[1].n == 10
    assert by[6].n == 10


def test_build_route_reliability_occupancy_by_dow_honest_none_when_no_bands() -> None:
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
    assert out.occupancy_by_dow[0].n == 0


def test_build_route_reliability_occupancy_by_dow_empty_when_absent() -> None:
    conn = FakeConn(_route_reliability_dispatch(occ_dow=[]))
    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert out.occupancy_by_dow == []


def test_build_route_reliability_occupancy_by_hour_cells() -> None:
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
    assert by[8].mix.many_seats == 0.5
    assert by[8].mix.standing == 0.2
    assert by[12].mix.empty == 0.8
    assert by[8].n == 10
    assert by[12].n == 10


def test_build_route_reliability_occupancy_by_hour_honest_none_when_no_bands() -> None:
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
    assert g["day"].mix.many_seats == 1.0
    assert g["week"].mix.many_seats == 0.5
    assert g["week"].mix.few_seats == 0.5
    assert round(g["month"].mix.empty, 3) == 0.333


def test_build_route_reliability_occupancy_by_grain_honest_none_when_no_bands() -> None:
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
    weak = [
        {"stop_id": "S_RETIRED", "obs": 10, "weighted_delay_sec": 6000.0, "severe": 0},
        {"stop_id": "S1", "obs": 10, "weighted_delay_sec": 1200.0, "severe": 0},
    ]
    names = [
        {"stop_id": "S1", "stop_name": "Stop 1"},
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


def test_build_route_reliability_injected_names_match_two_route_fallback_bytes() -> None:
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    stop_rows = [{"stop_id": "S1", "stop_name": "Station Berri"}]
    route_rows = [
        {"route_id": "51", "route_name": "Boulevard Saint-Laurent"},
        {"route_id": "165", "route_name": "Cote-Vertu"},
    ]
    dispatch = _route_reliability_dispatch(
        weak=[
            {
                "stop_id": "S1",
                "obs": 40,
                "weighted_delay_sec": 7200.0,
                "severe": 4,
            }
        ],
        names=stop_rows,
        route_names=route_rows,
    )

    fallback_conn = FakeConn(dispatch)
    fallback = {
        route_id: build_route_reliability(
            fallback_conn,
            route_id=route_id,
            generated_utc="t",
        )
        for route_id in ("51", "165")
    }

    injected_conn = FakeConn(dispatch)
    injected = {
        route_id: build_route_reliability(
            injected_conn,
            route_id=route_id,
            generated_utc="t",
            route_names={"51": "Boulevard Saint-Laurent", "165": "Cote-Vertu"},
            stop_names={"S1": "Station Berri"},
        )
        for route_id in ("51", "165")
    }

    assert all(
        snapshot_json_bytes(injected[route_id]) == snapshot_json_bytes(fallback[route_id])
        for route_id in fallback
    )
    injected_queries = [name for name, _params in injected_conn.executed_query_params]
    assert "static.route_names" not in injected_queries
    assert "static.stop_names" not in injected_queries


def test_build_route_reliability_no_dataset_version_still_builds() -> None:
    conn = FakeConn(
        [
            ("static.dataset_version", []),
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
    assert any(p.grain == "day" for p in out.periods)
    am = next(h for h in out.headway if h.shift == "am_peak")
    assert am.observed_min == 7.0
    assert am.scheduled_min is None
    assert am.excess_wait_min is None


def test_build_stop_reliability_batch() -> None:
    conn = _stop_spine_conn(
        anchor=datetime.date(2026, 6, 30),
        by_route=[
            {"stop_id": "S1", "route_id": "51", "obs": 100, "weighted_delay_sec": 6000.0},
            {"stop_id": "S1", "route_id": "9", "obs": 50, "weighted_delay_sec": 9000.0},
        ],
        weekly=[{"stop_id": "S1", "obs": 150, "weighted_delay_sec": 12000.0, "severe": 15}],
        monthly=[{"stop_id": "S1", "obs": 600, "weighted_delay_sec": 90000.0, "severe": 30}],
    )

    out = build_stop_reliability(conn, provider_id="stm", generated_utc="t")

    assert "S1" in out
    s1 = out["S1"]
    assert isinstance(s1, StopReliability)
    assert s1.id == "S1"

    by_grain = {p.grain: p for p in s1.periods}
    assert [p.grain for p in s1.periods] == ["week", "month"]

    wk = by_grain["week"]
    assert wk.otp_pct == 90
    assert wk.avg_delay_min == 1.3
    assert wk.severe_pct == 10.0

    mo = by_grain["month"]
    assert mo.otp_pct == 95
    assert mo.avg_delay_min == 2.5
    assert mo.severe_pct == 5.0

    assert [b.route for b in s1.by_route] == ["9", "51"]
    by_route = {b.route: b for b in s1.by_route}
    assert by_route["51"].avg_delay_min == 1.0
    assert by_route["9"].avg_delay_min == 3.0


def test_stop_by_route_sql_excludes_unrouted_sentinel() -> None:
    assert "route_id <> '__unrouted__'" in _STOP_REL_BY_ROUTE_SQL.text


def test_build_stop_reliability_weekly_only_stop() -> None:
    conn = _stop_spine_conn(
        anchor=datetime.date(2026, 6, 30),
        weekly=[{"stop_id": "S2", "obs": 80, "weighted_delay_sec": 4800.0, "severe": 8}],
        monthly=[],
    )
    out = build_stop_reliability(conn, generated_utc="t")
    assert "S2" in out
    s2 = out["S2"]
    assert [p.grain for p in s2.periods] == ["week"]
    assert s2.periods[0].otp_pct == 90
    assert s2.by_route == []


def test_build_stop_reliability_carries_name() -> None:
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
    rows = [
        {
            "entity_kind": "stop",
            "entity_id": f"S{i}",
            "issue_count": 100 - i,
            "severity_label": "high",
            "net_on_time": 90,
            "net_known": 100,
            "net_stop_obs": 100,
            "net_stop_severe": 10,
            "stop_obs": 100 if i == 0 else None,
            "stop_severe": 30 if i == 0 else None,
        }
        for i in range(25)
    ]
    conn = FakeConn({"hotspots.list": rows[:20]})

    out = build_hotspots(conn, provider_id="stm", generated_utc="t")

    assert isinstance(out, Hotspots)
    assert len(out.hotspots) == 20
    assert [h.rank for h in out.hotspots] == list(range(1, 21))
    first = out.hotspots[0]
    assert first.type == "stop"
    assert first.id == "S0"
    assert first.severity == "high"
    assert first.otp_delta_pts == -20.0
    assert out.hotspots[1].otp_delta_pts is None


def test_build_hotspots_empty_returns_empty() -> None:
    conn = FakeConn({"hotspots.list": []})
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots == []


def test_build_hotspots_week_period_filter() -> None:
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
            ("static.stop_names", [{"stop_id": "S_RETIRED", "stop_name": "Ancien arret"}]),
        ]
    )

    out = build_hotspots(conn, generated_utc="t")

    assert out.hotspots[0].name == "Saint-Laurent"
    assert out.hotspots[1].name == "Ancien arret"
    assert out.hotspots[2].name is None


def test_build_hotspots_otp_delta_route_real_otp_signed_1dp() -> None:
    rows = [
        {
            "entity_kind": "route",
            "entity_id": "51",
            "issue_count": 9,
            "severity_label": "high",
            "route_on_time": 75,
            "route_known": 100,
            "stop_obs": None,
            "stop_severe": None,
            "net_on_time": 825,
            "net_known": 1000,
        },
    ]
    conn = FakeConn({"hotspots.list": rows})
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].otp_delta_pts == -7.5


def test_build_hotspots_otp_delta_stop_uses_severe_proxy() -> None:
    rows = [
        {
            "entity_kind": "stop",
            "entity_id": "3456",
            "issue_count": 8,
            "severity_label": "high",
            "route_on_time": None,
            "route_known": None,
            "stop_obs": 200,
            "stop_severe": 40,
            "net_on_time": 90,
            "net_known": 100,
            "net_stop_obs": 1000,
            "net_stop_severe": 100,
        },
    ]
    conn = FakeConn({"hotspots.list": rows})
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].otp_delta_pts == -10.0


def test_build_hotspots_otp_delta_stop_problem_is_negative_vs_severe_baseline() -> None:
    rows = [
        {
            "entity_kind": "stop",
            "entity_id": "9999",
            "issue_count": 12,
            "severity_label": "high",
            "stop_obs": 1000,
            "stop_severe": 50,
            "net_on_time": 8200,
            "net_known": 10000,
            "net_stop_obs": 100000,
            "net_stop_severe": 2000,
        },
    ]
    conn = FakeConn({"hotspots.list": rows})
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].otp_delta_pts == -3.0


def test_build_hotspots_otp_delta_stop_none_when_severe_baseline_missing() -> None:
    rows = [
        {
            "entity_kind": "stop",
            "entity_id": "3456",
            "issue_count": 8,
            "severity_label": "high",
            "stop_obs": 200,
            "stop_severe": 40,
            "net_on_time": 90,
            "net_known": 100,
            "net_stop_obs": None,
            "net_stop_severe": None,
        },
    ]
    conn = FakeConn({"hotspots.list": rows})
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].otp_delta_pts is None


def test_build_hotspots_otp_delta_cell_otp_unknown_is_none() -> None:
    rows = [
        {
            "entity_kind": "route",
            "entity_id": "99",
            "issue_count": 5,
            "severity_label": "watch",
            "route_on_time": None,
            "route_known": None,
            "stop_obs": None,
            "stop_severe": None,
            "net_on_time": 90,
            "net_known": 100,
        },
    ]
    conn = FakeConn({"hotspots.list": rows})
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].otp_delta_pts is None


def test_build_hotspots_otp_delta_network_baseline_null_is_none() -> None:
    rows = [
        {
            "entity_kind": "route",
            "entity_id": "51",
            "issue_count": 9,
            "severity_label": "high",
            "route_on_time": 75,
            "route_known": 100,
            "stop_obs": None,
            "stop_severe": None,
            "net_on_time": None,
            "net_known": None,
        },
    ]
    conn = FakeConn({"hotspots.list": rows})
    out = build_hotspots(conn, generated_utc="t")
    assert out.hotspots[0].otp_delta_pts is None


def test_hotspots_sql_per_kind_otp_join_keys() -> None:
    sql = str(_HOTSPOTS_SQL)
    assert "rp.entity_kind = 'route'" in sql
    assert "rrw.route_id = rp.entity_id" in sql
    assert "rp.entity_kind = 'stop'" in sql
    assert "so.stop_id = rp.entity_id" in sql
    assert "net_on_time" in sql and "net_known" in sql
    assert "route_spine_weekly AS" in sql
    assert "gold.route_delay_spine" in sql
    assert "stop_spine_weekly AS" in sql
    assert "gold.stop_delay_spine" in sql
    assert "gold.stop_delay_weekly" not in sql
    assert "net_stop_obs" in sql and "net_stop_severe" in sql
    assert "net_stop AS" in sql


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
    route_rows = [{"route_id": "99", "obs": 1000, "severe": 20, "sum_delay_sec": 60000}]
    stop_rows = [{"stop_id": "S1", "obs": 40, "severe": 36, "sum_delay_sec": 90000}]
    conn, rn, sn = _by_grain_conn(route_rows=route_rows, stop_rows=stop_rows)
    grains = _hotspots_by_grain(conn, "stm", rn, sn)
    assert [g.grain for g in grains] == ["day", "week", "month", "shift"]
    day = grains[0]
    assert [(e.rank, e.type, e.id) for e in day.entries] == [(1, "route", "99"), (1, "stop", "S1")]
    assert day.total_ranked_routes == 1
    assert day.total_ranked_stops == 1


def test_hotspots_by_grain_min_n_goes_to_tray_not_ranked() -> None:
    route_rows = [
        {"route_id": "99", "obs": 50, "severe": 10, "sum_delay_sec": 30000},
        {"route_id": "7", "obs": 12, "severe": 6, "sum_delay_sec": 3000},
    ]
    conn, rn, sn = _by_grain_conn(route_rows=route_rows, stop_rows=[])
    day = _hotspots_by_grain(conn, "stm", rn, sn)[0]
    assert [e.id for e in day.entries] == ["99"]
    assert day.entries[0].rank == 1
    assert [e.id for e in day.tray] == ["7"]
    assert day.tray[0].rank is None
    assert day.tray[0].wilson_lo is None
    assert day.tray[0].observation_count == 12


def test_hotspots_by_grain_honest_absence_omits_empty() -> None:
    conn, rn, sn = _by_grain_conn(route_rows=[], stop_rows=[])
    assert _hotspots_by_grain(conn, "stm", rn, sn) == []
    conn2, rn2, sn2 = _by_grain_conn(route_anchor=None, stop_anchor=None)
    assert _hotspots_by_grain(conn2, "stm", rn2, sn2) == []


def test_hotspots_by_grain_evidence_fields_and_windows() -> None:
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
    assert e.avg_delay_min == 20.0
    assert e.wilson_lo is not None and e.wilson_hi is not None
    assert e.otp_delta_pts == 0.0


def test_hotspots_by_grain_otp_delta_vs_network_severe_baseline() -> None:
    stop_rows = [
        {"stop_id": "S1", "obs": 100, "severe": 50, "sum_delay_sec": 60000},
        {"stop_id": "S2", "obs": 100, "severe": 10, "sum_delay_sec": 6000},
    ]
    conn, rn, sn = _by_grain_conn(route_rows=[], stop_rows=stop_rows)
    day = _hotspots_by_grain(conn, "stm", rn, sn)[0]
    by_id = {e.id: e for e in day.entries}
    assert by_id["S1"].otp_delta_pts == -20.0
    assert by_id["S2"].otp_delta_pts == 20.0


def test_hotspots_by_grain_tray_is_severe_desc_union_with_total() -> None:
    route_rows = [
        {"route_id": "R7", "obs": 10, "severe": 8, "sum_delay_sec": 6000},
        {"route_id": "R3", "obs": 10, "severe": 5, "sum_delay_sec": 4000},
    ]
    stop_rows = [{"stop_id": "S9", "obs": 10, "severe": 2, "sum_delay_sec": 1000}]
    conn, rn, sn = _by_grain_conn(route_rows=route_rows, stop_rows=stop_rows)
    day = _hotspots_by_grain(conn, "stm", rn, sn)[0]
    assert day.entries == []
    assert [e.id for e in day.tray] == ["R7", "R3", "S9"]
    assert all(e.rank is None for e in day.tray)
    assert day.tray_total == 3
    assert day.total_ranked_routes == 0 and day.total_ranked_stops == 0


def test_hotspots_by_grain_scalar_list_byte_identical() -> None:
    import json

    scalar_rows = [
        {"entity_kind": "route", "entity_id": "51", "issue_count": 9, "severity_label": "high"},
        {"entity_kind": "stop", "entity_id": "3456", "issue_count": 3, "severity_label": "watch"},
    ]
    a = build_hotspots(FakeConn({"hotspots.list": scalar_rows}), generated_utc="t")
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
    assert dump_a == dump_b


def test_build_repeat_offenders_recurrence_string() -> None:
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
    assert o.avg_delay_min == 3.0
    assert o.route == "51"
    assert o.type == "trip"
    assert o.id == "X1"


def test_build_repeat_offenders_ordering() -> None:
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
    assert out.offenders[0].id == "T9"
    assert out.offenders[1].id == "V2"


def test_build_repeat_offenders_top_50_cap() -> None:
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
                    {"route_id": "R_RETIRED", "route_name": "Ancienne ligne"},
                ],
            ),
        ]
    )

    out = build_repeat_offenders(conn, generated_utc="t")

    assert out.offenders[0].route_name == "Boulevard Saint-Laurent"
    assert out.offenders[0].id == "281234567"
    assert out.offenders[1].route_name == "Ancienne ligne"
    assert out.offenders[2].route_name is None


def test_build_repeat_offenders_scalar_additive_fields_and_order_stable() -> None:
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
    assert [o.id for o in out.offenders] == ["T9", "V2"]
    o0 = out.offenders[0]
    assert o0.recurrence == "10/14d"
    assert o0.avg_delay_min == 5.0
    assert o0.recurrence_days == 10
    assert o0.window_days == 14
    assert o0.severity == "critical"
    assert out.offenders[1].severity == "high"


def test_offender_severity_matches_mart_vocabulary() -> None:
    assert offender_severity(10, 0.0) == "critical"
    assert offender_severity(0, 601.2) == "critical"
    assert offender_severity(1, 600.0) in ("high", "watch")
    assert offender_severity(5, 0.0) == "high"
    assert offender_severity(4, 300.0) == "watch"
    assert offender_severity(None, None) is None


def test_offender_severity_avg_boundary_is_strict_gt_600s() -> None:
    assert offender_severity(0, 600.0) == "watch"
    assert offender_severity(0, 600.4) == "critical"
    assert offender_severity(0, 601.2) == "critical"


_OFFENDER_ANCHOR = datetime.date(2026, 6, 30)


def _offender_grain_conn(spine_rows, route_names=None):  # noqa: ANN001, ANN202
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
    rows = [
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
    trips = [e for e in week.entries if e.type == "trip"]
    vehs = [e for e in week.entries if e.type == "vehicle"]
    assert [e.rank for e in trips] == [1, 2]
    assert [e.rank for e in vehs] == [1]
    assert week.total_ranked_trips == 2
    assert week.total_ranked_vehicles == 1
    assert trips[0].id == "T_BAD"
    assert trips[0].route_name == "Route Nine"
    assert trips[0].recurrence_days == 6
    assert trips[0].observed_days == 6
    assert trips[0].severe_pct == 60.0
    assert trips[0].wilson_lo is not None and trips[0].wilson_hi is not None
    assert trips[0].avg_delay_min == 8.0


def test_by_grain_min_n_floor_routes_to_tray_only_when_recurred() -> None:
    assert MIN_N_OFFENDER == 30
    rows = [
        _offender_spine_row(
            "trip",
            "T_TRAY",
            "9",
            obs=MIN_N_OFFENDER - 1,
            severe=10,
            sum_sec=9000,
            recurrence_days=3,
            observed_days=3,
        ),
        _offender_spine_row(
            "trip", "T_DROP", "9", obs=5, severe=5, sum_sec=6000, recurrence_days=1, observed_days=1
        ),
        _offender_spine_row(
            "vehicle",
            "V_RANKED",
            "51",
            obs=MIN_N_OFFENDER,
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
    assert ranked_ids == {"V_RANKED"}
    assert tray_ids == {"T_TRAY"}
    assert "T_DROP" not in ranked_ids and "T_DROP" not in tray_ids
    assert week.tray_total == 1
    tray_e = week.tray[0]
    assert tray_e.rank is None
    assert tray_e.wilson_lo is None and tray_e.wilson_hi is None
    assert tray_e.recurrence_days == 3


def test_by_grain_omits_grain_on_honest_absence() -> None:
    empty = FakeConn(
        {"repeat.offenders.spine.anchor": [{"anchor": None}], "repeat.offenders.by_grain": []}
    )
    assert _repeat_offenders_by_grain(empty, "stm", {}) == []
    rows = [
        _offender_spine_row(
            "trip", "T", "9", obs=3, severe=3, sum_sec=1000, recurrence_days=1, observed_days=1
        )
    ]
    conn = _offender_grain_conn(rows)
    assert _repeat_offenders_by_grain(conn, "stm", {}) == []


def test_by_grain_pooled_avg_honest_none_on_zero_denominator() -> None:
    rows = [
        _offender_spine_row(
            "trip", "T0", "9", obs=0, severe=0, sum_sec=0, recurrence_days=2, observed_days=2
        )
    ]
    conn = _offender_grain_conn(rows)
    grains = _repeat_offenders_by_grain(conn, "stm", {})
    week = next(g for g in grains if g.grain == "week")
    assert week.tray[0].avg_delay_min is None


def test_offender_ladder_preserves_caller_order_for_exact_ties() -> None:
    rows = [
        dict(
            _offender_spine_row(
                "trip",
                "SAME",
                route,
                obs=100,
                severe=50,
                sum_sec=30_000,
                recurrence_days=3,
                observed_days=3,
            ),
            window_days=7,
        )
        for route in ("Z", "A")
    ]

    current, _, _ = build_offender_kind_ladder(rows, "trip", {})
    historical, _, _ = build_offender_kind_ladder(
        sorted(rows, key=lambda row: str(row["route_id"])), "trip", {}
    )

    assert [entry.route for entry in current] == ["Z", "A"]
    assert [entry.route for entry in historical] == ["A", "Z"]


@pytest.mark.parametrize("family", ["hotspots", "offenders"])
def test_ranked_name_lookups_are_limited_to_emitted_entries(family: str) -> None:
    rows = [
        {
            "stop_id": f"S{index:03}",
            "entity_id": f"S{index:03}",
            "route_id": "R1",
            "obs": 100,
            "severe": 10,
            "sum_delay_sec": 12_000,
            "recurrence_days": 3,
            "observed_days": 7,
            "window_days": 7,
        }
        for index in reversed(range(101))
    ]
    rows.append(rows[0] | {"obs": 10})
    names = Mock(spec=dict)
    names.get.return_value = None
    if family == "hotspots":
        ladder = build_hotspot_kind_ladder(rows, "stop", names)
        assert ladder is not None
        assert len(ladder.tray_rows) == 1
        expected_lookups = 50
    else:
        ladder = build_offender_kind_ladder(rows, "trip", names)
        assert len(ladder.tray) == 1
        expected_lookups = 51
    assert ladder.total_ranked == 101
    assert [entry.id for entry in ladder.entries] == [f"S{index:03}" for index in range(50)]
    assert names.get.call_count == expected_lookups


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
    d = datetime.date(2026, 5, 25)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[
                {
                    "provider_local_date": d,
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
    assert r.alerts == 7


def test_build_receipts_genuine_zero_affected_counts_preserved() -> None:
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
                    "pooled_delay_sec": 12000.0,
                    "inclamp_obs": 100,
                }
            ],
        )
    )
    out = build_receipts(conn, generated_utc="t")
    r = out["2026-05-10"]
    assert r.otp_pct == 60
    assert r.avg_delay_min == 2.0
    assert r.severe_pct == 10.0
    assert r.vehicles is None


def test_build_receipts_worst_route_and_stop_by_max_delay() -> None:
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
    assert r.worst_route.otp_delta_pts == -25.0
    assert r.worst_stop is not None
    assert r.worst_stop.id == "9999"
    assert r.worst_stop.avg_delay_min == 7.0


def test_build_receipts_skips_sentinel_worst_entities() -> None:
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
    assert r.otp_pct is None
    assert r.worst_route is not None and r.worst_route.id == "105"
    assert r.worst_route.otp_delta_pts is None


def test_receipts_worst_entity_order_has_deterministic_tiebreaker() -> None:
    route_sql = str(_RECEIPTS_WORST_ROUTE_SQL)
    stop_sql = str(_RECEIPTS_WORST_STOP_SQL)

    assert "prr.avg_delay_seconds DESC, prr.route_id" in route_sql
    assert "psd.avg_delay_seconds DESC, psd.stop_id" in stop_sql
    assert "route_id <> '__unrouted__'" in route_sql
    assert "stop_id <> '__unknown_stop__'" in stop_sql


def test_build_receipts_worst_entity_names() -> None:
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
    d = datetime.date(2026, 6, 1)
    conn = FakeConn(
        _receipts_dispatch(
            acct=[_acct_row(d)],
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
    assert ss.not_reported_route_count == n


def test_receipts_not_reported_excludes_sentinel() -> None:
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
    assert ss.not_reported_route_count is None


def test_receipts_additive_only_parity_no_new_rows() -> None:
    d = datetime.date(2026, 6, 8)
    conn = FakeConn(_receipts_dispatch(acct=[_acct_row(d, alert_count=3)]))
    r = build_receipts(conn, generated_utc="t")["2026-06-08"]
    assert r.by_shift == []
    assert r.service_states is None
    dumped = r.model_dump()
    assert dumped["by_shift"] == []
    assert dumped["service_states"] is None


def test_receipt_full_payload_under_byte_ceiling() -> None:
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


def test_build_alert_history_aggregation() -> None:
    import datetime as _dt
    import hashlib

    from transit_ops.snapshots.builders._helpers import _severity_code

    start = _dt.datetime(2026, 5, 1, 8, 0, 0, tzinfo=_dt.UTC)
    end = _dt.datetime(2026, 5, 1, 10, 30, 0, tzinfo=_dt.UTC)

    conn = FakeConn(
        [
            (
                "alerts.history",
                [
                    {
                        "alert_header_text": "Votre ligne",
                        "header_text_en": "Your line",
                        "alert_id": None,
                        "severity": "WARNING",
                        "routes": ["51", "9", "51"],
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
    basis = "|".join(str(x or "") for x in ("Votre ligne", "WARNING", start, end))
    assert e.id == f"stm-alert-{hashlib.sha1(basis.encode()).hexdigest()[:12]}"
    assert e.severity == _severity_code("WARNING")
    assert e.header_text == "Votre ligne"
    assert e.header_text_en == "Your line"
    assert e.duration_min == 150.0
    assert e.impact_passages is None
    assert e.routes == ["9", "51"]
    assert e.stops == ["1002", "3001"]


def test_build_alert_history_breakdown_buckets_by_cause_effect_severity() -> None:
    import datetime as _dt

    from transit_ops.snapshots.builders._helpers import _severity_code

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
                    _row("C", "INFO", None, None, None, None),
                ],
            )
        ]
    )
    out = build_alert_history(conn, generated_utc="t")
    assert out.breakdown is not None
    cause = {b.key: b for b in out.breakdown.by_cause}
    assert cause["MAINTENANCE"].count == 2
    assert cause["MAINTENANCE"].median_duration_min == 40.0
    assert cause["unknown"].count == 1
    assert cause["unknown"].median_duration_min is None
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
    import datetime as _dt

    start = _dt.datetime(2026, 5, 1, 10, 30, 0, tzinfo=_dt.UTC)
    end = _dt.datetime(2026, 5, 1, 8, 0, 0, tzinfo=_dt.UTC)
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
    assert e.duration_min is None
    assert e.start_utc is not None
    assert e.end_utc is not None


def test_build_alert_history_200_cap() -> None:
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


def test_alert_history_sql_uses_windowed_binds_not_now_clause() -> None:
    from transit_ops.snapshots.builders.historic.small_surfaces import _ALERT_HISTORY_SQL

    sql = str(_ALERT_HISTORY_SQL)
    assert ":win_start" in sql and ":win_end" in sql
    assert "now() AT TIME ZONE" not in sql
    assert "LIMIT 500" in sql
    assert "active_periods" in sql and "JSONB_AGG" in sql


def test_build_alert_history_window_fields_from_anchor() -> None:
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
                    "active_periods": None,
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
    assert out.total_in_window == 512
    assert out.truncated is True


def test_build_alert_history_exact_cap_fill_is_not_truncated() -> None:
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

    by_feed = {s.feed: s for s in out.sources}
    assert "static_schedule" in by_feed
    assert by_feed["static_schedule"].chain == "r2:stm/static/latest.zip"
    assert by_feed["realtime_vehicle_positions"].chain == "https://stm.info/gtfs-rt/vehicles"
    assert by_feed["static_schedule"].last_loaded_utc == "2026-06-01T12:00:00Z"

    by_key = {f.feed: f for f in out.freshness}
    assert by_key["vehicle_positions"].status == "ok"
    assert by_key["vehicle_positions"].age_s == 25
    assert by_key["trip_updates"].age_s is None

    assert out.retention == {"detail_days": 14, "aggregate_days": 730}

    assert "otp_definition" in out.methodology
    assert "delay_unit" in out.methodology
    assert "percentiles" in out.methodology
    assert "headway" in out.methodology
    assert "busiest direction" in out.methodology["headway"]
    assert "weekday" in out.methodology["headway"]

    assert "metro_realtime" in out.gaps


def test_build_provenance_includes_gis_static_source_and_freshness() -> None:
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


def test_provenance_methodology_discloses_monotonic_alert_text_en_truth() -> None:
    conn = FakeConn(
        [
            ("provenance.sources", []),
            ("provenance.freshness", []),
        ]
    )
    out = build_provenance(conn, provider_id="sto", generated_utc="t")

    alert_en = out.methodology["alert_text_en"]
    assert "header_text_en" in alert_en
    assert "explicitly tagged English" in alert_en
    assert "last explicit English value" in alert_en
    assert "never been observed" in alert_en
    assert "pre-coalescing observations" in alert_en
    assert "Silver SCD" in alert_en
    assert "STM" not in alert_en
    assert "legacy tail" in alert_en
    assert "pre-2026-06-09" in alert_en
    assert "regardless of what the provider published" in alert_en


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
    from transit_ops.snapshots.builders.static import _STATIC_LABELS_EN, _STATIC_LABELS_FR

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


_BATCH_QUERY_ORDER = [
    "route.spine.route_ids",
    "static.route_names",
    "static.stop_names",
    "route.reliability.batch.percentile_daily",
    "route.reliability.batch.daily",
    "route.reliability.batch.spine_sections",
    "route.reliability.batch.headway_observed",
    "static.dataset_version",
    "static.rep_dates",
    "static.active_services",
    "static.active_services",
    "static.all_route_schedules",
    "route.reliability.batch.headway_direction",
    "route.reliability.batch.headway_windows",
    "route.reliability.batch.weak_stops",
    "route.reliability.batch.cancellations",
    "route.reliability.batch.occupancy",
    "route.reliability.batch.service_spans",
    "route.reliability.batch.skipped_stops",
    "route.reliability.batch.crowding_delay",
]


class _BatchResult:
    def __init__(self, rows):  # noqa: ANN001
        self._rows = list(rows)

    def mappings(self):  # noqa: ANN201
        return self

    def __iter__(self):
        return iter(self._rows)

    def fetchone(self):  # noqa: ANN201
        return self._rows[0] if self._rows else None

    def fetchall(self):  # noqa: ANN201
        return list(self._rows)


class _BatchPhysicalConn:

    def __init__(
        self,
        route_ids=("R1", "R2"),
        *,
        current_dataset: bool = True,
        reverse_rows: bool = False,
    ) -> None:
        self.route_ids = tuple(route_ids)
        self.current_dataset = current_dataset
        self.reverse_rows = reverse_rows
        self.queries: list[str | None] = []

    def _fixture_rows(self, name: str | None, params: dict) -> list:  # noqa: ANN001
        fixture_routes = set(self.route_ids)
        rows: list = []
        if name == "route.spine.route_ids":
            rows = [
                {
                    "route_id": route_id,
                    "spine_anchor": datetime.date(2026, 6, 30),
                }
                for route_id in self.route_ids
            ]
        elif name == "static.route_names":
            rows = [
                {"route_id": "R1", "route_name": "Route One"},
                {"route_id": "R2", "route_name": "Route Two"},
                {"route_id": "FOREIGN", "route_name": "Must not leak"},
            ]
        elif name == "static.stop_names":
            rows = [
                {"stop_id": "S1", "stop_name": "Stop One"},
                {"stop_id": "S2", "stop_name": "Stop Two"},
            ]
        elif name == "route.reliability.batch.daily":
            rows = [
                {
                    "route_id": "R1",
                    "d": datetime.date(2026, 6, 30),
                    "known_obs": 100,
                    "on_time": 80,
                    "avg_delay_sec": 120.0,
                    "severe": 5,
                },
                {
                    "route_id": "R2",
                    "d": datetime.date(2026, 6, 29),
                    "known_obs": 50,
                    "on_time": 25,
                    "avg_delay_sec": 240.0,
                    "severe": 10,
                },
                {
                    "route_id": "FOREIGN",
                    "d": datetime.date(2026, 6, 28),
                    "known_obs": 999,
                    "on_time": 999,
                    "avg_delay_sec": 0.0,
                    "severe": 0,
                },
            ]
        elif name == "route.reliability.batch.headway_observed":
            rows = [
                {
                    "route_id": "R1",
                    "shift": "am_peak",
                    "observed_headway_min": 11.0,
                    "sample_count": 30,
                    "headway_cov": 0.2,
                    "bunched_count": 3,
                },
                {
                    "route_id": "R2",
                    "shift": "midday",
                    "observed_headway_min": 7.0,
                    "sample_count": 12,
                    "headway_cov": 0.1,
                    "bunched_count": 1,
                },
            ]
        elif name == "static.dataset_version" and self.current_dataset:
            rows = [{"dataset_version_id": 1}]
        elif name == "static.rep_dates":
            rows = [
                {
                    "weekday_date": datetime.date(2026, 6, 3),
                    "weekend_date": datetime.date(2026, 6, 6),
                }
            ]
        elif name == "static.active_services":
            service = (
                "svc_wd"
                if params.get("repdate") == datetime.date(2026, 6, 3)
                else "svc_we"
            )
            rows = [(service,)]
        elif name == "static.all_route_schedules":
            rows = [
                {
                    "route_id": "R1",
                    "direction_id": 0,
                    "is_weekday": True,
                    "departure_time": departure,
                }
                for departure in ("07:00:00", "07:08:00", "07:16:00")
            ] + [
                {
                    "route_id": "R2",
                    "direction_id": 0,
                    "is_weekday": True,
                    "departure_time": departure,
                }
                for departure in ("12:00:00", "12:10:00")
            ]
        elif name == "route.reliability.batch.weak_stops":
            rows = [
                {
                    "route_id": route_id,
                    "section": "anchor",
                    "anchor": datetime.date(2026, 6, 30),
                }
                for route_id in ("R1", "R2")
            ] + [
                {
                    "route_id": "R1",
                    "section": "legacy",
                    "stop_id": "S1",
                    "obs": 40,
                    "weighted_delay_sec": 7200.0,
                    "severe": 4,
                },
                {
                    "route_id": "R2",
                    "section": "legacy",
                    "stop_id": "S2",
                    "obs": 60,
                    "weighted_delay_sec": 18000.0,
                    "severe": 6,
                },
            ]
        if name not in {"static.route_names", "static.stop_names"}:
            rows = [
                row
                for row in rows
                if not isinstance(row, dict)
                or "route_id" not in row
                or row["route_id"] in fixture_routes
            ]
        return list(reversed(rows)) if self.reverse_rows else rows

    def execute(self, statement, params=None):  # noqa: ANN001
        name = query_name(statement)
        self.queries.append(name)
        return _BatchResult(self._fixture_rows(name, dict(params or {})))


def _batch_builder():  # noqa: ANN202
    from transit_ops.snapshots import builders

    builder = getattr(builders, "build_all_route_reliability", None)
    assert callable(builder), "build_all_route_reliability must be exported"
    return builder


def test_build_all_route_reliability_preserves_public_assembler_signature() -> None:
    import inspect

    assert str(inspect.signature(build_route_reliability)) == (
        "(conn: 'Connection', *, provider_id: 'str' = 'stm', route_id: 'str', "
        "generated_utc: 'str', weak_stops_limit: 'int' = 100, "
        "route_names: 'Mapping[str, str] | None' = None, "
        "stop_names: 'Mapping[str, str] | None' = None) -> 'RouteReliability'"
    )
    assert callable(_batch_builder())


def test_build_all_route_reliability_two_route_bytes_hashes_and_row_order() -> None:
    import hashlib

    from transit_ops.snapshots.serialization import snapshot_json_bytes

    expected = {
        "R1": (2303, "bdada578d4b780789adf7b76c7f5d39a63411aef61477814965ccd10951974b7"),
        "R2": (2301, "f7ec65b3449312c161660fe50579d3fc1779aba3565eb06b5729f155ae2b5970"),
    }
    outputs = []
    for reverse_rows in (False, True):
        conn = _BatchPhysicalConn(reverse_rows=reverse_rows)
        built = _batch_builder()(
            conn,
            provider_id="stm",
            generated_utc="2026-07-21T00:00:00Z",
        )
        assert list(built) == ["R1", "R2"]
        assert conn.queries == _BATCH_QUERY_ORDER
        actual = {
            route_id: (
                len(payload_bytes := snapshot_json_bytes(payload)),
                hashlib.sha256(payload_bytes).hexdigest(),
            )
            for route_id, payload in built.items()
        }
        assert actual == expected
        assert built["R1"].periods[0].otp_pct == 80
        assert built["R2"].periods[0].otp_pct == 50
        assert built["R1"].weak_stops[0].id == "S1"
        assert built["R2"].weak_stops[0].id == "S2"
        assert all(route_id != "FOREIGN" for route_id in built)
        outputs.append({key: snapshot_json_bytes(value) for key, value in built.items()})
        from transit_ops.snapshots.envelope import stamp_envelope as _stamp_envelope

        stamped_items = [
            (
                f"historic/route_reliability/{route_id}.json",
                payload.model_copy(deep=True),
                "historic",
            )
            for route_id, payload in built.items()
        ]
        _stamp_envelope(stamped_items, provider_id="stm", stamp="2026-07-21T00:00:00Z")
        stamped = {
            payload.id: (
                len(payload_bytes := snapshot_json_bytes(payload)),
                hashlib.sha256(payload_bytes).hexdigest(),
            )
            for _key, payload, _tier in stamped_items
        }
        assert stamped == {
            "R1": (2336, "a0e9e0e154546fd9db65b1aee3caa66bb576ec6ea4a2d461cd0c3fdc932e46c2"),
            "R2": (2334, "35ba07471339c9dfa1d32b4dd0044836b46a8aeb859d19267f2b910f22c9576b"),
        }
    assert outputs[0] == outputs[1]


@pytest.mark.parametrize("route_count", [2, 200])
def test_build_all_route_reliability_has_constant_twenty_query_budget(route_count: int) -> None:
    route_ids = tuple(f"R{index:03d}" for index in range(route_count))
    conn = _BatchPhysicalConn(route_ids)

    built = _batch_builder()(conn, provider_id="stm", generated_utc="t")

    assert list(built) == sorted(route_ids)
    assert conn.queries == _BATCH_QUERY_ORDER


def test_build_all_route_reliability_shares_provider_static_rows_across_routes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import transit_ops.snapshots.builders.historic.route_reliability_batch as batch_module

    class ManyServiceConn(_BatchPhysicalConn):
        def _fixture_rows(self, name: str | None, params: dict) -> list:
            if name == "static.active_services":
                suffix = "wd" if params["repdate"] == datetime.date(2026, 6, 3) else "we"
                return [(f"svc_{suffix}_{index}",) for index in range(50)]
            return super()._fixture_rows(name, params)

    seen: dict[str, list[tuple[object, ...]]] = {
        "dataset": [],
        "rep_dates": [],
        "weekday_services": [],
        "weekend_services": [],
    }

    def capture_shared_rows(
        conn,
        *,
        provider_id: str,
        route_id: str,
        generated_utc: str,
        route_names,
        stop_names,
    ) -> str:  # noqa: ANN001
        del generated_utc, route_names, stop_names
        checks = (
            ("dataset", batch_module._CURRENT_DATASET_VERSION_SQL, {}),
            ("rep_dates", batch_module._REP_DATES_SQL, {}),
            (
                "weekday_services",
                batch_module._ACTIVE_SERVICES_SQL,
                {"repdate": datetime.date(2026, 6, 3)},
            ),
            (
                "weekend_services",
                batch_module._ACTIVE_SERVICES_SQL,
                {"repdate": datetime.date(2026, 6, 6)},
            ),
        )
        for label, statement, params in checks:
            result = conn.execute(
                statement,
                {"provider_id": provider_id, "route_id": route_id, **params},
            )
            seen[label].append(result._rows)
        return route_id

    monkeypatch.setattr(batch_module, "build_route_reliability", capture_shared_rows)
    route_ids = tuple(f"R{index:03d}" for index in range(200))

    built = batch_module.build_all_route_reliability(
        ManyServiceConn(route_ids),
        provider_id="stm",
        generated_utc="t",
    )

    assert list(built) == sorted(route_ids)
    assert all(len(rows) == 200 for rows in seen.values())
    assert all(len({id(rows) for rows in route_rows}) == 1 for route_rows in seen.values())
    assert len(seen["weekday_services"][0]) == 50
    assert len(seen["weekend_services"][0]) == 50


def test_build_all_route_reliability_empty_inventory_is_one_query() -> None:
    conn = _BatchPhysicalConn(())

    assert _batch_builder()(conn, provider_id="stm", generated_utc="t") == {}
    assert conn.queries == ["route.spine.route_ids"]


def test_build_all_route_reliability_without_static_dataset_uses_at_most_sixteen_queries() -> None:
    conn = _BatchPhysicalConn(current_dataset=False)

    _batch_builder()(conn, provider_id="stm", generated_utc="t")

    assert len(conn.queries) <= 16
    assert "static.rep_dates" not in conn.queries
    assert "static.active_services" not in conn.queries
    assert "static.all_route_schedules" not in conn.queries


def test_route_batch_adapter_fails_closed_for_query_route_and_provider() -> None:
    from sqlalchemy import text

    from transit_ops.snapshots.builders.historic.route_reliability_batch import (
        _InMemoryRouteConnection,
    )

    adapter = _InMemoryRouteConnection(provider_id="stm", route_id="R1", rows={})
    with pytest.raises(RuntimeError, match="unknown logical route query"):
        adapter.execute(text("-- q:test.unknown\nSELECT 1"))
    with pytest.raises(RuntimeError, match="rejected route"):
        adapter.execute(
            _ROUTE_REL_DAILY_SQL,
            {"provider_id": "stm", "route_id": "R2"},
        )
    with pytest.raises(RuntimeError, match="rejected provider"):
        adapter.execute(
            _ROUTE_REL_DAILY_SQL,
            {"provider_id": "other", "route_id": "R1"},
        )


def test_route_batch_sql_is_set_based_partitioned_and_has_no_lateral_subplans() -> None:
    from transit_ops.snapshots.builders.historic.route_reliability_batch import (
        _CANCELLATIONS_SQL,
        _DAILY_SQL,
        _HEADWAY_WINDOWS_SQL,
        _SERVICE_SPANS_SQL,
        _SKIPPED_STOPS_SQL,
        _SPINE_SECTIONS_SQL,
        _WEAK_STOPS_SQL,
    )

    composite = "\n".join(
        str(statement)
        for statement in (_SPINE_SECTIONS_SQL, _HEADWAY_WINDOWS_SQL, _WEAK_STOPS_SQL)
    ).upper()
    assert "CROSS JOIN LATERAL" not in composite
    assert "LIMIT 30" not in "\n".join(
        str(statement)
        for statement in (_DAILY_SQL, _CANCELLATIONS_SQL, _SERVICE_SPANS_SQL, _SKIPPED_STOPS_SQL)
    ).upper()
    for statement in (_DAILY_SQL, _CANCELLATIONS_SQL, _SERVICE_SPANS_SQL, _SKIPPED_STOPS_SQL):
        sql = str(statement).upper()
        assert "PARTITION BY ROUTE_ID" in sql
        assert "ROUTE_RANK <= 30" in sql
    assert "ROUTE_ID = :ROUTE_ID" not in composite


@pytest.mark.parametrize("numerator, expected", [(49, 6.13), (0, 0.0), (None, None)])
def test_network_trend_rate_midpoints_and_missing_counts(numerator, expected) -> None:
    conn = FakeConn({
        "network.trend.daily_cancel": [{
            "local_date": "2026-09-11", "canceled": numerator, "total": 800,
            "delivered": numerator, "scheduled": 800,
        }],
    })
    point = build_network_trend(conn, generated_utc="t").series[0]
    assert point.cancellation_rate == expected
    assert point.service_completeness_rate == expected


def test_headway_bunching_midpoint_and_excess_subtraction_precision() -> None:
    conn = FakeConn(_route_reliability_dispatch(
        schedule=[
            {"direction_id": 0, "is_weekday": True, "departure_time": "07:00:00"},
            {"direction_id": 0, "is_weekday": True, "departure_time": "07:01:00"},
        ],
        headway=[{
            "shift": "am_peak", "observed_headway_min": 2.3,
            "sample_count": 400, "bunched_count": 9,
        }],
    ))
    period = build_route_reliability(conn, route_id="51", generated_utc="t").headway[0]
    assert period.bunched_pct == 2.3
    assert period.scheduled_min == 1.0
    assert period.observed_min == 2.3
    assert period.excess_wait_min == 1.3
