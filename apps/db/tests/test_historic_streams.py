"""Child-stream ownership: one pass, bounded writes, collect-only validation."""

from collections import Counter

import pytest
from test_partitioned_history_publish import (
    _line_history_plan,
    _network_history_plan,
    _stop_history_plan,
)

from transit_ops.snapshots import gate, historic_receipts
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


@pytest.mark.parametrize(
    "relative", ["snapshots/historic_streams.py", "snapshots/historic_graph.py"],
)
def test_moved_owner_is_required_by_family_and_gate_code_evidence(tmp_path, relative):
    manifests = (historic_receipts._FAMILY_MANIFEST_SHARED, historic_receipts._GATE_MANIFEST)
    for filename in set().union(*manifests):
        path = tmp_path / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(filename)
    for manifest in manifests:
        assert relative in manifest
    before = [
        historic_receipts.digest_file_manifest(tmp_path, required_relative_paths=m)
        for m in manifests
    ]
    (tmp_path / relative).write_text("changed stream policy")
    after = [
        historic_receipts.digest_file_manifest(tmp_path, required_relative_paths=m)
        for m in manifests
    ]
    assert all(left != right for left, right in zip(before, after, strict=True))
    (tmp_path / relative).unlink()
    for manifest in manifests:
        with pytest.raises(historic_receipts.HistoricReceiptEvidenceError, match="missing"):
            historic_receipts.digest_file_manifest(tmp_path, required_relative_paths=manifest)
