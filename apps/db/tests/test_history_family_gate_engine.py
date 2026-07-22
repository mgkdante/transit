from __future__ import annotations

import hashlib
import json
from copy import deepcopy

from test_partitioned_history_builders import _line_history_rows, _network_history_rows

from transit_ops.snapshots import gate
from transit_ops.snapshots.builders.historic.line_history import build_line_history_plan_from_rows
from transit_ops.snapshots.builders.historic.network_history import build_network_history_from_rows
from transit_ops.snapshots.builders.historic.stop_history import build_stop_history_plan_from_rows

STAMP = "2026-07-13T00:00:00Z"


def _network_bundle():  # noqa: ANN202
    delay, fact, cancellation, occupancy = _network_history_rows()
    return build_network_history_from_rows(
        delay_rows=delay,
        fact_rows=fact,
        cancellation_rows=cancellation,
        occupancy_rows=occupancy,
        generated_utc=STAMP,
    )


def _line_bundle():  # noqa: ANN202
    delay, percentiles, cancellation, occupancy, service_span, skipped_stops = (
        _line_history_rows()
    )
    return build_line_history_plan_from_rows(
        delay_rows=delay,
        percentile_rows=percentiles,
        cancellation_rows=cancellation,
        occupancy_rows=occupancy,
        service_span_rows=service_span,
        skipped_stop_rows=skipped_stops,
        generated_utc=STAMP,
        entity_batch_size=2,
    ).materialize()


def _stop_bundle():  # noqa: ANN202
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
        generated_utc=STAMP,
    ).materialize()


def _ordered_characterization():  # noqa: ANN202
    cases = []

    network = _network_bundle()
    partition = network.partitions[0].model_dump(mode="json")
    partition["methodology_version"] = "wrong"
    partition["publish_generation_id"] = "run"
    partition["generated_utc"] = "not-a-timestamp"
    partition["days"].append(deepcopy(partition["days"][0]))
    partition["days"][0]["delay"]["in_clamp_observation_count"] = 1
    partition["days"][0]["delay"]["on_time_count"] = 2
    cases.append(
        ("network-partition", gate.check_network_history_partition(partition, rel_key="bad"))
    )

    ref = network.index.partitions[0].model_copy(deep=True)
    ref.sha256 = "f" * 64
    ref.byte_size += 7
    ref.count += 1
    ref.coverage_start = "2020-01-01"
    ref_partition = network.partitions[0].model_copy(deep=True)
    ref_partition.month = "2020-01"
    cases.append(("network-ref", gate.check_network_history_partition_ref(ref, ref_partition)))

    index = network.index.model_dump(mode="json")
    index["family"] = "lines"
    index["entity_id"] = "not-network"
    index["generated_utc"] = "bad"
    index["available_dates"] = list(reversed(index["available_dates"]))
    index["partitions"].append(deepcopy(index["partitions"][0]))
    index["metrics"] = list(reversed(index["metrics"]))
    index["collection_generation_id"] = "wrong"
    cases.append(("network-index", gate.check_network_history_index(index, rel_key="bad")))

    network_summary = gate.NetworkHistoryStreamSummary()
    for child_ref, child in zip(network.index.partitions, network.partitions, strict=True):
        network_summary.observe(child_ref, child)
    stream_index = network.index.model_dump(mode="json")
    stream_index["partitions"] = list(reversed(stream_index["partitions"]))
    stream_index["available_dates"] = list(reversed(stream_index["available_dates"]))
    stream_index["metrics"] = []
    stream_index["generated_utc"] = STAMP
    cases.append(
        (
            "network-stream",
            gate.check_network_history_stream_index(
                stream_index,
                network_summary,
                fallback_generated_utc=STAMP,
            ),
        )
    )
    bundle_index = network.index.model_copy(deep=True)
    bundle_index.partitions.append(bundle_index.partitions[0].model_copy(deep=True))
    items = list(network.partition_items)
    cases.append(
        (
            "network-bundle",
            gate.check_network_history_bundle(
                bundle_index,
                [*items, items[0], ("historic/history/network/unreferenced.json", items[0][1])],
            ),
        )
    )

    line = _line_bundle()
    line_ref = line.indexes[0].partitions[0]
    line_partition = line.partitions[0].model_dump(mode="json")
    line_partition["entity_id"] = "wrong"
    line_partition["month"] = "2020-01"
    line_partition["methodology_version"] = "wrong"
    line_partition["generated_utc"] = "bad"
    line_partition["days"].append(deepcopy(line_partition["days"][0]))
    line_partition["days"][0]["headway"] = []
    line_partition["days"][0]["service_span"] = {
        "first_trip_utc": "bad",
        "last_trip_utc": "also-bad",
    }
    cases.append(
        ("line-partition", gate.check_line_history_partition(line_partition, rel_key="bad"))
    )

    bad_line_ref = line_ref.model_copy(deep=True)
    bad_line_ref.sha256 = "f" * 64
    bad_line_ref.byte_size += 1
    bad_line_ref.count += 1
    bad_line_ref.coverage_start = "2020-01-01"
    bad_line_partition = line.partitions[0].model_copy(deep=True)
    bad_line_partition.entity_id = "wrong"
    bad_line_partition.month = "2020-01"
    cases.append(
        ("line-ref", gate.check_line_history_partition_ref(bad_line_ref, bad_line_partition))
    )

    line_summary = gate.LineHistoryStreamSummary()
    line_refs = [item for child_index in line.indexes for item in child_index.partitions]
    for child_ref, child in zip(line_refs, line.partitions, strict=True):
        line_summary.observe(child_ref, child)
    line_indexes = [child.model_dump(mode="json") for child in line.indexes]
    line_indexes[0]["partitions"] = list(reversed(line_indexes[0]["partitions"]))
    line_indexes[0]["metrics"] = []
    cases.append(
        (
            "line-stream-indexes",
            gate.check_line_history_stream_indexes(
                line_indexes,
                line_summary,
                fallback_generated_utc=STAMP,
            ),
        )
    )
    line_index = line.indexes[0].model_dump(mode="json")
    line_index["family"] = "stops"
    line_index["entity_id"] = "wrong"
    line_index["generated_utc"] = "bad"
    line_index["available_dates"] = []
    line_index["partitions"] = []
    line_index["metrics"] = []
    line_index["collection_generation_id"] = "wrong"
    cases.append(("line-index", gate.check_line_history_index(line_index, rel_key="bad")))

    line_directory_summary = gate.LineHistoryDirectorySummary.from_indexes(line.indexes)
    line_directory = line.directory.model_dump(mode="json")
    line_directory["family"] = "stops"
    line_directory["generated_utc"] = "bad"
    line_directory["entities"].append(deepcopy(line_directory["entities"][0]))
    line_directory["first_available_date"] = None
    line_directory["collection_generation_id"] = "wrong"
    cases.append(
        ("line-directory", gate.check_line_history_directory(line_directory, rel_key="bad"))
    )
    cases.append(
        (
            "line-stream-directory",
            gate.check_line_history_stream_directory(
                line_directory,
                line_directory_summary,
                fallback_generated_utc=STAMP,
            ),
        )
    )

    stop = _stop_bundle()
    stop_ref = stop.indexes[0].partitions[0]
    stop_partition = stop.partitions[0].model_dump(mode="json")
    stop_partition["entity_id"] = "wrong"
    stop_partition["month"] = "2020-01"
    stop_partition["methodology_version"] = "wrong"
    stop_partition["generated_utc"] = "bad"
    stop_partition["days"].append(deepcopy(stop_partition["days"][0]))
    stop_partition["days"][0]["cancellation"] = {"scheduled_trip_days": 1}
    stop_partition["days"][0]["delay"]["on_time_count"] = 1
    cases.append(
        ("stop-partition", gate.check_stop_history_partition(stop_partition, rel_key="bad"))
    )

    bad_stop_ref = stop_ref.model_copy(deep=True)
    bad_stop_ref.sha256 = "f" * 64
    bad_stop_ref.byte_size += 1
    bad_stop_ref.count += 1
    bad_stop_ref.coverage_start = "2020-01-01"
    bad_stop_partition = stop.partitions[0].model_copy(deep=True)
    bad_stop_partition.entity_id = "wrong"
    bad_stop_partition.month = "2020-01"
    cases.append(
        ("stop-ref", gate.check_stop_history_partition_ref(bad_stop_ref, bad_stop_partition))
    )

    stop_summary = gate.StopHistoryStreamSummary()
    stop_refs = [item for child_index in stop.indexes for item in child_index.partitions]
    for child_ref, child in zip(stop_refs, stop.partitions, strict=True):
        stop_summary.observe(child_ref, child)
    stop_index = stop.indexes[0].model_dump(mode="json")
    stop_index["partitions"] = list(reversed(stop_index["partitions"]))
    stop_index["metrics"] = []
    cases.append(
        (
            "stop-stream-index",
            gate.check_stop_history_stream_index(
                stop_index,
                stop_summary,
                fallback_generated_utc=STAMP,
            ),
        )
    )
    cases.append(
        (
            "stop-stream-indexes",
            gate.check_stop_history_stream_indexes(
                [stop_index, deepcopy(stop_index)],
                stop_summary,
                fallback_generated_utc=STAMP,
            ),
        )
    )
    stop_index_bad = stop.indexes[0].model_dump(mode="json")
    stop_index_bad["family"] = "lines"
    stop_index_bad["entity_id"] = "wrong"
    stop_index_bad["available_dates"] = []
    stop_index_bad["partitions"] = []
    stop_index_bad["metrics"] = []
    stop_index_bad["collection_generation_id"] = "wrong"
    cases.append(("stop-index", gate.check_stop_history_index(stop_index_bad, rel_key="bad")))

    stop_directory_summary = gate.StopHistoryDirectorySummary.from_indexes(stop.indexes)
    missing_entity_summary = gate.StopHistoryDirectorySummary.from_indexes(stop.indexes)
    missing_entity_summary.entities.clear()
    cases.append(
        (
            "stop-stream-entities",
            gate.check_stop_history_stream_entities(missing_entity_summary, stop_summary),
        )
    )
    stop_directory = stop.directory.model_dump(mode="json")
    stop_directory["family"] = "lines"
    stop_directory["entities"].append(deepcopy(stop_directory["entities"][0]))
    stop_directory["first_available_date"] = None
    stop_directory["collection_generation_id"] = "wrong"
    cases.append(
        ("stop-directory", gate.check_stop_history_directory(stop_directory, rel_key="bad"))
    )
    cases.append(
        (
            "stop-stream-directory",
            gate.check_stop_history_stream_directory(
                stop_directory,
                stop_directory_summary,
                fallback_generated_utc=STAMP,
            ),
        )
    )
    return cases


def test_public_history_gate_outputs_have_an_ordered_fingerprint() -> None:
    payload = [
        {"case": name, "findings": [finding.to_dict() for finding in findings]}
        for name, findings in _ordered_characterization()
    ]
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()

    assert hashlib.sha256(encoded).hexdigest() == (
        "0b321ff698c407fee716a0ff1eb40db0067e5f3d472c857785f483e83dd71301"
    )


def test_history_family_specs_own_exact_kinds_and_check_names() -> None:
    assert gate.HistoryFamilySpec
    specs = gate._HISTORY_FAMILY_SPECS  # noqa: SLF001
    assert tuple(specs) == ("network", "lines", "stops")
    assert {name: frozenset(spec.kinds.values()) for name, spec in specs.items()} == {
        "network": frozenset(
            {
                "historic_network_history_partition",
                "historic_network_history_stream",
                "historic_network_history_index",
                "historic_network_history_partition_ref",
                "historic_network_history_bundle",
            }
        ),
        "lines": frozenset(
            {
                "historic_line_history_partition",
                "historic_line_history_partition_ref",
                "historic_line_history_stream",
                "historic_line_history_index",
                "historic_line_history_directory",
            }
        ),
        "stops": frozenset(
            {
                "historic_stop_history_partition",
                "historic_stop_history_partition_ref",
                "historic_stop_history_stream",
                "historic_stop_history_index",
                "historic_stop_history_directory",
            }
        ),
    }
    assert all(spec.checks and all(spec.checks.values()) for spec in specs.values())
    assert tuple(gate.LineHistoryDirectorySummary().metric_dates) == tuple(
        name for name, _aggregation in specs["lines"].metrics
    )


def test_all_stream_summaries_use_masks_and_ordered_ref_digests() -> None:
    network = _network_bundle()
    line = _line_bundle()
    stop = _stop_bundle()
    summaries = (
        (gate.NetworkHistoryStreamSummary(), network.index.partitions, network.partitions),
        (
            gate.LineHistoryStreamSummary(),
            [ref for index in line.indexes for ref in index.partitions],
            line.partitions,
        ),
        (
            gate.StopHistoryStreamSummary(),
            [ref for index in stop.indexes for ref in index.partitions],
            stop.partitions,
        ),
    )
    for summary, refs, partitions in summaries:
        for ref, partition in zip(refs, partitions, strict=True):
            summary.observe(ref, partition)
        states = getattr(summary, "entities", {"network": summary}).values()
        for state in states:
            assert isinstance(state.partition_ref_digest, bytes)
            assert state.partition_count > 0
            assert isinstance(state.available_dates, gate.HistoryDateMask)
            assert all(
                isinstance(mask, gate.HistoryDateMask) for mask in state.metric_dates.values()
            )
