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
    AlertHistory,
    AlertHistoryEntry,
    CancellationPeriod,
    CrowdingDelayCell,
    DelayBucket,
    HeadwayPeriod,
    Hotspot,
    Hotspots,
    NetworkFile,
    NetworkTrend,
    NonRespondingRoute,
    OccupancyMix,
    Receipt,
    ReliabilityPeriod,
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
    return any(
        r.check == check and needle in (r.field_path or "") for r in _errors(results)
    )


# --- range checks ------------------------------------------------------------


def test_rate_over_100_is_error():
    net = NetworkFile(
        generated_utc="t", vehicles_in_service=10, on_time_pct=150,
        status_dist=StatusDist(), delay_p50_min=None, delay_p90_min=None,
        non_responding=0, feed_freshness_s=None, coverage_pct=50,
    )
    res = gate.check_network(net, rel_key="live/network.json")
    assert any(r.check == "rate_range" and r.field_path == "on_time_pct" for r in _errors(res))


def test_negative_count_is_error():
    net = NetworkFile(
        generated_utc="t", vehicles_in_service=-3, on_time_pct=90,
        status_dist=StatusDist(), delay_p50_min=None, delay_p90_min=None,
        non_responding=0, feed_freshness_s=None, coverage_pct=50,
    )
    res = gate.check_network(net, rel_key="live/network.json")
    assert _has_err(res, "count_negative", "vehicles_in_service")


def test_on_time_exceeds_observations_is_error():
    rr = RouteReliability(
        generated_utc="t", id="51",
        periods=[ReliabilityPeriod(grain="all", otp_pct=90, observation_count=100, on_time=120)],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert any(r.check == "invariant" and "on_time" in r.field_path for r in _errors(res))


def test_canceled_exceeds_total_is_error():
    rr = RouteReliability(
        generated_utc="t", id="51",
        cancellations=[
            CancellationPeriod(cancellation_rate_pct=10, canceled_trip_days=50, total_trip_days=10)
        ],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert _has_err(res, "invariant", "canceled_trip_days")


def test_cancellation_rate_over_100_is_error():
    rr = RouteReliability(
        generated_utc="t", id="51",
        cancellations=[
            CancellationPeriod(cancellation_rate_pct=150, canceled_trip_days=1, total_trip_days=2)
        ],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert _has_err(res, "rate_range", "cancellation_rate_pct")


# --- universal sentinel / NaN scan -------------------------------------------


def test_sentinel_in_habits_matrix_is_error():
    rr = RouteReliability(
        generated_utc="t", id="51",
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
        "also_int": 9999,        # exact-int 9999 is a legit count, never flagged
        "seven_day_alert": 9999.0,  # ~7-day alert duration in minutes — legit, not sentinel
    }
    res = gate.check_payload("historic/receipts/2026-06-01.json", payload)
    assert not any(r.check == "sentinel" for r in _errors(res))


def test_exact_9999_9999_float_is_sentinel():
    payload = {"generated_utc": "t", "rider_impact_score": 9999.9999}
    res = gate.check_payload("historic/receipts/2026-06-01.json", payload)
    assert _has_err(res, "sentinel", "rider_impact_score")


# --- honest-NULL passes clean ------------------------------------------------


def test_all_none_payload_passes_clean():
    net = NetworkFile(
        generated_utc="t", vehicles_in_service=0, on_time_pct=None,
        status_dist=StatusDist(), delay_p50_min=None, delay_p90_min=None,
        occupancy_mix=None, non_responding=0, feed_freshness_s=None, coverage_pct=None,
        delay_histogram=None, non_responding_by_route=None,
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
        generated_utc="t", vehicles_in_service=10, on_time_pct=90,
        status_dist=StatusDist(), delay_p50_min=None, delay_p90_min=None,
        non_responding=5, feed_freshness_s=None, coverage_pct=50,
        non_responding_by_route=[
            NonRespondingRoute(route_id="a", count=2),
            NonRespondingRoute(route_id="b", count=1),
        ],
    )
    res = gate.check_network(net, rel_key="live/network.json")
    assert any(r.check == "sum_mismatch" for r in _errors(res))


def test_delay_histogram_lo_gt_hi_is_error():
    net = NetworkFile(
        generated_utc="t", vehicles_in_service=10, on_time_pct=90,
        status_dist=StatusDist(), delay_p50_min=None, delay_p90_min=None,
        non_responding=0, feed_freshness_s=None, coverage_pct=50,
        delay_histogram=[DelayBucket(lo_min=5, hi_min=1, count=3)],
    )
    res = gate.check_network(net, rel_key="live/network.json")
    assert any(r.check == "edge_order" for r in _errors(res))


# --- hotspots ----------------------------------------------------------------


def test_hotspots_rank_gap_and_sentinel_id_are_errors():
    hs = Hotspots(generated_utc="t", hotspots=[
        Hotspot(rank=1, type="route", id="165"),
        Hotspot(rank=3, type="stop", id="__unknown_stop__"),  # rank gap + sentinel id
    ])
    res = gate.check_hotspots(hs, rel_key="historic/hotspots.json")
    checks = _checks(_errors(res))
    assert "rank_sequence" in checks
    assert "sentinel_entity" in checks


# --- crowding + headway + alert history --------------------------------------


def test_crowding_unknown_band_is_error():
    rr = RouteReliability(
        generated_utc="t", id="51",
        delay_by_crowding=[CrowdingDelayCell(band="jammed", avg_delay_min=1.0)],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert any(r.check == "unknown_band" for r in _errors(res))


def test_negative_excess_wait_min_is_error():
    rr = RouteReliability(
        generated_utc="t", id="51",
        headway=[HeadwayPeriod(shift="am_peak", excess_wait_min=-2.0)],
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert any(r.check == "clamp_invariant" for r in _errors(res))


def test_negative_alert_duration_is_error():
    ah = AlertHistory(generated_utc="t", alerts=[
        AlertHistoryEntry(id="a1", duration_min=-5.0),
    ])
    res = gate.check_alert_history(ah, rel_key="historic/alert_history.json")
    assert _has_err(res, "count_negative", "duration_min")


def test_habits_cell_above_one_is_error():
    rr = RouteReliability(
        generated_utc="t", id="51",
        habits=RouteHabits(scale="repeat_problem_relative", matrix=[[0.5, 1.5]]),
    )
    res = gate.check_route_reliability(rr, rel_key="historic/route_reliability/51.json")
    assert any(r.check == "habits_range" for r in _errors(res))


# --- occupancy-mix sum drift = WARN ------------------------------------------


def test_mix_sum_drift_is_warn_not_error():
    # buckets all in [0,1] but sum = 0.5 -> WARN, not ERROR.
    trend = NetworkTrend(generated_utc="t", series=[
        TrendPoint(date="2026-06-01", otp_pct=90,
                   occupancy_mix=OccupancyMix(empty=0.1, many_seats=0.1, few_seats=0.1,
                                              standing=0.1, full=0.1)),
    ])
    res = gate.check_network_trend(trend, rel_key="historic/network_trend.json")
    assert any(r.check == "mix_sum" for r in _warnings(res))
    assert not any(r.check == "mix_bucket" for r in _errors(res))


def test_mix_bucket_out_of_range_is_error():
    trend = NetworkTrend(generated_utc="t", series=[
        TrendPoint(date="2026-06-01", otp_pct=90,
                   occupancy_mix=OccupancyMix(empty=1.5, many_seats=0.0, few_seats=0.0,
                                              standing=0.0, full=0.0)),
    ])
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
        trend, rel_key="historic/network_trend.json", has_prior=False,
        has_realtime_payloads=True,
    )
    assert finding is not None
    assert finding.check == "empty_coverage" and finding.severity is Severity.WARN


def test_empty_network_trend_is_error_when_prior_and_realtime_exist():
    trend = NetworkTrend(generated_utc="t", series=[])
    finding = gate.check_network_trend_coverage(
        trend, rel_key="historic/network_trend.json", has_prior=True,
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
        trend, rel_key="historic/network_trend.json", has_prior=True,
        has_realtime_payloads=False,
    )
    assert finding is not None
    assert finding.check == "empty_coverage" and finding.severity is Severity.WARN
    assert "static-only" in finding.message


def test_nonempty_network_trend_yields_no_coverage_finding():
    trend = NetworkTrend(generated_utc="t", series=[TrendPoint(date="2026-06-01", otp_pct=90)])
    assert gate.check_network_trend_coverage(
        trend, rel_key="historic/network_trend.json", has_prior=True,
        has_realtime_payloads=True,
    ) is None


def test_finalize_batch_routes_empty_trend_by_prior_and_batch_shape():
    # WARN when prior_files_total is None (first publish); ERROR only when a prior
    # exists AND the batch carries realtime-derived route files; WARN again for the
    # static-only shape (prior exists, zero route files — the sto/octranspo case).
    route_files = [(
        "historic/route_reliability/1.json",
        RouteReliability(generated_utc="t", id="1",
                         periods=[ReliabilityPeriod(grain="all", otp_pct=90)]),
    )]

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
    full = RouteReliability(generated_utc="t", id="b",
                            periods=[ReliabilityPeriod(grain="all", otp_pct=90)])
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
    payloads = [("historic/route_reliability/a.json",
                 _route_with_cancellations("a", [(None, 5), (None, 3)]))]
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
    route_payloads = [("historic/route_reliability/a.json",
                       _route_with_cancellations("a", rows))]
    gate.finalize_batch(
        report, route_payloads=route_payloads, current_total=1, prior_files_total=None
    )
    assert any(r.check == "id_drift" for r in report.warnings)
    assert report.errors == []


# --- enforce / GateError -----------------------------------------------------


def test_enforce_force_true_with_errors_does_not_raise():
    report = gate.new_report("stm", "historic", "t")
    report.results.append(gate.CheckResult(
        check="rate_range", kind="k", rel_key="r", severity=Severity.ERROR, message="bad",
    ))
    gate.enforce(report, force=True)  # must NOT raise


def test_enforce_force_false_with_errors_raises():
    report = gate.new_report("stm", "historic", "t")
    report.results.append(gate.CheckResult(
        check="rate_range", kind="k", rel_key="r", severity=Severity.ERROR, message="bad",
    ))
    with pytest.raises(gate.GateError):
        gate.enforce(report, force=False)


def test_enforce_clean_report_does_not_raise():
    report = gate.new_report("stm", "historic", "t")
    gate.enforce(report, force=False)  # no findings -> no raise
    assert report.passed


# --- report round-trip -------------------------------------------------------


def test_gate_report_to_dict_round_trips_json():
    report = gate.new_report("stm", "historic", "2026-06-01T00:00:00Z")
    # An out-of-range rate is a per-file ERROR the round-trip can assert on.
    gate.record(
        report, "historic/network_trend.json",
        NetworkTrend(generated_utc="t", series=[TrendPoint(date="2026-06-01", otp_pct=150)]),
    )
    d = report.to_dict()
    parsed = json.loads(json.dumps(d))
    assert parsed["provider_id"] == "stm"
    assert parsed["tier"] == "historic"
    assert parsed["payloads_checked"] == 1
    assert parsed["errors"] >= 1  # otp_pct=150 -> rate_range ERROR
    assert isinstance(parsed["results"], list)
