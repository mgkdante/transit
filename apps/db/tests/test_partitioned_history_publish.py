from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from types import SimpleNamespace

import pytest
from test_partitioned_history_builders import _line_history_rows, _network_history_rows

from transit_ops.snapshots import gate, publish
from transit_ops.snapshots.builders.historic.history_common import (
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
from transit_ops.snapshots.publish import (
    _publish_historic,
    _stable_outcome_total,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256


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


@pytest.fixture(autouse=True)
def _default_empty_line_history(monkeypatch):
    """Keep pre-Line publisher tests scoped to their original Network subject."""

    monkeypatch.setattr(
        publish.builders,
        "build_line_history_plan",
        lambda *args, **kwargs: _empty_line_history_plan(),
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

    def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
        body = snapshot_json_bytes(payload)
        self.calls.append(("immutable", rel_key))
        if self.fail_partition:
            raise RuntimeError("partition write failed")
        if self.objects.get(rel_key) == body:
            self.immutable_skipped.append(rel_key)
        else:
            self.objects[rel_key] = body
            self.immutable_written.append(rel_key)
        return rel_key

    def put_json(self, rel_key, payload, *, tier):  # noqa: ANN001, ANN201, ARG002
        self.calls.append(("normal", rel_key))
        if self.fail_index and rel_key == "historic/history/network/index.json":
            raise RuntimeError("index write failed")
        self.objects[rel_key] = snapshot_json_bytes(payload)
        return rel_key


def _patch_minimal_historic(
    monkeypatch,
    *,
    line_plan=None,
    network_plan=None,
    compatibility_items=None,
):
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    compatibility_items = list(compatibility_items or [])
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
    monkeypatch.setattr(publish.gate, "check_alert_archive_bundle", lambda *args, **kwargs: [])


def _line_index_path(entity_id: str) -> str:
    return f"historic/history/lines/{encode_history_entity_id(entity_id)}/index.json"


def _seed_retained_pointers(store, line_bundle):  # noqa: ANN001, ANN202
    pointer_keys = [
        "historic/history/network/index.json",
        *[_line_index_path(index.entity_id or "") for index in line_bundle.indexes],
        "historic/history/lines/index.json",
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
    line_indexes = [_line_index_path(index.entity_id or "") for index in line_bundle.indexes]
    expected = [
        *network_partitions,
        *line_partitions,
        compatibility_key,
        "historic/history/network/index.json",
        *line_indexes,
        "historic/history/lines/index.json",
    ]
    assert [path for _kind, path in store.calls] == expected
    assert keys == expected
    assert all(
        kind == "immutable"
        for kind, _path in store.calls[: len(network_partitions) + len(line_partitions)]
    )
    assert all(path != "historic/history/index.json" for _kind, path in store.calls)


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
    assert line_calls == [bundle.partition_items[0][0]]
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
    target = _line_index_path(bundle.indexes[1].entity_id or "")
    later = _line_index_path(bundle.indexes[2].entity_id or "")
    directory_key = "historic/history/lines/index.json"
    _patch_minimal_historic(monkeypatch, line_plan=line_plan)

    class FailEntityIndex(_RecordingStore):
        def put_json(self, rel_key, payload, *, tier):  # noqa: ANN001, ANN201
            if rel_key == target:
                self.calls.append(("normal", rel_key))
                raise RuntimeError("Line entity index failed")
            return super().put_json(rel_key, payload, tier=tier)

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

    assert store.objects[target] == expected_pointers[target]
    assert store.objects[later] == expected_pointers[later]
    assert store.objects[directory_key] == expected_pointers[directory_key]
    assert ("normal", directory_key) not in store.calls


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
        def put_json(self, rel_key, payload, *, tier):  # noqa: ANN001, ANN201
            if rel_key == directory_key:
                self.calls.append(("normal", rel_key))
                raise RuntimeError("Lines directory failed")
            return super().put_json(rel_key, payload, tier=tier)

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
    assert all(
        store.objects[_line_index_path(index.entity_id or "")]
        != expected_pointers[_line_index_path(index.entity_id or "")]
        for index in bundle.indexes
    )
    assert store.calls[-1] == ("normal", directory_key)


def test_network_history_actual_historic_publish_is_separate_structural_and_has_no_root(
    monkeypatch,
):
    bundle = _network_history_bundle()
    plan = _network_history_plan()
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(publish.builders, "build_network_history_plan", lambda *a, **k: plan)
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
    assert [path for _kind, path in store.calls] == [
        *(ref.path for ref in bundle.index.partitions),
        "historic/history/network/index.json",
    ]
    assert all(path != "historic/history/index.json" for _kind, path in store.calls)

    outcomes = SimpleNamespace(
        written=["historic/history/network/index.json"],
        skipped=[],
        immutable_written=[ref.path for ref in bundle.index.partitions],
        immutable_skipped=[],
    )
    assert _stable_outcome_total(outcomes) == 1


def test_network_history_actual_publish_builds_gates_and_uploads_one_month_at_a_time(
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
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(
        publish.builders,
        "build_network_history",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("monolithic builder called")),
    )
    monkeypatch.setattr(
        publish.builders,
        "build_network_history_plan",
        lambda *a, **k: plan,
        raising=False,
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
            events.append(("put-partition", payload.month))
            return super().put_immutable_json(rel_key, payload)

        def put_json(self, rel_key, payload, *, tier):  # noqa: ANN001, ANN201
            if rel_key == "historic/history/network/index.json":
                events.append(("put-index", "network"))
            return super().put_json(rel_key, payload, tier=tier)

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
        ("put-partition", "2026-06"),
        ("release", "2026-06"),
        ("build", "2026-07"),
        ("gate-partition", "2026-07"),
        ("gate-ref", "2026-07"),
        ("put-partition", "2026-07"),
        ("release", "2026-07"),
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
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(publish.builders, "build_network_history_plan", lambda *a, **k: plan)
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
def test_network_history_index_put_failure_leaves_children_and_preserves_existing_pointer(
    monkeypatch,
    analytics_gate: bool,
):
    plan = _network_history_plan()
    bundle = plan.materialize()
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    monkeypatch.setattr(publish, "_build_historic_items", lambda *a, **k: ([], [], [], archive))
    monkeypatch.setattr(publish.builders, "build_network_history_plan", lambda *a, **k: plan)
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
    assert store.calls[-1] == ("normal", index_key)


@pytest.mark.parametrize("analytics_gate", [False, True])
def test_network_history_compatibility_stage_failure_preserves_existing_pointer(
    monkeypatch,
    analytics_gate: bool,
):
    plan = _network_history_plan()
    bundle = plan.materialize()
    archive = SimpleNamespace(index={}, page_items=[], provider_timezone="UTC")
    compatibility_key = "historic/compatibility-pointer.json"
    compatibility_item = (compatibility_key, {"status": "ready"}, "historic")
    monkeypatch.setattr(
        publish,
        "_build_historic_items",
        lambda *a, **k: ([compatibility_item], [], [([compatibility_item], "normal")], archive),
    )
    monkeypatch.setattr(publish.builders, "build_network_history_plan", lambda *a, **k: plan)
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
    assert collected[4] is archive
    assert collected[5] is plan

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )
    assert {ref.path for ref in bundle.index.partitions}.issubset(report.payload_sha256)
    assert "historic/history/network/index.json" in report.payload_sha256


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
