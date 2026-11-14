"""Synthetic shell timing, not an actual-corpus or populated-rule benchmark."""

from datetime import UTC, datetime
from pathlib import Path
from shutil import copyfile
from statistics import median
from tempfile import TemporaryDirectory
from time import perf_counter

from google.transit.gtfs_realtime_pb2 import FeedMessage

from transit_ops.providers import RawCapture, load_providers, normalize_capture
from transit_ops.providers.modes import WORKER_MODES


def main() -> None:
    message = FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    entities, stops = 1614, 46367
    for index in range(entities):
        trip = message.entity.add(id=f"entity-{index}").trip_update
        trip.trip.trip_id = f"trip-{index}"
        for stop in range(stops // entities + (index < stops % entities)):
            trip.stop_time_update.add(stop_id=f"stop-{index}-{stop}").arrival.delay = stop
    payload = message.SerializeToString()
    capture = RawCapture(
        "trip_updates", "gtfs-rt", payload, datetime(2026, 6, 20, tzinfo=UTC), "synthetic"
    )
    with TemporaryDirectory() as directory:
        source = Path(__file__).resolve().parents[1] / "tests/fixtures/providers/fixture_city.yaml"
        copyfile(source, Path(directory) / source.name)
        provider = load_providers(Path(directory), env={})["fixture_city"]
        start = perf_counter()
        normalize_capture(provider, capture, modes=WORKER_MODES)
        first_call = perf_counter() - start
        warm = []
        for _ in range(20):
            start = perf_counter()
            normalize_capture(provider, capture, modes=WORKER_MODES)
            warm.append(perf_counter() - start)
    print(f"synthetic bytes={len(payload)} entities={entities} stop_updates={stops}")
    print(f"first_call_ms={first_call * 1000:.3f} warm_median_20_ms={median(warm) * 1000:.3f}")


if __name__ == "__main__":
    main()
