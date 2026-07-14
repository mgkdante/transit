from __future__ import annotations

import pytest
from pydantic import ValidationError

from transit_ops.snapshots.builders.historic.history_common import (
    decode_history_entity_id,
    encode_history_entity_id,
)
from transit_ops.snapshots.contract import (
    HistoricCancellationMetric,
    HistoricCollectionIndex,
    HistoricDelayMetric,
    HistoricDelayPercentiles,
    HistoricEntityDirectoryIndex,
    HistoricEntityIndexRef,
    HistoricFamilyAvailability,
    HistoricMetricCoverage,
    HistoricOccupancyMetric,
    HistoricPartitionRef,
    HistoricSkippedStopMetric,
    HistoryMetricAggregation,
    LineHistoryDay,
    LineHistoryPartition,
    NetworkHistoryDay,
    NetworkHistoryPartition,
    ReceiptsIndex,
    StopHistoryDay,
    StopHistoryPartition,
)

ISO = "2026-07-13T12:00:00Z"
SHA256 = "a" * 64


def _delay(**overrides: int | None) -> HistoricDelayMetric:
    values: dict[str, int | None] = {
        "observation_count": 10,
        "in_clamp_observation_count": 8,
        "on_time_count": 6,
        "severe_count": 2,
        "sum_delay_seconds": 240,
    }
    values.update(overrides)
    return HistoricDelayMetric(**values)


def _network_partition(**overrides: object) -> NetworkHistoryPartition:
    values: dict[str, object] = {
        "generated_utc": ISO,
        "month": "2026-06",
        "days": [NetworkHistoryDay(date="2026-06-01", delay=_delay())],
    }
    values.update(overrides)
    return NetworkHistoryPartition(**values)


@pytest.mark.parametrize(
    "entity_id",
    ["A", "747", "A/B", "%2F", "?x#y", "..", "with spaces", "Édouard", "東京", "خط"],
)
def test_partitioned_history_entity_id_round_trips_utf8_hex(entity_id: str):
    encoded = encode_history_entity_id(entity_id)

    assert encoded == entity_id.encode("utf-8").hex()
    assert encoded == encoded.lower()
    assert decode_history_entity_id(encoded) == entity_id


@pytest.mark.parametrize(
    "encoded_id",
    ["", "C3A9", "abc", "gg", "c3zz", "ff", "c328"],
)
def test_partitioned_history_entity_id_rejects_noncanonical_or_invalid_utf8(encoded_id: str):
    with pytest.raises(ValueError):
        decode_history_entity_id(encoded_id)


def test_partitioned_history_directory_pins_identity_and_generation():
    entity_id = "A/B"
    encoded_id = entity_id.encode("utf-8").hex()
    ref = HistoricEntityIndexRef(
        entity_id=entity_id,
        encoded_id=encoded_id,
        index_path=f"historic/history/lines/{encoded_id}/index.json",
        collection_generation_id="line-generation",
        first_available_date="2026-05-01",
        last_available_date="2026-06-30",
    )
    directory = HistoricEntityDirectoryIndex(
        generated_utc=ISO,
        family="lines",
        selection_mode="range",
        collection_generation_id="directory-generation",
        first_available_date="2026-05-01",
        last_available_date="2026-06-30",
        entities=[ref],
    )

    assert directory.entities[0].entity_id == entity_id
    assert directory.entities[0].encoded_id == encoded_id

    with pytest.raises(ValidationError):
        HistoricEntityIndexRef(
            entity_id=entity_id,
            encoded_id=encoded_id,
            index_path=ref.index_path,
        )
    with pytest.raises(ValidationError):
        HistoricEntityDirectoryIndex(
            generated_utc=ISO,
            family="network",
            selection_mode="range",
            collection_generation_id="directory-generation",
        )
    with pytest.raises(ValidationError):
        HistoricEntityDirectoryIndex(
            generated_utc=ISO,
            family="lines",
            selection_mode="date",
            collection_generation_id="directory-generation",
        )
    with pytest.raises(ValidationError):
        HistoricEntityDirectoryIndex(
            generated_utc=ISO,
            family="lines",
            selection_mode="range",
        )
    with pytest.raises(ValidationError):
        HistoricEntityIndexRef(
            entity_id=entity_id,
            encoded_id="4142",
            index_path=ref.index_path,
            collection_generation_id="line-generation",
        )


@pytest.mark.parametrize("family", ["lines", "stops"])
def test_partitioned_history_directory_accepts_exact_payload_versioned_entity_index_path(
    family: str,
):
    entity_id = "A/B"
    encoded_id = entity_id.encode("utf-8").hex()
    payload_sha = "b" * 64

    directory = HistoricEntityDirectoryIndex(
        generated_utc=ISO,
        family=family,
        selection_mode="range",
        collection_generation_id="directory-generation",
        entities=[
            HistoricEntityIndexRef(
                entity_id=entity_id,
                encoded_id=encoded_id,
                index_path=(
                    f"historic/history/{family}/{encoded_id}/generations/{payload_sha}/index.json"
                ),
                collection_generation_id="entity-generation",
            )
        ],
    )

    assert directory.entities[0].index_path.endswith(f"/{payload_sha}/index.json")


@pytest.mark.parametrize(
    "index_path",
    [
        "historic/history/lines/412f42/generations/not-a-sha/index.json",
        f"historic/history/lines/4142/generations/{'a' * 64}/index.json",
        f"historic/history/lines/412f42/generations/{'A' * 64}/index.json",
    ],
)
def test_partitioned_history_directory_rejects_malformed_versioned_entity_index_path(
    index_path: str,
):
    with pytest.raises(ValidationError):
        HistoricEntityDirectoryIndex(
            generated_utc=ISO,
            family="lines",
            selection_mode="range",
            collection_generation_id="directory-generation",
            entities=[
                HistoricEntityIndexRef(
                    entity_id="A/B",
                    encoded_id="412f42",
                    index_path=index_path,
                    collection_generation_id="entity-generation",
                )
            ],
        )


def test_partitioned_history_metric_vocabulary_and_additive_defaults():
    coverage = HistoricMetricCoverage(
        metric="delay",
        aggregation="additive",
        first_available_date="2026-05-01",
        last_available_date="2026-06-30",
    )
    collection = HistoricCollectionIndex(
        generated_utc=ISO,
        family="network",
        selection_mode="range",
        metrics=[coverage],
    )
    family = HistoricFamilyAvailability(
        family="network",
        selection_mode="range",
        index_path="historic/history/network/index.json",
        collection_generation_id="network-generation",
        metrics=[coverage],
    )

    assert coverage.aggregation is HistoryMetricAggregation.additive
    assert collection.metrics == [coverage]
    assert family.metrics == [coverage]
    assert (
        HistoricCollectionIndex(generated_utc=ISO, family="receipts", selection_mode="date").metrics
        == []
    )
    assert ReceiptsIndex(generated_utc=ISO).collection_generation_id is None

    with pytest.raises(ValidationError):
        HistoricMetricCoverage(metric="made_up", aggregation="additive")


@pytest.mark.parametrize(
    "overrides",
    [
        {"observation_count": 0},
        {"on_time_count": 11},
        {"severe_count": 11},
        {"in_clamp_observation_count": 11},
        {"in_clamp_observation_count": 8, "on_time_count": 9},
        {"in_clamp_observation_count": 8, "severe_count": 9},
        {"in_clamp_observation_count": 8, "on_time_count": 7, "severe_count": 2},
        {"in_clamp_observation_count": None, "on_time_count": 1, "severe_count": 0},
        {"in_clamp_observation_count": None, "on_time_count": 0, "severe_count": 1},
        {"in_clamp_observation_count": 2, "sum_delay_seconds": 7_201},
        {"in_clamp_observation_count": None, "sum_delay_seconds": 1},
    ],
)
def test_partitioned_history_delay_rejects_impossible_counts(overrides: dict[str, int | None]):
    with pytest.raises(ValidationError):
        _delay(**overrides)


def test_partitioned_history_delay_keeps_all_ghost_zero_counts_honest():
    metric = HistoricDelayMetric(
        observation_count=3,
        on_time_count=0,
        severe_count=0,
    )
    assert metric.in_clamp_observation_count is None


def test_partitioned_history_percentiles_require_a_value_and_positive_sample():
    metric = HistoricDelayPercentiles(observation_count=3, p90_delay_seconds=42)
    assert metric.p50_delay_seconds is None

    with pytest.raises(ValidationError):
        HistoricDelayPercentiles(observation_count=3)
    with pytest.raises(ValidationError):
        HistoricDelayPercentiles(observation_count=0, p50_delay_seconds=1)
    with pytest.raises(ValidationError):
        HistoricDelayPercentiles(observation_count=3, p50_delay_seconds=-3_601)
    with pytest.raises(ValidationError):
        HistoricDelayPercentiles(observation_count=3, p90_delay_seconds=3_601)
    with pytest.raises(ValidationError):
        HistoricDelayPercentiles(
            observation_count=3,
            p50_delay_seconds=10,
            p90_delay_seconds=9,
        )


def test_partitioned_history_cancellation_preserves_real_scheduled_only_days():
    scheduled_only = HistoricCancellationMetric(
        canceled_trip_days=0,
        total_trip_days=0,
        scheduled_trip_days=12,
        delivered_trip_days=0,
        silent_trip_days=12,
    )
    assert scheduled_only.scheduled_trip_days == 12

    with pytest.raises(ValidationError):
        HistoricCancellationMetric(canceled_trip_days=2, total_trip_days=1)
    with pytest.raises(ValidationError):
        HistoricCancellationMetric(canceled_trip_days=0, total_trip_days=0)
    with pytest.raises(ValidationError):
        HistoricCancellationMetric(
            canceled_trip_days=0,
            total_trip_days=0,
            scheduled_trip_days=0,
        )


@pytest.mark.parametrize(
    "counts",
    [
        {
            "canceled_trip_days": 1,
            "total_trip_days": 2,
            "delivered_trip_days": 1,
        },
        {
            "canceled_trip_days": 1,
            "total_trip_days": 2,
            "silent_trip_days": 1,
        },
        {
            "canceled_trip_days": 0,
            "total_trip_days": 3,
            "scheduled_trip_days": 4,
            "delivered_trip_days": 4,
            "silent_trip_days": 0,
        },
        {
            "canceled_trip_days": 1,
            "total_trip_days": 3,
            "scheduled_trip_days": 4,
            "delivered_trip_days": 3,
            "silent_trip_days": 1,
        },
        {
            "canceled_trip_days": 1,
            "total_trip_days": 2,
            "scheduled_trip_days": 4,
            "delivered_trip_days": 1,
            "silent_trip_days": 5,
        },
    ],
)
def test_partitioned_history_cancellation_rejects_impossible_scheduled_relationships(
    counts: dict[str, int],
):
    with pytest.raises(ValidationError):
        HistoricCancellationMetric(**counts)


def test_partitioned_history_occupancy_and_skips_reject_impossible_telemetry():
    assert (
        HistoricOccupancyMetric(empty=0, many_seats=1, few_seats=0, standing=0, full=0).many_seats
        == 1
    )
    skips = HistoricSkippedStopMetric(skipped_stop_count=1, stop_time_update_count=2)
    assert skips.skipped_stop_count == 1

    with pytest.raises(ValidationError):
        HistoricOccupancyMetric(empty=0, many_seats=0, few_seats=0, standing=0, full=0)
    with pytest.raises(ValidationError):
        HistoricSkippedStopMetric(skipped_stop_count=3, stop_time_update_count=2)


@pytest.mark.parametrize("day_model", [NetworkHistoryDay, LineHistoryDay, StopHistoryDay])
def test_partitioned_history_day_rejects_every_metric_absent(day_model: type):
    with pytest.raises(ValidationError):
        day_model(date="2026-06-01")


def test_partitioned_history_network_day_rejects_zero_vehicles():
    with pytest.raises(ValidationError):
        NetworkHistoryDay(date="2026-06-01", vehicles=0)


def test_partitioned_history_network_day_bounds_vehicles_by_raw_observations():
    percentiles = HistoricDelayPercentiles(observation_count=2, p90_delay_seconds=30)
    assert (
        NetworkHistoryDay(
            date="2026-06-01",
            delay_percentiles=percentiles,
            vehicles=2,
        ).vehicles
        == 2
    )
    with pytest.raises(ValidationError):
        NetworkHistoryDay(
            date="2026-06-01",
            delay_percentiles=percentiles,
            vehicles=3,
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {"month": "2026-6"},
        {"month": "2026-13"},
        {"days": []},
        {
            "days": [
                NetworkHistoryDay(date="2026-06-02", delay=_delay()),
                NetworkHistoryDay(date="2026-06-01", delay=_delay()),
            ]
        },
        {
            "days": [
                NetworkHistoryDay(date="2026-06-01", delay=_delay()),
                NetworkHistoryDay(date="2026-06-01", vehicles=1),
            ]
        },
        {"days": [NetworkHistoryDay(date="2026-05-31", delay=_delay())]},
    ],
)
def test_partitioned_history_partition_rejects_invalid_month_or_dates(overrides: dict[str, object]):
    with pytest.raises(ValidationError):
        _network_partition(**overrides)


def test_partitioned_history_line_and_stop_partitions_round_trip_entity_identity():
    line = LineHistoryPartition(
        generated_utc=ISO,
        month="2026-06",
        entity_id="A/B",
        days=[LineHistoryDay(date="2026-06-01", delay=_delay())],
    )
    stop = StopHistoryPartition(
        generated_utc=ISO,
        month="2026-06",
        entity_id="Édouard",
        days=[StopHistoryDay(date="2026-06-01", delay=_delay())],
    )

    assert line.entity_id == "A/B"
    assert stop.entity_id == "Édouard"


def test_partitioned_history_partition_refs_validate_digest_and_positive_bytes():
    ref = HistoricPartitionRef(
        path=f"historic/history/network/generations/{SHA256}/2026-06.json",
        coverage_start="2026-06-01",
        coverage_end="2026-06-30",
        count=1,
        sha256=SHA256,
        byte_size=512,
    )
    assert ref.byte_size == 512

    for invalid_sha in ("abc", "A" * 64, "g" * 64):
        with pytest.raises(ValidationError):
            HistoricPartitionRef(
                path="historic/example.json",
                coverage_start="2026-06-01",
                coverage_end="2026-06-30",
                sha256=invalid_sha,
            )
    with pytest.raises(ValidationError):
        HistoricPartitionRef(
            path="historic/example.json",
            coverage_start="2026-06-01",
            coverage_end="2026-06-30",
            byte_size=0,
        )


def test_partitioned_history_existing_minimal_indexes_remain_valid():
    collection = HistoricCollectionIndex(
        generated_utc=ISO,
        family="receipts",
        selection_mode="date",
    )
    receipt_index = ReceiptsIndex(generated_utc=ISO, dates=["2026-06-01"])

    assert collection.partitions == []
    assert collection.metrics == []
    assert receipt_index.collection_generation_id is None
