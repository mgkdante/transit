"""Root composition keeps checked object identity and trusted reference inventory."""

from collections import Counter
from types import SimpleNamespace

import pytest
import test_partitioned_history_publish as fixture

from transit_ops.snapshots import envelope, gate, historic_tier
from transit_ops.snapshots.historic_graph import HISTORY_ROOT_PATH, HistoricGraph


@pytest.mark.parametrize("record_payloads", [False, True])
def test_graph_reuses_stamped_parents_and_root_through_gate_inventory_and_activation(
    monkeypatch, record_payloads,
):
    fixture._empty_point_history_plans.__wrapped__(monkeypatch)
    fixture._patch_minimal_historic(
        monkeypatch, network_plan=fixture._network_history_plan(),
        line_plan=fixture._line_history_plan(), stop_plan=fixture._stop_history_plan(),
    )
    observations = Counter()
    captured = {}
    original_build = HistoricGraph.build_root

    def build(self, stamp):
        root = original_build(self, stamp)
        captured.update(graph=self, root=root, parents=dict([
            self.alerts, self.receipts, self.network, self.lines.index,
            self.stops.index, self.hotspots, self.repeat_offenders,
        ]))
        observations["build"] += 1
        return root

    monkeypatch.setattr(HistoricGraph, "build_root", build)
    original_stamp = envelope.stamp_envelope

    def stamp(items, **kwargs):
        original_stamp(items, **kwargs)
        for path, payload, _tier in items:
            if path == HISTORY_ROOT_PATH:
                assert payload is captured["root"]
                observations["stamp"] += 1

    monkeypatch.setattr(envelope, "stamp_envelope", stamp)
    original_check = gate.check_history_availability_graph

    def check(root, **kwargs):
        assert root is captured["root"]
        assert observations["stamp"] == 1
        for name in ("alert", "receipts", "network", "hotspots", "repeat_offenders"):
            assert any(kwargs[f"{name}_index"] is parent for parent in captured["parents"].values())
        assert kwargs["line_directory"] is captured["graph"].lines.index[1]
        assert kwargs["stop_directory"] is captured["graph"].stops.index[1]
        observations["gate"] += 1
        return original_check(root, **kwargs)

    monkeypatch.setattr(gate, "check_history_availability_graph", check)

    class Store(fixture._RecordingStore):
        def put_immutable_json(self, path, payload):
            if path in captured.get("parents", {}):
                assert payload is captured["parents"][path]
                observations["parent_upload"] += 1
            return super().put_immutable_json(path, payload)

        def activate_stable_json(self, path, payload, **kwargs):
            assert payload is captured["root"]
            assert observations["clear"] == observations["gate"] == 1
            observations["activate"] += 1
            return super().activate_stable_json(path, payload, **kwargs)

    store = Store()

    def clear(conn, provider_id, keys):
        assert keys == sorted(path for path in store.objects if "/generations/" in path)
        observations["clear"] += 1

    monkeypatch.setattr(historic_tier, "_clear_referenced_historic_gc_marks", clear)
    historic_tier.publish(
        object(), store, provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp="2026-07-13T00:00:00Z", gate_report=fixture._gate_report(record_payloads),
    )
    assert observations == {
        "build": 1, "stamp": 1, "gate": 1, "parent_upload": 7, "clear": 1, "activate": 1,
    }

    graph = captured["graph"]
    trusted_hotspot = "historic/history/hotspots/generations/trusted/day.json"
    trusted_stop = "historic/history/stops/generations/trusted/index.json"
    graph.hotspots[1].partitions = [SimpleNamespace(path="untrusted-point-index-partition")]
    keys = graph.immutable_references(
        hotspot_refs=[SimpleNamespace(path=trusted_hotspot)],
        repeat_offender_refs=[], stop_keys={trusted_stop},
    )
    assert trusted_hotspot in keys and trusted_stop in keys
    assert "untrusted-point-index-partition" not in keys
    with pytest.raises(RuntimeError, match="only immutable generation keys"):
        graph.immutable_references(hotspot_refs=[], repeat_offender_refs=[], stop_keys={"mutable"})
