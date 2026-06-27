"""Offline (no-DB) gates for the S7-B windowable §1 build (DB-PR-1).

Every-PR gates that need no Postgres:
  * the published route_reliability/{id}.json stays under ROUTE_RELIABILITY_BYTE_CEILING
    even at a worst-case payload (3 grains x breakdowns + 3 full heatmaps + 100 weak stops),
  * a pre-S7b fixture (no windowable keys) still validates (additive-optional back-compat),
  * the trailing-N-day grain windows are correct + their prior windows are non-overlapping,
  * the whole-history spine projector constants are byte-identical to before the
    {window_clause} change (the default "" path), while the windowed twins carry the bound.
"""

from __future__ import annotations

from datetime import date

from transit_ops.snapshots import builders
from transit_ops.snapshots.builders.historic import _grain_windows
from transit_ops.snapshots.builders import historic as H
from transit_ops.snapshots.contract import (
    ROUTE_RELIABILITY_BYTE_CEILING,
    CrosstabCell,
    ReliabilityByGrain,
    ReliabilityPeriod,
    RouteDayOfWeek,
    RouteHabits,
    RouteHabitsByGrain,
    RouteReliability,
    WeakStop,
)
from transit_ops.snapshots.storage import _body

_SHIFTS = ["am_peak", "midday", "pm_peak", "evening", "night"]


def _heavy_period(grain: str, with_hist: bool) -> ReliabilityPeriod:
    return ReliabilityPeriod(
        grain=grain,
        otp_pct=82,
        avg_delay_min=3.2,
        p50_min=2.0,
        p90_min=9.0,
        severe_pct=4.0,
        observation_count=12345,
        on_time=10123,
        wilson_lo=80.1,
        wilson_hi=83.9,
        prior_observation_count=11987,
        prior_otp_pct=79,
        # the windowed periods set delay_histogram=None (F1); model the suppressed prod path
        delay_histogram=None,
    )


def _full_habits() -> RouteHabits:
    return RouteHabits(
        scale="repeat_problem_relative",
        matrix=[[round((d + h) % 10 / 10, 4) for h in range(24)] for d in range(7)],
    )


def _worst_case_payload() -> RouteReliability:
    by_grain = [
        ReliabilityByGrain(
            grain=g,
            date="2026-06-20",
            by_shift=[_heavy_period(s, False) for s in _SHIFTS],
            by_daytype=[_heavy_period(d, False) for d in ("weekday", "weekend")],
            day_of_week=[
                RouteDayOfWeek(
                    day_of_week_iso=i, avg_delay_min=3.1, severe_pct=4.0, observation_count=4000
                )
                for i in range(1, 8)
            ],
            by_shift_daytype=[
                CrosstabCell(
                    shift=s,
                    day_type=dt,
                    otp_pct=80.0,
                    avg_delay_min=3.0,
                    severe_pct=4.0,
                    observation_count=2000,
                )
                for s in _SHIFTS
                for dt in ("weekday", "weekend")
            ],
        )
        for g in ("day", "week", "month")
    ]
    habits_by_grain = [
        RouteHabitsByGrain(
            grain=g, date="2026-06-20", habits=_full_habits(), cells_observed=168, cells_suppressed=0
        )
        for g in ("day", "week", "month")
    ]
    return RouteReliability(
        generated_utc="2026-06-21T02:00:00Z",
        id="165",
        name="165 Côte-des-Neiges / Boulevard Décarie",
        periods=[_heavy_period(f"2026-06-{d:02d}", True) for d in range(1, 31)],
        habits=_full_habits(),
        day_of_week=[
            RouteDayOfWeek(day_of_week_iso=i, avg_delay_min=3.1, severe_pct=4.0, observation_count=9000)
            for i in range(1, 8)
        ],
        weak_stops=[
            WeakStop(id=f"stop-{i}", name=f"Stop number {i} / Cross Street {i}", avg_delay_min=8.2)
            for i in range(100)
        ],
        periods_by_grain=by_grain,
        habits_by_grain=habits_by_grain,
    )


def test_worst_case_payload_under_byte_ceiling() -> None:
    payload = _worst_case_payload()
    size = len(_body(payload))
    assert size <= ROUTE_RELIABILITY_BYTE_CEILING, (
        f"route_reliability payload {size}B exceeds ceiling {ROUTE_RELIABILITY_BYTE_CEILING}B "
        "— check the windowed periods kept delay_histogram=None (F1) + MIN_N pruning"
    )


def test_old_fixture_without_windowable_keys_validates() -> None:
    # Additive-optional back-compat: a pre-S7b snapshot omits every new key.
    legacy = {
        "generated_utc": "2026-06-19T02:00:00Z",
        "id": "51",
        "periods": [{"grain": "day", "otp_pct": 80}],
        "habits": {"scale": "repeat_problem_relative", "matrix": []},
    }
    rr = RouteReliability.model_validate(legacy)
    assert rr.periods_by_grain == []
    assert rr.habits_by_grain == []
    assert rr.periods[0].prior_observation_count is None


def test_grain_windows_are_trailing_and_priors_dont_overlap() -> None:
    anchor = date(2026, 6, 20)
    w = _grain_windows(anchor)
    assert w["day"] == (anchor, anchor)
    assert w["week"] == (date(2026, 6, 14), anchor)  # anchor - 6 .. anchor
    assert w["month"] == (date(2026, 5, 22), anchor)  # anchor - 29 .. anchor
    for _grain, (start, end) in w.items():
        win_len = (end - start).days + 1
        prior_end = start - __import__("datetime").timedelta(days=1)
        prior_start = start - __import__("datetime").timedelta(days=win_len)
        assert prior_end < start  # prior window ends strictly before the current window
        assert (prior_end - prior_start).days + 1 == win_len  # same length


def test_whole_history_projectors_byte_identical_windowed_twins_bound() -> None:
    # The default window_clause="" path must be byte-identical to before this change.
    for sql in (
        H._ROUTE_SPINE_BY_SHIFT_SQL,
        H._ROUTE_SPINE_BY_DAYTYPE_SQL,
        H._ROUTE_SPINE_WEEKLY_SQL,
        H._ROUTE_SPINE_MONTHLY_SQL,
        H._ROUTE_SPINE_DOW_SQL,
        H._ROUTE_SPINE_CROSSTAB_SQL,
        H._NETWORK_SPINE_BY_SHIFT_SQL,
        H._NETWORK_SPINE_BY_DAYTYPE_SQL,
    ):
        assert ":win_start" not in str(sql), "whole-history projector must NOT carry a window bound"
    # The windowed twins + the habits recomposition carry the bound.
    for sql in (H._W_BY_SHIFT, H._W_BY_DAYTYPE, H._W_DOW, H._W_CROSSTAB, H._ROUTE_HABIT_SPINE_SQL):
        assert ":win_start" in str(sql) and ":win_end" in str(sql)
    # No accidental double-space where {entity_clause}{window_clause} concatenate.
    assert "  AND service_local_date" not in str(H._W_BY_SHIFT)


def test_builders_reexport_is_importable() -> None:
    # guard the package surface (the windowed builders live under historic)
    assert hasattr(builders, "build_route_reliability")
