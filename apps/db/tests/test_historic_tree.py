from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import model_validator
from test_historic_snapshot_gc import (
    PUBLISH_ID,
    STAMP,
    MemorySnapshotStorage,
    _archive_page,
    _build_graph,
)

from transit_ops.snapshots import historic_tree, uploads
from transit_ops.snapshots.builders.historic.alert_archive import _collection_generation_id
from transit_ops.snapshots.contract import AlertArchiveIndex, AlertArchiveMonth, AlertArchivePageRef
from transit_ops.snapshots.protocols import SnapshotPayload
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256


@pytest.mark.parametrize("page_count", [2, 16, 64])
def test_alert_walk_page_reference_validation_work_is_linear(
    monkeypatch: pytest.MonkeyPatch,
    page_count: int,
) -> None:
    storage = MemorySnapshotStorage()
    _path, template, template_ref = _archive_page()
    refs = []
    for number in range(1, page_count + 1):
        page = template.model_copy(deep=True, update={"page": number})
        page.alerts[0].id = f"alert-{number:04d}"
        digest = snapshot_sha256(page)
        path = historic_tree.FAMILIES["alerts"].leaf_path(
            digest,
            f"{page.month}/page-{number:04d}",
        )
        refs.append(
            template_ref.model_copy(
                update={
                    "path": path,
                    "page": number,
                    "sha256": digest,
                    "byte_size": len(snapshot_json_bytes(page)),
                }
            )
        )
        storage.put(path, page)
    month = AlertArchiveMonth(month=template.month, total_alerts=page_count, pages=refs)
    index = AlertArchiveIndex(
        generated_utc=STAMP,
        methodology_version="alerts-1",
        publish_generation_id=PUBLISH_ID,
        collection_generation_id=_collection_generation_id(
            [month],
            template_ref.coverage_start,
            template_ref.coverage_end,
        ),
        first_available_date=template_ref.coverage_start,
        last_available_date=template_ref.coverage_end,
        total_alerts=page_count,
        months=[month],
    )
    index_path = storage.put("historic/alerts/index.json", index)
    validations = 0

    class CountedRef(AlertArchivePageRef):
        @model_validator(mode="before")
        @classmethod
        def count_validation(cls, value: object) -> object:
            nonlocal validations
            validations += 1
            return value

    class CountedMonth(AlertArchiveMonth):
        pages: list[CountedRef]

    class CountedIndex(AlertArchiveIndex):
        months: list[CountedMonth]

    # Count nested Pydantic validation too, not just Python model_validate calls.
    # Keep the month alias instrumented even when traversal no longer needs it.
    monkeypatch.setattr(historic_tree, "AlertArchiveIndex", CountedIndex)
    monkeypatch.setattr(historic_tree, "AlertArchiveMonth", CountedMonth, raising=False)
    monkeypatch.setattr(historic_tree, "AlertArchivePageRef", CountedRef)
    with ThreadPoolExecutor(max_workers=2) as executor:
        reader = historic_tree.StoredVersionReader(storage, storage.versions, executor, {})
        loaded = reader.walk_alerts(index_path)
    assert loaded.total_alerts == page_count
    assert len(storage.conditional_read_calls) == page_count + 1
    # Counted validation must run, but work is bounded by a constant per page.
    # One root decode and at most two explicit reference checks, no N-by-N month decode.
    assert page_count <= validations <= 3 * page_count


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
