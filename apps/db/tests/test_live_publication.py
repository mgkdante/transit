from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from snapshot_storage_fixtures import MemorySnapshotStore
from test_snapshots_publish import FakeConn, FakeSettings

from transit_ops.providers.registry import load_provider_manifest
from transit_ops.realtime_schedule import endpoint_due, worker_tick_seconds
from transit_ops.snapshots import gate, live_publication, publish


@pytest.mark.parametrize(
    ("changed", "count"),
    [
        ({"vehicle_positions"}, 4),
        ({"trip_updates"}, 6),
        ({"i3_alerts"}, 3),
        ({"vehicle_positions", "trip_updates"}, 6),
        ({"vehicle_positions", "trip_updates", "i3_alerts"}, 7),
    ],
)
def test_tick_writes_and_gate_scope(monkeypatch, changed, count):
    captures = {
        key: "2026-11-09T00:00:00Z" for key in ("vehicle_positions", "trip_updates", "i3_alerts")
    }
    monkeypatch.setattr(
        publish.builders.live, "_feed_captured_utc", lambda conn, provider_id, key: captures[key]
    )
    monkeypatch.setattr(publish, "_static_stamp", lambda *args: "static")
    store = MemorySnapshotStore()
    args = dict(provider_id="stm", settings=FakeSettings(), gen="2026-11-09T00:00:00Z")
    publish._publish_live(FakeConn(), store, **args)
    old = dict(store.objects)
    for key in changed:
        captures[key] = "2026-11-09T00:00:20Z"
    store.keys.clear()
    args["gen"] = "2026-11-09T00:00:20Z"
    report = gate.new_report("stm", "live", args["gen"])
    publish._publish_live(FakeConn(), store, gate_report=report, **args)
    assert len(store.keys) == count
    assert report.payloads_checked == count
    assert store.keys[-1] == "manifest.json"
    manifest = store.get_json("manifest.json")
    for key in live_publication.FILES:
        payload = store.get_json(key)
        assert manifest["files"]["live"]["generations"][key] == payload["publish_generation_id"]
        if key not in store.keys:
            assert store.objects[key] == old[key]


# OC's 60 s cycle writes 6 (both), 4 (vehicles), 6 (trips), then 4 (vehicles).
@pytest.mark.parametrize(("provider", "expected"), [("stm", 29088), ("octranspo", 28800)])
def test_daily_write_budget(provider, expected):
    manifest = load_provider_manifest(
        Path(__file__).resolve().parents[1] / f"config/providers/{provider}.yaml"
    )
    previous = {}
    captures = {key: None for key in ("vehicle_positions", "trip_updates", "i3_alerts")}
    captures["static_schedule"] = "static"
    # Seed a completed publication, excluding its one-time seven-write bootstrap.
    prior = {
        "files": {
            "live": {
                "generations": dict.fromkeys(live_publication.FILES, "seed"),
                "input_captures": dict(captures),
            }
        }
    }
    writes = 0
    tick = worker_tick_seconds(manifest, 30)
    for second in range(0, 86400, tick):
        now = datetime(2026, 11, 9, tzinfo=UTC) + timedelta(seconds=second)
        changed = False
        for key in captures.keys() - {"static_schedule"}:
            feed = manifest.feeds.get(key)
            if feed is not None and feed.is_enabled and endpoint_due(feed, now, previous.get(key)):
                previous[key] = now
                captures[key] = now.isoformat()
                changed = True
        if changed:
            keys, generations = live_publication.select(prior, captures)
            writes += len(keys) + 1
            prior = {
                "files": {"live": {"generations": generations, "input_captures": dict(captures)}}
            }
    assert writes == expected
    if provider == "stm":
        assert writes <= 30000


def test_failed_manifest_retries_pending_inputs_on_next_family_tick(monkeypatch):
    captures = {key: "old" for key in ("vehicle_positions", "trip_updates", "i3_alerts")}
    monkeypatch.setattr(
        publish.builders.live, "_feed_captured_utc", lambda conn, provider_id, key: captures[key]
    )
    monkeypatch.setattr(publish, "_static_stamp", lambda *args: "static")
    store = MemorySnapshotStore()
    args = dict(provider_id="stm", settings=FakeSettings(), gen="2026-11-09T00:00:00Z")
    publish._publish_live(FakeConn(), store, **args)
    old_manifest = store.objects["manifest.json"]
    captures["vehicle_positions"] = "new"
    store.fail_key = "manifest.json"
    with pytest.raises(RuntimeError):
        publish._publish_live(FakeConn(), store, **args)
    assert store.objects["manifest.json"] == old_manifest
    captures["i3_alerts"] = "new"
    store.fail_key = None
    store.keys.clear()
    publish._publish_live(FakeConn(), store, **args)
    assert set(store.keys) == {
        "live/vehicles.json",
        "live/network.json",
        "live/alerts.json",
        "status/data_health.json",
        "manifest.json",
    }


def test_static_change_invalidates_all_live_files():
    prior = {
        "files": {
            "live": {
                "generations": dict.fromkeys(live_publication.FILES, "old"),
                "input_captures": {"static_schedule": "old"},
            }
        }
    }
    keys, _ = live_publication.select(prior, {"static_schedule": "new"})
    assert set(keys) == set(live_publication.FILES)


@pytest.mark.parametrize("prior", [None, {}, {"files": {"live": {"generated_utc": "old"}}}])
def test_first_or_legacy_publication_builds_every_file(prior):
    keys, generations = live_publication.select(prior, {"static_schedule": "static"})
    assert set(keys) == set(live_publication.FILES)
    assert generations == {}


def test_failed_payload_does_not_advance_manifest(monkeypatch):
    captures = {key: "old" for key in ("vehicle_positions", "trip_updates", "i3_alerts")}
    monkeypatch.setattr(
        publish.builders.live, "_feed_captured_utc", lambda conn, provider_id, key: captures[key]
    )
    monkeypatch.setattr(publish, "_static_stamp", lambda *args: "static")
    store = MemorySnapshotStore()
    args = dict(provider_id="stm", settings=FakeSettings(), gen="2026-11-09T00:00:00Z")
    publish._publish_live(FakeConn(), store, **args)
    old_manifest = store.objects["manifest.json"]
    captures["trip_updates"] = "new"
    store.fail_key = "live/trips.json"
    with pytest.raises(RuntimeError):
        publish._publish_live(FakeConn(), store, **args)
    assert store.objects["manifest.json"] == old_manifest
    store.fail_key = None
    store.keys.clear()
    publish._publish_live(FakeConn(), store, **args)
    assert len(store.keys) == 6
