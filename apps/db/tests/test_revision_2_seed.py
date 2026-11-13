from datetime import UTC, datetime, time, timedelta

import pytest
import revision_2_seed as seed
from google.transit import gtfs_realtime_pb2 as rt


def _gold_schedule(service_date, clock: str) -> datetime:
    """Gold's reading of a GTFS time: local noon on the service date, minus 12 elapsed hours."""
    hours, minutes, seconds = (int(part) for part in clock.split(":"))
    noon = datetime.combine(service_date, time(12), seed.TZ).astimezone(UTC)
    return noon - timedelta(hours=12) + timedelta(hours=hours, minutes=minutes, seconds=seconds)


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
        scheduled = [seed._gtfs(first + seed.GAP * index) for index in range(len(offsets))]
        assert [_gold_schedule(service_date, clock) for clock in scheduled] == planned
