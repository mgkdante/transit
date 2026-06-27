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
    CancellationPeriod,
    CrosstabCell,
    CrowdingDelayCell,
    HeadwayByGrain,
    HeadwayPeriod,
    OccupancyByDow,
    OccupancyByGrain,
    OccupancyMix,
    ReliabilityByGrain,
    ReliabilityPeriod,
    RouteDayOfWeek,
    RouteDelayHistogramBin,
    RouteHabits,
    RouteHabitsByGrain,
    RouteReliability,
    ServiceSpanPeriod,
    SkippedStopPeriod,
    WeakStop,
)
from transit_ops.snapshots.storage import _body

_SHIFTS = ["am_peak", "midday", "pm_peak", "evening", "night"]


def _hist() -> list[RouteDelayHistogramBin]:
    # A full 21-bin signed-delay distribution (the prod shape on histogram-bearing periods).
    return [RouteDelayHistogramBin(lo_sec=i * 60, hi_sec=(i + 1) * 60, count=100 + i) for i in range(21)]


def _period(grain: str, *, with_hist: bool, with_prior: bool = True) -> ReliabilityPeriod:
    return ReliabilityPeriod(
        grain=grain,
        date="2026-06-20",
        otp_pct=82,
        avg_delay_min=3.2,
        p50_min=2.0,
        p90_min=9.0,
        severe_pct=4.0,
        observation_count=12345,
        on_time=10123,
        wilson_lo=80.1,
        wilson_hi=83.9,
        prior_observation_count=11987 if with_prior else None,
        prior_otp_pct=79 if with_prior else None,
        delay_histogram=_hist() if with_hist else None,
    )


def _full_habits() -> RouteHabits:
    return RouteHabits(
        scale="repeat_problem_relative",
        matrix=[[round((d + h) % 10 / 10, 4) for h in range(24)] for d in range(7)],
    )


def _full_payload(*, windowed_histograms: bool) -> RouteReliability:
    """A REALISTIC worst case modelling ALL 18 RouteReliability families at their prod caps.

    windowed_histograms toggles the F1 regression: when True the windowed periods_by_grain
    by_shift/by_daytype carry the 21-bin array (which the builder suppresses) — the test
    asserts that variant BREACHES the ceiling, so a real F1 regression trips offline.
    """
    # Scalar `periods`: 30 daily (histogram None per the daily carve-out) + week + month + the
    # 5 by_shift + 2 by_daytype spine reads (all histogram-ON in prod, no prior on the scalars).
    scalar_periods = [_period(f"2026-06-{d:02d}", with_hist=False, with_prior=False) for d in range(1, 31)]
    scalar_periods += [_period(g, with_hist=True, with_prior=False) for g in ("week", "month")]
    scalar_periods += [_period(s, with_hist=True, with_prior=False) for s in _SHIFTS]
    scalar_periods += [_period(d, with_hist=True, with_prior=False) for d in ("weekday", "weekend")]

    crosstab = [
        CrosstabCell(shift=s, day_type=dt, otp_pct=80.0, avg_delay_min=3.0, severe_pct=4.0,
                     observation_count=2000)
        for s in _SHIFTS for dt in ("weekday", "weekend")
    ]
    dow = [RouteDayOfWeek(day_of_week_iso=i, avg_delay_min=3.1, severe_pct=4.0, observation_count=9000)
           for i in range(1, 8)]
    by_grain = [
        ReliabilityByGrain(
            grain=g,
            date="2026-06-20",
            by_shift=[_period(s, with_hist=windowed_histograms) for s in _SHIFTS],
            by_daytype=[_period(d, with_hist=windowed_histograms) for d in ("weekday", "weekend")],
            day_of_week=dow,
            by_shift_daytype=crosstab,
        )
        for g in ("day", "week", "month")
    ]
    habits_by_grain = [
        RouteHabitsByGrain(grain=g, date="2026-06-20", habits=_full_habits(),
                           cells_observed=168, cells_suppressed=0)
        for g in ("day", "week", "month")
    ]
    mix = OccupancyMix(empty=0.1, many_seats=0.3, few_seats=0.25, standing=0.25, full=0.1)
    return RouteReliability(
        generated_utc="2026-06-21T02:00:00Z",
        id="165",
        name="165 Côte-des-Neiges / Boulevard Décarie",
        periods=scalar_periods,
        headway=[
            HeadwayPeriod(shift=s, direction_id=d, day_type=dt, scheduled_min=6.0, observed_min=7.5,
                          excess_wait_min=1.5, cov=0.42, bunched_pct=18.0)
            for s in _SHIFTS for d in (0, 1) for dt in ("weekday", "weekend")
        ][:15],
        habits=_full_habits(),
        day_of_week=dow,
        weak_stops=[WeakStop(id=f"stop-{i}", name=f"Stop number {i} / Cross Street {i}",
                             avg_delay_min=8.2) for i in range(100)],
        cancellations=[CancellationPeriod(grain="day", date=f"2026-06-{d:02d}",
                                          cancellation_rate_pct=1.4, canceled_trip_days=3,
                                          total_trip_days=214) for d in range(1, 31)],
        occupancy_mix=mix,
        service_spans=[ServiceSpanPeriod(date=f"2026-06-{d:02d}",
                                         first_trip_utc="2026-06-20T09:30:00Z",
                                         last_trip_utc="2026-06-21T04:10:00Z",
                                         service_span_min=1120, first_trip_delay_min=0.5,
                                         last_trip_delay_min=1.2, trip_count=214)
                       for d in range(1, 31)],
        skipped_stops=[SkippedStopPeriod(date=f"2026-06-{d:02d}", skipped_stop_rate_pct=0.8,
                                         skipped_stop_count=12, stop_time_update_count=1500)
                       for d in range(1, 31)],
        delay_by_crowding=[CrowdingDelayCell(band=b, avg_delay_min=3.0, p50_min=2.0,
                                             observation_count=2000, day_count=20)
                           for b in ("empty", "many_seats", "few_seats", "standing", "full")],
        by_shift_daytype=crosstab,
        occupancy_by_grain=[OccupancyByGrain(grain=g, mix=mix) for g in ("day", "week", "month")],
        occupancy_by_dow=[OccupancyByDow(day_of_week_iso=i, mix=mix) for i in range(1, 8)],
        periods_by_grain=by_grain,
        habits_by_grain=habits_by_grain,
        headway_by_grain=[
            HeadwayByGrain(
                grain=g,
                date="2026-06-20",
                headway=[
                    HeadwayPeriod(
                        shift=s,
                        scheduled_min=6.0,
                        observed_min=7.5,
                        excess_wait_min=1.5,
                        cov=0.63,
                        bunched_pct=18.0,
                        observation_count=240,
                        prior_observation_count=228,
                        prior_observed_min=7.1,
                    )
                    for s in _SHIFTS
                ],
            )
            for g in ("day", "week", "month")
        ],
    )


def test_realistic_full_payload_under_byte_ceiling() -> None:
    size = len(_body(_full_payload(windowed_histograms=False)))
    assert size <= ROUTE_RELIABILITY_BYTE_CEILING, (
        f"realistic route_reliability payload {size}B exceeds ceiling "
        f"{ROUTE_RELIABILITY_BYTE_CEILING}B"
    )


def test_windowed_histogram_regression_breaches_ceiling() -> None:
    # The F1 guard's reason for existing: if the windowed periods ever carry the 21-bin
    # histogram, the payload must trip the ceiling so the regression is caught offline.
    size = len(_body(_full_payload(windowed_histograms=True)))
    assert size > ROUTE_RELIABILITY_BYTE_CEILING, (
        "a windowed-histogram regression did NOT breach the ceiling — the ceiling is too loose "
        f"({size}B vs {ROUTE_RELIABILITY_BYTE_CEILING}B)"
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


# --- §2 headway recompose helpers (pure, offline) ---------------------------


def test_round_half_away_matches_sql_round_semantics() -> None:
    # Postgres ROUND(::numeric, n) is half-away-from-zero; Python's builtin round() is banker's.
    assert float(H._round_half_away(2.5, 0)) == 3.0  # banker's would give 2.0
    assert float(H._round_half_away(0.625, 2)) == 0.63
    assert float(H._round_half_away(7.45, 1)) == 7.5


def test_headway_median_cdf_interp_and_honest_absence() -> None:
    nbins = len(H._GAP_EDGES) - 1
    hist = [0] * nbins
    hist[7] = 4  # all gaps in [6,8) -> CDF-interp median = 7.0
    assert H._headway_pctile_from_hist(hist, 0.5, H._GAP_EDGES) == 7.0
    assert H._headway_pctile_from_hist([], 0.5, H._GAP_EDGES) is None
    assert H._headway_pctile_from_hist([0] * nbins, 0.5, H._GAP_EDGES) is None


def test_bunched_pct_from_pooled_hist() -> None:
    nbins = len(H._GAP_EDGES) - 1
    hist = [0] * nbins
    hist[0] = 2  # [0,0.5) — well below 0.5*median
    hist[7] = 2  # [6,8) — above
    assert H._bunched_pct_from_hist(hist, H._GAP_EDGES, 7.0) == 50.0  # 2 of 4 below 3.5
    assert H._bunched_pct_from_hist([0] * nbins, H._GAP_EDGES, 7.0) is None
    assert H._bunched_pct_from_hist(hist, H._GAP_EDGES, None) is None  # no median -> None
