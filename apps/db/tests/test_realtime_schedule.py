from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from transit_ops import orchestration
from transit_ops.providers.registry import load_provider_manifest
from transit_ops.realtime_schedule import endpoint_due, worker_tick_seconds
from transit_ops.settings import Settings
from transit_ops.snapshots.contract import ManifestLiveFiles
from transit_ops.snapshots.storage import CACHE_CONTROL


def stamp(seconds):
    return datetime(2026, 11, 9, tzinfo=UTC) + timedelta(seconds=seconds)


def stm():
    return load_provider_manifest(Path(__file__).resolve().parents[1] / "config/providers/stm.yaml")


def test_stm_budget():
    manifest = stm()
    daily = sum(
        86400 / manifest.feeds[key].refresh_interval_seconds
        for key in ("trip_updates", "vehicle_positions", "i3_alerts")
    )
    assert daily == 7488
    assert daily <= 8000


def test_tick_and_phase():
    manifest = stm()
    assert worker_tick_seconds(manifest, 30) == 10
    vehicle = manifest.feeds["vehicle_positions"]
    history = None
    captured = []
    for second in range(0, 121, 10):
        if endpoint_due(vehicle, stamp(second), history):
            captured.append(second)
            history = stamp(second)
    assert captured == [10, 30, 50, 70, 90, 110]


@pytest.mark.parametrize("elapsed,due", [(17.9, False), (18, True), (20, True)])
def test_interval_tolerance(elapsed, due):
    feed = stm().feeds["trip_updates"].model_copy(update={"refresh_interval_seconds": 20})
    assert endpoint_due(feed, stamp(elapsed), stamp(0)) is due


def test_phase_never_early_or_twice_in_one_slot():
    feed = stm().feeds["vehicle_positions"]
    assert not endpoint_due(feed, stamp(9.9), None)
    assert endpoint_due(feed, stamp(10), None)
    assert not endpoint_due(feed, stamp(29.9), stamp(10))
    assert not endpoint_due(feed, stamp(31), stamp(30))
    assert endpoint_due(feed, stamp(50), stamp(30))
    assert not endpoint_due(feed, stamp(40), stamp(10))
    assert endpoint_due(feed, stamp(50), stamp(10))


def test_oc_captures_vehicles_every_20_seconds_and_trips_every_30():
    manifest = load_provider_manifest(
        Path(__file__).resolve().parents[1] / "config/providers/octranspo.yaml"
    )
    tick = worker_tick_seconds(manifest, 30)
    captured = {key: [] for key in ("vehicle_positions", "trip_updates")}
    history = {}
    for second in range(0, 121, tick):
        for key in captured:
            if endpoint_due(manifest.feeds[key], stamp(second), history.get(key)):
                captured[key].append(second)
                history[key] = stamp(second)

    assert captured["vehicle_positions"] == [0, 20, 40, 60, 80, 100, 120]
    assert captured["trip_updates"] == [0, 30, 60, 90, 120]


def test_static_and_disabled_feeds_do_not_shorten_worker_ticks():
    manifest = stm()
    manifest.feeds["static_schedule"].refresh_interval_seconds = 7
    manifest.feeds["vehicle_positions"].is_enabled = False
    assert worker_tick_seconds(manifest, 30) == 30


@pytest.mark.parametrize(
    "initialization_delay,vehicle_delay,trip_delay",
    [(3, 0, 0), (9, 0, 0), (0, 3, 0), (0, 0, 3)],
)
def test_oc_worker_keeps_endpoint_cadences_after_cycle_work(
    monkeypatch, initialization_delay, vehicle_delay, trip_delay
):
    manifest = load_provider_manifest(
        Path(__file__).resolve().parents[1] / "config/providers/octranspo.yaml"
    )
    now = [stamp(0)]
    captured = {key: [] for key in ("vehicle_positions", "trip_updates")}

    def advance(seconds):
        now[0] += timedelta(seconds=seconds)

    def capture(provider_id, endpoint_key, **kwargs):
        captured[endpoint_key].append((now[0] - stamp(0)).total_seconds())
        if endpoint_key == "vehicle_positions":
            advance(vehicle_delay)
        else:
            advance(trip_delay)
        return orchestration.RealtimeEndpointCycleResult(
            endpoint_key, "succeeded", 0, None, 0, {}, None, None
        )

    monkeypatch.setattr(
        orchestration, "_validate_realtime_worker_startup", lambda *a, **k: manifest
    )
    monkeypatch.setattr(orchestration, "utc_now", lambda: now[0])
    monkeypatch.setattr(
        orchestration, "initialize_realtime_serving", lambda *a, **k: advance(initialization_delay)
    )
    monkeypatch.setattr(orchestration, "_capture_and_load_realtime_source", capture)
    monkeypatch.setattr(orchestration, "_best_effort_publish_live", lambda *a, **k: 0)
    orchestration._run_realtime_worker_loop(
        "octranspo",
        settings=Settings(_env_file=None),
        registry=SimpleNamespace(get_provider=lambda _: manifest),
        engine=object(),
        sleep_fn=advance,
        max_cycles=12,
        utc_now_fn=lambda: now[0],
        perf_counter_fn=lambda: now[0].timestamp(),
        should_shutdown=lambda: False,
        bronze_storage_resolver=lambda _: object(),
    )
    assert captured["vehicle_positions"] == [
        initialization_delay + s + (trip_delay if s % 30 == 0 else 0)
        for s in range(0, 120, 20)
    ]
    assert captured["trip_updates"] == [initialization_delay + s for s in range(0, 120, 30)]


def test_live_ttl_shared():
    assert ManifestLiveFiles.model_fields["ttl_s"].default == 20
    assert CACHE_CONTROL["live"] == "public, max-age=20"
    assert "max-age=86400" in CACHE_CONTROL["static"]
