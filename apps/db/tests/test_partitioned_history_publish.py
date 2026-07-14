from __future__ import annotations

import hashlib
import re
import threading
from contextlib import contextmanager
from copy import deepcopy
from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest
from test_partitioned_history_builders import _line_history_rows, _network_history_rows

from transit_ops.snapshots import gate, publish
from transit_ops.snapshots.builders.historic.history_common import (
    PointHistorySummary,
    encode_history_entity_id,
    history_entity_directory_generation_id,
    history_index_generation_id,
    history_partition_ref,
)
from transit_ops.snapshots.builders.historic.line_history import (
    LineHistoryStreamSummary as BuilderLineHistoryStreamSummary,
)
from transit_ops.snapshots.builders.historic.line_history import (
    build_line_history_plan_from_rows,
)
from transit_ops.snapshots.builders.historic.network_history import (
    build_network_history_from_rows,
    build_network_history_plan_from_rows,
)
from transit_ops.snapshots.builders.historic.stop_history import (
    StopHistoryStreamSummary as BuilderStopHistoryStreamSummary,
)
from transit_ops.snapshots.builders.historic.stop_history import (
    build_stop_history_plan_from_rows,
)
from transit_ops.snapshots.publish import (
    _publish_historic,
    _stable_outcome_total,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256
from transit_ops.snapshots.storage import ImmutableKeyCollisionError


@pytest.fixture(autouse=True)
def _empty_point_history_plans(monkeypatch: pytest.MonkeyPatch) -> None:
    empty = SimpleNamespace(iter_days=lambda: iter(()))
    monkeypatch.setattr(
        publish.builders,
        "build_hotspots_history_plan",
        lambda *args, **kwargs: empty,
    )
    monkeypatch.setattr(
        publish.builders,
        "build_repeat_offenders_history_plan",
        lambda *args, **kwargs: empty,
    )
    monkeypatch.setattr(
        publish,
        "_clear_referenced_historic_gc_marks",
        lambda *args, **kwargs: None,
        raising=False,
    )


def _network_history_bundle():
    delay, fact, cancellation, occupancy = _network_history_rows()
    return build_network_history_from_rows(
        delay_rows=delay,
        fact_rows=fact,
        cancellation_rows=cancellation,
        occupancy_rows=occupancy,
        generated_utc="2026-07-13T00:00:00Z",
    )


def _network_history_plan():
    delay, fact, cancellation, occupancy = _network_history_rows()
    return build_network_history_plan_from_rows(
        delay_rows=delay,
        fact_rows=fact,
        cancellation_rows=cancellation,
        occupancy_rows=occupancy,
        generated_utc="2026-07-13T00:00:00Z",
    )


def _large_network_history_plan(month_count: int = 70):
    delay_rows = []
    for offset in range(month_count):
        year = 2020 + offset // 12
        month = offset % 12 + 1
        local_date = date(year, month, 1)
        delay_rows.append(
            {
                "local_date": local_date,
                "observation_count": 1,
                "in_clamp_observation_count": 1,
                "on_time_count": 1,
                "severe_count": 0,
                "sum_delay_seconds": 0,
                "source_generated_utc": datetime(year, month, 2, tzinfo=UTC),
            }
        )
    return build_network_history_plan_from_rows(
        delay_rows=delay_rows,
        fact_rows=[],
        cancellation_rows=[],
        occupancy_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
    )


def _line_history_plan():
    delay, percentiles, cancellation, occupancy, service_span, skipped_stops = _line_history_rows()
    return build_line_history_plan_from_rows(
        delay_rows=delay,
        percentile_rows=percentiles,
        cancellation_rows=cancellation,
        occupancy_rows=occupancy,
        service_span_rows=service_span,
        skipped_stop_rows=skipped_stops,
        generated_utc="2026-07-13T00:00:00Z",
        entity_batch_size=2,
    )


def _empty_line_history_plan():
    return build_line_history_plan_from_rows(
        delay_rows=[],
        percentile_rows=[],
        cancellation_rows=[],
        occupancy_rows=[],
        service_span_rows=[],
        skipped_stop_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
    )


def _stop_history_plan():
    return build_stop_history_plan_from_rows(
        delay_rows=[
            {
                "stop_id": "A/B é雪",
                "local_date": "2026-06-30",
                "observation_count": 4,
                "severe_count": 0,
                "sum_delay_seconds": 90,
                "source_generated_utc": "2026-07-01T10:00:00Z",
            },
            {
                "stop_id": "A/B é雪",
                "local_date": "2026-07-02",
                "observation_count": 5,
                "severe_count": 1,
                "sum_delay_seconds": 120,
                "source_generated_utc": "2026-07-03T08:00:00Z",
            },
        ],
        percentile_rows=[],
        occupancy_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
    )


def _empty_stop_history_plan():
    return build_stop_history_plan_from_rows(
        delay_rows=[],
        percentile_rows=[],
        occupancy_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
    )


def _empty_point_history_indexes(
    stamp: str = "2026-07-13T00:00:00Z",
):
    indexes = tuple(
        PointHistorySummary(family).build_index(fallback_generated_utc=stamp)
        for family in ("hotspots", "repeat_offenders")
    )
    for index in indexes:
        publish._stamp_envelope(  # noqa: SLF001
            [("unused", index, "historic")],
            provider_id="stm",
            stamp=stamp,
        )
    return indexes


def _many_stop_history_plan(count: int = 5):
    return build_stop_history_plan_from_rows(
        delay_rows=[
            {
                "stop_id": f"S{position:03d}",
                "local_date": "2026-07-01",
                "observation_count": 1,
                "severe_count": 0,
                "sum_delay_seconds": 0,
                "source_generated_utc": "2026-07-02T00:00:00Z",
            }
            for position in range(count)
        ],
        percentile_rows=[],
        occupancy_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
    )


class _MalformedStopPartitionPlan:
    def __init__(self) -> None:
        bundle = _stop_history_plan().materialize()
        self.ref = bundle.indexes[0].partitions[0].model_copy(deep=True)
        self.partition = bundle.partitions[0].model_dump(mode="json")
        self.partition["days"] = [7]

    def iter_partition_items(self):  # noqa: ANN201
        yield self.ref, self.partition


class _MalformedNetworkRefPlan:
    def __init__(self) -> None:
        self.plan = _network_history_plan()
        self.malformed_path: str | None = None

    def iter_partition_items(self):  # noqa: ANN201
        for position, (ref, partition) in enumerate(self.plan.iter_partition_items()):
            malformed_ref = ref.model_copy(deep=True)
            if position == 0:
                malformed_ref.count = -1
                self.malformed_path = malformed_ref.path
            yield malformed_ref, partition

    def build_index(self, refs):  # noqa: ANN001, ANN201
        return self.plan.build_index(refs)


class _MalformedLineRefPlan:
    def __init__(self) -> None:
        self.plan = _line_history_plan()
        self.malformed_path: str | None = None

    def iter_partition_items(self):  # noqa: ANN201
        for position, (ref, partition) in enumerate(self.plan.iter_partition_items()):
            malformed_ref = ref.model_copy(deep=True)
            if position == 0:
                malformed_ref.count = -1
                self.malformed_path = malformed_ref.path
            yield malformed_ref, partition


class _MalformedStopIndexSummary:
    def __init__(self) -> None:
        self.summary = BuilderStopHistoryStreamSummary()

    def observe(self, ref, partition):  # noqa: ANN001, ANN201
        return self.summary.observe(ref, partition)

    def iter_indexes(self, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        for index in self.summary.iter_indexes(fallback_generated_utc=fallback_generated_utc):
            index.available_dates.append(None)
            index.collection_generation_id = history_index_generation_id(index)
            yield index


@pytest.fixture(autouse=True)
def _default_empty_line_history(monkeypatch):
    """Keep pre-Line publisher tests scoped to their original Network subject."""

    monkeypatch.setattr(
        publish.builders,
        "build_line_history_plan",
        lambda *args, **kwargs: _empty_line_history_plan(),
        raising=False,
    )
    monkeypatch.setattr(
        publish.builders,
        "build_stop_history_plan",
        lambda *args, **kwargs: _empty_stop_history_plan(),
        raising=False,
    )


class _MaterializedNetworkPlan:
    def __init__(self, bundle) -> None:  # noqa: ANN001
        self.bundle = bundle

    def iter_partition_items(self):  # noqa: ANN201
        return iter(zip(self.bundle.index.partitions, self.bundle.partitions, strict=True))

    def build_index(self, refs):  # noqa: ANN001, ANN201
        index = self.bundle.index.model_copy(deep=True)
        index.partitions = list(refs)
        index.collection_generation_id = history_index_generation_id(index)
        return index


class _SelfConsistentEmptyIndexPlan:
    """Streams real children, then lies with a self-consistent empty pointer."""

    def __init__(self, plan) -> None:  # noqa: ANN001
        self.plan = plan

    def iter_partition_items(self):  # noqa: ANN201
        return self.plan.iter_partition_items()

    def build_index(self, refs):  # noqa: ANN001, ANN201
        index = self.plan.build_index(refs)
        index.generated_utc = self.plan.fallback_generated_utc
        index.first_available_date = None
        index.last_available_date = None
        index.available_dates = []
        index.gaps = []
        index.partitions = []
        for metric in index.metrics:
            metric.first_available_date = None
            metric.last_available_date = None
            metric.gaps = []
        index.collection_generation_id = history_index_generation_id(index)
        return index


class _ClearsIndexRefInputsPlan:
    """Mutates the supplied ref list before returning an otherwise honest index."""

    def __init__(self, plan) -> None:  # noqa: ANN001
        self.plan = plan

    def iter_partition_items(self):  # noqa: ANN201
        return self.plan.iter_partition_items()

    def build_index(self, refs):  # noqa: ANN001, ANN201
        refs.clear()
        return self.plan.build_index(refs)


class _PoisonsIndexRefInputsPlan:
    """Repoints a supplied ref after its real immutable child was uploaded."""

    def __init__(self, plan) -> None:  # noqa: ANN001
        self.plan = plan

    def iter_partition_items(self):  # noqa: ANN201
        return self.plan.iter_partition_items()

    def build_index(self, refs):  # noqa: ANN001, ANN201
        refs = list(refs)
        poisoned_sha = "0" * 64
        first = refs[0]
        month_file = first.path.rsplit("/", maxsplit=1)[-1]
        first.path = f"historic/history/network/generations/{poisoned_sha}/{month_file}"
        first.sha256 = poisoned_sha
        return self.plan.build_index(refs)


class _SelfConsistentOmittingLineSummary:
    """Streams every Line child, then omits one entity from both mutable parents."""

    def __init__(self) -> None:
        self.summary = BuilderLineHistoryStreamSummary()

    def observe(self, ref, partition):  # noqa: ANN001, ANN201
        return self.summary.observe(ref, partition)

    def build_indexes(self, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        return self.summary.build_indexes(fallback_generated_utc=fallback_generated_utc)[:-1]

    def build_directory(self, indexes, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        return self.summary.build_directory(
            indexes,
            fallback_generated_utc=fallback_generated_utc,
        )


class _ClearsLineDirectoryInputsSummary:
    """Clears the supplied entity-index list before returning an empty directory."""

    def __init__(self) -> None:
        self.summary = BuilderLineHistoryStreamSummary()

    def observe(self, ref, partition):  # noqa: ANN001, ANN201
        return self.summary.observe(ref, partition)

    def build_indexes(self, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        return self.summary.build_indexes(fallback_generated_utc=fallback_generated_utc)

    def build_directory(self, indexes, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        indexes.clear()
        return self.summary.build_directory(
            indexes,
            fallback_generated_utc=fallback_generated_utc,
        )


class _PoisonsLineIndexSummary:
    """Returns a self-consistent entity index that drops its streamed months."""

    def __init__(self) -> None:
        self.summary = BuilderLineHistoryStreamSummary()

    def observe(self, ref, partition):  # noqa: ANN001, ANN201
        return self.summary.observe(ref, partition)

    def build_indexes(self, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        indexes = self.summary.build_indexes(fallback_generated_utc=fallback_generated_utc)
        poisoned = indexes[0]
        poisoned.generated_utc = fallback_generated_utc
        poisoned.first_available_date = None
        poisoned.last_available_date = None
        poisoned.available_dates = []
        poisoned.gaps = []
        poisoned.partitions = []
        for metric in poisoned.metrics:
            metric.first_available_date = None
            metric.last_available_date = None
            metric.gaps = []
        poisoned.collection_generation_id = history_index_generation_id(poisoned)
        return indexes

    def build_directory(self, indexes, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        return self.summary.build_directory(
            indexes,
            fallback_generated_utc=fallback_generated_utc,
        )


class _MutatesSuppliedLineRefSummary:
    """Mutates an observed ref object after its immutable child was uploaded."""

    def __init__(self) -> None:
        self.summary = BuilderLineHistoryStreamSummary()
        self.supplied_refs = []

    def observe(self, ref, partition):  # noqa: ANN001, ANN201
        self.supplied_refs.append(ref)
        return self.summary.observe(ref, partition)

    def build_indexes(self, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        supplied = self.supplied_refs[0]
        entity_id = next(iter(self.summary.refs))
        retained = self.summary.refs[entity_id][0]
        poisoned_sha = "0" * 64
        month_file = supplied.path.rsplit("/", maxsplit=1)[-1]
        encoded_id = encode_history_entity_id(entity_id)
        poisoned_path = (
            f"historic/history/lines/{encoded_id}/generations/{poisoned_sha}/{month_file}"
        )
        supplied.path = poisoned_path
        supplied.sha256 = poisoned_sha
        retained.path = poisoned_path
        retained.sha256 = poisoned_sha
        return self.summary.build_indexes(fallback_generated_utc=fallback_generated_utc)

    def build_directory(self, indexes, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        return self.summary.build_directory(
            indexes,
            fallback_generated_utc=fallback_generated_utc,
        )


class _MutatesLineIndexBeforeDirectorySummary:
    """Poisons a supplied child-index object while building a self-consistent directory."""

    def __init__(self) -> None:
        self.summary = BuilderLineHistoryStreamSummary()

    def observe(self, ref, partition):  # noqa: ANN001, ANN201
        return self.summary.observe(ref, partition)

    def build_indexes(self, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        return self.summary.build_indexes(fallback_generated_utc=fallback_generated_utc)

    def build_directory(self, indexes, *, fallback_generated_utc):  # noqa: ANN001, ANN201
        indexes[0].collection_generation_id = "mutated-child-generation"
        return self.summary.build_directory(
            indexes,
            fallback_generated_utc=fallback_generated_utc,
        )


class _MaterializedLinePlan:
    def __init__(self, bundle) -> None:  # noqa: ANN001
        self.bundle = bundle

    def iter_partition_items(self):  # noqa: ANN201
        refs = [ref for index in self.bundle.indexes for ref in index.partitions]
        return iter(zip(refs, self.bundle.partitions, strict=True))


def _gate_report(enabled: bool):
    return gate.new_report("stm", "historic", "2026-07-13T00:00:00Z") if enabled else None


def _readdress_network_bundle(index, partitions):  # noqa: ANN001, ANN202
    index.partitions = []
    for partition in partitions:
        digest = snapshot_sha256(partition)
        path = f"historic/history/network/generations/{digest}/{partition.month}.json"
        index.partitions.append(history_partition_ref(path, partition))
    index.collection_generation_id = history_index_generation_id(index)
    return [
        (ref.path, partition) for ref, partition in zip(index.partitions, partitions, strict=True)
    ]


class _RecordingStore:
    def __init__(self, *, fail_index: bool = False, fail_partition: bool = False) -> None:
        self.calls: list[tuple[str, str]] = []
        self.objects: dict[str, bytes] = {}
        self.immutable_written: list[str] = []
        self.immutable_skipped: list[str] = []
        self.fail_index = fail_index
        self.fail_partition = fail_partition

    def capture_stable_version(self, rel_key):  # noqa: ANN001, ANN201
        body = self.objects.get(rel_key)
        token = hashlib.sha256(body).hexdigest() if body is not None else None
        return SimpleNamespace(rel_key=rel_key, token=token)

    def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
        body = snapshot_json_bytes(payload)
        self.calls.append(("immutable", rel_key))
        if self.fail_partition:
            raise RuntimeError("partition write failed")
        if self.fail_index and re.fullmatch(
            r"historic/history/network/generations/[0-9a-f]{64}/index\.json",
            rel_key,
        ):
            raise RuntimeError("index write failed")
        if self.objects.get(rel_key) == body:
            self.immutable_skipped.append(rel_key)
        else:
            self.objects[rel_key] = body
            self.immutable_written.append(rel_key)
        return rel_key

    def put_json(self, rel_key, payload, *, tier):  # noqa: ANN001, ANN201, ARG002
        self.calls.append(("normal", rel_key))
        self.objects[rel_key] = snapshot_json_bytes(payload)
        return rel_key

    def activate_stable_json(
        self,
        rel_key,
        payload,
        *,
        expected_version,
        tier,
    ):  # noqa: ANN001, ANN201
        current = self.capture_stable_version(rel_key)
        if current.token != expected_version.token:
            raise RuntimeError("stable activation conflict")
        return self.put_json(rel_key, payload, tier=tier)


def _patch_minimal_historic(
    monkeypatch,
    *,
    line_plan=None,
    network_plan=None,
    stop_plan=None,
    compatibility_items=None,
    archive=None,
):
    from transit_ops.snapshots.contract import AlertArchiveIndex, ReceiptsIndex

    archive = archive or SimpleNamespace(
        index=AlertArchiveIndex(
            generated_utc="2026-07-13T00:00:00Z",
            collection_generation_id=snapshot_sha256(
                {
                    "first_available_date": None,
                    "last_available_date": None,
                    "months": [],
                }
            ),
            first_available_date=None,
            last_available_date=None,
            total_alerts=0,
            months=[],
        ),
        page_items=[],
        provider_timezone="UTC",
    )
    compatibility_items = list(compatibility_items or [])
    if not any(path == "historic/receipts/index.json" for path, *_rest in compatibility_items):
        compatibility_items.append(
            (
                "historic/receipts/index.json",
                ReceiptsIndex(
                    generated_utc="2026-07-13T00:00:00Z",
                    collection_generation_id=publish._receipts_collection_generation_id({}),
                    dates=[],
                ),
                "historic",
            )
        )
    if not any(path == "historic/alerts/index.json" for path, *_rest in compatibility_items):
        compatibility_items.append(("historic/alerts/index.json", archive.index, "historic"))
    stages = [(compatibility_items, "normal")] if compatibility_items else []
    monkeypatch.setattr(
        publish,
        "_build_historic_items",
        lambda *args, **kwargs: (compatibility_items, [], stages, archive),
    )
    monkeypatch.setattr(
        publish.builders,
        "build_network_history_plan",
        lambda *args, **kwargs: network_plan or _network_history_plan(),
    )
    monkeypatch.setattr(
        publish.builders,
        "build_line_history_plan",
        lambda *args, **kwargs: line_plan or _line_history_plan(),
        raising=False,
    )
    monkeypatch.setattr(
        publish.builders,
        "build_stop_history_plan",
        lambda *args, **kwargs: stop_plan or _empty_stop_history_plan(),
        raising=False,
    )
    empty_point_plan = SimpleNamespace(iter_days=lambda: iter(()))
    monkeypatch.setattr(
        publish.builders,
        "build_hotspots_history_plan",
        lambda *args, **kwargs: empty_point_plan,
    )
    monkeypatch.setattr(
        publish.builders,
        "build_repeat_offenders_history_plan",
        lambda *args, **kwargs: empty_point_plan,
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *args, **kwargs: [])


def _line_index_path(entity_id: str) -> str:
    return f"historic/history/lines/{encode_history_entity_id(entity_id)}/index.json"


def _stop_index_path(entity_id: str) -> str:
    return f"historic/history/stops/{encode_history_entity_id(entity_id)}/index.json"


def _seed_retained_pointers(store, line_bundle):  # noqa: ANN001, ANN202
    pointer_keys = [
        "historic/history/network/index.json",
        *[_line_index_path(index.entity_id or "") for index in line_bundle.indexes],
        "historic/history/lines/index.json",
    ]
    expected = {key: f"old:{key}".encode() for key in pointer_keys}
    store.objects.update(expected)
    return expected


def _seed_complete_retained_pointers(store, line_bundle, stop_bundle):  # noqa: ANN001, ANN202
    pointer_keys = [
        "historic/history/network/index.json",
        *[_line_index_path(index.entity_id or "") for index in line_bundle.indexes],
        *[_stop_index_path(index.entity_id or "") for index in stop_bundle.indexes],
        "historic/history/lines/index.json",
        "historic/history/stops/index.json",
        "historic/history/index.json",
    ]
    expected = {key: f"old:{key}".encode() for key in pointer_keys}
    store.objects.update(expected)
    return expected


def test_line_history_publish_is_pointer_last_after_all_network_and_line_immutables(
    monkeypatch,
):
    network_plan = _network_history_plan()
    network_bundle = network_plan.materialize()
    line_plan = _line_history_plan()
    line_bundle = line_plan.materialize()
    compatibility_key = "historic/compatibility.json"
    _patch_minimal_historic(
        monkeypatch,
        line_plan=line_plan,
        network_plan=network_plan,
        compatibility_items=[(compatibility_key, {"ready": True}, "historic")],
    )
    store = _RecordingStore()

    keys = _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z",
    )

    network_partitions = [ref.path for ref in network_bundle.index.partitions]
    line_partitions = [path for path, _partition in line_bundle.partition_items]
    paths = [path for _kind, path in store.calls]
    assert paths[: len(network_partitions) + len(line_partitions)] == [
        *network_partitions,
        *line_partitions,
    ]
    assert keys == paths
    assert all(
        kind == "immutable"
        for kind, _path in store.calls[: len(network_partitions) + len(line_partitions)]
    )
    assert paths.index(compatibility_key) < next(
        index
        for index, path in enumerate(paths)
        if "/history/network/generations/" in path and path.endswith("/index.json")
    )
    assert "historic/history/network/index.json" not in paths
    assert "historic/history/lines/index.json" not in paths
    assert "historic/history/stops/index.json" not in paths
    assert _reachable_history_graph(store)
    assert store.calls[-1] == ("normal", "historic/history/index.json")


def test_historic_publish_clears_marks_for_full_graph_before_root_activation(
    monkeypatch,
):
    _patch_minimal_historic(
        monkeypatch,
        network_plan=_network_history_plan(),
        line_plan=_line_history_plan(),
        stop_plan=_stop_history_plan(),
    )
    store = _RecordingStore()
    settings = SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1)
    stamp = "2026-07-13T00:00:00Z"
    _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=settings,
        stamp=stamp,
    )
    referenced = {path for path in store.objects if "/generations/" in path}
    store.calls.clear()
    store.immutable_skipped.clear()
    observed: dict[str, object] = {}

    def record_clear(conn, provider_id, object_keys):  # noqa: ANN001, ANN202
        observed["conn"] = conn
        observed["provider_id"] = provider_id
        observed["object_keys"] = set(object_keys)
        observed["call_count"] = len(store.calls)

    marker_conn = object()
    monkeypatch.setattr(publish, "_clear_referenced_historic_gc_marks", record_clear)

    _publish_historic(
        marker_conn,
        store,
        provider_id="stm",
        settings=settings,
        stamp=stamp,
    )

    root_call_index = store.calls.index(("normal", "historic/history/index.json"))
    assert observed == {
        "conn": marker_conn,
        "provider_id": "stm",
        "object_keys": referenced,
        "call_count": root_call_index,
    }
    assert referenced <= set(store.immutable_skipped)


def test_history_root_receipt_collection_generation_tracks_only_semantic_payloads():
    from transit_ops.snapshots.contract import Receipt

    first = Receipt(
        generated_utc="2026-07-13T00:00:00Z",
        publish_generation_id="stm@run-1",
        date="2026-07-01",
        affected_routes=2,
        alerts=1,
    )
    second = Receipt(
        generated_utc="2030-01-01T00:00:00Z",
        publish_generation_id="stm@run-2",
        date="2026-07-02",
        affected_routes=3,
        alerts=2,
    )

    baseline = publish._receipts_collection_generation_id(  # noqa: SLF001
        {"2026-07-01": first, "2026-07-02": second}
    )
    reversed_mapping = publish._receipts_collection_generation_id(  # noqa: SLF001
        {"2026-07-02": second, "2026-07-01": first}
    )
    stamp_only = publish._receipts_collection_generation_id(  # noqa: SLF001
        {
            "2026-07-01": first.model_copy(
                update={
                    "generated_utc": "2040-01-01T00:00:00Z",
                    "publish_generation_id": "stm@run-3",
                }
            ),
            "2026-07-02": second.model_copy(
                update={
                    "generated_utc": "2040-01-01T00:00:00Z",
                    "publish_generation_id": "stm@run-3",
                }
            ),
        }
    )
    changed = publish._receipts_collection_generation_id(  # noqa: SLF001
        {
            "2026-07-01": first.model_copy(update={"affected_routes": 99}),
            "2026-07-02": second,
        }
    )

    assert baseline == reversed_mapping == stamp_only
    assert changed != baseline


def test_history_root_uses_exact_child_generations_and_metric_coverage():
    from transit_ops.snapshots.contract import (
        AlertArchiveIndex,
        ReceiptsIndex,
    )

    network = _network_history_plan().materialize().index
    lines = _line_history_plan().materialize()
    stops = _stop_history_plan().materialize()
    receipts = ReceiptsIndex(
        generated_utc="2026-07-12T00:00:00Z",
        collection_generation_id="receipt-semantic-generation",
        dates=["2026-06-01", "2026-07-02"],
    )
    alerts = AlertArchiveIndex(
        generated_utc="2026-07-11T00:00:00Z",
        collection_generation_id="alert-generation",
        first_available_date="2026-05-01",
        last_available_date="2026-07-01",
        total_alerts=0,
        months=[],
    )
    hotspots, repeat_offenders = _empty_point_history_indexes()

    root = publish._build_history_availability_index(  # noqa: SLF001
        stamp="2026-07-13T00:00:00Z",
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat_offenders,
    )

    assert [family.family for family in root.families] == [
        "alerts",
        "hotspots",
        "lines",
        "network",
        "receipts",
        "repeat_offenders",
        "stops",
    ]
    by_family = {family.family: family for family in root.families}
    assert by_family["alerts"].index_path == "historic/alerts/index.json"
    assert by_family["alerts"].collection_generation_id == "alert-generation"
    assert by_family["receipts"].index_path == "historic/receipts/index.json"
    assert by_family["receipts"].collection_generation_id == "receipt-semantic-generation"
    assert by_family["receipts"].first_available_date == "2026-06-01"
    assert by_family["receipts"].last_available_date == "2026-07-02"
    assert by_family["network"].collection_generation_id == network.collection_generation_id
    assert by_family["lines"].collection_generation_id == lines.directory.collection_generation_id
    assert by_family["stops"].collection_generation_id == stops.directory.collection_generation_id
    assert [metric.metric.value for metric in by_family["network"].metrics]
    assert {metric.metric.value for metric in by_family["lines"].metrics} == {
        "delay",
        "delay_percentiles",
        "cancellation",
        "occupancy",
        "service_span",
        "skipped_stops",
    }
    assert {metric.metric.value for metric in by_family["stops"].metrics} == {
        "delay",
        "delay_percentiles",
        "occupancy",
    }
    assert [(gap.start_date, gap.end_date) for gap in by_family["lines"].gaps] == [
        ("2026-07-01", "2026-07-01")
    ]
    assert [(gap.start_date, gap.end_date) for gap in by_family["stops"].gaps] == [
        ("2026-07-01", "2026-07-01")
    ]
    assert root.generated_utc == "2026-07-12T00:00:00Z"


def test_history_root_wholly_empty_uses_run_stamp_fallback():
    from transit_ops.snapshots.builders.historic.network_history import (
        build_network_history_from_rows,
    )
    from transit_ops.snapshots.contract import AlertArchiveIndex, ReceiptsIndex

    stamp = "2026-07-13T00:00:00Z"
    network = build_network_history_from_rows(
        delay_rows=[],
        fact_rows=[],
        cancellation_rows=[],
        occupancy_rows=[],
        generated_utc=stamp,
    ).index
    lines = _empty_line_history_plan().materialize()
    stops = _empty_stop_history_plan().materialize()
    hotspots, repeat_offenders = _empty_point_history_indexes(stamp)
    root = publish._build_history_availability_index(  # noqa: SLF001
        stamp=stamp,
        alert_index=AlertArchiveIndex(
            generated_utc=stamp,
            collection_generation_id="empty-alerts",
            first_available_date=None,
            last_available_date=None,
            total_alerts=0,
            months=[],
        ),
        receipts_index=ReceiptsIndex(
            generated_utc=stamp,
            collection_generation_id="empty-receipts",
            dates=[],
        ),
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat_offenders,
    )

    assert root.generated_utc == stamp
    assert [family.family for family in root.families] == [
        "alerts",
        "hotspots",
        "lines",
        "network",
        "receipts",
        "repeat_offenders",
        "stops",
    ]
    assert all(family.first_available_date is None for family in root.families)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda root: setattr(root, "generated_utc", "2020-01-01T00:00:00Z"),
        lambda root: setattr(root.families[0], "collection_generation_id", "wrong"),
        lambda root: root.families[2].gaps.clear(),
        lambda root: root.families[3].metrics.clear(),
    ],
)
def test_history_root_gate_reconciles_exact_detached_child_graph(mutation):  # noqa: ANN001
    from transit_ops.snapshots.contract import AlertArchiveIndex, ReceiptsIndex

    network = _network_history_plan().materialize().index
    lines = _line_history_plan().materialize()
    stops = _stop_history_plan().materialize()
    alerts = AlertArchiveIndex(
        generated_utc="2026-07-11T00:00:00Z",
        collection_generation_id="alert-generation",
        first_available_date="2026-05-01",
        last_available_date="2026-07-01",
        total_alerts=1,
        months=[],
    )
    receipts = ReceiptsIndex(
        generated_utc="2026-07-12T00:00:00Z",
        collection_generation_id="receipt-generation",
        dates=["2026-06-01", "2026-07-02"],
    )
    hotspots, repeat_offenders = _empty_point_history_indexes()
    root = publish._build_history_availability_index(  # noqa: SLF001
        stamp="2026-07-13T00:00:00Z",
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat_offenders,
    )
    mutation(root)

    findings = gate.check_history_availability_graph(
        root,
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat_offenders,
        fallback_generated_utc="2026-07-13T00:00:00Z",
    )

    assert "history_root_graph" in {finding.check for finding in findings}


@pytest.mark.parametrize("field", ["cancellation", "vehicles", "habits", "by_route"])
def test_stop_history_gate_rejects_fabricated_current_or_line_only_day_fields(field: str):
    bundle = _stop_history_plan().materialize()
    partition = bundle.partitions[0].model_dump(mode="json")
    partition["days"][0][field] = {} if field != "vehicles" else 1
    ref = bundle.indexes[0].partitions[0]

    findings = gate.check_stop_history_partition(partition, rel_key=ref.path)

    assert "stop_metric_vocabulary" in {finding.check for finding in findings}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        pytest.param("headway", [], id="headway"),
        pytest.param("habits", {}, id="habits"),
        pytest.param("weak_stops", [], id="weak-stops"),
        pytest.param("delay_by_crowding", [], id="crowding-breakdown"),
    ],
)
def test_line_history_gate_rejects_fabricated_current_only_day_fields(
    field: str,
    value: object,
):
    bundle = _line_history_plan().materialize()
    partition = bundle.partitions[0].model_dump(mode="json")
    partition["days"][0][field] = value
    ref = bundle.indexes[0].partitions[0]

    findings = gate.check_line_history_partition(partition, rel_key=ref.path)

    assert "line_metric_vocabulary" in {finding.check for finding in findings}


def test_line_history_gate_preserves_exact_retained_day_vocabulary():
    bundle = _line_history_plan().materialize()
    partition = bundle.partitions[0].model_dump(mode="json")
    expected = {
        "date",
        "delay",
        "delay_percentiles",
        "cancellation",
        "occupancy",
        "service_span",
        "skipped_stops",
    }

    findings = gate.check_line_history_partition(
        partition,
        rel_key=bundle.indexes[0].partitions[0].path,
    )

    assert set(partition["days"][0]) == expected
    assert "line_metric_vocabulary" not in {finding.check for finding in findings}


def test_stop_history_and_global_root_publish_pointer_last(monkeypatch):
    from transit_ops.snapshots.contract import (
        AlertArchiveIndex,
        HistoricAvailabilityIndex,
        HistoricCollectionIndex,
        HistoricEntityDirectoryIndex,
        ReceiptsIndex,
    )

    network_plan = _network_history_plan()
    line_plan = _line_history_plan()
    stop_plan = _stop_history_plan()
    network_bundle = network_plan.materialize()
    line_bundle = line_plan.materialize()
    stop_bundle = stop_plan.materialize()
    alert_index = AlertArchiveIndex(
        generated_utc="2026-07-11T00:00:00Z",
        collection_generation_id=snapshot_sha256(
            {
                "first_available_date": None,
                "last_available_date": None,
                "months": [],
            }
        ),
        first_available_date=None,
        last_available_date=None,
        total_alerts=0,
        months=[],
    )
    archive = SimpleNamespace(index=alert_index, page_items=[], provider_timezone="UTC")
    receipts_index = ReceiptsIndex(
        generated_utc="2026-07-12T00:00:00Z",
        collection_generation_id="receipt-generation",
        dates=[],
    )
    compatibility_items = [
        ("historic/receipts/index.json", receipts_index, "historic"),
        ("historic/alerts/index.json", alert_index, "historic"),
    ]
    _patch_minimal_historic(
        monkeypatch,
        line_plan=line_plan,
        network_plan=network_plan,
        stop_plan=stop_plan,
        compatibility_items=compatibility_items,
        archive=archive,
    )
    store = _RecordingStore()

    keys = _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z",
    )

    partition_paths = [
        *[ref.path for ref in network_bundle.index.partitions],
        *[path for path, _partition in line_bundle.partition_items],
        *[path for path, _partition in stop_bundle.partition_items],
    ]
    calls = {path: kind for kind, path in store.calls}
    root_path = "historic/history/index.json"
    assert store.calls[-1] == ("normal", root_path)
    assert keys[-1] == root_path
    assert all(calls[path] == "immutable" for path in partition_paths)
    assert calls["historic/receipts/index.json"] == "normal"
    assert calls["historic/alerts/index.json"] == "normal"
    assert "historic/history/network/index.json" not in calls
    assert "historic/history/lines/index.json" not in calls
    assert "historic/history/stops/index.json" not in calls
    assert not any(
        path == _line_index_path(index.entity_id or "")
        for index in line_bundle.indexes
        for path in calls
    )
    assert not any(
        path == _stop_index_path(index.entity_id or "")
        for index in stop_bundle.indexes
        for path in calls
    )

    root = HistoricAvailabilityIndex.model_validate_json(store.objects[root_path])
    assert [family.family for family in root.families] == [
        "alerts",
        "hotspots",
        "lines",
        "network",
        "receipts",
        "repeat_offenders",
        "stops",
    ]
    by_family = {family.family: family for family in root.families}
    expected_patterns = {
        "alerts": r"^historic/alerts/generations/([0-9a-f]{64})/index\.json$",
        "hotspots": r"^historic/history/hotspots/generations/([0-9a-f]{64})/index\.json$",
        "lines": r"^historic/history/lines/generations/([0-9a-f]{64})/index\.json$",
        "network": r"^historic/history/network/generations/([0-9a-f]{64})/index\.json$",
        "receipts": r"^historic/receipts/generations/([0-9a-f]{64})/index\.json$",
        "repeat_offenders": (
            r"^historic/history/repeat_offenders/generations/"
            r"([0-9a-f]{64})/index\.json$"
        ),
        "stops": r"^historic/history/stops/generations/([0-9a-f]{64})/index\.json$",
    }
    for family, pattern in expected_patterns.items():
        index_path = by_family[family].index_path
        match = re.fullmatch(pattern, index_path)
        assert match is not None
        assert calls[index_path] == "immutable"
        assert hashlib.sha256(store.objects[index_path]).hexdigest() == match.group(1)

    network_index = HistoricCollectionIndex.model_validate_json(
        store.objects[by_family["network"].index_path]
    )
    assert network_index.collection_generation_id == by_family["network"].collection_generation_id

    for family in ("lines", "stops"):
        directory = HistoricEntityDirectoryIndex.model_validate_json(
            store.objects[by_family[family].index_path]
        )
        assert directory.collection_generation_id == by_family[family].collection_generation_id
        for entity in directory.entities:
            pattern = (
                rf"^historic/history/{family}/{entity.encoded_id}/generations/"
                r"([0-9a-f]{64})/index\.json$"
            )
            match = re.fullmatch(pattern, entity.index_path)
            assert match is not None
            assert calls[entity.index_path] == "immutable"
            assert hashlib.sha256(store.objects[entity.index_path]).hexdigest() == match.group(1)
            index = HistoricCollectionIndex.model_validate_json(store.objects[entity.index_path])
            assert index.entity_id == entity.entity_id
            assert index.collection_generation_id == entity.collection_generation_id


def _reachable_history_graph(store):  # noqa: ANN001, ANN202
    from transit_ops.snapshots.contract import (
        HistoricAvailabilityIndex,
        HistoricEntityDirectoryIndex,
    )

    root_path = "historic/history/index.json"
    root = HistoricAvailabilityIndex.model_validate_json(store.objects[root_path])
    reachable = {root_path: store.objects[root_path]}
    for family in root.families:
        body = store.objects[family.index_path]
        match = re.search(r"/generations/([0-9a-f]{64})/index\.json$", family.index_path)
        assert match is not None
        assert hashlib.sha256(body).hexdigest() == match.group(1)
        reachable[family.index_path] = body
        if family.family not in {"lines", "stops"}:
            continue
        directory = HistoricEntityDirectoryIndex.model_validate_json(body)
        for entity in directory.entities:
            entity_body = store.objects[entity.index_path]
            entity_match = re.search(
                r"/generations/([0-9a-f]{64})/index\.json$",
                entity.index_path,
            )
            assert entity_match is not None
            assert hashlib.sha256(entity_body).hexdigest() == entity_match.group(1)
            reachable[entity.index_path] = entity_body
    return reachable


def test_historic_validate_records_the_same_versioned_pointer_graph_as_publish(monkeypatch):
    _patch_minimal_historic(
        monkeypatch,
        network_plan=_network_history_plan(),
        line_plan=_line_history_plan(),
        stop_plan=_stop_history_plan(),
    )
    stamp = "2026-07-13T00:00:00Z"
    monkeypatch.setattr(publish, "_historic_stamp", lambda: stamp)
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)

    class Engine:
        @contextmanager
        def connect(self):
            yield object()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )
    store = _RecordingStore()
    _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp=stamp,
    )

    pointer_pattern = re.compile(r"/generations/[0-9a-f]{64}/index\.json$")
    validated_pointers = {path for path in report.payload_sha256 if pointer_pattern.search(path)}
    published_pointers = {path for _kind, path in store.calls if pointer_pattern.search(path)}
    assert validated_pointers == published_pointers
    assert len(validated_pointers) == 11
    assert "historic/history/index.json" in report.payload_sha256
    assert {
        "historic/history/network/index.json",
        "historic/history/lines/index.json",
        "historic/history/stops/index.json",
    }.isdisjoint(report.payload_sha256)


@pytest.mark.parametrize("analytics_gate", [False, True])
@pytest.mark.parametrize(
    "failure_stage",
    [
        "network_index",
        "alert_index",
        "receipt_index",
        "line_entity_index",
        "stop_entity_index",
        "lines_directory",
        "stops_directory",
        "root",
    ],
)
def test_pointer_stage_failure_preserves_complete_previously_active_graph(
    monkeypatch,
    analytics_gate: bool,
    failure_stage: str,
):
    network_plan = _network_history_plan()
    line_plan = _line_history_plan()
    stop_plan = _stop_history_plan()
    _patch_minimal_historic(
        monkeypatch,
        network_plan=network_plan,
        line_plan=line_plan,
        stop_plan=stop_plan,
    )

    class FailStage(_RecordingStore):
        active_failure: str | None = None

        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            patterns = {
                "network_index": r"^historic/history/network/generations/[0-9a-f]{64}/index\.json$",
                "alert_index": r"^historic/alerts/generations/[0-9a-f]{64}/index\.json$",
                "receipt_index": r"^historic/receipts/generations/[0-9a-f]{64}/index\.json$",
                "line_entity_index": (
                    r"^historic/history/lines/[0-9a-f]+/generations/"
                    r"[0-9a-f]{64}/index\.json$"
                ),
                "stop_entity_index": (
                    r"^historic/history/stops/[0-9a-f]+/generations/"
                    r"[0-9a-f]{64}/index\.json$"
                ),
                "lines_directory": (
                    r"^historic/history/lines/generations/[0-9a-f]{64}/index\.json$"
                ),
                "stops_directory": (
                    r"^historic/history/stops/generations/[0-9a-f]{64}/index\.json$"
                ),
            }
            pattern = patterns.get(self.active_failure or "")
            if pattern is not None and re.fullmatch(pattern, rel_key):
                self.calls.append(("immutable", rel_key))
                raise RuntimeError(f"{self.active_failure} failed")
            return super().put_immutable_json(rel_key, payload)

        def activate_stable_json(
            self,
            rel_key,
            payload,
            *,
            expected_version,
            tier,
        ):  # noqa: ANN001, ANN201
            if self.active_failure == "root":
                self.calls.append(("normal", rel_key))
                raise RuntimeError("root failed")
            return super().activate_stable_json(
                rel_key,
                payload,
                expected_version=expected_version,
                tier=tier,
            )

    store = FailStage()
    _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-12T00:00:00Z",
        gate_report=_gate_report(analytics_gate),
    )
    old_graph = _reachable_history_graph(store)
    store.active_failure = failure_stage

    with pytest.raises(RuntimeError, match=rf"{failure_stage} failed"):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert _reachable_history_graph(store) == old_graph


@pytest.mark.parametrize("analytics_gate", [False, True])
@pytest.mark.parametrize(
    "summary_factory",
    [
        _SelfConsistentOmittingLineSummary,
        _PoisonsLineIndexSummary,
        _MutatesSuppliedLineRefSummary,
    ],
)
def test_line_history_publish_rejects_self_consistent_entity_index_omission(
    monkeypatch,
    analytics_gate: bool,
    summary_factory,
):
    line_plan = _line_history_plan()
    line_bundle = line_plan.materialize()
    _patch_minimal_historic(monkeypatch, line_plan=line_plan)
    monkeypatch.setattr(
        publish.builders,
        "LineHistoryStreamSummary",
        summary_factory,
        raising=False,
    )
    store = _RecordingStore()

    with pytest.raises(gate.GateError) as exc_info:
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert "line_stream_indexes" in {finding.check for finding in exc_info.value.report.errors}
    immutable_paths = {path for kind, path in store.calls if kind == "immutable"}
    assert {path for path, _partition in line_bundle.partition_items}.issubset(immutable_paths)
    assert not any(kind == "normal" for kind, _path in store.calls)


@pytest.mark.parametrize("analytics_gate", [False, True])
@pytest.mark.parametrize(
    "summary_factory",
    [_ClearsLineDirectoryInputsSummary, _MutatesLineIndexBeforeDirectorySummary],
)
def test_line_history_publish_keeps_directory_truth_when_builder_clears_inputs(
    monkeypatch,
    analytics_gate: bool,
    summary_factory,
):
    line_plan = _line_history_plan()
    _patch_minimal_historic(monkeypatch, line_plan=line_plan)
    monkeypatch.setattr(
        publish.builders,
        "LineHistoryStreamSummary",
        summary_factory,
        raising=False,
    )
    store = _RecordingStore()

    with pytest.raises(gate.GateError) as exc_info:
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert "line_stream_directory" in {finding.check for finding in exc_info.value.report.errors}
    assert not any(kind == "normal" for kind, _path in store.calls)


@pytest.mark.parametrize(
    "summary_factory",
    [
        _SelfConsistentOmittingLineSummary,
        _PoisonsLineIndexSummary,
        _MutatesSuppliedLineRefSummary,
    ],
)
def test_line_history_validate_rejects_self_consistent_stream_omission(
    monkeypatch,
    summary_factory,
):
    line_plan = _line_history_plan()
    _patch_minimal_historic(monkeypatch, line_plan=line_plan)
    monkeypatch.setattr(
        publish.builders,
        "LineHistoryStreamSummary",
        summary_factory,
        raising=False,
    )
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)

    class Engine:
        def connect(self):
            @contextmanager
            def connection():
                yield object()

            return connection()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )

    assert "line_stream_indexes" in {finding.check for finding in report.errors}


@pytest.mark.parametrize(
    "summary_factory",
    [_ClearsLineDirectoryInputsSummary, _MutatesLineIndexBeforeDirectorySummary],
)
def test_line_history_validate_preserves_detached_directory_truth(
    monkeypatch,
    summary_factory,
):
    line_plan = _line_history_plan()
    _patch_minimal_historic(monkeypatch, line_plan=line_plan)
    monkeypatch.setattr(
        publish.builders,
        "LineHistoryStreamSummary",
        summary_factory,
        raising=False,
    )
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)

    class Engine:
        def connect(self):
            @contextmanager
            def connection():
                yield object()

            return connection()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )

    assert "line_stream_directory" in {finding.check for finding in report.errors}


def test_line_history_gate_rejects_wrong_entity_and_exact_ref_mismatch():
    bundle = _line_history_plan().materialize()
    path, original = bundle.partition_items[0]
    partition = original.model_copy(deep=True)
    partition.entity_id = "different-line"

    findings = gate.check_payload(path, partition)

    checks = {finding.check for finding in findings}
    assert "partition_entity" in checks
    assert "ref_entity" in {
        finding.check
        for finding in gate.check_line_history_partition_ref(
            bundle.indexes[0].partitions[0],
            partition,
        )
    }


def test_line_history_gate_accepts_exact_builder_graph_and_stream_truth():
    bundle = _line_history_plan().materialize()
    summary = gate.LineHistoryStreamSummary()
    refs = [ref for index in bundle.indexes for ref in index.partitions]
    findings = []
    for ref, partition in zip(refs, bundle.partitions, strict=True):
        findings.extend(gate.check_payload(ref.path, partition))
        findings.extend(gate.check_line_history_partition_ref(ref, partition))
        summary.observe(ref, partition)
    for index in bundle.indexes:
        findings.extend(gate.check_payload(_line_index_path(index.entity_id or ""), index))
    findings.extend(
        gate.check_line_history_stream_indexes(
            bundle.indexes,
            summary,
            fallback_generated_utc="2026-07-13T00:00:00Z",
        )
    )
    directory_summary = gate.LineHistoryDirectorySummary.from_indexes(bundle.indexes)
    findings.extend(gate.check_payload("historic/history/lines/index.json", bundle.directory))
    findings.extend(
        gate.check_line_history_stream_directory(
            bundle.directory,
            directory_summary,
            fallback_generated_utc="2026-07-13T00:00:00Z",
        )
    )

    assert findings == []


@pytest.mark.parametrize(
    ("mutation", "expected_check"),
    [
        (lambda ref, partition: setattr(ref, "sha256", "f" * 64), "ref_sha256"),
        (lambda ref, partition: setattr(ref, "byte_size", 1), "ref_byte_size"),
        (lambda ref, partition: setattr(ref, "count", 99), "ref_count"),
        (
            lambda ref, partition: setattr(ref, "coverage_start", "2026-01-01"),
            "ref_coverage",
        ),
        (lambda ref, partition: setattr(partition, "entity_id", "wrong"), "ref_entity"),
        (lambda ref, partition: setattr(partition, "month", "2026-05"), "ref_month"),
    ],
)
def test_line_history_ref_gate_rejects_exact_edge_mismatch(
    mutation,
    expected_check,
):  # noqa: ANN001
    bundle = _line_history_plan().materialize()
    ref = bundle.indexes[0].partitions[0].model_copy(deep=True)
    partition = bundle.partitions[0].model_copy(deep=True)
    mutation(ref, partition)

    findings = gate.check_line_history_partition_ref(ref, partition)

    assert expected_check in {finding.check for finding in findings}


def test_line_history_gate_rejects_empty_entity_duplicate_directory_identity_and_bad_generation():
    bundle = _line_history_plan().materialize()
    index = bundle.indexes[0].model_copy(deep=True)
    index.partitions = []
    index.available_dates = []
    index.first_available_date = None
    index.last_available_date = None
    index.gaps = []
    for metric in index.metrics:
        metric.first_available_date = None
        metric.last_available_date = None
        metric.gaps = []
    index.collection_generation_id = history_index_generation_id(index)
    index_path = _line_index_path(index.entity_id or "")
    assert "empty_entity" in {finding.check for finding in gate.check_payload(index_path, index)}

    directory = bundle.directory.model_copy(deep=True)
    directory.entities.append(directory.entities[0].model_copy(deep=True))
    directory.collection_generation_id = history_entity_directory_generation_id(directory)
    checks = {
        finding.check
        for finding in gate.check_payload("historic/history/lines/index.json", directory)
    }
    assert {"duplicate_entity_id", "duplicate_encoded_id"}.issubset(checks)

    directory = bundle.directory.model_copy(deep=True)
    directory.collection_generation_id = "wrong"
    assert "collection_generation_id" in {
        finding.check
        for finding in gate.check_payload("historic/history/lines/index.json", directory)
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        pytest.param("entity_id", None, id="null-entity-id"),
        pytest.param("entity_id", 7, id="mixed-entity-id"),
        pytest.param("entity_id", [], id="unhashable-entity-id"),
        pytest.param("encoded_id", [], id="unhashable-encoded-id"),
        pytest.param("index_path", {}, id="unhashable-index-path"),
    ],
)
def test_line_history_malformed_directory_identity_returns_findings_not_exceptions(
    field: str,
    value: object,
):
    directory = _line_history_plan().materialize().directory.model_dump(mode="json")
    directory["entities"][0][field] = value

    findings = gate.check_line_history_directory(
        directory,
        rel_key="historic/history/lines/index.json",
    )

    assert "contract" in {finding.check for finding in findings}


@pytest.mark.parametrize("family", ["network", "line"])
@pytest.mark.parametrize(
    "path",
    [
        pytest.param(None, id="null"),
        pytest.param(7, id="number"),
        pytest.param([], id="list"),
        pytest.param({}, id="object"),
    ],
)
def test_history_index_malformed_partition_ref_path_returns_findings_not_exceptions(
    family: str,
    path: object,
):
    if family == "network":
        bundle = _network_history_plan().materialize()
        index = bundle.index.model_dump(mode="json")
        rel_key = "historic/history/network/index.json"
        check = gate.check_network_history_index
    else:
        bundle = _line_history_plan().materialize()
        index = bundle.indexes[0].model_dump(mode="json")
        rel_key = _line_index_path(bundle.indexes[0].entity_id or "")
        check = gate.check_line_history_index
    index["partitions"][0]["path"] = path

    findings = check(index, rel_key=rel_key)

    assert {"contract", "ref_path"}.intersection(finding.check for finding in findings)


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_line_history_invalid_later_partition_preserves_every_existing_pointer(
    monkeypatch,
    analytics_gate: bool,
):
    honest_plan = _line_history_plan()
    bundle = honest_plan.materialize()
    bundle.partitions[1].entity_id = "wrong-line"
    _patch_minimal_historic(
        monkeypatch,
        line_plan=_MaterializedLinePlan(bundle),
    )
    store = _RecordingStore()
    expected_pointers = _seed_retained_pointers(store, honest_plan.materialize())

    with pytest.raises(gate.GateError):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert all(store.objects[key] == value for key, value in expected_pointers.items())
    line_calls = [path for kind, path in store.calls if kind == "immutable" and "/lines/" in path]
    assert line_calls == []
    assert not any(kind == "normal" for kind, _path in store.calls)


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_line_history_second_immutable_failure_preserves_every_existing_pointer(
    monkeypatch,
    analytics_gate: bool,
):
    line_plan = _line_history_plan()
    bundle = line_plan.materialize()
    target = bundle.partition_items[1][0]
    _patch_minimal_historic(monkeypatch, line_plan=line_plan)

    class FailSecondLineImmutable(_RecordingStore):
        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            if rel_key == target:
                self.calls.append(("immutable", rel_key))
                raise RuntimeError("second Line immutable failed")
            return super().put_immutable_json(rel_key, payload)

    store = FailSecondLineImmutable()
    expected_pointers = _seed_retained_pointers(store, bundle)

    with pytest.raises(RuntimeError, match="second Line immutable failed"):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert all(store.objects[key] == value for key, value in expected_pointers.items())
    assert bundle.partition_items[0][0] in store.objects
    assert target not in store.objects
    assert not any(kind == "normal" for kind, _path in store.calls)


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_line_history_compatibility_failure_preserves_every_existing_pointer(
    monkeypatch,
    analytics_gate: bool,
):
    line_plan = _line_history_plan()
    bundle = line_plan.materialize()
    compatibility_key = "historic/compatibility.json"
    _patch_minimal_historic(
        monkeypatch,
        line_plan=line_plan,
        compatibility_items=[(compatibility_key, {"ready": True}, "historic")],
    )

    class FailCompatibility(_RecordingStore):
        def put_json(self, rel_key, payload, *, tier):  # noqa: ANN001, ANN201
            if rel_key == compatibility_key:
                self.calls.append(("normal", rel_key))
                raise RuntimeError("compatibility failed")
            return super().put_json(rel_key, payload, tier=tier)

    store = FailCompatibility()
    expected_pointers = _seed_retained_pointers(store, bundle)

    with pytest.raises(RuntimeError, match="compatibility failed"):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert all(store.objects[key] == value for key, value in expected_pointers.items())
    assert {path for path, _partition in bundle.partition_items}.issubset(store.objects)
    assert not any(kind == "normal" and path in expected_pointers for kind, path in store.calls)


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_line_history_entity_index_failure_preserves_directory_and_later_pointers(
    monkeypatch,
    analytics_gate: bool,
):
    line_plan = _line_history_plan()
    bundle = line_plan.materialize()
    encoded_target = encode_history_entity_id(bundle.indexes[1].entity_id or "")
    _patch_minimal_historic(monkeypatch, line_plan=line_plan)

    class FailEntityIndex(_RecordingStore):
        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            if re.fullmatch(
                rf"historic/history/lines/{encoded_target}/generations/"
                r"[0-9a-f]{64}/index\.json",
                rel_key,
            ):
                self.calls.append(("immutable", rel_key))
                raise RuntimeError("Line entity index failed")
            return super().put_immutable_json(rel_key, payload)

    store = FailEntityIndex()
    expected_pointers = _seed_retained_pointers(store, bundle)

    with pytest.raises(RuntimeError, match="Line entity index failed"):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert all(store.objects[key] == value for key, value in expected_pointers.items())
    assert "historic/history/index.json" not in store.objects


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_line_history_directory_failure_preserves_existing_directory_bytes(
    monkeypatch,
    analytics_gate: bool,
):
    line_plan = _line_history_plan()
    bundle = line_plan.materialize()
    directory_key = "historic/history/lines/index.json"
    _patch_minimal_historic(monkeypatch, line_plan=line_plan)

    class FailDirectory(_RecordingStore):
        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            if re.fullmatch(
                r"historic/history/lines/generations/[0-9a-f]{64}/index\.json",
                rel_key,
            ):
                self.calls.append(("immutable", rel_key))
                raise RuntimeError("Lines directory failed")
            return super().put_immutable_json(rel_key, payload)

    store = FailDirectory()
    expected_pointers = _seed_retained_pointers(store, bundle)

    with pytest.raises(RuntimeError, match="Lines directory failed"):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert store.objects[directory_key] == expected_pointers[directory_key]
    assert "historic/history/index.json" not in store.objects
    assert store.calls[-1][0] == "immutable"


def test_network_history_actual_historic_publish_is_structural_and_root_last(
    monkeypatch,
):
    bundle = _network_history_bundle()
    plan = _network_history_plan()
    _patch_minimal_historic(
        monkeypatch,
        network_plan=plan,
        line_plan=_empty_line_history_plan(),
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    checked = []
    real_check = gate.check_network_history_partition_ref

    def record_check(ref, partition):  # noqa: ANN001, ANN202
        checked.append((ref, partition))
        return real_check(ref, partition)

    monkeypatch.setattr(publish.gate, "check_network_history_partition_ref", record_check)
    store = _RecordingStore()

    _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z",
        gate_report=None,
    )

    assert len(checked) == len(bundle.partitions)
    paths = [path for _kind, path in store.calls]
    assert paths[: len(bundle.index.partitions)] == [ref.path for ref in bundle.index.partitions]
    assert "historic/history/network/index.json" not in paths
    assert "historic/history/lines/index.json" not in paths
    assert "historic/history/stops/index.json" not in paths
    assert len(_reachable_history_graph(store)) == 8
    assert store.calls[-1] == ("normal", "historic/history/index.json")

    outcomes = SimpleNamespace(
        written=["historic/history/index.json"],
        skipped=[],
        immutable_written=[
            *[ref.path for ref in bundle.index.partitions],
            *[path for path in paths if path.endswith("/index.json")],
        ],
        immutable_skipped=[],
    )
    assert _stable_outcome_total(outcomes) == 1


def test_retained_partition_families_upload_through_the_bounded_parallel_seam(
    monkeypatch,
):
    _patch_minimal_historic(
        monkeypatch,
        network_plan=_network_history_plan(),
        line_plan=_line_history_plan(),
        stop_plan=_stop_history_plan(),
    )
    real_parallel_put = publish._parallel_put
    partition_types: list[str] = []

    def record_partition_batches(storage, items, **kwargs):  # noqa: ANN001, ANN202
        names = {
            type(payload).__name__
            for _rel_key, payload, _tier in items
            if type(payload).__name__.endswith("HistoryPartition")
        }
        partition_types.extend(sorted(names))
        return real_parallel_put(storage, items, **kwargs)

    monkeypatch.setattr(publish, "_parallel_put", record_partition_batches)

    _publish_historic(
        object(),
        _RecordingStore(),
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=2),
        stamp="2026-07-13T00:00:00Z",
    )

    assert set(partition_types) == {
        "LineHistoryPartition",
        "NetworkHistoryPartition",
        "StopHistoryPartition",
    }


def test_network_partition_uploads_are_genuinely_concurrent_and_config_bounded(
    monkeypatch,
):
    _patch_minimal_historic(
        monkeypatch,
        network_plan=_network_history_plan(),
        line_plan=_empty_line_history_plan(),
        stop_plan=_empty_stop_history_plan(),
    )

    class ConcurrentNetworkStore(_RecordingStore):
        def __init__(self) -> None:
            super().__init__()
            self.lock = threading.Lock()
            self.both_started = threading.Event()
            self.in_flight = 0
            self.peak = 0

        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            is_partition = "/history/network/generations/" in rel_key and not rel_key.endswith(
                "/index.json"
            )
            if not is_partition:
                return super().put_immutable_json(rel_key, payload)
            with self.lock:
                self.in_flight += 1
                self.peak = max(self.peak, self.in_flight)
                if self.in_flight == 2:
                    self.both_started.set()
            try:
                if not self.both_started.wait(timeout=1):
                    raise AssertionError("Network immutable children did not overlap")
                return super().put_immutable_json(rel_key, payload)
            finally:
                with self.lock:
                    self.in_flight -= 1

    store = ConcurrentNetworkStore()
    _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=3),
        stamp="2026-07-13T00:00:00Z",
    )

    assert 1 < store.peak <= 3


def test_network_partition_scale_fixture_uses_fixed_memory_batches_and_stable_order(
    monkeypatch,
):
    plan = _large_network_history_plan()
    expected_paths = [ref.path for ref, _partition in plan.iter_partition_items()]
    _patch_minimal_historic(
        monkeypatch,
        network_plan=plan,
        line_plan=_empty_line_history_plan(),
        stop_plan=_empty_stop_history_plan(),
    )
    batch_sizes: list[int] = []

    def record_batches(_storage, items, **_kwargs):  # noqa: ANN001, ANN202
        if items and all(
            type(payload).__name__ == "NetworkHistoryPartition"
            for _rel_key, payload, _tier in items
        ):
            batch_sizes.append(len(items))
        return [rel_key for rel_key, _payload, _tier in items]

    monkeypatch.setattr(publish, "_parallel_put", record_batches)

    keys = _publish_historic(
        object(),
        _RecordingStore(),
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=10_000),
        stamp="2026-07-13T00:00:00Z",
    )

    assert batch_sizes == [32, 32, 6]
    assert keys[: len(expected_paths)] == expected_paths


@pytest.mark.parametrize("failure_kind", ["upload", "collision"])
def test_concurrent_delayed_network_child_failure_never_activates_parents(
    monkeypatch,
    failure_kind: str,
):
    plan = _network_history_plan()
    bundle = plan.materialize()
    first_path, second_path = [ref.path for ref in bundle.index.partitions]
    _patch_minimal_historic(
        monkeypatch,
        network_plan=plan,
        line_plan=_empty_line_history_plan(),
        stop_plan=_empty_stop_history_plan(),
    )

    class FailingConcurrentStore(_RecordingStore):
        def __init__(self) -> None:
            super().__init__()
            self.second_started = threading.Event()

        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            if rel_key == first_path:
                if not self.second_started.wait(timeout=1):
                    raise AssertionError("failing child did not run concurrently")
                return super().put_immutable_json(rel_key, payload)
            if rel_key == second_path:
                self.second_started.set()
                self.calls.append(("immutable", rel_key))
                if failure_kind == "collision":
                    raise ImmutableKeyCollisionError(rel_key)
                raise RuntimeError("Network child upload failed")
            return super().put_immutable_json(rel_key, payload)

    store = FailingConcurrentStore()
    old_pointers = {
        "historic/history/network/index.json": b"old-network-index",
        "historic/history/lines/index.json": b"old-lines-directory",
        "historic/history/stops/index.json": b"old-stops-directory",
        "historic/history/index.json": b"old-history-root",
    }
    store.objects.update(old_pointers)
    expected_error = ImmutableKeyCollisionError if failure_kind == "collision" else RuntimeError
    expected_message = "immutable key collision" if failure_kind == "collision" else "upload failed"

    with pytest.raises(expected_error, match=expected_message):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=2),
            stamp="2026-07-13T00:00:00Z",
        )

    assert {key: store.objects[key] for key in old_pointers} == old_pointers
    assert not any(
        re.fullmatch(
            r"historic/history/network/generations/[0-9a-f]{64}/index\.json",
            rel_key,
        )
        for _kind, rel_key in store.calls
    )
    assert not any(rel_key.endswith("/index.json") for _kind, rel_key in store.calls)
    assert not any(kind == "normal" for kind, _rel_key in store.calls)


def test_network_history_actual_publish_builds_gates_then_uploads_a_bounded_batch(
    monkeypatch,
):
    bundle = _network_history_bundle()
    events: list[tuple[str, str]] = []

    class BoundedPlan:
        def __init__(self) -> None:
            self.live = 0
            self.max_live = 0

        def iter_partition_items(self):  # noqa: ANN201
            for ref, partition in zip(bundle.index.partitions, bundle.partitions, strict=True):
                self.live += 1
                self.max_live = max(self.max_live, self.live)
                events.append(("build", partition.month))
                yield ref, partition
                self.live -= 1
                events.append(("release", partition.month))

        def build_index(self, refs):  # noqa: ANN001, ANN201
            events.append(("build-index", "network"))
            index = bundle.index.model_copy(deep=True)
            index.partitions = list(refs)
            index.collection_generation_id = history_index_generation_id(index)
            return index

    plan = BoundedPlan()
    _patch_minimal_historic(
        monkeypatch,
        network_plan=plan,
        line_plan=_empty_line_history_plan(),
    )
    monkeypatch.setattr(
        publish.builders,
        "build_network_history",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("monolithic builder called")),
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    monkeypatch.setattr(
        publish.gate,
        "check_network_history_bundle",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("monolithic bundle gate called")),
    )
    monkeypatch.setattr(
        publish.gate,
        "check_network_history_partition",
        lambda payload, *, rel_key: events.append(("gate-partition", payload.month)) or [],
    )
    monkeypatch.setattr(
        publish.gate,
        "check_network_history_partition_ref",
        lambda ref, payload: events.append(("gate-ref", payload.month)) or [],
        raising=False,
    )
    monkeypatch.setattr(
        publish.gate,
        "check_network_history_index",
        lambda payload, *, rel_key: events.append(("gate-index", "network")) or [],
    )

    class EventStore(_RecordingStore):
        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            if hasattr(payload, "month"):
                events.append(("put-partition", payload.month))
            elif re.fullmatch(
                r"historic/history/network/generations/[0-9a-f]{64}/index\.json",
                rel_key,
            ):
                events.append(("put-index", "network"))
            return super().put_immutable_json(rel_key, payload)

    _publish_historic(
        object(),
        EventStore(),
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=2),
        stamp="2026-07-13T00:00:00Z",
        gate_report=None,
    )

    assert plan.max_live == 1
    assert events == [
        ("build", "2026-06"),
        ("gate-partition", "2026-06"),
        ("gate-ref", "2026-06"),
        ("release", "2026-06"),
        ("build", "2026-07"),
        ("gate-partition", "2026-07"),
        ("gate-ref", "2026-07"),
        ("release", "2026-07"),
        ("put-partition", "2026-06"),
        ("put-partition", "2026-07"),
        ("build-index", "network"),
        ("gate-index", "network"),
        ("put-index", "network"),
    ]


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_network_history_publish_rejects_self_consistent_index_that_omits_streamed_children(
    monkeypatch,
    analytics_gate: bool,
):
    plan = _network_history_plan()
    bundle = plan.materialize()
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(
        publish.builders,
        "build_network_history_plan",
        lambda *a, **k: _SelfConsistentEmptyIndexPlan(plan),
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    store = _RecordingStore()

    with pytest.raises(gate.GateError) as exc_info:
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    checks = {finding.check for finding in exc_info.value.report.errors}
    assert {
        "stream_partitions",
        "stream_available_dates",
        "stream_metrics",
        "stream_generated_utc",
    }.issubset(checks)
    assert store.calls == [("immutable", ref.path) for ref in bundle.index.partitions]


def test_network_history_validate_rejects_self_consistent_index_that_omits_streamed_children(
    monkeypatch,
):
    plan = _network_history_plan()
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(
        publish.builders,
        "build_network_history_plan",
        lambda *a, **k: _SelfConsistentEmptyIndexPlan(plan),
    )
    monkeypatch.setattr(publish, "_prior_files_total", lambda *a, **k: None)
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])

    class Engine:
        def connect(self):
            @contextmanager
            def connection():
                yield object()

            return connection()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )

    checks = {finding.check for finding in report.errors}
    assert {
        "stream_partitions",
        "stream_available_dates",
        "stream_metrics",
        "stream_generated_utc",
    }.issubset(checks)


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_network_history_publish_keeps_stream_truth_when_plan_clears_index_ref_inputs(
    monkeypatch,
    analytics_gate: bool,
):
    plan = _network_history_plan()
    bundle = plan.materialize()
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(
        publish.builders,
        "build_network_history_plan",
        lambda *a, **k: _ClearsIndexRefInputsPlan(plan),
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    store = _RecordingStore()

    with pytest.raises(gate.GateError) as exc_info:
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert "stream_partitions" in {finding.check for finding in exc_info.value.report.errors}
    assert store.calls == [("immutable", ref.path) for ref in bundle.index.partitions]


def test_network_history_validate_keeps_stream_truth_when_plan_clears_index_ref_inputs(
    monkeypatch,
):
    plan = _network_history_plan()
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(
        publish.builders,
        "build_network_history_plan",
        lambda *a, **k: _ClearsIndexRefInputsPlan(plan),
    )
    monkeypatch.setattr(publish, "_prior_files_total", lambda *a, **k: None)
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])

    class Engine:
        def connect(self):
            @contextmanager
            def connection():
                yield object()

            return connection()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )

    assert "stream_partitions" in {finding.check for finding in report.errors}


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_network_history_publish_keeps_stream_truth_when_plan_mutates_index_ref_values(
    monkeypatch,
    analytics_gate: bool,
):
    plan = _network_history_plan()
    bundle = plan.materialize()
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(
        publish.builders,
        "build_network_history_plan",
        lambda *a, **k: _PoisonsIndexRefInputsPlan(plan),
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    store = _RecordingStore()

    with pytest.raises(gate.GateError) as exc_info:
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert "stream_partitions" in {finding.check for finding in exc_info.value.report.errors}
    assert store.calls == [("immutable", ref.path) for ref in bundle.index.partitions]


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_network_history_second_month_put_failure_preserves_existing_pointer(
    monkeypatch,
    analytics_gate: bool,
):
    plan = _network_history_plan()
    bundle = plan.materialize()
    _patch_minimal_historic(
        monkeypatch,
        network_plan=plan,
        line_plan=_empty_line_history_plan(),
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    index_key = "historic/history/network/index.json"
    old_pointer = b"preexisting-network-index"

    class FailSecondPartitionStore(_RecordingStore):
        def __init__(self) -> None:
            super().__init__()
            self.objects[index_key] = old_pointer
            self.partition_puts = 0

        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            self.partition_puts += 1
            if self.partition_puts == 2:
                self.calls.append(("immutable", rel_key))
                raise RuntimeError("second partition write failed")
            return super().put_immutable_json(rel_key, payload)

    store = FailSecondPartitionStore()
    with pytest.raises(RuntimeError, match="second partition write failed"):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert store.objects[index_key] == old_pointer
    assert bundle.index.partitions[0].path in store.objects
    assert bundle.index.partitions[1].path not in store.objects
    assert not any(kind == "normal" for kind, _path in store.calls)


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_network_history_index_put_failure_leaves_children_without_activating_root(
    monkeypatch,
    analytics_gate: bool,
):
    plan = _network_history_plan()
    bundle = plan.materialize()
    _patch_minimal_historic(
        monkeypatch,
        network_plan=plan,
        line_plan=_empty_line_history_plan(),
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    store = _RecordingStore(fail_index=True)
    index_key = "historic/history/network/index.json"
    old_pointer = b"preexisting-network-index"
    store.objects[index_key] = old_pointer

    with pytest.raises(RuntimeError, match="index write failed"):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert {ref.path for ref in bundle.index.partitions}.issubset(store.objects)
    assert store.objects[index_key] == old_pointer
    assert store.calls[-1][0] == "immutable"
    assert re.fullmatch(
        r"historic/history/network/generations/[0-9a-f]{64}/index\.json",
        store.calls[-1][1],
    )
    assert "historic/history/index.json" not in store.objects


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_network_history_compatibility_stage_failure_preserves_existing_pointer(
    monkeypatch,
    analytics_gate: bool,
):
    plan = _network_history_plan()
    bundle = plan.materialize()
    compatibility_key = "historic/compatibility-pointer.json"
    compatibility_item = (compatibility_key, {"status": "ready"}, "historic")
    _patch_minimal_historic(
        monkeypatch,
        network_plan=plan,
        line_plan=_empty_line_history_plan(),
        compatibility_items=[compatibility_item],
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    index_key = "historic/history/network/index.json"
    old_pointer = b"preexisting-network-index"

    class FailCompatibilityStore(_RecordingStore):
        def __init__(self) -> None:
            super().__init__()
            self.objects[index_key] = old_pointer

        def put_json(self, rel_key, payload, *, tier):  # noqa: ANN001, ANN201
            if rel_key == compatibility_key:
                self.calls.append(("normal", rel_key))
                raise RuntimeError("compatibility stage write failed")
            return super().put_json(rel_key, payload, tier=tier)

    store = FailCompatibilityStore()
    with pytest.raises(RuntimeError, match="compatibility stage write failed"):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert {ref.path for ref in bundle.index.partitions}.issubset(store.objects)
    assert store.objects[index_key] == old_pointer
    assert compatibility_key not in store.objects
    assert ("normal", index_key) not in store.calls


def test_network_history_no_gate_rejects_invalid_bundle_before_any_put(monkeypatch):
    bundle = _network_history_bundle()
    bundle.partitions[0].days[0].delay.on_time_count = 999
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(
        publish.builders,
        "build_network_history_plan",
        lambda *a, **k: _MaterializedNetworkPlan(bundle),
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    store = _RecordingStore()

    with pytest.raises(gate.GateError):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=None,
        )

    assert store.calls == []


def test_network_history_validate_records_bundle_sha_and_preserves_alert_slot(monkeypatch):
    plan = _network_history_plan()
    bundle = plan.materialize()
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(publish.builders, "build_network_history_plan", lambda *a, **k: plan)
    monkeypatch.setattr(publish, "_prior_files_total", lambda *a, **k: None)
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])

    class Engine:
        def connect(self):
            @contextmanager
            def connection():
                yield object()

            return connection()

    collected = publish.collect_payloads(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
        include_archive_bundle=True,
        include_network_bundle=True,
    )
    assert isinstance(collected, publish.HistoricValidationInputs)
    assert collected.alert_archive is archive
    assert collected.network_history is plan

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )
    assert {ref.path for ref in bundle.index.partitions}.issubset(report.payload_sha256)
    assert "historic/history/network/index.json" not in report.payload_sha256
    versioned_indexes = [
        path
        for path in report.payload_sha256
        if re.fullmatch(
            r"historic/history/network/generations/[0-9a-f]{64}/index\.json",
            path,
        )
    ]
    assert len(versioned_indexes) == 1
    match = re.fullmatch(
        r"historic/history/network/generations/([0-9a-f]{64})/index\.json",
        versioned_indexes[0],
    )
    assert match is not None
    assert report.payload_sha256[versioned_indexes[0]] == match.group(1)


@pytest.mark.parametrize(
    ("mutation", "expected_check"),
    [
        (lambda index, parts: setattr(parts[0], "month", "2026-05"), "partition_month"),
        (lambda index, parts: setattr(index.partitions[0], "sha256", "f" * 64), "ref_sha256"),
        (lambda index, parts: setattr(index.partitions[0], "count", 99), "ref_count"),
        (lambda index, parts: setattr(index.partitions[0], "byte_size", 99), "ref_byte_size"),
        (
            lambda index, parts: setattr(index.partitions[0], "coverage_start", "2026-06-01"),
            "ref_coverage",
        ),
        (
            lambda index, parts: setattr(index, "collection_generation_id", "wrong"),
            "collection_generation_id",
        ),
        (
            lambda index, parts: setattr(index, "generated_utc", "2020-01-01T00:00:00Z"),
            "generated_utc",
        ),
        (
            lambda index, parts: setattr(index, "available_dates", ["2026-06-30"]),
            "available_dates",
        ),
        (lambda index, parts: setattr(index, "entity_id", "not-network"), "index_identity"),
        (
            lambda index, parts: setattr(index, "generated_utc", "2026-07-05T06:00:00-04:00"),
            "generated_utc",
        ),
        (
            lambda index, parts: setattr(index.metrics[0], "last_available_date", "2026-07-04"),
            "metric_coverage",
        ),
        (
            lambda index, parts: setattr(
                index.partitions[0], "path", "historic/history/network/not-a-generation.json"
            ),
            "ref_path",
        ),
    ],
)
def test_network_history_gate_rejects_broken_partition_refs(mutation, expected_check):  # noqa: ANN001
    bundle = _network_history_bundle()
    index = bundle.index.model_copy(deep=True)
    partitions = [partition.model_copy(deep=True) for partition in bundle.partitions]
    mutation(index, partitions)

    findings = gate.check_network_history_bundle(
        index,
        [
            (ref.path, partition)
            for ref, partition in zip(index.partitions, partitions, strict=True)
        ],
    )

    assert expected_check in {finding.check for finding in findings}


def test_network_history_gate_rejects_missing_unreferenced_and_duplicate_partition_edges():
    bundle = _network_history_bundle()
    items = list(bundle.partition_items)

    missing = gate.check_network_history_bundle(bundle.index, items[1:])
    assert "missing_partition" in {finding.check for finding in missing}

    unreferenced = gate.check_network_history_bundle(
        bundle.index,
        [
            *items,
            (
                "historic/history/network/generations/" + "f" * 64 + "/2026-08.json",
                items[0][1],
            ),
        ],
    )
    assert "unreferenced_partition" in {finding.check for finding in unreferenced}

    duplicate_built = gate.check_network_history_bundle(bundle.index, [*items, items[0]])
    assert "duplicate_built_path" in {finding.check for finding in duplicate_built}

    index = bundle.index.model_copy(deep=True)
    index.partitions.append(index.partitions[0].model_copy(deep=True))
    duplicate_ref = gate.check_network_history_bundle(index, items)
    checks = {finding.check for finding in duplicate_ref}
    assert "duplicate_ref_path" in checks
    assert "duplicate_month" in checks


def test_network_history_bounded_ref_gate_checks_exact_partition_bytes():
    bundle = _network_history_bundle()
    ref = bundle.index.partitions[0].model_copy(deep=True)
    ref.byte_size += 1

    findings = gate.check_network_history_partition_ref(ref, bundle.partitions[0])

    assert "ref_byte_size" in {finding.check for finding in findings}


def test_network_history_gate_rejects_duplicate_dates_and_metric_bounds():
    bundle = _network_history_bundle()
    partition_dict = bundle.partitions[0].model_dump(mode="python")
    partition_dict["days"].append(deepcopy(partition_dict["days"][0]))
    path = bundle.index.partitions[0].path
    duplicate = gate.check_network_history_partition(partition_dict, rel_key=path)
    assert "duplicate_date" in {finding.check for finding in duplicate}

    partition_dict = bundle.partitions[0].model_dump(mode="python")
    partition_dict["days"][0]["delay"]["on_time_count"] = 999
    bounded = gate.check_network_history_partition(partition_dict, rel_key=path)
    assert "metric_range" in {finding.check for finding in bounded}

    partition_dict = bundle.partitions[0].model_dump(mode="python")
    partition_dict["days"][0]["delay_percentiles"]["p90_delay_seconds"] = 3601
    percentile = gate.check_network_history_partition(partition_dict, rel_key=path)
    assert "metric_range" in {finding.check for finding in percentile}


@pytest.mark.parametrize(
    ("mutate", "expected_check"),
    [
        (
            lambda day: (
                setattr(day.delay, "in_clamp_observation_count", 2),
                setattr(day.delay, "on_time_count", 3),
                setattr(day.delay, "severe_count", 0),
            ),
            "delay_in_clamp_count",
        ),
        (
            lambda day: (
                setattr(day.delay, "in_clamp_observation_count", 2),
                setattr(day.delay, "on_time_count", 1),
                setattr(day.delay, "severe_count", 2),
            ),
            "delay_in_clamp_partition",
        ),
        (
            lambda day: (
                setattr(day.delay, "in_clamp_observation_count", 2),
                setattr(day.delay, "on_time_count", 1),
                setattr(day.delay, "severe_count", 1),
                setattr(day.delay, "sum_delay_seconds", 7201),
            ),
            "delay_sum_bound",
        ),
        (
            lambda day: setattr(day, "vehicles", day.delay_percentiles.observation_count + 1),
            "vehicle_observation_bound",
        ),
    ],
)
def test_network_history_bundle_gate_rejects_impossible_daily_metric_relationships(
    mutate,
    expected_check,
):  # noqa: ANN001
    bundle = _network_history_bundle()
    index = bundle.index.model_copy(deep=True)
    partitions = [partition.model_copy(deep=True) for partition in bundle.partitions]
    mutate(partitions[0].days[0])
    items = _readdress_network_bundle(index, partitions)

    findings = gate.check_network_history_bundle(index, items)

    assert expected_check in {finding.check for finding in findings}


@pytest.mark.parametrize(
    ("mutate", "expected_check"),
    [
        (
            lambda metric: (
                setattr(metric, "scheduled_trip_days", None),
                setattr(metric, "delivered_trip_days", 0),
                setattr(metric, "silent_trip_days", None),
            ),
            "cancellation_universe",
        ),
        (
            lambda metric: (
                setattr(metric, "scheduled_trip_days", 4),
                setattr(metric, "delivered_trip_days", 6),
            ),
            "cancellation_invariant",
        ),
        (
            lambda metric: (
                setattr(metric, "scheduled_trip_days", 4),
                setattr(metric, "silent_trip_days", 5),
            ),
            "cancellation_invariant",
        ),
        (
            lambda metric: (
                setattr(metric, "canceled_trip_days", 1),
                setattr(metric, "total_trip_days", 5),
                setattr(metric, "scheduled_trip_days", 6),
                setattr(metric, "delivered_trip_days", 5),
                setattr(metric, "silent_trip_days", 1),
            ),
            "cancellation_invariant",
        ),
    ],
)
def test_network_history_bundle_gate_rejects_impossible_scheduled_universe(
    mutate,
    expected_check,
):  # noqa: ANN001
    bundle = _network_history_bundle()
    index = bundle.index.model_copy(deep=True)
    partitions = [partition.model_copy(deep=True) for partition in bundle.partitions]
    cancellation = partitions[1].days[0].cancellation
    assert cancellation is not None
    mutate(cancellation)
    items = _readdress_network_bundle(index, partitions)

    findings = gate.check_network_history_bundle(index, items)

    assert expected_check in {finding.check for finding in findings}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("methodology_version", "wrong"),
        ("publish_generation_id", "run-specific"),
        ("generated_utc", "2026-07-01T08:00:00-04:00"),
    ],
)
def test_network_history_gate_rejects_noncanonical_partition_envelope(field, value):  # noqa: ANN001
    bundle = _network_history_bundle()
    partition = bundle.partitions[0].model_copy(deep=True)
    setattr(partition, field, value)
    findings = gate.check_network_history_partition(
        partition,
        rel_key=bundle.index.partitions[0].path,
    )
    assert "partition_envelope" in {finding.check for finding in findings}


def test_network_history_no_gate_corrupt_date_returns_gate_error_not_checker_crash(monkeypatch):
    bundle = _network_history_bundle()
    bundle.partitions[0].days[0].date = "not-a-date"
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(
        publish.builders,
        "build_network_history_plan",
        lambda *a, **k: _MaterializedNetworkPlan(bundle),
    )
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *a, **k: [])
    store = _RecordingStore()

    with pytest.raises(gate.GateError):
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=None,
        )
    assert store.calls == []


def test_stop_history_publish_does_not_materialize_all_entity_indexes(monkeypatch):
    stop_plan = _many_stop_history_plan()
    _patch_minimal_historic(monkeypatch, stop_plan=stop_plan)

    def forbidden(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        raise AssertionError("Stop build_indexes materialized every entity")

    monkeypatch.setattr(BuilderStopHistoryStreamSummary, "build_indexes", forbidden)

    keys = _publish_historic(
        object(),
        _RecordingStore(),
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z",
    )

    assert len([key for key in keys if key.startswith("historic/history/stops/S")]) == 0
    assert (
        sum(
            re.fullmatch(
                r"historic/history/stops/[0-9a-f]+/generations/"
                r"[0-9a-f]{64}/index\.json",
                key,
            )
            is not None
            for key in keys
        )
        == 5
    )


def test_stop_history_validate_does_not_materialize_all_entity_indexes(monkeypatch):
    _patch_minimal_historic(monkeypatch, stop_plan=_many_stop_history_plan())
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)

    def forbidden(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        raise AssertionError("Stop build_indexes materialized every entity")

    monkeypatch.setattr(BuilderStopHistoryStreamSummary, "build_indexes", forbidden)

    class Engine:
        def connect(self):
            @contextmanager
            def connection():
                yield object()

            return connection()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )

    assert report.passed


def test_historic_validate_consumes_lazy_history_plans_before_connection_closes(monkeypatch):
    _patch_minimal_historic(monkeypatch)
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)
    connection = SimpleNamespace(closed=False)
    delegate = _stop_history_plan()

    class ConnectionBoundStopPlan:
        def iter_partition_items(self):  # noqa: ANN201
            if connection.closed:
                raise RuntimeError("history loader used after connection closed")
            yield from delegate.iter_partition_items()

    monkeypatch.setattr(
        publish.builders,
        "build_stop_history_plan",
        lambda conn, **kwargs: ConnectionBoundStopPlan(),
    )

    class Engine:
        @contextmanager
        def connect(self):
            try:
                yield connection
            finally:
                connection.closed = True

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )

    assert report.passed


def test_stop_history_entity_indexes_upload_in_bounded_batches(monkeypatch):
    _patch_minimal_historic(monkeypatch, stop_plan=_many_stop_history_plan())
    monkeypatch.setattr(publish, "STOP_HISTORY_INDEX_UPLOAD_BATCH_SIZE", 2, raising=False)
    real_parallel_put = publish._parallel_put
    batch_sizes: list[int] = []

    def record_batches(storage, items, **kwargs):  # noqa: ANN001, ANN202
        if items and all(
            re.fullmatch(
                r"historic/history/stops/[0-9a-f]+/generations/"
                r"[0-9a-f]{64}/index\.json",
                rel_key,
            )
            is not None
            for rel_key, _payload, _tier in items
        ):
            batch_sizes.append(len(items))
        return real_parallel_put(storage, items, **kwargs)

    monkeypatch.setattr(publish, "_parallel_put", record_batches)

    _publish_historic(
        object(),
        _RecordingStore(),
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z",
    )

    assert batch_sizes == [2, 2, 1]


def test_analytics_gate_does_not_retain_stop_generation_digests(monkeypatch):
    stop_plan = _many_stop_history_plan()
    stop_bundle = stop_plan.materialize()
    _patch_minimal_historic(monkeypatch, stop_plan=stop_plan)
    report = _gate_report(True)
    assert report is not None

    _publish_historic(
        object(),
        _RecordingStore(),
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z",
        gate_report=report,
    )

    generation_paths = {path for path, _partition in stop_bundle.partition_items}
    assert generation_paths.isdisjoint(report.payload_sha256)
    entity_indexes = [
        path
        for path in report.payload_sha256
        if re.fullmatch(
            r"historic/history/stops/[0-9a-f]+/generations/"
            r"[0-9a-f]{64}/index\.json",
            path,
        )
    ]
    directory_indexes = [
        path
        for path in report.payload_sha256
        if re.fullmatch(
            r"historic/history/stops/generations/[0-9a-f]{64}/index\.json",
            path,
        )
    ]
    assert len(entity_indexes) == len(stop_bundle.indexes)
    assert len(directory_indexes) == 1
    for path in [*entity_indexes, *directory_indexes]:
        digest = re.search(r"/generations/([0-9a-f]{64})/index\.json$", path)
        assert digest is not None
        assert report.payload_sha256[path] == digest.group(1)
    assert "historic/history/stops/index.json" not in report.payload_sha256
    assert "historic/history/index.json" in report.payload_sha256


def test_stop_gate_summary_hashes_refs_without_retaining_duplicate_ref_models():
    from transit_ops.snapshots.contract import HistoricPartitionRef

    plan = _many_stop_history_plan(1001)
    summary = gate.StopHistoryStreamSummary()
    partition_count = 0
    for ref, partition in plan.iter_partition_items():
        summary.observe(ref, partition)
        partition_count += 1

    def retained_refs(value):  # noqa: ANN001, ANN202
        if isinstance(value, HistoricPartitionRef):
            return [value]
        if isinstance(value, dict):
            return [item for child in value.values() for item in retained_refs(child)]
        if isinstance(value, list | tuple | set):
            return [item for child in value for item in retained_refs(child)]
        if hasattr(value, "__dict__"):
            return retained_refs(vars(value))
        return []

    assert retained_refs(summary) == []
    assert sum(entity.partition_count for entity in summary.entities.values()) == partition_count


@pytest.mark.parametrize("case", ["ref", "directory"])
def test_stop_history_malformed_gate_inputs_return_findings_not_exceptions(case: str):
    bundle = _stop_history_plan().materialize()
    if case == "ref":
        partition = bundle.partitions[0].model_dump(mode="json")
        partition["days"] = [7]
        findings = gate.check_stop_history_partition_ref(
            bundle.indexes[0].partitions[0],
            partition,
        )
        assert "ref_coverage" in {finding.check for finding in findings}
    else:
        directory = bundle.directory.model_dump(mode="json")
        directory["entities"].append(
            {
                "entity_id": None,
                "encoded_id": None,
                "index_path": None,
                "collection_generation_id": None,
                "first_available_date": None,
                "last_available_date": None,
            }
        )
        findings = gate.check_stop_history_directory(
            directory,
            rel_key="historic/history/stops/index.json",
        )
        assert {"entity_order", "entity_identity"}.intersection(
            finding.check for finding in findings
        )


@pytest.mark.parametrize(
    "entity_id",
    [
        pytest.param([1], id="list"),
        pytest.param(7, id="number"),
        pytest.param({"bad": "id"}, id="object"),
    ],
)
def test_stop_history_directory_malformed_entity_id_returns_findings_not_exceptions(
    entity_id: object,
):
    directory = _stop_history_plan().materialize().directory.model_dump(mode="json")
    directory["entities"][0]["entity_id"] = entity_id

    findings = gate.check_stop_history_directory(
        directory,
        rel_key="historic/history/stops/index.json",
    )

    assert {"contract", "entity_identity"}.intersection(finding.check for finding in findings)


@pytest.mark.parametrize(
    "family",
    [
        pytest.param([], id="list"),
        pytest.param({}, id="object"),
        pytest.param(7, id="number"),
        pytest.param(None, id="null"),
    ],
)
def test_history_root_malformed_family_returns_findings_not_exceptions(family: object):
    from transit_ops.snapshots.contract import AlertArchiveIndex, ReceiptsIndex

    network = _network_history_plan().materialize().index
    lines = _line_history_plan().materialize()
    stops = _stop_history_plan().materialize()
    alerts = AlertArchiveIndex(
        generated_utc="2026-07-13T00:00:00Z",
        collection_generation_id="alerts",
        first_available_date=None,
        last_available_date=None,
        total_alerts=0,
        months=[],
    )
    receipts = ReceiptsIndex(
        generated_utc="2026-07-13T00:00:00Z",
        collection_generation_id=publish._receipts_collection_generation_id({}),
        dates=[],
    )
    hotspots, repeat_offenders = _empty_point_history_indexes()
    root = publish._build_history_availability_index(  # noqa: SLF001
        stamp="2026-07-13T00:00:00Z",
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat_offenders,
    ).model_dump(mode="json")
    root["families"][0]["family"] = family

    findings = gate.check_history_availability_index(
        root,
        rel_key="historic/history/index.json",
    )

    assert {"contract", "family_order", "family_path"}.intersection(
        finding.check for finding in findings
    )


@pytest.mark.parametrize(
    ("family", "plan_type"),
    [
        pytest.param("network", _MalformedNetworkRefPlan, id="network"),
        pytest.param("line", _MalformedLineRefPlan, id="line"),
    ],
)
@pytest.mark.parametrize("analytics_gate", [False, True])
@pytest.mark.parametrize("force", [False, True])
def test_malformed_network_and_line_refs_preserve_gate_and_force_semantics(
    monkeypatch,
    family: str,
    plan_type,
    analytics_gate: bool,
    force: bool,
):
    malformed_plan = plan_type()
    plans = {f"{family}_plan": malformed_plan}
    _patch_minimal_historic(monkeypatch, **plans)
    store = _RecordingStore()
    report = _gate_report(analytics_gate)

    if not force:
        with pytest.raises(gate.GateError) as exc_info:
            _publish_historic(
                object(),
                store,
                provider_id="stm",
                settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
                stamp="2026-07-13T00:00:00Z",
                gate_report=report,
            )
        assert "ref_count" in {finding.check for finding in exc_info.value.report.errors}
        assert malformed_plan.malformed_path not in store.objects
        assert not any(kind == "normal" for kind, _path in store.calls)
        return

    keys = _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z",
        gate_report=report,
        force=True,
    )

    assert keys[-1] == "historic/history/index.json"
    if report is not None:
        assert "ref_count" in {finding.check for finding in report.errors}


@pytest.mark.parametrize("analytics_gate", [False, True])
@pytest.mark.parametrize("force", [False, True])
def test_stop_history_malformed_partition_preserves_gate_and_force_semantics(
    monkeypatch,
    analytics_gate: bool,
    force: bool,
):
    malformed_plan = _MalformedStopPartitionPlan()
    _patch_minimal_historic(monkeypatch, stop_plan=malformed_plan)
    store = _RecordingStore()
    report = _gate_report(analytics_gate)

    if not force:
        with pytest.raises(gate.GateError):
            _publish_historic(
                object(),
                store,
                provider_id="stm",
                settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
                stamp="2026-07-13T00:00:00Z",
                gate_report=report,
            )
        assert not any(kind == "normal" for kind, _path in store.calls)
        assert malformed_plan.ref.path not in store.objects
        return

    keys = _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z",
        gate_report=report,
        force=True,
    )
    assert keys[-1] == "historic/history/index.json"
    if report is not None:
        assert report.errors


def test_history_root_gate_handles_malformed_stop_dates_gaps_and_metrics():
    from transit_ops.snapshots.contract import AlertArchiveIndex, ReceiptsIndex

    network = _network_history_plan().materialize().index
    lines = _line_history_plan().materialize()
    stops = _stop_history_plan().materialize()
    alerts = AlertArchiveIndex(
        generated_utc="2026-07-13T00:00:00Z",
        collection_generation_id="alerts",
        first_available_date=None,
        last_available_date=None,
        total_alerts=0,
        months=[],
    )
    receipts = ReceiptsIndex(
        generated_utc="2026-07-13T00:00:00Z",
        collection_generation_id=publish._receipts_collection_generation_id({}),
        dates=[],
    )
    hotspots, repeat_offenders = _empty_point_history_indexes()
    root = publish._build_history_availability_index(  # noqa: SLF001
        stamp="2026-07-13T00:00:00Z",
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat_offenders,
    )
    malformed = stops.indexes[0].model_dump(mode="json")
    malformed["available_dates"].append(None)
    malformed["metrics"][0]["gaps"] = [{"start_date": None, "end_date": "2026-07-01"}]

    findings = gate.check_history_availability_graph(
        root,
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=[malformed],
        hotspots_index=hotspots,
        repeat_offenders_index=repeat_offenders,
        fallback_generated_utc="2026-07-13T00:00:00Z",
    )

    assert "history_root_graph" in {finding.check for finding in findings}


def test_stop_history_validate_reports_malformed_index_without_root_reconstruction_crash(
    monkeypatch,
):
    _patch_minimal_historic(monkeypatch, stop_plan=_stop_history_plan())
    monkeypatch.setattr(
        publish.builders,
        "StopHistoryStreamSummary",
        _MalformedStopIndexSummary,
    )
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)

    class Engine:
        def connect(self):
            @contextmanager
            def connection():
                yield object()

            return connection()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )

    assert not report.passed
    assert {"available_dates", "history_root_graph"}.intersection(
        finding.check for finding in report.errors
    )


def test_receipts_collection_gate_reconciles_exact_stamped_payload_semantics():
    from transit_ops.snapshots.contract import Receipt, ReceiptsIndex

    receipt = Receipt(
        generated_utc="2026-07-13T00:00:00Z",
        publish_generation_id="stm@2026-07-13T00:00:00Z",
        date="2026-07-01",
        affected_routes=2,
    )
    items = [("historic/receipts/2026-07-01.json", receipt)]
    index = ReceiptsIndex(
        generated_utc="2026-07-13T00:00:00Z",
        dates=["2026-07-01"],
        collection_generation_id=publish._receipts_collection_generation_id(
            {receipt.date: receipt}
        ),
    )
    assert gate.check_receipts_collection(index, items) == []

    wrong_generation = index.model_copy(update={"collection_generation_id": "wrong"})
    omitted = gate.check_receipts_collection(index, [])
    extra_receipt = receipt.model_copy(update={"date": "2026-07-02"})
    extra = gate.check_receipts_collection(
        index,
        [*items, ("historic/receipts/2026-07-02.json", extra_receipt)],
    )
    changed = gate.check_receipts_collection(
        index,
        [(items[0][0], receipt.model_copy(update={"affected_routes": 99}))],
    )
    wrong = gate.check_receipts_collection(wrong_generation, items)

    for findings in (omitted, extra, changed, wrong):
        assert "receipt_collection" in {finding.check for finding in findings}


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_historic_publish_gates_receipt_collection_before_retained_pointers(
    monkeypatch,
    analytics_gate: bool,
):
    from transit_ops.snapshots.contract import Receipt, ReceiptsIndex

    receipt = Receipt(
        generated_utc="2026-07-13T00:00:00Z",
        date="2026-07-01",
        affected_routes=2,
    )
    index = ReceiptsIndex(
        generated_utc="2026-07-13T00:00:00Z",
        dates=[receipt.date],
        collection_generation_id="wrong",
    )
    _patch_minimal_historic(
        monkeypatch,
        compatibility_items=[
            ("historic/receipts/2026-07-01.json", receipt, "historic"),
            ("historic/receipts/index.json", index, "historic"),
        ],
    )
    monkeypatch.setattr(publish, "_finalize_receipts_collection_generation", lambda items: None)
    store = _RecordingStore()

    with pytest.raises(gate.GateError) as exc_info:
        _publish_historic(
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp="2026-07-13T00:00:00Z",
            gate_report=_gate_report(analytics_gate),
        )

    assert "receipt_collection" in {finding.check for finding in exc_info.value.report.errors}
    assert not any(path.startswith("historic/history/") for _kind, path in store.calls)


def test_historic_validate_gates_receipt_collection_semantics(monkeypatch):
    from transit_ops.snapshots.contract import Receipt, ReceiptsIndex

    receipt = Receipt(
        generated_utc="2026-07-13T00:00:00Z",
        date="2026-07-01",
        affected_routes=2,
    )
    index = ReceiptsIndex(
        generated_utc="2026-07-13T00:00:00Z",
        dates=[receipt.date],
        collection_generation_id="wrong",
    )
    _patch_minimal_historic(
        monkeypatch,
        compatibility_items=[
            ("historic/receipts/2026-07-01.json", receipt, "historic"),
            ("historic/receipts/index.json", index, "historic"),
        ],
    )
    monkeypatch.setattr(publish, "_finalize_receipts_collection_generation", lambda items: None)
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)

    class Engine:
        def connect(self):
            @contextmanager
            def connection():
                yield object()

            return connection()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )

    assert "receipt_collection" in {finding.check for finding in report.errors}


def _root_gate_fixture():
    from transit_ops.snapshots.contract import AlertArchiveIndex, ReceiptsIndex

    network = _network_history_plan().materialize().index
    lines = _line_history_plan().materialize()
    stops = _stop_history_plan().materialize()
    alerts = AlertArchiveIndex(
        generated_utc="2026-07-11T00:00:00Z",
        collection_generation_id="alert-generation",
        first_available_date="2026-06-01",
        last_available_date="2026-07-01",
        total_alerts=1,
        months=[],
    )
    receipts = ReceiptsIndex(
        generated_utc="2026-07-12T00:00:00Z",
        collection_generation_id="receipt-generation",
        dates=["2026-07-01"],
    )
    hotspots, repeat_offenders = _empty_point_history_indexes()
    root = publish._build_history_availability_index(  # noqa: SLF001
        stamp="2026-07-13T00:00:00Z",
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat_offenders,
    )
    return SimpleNamespace(
        root=root,
        alerts=alerts,
        receipts=receipts,
        network=network,
        lines=lines,
        stops=stops,
        hotspots=hotspots,
        repeat_offenders=repeat_offenders,
    )


def test_history_root_gate_invalid_receipt_calendar_date_returns_finding_not_exception():
    fixture = _root_gate_fixture()
    fixture.receipts.dates = ["not-a-date"]

    findings = gate.check_history_availability_graph(
        fixture.root,
        alert_index=fixture.alerts,
        receipts_index=fixture.receipts,
        network_index=fixture.network,
        line_directory=fixture.lines.directory,
        line_indexes=fixture.lines.indexes,
        stop_directory=fixture.stops.directory,
        stop_indexes=fixture.stops.indexes,
        hotspots_index=fixture.hotspots,
        repeat_offenders_index=fixture.repeat_offenders,
        fallback_generated_utc="2026-07-13T00:00:00Z",
    )

    assert "history_root_graph" in {finding.check for finding in findings}


@pytest.mark.parametrize("singleton", ["alerts", "receipts", "network"])
def test_history_root_gate_bad_populated_singleton_timestamp_returns_finding(
    singleton: str,
):
    fixture = _root_gate_fixture()
    child = getattr(fixture, singleton).model_copy(deep=True)
    child.generated_utc = "bad"
    setattr(fixture, singleton, child)

    findings = gate.check_history_availability_graph(
        fixture.root,
        alert_index=fixture.alerts,
        receipts_index=fixture.receipts,
        network_index=fixture.network,
        line_directory=fixture.lines.directory,
        line_indexes=fixture.lines.indexes,
        stop_directory=fixture.stops.directory,
        stop_indexes=fixture.stops.indexes,
        hotspots_index=fixture.hotspots,
        repeat_offenders_index=fixture.repeat_offenders,
        fallback_generated_utc="2026-07-13T00:00:00Z",
    )

    assert "history_root_graph" in {finding.check for finding in findings}


class _BadGeneratedUtcNetworkPlan:
    def __init__(self) -> None:
        self.plan = _network_history_plan()

    def iter_partition_items(self):  # noqa: ANN201
        return self.plan.iter_partition_items()

    def build_index(self, refs):  # noqa: ANN001, ANN201
        index = self.plan.build_index(refs)
        index.generated_utc = "bad"
        return index


def _invalid_date_receipts_singleton():
    from transit_ops.snapshots.contract import ReceiptsIndex

    index = ReceiptsIndex(
        generated_utc="2026-07-13T00:00:00Z",
        collection_generation_id="pending",
        dates=[],
    )
    index.dates = ["not-a-date"]
    return index


def _bad_generated_utc_receipts_singleton():
    from transit_ops.snapshots.contract import ReceiptsIndex

    index = ReceiptsIndex(
        generated_utc="2026-07-13T00:00:00Z",
        collection_generation_id="pending",
        dates=["2026-07-01"],
    )
    index.generated_utc = "bad"
    return index


def _bad_generated_utc_alert_archive():
    from transit_ops.snapshots.contract import AlertArchiveIndex

    index = AlertArchiveIndex(
        generated_utc="2026-07-13T00:00:00Z",
        collection_generation_id="alert-generation",
        first_available_date="2026-07-01",
        last_available_date="2026-07-01",
        total_alerts=1,
        months=[],
    )
    index.generated_utc = "bad"
    return SimpleNamespace(index=index, page_items=[], provider_timezone="UTC")


def _patch_malformed_history_singleton(monkeypatch, malformation: str) -> None:
    if malformation == "invalid_receipt_date":
        _patch_minimal_historic(
            monkeypatch,
            compatibility_items=[
                (
                    "historic/receipts/index.json",
                    _invalid_date_receipts_singleton(),
                    "historic",
                ),
            ],
        )
        return
    if malformation == "alerts_timestamp":
        _patch_minimal_historic(monkeypatch, archive=_bad_generated_utc_alert_archive())
        return
    if malformation == "receipts_timestamp":
        _patch_minimal_historic(
            monkeypatch,
            compatibility_items=[
                (
                    "historic/receipts/index.json",
                    _bad_generated_utc_receipts_singleton(),
                    "historic",
                ),
            ],
        )
        return
    if malformation == "network_timestamp":
        _patch_minimal_historic(monkeypatch, network_plan=_BadGeneratedUtcNetworkPlan())
        return
    raise AssertionError(f"unknown malformation: {malformation}")


@pytest.mark.parametrize(
    "malformation",
    [
        "invalid_receipt_date",
        "alerts_timestamp",
        "receipts_timestamp",
        "network_timestamp",
    ],
)
@pytest.mark.parametrize("analytics_gate", [False, True])
@pytest.mark.parametrize("force", [False, True])
def test_historic_publish_malformed_singleton_preserves_gate_and_force_semantics(
    monkeypatch,
    malformation: str,
    analytics_gate: bool,
    force: bool,
):
    _patch_malformed_history_singleton(monkeypatch, malformation)
    store = _RecordingStore()
    report = _gate_report(analytics_gate)

    if not force:
        with pytest.raises(gate.GateError) as exc_info:
            _publish_historic(
                object(),
                store,
                provider_id="stm",
                settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
                stamp="2026-07-13T00:00:00Z",
                gate_report=report,
            )
        assert exc_info.value.report.errors
        assert not any(kind == "normal" for kind, _path in store.calls)
        return

    keys = _publish_historic(
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z",
        gate_report=report,
        force=True,
    )

    assert keys[-1] == "historic/history/index.json"
    if report is not None:
        assert "history_root_graph" in {finding.check for finding in report.errors}


@pytest.mark.parametrize(
    "malformation",
    [
        "invalid_receipt_date",
        "alerts_timestamp",
        "receipts_timestamp",
        "network_timestamp",
    ],
)
def test_historic_validate_malformed_singleton_returns_findings(
    monkeypatch,
    malformation: str,
):
    _patch_malformed_history_singleton(monkeypatch, malformation)
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)

    class Engine:
        def connect(self):
            @contextmanager
            def connection():
                yield object()

            return connection()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )

    assert "history_root_graph" in {finding.check for finding in report.errors}
