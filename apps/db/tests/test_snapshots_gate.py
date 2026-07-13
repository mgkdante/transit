"""Pure-Python tests for the publish value gate (transit_ops.snapshots.gate).

No DB, no FakeConn — every case is a hand-built contract model or dict fed straight
to a checker / the report API. Covers: each range/invariant check, the universal
sentinel + NaN/Inf scan, honest-NULL passing clean, the batch-level coverage-delta +
empty-route aggregates, and enforce()/GateError semantics.
"""

from __future__ import annotations

import json

import pytest

from transit_ops.snapshots import gate
from transit_ops.snapshots.contract import (
    Alert,
    AlertActivePeriod,
    AlertHistory,
    AlertHistoryEntry,
    AlertsFile,
    CancellationPeriod,
    CrowdingDelayCell,
    DelayBucket,
    HeadwayPeriod,
    Hotspot,
    HotspotEntry,
    HotspotGrain,
    Hotspots,
    NetworkFile,
    NetworkTrend,
    NonRespondingRoute,
    OccupancyMix,
    Offender,
    Receipt,
    ReceiptNotReportedRoute,
    ReceiptServiceStates,
    ReceiptShiftCut,
    ReceiptsIndex,
    ReliabilityPeriod,
    RepeatOffenderEntry,
    RepeatOffenderGrain,
    RepeatOffenders,
    RouteHabits,
    RouteReliability,
    StatusDist,
    TrendPoint,
)
from transit_ops.snapshots.gate import Severity


def _errors(results):
    return [r for r in results if r.severity is Severity.ERROR]


def _warnings(results):
    return [r for r in results if r.severity is Severity.WARN]


def _checks(results):
    return {r.check for r in results}


def _has_err(results, check, needle=""):
    return any(r.check == check and needle in (r.field_path or "") for r in _errors(results))


# --- range checks ------------------------------------------------------------


def test_rate_over_100_is_error():
    net = NetworkFile(
        generated_utc="t",
        vehicles_in_service=10,
        on_time_pct=150,
        status_dist=StatusDist(),
        delay_p50_min=None,
        delay_p90_min=None,
        non_responding=0,
        feed_freshness_s=None,
        coverage_pct=50,
    )
    res = gate.check_network(net, rel_key="live/network.json")
    assert any(r.check == "rate_range" and r.field_path == "on_time_pct" for r in _errors(res))


def test_negative_count_is_error():
    net = NetworkFile(
        generated_utc="t",
        vehicles_in_service=-3,
        on_time_pct=90,
        status_dist=StatusDist(),
        delay_p50_min=None,
        delay_p90_min=None,
        non_responding=0,
        feed_freshness_s=None,
        coverage_pct=50,
    )
    res = gate.check_network(net, rel_key="live/network.json")
    assert _has_err(res, "count_negative", "vehicles_in_service")


def test_on_time_exceeds_observations_is_error():
    rr = RouteReliability(
        generated_utc="t",
        id="51",
        periods=[ReliabilityPeriod(grain="all", otp_pct=90, observation_count=100, on_time=120)],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert any(r.check == "invariant" and "on_time" in r.field_path for r in _errors(res))


def test_canceled_exceeds_total_is_error():
    rr = RouteReliability(
        generated_utc="t",
        id="51",
        cancellations=[
            CancellationPeriod(cancellation_rate_pct=10, canceled_trip_days=50, total_trip_days=10)
        ],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert _has_err(res, "invariant", "canceled_trip_days")


def test_cancellation_rate_over_100_is_error():
    rr = RouteReliability(
        generated_utc="t",
        id="51",
        cancellations=[
            CancellationPeriod(cancellation_rate_pct=150, canceled_trip_days=1, total_trip_days=2)
        ],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert _has_err(res, "rate_range", "cancellation_rate_pct")


# --- universal sentinel / NaN scan -------------------------------------------


def test_sentinel_in_habits_matrix_is_error():
    rr = RouteReliability(
        generated_utc="t",
        id="51",
        habits=RouteHabits(scale="repeat_problem_relative", matrix=[[0.5, 9999.9999]]),
    )
    res = gate.check_payload("historic/route_reliability/51.json", rr)
    assert any(r.check == "sentinel" for r in _errors(res))


def test_sentinel_in_rider_impact_score_is_error():
    rcpt = Receipt(generated_utc="t", date="2026-06-01", rider_impact_score=9999.9999)
    res = gate.check_payload("historic/receipts/2026-06-01.json", rcpt)
    assert _has_err(res, "sentinel", "rider_impact_score")


def test_nan_inf_leaf_is_error():
    # NaN cannot round-trip a contract model cleanly; feed a raw dict.
    payload = {"generated_utc": "t", "avg_delay_min": float("nan"), "otp_pct": float("inf")}
    res = gate.check_payload("historic/receipts/2026-06-01.json", payload)
    assert len([r for r in _errors(res) if r.check == "nan_inf"]) == 2


def test_large_legit_counts_are_not_sentinels():
    # Production leaves: a ~1.7M observation count and a ~108k-minute alert duration are
    # real values, not the 9999.9999 Numeric(8,4) overflow — the scan must NOT flag them.
    payload = {
        "generated_utc": "t",
        "observation_count": 1_776_905,
        "duration_min": 107_940.0,
        "also_int": 9999,  # exact-int 9999 is a legit count, never flagged
        "seven_day_alert": 9999.0,  # ~7-day alert duration in minutes — legit, not sentinel
    }
    res = gate.check_payload("historic/receipts/2026-06-01.json", payload)
    assert not any(r.check == "sentinel" for r in _errors(res))


def test_exact_9999_9999_float_is_sentinel():
    payload = {"generated_utc": "t", "rider_impact_score": 9999.9999}
    res = gate.check_payload("historic/receipts/2026-06-01.json", payload)
    assert _has_err(res, "sentinel", "rider_impact_score")


# --- S13 receipt re-granulation invariants -----------------------------------


def test_receipt_by_shift_out_of_range_rate_is_error():
    rcpt = Receipt(
        generated_utc="t",
        date="2026-06-01",
        by_shift=[
            ReceiptShiftCut(
                shift="am_peak",
                observation_count=10,
                severe_count=2,
                severe_pct=150.0,
                avg_delay_min=3.0,
            )
        ],
    )
    res = gate.check_payload("historic/receipts/2026-06-01.json", rcpt)
    assert _has_err(res, "rate_range", "by_shift[0].severe_pct")


def test_receipt_by_shift_negative_count_is_error():
    payload = {
        "generated_utc": "t",
        "date": "2026-06-01",
        "by_shift": [{"shift": "midday", "observation_count": -1}],
    }
    res = gate.check_payload("historic/receipts/2026-06-01.json", payload)
    assert _has_err(res, "count_negative", "by_shift[0].observation_count")


def test_receipt_service_states_out_of_range_completeness_is_error():
    rcpt = Receipt(
        generated_utc="t",
        date="2026-06-01",
        service_states=ReceiptServiceStates(scheduled_trip_days=10, service_completeness_pct=120.0),
    )
    res = gate.check_payload("historic/receipts/2026-06-01.json", rcpt)
    assert _has_err(res, "rate_range", "service_states.service_completeness_pct")


def test_receipt_not_reported_sentinel_is_error():
    payload = {
        "generated_utc": "t",
        "date": "2026-06-01",
        "service_states": {
            "scheduled_trip_days": 5,
            "not_reported_routes": [{"id": "__unrouted__", "scheduled_trip_days": 3}],
        },
    }
    res = gate.check_payload("historic/receipts/2026-06-01.json", payload)
    assert _has_err(res, "sentinel_entity", "service_states.not_reported_routes[0].id")


def test_receipt_service_states_honest_null_passes_clean():
    rcpt = Receipt(
        generated_utc="t",
        date="2026-06-01",
        service_states=ReceiptServiceStates(
            not_reported_routes=[ReceiptNotReportedRoute(id="747")]
        ),
    )
    res = gate.check_payload("historic/receipts/2026-06-01.json", rcpt)
    assert _errors(res) == []


def test_receipts_index_available_orphan_is_error():
    from transit_ops.snapshots.contract import ReceiptAvailability

    idx = ReceiptsIndex(
        generated_utc="t",
        dates=["2026-06-01"],
        available=[ReceiptAvailability(date="2026-06-02", has_data=True)],
    )
    res = gate.check_payload("historic/receipts/index.json", idx)
    assert _has_err(res, "availability_orphan", "available[0].date")


def test_receipts_index_available_subset_passes_clean():
    from transit_ops.snapshots.contract import ReceiptAvailability

    idx = ReceiptsIndex(
        generated_utc="t",
        dates=["2026-06-01", "2026-06-02"],
        available=[
            ReceiptAvailability(date="2026-06-01", has_data=True, has_schedule=True),
        ],
    )
    res = gate.check_payload("historic/receipts/index.json", idx)
    assert _errors(res) == []


def test_receipts_index_rejects_dates_out_of_ascending_order():
    idx = ReceiptsIndex(
        generated_utc="t",
        dates=["2026-06-02", "2026-06-01"],
    )

    res = gate.check_payload("historic/receipts/index.json", idx)

    assert _has_err(res, "date_order", "dates")


def test_receipts_index_rejects_duplicate_dates():
    idx = ReceiptsIndex(
        generated_utc="t",
        dates=["2026-06-01", "2026-06-01"],
    )

    res = gate.check_payload("historic/receipts/index.json", idx)

    assert _has_err(res, "date_duplicate", "dates")


def test_receipts_index_rejects_impossible_iso_calendar_date():
    idx = ReceiptsIndex(
        generated_utc="t",
        dates=["2026-02-30"],
    )

    res = gate.check_payload("historic/receipts/index.json", idx)

    assert _has_err(res, "date_format", "dates[0]")


# --- honest-NULL passes clean ------------------------------------------------


def test_all_none_payload_passes_clean():
    net = NetworkFile(
        generated_utc="t",
        vehicles_in_service=0,
        on_time_pct=None,
        status_dist=StatusDist(),
        delay_p50_min=None,
        delay_p90_min=None,
        occupancy_mix=None,
        non_responding=0,
        feed_freshness_s=None,
        coverage_pct=None,
        delay_histogram=None,
        non_responding_by_route=None,
    )
    res = gate.check_payload("live/network.json", net)
    assert _errors(res) == []


def test_fully_empty_route_file_passes_clean():
    rr = RouteReliability(generated_utc="t", id="51")
    res = gate.check_payload("historic/route_reliability/51.json", rr)
    assert _errors(res) == []


# --- network-specific invariants ---------------------------------------------


def test_non_responding_by_route_sum_mismatch_is_error():
    net = NetworkFile(
        generated_utc="t",
        vehicles_in_service=10,
        on_time_pct=90,
        status_dist=StatusDist(),
        delay_p50_min=None,
        delay_p90_min=None,
        non_responding=5,
        feed_freshness_s=None,
        coverage_pct=50,
        non_responding_by_route=[
            NonRespondingRoute(route_id="a", count=2),
            NonRespondingRoute(route_id="b", count=1),
        ],
    )
    res = gate.check_network(net, rel_key="live/network.json")
    assert any(r.check == "sum_mismatch" for r in _errors(res))


def test_delay_histogram_lo_gt_hi_is_error():
    net = NetworkFile(
        generated_utc="t",
        vehicles_in_service=10,
        on_time_pct=90,
        status_dist=StatusDist(),
        delay_p50_min=None,
        delay_p90_min=None,
        non_responding=0,
        feed_freshness_s=None,
        coverage_pct=50,
        delay_histogram=[DelayBucket(lo_min=5, hi_min=1, count=3)],
    )
    res = gate.check_network(net, rel_key="live/network.json")
    assert any(r.check == "edge_order" for r in _errors(res))


# --- hotspots ----------------------------------------------------------------


def test_hotspots_rank_gap_and_sentinel_id_are_errors():
    hs = Hotspots(
        generated_utc="t",
        hotspots=[
            Hotspot(rank=1, type="route", id="165"),
            Hotspot(rank=3, type="stop", id="__unknown_stop__"),  # rank gap + sentinel id
        ],
    )
    res = gate.check_hotspots(hs, rel_key="historic/hotspots.json")
    checks = _checks(_errors(res))
    assert "rank_sequence" in checks
    assert "sentinel_entity" in checks


def test_hotspots_by_grain_walks_entries_no_rank_sequence():
    """S12: the by_grain ladder is checked for range/sentinel/wilson, but NOT for
    sequential rank (ranked-then-truncated) — a non-1-based / gapped rank is fine."""
    hs = Hotspots(
        generated_utc="t",
        hotspots=[],
        by_grain=[
            HotspotGrain(
                grain="week",
                date="2026-06-14",
                window_end="2026-06-20",
                entries=[
                    # rank starts at 5 with a gap — must NOT trip rank_sequence inside a ladder.
                    HotspotEntry(
                        rank=5,
                        type="route",
                        id="51",
                        severe_pct=40.0,
                        wilson_lo=50.0,
                        wilson_hi=60.0,
                        observation_count=100,
                    ),
                    HotspotEntry(
                        rank=9,
                        type="stop",
                        id="S1",
                        severe_pct=70.0,
                        wilson_lo=16.8,
                        wilson_hi=30.0,
                        observation_count=80,
                    ),
                ],
                tray=[
                    HotspotEntry(
                        rank=None, type="stop", id="S2", severe_pct=5.0, observation_count=10
                    ),
                ],
            ),
        ],
    )
    res = gate.check_hotspots(hs, rel_key="historic/hotspots.json")
    assert not _errors(res), [r.check for r in _errors(res)]


def test_hotspots_by_grain_flags_bad_range_and_sentinel():
    """S12: an out-of-range severe_pct / a sentinel id / a bad otp_delta in a by_grain
    entry (or tray) still trips the shared checks."""
    hs = Hotspots(
        generated_utc="t",
        hotspots=[],
        by_grain=[
            HotspotGrain(
                grain="day",
                date="2026-06-20",
                window_end="2026-06-20",
                entries=[
                    HotspotEntry(
                        rank=1,
                        type="route",
                        id="__unrouted__",
                        severe_pct=140.0,
                        otp_delta_pts=-999.0,
                    ),
                ],
                tray=[
                    HotspotEntry(rank=None, type="stop", id="S1", severe_pct=-3.0),
                ],
            ),
        ],
    )
    res = gate.check_hotspots(hs, rel_key="historic/hotspots.json")
    checks = _checks(_errors(res))
    assert "sentinel_entity" in checks
    assert "rate_range" in checks


# --- repeat offenders --------------------------------------------------------


def test_repeat_offenders_by_grain_walks_entries_no_rank_sequence():
    """S14: the by_grain recurrence ladder is checked for range/sentinel/wilson/count, but NOT
    for sequential rank (ranked-then-truncated PER KIND) — a non-1-based / gapped rank is fine."""
    ro = RepeatOffenders(
        generated_utc="t",
        offenders=[],
        by_grain=[
            RepeatOffenderGrain(
                grain="week",
                window_days=7,
                entries=[
                    RepeatOffenderEntry(
                        rank=5,
                        type="trip",
                        id="T1",
                        route="51",
                        severe_pct=40.0,
                        wilson_lo=50.0,
                        wilson_hi=60.0,
                        observation_count=100,
                        severe_count=40,
                        recurrence_days=6,
                        observed_days=7,
                    ),
                    RepeatOffenderEntry(
                        rank=9,
                        type="vehicle",
                        id="V1",
                        route="51",
                        severe_pct=70.0,
                        wilson_lo=16.8,
                        wilson_hi=30.0,
                        observation_count=80,
                        severe_count=56,
                        recurrence_days=5,
                        observed_days=6,
                    ),
                ],
                tray=[
                    RepeatOffenderEntry(
                        rank=None,
                        type="trip",
                        id="T2",
                        severe_pct=5.0,
                        observation_count=10,
                        recurrence_days=2,
                    ),
                ],
            ),
        ],
    )
    res = gate.check_repeat_offenders(ro, rel_key="historic/repeat_offenders.json")
    assert not _errors(res), [r.check for r in _errors(res)]


def test_repeat_offenders_by_grain_flags_bad_range_type_and_sentinel():
    """S14: an out-of-range severe_pct / a non-{trip,vehicle} type / a sentinel id/route / a
    negative count in a by_grain entry (or tray) still trips the shared checks."""
    ro = RepeatOffenders(
        generated_utc="t",
        offenders=[],
        by_grain=[
            RepeatOffenderGrain(
                grain="month",
                window_days=30,
                entries=[
                    RepeatOffenderEntry(
                        rank=1,
                        type="route",
                        id="__unrouted__",
                        route="__unrouted__",
                        severe_pct=140.0,
                        recurrence_days=-1,
                    ),
                ],
                tray=[
                    RepeatOffenderEntry(rank=None, type="vehicle", id="V1", severe_pct=-3.0),
                ],
            ),
        ],
    )
    res = gate.check_repeat_offenders(ro, rel_key="historic/repeat_offenders.json")
    checks = _checks(_errors(res))
    assert "unknown_type" in checks  # 'route' is not a by_grain offender kind
    assert "sentinel_entity" in checks  # id + route are sentinels
    assert "rate_range" in checks  # 140.0 and -3.0 severe_pct
    assert "count_negative" in checks  # recurrence_days = -1


def test_repeat_offenders_scalar_still_accepts_route_stop_and_flags_sentinels():
    """S14: the SCALAR offenders[] retains its broader trip|vehicle|route|stop type set and its
    sentinel + additive recurrence_days count check (additive twin, not a regression)."""
    ro = RepeatOffenders(
        generated_utc="t",
        offenders=[
            Offender(
                type="trip",
                id="T1",
                route="51",
                recurrence="3/14d",
                recurrence_days=3,
                window_days=14,
                avg_delay_min=2.0,
                severity="watch",
            ),
            Offender(
                type="vehicle", id="__unknown_stop__", route="__unrouted__"
            ),  # sentinel id+route
        ],
    )
    res = gate.check_repeat_offenders(ro, rel_key="historic/repeat_offenders.json")
    checks = _checks(_errors(res))
    assert "sentinel_entity" in checks


# --- crowding + headway + alert history --------------------------------------


def test_crowding_unknown_band_is_error():
    rr = RouteReliability(
        generated_utc="t",
        id="51",
        delay_by_crowding=[CrowdingDelayCell(band="jammed", avg_delay_min=1.0)],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert any(r.check == "unknown_band" for r in _errors(res))


def test_negative_excess_wait_min_is_error():
    rr = RouteReliability(
        generated_utc="t",
        id="51",
        headway=[HeadwayPeriod(shift="am_peak", excess_wait_min=-2.0)],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert any(r.check == "clamp_invariant" for r in _errors(res))


def test_negative_alert_duration_is_error():
    ah = AlertHistory(
        generated_utc="t",
        alerts=[
            AlertHistoryEntry(id="a1", duration_min=-5.0),
        ],
    )
    res = gate.check_alert_history(ah, rel_key="historic/alert_history.json")
    assert _has_err(res, "count_negative", "duration_min")


# --- S15: alert-history window + active_periods + byte ceiling gates ----------


def test_alert_history_window_out_of_order_is_error():
    ah = AlertHistory(generated_utc="t", window_start="2026-07-01", window_end="2026-06-01")
    res = gate.check_alert_history(ah, rel_key="historic/alert_history.json")
    assert _has_err(res, "window_order", "window_start")


def test_alert_history_truncated_total_below_emitted_is_error():
    ah = AlertHistory(
        generated_utc="t",
        alerts=[AlertHistoryEntry(id="a1"), AlertHistoryEntry(id="a2")],
        total_in_window=1,  # < 2 emitted while truncated -> impossible
        truncated=True,
    )
    res = gate.check_alert_history(ah, rel_key="historic/alert_history.json")
    assert _has_err(res, "window_total", "total_in_window")


def test_alert_history_active_period_out_of_order_is_error():
    ah = AlertHistory(
        generated_utc="t",
        alerts=[
            AlertHistoryEntry(
                id="a1",
                active_periods=[
                    AlertActivePeriod(
                        start_utc="2026-06-01T10:00:00Z", end_utc="2026-06-01T08:00:00Z"
                    ),
                ],
            ),
        ],
    )
    res = gate.check_alert_history(ah, rel_key="historic/alert_history.json")
    assert _has_err(res, "window_order", "active_periods[0].start_utc")


def test_alert_history_well_ordered_window_and_periods_pass():
    ah = AlertHistory(
        generated_utc="t",
        window_start="2026-04-02",
        window_end="2026-07-01",
        alerts=[
            AlertHistoryEntry(
                id="a1",
                url="https://x",
                active_periods=[
                    AlertActivePeriod(
                        start_utc="2026-06-01T08:00:00Z", end_utc="2026-06-01T10:00:00Z"
                    ),
                    AlertActivePeriod(
                        start_utc="2026-06-08T08:00:00Z", end_utc=None
                    ),  # open-ended OK
                ],
            )
        ],
        total_in_window=1,
        truncated=False,
    )
    res = gate.check_alert_history(ah, rel_key="historic/alert_history.json")
    assert not _errors(res)


def test_alert_history_over_byte_ceiling_is_error():
    # A synthetic runaway: enough wide entries to blow past 512 KiB.
    from transit_ops.snapshots.contract import ALERT_HISTORY_BYTE_CEILING

    wide = "x" * 400
    ah = AlertHistory(
        generated_utc="t",
        alerts=[
            AlertHistoryEntry(id=f"a{i}", header_text=wide, header_text_en=wide, url=wide)
            for i in range(1000)
        ],
    )
    assert len(ah.model_dump_json().encode("utf-8")) > ALERT_HISTORY_BYTE_CEILING
    res = gate.check_alert_history(ah, rel_key="historic/alert_history.json")
    assert _has_err(res, "byte_ceiling")


def test_live_alerts_active_period_out_of_order_is_error():
    af = AlertsFile(
        generated_utc="t",
        alerts=[
            Alert(
                id="a1",
                severity="watch",
                header_key="H",
                active_periods=[
                    AlertActivePeriod(
                        start_utc="2026-06-01T10:00:00Z", end_utc="2026-06-01T08:00:00Z"
                    ),
                ],
            ),
        ],
    )
    res = gate.check_alerts(af, rel_key="live/alerts.json")
    assert _has_err(res, "window_order", "active_periods[0].start_utc")


def test_habits_cell_above_one_is_error():
    rr = RouteReliability(
        generated_utc="t",
        id="51",
        habits=RouteHabits(scale="repeat_problem_relative", matrix=[[0.5, 1.5]]),
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert any(r.check == "habits_range" for r in _errors(res))


# --- occupancy-mix sum drift = WARN ------------------------------------------


def test_mix_sum_drift_is_warn_not_error():
    # buckets all in [0,1] but sum = 0.5 -> WARN, not ERROR.
    trend = NetworkTrend(
        generated_utc="t",
        series=[
            TrendPoint(
                date="2026-06-01",
                otp_pct=90,
                occupancy_mix=OccupancyMix(
                    empty=0.1, many_seats=0.1, few_seats=0.1, standing=0.1, full=0.1
                ),
            ),
        ],
    )
    res = gate.check_network_trend(trend, rel_key="historic/network_trend.json")
    assert any(r.check == "mix_sum" for r in _warnings(res))
    assert not any(r.check == "mix_bucket" for r in _errors(res))


def test_mix_bucket_out_of_range_is_error():
    trend = NetworkTrend(
        generated_utc="t",
        series=[
            TrendPoint(
                date="2026-06-01",
                otp_pct=90,
                occupancy_mix=OccupancyMix(
                    empty=1.5, many_seats=0.0, few_seats=0.0, standing=0.0, full=0.0
                ),
            ),
        ],
    )
    res = gate.check_network_trend(trend, rel_key="historic/network_trend.json")
    assert any(r.check == "mix_bucket" for r in _errors(res))


# --- empty network_trend series: WARN (no prior) / ERROR (prior exists) ------


def test_empty_network_trend_series_no_longer_errors_per_file():
    # The per-file checker no longer decides emptiness (prior state is unknown there);
    # it emits neither an ERROR nor a WARN — the decision is routed through finalize_batch.
    trend = NetworkTrend(generated_utc="t", series=[])
    res = gate.check_network_trend(trend, rel_key="historic/network_trend.json")
    assert not any(r.check == "empty_coverage" for r in res)


def test_empty_network_trend_is_warn_on_first_publish():
    trend = NetworkTrend(generated_utc="t", series=[])
    finding = gate.check_network_trend_coverage(
        trend,
        rel_key="historic/network_trend.json",
        has_prior=False,
        has_realtime_payloads=True,
    )
    assert finding is not None
    assert finding.check == "empty_coverage" and finding.severity is Severity.WARN


def test_empty_network_trend_is_error_when_prior_and_realtime_exist():
    trend = NetworkTrend(generated_utc="t", series=[])
    finding = gate.check_network_trend_coverage(
        trend,
        rel_key="historic/network_trend.json",
        has_prior=True,
        has_realtime_payloads=True,
    )
    assert finding is not None
    assert finding.check == "empty_coverage" and finding.severity is Severity.ERROR


def test_empty_network_trend_is_warn_for_static_only_provider():
    # The 2026-07-02 sto/octranspo incident shape: prior publish state exists but
    # the batch carries ZERO route reliability files (no realtime worker yet) —
    # expected emptiness must not redden the daily workflow.
    trend = NetworkTrend(generated_utc="t", series=[])
    finding = gate.check_network_trend_coverage(
        trend,
        rel_key="historic/network_trend.json",
        has_prior=True,
        has_realtime_payloads=False,
    )
    assert finding is not None
    assert finding.check == "empty_coverage" and finding.severity is Severity.WARN
    assert "static-only" in finding.message


def test_nonempty_network_trend_yields_no_coverage_finding():
    trend = NetworkTrend(generated_utc="t", series=[TrendPoint(date="2026-06-01", otp_pct=90)])
    assert (
        gate.check_network_trend_coverage(
            trend,
            rel_key="historic/network_trend.json",
            has_prior=True,
            has_realtime_payloads=True,
        )
        is None
    )


def test_finalize_batch_routes_empty_trend_by_prior_and_batch_shape():
    # WARN when prior_files_total is None (first publish); ERROR only when a prior
    # exists AND the batch carries realtime-derived route files; WARN again for the
    # static-only shape (prior exists, zero route files — the sto/octranspo case).
    route_files = [
        (
            "historic/route_reliability/1.json",
            RouteReliability(
                generated_utc="t", id="1", periods=[ReliabilityPeriod(grain="all", otp_pct=90)]
            ),
        )
    ]

    warn_report = gate.new_report("stm", "historic", "t")
    gate.finalize_batch(
        warn_report,
        network_trend=("historic/network_trend.json", NetworkTrend(generated_utc="t", series=[])),
        prior_files_total=None,
        route_payloads=route_files,
    )
    assert any(r.check == "empty_coverage" for r in warn_report.warnings)
    assert warn_report.errors == []

    err_report = gate.new_report("stm", "historic", "t")
    gate.finalize_batch(
        err_report,
        network_trend=("historic/network_trend.json", NetworkTrend(generated_utc="t", series=[])),
        prior_files_total=9000,
        route_payloads=route_files,
    )
    assert any(r.check == "empty_coverage" for r in err_report.errors)

    static_only = gate.new_report("sto", "historic", "t")
    gate.finalize_batch(
        static_only,
        network_trend=("historic/network_trend.json", NetworkTrend(generated_utc="t", series=[])),
        prior_files_total=7,
        route_payloads=[],
    )
    assert any(r.check == "empty_coverage" for r in static_only.warnings)
    assert static_only.errors == []


# --- coverage-delta ----------------------------------------------------------


def test_coverage_delta_shrink_is_error():
    r = gate.check_route_coverage_delta(60, 100)  # 60 < 100*0.7 -> ERROR
    assert r is not None and r.severity is Severity.ERROR and r.check == "coverage_delta"


def test_coverage_delta_first_publish_is_skipped():
    assert gate.check_route_coverage_delta(1, None) is None
    assert gate.check_route_coverage_delta(1, 0) is None


def test_coverage_delta_small_drop_passes():
    assert gate.check_route_coverage_delta(80, 100) is None  # 20% < 30% threshold


# --- over-half-empty route set = WARN ----------------------------------------


def test_over_half_empty_route_set_is_warn():
    report = gate.new_report("stm", "historic", "t")
    empty = RouteReliability(generated_utc="t", id="a")
    full = RouteReliability(
        generated_utc="t", id="b", periods=[ReliabilityPeriod(grain="all", otp_pct=90)]
    )
    route_payloads = [
        ("historic/route_reliability/a.json", empty),
        ("historic/route_reliability/c.json", RouteReliability(generated_utc="t", id="c")),
        ("historic/route_reliability/b.json", full),
    ]  # 2 of 3 empty -> > 50%
    gate.finalize_batch(
        report, route_payloads=route_payloads, current_total=3, prior_files_total=None
    )
    assert any(r.check == "empty_route_ratio" for r in report.warnings)
    assert report.errors == []


# --- trip-id drift detector (GC2 DECISIONS #12) ------------------------------


def _route_with_cancellations(rid, rows):
    """A RouteReliability carrying (scheduled, total) cancellation rows."""
    return RouteReliability(
        generated_utc="t",
        id=rid,
        cancellations=[
            CancellationPeriod(
                grain="day",
                date=f"2026-06-{i + 1:02d}",
                scheduled_trip_days=sched,
                total_trip_days=total,
            )
            for i, (sched, total) in enumerate(rows)
        ],
    )


def test_id_drift_none_when_no_scheduled_days():
    # All-NULL scheduled -> nothing to measure -> None (honest-unknown, never a WARN).
    payloads = [
        (
            "historic/route_reliability/a.json",
            _route_with_cancellations("a", [(None, 5), (None, 3)]),
        )
    ]
    assert gate.check_id_drift(payloads) is None


def test_id_drift_below_threshold_is_clean():
    # 20 scheduled route-days, 1 overshoot -> 5% == threshold (not > it) -> no WARN.
    rows = [(10, 12)] + [(10, 5)] * 19
    payloads = [("historic/route_reliability/a.json", _route_with_cancellations("a", rows))]
    assert gate.check_id_drift(payloads) is None


def test_id_drift_above_threshold_is_warn():
    # 10 scheduled route-days, 2 overshoots -> 20% > 5% -> WARN.
    rows = [(10, 12), (10, 15)] + [(10, 5)] * 8
    payloads = [("historic/route_reliability/a.json", _route_with_cancellations("a", rows))]
    finding = gate.check_id_drift(payloads)
    assert finding is not None
    assert finding.severity is Severity.WARN
    assert finding.check == "id_drift"


def test_finalize_batch_emits_id_drift_warn():
    report = gate.new_report("stm", "historic", "t")
    rows = [(10, 12), (10, 15)] + [(10, 5)] * 8  # 20% overshoot
    route_payloads = [("historic/route_reliability/a.json", _route_with_cancellations("a", rows))]
    gate.finalize_batch(
        report, route_payloads=route_payloads, current_total=1, prior_files_total=None
    )
    assert any(r.check == "id_drift" for r in report.warnings)
    assert report.errors == []


# --- enforce / GateError -----------------------------------------------------


def test_enforce_force_true_with_errors_does_not_raise():
    report = gate.new_report("stm", "historic", "t")
    report.results.append(
        gate.CheckResult(
            check="rate_range",
            kind="k",
            rel_key="r",
            severity=Severity.ERROR,
            message="bad",
        )
    )
    gate.enforce(report, force=True)  # must NOT raise


def test_enforce_force_false_with_errors_raises():
    report = gate.new_report("stm", "historic", "t")
    report.results.append(
        gate.CheckResult(
            check="rate_range",
            kind="k",
            rel_key="r",
            severity=Severity.ERROR,
            message="bad",
        )
    )
    with pytest.raises(gate.GateError):
        gate.enforce(report, force=False)


def test_enforce_clean_report_does_not_raise():
    report = gate.new_report("stm", "historic", "t")
    gate.enforce(report, force=False)  # no findings -> no raise
    assert report.passed


# --- S11 data-health -----------------------------------------------------------


def _data_health(lanes=None, feeds=None):
    from transit_ops.snapshots.contract import DataHealth

    return DataHealth(generated_utc="t", lanes=lanes or [], feeds=feeds or [])


def test_data_health_clean_payload_passes():
    from transit_ops.snapshots.contract import DataHealthFeed, DataHealthGate, LaneHealth

    dh = _data_health(
        lanes=[
            LaneHealth(
                lane="live",
                last_publish_utc="t",
                age_s=57,
                files_written=6,
                files_skipped=0,
                files_total=6,
                gate=DataHealthGate(checks_run=6, errors=0, warnings=1, verdict="warn"),
            ),
            LaneHealth(lane="rollup"),  # honest-null lane, no findings
        ],
        feeds=[DataHealthFeed(feed="trip_updates", status="fresh", age_s=30)],
    )
    res = gate.check_payload("status/data_health.json", dh)
    assert _errors(res) == []


def test_data_health_negative_age_is_error():
    from transit_ops.snapshots.contract import LaneHealth

    dh = _data_health(lanes=[LaneHealth(lane="live", age_s=-5)])
    res = gate.check_payload("status/data_health.json", dh)
    assert _has_err(res, "count_negative", "lanes[0].age_s")


def test_data_health_negative_gate_count_is_error():
    from transit_ops.snapshots.contract import DataHealthGate, LaneHealth

    dh = _data_health(lanes=[LaneHealth(lane="static", gate=DataHealthGate(errors=-1))])
    res = gate.check_payload("status/data_health.json", dh)
    assert _has_err(res, "count_negative", "lanes[0].gate.errors")


def test_data_health_unknown_verdict_is_error():
    from transit_ops.snapshots.contract import DataHealthGate, LaneHealth

    dh = _data_health(lanes=[LaneHealth(lane="live", gate=DataHealthGate(verdict="green"))])
    res = gate.check_payload("status/data_health.json", dh)
    assert _has_err(res, "unknown_verdict", "lanes[0].gate.verdict")


def test_data_health_negative_feed_age_is_error():
    from transit_ops.snapshots.contract import DataHealthFeed

    dh = _data_health(feeds=[DataHealthFeed(feed="alerts", age_s=-3)])
    res = gate.check_payload("status/data_health.json", dh)
    assert _has_err(res, "count_negative", "feeds[0].age_s")


def test_data_health_byte_ceiling_is_error():
    from transit_ops.snapshots.contract import (
        DATA_HEALTH_BYTE_CEILING,
        DataHealthFeed,
    )

    # Overflow the ceiling with a runaway feed list (each feed name long).
    big = _data_health(
        feeds=[DataHealthFeed(feed="f" * 200, status="fresh", age_s=1) for _ in range(200)]
    )
    assert gate._payload_bytes(big) > DATA_HEALTH_BYTE_CEILING
    res = gate.check_payload("status/data_health.json", big)
    assert _has_err(res, "byte_ceiling")


# --- report round-trip -------------------------------------------------------


def test_gate_report_to_dict_round_trips_json():
    report = gate.new_report("stm", "historic", "2026-06-01T00:00:00Z")
    # An out-of-range rate is a per-file ERROR the round-trip can assert on.
    gate.record(
        report,
        "historic/network_trend.json",
        NetworkTrend(generated_utc="t", series=[TrendPoint(date="2026-06-01", otp_pct=150)]),
    )
    d = report.to_dict()
    parsed = json.loads(json.dumps(d))
    assert parsed["provider_id"] == "stm"
    assert parsed["tier"] == "historic"
    assert parsed["payloads_checked"] == 1
    assert parsed["errors"] >= 1  # otp_pct=150 -> rate_range ERROR
    assert isinstance(parsed["results"], list)


def test_gate_report_records_sorted_canonical_payload_sha256_receipts():
    from transit_ops.snapshots.serialization import snapshot_sha256

    report = gate.new_report("stm", "historic", "2026-06-01T00:00:00Z")
    private_payload = {"generated_utc": "t", "secret": "must-not-leak", "z": 1}
    receipt = Receipt(generated_utc="t", date="2026-06-01")

    gate.record(report, "historic/z.json", private_payload)
    gate.record(report, "historic/receipts/2026-06-01.json", receipt)

    expected = {
        "historic/receipts/2026-06-01.json": snapshot_sha256(receipt),
        "historic/z.json": snapshot_sha256(private_payload),
    }
    payload_sha256 = report.to_dict()["payload_sha256"]
    assert payload_sha256 == expected
    assert list(payload_sha256) == sorted(expected)
    assert "must-not-leak" not in json.dumps(payload_sha256)
