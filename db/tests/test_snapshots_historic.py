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
    _otp_pct,
    build_network_trend,
    build_route_reliability,
    build_stop_reliability,
)
from transit_ops.snapshots.contract import (
    NetworkTrend,
    RouteReliability,
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


# --------------------------------------------------------------------------
# _otp_pct convention (obs=100, delayed=53 -> 47)
# --------------------------------------------------------------------------


def test_otp_pct_basic() -> None:
    assert _otp_pct(100, 53) == 47


def test_otp_pct_rounds() -> None:
    # (3 - 1)/3 = 0.6667 -> 67
    assert _otp_pct(3, 1) == 67


def test_otp_pct_zero_obs_is_none() -> None:
    assert _otp_pct(0, 0) is None
    assert _otp_pct(None, 5) is None


def test_otp_pct_no_delays_is_100() -> None:
    assert _otp_pct(50, 0) == 100


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
                    # obs=100, delayed=53 -> otp 47; weighted 100*120s/100 = 120s -> 2.0min
                    {"local_date": d1, "obs": 100, "delayed": 53, "weighted_delay_sec": 12000.0},
                    # obs=200, delayed=20 -> otp 90; weighted 200*90s/200 = 90s -> 1.5min
                    {"local_date": d2, "obs": 200, "delayed": 20, "weighted_delay_sec": 18000.0},
                    # obs=0 -> otp None, avg None
                    {"local_date": d3, "obs": 0, "delayed": 0, "weighted_delay_sec": None},
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

    out = build_network_trend(conn, provider_id="stm")

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
    # d3: obs=0 in rollup (None OTP/avg) but fact covers it (p90/vehicles present)
    assert p3.otp_pct is None
    assert p3.avg_delay_min is None
    assert p3.p90_min == 9.0
    assert p3.vehicles == 280


def test_build_network_trend_fact_only_date() -> None:
    """A date present only in the fact table still yields a point (rollup fields None)."""
    d = datetime.date(2026, 6, 5)
    conn = FakeConn(
        [
            ("route_delay_hourly", []),
            ("fact_trip_delay_snapshot", [{"local_date": d, "p90_min": 4.0, "vehicles": 12}]),
        ]
    )
    out = build_network_trend(conn)
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
                                habit=None, weak=None, names=None, schedule=None):
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
        # daily public reliability
        ("public_route_reliability_daily", daily or []),
        # weekly / monthly
        ("route_reliability_weekly", weekly or []),
        ("route_reliability_monthly", monthly or []),
        # observed headway
        ("route_headway_daily", headway or []),
        # habits
        ("route_habit_score", habit or []),
        # weak stops
        ("stop_delay_weekly", weak or []),
        # stop names
        ("stop_name", names or []),
    ]


def test_build_route_reliability_periods_and_otp() -> None:
    conn = FakeConn(
        _route_reliability_dispatch(
            daily=[
                # daily view exposes only severe -> OTP from severe; obs=100,severe=10 -> 90
                {
                    "d": datetime.date(2026, 6, 1),
                    "obs": 100,
                    "avg_delay_sec": 90.0,  # -> 1.5 min
                    "severe": 10,
                },
            ],
            weekly=[
                # weekly OTP from delayed; obs=100, delayed=53 -> 47; severe 5 -> 5.0%
                {
                    "d": datetime.date(2026, 5, 25),
                    "obs": 100,
                    "avg_delay_sec": 120.0,  # -> 2.0 min
                    "delayed": 53,
                    "severe": 5,
                },
            ],
            monthly=[
                {
                    "d": datetime.date(2026, 5, 1),
                    "obs": 1000,
                    "avg_delay_sec": 150.0,  # -> 2.5 min
                    "delayed": 200,  # -> 80
                    "severe": 50,  # -> 5.0%
                },
            ],
        )
    )

    out = build_route_reliability(conn, provider_id="stm", route_id="51")

    assert isinstance(out, RouteReliability)
    assert out.id == "51"
    by_grain = {p.grain: p for p in out.periods}
    assert set(by_grain) == {"day", "week", "month"}

    day = by_grain["day"]
    assert day.date == "2026-06-01"
    assert day.otp_pct == 90  # from severe proxy
    assert day.avg_delay_min == 1.5
    assert day.severe_pct == 10.0
    assert day.p50_min is None and day.p90_min is None  # deferred

    week = by_grain["week"]
    assert week.otp_pct == 47  # from delayed
    assert week.avg_delay_min == 2.0
    assert week.severe_pct == 5.0

    month = by_grain["month"]
    assert month.otp_pct == 80
    assert month.avg_delay_min == 2.5
    assert month.severe_pct == 5.0


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

    out = build_route_reliability(conn, route_id="51")
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
    out = build_route_reliability(conn, route_id="51")
    am = next(h for h in out.headway if h.shift == "am_peak")
    assert am.scheduled_min == 10.0
    assert am.observed_min == 6.0
    assert am.excess_wait_min == 0.0  # max(0, 6-10)


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
    out = build_route_reliability(conn, route_id="51")
    assert out.habits is not None
    assert out.habits.scale == "repeat_problem_score"
    assert len(out.habits.matrix) == 7
    assert all(len(row) == 24 for row in out.habits.matrix)
    # isodow 1 -> row index 0; hour 0 -> col 0
    assert out.habits.matrix[0][0] == 0.9
    # isodow 7 -> row 6; hour 23 -> col 23
    assert out.habits.matrix[6][23] == 0.4
    # isodow 3 -> row 2; hour 8 -> col 8
    assert out.habits.matrix[2][8] == 0.75
    # unspecified cells default to 0.0
    assert out.habits.matrix[1][5] == 0.0


def test_build_route_reliability_weak_stops_sorted_and_capped() -> None:
    # 6 stops with descending delays; expect top 5 by avg delay, sorted desc.
    weak = [
        {"stop_id": f"S{i}", "obs": 10, "weighted_delay_sec": delay_sec * 10, "severe": 0}
        for i, delay_sec in enumerate([60, 600, 300, 120, 420, 30])
    ]
    names = [{"stop_id": f"S{i}", "stop_name": f"Stop {i}"} for i in range(6)]
    conn = FakeConn(_route_reliability_dispatch(weak=weak, names=names))

    out = build_route_reliability(conn, route_id="51")
    assert len(out.weak_stops) == 5  # capped at 5
    delays = [w.median_delay_min for w in out.weak_stops]
    assert delays == sorted(delays, reverse=True)  # descending
    # worst is S1 (600s -> 10.0 min); name resolved from dim_stop
    assert out.weak_stops[0].id == "S1"
    assert out.weak_stops[0].name == "Stop 1"
    assert out.weak_stops[0].median_delay_min == 10.0
    # the smallest (S5 = 30s -> 0.5 min) is dropped
    assert "S5" not in {w.id for w in out.weak_stops}


def test_build_route_reliability_no_dataset_version_still_builds() -> None:
    """No current static dataset -> scheduled headway empty, but periods/habits
    from gold rollups still populate (graceful degradation)."""
    conn = FakeConn(
        [
            ("dataset_kind = 'static_schedule'", []),  # no version
            (
                "public_route_reliability_daily",
                [{"d": datetime.date(2026, 6, 1), "obs": 100, "avg_delay_sec": 60.0, "severe": 4}],
            ),
            (
                "route_headway_daily",
                [{"shift": "am_peak", "observed_headway_min": 7.0, "sample_count": 9}],
            ),
        ]
    )
    out = build_route_reliability(conn, route_id="51")
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
    conn = FakeConn(
        [
            # by_route must be matched BEFORE the weekly aggregate, because both
            # SQLs contain 'stop_delay_weekly'; the by-route SQL is uniquely
            # identified by selecting route_id (GROUP BY stop_id, route_id).
            (
                "GROUP BY stop_id, route_id",
                [
                    {"stop_id": "S1", "route_id": "51", "obs": 100, "weighted_delay_sec": 6000.0},
                    {"stop_id": "S1", "route_id": "9", "obs": 50, "weighted_delay_sec": 9000.0},
                ],
            ),
            (
                "stop_delay_weekly",
                [
                    # S1: obs=150, severe=15 -> OTP 90; weighted 150*... avg
                    # weighted_delay_sec total 12000 over obs 150 -> 80s -> 1.3 min
                    {"stop_id": "S1", "obs": 150, "weighted_delay_sec": 12000.0, "severe": 15},
                ],
            ),
            (
                "stop_delay_monthly",
                [
                    # S1 monthly: obs=600, sev=30 -> OTP 95; 90000/600 = 150s -> 2.5
                    {"stop_id": "S1", "obs": 600, "weighted_delay_sec": 90000.0, "severe": 30},
                ],
            ),
        ]
    )

    out = build_stop_reliability(conn, provider_id="stm")

    assert "S1" in out
    s1 = out["S1"]
    assert isinstance(s1, StopReliability)
    assert s1.id == "S1"

    by_grain = {p.grain: p for p in s1.periods}
    assert [p.grain for p in s1.periods] == ["week", "month"]  # ordered week then month

    wk = by_grain["week"]
    assert wk.otp_pct == 90  # (150-15)/150
    assert wk.median_delay_min == 1.3  # 12000/150 = 80s -> 1.333 -> 1.3
    assert wk.severe_pct == 10.0  # 15/150

    mo = by_grain["month"]
    assert mo.otp_pct == 95  # (600-30)/600
    assert mo.median_delay_min == 2.5  # 90000/600 = 150s
    assert mo.severe_pct == 5.0  # 30/600

    # by_route natural-sorted: "9" before "51"
    assert [b.route for b in s1.by_route] == ["9", "51"]
    by_route = {b.route: b for b in s1.by_route}
    assert by_route["51"].median_delay_min == 1.0  # 6000/100 = 60s
    assert by_route["9"].median_delay_min == 3.0  # 9000/50 = 180s


def test_build_stop_reliability_weekly_only_stop() -> None:
    """A stop present only in the weekly view still produces a model (month absent)."""
    conn = FakeConn(
        [
            ("GROUP BY stop_id, route_id", []),
            (
                "stop_delay_weekly",
                [{"stop_id": "S2", "obs": 80, "weighted_delay_sec": 4800.0, "severe": 8}],
            ),
            ("stop_delay_monthly", []),
        ]
    )
    out = build_stop_reliability(conn)
    assert "S2" in out
    s2 = out["S2"]
    assert [p.grain for p in s2.periods] == ["week"]
    assert s2.periods[0].otp_pct == 90  # (80-8)/80
    assert s2.by_route == []
