
from collections import Counter
from concurrent.futures import Executor, Future

import pytest
from test_partitioned_history_publish import (
    _line_history_plan,
    _network_history_plan,
    _stop_history_plan,
)

from transit_ops.snapshots import gate, uploads
from transit_ops.snapshots.historic_streams import HistoricPlans, consume_history_children
from transit_ops.snapshots.serialization import snapshot_json_bytes


def plans():
    return HistoricPlans(_network_history_plan(), _line_history_plan(), _stop_history_plan())


@pytest.mark.parametrize("record_payloads", [False, True])
def test_three_families_stream_once_with_bounded_immutable_batches(monkeypatch, record_payloads):
    selected = plans()
    families = (("network", selected.network), ("lines", selected.lines), ("stops", selected.stops))
    expected = []
    consumed = Counter()
    for family, plan in families:
        expected.extend(
            (ref.path, snapshot_json_bytes(payload)) for ref, payload in plan.iter_partition_items()
        )
        original = type(plan).iter_partition_items

        def tracked(self, _family=family, _original=original):
            consumed[_family] += 1
            yield from _original(self)

        monkeypatch.setattr(type(plan), "iter_partition_items", tracked)
    batches = []

    def write_batch(items):
        assert 0 < len(items) <= 2
        batches.append([(path, snapshot_json_bytes(payload)) for path, payload in items])
        return [path for path, _ in items]

    report = gate.new_report("stm", "historic", "2026-07-13T00:00:00Z")
    result = consume_history_children(
        selected,
        report,
        batch_size=2,
        write_batch=write_batch,
        record_payloads=record_payloads,
    )

    assert consumed == {"network": 1, "lines": 1, "stops": 1}
    assert [item for batch in batches for item in batch] == expected
    assert result.written_keys == [path for path, _ in expected]
    assert report.passed
    assert result.network.detached_refs()
    assert result.lines.refs
    assert result.stops.entities
    expected_sha_keys = (
        {path for path, _ in expected if "/stops/" not in path} if record_payloads else set()
    )
    assert set(report.payload_sha256) == expected_sha_keys


def test_validation_collects_bad_references_without_enforcing_or_writing(monkeypatch):
    plan = _network_history_plan()
    original = list(plan.iter_partition_items())
    bad = [(ref.model_copy(update={"sha256": "0" * 64}), payload) for ref, payload in original]
    monkeypatch.setattr(type(plan), "iter_partition_items", lambda self: iter(bad))
    report = gate.new_report("stm", "historic", "2026-07-13T00:00:00Z")

    result = consume_history_children(HistoricPlans(network=plan), report, batch_size=1)

    assert not report.passed
    assert report.payloads_checked == len(original)
    assert len(result.network.detached_refs()) == len(original)
    assert result.written_keys == []


def test_publication_rejects_a_bad_child_before_its_upload(monkeypatch):
    plan = _network_history_plan()
    ref, payload = next(plan.iter_partition_items())
    monkeypatch.setattr(
        type(plan),
        "iter_partition_items",
        lambda self: iter([(ref.model_copy(update={"sha256": "0" * 64}), payload)]),
    )
    writes = []
    report = gate.new_report("stm", "historic", "2026-07-13T00:00:00Z")
    with pytest.raises(gate.GateError):
        consume_history_children(
            HistoricPlans(network=plan),
            report,
            batch_size=1,
            write_batch=lambda items: writes.extend(items) or [],
        )
    assert writes == []


def test_writer_failure_preserves_error_and_stops_advancing_the_lazy_plan(monkeypatch):
    selected = plans()
    seen = []
    original = type(selected.network).iter_partition_items

    def tracked(self):
        for ref, payload in original(self):
            seen.append(ref.path)
            yield ref, payload

    monkeypatch.setattr(type(selected.network), "iter_partition_items", tracked)
    monkeypatch.setattr(
        type(selected.lines),
        "iter_partition_items",
        lambda self: pytest.fail("later family started after failed batch"),
    )
    failure = RuntimeError("drained batch failed")

    def write_batch(items):
        assert len(items) == 1
        raise failure

    with pytest.raises(RuntimeError, match="drained batch failed") as raised:
        consume_history_children(
            selected,
            gate.new_report("stm", "historic", "2026-07-13T00:00:00Z"),
            batch_size=1,
            write_batch=write_batch,
        )
    assert raised.value is failure
    assert len(seen) == 1


@pytest.mark.parametrize("stage", ["children", "parents"])
def test_upload_window_overlaps_production_without_waiting_for_a_slow_first_upload(stage):
    items = list(_network_history_plan().iter_partition_items())
    # Reuse valid children; this test checks scheduling rather than graph identity.
    items = (items * 3)[:5]
    produced = []
    futures = []
    first_work = []
    peak = 0

    class ControlledExecutor(Executor):
        def submit(self, fn, /, *args, **kwargs):
            nonlocal peak
            future = Future()
            futures.append(future)
            peak = max(peak, sum(not item.done() for item in futures))
            if len(futures) == 1:
                first_work.append(lambda: future.set_result(fn(*args, **kwargs)))
            else:
                future.set_result(fn(*args, **kwargs))
            return future

    class Plan:
        def iter_partition_items(self):
            for index, item in enumerate(items):
                if index == 1:
                    assert futures, "first upload must be submitted before producing child two"
                if index == 2:
                    assert not futures[0].done(), "window waited for the slow first upload"
                    first_work[0]()
                produced.append(item[0].path)
                yield item

    class Store:
        def put_json(self, key, payload, *, tier):
            return key

    token = uploads._ACTIVE_PUBLISH_EXECUTOR.set(ControlledExecutor())
    try:
        if stage == "children":
            result = consume_history_children(
                HistoricPlans(network=Plan()),
                gate.new_report("stm", "historic", "2026-07-13T00:00:00Z"),
                batch_size=2,
                write_batch=lambda batch: [path for path, _payload in batch],
            ).written_keys
        else:
            result = uploads.put_batches(
                Store(),
                ((ref.path, payload, "historic") for ref, payload in Plan().iter_partition_items()),
                concurrency=2,
                batch_size=2,
            )
    finally:
        uploads._ACTIVE_PUBLISH_EXECUTOR.reset(token)
    assert result == produced
    assert len(produced) == 5
    assert peak <= 2
    assert all(future.done() for future in futures)


@pytest.mark.parametrize("stage", ["children", "parents"])
def test_upload_window_failure_stops_production_and_drains_pending_uploads(stage):
    items = list(_network_history_plan().iter_partition_items())
    produced = []
    futures = []
    failure = RuntimeError("window upload failed")

    class FailingExecutor(Executor):
        def submit(self, fn, /, *args, **kwargs):
            future = Future()
            futures.append(future)
            if len(futures) == 2:
                future.set_exception(failure)
            return future

    class Plan:
        def iter_partition_items(self):
            for item in items * 3:
                produced.append(item[0].path)
                yield item

    class Store:
        def put_json(self, key, payload, *, tier):
            return key

    token = uploads._ACTIVE_PUBLISH_EXECUTOR.set(FailingExecutor())
    try:
        with pytest.raises(RuntimeError, match="window upload failed") as raised:
            if stage == "children":
                consume_history_children(
                    HistoricPlans(network=Plan()),
                    gate.new_report("stm", "historic", "2026-07-13T00:00:00Z"),
                    batch_size=2,
                    write_batch=lambda batch: [path for path, _payload in batch],
                )
            else:
                uploads.put_batches(
                    Store(),
                    (
                        (ref.path, payload, "historic")
                        for ref, payload in Plan().iter_partition_items()
                    ),
                    concurrency=2,
                    batch_size=2,
                )
            pytest.fail("later stage ran after an upload failed")
    finally:
        uploads._ACTIVE_PUBLISH_EXECUTOR.reset(token)
    assert raised.value is failure
    assert len(produced) == 2
    assert futures[0].cancelled()
    assert all(future.done() for future in futures)
