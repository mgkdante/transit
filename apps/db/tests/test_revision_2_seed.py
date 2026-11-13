from datetime import UTC, datetime, timedelta

import pytest
import revision_2_seed as seed
from google.transit import gtfs_realtime_pb2 as rt


# Each side of the spring and autumn clock changes in Toronto.
@pytest.mark.parametrize(
    "t0",
    [
        datetime(2027, 3, 14, 6, 30, tzinfo=UTC),
        datetime(2027, 3, 14, 16, tzinfo=UTC),
        datetime(2026, 11, 1, 5, 30, tzinfo=UTC),
        datetime(2026, 11, 1, 16, tzinfo=UTC),
    ],
)
def test_live_trips_keep_their_stops_around_t0_across_clock_changes(t0):
    service_date, first = seed.live_schedule(t0)
    feed = rt.FeedMessage.FromString(
        seed._feed("tu", t0 - timedelta(seconds=30), service_date, "L", first)
    )
    offsets = [timedelta(seconds=s) for s in (-1200, 600, 2400)]
    for entity, (*_trip, delay) in zip(feed.entity, seed.TRIPS, strict=True):
        if not isinstance(delay, int):
            continue
        updates = entity.trip_update.stop_time_update
        planned = [datetime.fromtimestamp(u.arrival.time - delay, UTC) for u in updates]
        assert planned == [t0 + offset for offset in offsets]
