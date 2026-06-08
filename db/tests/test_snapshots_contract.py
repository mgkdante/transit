import pytest
from pydantic import ValidationError
from transit_ops.snapshots.contract import Vehicle, TripsFile, Trip, StopEta, Status
from transit_ops.snapshots.contract import (
    RouteFile, RouteDirection, RouteStop, StopFile, ScheduledRoute,
    RoutesIndex, RouteIndexEntry, StopsIndex, StopIndexEntry, LabelsFile,
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
    tf = TripsFile(trips={"t1": Trip(route="165", status="late", delay_min=4,
                                     stops=[StopEta(stop="51234", eta_utc="x", delay_min=4)])})
    assert tf.trips["t1"].stops[0].stop == "51234"


def test_route_file_valid():
    rf = RouteFile(id="165", long="Côte-Vertu",
                   directions=[RouteDirection(dir=0, headsign="Côte-Vertu",
                                              stops=[RouteStop(id="51234", seq=1, name="Côte-Vertu / Décarie")])])
    assert rf.directions[0].stops[0].id == "51234"

def test_stop_file_valid():
    sf = StopFile(id="51234", name="Côte-Vertu / Décarie", lat=45.49, lon=-73.66,
                  scheduled=[ScheduledRoute(route="165", headsign="Côte-Vertu", times=["17:46", "17:54"])])
    assert sf.scheduled[0].times[0] == "17:46"

def test_labels_file_valid():
    lf = LabelsFile(labels={"status.on_time": "À l'heure", "status.late": "En retard"})
    assert lf.labels["status.on_time"] == "À l'heure"


def test_historic_models_valid():
    from transit_ops.snapshots.contract import (
        NetworkTrend, RouteReliability, HeadwayPeriod, StopReliability, Hotspots, Hotspot,
        RepeatOffenders, Offender, Receipt, AlertHistory, AlertHistoryEntry, Provenance,
    )
    nt = NetworkTrend(series=[{"date": "2026-05-30", "otp_pct": 39, "avg_delay_min": 3.4, "p90_min": 11, "vehicles": 612}])
    assert nt.series[0].otp_pct == 39
    rr = RouteReliability(id="165", periods=[{"grain": "day", "otp_pct": 47}],
                          headway=[HeadwayPeriod(shift="pm_peak", scheduled_min=6, observed_min=7.8, excess_wait_min=1.8)])
    assert rr.headway[0].excess_wait_min == 1.8
    ro = RepeatOffenders(offenders=[Offender(type="vehicle", id="29051", route="171", recurrence="6/7d", avg_delay_min=8)])
    assert ro.offenders[0].recurrence == "6/7d"
    rc = Receipt(date="2026-05-30", otp_pct=39, worst_route={"id": "171", "otp_delta_pts": -22})
    assert rc.worst_route.id == "171"
    prov = Provenance(retention={"detail_days": 14, "aggregate_days": 365}, gaps=["metro_realtime"])
    assert prov.retention["detail_days"] == 14
