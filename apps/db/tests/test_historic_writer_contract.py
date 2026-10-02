import json
from types import SimpleNamespace

import pytest
from snapshot_storage_fixtures import MemorySnapshotStore

from transit_ops.snapshots import historic_tier, publish
from transit_ops.snapshots.protocols import HistoricWriter, PayloadSink, SnapshotObjectStore
from transit_ops.snapshots.storage import (
    HashGatedStorage,
    HistoricHashGatedStorage,
    ImmutableKeyCollisionError,
    SnapshotStorage,
    StableActivationConflictError,
)


class _NoDatabaseWork:
    def begin(self):
        raise AssertionError("Invalid historic storage reached the database")


class _MutableStore:
    def get_json(self, key):
        raise AssertionError("Invalid historic storage read hash state")

    def full_key(self, key):
        return key

    def put_bytes(self, key, body, *, tier):
        raise AssertionError("Invalid historic storage wrote bytes")


@pytest.mark.parametrize("target", [_MutableStore, publish._CollectingStorage])
@pytest.mark.parametrize("force", [False, True])
@pytest.mark.parametrize("gate_enabled", [False, True])
def test_real_historic_publication_rejects_non_cas_target_before_any_work(
    target, force, gate_enabled
):
    with pytest.raises(TypeError, match="historic"):
        publish.publish_snapshot(
            "stm",
            tier="historic",
            storage=target(),
            engine=_NoDatabaseWork(),
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            gate_enabled=gate_enabled,
            force=force,
        )


def test_historic_engine_rejects_a_collector_before_building():
    collector = publish._CollectingStorage()
    with pytest.raises(TypeError, match="historic"):
        historic_tier.publish(
            object(),
            collector,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        )
    assert collector.collected == []


def test_mutable_hash_gate_does_not_advertise_historic_operations():
    gated = HashGatedStorage(_MutableStore(), state_rel_key="state.json", fingerprint="v1")
    assert isinstance(gated, PayloadSink)
    assert not isinstance(gated, HistoricWriter)
    assert isinstance(_MutableStore(), SnapshotObjectStore)
    with pytest.raises(TypeError, match="historic"):
        HistoricHashGatedStorage(_MutableStore(), state_rel_key="state.json", fingerprint="v1")


@pytest.mark.parametrize(
    "cache",
    [
        None,
        [],
        {"fingerprint": "v1"},
        {"fingerprint": "v1", "hashes": []},
        {"fingerprint": "v1", "hashes": {}},
        {"fingerprint": "v1", "hashes": {"item.json": 42}},
        {"fingerprint": "v1", "hashes": {"item.json": "invalid"}},
        {"fingerprint": "v1", "hashes": {"item.json": "a" * 64}},
        {"fingerprint": "v1", "hashes": "not a map"},
    ],
)
def test_malformed_or_empty_hash_cache_rebuilds_without_enabling_dataset_skip(cache):
    store = MemorySnapshotStore()
    store.objects["state.json"] = json.dumps(cache).encode()
    gated = HashGatedStorage(store, state_rel_key="state.json", fingerprint="v1")
    gated.load()
    assert not gated.fingerprint_matched
    gated.put_json("item.json", {"value": 1}, tier="static")
    gated.flush_state()
    assert gated.written == ["item.json"]
    assert gated.skipped == []
    repeated = HashGatedStorage(store, state_rel_key="state.json", fingerprint="v1")
    repeated.load()
    assert repeated.fingerprint_matched
    repeated.put_json("item.json", {"value": 1}, tier="static")
    assert repeated.skipped == ["item.json"]


@pytest.mark.parametrize("body", [b"not json", b"\xff", b"[]"])
def test_undecodable_hash_cache_is_a_miss(body):
    store = MemorySnapshotStore()
    store.objects["state.json"] = body
    gated = HashGatedStorage(store, state_rel_key="state.json", fingerprint="v1")
    gated.load()
    assert not gated.fingerprint_matched
    gated.put_json("item.json", {"value": 1}, tier="static")
    assert gated.written == ["item.json"]


def test_invalid_durable_root_version_remains_a_strict_failure():
    store = SnapshotStorage(
        SimpleNamespace(head_object=lambda **kwargs: {"ContentLength": 12}),
        bucket="snapshots",
        base_prefix="v1/stm",
    )
    gated = HistoricHashGatedStorage(store, state_rel_key="state.json", fingerprint="v1")
    with pytest.raises(RuntimeError, match="stable object has no ETag"):
        gated.capture_stable_version("historic/history/index.json")


def test_memory_publication_adapter_enforces_real_conditional_and_immutable_outcomes():
    store = MemorySnapshotStore()
    key = "historic/history/index.json"
    captured = store.capture_stable_version(key)
    first = store.activate_stable_json_outcome(
        key,
        {"generation": 1},
        expected_version=captured,
        tier="historic",
    )
    assert first.written
    repeated = store.activate_stable_json_outcome(
        key,
        {"generation": 1},
        expected_version=captured,
        tier="historic",
    )
    assert not repeated.written
    with pytest.raises(StableActivationConflictError):
        store.activate_stable_json_outcome(
            key,
            {"generation": 2},
            expected_version=captured,
            tier="historic",
        )
    immutable = "historic/history/network/generations/example/day.json"
    assert store.put_immutable_json_outcome(immutable, {"value": 1}).written
    assert not store.put_immutable_json_outcome(immutable, {"value": 1}).written
    with pytest.raises(ImmutableKeyCollisionError):
        store.put_immutable_json_outcome(immutable, {"value": 2})
    assert store.get_json(immutable) == {"value": 1}
