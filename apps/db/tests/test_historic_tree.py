from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from test_historic_snapshot_gc import _build_graph

from transit_ops.snapshots import historic_tree, uploads
from transit_ops.snapshots.protocols import SnapshotPayload
from transit_ops.snapshots.serialization import snapshot_json_bytes


@pytest.mark.parametrize("name", tuple(historic_tree.FAMILIES))
def test_family_walks_the_same_edges_through_memory_versions_and_public_http(name: str) -> None:
    storage, _ = _build_graph()
    family = historic_tree.FAMILIES[name]
    path = next(
        path
        for path in storage.objects
        if (path.startswith(family.root + "/generations/") and path.endswith("/index.json"))
    )
    parent = family.index_model.model_validate_json(storage.objects[path])
    objects = {
        edge.path: edge.model.model_validate_json(storage.objects[edge.path])
        for edge in family.edges(parent)
    }
    memory = historic_tree.MemoryTreeReader(objects)
    requests = []

    def fetch_models(batch):
        requests.extend(path for path, _ in batch)
        return [model.model_validate_json(storage.objects[path]) for path, model in batch]

    http = historic_tree.PublicHttpTreeReader(fetch_models)
    with ThreadPoolExecutor(max_workers=2) as executor:
        stored = historic_tree.StoredVersionReader(storage, storage.versions, executor, {})
        version_results = list(family.walk(stored, parent))

    memory_results = list(family.walk(memory, parent))
    http_results = list(family.walk(http, parent))
    expected_paths = [edge.path for edge in family.edges(parent)]
    assert [edge.path for edge, _ in memory_results] == expected_paths
    assert [edge.path for edge, _ in version_results] == expected_paths
    assert requests == expected_paths
    assert [edge.path for edge, _ in http_results] == expected_paths
    assert (
        [snapshot_json_bytes(payload) for _, payload in memory_results]
        == [snapshot_json_bytes(loaded.payload) for _, loaded in version_results]
        == [snapshot_json_bytes(payload) for _, payload in http_results]
    )


@pytest.mark.parametrize(
    "path,tier,expected",
    [
        ("historic/history/index.json", None, False),
        ("historic/history/network/index.json", "historic", False),
        ("historic/receipts/2026-07-01.json", None, False),
        ("historic/history/network/generations/invalid/index.json", None, True),
        ("legacy-immutable-key.json", "historic_immutable", True),
        ("unrelated/generations/legacy.json", None, True),
    ],
)
def test_write_once_preserves_explicit_tiers_and_legacy_substring_paths(
    path: str,
    tier: str | None,
    expected: bool,
) -> None:
    assert historic_tree.write_once(path, tier) is expected


@pytest.mark.parametrize("family", ("hotspots", "repeat_offenders"))
def test_gate_routes_invalid_calendar_dates_but_gc_blocks_inventory(family: str) -> None:
    path = f"historic/history/{family}/generations/{'a' * 64}/2026-02-30.json"
    assert historic_tree.point_family_from_path(path, index=False) == family
    assert not historic_tree._known_generation_shape(path)


def test_historic_upload_uses_the_tree_write_policy_for_each_item() -> None:
    written = []

    class Sink:
        def put_json(self, key: str, payload: SnapshotPayload, *, tier: str) -> str:
            written.append(("stable", key))
            return key

        def put_immutable_json(self, key: str, payload: SnapshotPayload) -> str:
            written.append(("immutable", key))
            return key

    stable = "historic/history/index.json"
    generation = f"historic/history/network/generations/{'a' * 64}/index.json"
    keys = uploads.put_batch(
        Sink(),
        [
            (stable, {}, "historic"),
            (generation, {}, "historic"),
            ("legacy.json", {}, "historic_immutable"),
        ],
        concurrency=1,
        write_mode="historic",
    )
    assert keys == [stable, generation, "legacy.json"]
    assert written == [("stable", stable), ("immutable", generation), ("immutable", "legacy.json")]
