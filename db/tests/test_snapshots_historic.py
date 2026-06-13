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
    _ROUTE_REL_MONTHLY_SQL,
    _ROUTE_REL_WEEKLY_SQL,
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
from transit_ops.snapshots.contract import (
    AlertHistory,
    Hotspots,
    NetworkTrend,
    Provenance,
    RepeatOffenders,
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
                                habit=None, weak=None, names=None, schedule=None,
                                route_names=None):
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
        # stop names (current-dim UNION history)
        ("stop_name", names or []),
        # route names (current-dim UNION history)
        ("DISTINCT ON (u.route_id)", route_names or []),
    ]


def test_build_route_reliability_periods_and_otp() -> None:
    conn = FakeConn(
        _route_reliability_dispatch(
            daily=[
                {
                    "d": datetime.date(2026, 6, 1),
                    "known_obs": 100,
                    "on_time": 90,
                    "avg_delay_sec": 90.0,  # -> 1.5 min
                    "severe": 10,
                },
            ],
            weekly=[
                {
                    "d": datetime.date(2026, 5, 25),
                    "known_obs": 100,
                    "on_time": 47,
                    "avg_delay_sec": 120.0,  # -> 2.0 min
                    "severe": 5,
                },
            ],
            monthly=[
                {
                    "d": datetime.date(2026, 5, 1),
                    "known_obs": 1000,
                    "on_time": None,
                    "avg_delay_sec": 150.0,  # -> 2.5 min
                    "severe": 50,  # -> 5.0%
                },
            ],
        )
    )

    out = build_route_reliability(conn, provider_id="stm", route_id="51", generated_utc="t")

    assert isinstance(out, RouteReliability)
    assert out.id == "51"
    by_grain = {p.grain: p for p in out.periods}
    assert set(by_grain) == {"day", "week", "month"}

    day = by_grain["day"]
    assert day.date == "2026-06-01"
    assert day.otp_pct == 90
    assert day.avg_delay_min == 1.5
    assert day.severe_pct == 10.0
    assert day.p50_min is None and day.p90_min is None  # deferred

    week = by_grain["week"]
    assert week.otp_pct == 47
    assert week.avg_delay_min == 2.0
    assert week.severe_pct == 5.0

    month = by_grain["month"]
    assert month.otp_pct is None
    assert month.avg_delay_min == 2.5
    assert month.severe_pct == 5.0


def test_route_reliability_sql_uses_real_otp_columns() -> None:
    assert "delay_observation_count AS known_obs" in str(_ROUTE_REL_DAILY_SQL)
    assert "on_time_observation_count AS on_time" in str(_ROUTE_REL_DAILY_SQL)
    for sql in (str(_ROUTE_REL_WEEKLY_SQL), str(_ROUTE_REL_MONTHLY_SQL)):
        assert "delay_observation_count AS known_obs" in sql
        assert "on_time_observation_count AS on_time" in sql
        assert "delayed_trip_count" not in sql


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

    out = build_route_reliability(conn, route_id="51", generated_utc="t")
    assert len(out.weak_stops) == 5  # capped at 5
    delays = [w.median_delay_min for w in out.weak_stops]
    assert delays == sorted(delays, reverse=True)  # descending
    # worst is S1 (600s -> 10.0 min); name resolved from dim_stop
    assert out.weak_stops[0].id == "S1"
    assert out.weak_stops[0].name == "Stop 1"
    assert out.weak_stops[0].median_delay_min == 10.0
    # the smallest (S5 = 30s -> 0.5 min) is dropped
    assert "S5" not in {w.id for w in out.weak_stops}


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
                "route_headway_daily",
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

    out = build_stop_reliability(conn, provider_id="stm", generated_utc="t")

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
    out = build_stop_reliability(conn, generated_utc="t")
    assert "S2" in out
    s2 = out["S2"]
    assert [p.grain for p in s2.periods] == ["week"]
    assert s2.periods[0].otp_pct == 90  # (80-8)/80
    assert s2.by_route == []


def test_build_stop_reliability_carries_name() -> None:
    """Per-stop files self-describe: name resolved current-dim-first with the
    history fallback; ids with no name anywhere stay None."""
    conn = FakeConn(
        [
            ("GROUP BY stop_id, route_id", []),
            (
                "stop_delay_weekly",
                [
                    {"stop_id": "S1", "obs": 150, "weighted_delay_sec": 12000.0, "severe": 15},
                    {"stop_id": "S_UNNAMED", "obs": 10, "weighted_delay_sec": 600.0, "severe": 0},
                ],
            ),
            ("stop_delay_monthly", []),
            ("DISTINCT ON (u.stop_id)", [{"stop_id": "S1", "stop_name": "Station Berri"}]),
        ]
    )

    out = build_stop_reliability(conn, provider_id="stm", generated_utc="t")

    assert out["S1"].name == "Station Berri"
    assert out["S_UNNAMED"].name is None


# --------------------------------------------------------------------------
# build_hotspots
# --------------------------------------------------------------------------


def test_build_hotspots_ranks_and_top_20() -> None:
    """Top-20 cap, rank assigned 1..N, week-period selected."""
    # 25 rows — only first 20 should appear (SQL LIMIT enforced by fake order)
    rows = [
        {
            "entity_kind": "stop",
            "entity_id": f"S{i}",
            "issue_count": 100 - i,
            "severity_label": "high",
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
    assert first.otp_delta_pts is None  # v1 deferral


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


# --------------------------------------------------------------------------
# build_repeat_offenders
# --------------------------------------------------------------------------


def test_build_repeat_offenders_recurrence_string() -> None:
    """recurrence field is formatted as '{recurrence_days}/{window_days}d'.

    gold.repeat_offender_daily only ever contains 'trip' and 'vehicle' kinds
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
    conn = FakeConn([("repeat_offender_daily", rows)])
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
    conn = FakeConn([("repeat_offender_daily", rows)])
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
    conn = FakeConn([("repeat_offender_daily", rows)])
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
            ("repeat_offender_daily", rows),
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
            # rows ordered DESC by avg_delay_seconds in SQL; first = worst
            worst_route=[
                {"d": d, "route_id": "105", "avg_delay_seconds": 300.0},
                {"d": d, "route_id": "51", "avg_delay_seconds": 120.0},
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
    assert r.worst_route.otp_delta_pts is None  # v1 deferral
    assert r.worst_stop is not None
    assert r.worst_stop.id == "9999"
    assert r.worst_stop.median_delay_min == 7.0  # 420s / 60


def test_receipts_worst_entity_order_has_deterministic_tiebreaker() -> None:
    route_sql = str(_RECEIPTS_WORST_ROUTE_SQL)
    stop_sql = str(_RECEIPTS_WORST_STOP_SQL)

    assert "avg_delay_seconds DESC, route_id" in route_sql
    assert "avg_delay_seconds DESC, stop_id" in stop_sql


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

    start = _dt.datetime(2026, 5, 1, 8, 0, 0, tzinfo=_dt.timezone.utc)
    end = _dt.datetime(2026, 5, 1, 10, 30, 0, tzinfo=_dt.timezone.utc)  # 150 min

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


def test_build_alert_history_200_cap() -> None:
    """SQL LIMIT 200 enforced — fake returns exactly 200 rows."""
    import datetime as _dt

    start = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
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

    loaded = _dt.datetime(2026, 6, 1, 12, 0, 0, tzinfo=_dt.timezone.utc)
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
    assert out.retention == {"detail_days": 14, "aggregate_days": 365}

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
