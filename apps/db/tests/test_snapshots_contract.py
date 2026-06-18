import pytest
from pydantic import ValidationError
from transit_ops.snapshots.contract import Vehicle, TripsFile, Trip, StopEta, Status
from transit_ops.snapshots.contract import (
    RouteFile, RouteDirection, RouteStop, StopFile, ScheduledRoute,
    RoutesIndex, StopsIndex, LabelsFile,
)

def test_vehicle_valid():
    v = Vehicle(id="29051", route="165", trip="t1", lat=45.49, lon=-73.66, bearing=312,
                speed_kmh=32, status="late", delay_min=4, occupancy="few_seats",
                next_stop="51234", updated_utc="2026-05-31T21:42:00Z")
    assert v.status is Status.late

def test_vehicle_rejects_bad_status():
    with pytest.raises(ValidationError):
        Vehicle(id="1", lat=0.0, lon=0.0, status="sideways", updated_utc="x")

def test_trips_file_indexed_by_trip_id():
    tf = TripsFile(generated_utc="t", trips={"t1": Trip(route="165", status="late", delay_min=4,
                                     stops=[StopEta(stop="51234", eta_utc="x", delay_min=4)])})
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
    rf = RouteFile(generated_utc="t", id="165", long="Côte-Vertu",
                   directions=[RouteDirection(dir=0, headsign="Côte-Vertu",
                                              stops=[RouteStop(id="51234", seq=1, name="Côte-Vertu / Décarie")])])
    assert rf.directions[0].stops[0].id == "51234"

def test_stop_file_valid():
    sf = StopFile(generated_utc="t", id="51234", name="Côte-Vertu / Décarie", lat=45.49, lon=-73.66,
                  scheduled=[ScheduledRoute(route="165", headsign="Côte-Vertu", times=["17:46", "17:54"])])
    assert sf.scheduled[0].times[0] == "17:46"

def test_labels_file_valid():
    lf = LabelsFile(generated_utc="t", labels={"status.on_time": "À l'heure", "status.late": "En retard"})
    assert lf.labels["status.on_time"] == "À l'heure"


def test_historic_models_valid():
    from transit_ops.snapshots.contract import (
        NetworkTrend, RouteReliability, HeadwayPeriod, RepeatOffenders, Offender, Receipt, Provenance,
    )
    nt = NetworkTrend(generated_utc="t", series=[{"date": "2026-05-30", "otp_pct": 39, "avg_delay_min": 3.4, "p90_min": 11, "vehicles": 612}])
    assert nt.series[0].otp_pct == 39
    rr = RouteReliability(generated_utc="t", id="165", periods=[{"grain": "day", "otp_pct": 47}],
                          headway=[HeadwayPeriod(shift="pm_peak", scheduled_min=6, observed_min=7.8, excess_wait_min=1.8)])
    assert rr.headway[0].excess_wait_min == 1.8
    ro = RepeatOffenders(generated_utc="t", offenders=[Offender(type="vehicle", id="29051", route="171", recurrence="6/7d", avg_delay_min=8)])
    assert ro.offenders[0].recurrence == "6/7d"
    rc = Receipt(generated_utc="t", date="2026-05-30", otp_pct=39, worst_route={"id": "171", "otp_delta_pts": -22})
    assert rc.worst_route.id == "171"
    prov = Provenance(generated_utc="t", retention={"detail_days": 14, "aggregate_days": 365}, gaps=["metro_realtime"])
    assert prov.retention["detail_days"] == 14


def test_artifact_models_require_generated_utc():
    """Every published artifact model now requires a generated_utc stamp."""
    from transit_ops.snapshots.contract import (
        NetworkTrend, AlertsFile, NetworkFile,
    )

    with pytest.raises(ValidationError):
        TripsFile(trips={})
    with pytest.raises(ValidationError):
        AlertsFile(alerts=[])
    with pytest.raises(ValidationError):
        NetworkFile(vehicles_in_service=0, on_time_pct=0, status_dist={}, delay_p50_min=0,
                    delay_p90_min=0, occupancy_mix={}, non_responding=0, feed_freshness_s=0,
                    coverage_pct=0)
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
        Manifest, ManifestFiles, ManifestLiveFiles, ManifestStaticFiles, ManifestHistoricFiles,
    )

    m = Manifest(
        provider="stm", display_name="STM", bbox=[0, 0, 1, 1], attribution="a",
        basemap=None, dataset_version="v", labels={}, surfaces=[],
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
        provider="stm", display_name="STM", bbox=[0, 0, 1, 1], attribution="a",
        basemap="https://x/v1/stm/static/basemap.json", dataset_version="v",
        labels={}, surfaces=[],
        files=ManifestFiles(
            live=ManifestLiveFiles(generated_utc="t"),
            static=ManifestStaticFiles(basemap="static/basemap.json", generated_utc="2026-06-01T00:00:00Z"),
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

    # AlertHistoryEntry old shape still validates; EN/header default None.
    e = AlertHistoryEntry(id="x")
    assert e.header_text is None
    assert e.header_text_en is None
    eh = AlertHistoryEntry(id="x", header_text="Votre ligne", header_text_en="Your line")
    assert eh.header_text_en == "Your line"

    # Freeze-compat: required arrays are exactly the committed ones.
    assert Alert.model_json_schema()["required"] == ["id", "severity", "header_key"]
    assert AlertHistoryEntry.model_json_schema()["required"] == ["id"]


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
    )

    # HeadwayPeriod regularity fields default None; populated roundtrips.
    hp = HeadwayPeriod(shift="am_peak")
    assert hp.cov is None and hp.bunched_pct is None
    assert HeadwayPeriod(shift="am_peak", cov=0.42, bunched_pct=12.5).cov == 0.42

    # RouteReliability.service_spans defaults []; populated roundtrips.
    rr = RouteReliability(generated_utc="t", id="165")
    assert rr.service_spans == []
    full = RouteReliability(
        generated_utc="t",
        id="165",
        service_spans=[
            ServiceSpanPeriod(
                date="2026-06-17", first_trip_utc="2026-06-17T10:00:00Z",
                last_trip_utc="2026-06-18T01:00:00Z", service_span_min=900,
                first_trip_delay_min=0.5, last_trip_delay_min=1.5, trip_count=120,
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
