import pytest
from pydantic import ValidationError
from transit_ops.snapshots.contract import Vehicle, TripsFile, Trip, StopEta, Status

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
