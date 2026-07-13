import pytest
from pydantic import ValidationError

from transit_ops.snapshots.contract import (
    LabelsFile,
    RouteDirection,
    RouteFile,
    RoutesIndex,
    RouteStop,
    ScheduledRoute,
    Status,
    StopEta,
    StopFile,
    StopsIndex,
    Trip,
    TripsFile,
    Vehicle,
)


def test_vehicle_valid():
    v = Vehicle(
        id="29051",
        route="165",
        trip="t1",
        lat=45.49,
        lon=-73.66,
        bearing=312,
        speed_kmh=32,
        status="late",
        delay_min=4,
        occupancy="few_seats",
        next_stop="51234",
        updated_utc="2026-05-31T21:42:00Z",
    )
    assert v.status is Status.late


def test_vehicle_rejects_bad_status():
    with pytest.raises(ValidationError):
        Vehicle(id="1", lat=0.0, lon=0.0, status="sideways", updated_utc="x")


def test_trips_file_indexed_by_trip_id():
    tf = TripsFile(
        generated_utc="t",
        trips={
            "t1": Trip(
                route="165",
                status="late",
                delay_min=4,
                stops=[StopEta(stop="51234", eta_utc="x", delay_min=4)],
            )
        },
    )
    assert tf.trips["t1"].stops[0].stop == "51234"


def test_stop_departures_file_indexed_by_stop_id():
    from transit_ops.snapshots.contract import StopDeparture, StopDeparturesFile

    sdf = StopDeparturesFile(
        generated_utc="2026-06-10T12:00:00Z",
        stops={
            "51234": [
                StopDeparture(route="165", trip="t1", eta_utc="2026-06-10T12:05:00Z", delay_min=2)
            ]
        },
    )
    assert sdf.stops["51234"][0].route == "165"
    assert sdf.stops["51234"][0].eta_utc == "2026-06-10T12:05:00Z"
    assert sdf.stops["51234"][0].delay_min == 2


def test_stop_departure_rejects_missing_eta():
    from transit_ops.snapshots.contract import StopDeparture

    with pytest.raises(ValidationError):
        StopDeparture(route="165")


def test_route_file_valid():
    rf = RouteFile(
        generated_utc="t",
        id="165",
        long="Côte-Vertu",
        directions=[
            RouteDirection(
                dir=0,
                headsign="Côte-Vertu",
                stops=[RouteStop(id="51234", seq=1, name="Côte-Vertu / Décarie")],
            )
        ],
    )
    assert rf.directions[0].stops[0].id == "51234"


def test_stop_file_valid():
    sf = StopFile(
        generated_utc="t",
        id="51234",
        name="Côte-Vertu / Décarie",
        lat=45.49,
        lon=-73.66,
        scheduled=[ScheduledRoute(route="165", headsign="Côte-Vertu", times=["17:46", "17:54"])],
    )
    assert sf.scheduled[0].times[0] == "17:46"


def test_labels_file_valid():
    lf = LabelsFile(
        generated_utc="t", labels={"status.on_time": "À l'heure", "status.late": "En retard"}
    )
    assert lf.labels["status.on_time"] == "À l'heure"


def test_historic_models_valid():
    from transit_ops.snapshots.contract import (
        HeadwayPeriod,
        NetworkTrend,
        Offender,
        Provenance,
        Receipt,
        RepeatOffenders,
        RouteReliability,
    )

    nt = NetworkTrend(
        generated_utc="t",
        series=[
            {
                "date": "2026-05-30",
                "otp_pct": 39,
                "avg_delay_min": 3.4,
                "p90_min": 11,
                "vehicles": 612,
            }
        ],
    )
    assert nt.series[0].otp_pct == 39
    rr = RouteReliability(
        generated_utc="t",
        id="165",
        periods=[{"grain": "day", "otp_pct": 47}],
        headway=[
            HeadwayPeriod(shift="pm_peak", scheduled_min=6, observed_min=7.8, excess_wait_min=1.8)
        ],
    )
    assert rr.headway[0].excess_wait_min == 1.8
    ro = RepeatOffenders(
        generated_utc="t",
        offenders=[
            Offender(type="vehicle", id="29051", route="171", recurrence="6/7d", avg_delay_min=8)
        ],
    )
    assert ro.offenders[0].recurrence == "6/7d"
    rc = Receipt(
        generated_utc="t",
        date="2026-05-30",
        otp_pct=39,
        worst_route={"id": "171", "otp_delta_pts": -22},
    )
    assert rc.worst_route.id == "171"
    prov = Provenance(
        generated_utc="t",
        retention={"detail_days": 14, "aggregate_days": 730},
        gaps=["metro_realtime"],
    )
    assert prov.retention["detail_days"] == 14


def test_artifact_models_require_generated_utc():
    """Every published artifact model now requires a generated_utc stamp."""
    from transit_ops.snapshots.contract import (
        AlertsFile,
        NetworkFile,
        NetworkTrend,
    )

    with pytest.raises(ValidationError):
        TripsFile(trips={})
    with pytest.raises(ValidationError):
        AlertsFile(alerts=[])
    with pytest.raises(ValidationError):
        NetworkFile(
            vehicles_in_service=0,
            on_time_pct=0,
            status_dist={},
            delay_p50_min=0,
            delay_p90_min=0,
            occupancy_mix={},
            non_responding=0,
            feed_freshness_s=0,
            coverage_pct=0,
        )
    with pytest.raises(ValidationError):
        RoutesIndex(routes=[])
    with pytest.raises(ValidationError):
        StopsIndex(stops=[])
    with pytest.raises(ValidationError):
        NetworkTrend(series=[])


def test_manifest_tier_inventories_and_nullable_basemap():
    """Manifest.basemap is nullable; files gains static/historic inventories
    with per-tier generated_utc defaulting to None (never published)."""
    from transit_ops.snapshots.contract import (
        Manifest,
        ManifestFiles,
        ManifestHistoricFiles,
        ManifestLiveFiles,
        ManifestStaticFiles,
    )

    m = Manifest(
        provider="stm",
        display_name="STM",
        bbox=[0, 0, 1, 1],
        attribution="a",
        basemap=None,
        dataset_version="v",
        labels={},
        surfaces=[],
        files=ManifestFiles(live=ManifestLiveFiles(generated_utc="t")),
    )
    assert m.basemap is None
    assert m.files.static.generated_utc is None
    assert m.files.historic.generated_utc is None
    assert m.files.static.routes_index == "static/routes_index.json"
    assert m.files.static.basemap is None
    assert m.files.historic.receipts_index == "historic/receipts/index.json"
    assert m.files.historic.route_reliability_prefix == "historic/route_reliability/"

    # populated tier stamps round-trip
    m2 = Manifest(
        provider="stm",
        display_name="STM",
        bbox=[0, 0, 1, 1],
        attribution="a",
        basemap="https://x/v1/stm/static/basemap.json",
        dataset_version="v",
        labels={},
        surfaces=[],
        files=ManifestFiles(
            live=ManifestLiveFiles(generated_utc="t"),
            static=ManifestStaticFiles(
                basemap="static/basemap.json", generated_utc="2026-06-01T00:00:00Z"
            ),
            historic=ManifestHistoricFiles(generated_utc="2026-06-13T00:00:00Z"),
        ),
    )
    assert m2.files.static.generated_utc == "2026-06-01T00:00:00Z"
    assert m2.files.static.basemap == "static/basemap.json"
    assert m2.files.historic.generated_utc == "2026-06-13T00:00:00Z"


def test_basemap_and_receipts_index_models():
    from transit_ops.snapshots.contract import BasemapFile, ReceiptsIndex

    bm = BasemapFile(url="https://x/quebec.pmtiles", attribution="© OSM", generated_utc="t")
    assert bm.format == "pmtiles"
    assert bm.style_url is None
    assert bm.min_zoom == 0 and bm.max_zoom == 15

    ri = ReceiptsIndex(dates=["2026-06-01", "2026-06-02"], generated_utc="t")
    assert ri.dates == ["2026-06-01", "2026-06-02"]
    assert ri.collection_generation_id is None
    assert ReceiptsIndex.model_json_schema()["properties"]["dates"]["description"] == (
        "Exact ascending dates whose receipts were built and published from retained "
        "accountability rows in the current publication."
    )
    # generated_utc is required
    with pytest.raises(ValidationError):
        ReceiptsIndex(dates=[])


def test_alert_text_fields_are_additive():
    """slice-9.1.1s: new alert text fields are optional-with-default, so the
    frozen live Alert / historic AlertHistoryEntry contracts stay backward
    compatible (required arrays unchanged: [id,severity,header_key] / [id])."""
    from transit_ops.snapshots.contract import Alert, AlertHistoryEntry

    # Old-shape Alert still validates; new fields default to '' / None.
    a = Alert(id="x", severity="watch", header_key="h")
    assert a.header_text == ""
    assert a.description is None
    assert a.header_text_en is None
    assert a.description_en is None

    # Fully-populated Alert roundtrips.
    full = Alert(
        id="x",
        severity="watch",
        header_key="h",
        header_text="Votre ligne",
        description="Arrets annules",
        header_text_en="Your line",
        description_en="Cancelled stops",
    )
    assert full.header_text_en == "Your line"
    assert full.description == "Arrets annules"

    # AlertHistoryEntry old shape still validates; all source text defaults None.
    e = AlertHistoryEntry(id="x")
    assert e.header_text is None
    assert e.header_text_en is None
    assert e.description is None
    assert e.description_en is None
    eh = AlertHistoryEntry(
        id="x",
        header_text="Votre ligne",
        header_text_en="Your line",
        description="Arrêts annulés",
        description_en="Cancelled stops",
    )
    assert eh.header_text_en == "Your line"
    assert eh.description == "Arrêts annulés"
    assert eh.description_en == "Cancelled stops"

    # Freeze-compat: required arrays are exactly the committed ones.
    assert Alert.model_json_schema()["required"] == ["id", "severity", "header_key"]
    assert AlertHistoryEntry.model_json_schema()["required"] == ["id"]


def test_alert_history_realistic_500_row_bilingual_payload_fits_512_kib_ceiling():
    """The newest-first cap stays at 500 after restoring real FR/EN messages."""
    from transit_ops.snapshots.contract import (
        ALERT_HISTORY_BYTE_CEILING,
        AlertActivePeriod,
        AlertHistory,
        AlertHistoryEntry,
    )

    description_fr = (
        "En raison de travaux, la ligne 10 est détournée entre Berri et "
        "Saint-Denis. Prévoyez plus de temps."
    )
    description_en = (
        "Due to construction, route 10 is detoured between Berri and Saint-Denis. "
        "Allow extra time for your trip."
    )
    alerts = [
        AlertHistoryEntry(
            id=f"stm-alert-{i:03d}",
            severity="watch",
            header_text="Votre ligne",
            header_text_en="Your line",
            description=description_fr,
            description_en=description_en,
            routes=["10", "55"],
            stops=["52101", "52102", "52103"],
            start_utc="2026-06-01T08:00:00Z",
            end_utc="2026-06-01T10:00:00Z",
            duration_min=120,
            cause="CONSTRUCTION",
            effect="DETOUR",
            severity_level="WARNING",
            url="https://www.stm.info/fr/infos/etat-du-service/alertes",
            active_periods=[
                AlertActivePeriod(
                    start_utc="2026-06-01T08:00:00Z",
                    end_utc="2026-06-01T10:00:00Z",
                )
            ],
        )
        for i in range(500)
    ]
    payload = AlertHistory(
        generated_utc="2026-06-01T00:00:00Z",
        alerts=alerts,
        window_start="2026-05-01",
        window_end="2026-06-01",
        total_in_window=500,
        truncated=False,
    )

    encoded = payload.model_dump_json().encode("utf-8")
    assert len(payload.alerts) == 500
    assert all(alert.description == description_fr for alert in payload.alerts)
    assert 350_000 <= len(encoded) <= 400_000
    assert ALERT_HISTORY_BYTE_CEILING == 524_288
    assert len(encoded) <= ALERT_HISTORY_BYTE_CEILING


def test_s15_alert_url_and_active_periods_are_additive():
    """S15: url / url_en / active_periods (live Alert), cause / effect /
    severity_level / url / active_periods (AlertHistoryEntry), and window fields
    (AlertHistory) are all optional-with-default. Old payloads still validate and
    the frozen required sets are UNCHANGED."""
    from transit_ops.snapshots.contract import (
        Alert,
        AlertActivePeriod,
        AlertHistory,
        AlertHistoryEntry,
        AlertsFile,
    )

    # Old-shape live Alert (pre-S15) still validates; new fields default.
    a = Alert(id="x", severity="watch", header_key="h")
    assert a.url is None and a.url_en is None
    assert a.active_periods == []

    # Old-shape historic entry (pre-S15) still validates; new fields default.
    e = AlertHistoryEntry(id="x")
    assert e.cause is None and e.effect is None and e.severity_level is None
    assert e.url is None
    assert e.active_periods == []

    # Old-shape AlertHistory envelope (no window fields) still validates.
    ah = AlertHistory(generated_utc="t")
    assert ah.window_start is None and ah.window_end is None
    assert ah.total_in_window is None and ah.truncated is None

    # Fully-populated S15 shapes roundtrip.
    full = Alert(
        id="x",
        severity="watch",
        header_key="h",
        url="https://x",
        url_en="https://x/en",
        active_periods=[AlertActivePeriod(start_utc="2026-06-01T08:00:00Z", end_utc=None)],
    )
    assert full.url == "https://x"
    assert full.active_periods[0].start_utc == "2026-06-01T08:00:00Z"

    # An old serialized payload (no S15 keys) validates round-trip through JSON.
    old_json = '{"generated_utc":"t","alerts":[{"id":"a1","severity":"INFO"}]}'
    reparsed = AlertHistory.model_validate_json(old_json)
    assert reparsed.alerts[0].active_periods == []
    assert reparsed.truncated is None

    # Freeze-compat: required arrays are exactly the committed ones (unchanged).
    assert Alert.model_json_schema()["required"] == ["id", "severity", "header_key"]
    assert AlertHistoryEntry.model_json_schema()["required"] == ["id"]
    assert AlertsFile.model_json_schema()["required"] == ["generated_utc", "alerts"]
    assert AlertActivePeriod.model_json_schema().get("required", []) == []


def test_network_delay_histogram_and_non_responding_by_route_are_additive():
    """slice-9.5: NetworkFile.delay_histogram and .non_responding_by_route are
    optional-with-default (None), so already-published network.json stays valid
    and the frozen required set is unchanged."""
    from transit_ops.snapshots.contract import (
        DelayBucket,
        NetworkFile,
        NonRespondingRoute,
    )

    # Old-shape NetworkFile still validates; the two new fields default None.
    n = NetworkFile(
        generated_utc="2026-06-20T00:00:00Z",
        vehicles_in_service=0,
        on_time_pct=None,
        status_dist={},
        delay_p50_min=None,
        delay_p90_min=None,
        non_responding=0,
        feed_freshness_s=None,
        coverage_pct=None,
    )
    assert n.delay_histogram is None
    assert n.non_responding_by_route is None

    # Populated shape roundtrips; DelayBucket edges accept null (unbounded).
    full = NetworkFile(
        generated_utc="2026-06-20T00:00:00Z",
        vehicles_in_service=3,
        on_time_pct=67,
        status_dist={},
        delay_p50_min=2,
        delay_p90_min=10,
        non_responding=5,
        feed_freshness_s=12,
        coverage_pct=100,
        delay_histogram=[
            DelayBucket(lo_min=None, hi_min=-5, count=0),
            DelayBucket(lo_min=15, hi_min=None, count=2),
        ],
        non_responding_by_route=[
            NonRespondingRoute(route_id="51", count=3),
            NonRespondingRoute(route_id="165", count=2),
        ],
    )
    assert full.delay_histogram[0].lo_min is None
    assert full.delay_histogram[0].hi_min == -5
    assert full.delay_histogram[1].lo_min == 15
    assert full.delay_histogram[1].hi_min is None
    assert sum(r.count for r in full.non_responding_by_route) == full.non_responding

    # Freeze-compat: required set excludes the two additive fields.
    required = set(NetworkFile.model_json_schema()["required"])
    assert "delay_histogram" not in required
    assert "non_responding_by_route" not in required


def test_reliability_new_fields_are_additive():
    """Tier-0 rollup-foundation: RouteReliability.day_of_week, StopReliability.habits,
    and StopReliabilityPeriod.p50_min/p90_min are optional-with-default, so already-
    published reliability artifacts still validate and required sets are unchanged."""
    from transit_ops.snapshots.contract import (
        RouteDayOfWeek,
        RouteHabits,
        RouteReliability,
        StopReliability,
        StopReliabilityPeriod,
    )

    # Old-shape route reliability still validates; day_of_week defaults to [].
    rr = RouteReliability(generated_utc="t", id="165")
    assert rr.day_of_week == []
    full = RouteReliability(
        generated_utc="t",
        id="165",
        day_of_week=[RouteDayOfWeek(day_of_week_iso=1, avg_delay_min=2.1)],
    )
    assert full.day_of_week[0].day_of_week_iso == 1
    assert full.day_of_week[0].observation_count is None

    # Old-shape stop reliability still validates; habits defaults to None.
    sr = StopReliability(generated_utc="t", id="s1")
    assert sr.habits is None
    sr_full = StopReliability(
        generated_utc="t",
        id="s1",
        habits=RouteHabits(scale="severe_relative", matrix=[[None, 1.0]]),
    )
    assert sr_full.habits.scale == "severe_relative"

    # StopReliabilityPeriod percentiles are optional.
    assert StopReliabilityPeriod(grain="week").p50_min is None
    assert StopReliabilityPeriod(grain="day", p50_min=0.8, p90_min=5.0).p90_min == 5.0

    # Freeze-compat: required sets unchanged by the additive fields.
    assert RouteReliability.model_json_schema()["required"] == ["generated_utc", "id"]
    assert StopReliability.model_json_schema()["required"] == ["generated_utc", "id"]
    assert StopReliabilityPeriod.model_json_schema()["required"] == ["grain"]


def test_tier1_cancellation_occupancy_fields_are_additive():
    """Tier-1 rollup-foundation: RouteReliability.cancellations/occupancy_mix and
    TrendPoint.cancellation_rate/occupancy_mix are optional-with-default (reusing
    the existing OccupancyMix model), so already-published route_reliability.json /
    network_trend.json still validate and required sets stay frozen."""
    from transit_ops.snapshots.contract import (
        CancellationPeriod,
        OccupancyMix,
        RouteReliability,
        TrendPoint,
    )

    # Old-shape route reliability: cancellations defaults [], occupancy_mix None.
    rr = RouteReliability(generated_utc="t", id="165")
    assert rr.cancellations == []
    assert rr.occupancy_mix is None

    # Populated cancellations + occupancy_mix roundtrip.
    full = RouteReliability(
        generated_utc="t",
        id="165",
        cancellations=[
            CancellationPeriod(
                date="2026-06-17",
                cancellation_rate_pct=2.56,
                canceled_trip_days=4,
                total_trip_days=156,
            )
        ],
        occupancy_mix=OccupancyMix(many_seats=0.5, few_seats=0.3, standing=0.2),
    )
    assert full.cancellations[0].grain == "day"
    assert full.cancellations[0].cancellation_rate_pct == 2.56
    assert full.occupancy_mix.standing == 0.2

    # Honest-None cancellation rate (no trips observed) still validates.
    empty_rate = CancellationPeriod(canceled_trip_days=0, total_trip_days=0)
    assert empty_rate.cancellation_rate_pct is None

    # TrendPoint defaults None for both new fields; populated roundtrips.
    assert TrendPoint(date="2026-06-17").cancellation_rate is None
    assert TrendPoint(date="2026-06-17").occupancy_mix is None
    tp = TrendPoint(date="2026-06-17", cancellation_rate=1.2, occupancy_mix=OccupancyMix(full=1.0))
    assert tp.cancellation_rate == 1.2
    assert tp.occupancy_mix.full == 1.0

    # Freeze-compat: required sets unchanged by the additive fields.
    assert RouteReliability.model_json_schema()["required"] == ["generated_utc", "id"]
    assert TrendPoint.model_json_schema()["required"] == ["date"]
    # CancellationPeriod is fully optional (grain has a default) — no required set.
    assert CancellationPeriod.model_json_schema().get("required", []) == []


def test_tier2_headway_servicespan_alertbreakdown_fields_are_additive():
    """Tier-2 rollup-foundation: HeadwayPeriod.cov/bunched_pct, RouteReliability.
    service_spans, and AlertHistory.breakdown are optional-with-default, so already-
    published artifacts still validate and required sets stay frozen."""
    from transit_ops.snapshots.contract import (
        AlertBreakdown,
        AlertBreakdownBucket,
        AlertHistory,
        HeadwayPeriod,
        RouteReliability,
        ServiceSpanPeriod,
        SkippedStopPeriod,
    )

    # HeadwayPeriod regularity fields default None; populated roundtrips.
    hp = HeadwayPeriod(shift="am_peak")
    assert hp.cov is None and hp.bunched_pct is None
    assert HeadwayPeriod(shift="am_peak", cov=0.42, bunched_pct=12.5).cov == 0.42

    # RouteReliability.service_spans / skipped_stops default []; populated roundtrips.
    rr = RouteReliability(generated_utc="t", id="165")
    assert rr.service_spans == []
    assert rr.skipped_stops == []
    rr_skip = RouteReliability(
        generated_utc="t",
        id="165",
        skipped_stops=[
            SkippedStopPeriod(
                date="2026-06-17",
                skipped_stop_rate_pct=3.94,
                skipped_stop_count=12,
                stop_time_update_count=305,
            )
        ],
    )
    assert rr_skip.skipped_stops[0].skipped_stop_rate_pct == 3.94
    # Honest-None rate when no stop-time updates observed.
    assert (
        SkippedStopPeriod(skipped_stop_count=0, stop_time_update_count=0).skipped_stop_rate_pct
        is None
    )
    full = RouteReliability(
        generated_utc="t",
        id="165",
        service_spans=[
            ServiceSpanPeriod(
                date="2026-06-17",
                first_trip_utc="2026-06-17T10:00:00Z",
                last_trip_utc="2026-06-18T01:00:00Z",
                service_span_min=900,
                first_trip_delay_min=0.5,
                last_trip_delay_min=1.5,
                trip_count=120,
            )
        ],
    )
    assert full.service_spans[0].service_span_min == 900

    # AlertHistory.breakdown defaults None; populated roundtrips.
    assert AlertHistory(generated_utc="t").breakdown is None
    ah = AlertHistory(
        generated_utc="t",
        breakdown=AlertBreakdown(
            by_cause=[AlertBreakdownBucket(key="unknown", count=3, median_duration_min=42.0)],
            by_severity=[AlertBreakdownBucket(key="high", count=2)],
        ),
    )
    assert ah.breakdown.by_cause[0].key == "unknown"
    assert ah.breakdown.by_severity[0].median_duration_min is None

    # Freeze-compat: required sets unchanged by the additive fields.
    assert RouteReliability.model_json_schema()["required"] == ["generated_utc", "id"]
    assert HeadwayPeriod.model_json_schema()["required"] == ["shift"]
    assert AlertHistory.model_json_schema()["required"] == ["generated_utc"]
    assert AlertBreakdownBucket.model_json_schema()["required"] == ["key"]


def test_weak_stops_by_grain_fields_are_additive():
    """DB-PR-3 windowable §4: WeakStop.observation_count/severe_pct/wilson_lo/wilson_hi and
    RouteReliability.weak_stops_by_grain are optional-with-default, so already-published
    route_reliability artifacts still validate and the frozen required sets stay unchanged."""
    from transit_ops.snapshots.contract import RouteReliability, WeakStop, WeakStopGrain

    # The scalar WeakStop shape gains 4 optional fields, defaulting None.
    w = WeakStop(id="51234", name="Côte-Vertu / Décarie", avg_delay_min=8.2)
    assert w.observation_count is None and w.severe_pct is None
    assert w.wilson_lo is None and w.wilson_hi is None

    # RouteReliability.weak_stops_by_grain defaults []; a populated payload roundtrips.
    rr = RouteReliability(generated_utc="t", id="165")
    assert rr.weak_stops_by_grain == []
    full = RouteReliability(
        generated_utc="t",
        id="165",
        weak_stops_by_grain=[
            WeakStopGrain(
                grain="month",
                date="2026-06-01",
                stops=[
                    WeakStop(
                        id="9001",
                        name="Worst / Stop",
                        avg_delay_min=12.4,
                        observation_count=987,
                        severe_pct=55.0,
                        wilson_lo=33.1,
                        wilson_hi=47.9,
                    )
                ],
            )
        ],
    )
    assert full.weak_stops_by_grain[0].stops[0].wilson_lo == 33.1
    # Survives a JSON roundtrip (the exact bytes the publisher writes + the web validates).
    again = RouteReliability.model_validate(full.model_dump(mode="json"))
    assert again.weak_stops_by_grain[0].stops[0].observation_count == 987

    # Freeze-compat: required sets unchanged by the additive fields.
    assert RouteReliability.model_json_schema()["required"] == ["generated_utc", "id"]
    assert WeakStop.model_json_schema()["required"] == ["id"]
    assert WeakStopGrain.model_json_schema()["required"] == ["grain"]


def test_repeat_offenders_by_grain_fields_are_additive():
    """S14 windowable repeat-offenders: Offender gains recurrence_days/window_days/severity and
    RepeatOffenders.by_grain (RepeatOffenderGrain/Entry) — all optional-with-default, so an
    already-published repeat_offenders.json still validates and the frozen required sets hold."""
    from transit_ops.snapshots.contract import (
        Offender,
        RepeatOffenderEntry,
        RepeatOffenderGrain,
        RepeatOffenders,
    )

    # Old-shape scalar payload still validates; new fields default None / [].
    old = RepeatOffenders.model_validate(
        {
            "generated_utc": "t",
            "offenders": [
                {"type": "trip", "id": "X1", "recurrence": "3/14d", "avg_delay_min": 2.0}
            ],
        }
    )
    assert old.by_grain == []
    o0 = old.offenders[0]
    assert o0.recurrence == "3/14d"  # legacy field untouched
    assert o0.recurrence_days is None and o0.window_days is None and o0.severity is None

    # A fully-populated by_grain payload roundtrips (the exact bytes publisher writes/web reads).
    full = RepeatOffenders(
        generated_utc="t",
        offenders=[
            Offender(
                type="vehicle",
                id="V2",
                route="51",
                recurrence="5/14d",
                recurrence_days=5,
                window_days=14,
                avg_delay_min=10.0,
                severity="high",
            )
        ],
        by_grain=[
            RepeatOffenderGrain(
                grain="week",
                window_days=7,
                entries=[
                    RepeatOffenderEntry(
                        rank=1,
                        type="trip",
                        id="T9",
                        route="9",
                        route_name="Route Nine",
                        severity="critical",
                        observation_count=120,
                        severe_count=80,
                        severe_pct=66.7,
                        wilson_lo=25.1,
                        wilson_hi=41.2,
                        recurrence_days=6,
                        observed_days=7,
                        window_days=7,
                        avg_delay_min=11.5,
                    )
                ],
                total_ranked_trips=1,
                total_ranked_vehicles=0,
                tray_total=0,
            )
        ],
    )
    again = RepeatOffenders.model_validate(full.model_dump(mode="json"))
    assert again.by_grain[0].grain == "week"
    assert again.by_grain[0].entries[0].recurrence_days == 6
    assert again.offenders[0].severity == "high"

    # Freeze-compat: required sets unchanged by the additive fields.
    assert RepeatOffenders.model_json_schema()["required"] == ["generated_utc"]
    assert Offender.model_json_schema()["required"] == ["type", "id"]
    assert RepeatOffenderGrain.model_json_schema()["required"] == ["grain"]
    assert RepeatOffenderEntry.model_json_schema()["required"] == ["type", "id"]


def test_repeat_offenders_byte_ceiling_exported():
    """S14 exports REPEAT_OFFENDERS_BYTE_CEILING (256 KiB) so the web can share the constant."""
    from transit_ops.snapshots.contract import REPEAT_OFFENDERS_BYTE_CEILING

    assert REPEAT_OFFENDERS_BYTE_CEILING == 262144


def test_stop_index_mode_routes_are_additive():
    """slice stops-index-mode-routes: mode/routes are optional-with-default, so an
    already-published stops_index.json (without them) still validates and the
    frozen StopIndexEntry required set stays [id,name,lat,lon]."""
    from transit_ops.snapshots.contract import StopIndexEntry

    # Old-shape entry still validates; new fields default to None / [].
    s = StopIndexEntry(id="51234", name="Côte-Vertu / Décarie", lat=45.49123, lon=-73.66123)
    assert s.mode is None
    assert s.routes == []

    # Fully-populated entry roundtrips.
    full = StopIndexEntry(
        id="1", name="Berri-UQAM", lat=45.5151, lon=-73.5611, mode="metro", routes=["1", "165"]
    )
    assert full.mode == "metro"
    assert full.routes == ["1", "165"]

    # Freeze-compat: required keys are exactly the committed ones.
    assert StopIndexEntry.model_json_schema()["required"] == ["id", "name", "lat", "lon"]


# --- GC2 H4: in-band accountability envelope + provider capabilities -----------


def test_every_top_level_model_carries_the_envelope():
    # Every TOP_LEVEL_MODELS root MUST subclass PayloadEnvelope so a future top-level
    # model can't forget the in-band schema_version/methodology_version/generation_id.
    from transit_ops.snapshots.contract import (
        PAYLOAD_METHODOLOGY,
        TOP_LEVEL_MODELS,
        PayloadEnvelope,
    )

    for name, model in TOP_LEVEL_MODELS.items():
        assert issubclass(model, PayloadEnvelope), f"{name} missing PayloadEnvelope"
        fields = model.model_fields
        for f in ("schema_version", "methodology_version", "publish_generation_id"):
            assert f in fields, f"{name} missing envelope field {f}"
        # Every top-level model must have a methodology family entry.
        assert name in PAYLOAD_METHODOLOGY, f"{name} missing PAYLOAD_METHODOLOGY entry"


def test_envelope_fields_are_additive_optional_with_defaults():
    # Growth rule: the envelope must be optional-with-default so already-published
    # snapshots (which lack these keys) still validate.
    from transit_ops.snapshots.contract import PAYLOAD_SCHEMA_VERSION, VehiclesFile

    v = VehiclesFile(generated_utc="t", vehicles=[])
    assert v.schema_version == PAYLOAD_SCHEMA_VERSION
    assert v.methodology_version is None
    assert v.publish_generation_id is None
    # None of the three appear in `required`.
    req = VehiclesFile.model_json_schema()["required"]
    for f in ("schema_version", "methodology_version", "publish_generation_id"):
        assert f not in req


def test_provider_capabilities_fields_match_surfaces_one_to_one():
    # DECISIONS #15: capability families align 1:1 with Manifest.surfaces (_SURFACES).
    from transit_ops.snapshots.builders._helpers import _SURFACES
    from transit_ops.snapshots.contract import ProviderCapabilities

    assert list(ProviderCapabilities.model_fields) == list(_SURFACES)


def test_manifest_capabilities_is_additive_optional():
    from transit_ops.snapshots.contract import Manifest

    assert "capabilities" not in Manifest.model_json_schema()["required"]


# --- S11: DataHealth payload + manifest data_health pointer --------------------


def test_manifest_live_files_data_health_pointer_is_additive_optional():
    # The data_health pointer is additive-optional-with-default so an already-published
    # manifest stays FIELD-IDENTICAL under the growth rule.
    from transit_ops.snapshots.contract import ManifestLiveFiles

    mlf = ManifestLiveFiles(generated_utc="t")
    assert mlf.data_health == "status/data_health.json"
    assert "data_health" not in ManifestLiveFiles.model_json_schema()["required"]


def test_data_health_roundtrips_with_lanes_and_feeds():
    from transit_ops.snapshots.contract import (
        DataHealth,
        DataHealthFeed,
        DataHealthGate,
        LaneHealth,
    )

    dh = DataHealth(
        generated_utc="2026-07-02T12:00:00Z",
        lanes=[
            LaneHealth(
                lane="live",
                last_publish_utc="2026-07-02T11:59:03Z",
                age_s=57,
                files_written=6,
                files_skipped=0,
                files_total=6,
                gate=DataHealthGate(
                    checks_run=6,
                    errors=0,
                    warnings=1,
                    verdict="warn",
                    generated_utc="2026-07-02T11:59:03Z",
                ),
            ),
            LaneHealth(lane="rollup"),  # honest-null lane (never published)
        ],
        feeds=[DataHealthFeed(feed="trip_updates", status="fresh", age_s=30)],
    )
    parsed = DataHealth.model_validate_json(dh.model_dump_json())
    assert parsed.lanes[0].gate.verdict == "warn"
    assert parsed.lanes[1].last_publish_utc is None
    assert parsed.lanes[1].gate is None
    assert parsed.feeds[0].feed == "trip_updates"


def test_data_health_honest_null_defaults():
    # A lane / gate / feed with only its required key set carries honest-NULL, never 0.
    from transit_ops.snapshots.contract import DataHealth, LaneHealth

    dh = DataHealth(generated_utc="t", lanes=[LaneHealth(lane="static")])
    lane = dh.lanes[0]
    assert lane.age_s is None and lane.files_total is None and lane.gate is None
    assert dh.feeds == []


def test_data_health_carries_the_envelope_and_is_additive():
    from transit_ops.snapshots.contract import DataHealth, PayloadEnvelope

    assert issubclass(DataHealth, PayloadEnvelope)
    req = DataHealth.model_json_schema()["required"]
    for f in ("lanes", "feeds", "schema_version", "methodology_version"):
        assert f not in req, f"{f} must be additive-optional"
    assert "generated_utc" in req


def test_data_health_byte_ceiling_constant_exported():
    from transit_ops.snapshots.contract import DATA_HEALTH_BYTE_CEILING

    assert DATA_HEALTH_BYTE_CEILING == 16384


# --- Task 4: shared retained-history contracts --------------------------------


def test_shared_history_contracts_roundtrip_exact_shapes():
    from transit_ops.snapshots.contract import (
        HistoricAvailabilityIndex,
        HistoricCollectionIndex,
        HistoricCoverageGap,
        HistoricFamilyAvailability,
        HistoricPartitionRef,
        HistorySelectionMode,
    )

    gap = HistoricCoverageGap(
        start_date="2026-03-08",
        end_date="2026-03-09",
        reason="provider outage",
    )
    partition = HistoricPartitionRef(
        path=f"historic/example/generations/{'a' * 64}/2026-03.json",
        coverage_start="2026-03-01",
        coverage_end="2026-03-31",
        count=0,
        sha256="a" * 64,
        byte_size=128,
    )
    collection = HistoricCollectionIndex(
        generated_utc="2026-07-13T12:00:00Z",
        family="alerts",
        selection_mode="range",
        first_available_date="2026-03-01",
        last_available_date="2026-03-31",
        available_dates=["2026-03-01"],
        gaps=[gap],
        partitions=[partition],
    )
    availability = HistoricAvailabilityIndex(
        generated_utc="2026-07-13T12:00:00Z",
        families=[
            HistoricFamilyAvailability(
                family="alerts",
                selection_mode=HistorySelectionMode.range,
                index_path="historic/alerts/index.json",
                first_available_date="2026-03-01",
                last_available_date="2026-03-31",
                gaps=[gap],
            )
        ],
    )

    assert collection.selection_mode is HistorySelectionMode.range
    assert collection.entity_id is None
    assert collection.collection_generation_id is None
    assert collection.partitions[0].count == 0
    assert collection.partitions[0].byte_size == 128
    assert collection.metrics == []
    assert availability.families[0].selection_mode is HistorySelectionMode.range
    assert availability.families[0].collection_generation_id is None


def test_shared_history_contracts_keep_additive_defaults_and_nonnegative_counts():
    from transit_ops.snapshots.contract import (
        HistoricAvailabilityIndex,
        HistoricCollectionIndex,
        HistoricPartitionRef,
    )

    collection = HistoricCollectionIndex(
        generated_utc="t",
        family="receipts",
        selection_mode="date",
    )
    availability = HistoricAvailabilityIndex(generated_utc="t")

    assert collection.available_dates == []
    assert collection.gaps == []
    assert collection.partitions == []
    assert availability.families == []
    for field in ("schema_version", "methodology_version", "publish_generation_id"):
        assert field not in HistoricCollectionIndex.model_json_schema()["required"]
        assert field not in HistoricAvailabilityIndex.model_json_schema()["required"]

    with pytest.raises(ValidationError):
        HistoricPartitionRef(
            path="historic/example.json",
            coverage_start="2026-01-01",
            coverage_end="2026-01-31",
            count=-1,
        )


def test_shared_history_families_and_manifest_pointer_are_registered():
    from transit_ops.snapshots.contract import (
        PAYLOAD_METHODOLOGY,
        TOP_LEVEL_MODELS,
        ManifestHistoricFiles,
    )

    assert TOP_LEVEL_MODELS["historic_collection_index"].__name__ == "HistoricCollectionIndex"
    assert TOP_LEVEL_MODELS["historic_availability_index"].__name__ == "HistoricAvailabilityIndex"
    assert PAYLOAD_METHODOLOGY["historic_collection_index"] == "history-1"
    assert PAYLOAD_METHODOLOGY["historic_availability_index"] == "history-1"

    historic = ManifestHistoricFiles()
    assert historic.history_index == "historic/history/index.json"
    assert "history_index" not in ManifestHistoricFiles.model_json_schema().get("required", [])
