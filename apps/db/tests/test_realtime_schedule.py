from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from transit_ops.providers.registry import load_provider_manifest
from transit_ops.realtime_schedule import endpoint_due, worker_tick_seconds
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


def test_oc_keeps_30_second_tick():
    manifest = load_provider_manifest(
        Path(__file__).resolve().parents[1] / "config/providers/octranspo.yaml"
    )
    assert worker_tick_seconds(manifest, 30) == 30
    assert all(
        getattr(feed, "refresh_phase_seconds", None) is None for feed in manifest.feeds.values()
    )


def test_live_ttl_shared():
    assert ManifestLiveFiles.model_fields["ttl_s"].default == 20
    assert CACHE_CONTROL["live"] == "public, max-age=20"
    assert "max-age=86400" in CACHE_CONTROL["static"]
