from __future__ import annotations

import hashlib
import inspect
from datetime import UTC, date, datetime
from importlib import import_module

import pytest
from _sqlfakes import NamedQueryConn

from transit_ops.snapshots.builders.historic.history_common import (
    history_entity_directory_generation_id,
    history_index_generation_id,
)
from transit_ops.snapshots.builders.historic.network_history import (
    _NETWORK_HISTORY_CANCELLATION_SQL,
    _NETWORK_HISTORY_DELAY_SQL,
    _NETWORK_HISTORY_FACT_SQL,
    _NETWORK_HISTORY_OCCUPANCY_SQL,
    build_network_history,
    build_network_history_from_rows,
    build_network_history_plan_from_rows,
)
from transit_ops.snapshots.contract import (
    LineHistoryDay,
    LineHistoryPartition,
    NetworkHistoryDay,
    StopHistoryDay,
    StopHistoryPartition,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256
from transit_ops.sql_registry import query_name


def _ts(day: int, hour: int) -> datetime:
    return datetime(2026, 7, day, hour, tzinfo=UTC)


def _network_history_rows():
    delay = [
        {
            "local_date": date(2026, 6, 30),
            "observation_count": 4,
            "in_clamp_observation_count": 3,
            "on_time_count": 3,
            "severe_count": 0,
            "sum_delay_seconds": 90,
            "source_generated_utc": _ts(1, 10),
        },
        {
            "local_date": date(2026, 7, 2),
            "observation_count": 5,
            "in_clamp_observation_count": 4,
            "on_time_count": 0,
            "severe_count": 0,
            "sum_delay_seconds": -40,
            "source_generated_utc": _ts(3, 8),
        },
        {
            "local_date": date(2026, 6, 30),
            "observation_count": 6,
            "in_clamp_observation_count": 5,
            "on_time_count": 3,
            "severe_count": 2,
            "sum_delay_seconds": 150,
            "source_generated_utc": _ts(1, 11),
        },
    ]
    facts = [
        {
            "local_date": date(2026, 6, 30),
            "observation_count": 3,
            "p90_delay_seconds": 600.0,
            "vehicles": 2,
            "source_generated_utc": _ts(1, 12),
        }
    ]
    cancellations = [
        {
            "local_date": date(2026, 7, 2),
            "canceled_trip_days": 0,
            "total_trip_days": 5,
            "scheduled_trip_days": None,
            "delivered_trip_days": None,
            "silent_trip_days": None,
            "source_generated_utc": _ts(3, 9),
        },
        {
            "local_date": date(2026, 6, 30),
            "canceled_trip_days": 0,
            "total_trip_days": 0,
            "scheduled_trip_days": 12,
            "delivered_trip_days": 0,
            "silent_trip_days": 12,
            "source_generated_utc": _ts(1, 9),
        },
    ]
    occupancy = [
        {
            "local_date": date(2026, 6, 30),
            "observation_count": 0,
            "empty": 0,
            "many_seats": 0,
            "few_seats": 0,
            "standing": 0,
            "full": 0,
            "source_generated_utc": _ts(1, 8),
        },
        {
            "local_date": date(2026, 7, 2),
            "observation_count": 2,
            "empty": 0,
            "many_seats": 0,
            "few_seats": 2,
            "standing": 0,
            "full": 0,
            "source_generated_utc": _ts(4, 10),
        },
        {
            "local_date": date(2026, 7, 4),
            "observation_count": 1,
            "empty": 0,
            "many_seats": 0,
            "few_seats": 0,
            "standing": 1,
            "full": 0,
            "source_generated_utc": _ts(5, 10),
        },
    ]
    return delay, facts, cancellations, occupancy


def _build_network_history_fixture(*, reverse: bool = False):
    rows = _network_history_rows()
    if reverse:
        rows = tuple(list(reversed(source)) for source in rows)
    return build_network_history_from_rows(
        delay_rows=rows[0],
        fact_rows=rows[1],
        cancellation_rows=rows[2],
        occupancy_rows=rows[3],
        generated_utc="2026-07-13T00:00:00Z",
    )


def test_network_history_plan_retains_compact_inputs_not_all_month_day_payloads():
    delay, facts, cancellations, occupancy = _network_history_rows()
    plan = build_network_history_plan_from_rows(
        delay_rows=delay,
        fact_rows=facts,
        cancellation_rows=cancellations,
        occupancy_rows=occupancy,
        generated_utc="2026-07-13T00:00:00Z",
    )

    def retained_history_days(value):  # noqa: ANN001, ANN202
        if isinstance(value, NetworkHistoryDay):
            return [value]
        if isinstance(value, dict):
            return [day for child in value.values() for day in retained_history_days(child)]
        if isinstance(value, list | tuple | set):
            return [day for child in value for day in retained_history_days(child)]
        return []

    assert retained_history_days(vars(plan)) == []
    iterator = plan.iter_partition_items()
    first_ref, first_partition = next(iterator)
    assert first_partition.month == "2026-06"
    assert first_ref.path.endswith("/2026-06.json")
    assert retained_history_days(vars(plan)) == []


def test_network_history_builder_splits_months_and_preserves_exact_daily_math():
    bundle = _build_network_history_fixture()

    assert [partition.month for partition in bundle.partitions] == ["2026-06", "2026-07"]
    june, july = bundle.partitions
    june_day = june.days[0]
    assert june_day.date == "2026-06-30"
    assert june_day.delay is not None
    assert june_day.delay.model_dump() == {
        "observation_count": 10,
        "in_clamp_observation_count": 8,
        "on_time_count": 6,
        "severe_count": 2,
        "sum_delay_seconds": 240,
    }
    assert june_day.delay.sum_delay_seconds / june_day.delay.in_clamp_observation_count == 30
    assert june_day.delay_percentiles is not None
    assert june_day.delay_percentiles.model_dump() == {
        "observation_count": 3,
        "p50_delay_seconds": None,
        "p90_delay_seconds": 600.0,
    }
    assert june_day.vehicles == 2
    assert june_day.cancellation is not None
    assert june_day.cancellation.total_trip_days == 0
    assert june_day.cancellation.scheduled_trip_days == 12
    assert june_day.occupancy is None

    assert [day.date for day in july.days] == ["2026-07-02", "2026-07-04"]
    july_day = july.days[0]
    assert july_day.date == "2026-07-02"
    assert july_day.delay is not None
    assert july_day.delay.on_time_count == 0
    assert july_day.delay.severe_count == 0
    assert july_day.cancellation is not None
    assert july_day.cancellation.canceled_trip_days == 0
    assert july_day.occupancy is not None
    assert july_day.occupancy.few_seats == 2
    assert july_day.delay_percentiles is None
    assert july_day.vehicles is None
    assert june.generated_utc == "2026-07-01T12:00:00Z"
    assert july.generated_utc == "2026-07-05T10:00:00Z"
    assert all(partition.methodology_version == "history-1" for partition in bundle.partitions)
    assert all(partition.publish_generation_id is None for partition in bundle.partitions)


def test_network_history_builder_stable_bytes_refs_coverage_and_gaps():
    first = _build_network_history_fixture()
    second = _build_network_history_fixture(reverse=True)

    assert [snapshot_json_bytes(partition) for partition in first.partitions] == [
        snapshot_json_bytes(partition) for partition in second.partitions
    ]
    assert first.index == second.index
    assert first.index.available_dates == ["2026-06-30", "2026-07-02", "2026-07-04"]
    assert [(gap.start_date, gap.end_date) for gap in first.index.gaps] == [
        ("2026-07-01", "2026-07-01"),
        ("2026-07-03", "2026-07-03"),
    ]
    assert first.index.first_available_date == "2026-06-30"
    assert first.index.last_available_date == "2026-07-04"

    for ref, partition in zip(first.index.partitions, first.partitions, strict=True):
        expected_path = (
            f"historic/history/network/generations/{snapshot_sha256(partition)}/"
            f"{partition.month}.json"
        )
        assert ref.path == expected_path
        assert ref.sha256 == snapshot_sha256(partition)
        assert ref.byte_size == len(snapshot_json_bytes(partition))
        assert ref.count == len(partition.days)
        assert (ref.coverage_start, ref.coverage_end) == (
            partition.days[0].date,
            partition.days[-1].date,
        )

    metrics = [(metric.metric.value, metric.aggregation.value) for metric in first.index.metrics]
    assert metrics == [
        ("delay", "additive"),
        ("delay_percentiles", "daily_only"),
        ("vehicles", "daily_only"),
        ("cancellation", "additive"),
        ("occupancy", "additive"),
    ]
    percentile = first.index.metrics[1]
    assert (percentile.first_available_date, percentile.last_available_date) == (
        "2026-06-30",
        "2026-06-30",
    )
    occupancy = first.index.metrics[-1]
    assert (occupancy.first_available_date, occupancy.last_available_date) == (
        "2026-07-02",
        "2026-07-04",
    )
    assert [(gap.start_date, gap.end_date) for gap in occupancy.gaps] == [
        ("2026-07-03", "2026-07-03")
    ]
    delay = first.index.metrics[0]
    assert [(gap.start_date, gap.end_date) for gap in delay.gaps] == [("2026-07-01", "2026-07-01")]

    changed_rows = _network_history_rows()
    changed_rows[0][0]["sum_delay_seconds"] = 91
    changed = build_network_history_from_rows(
        delay_rows=changed_rows[0],
        fact_rows=changed_rows[1],
        cancellation_rows=changed_rows[2],
        occupancy_rows=changed_rows[3],
        generated_utc="2026-07-13T00:00:00Z",
    )
    assert changed.index.collection_generation_id != first.index.collection_generation_id


def test_network_history_builder_omits_denominator_free_and_empty_source_rows():
    bundle = build_network_history_from_rows(
        delay_rows=[
            {
                "local_date": date(2026, 6, 1),
                "observation_count": 0,
                "in_clamp_observation_count": 0,
                "on_time_count": 0,
                "severe_count": 0,
                "sum_delay_seconds": 0,
                "source_generated_utc": _ts(1, 1),
            }
        ],
        fact_rows=[],
        cancellation_rows=[
            {
                "local_date": date(2026, 6, 1),
                "canceled_trip_days": 0,
                "total_trip_days": 0,
                "scheduled_trip_days": None,
                "delivered_trip_days": None,
                "silent_trip_days": None,
                "source_generated_utc": _ts(1, 1),
            }
        ],
        occupancy_rows=[
            {
                "local_date": date(2026, 6, 1),
                "observation_count": 0,
                "empty": 0,
                "many_seats": 0,
                "few_seats": 0,
                "standing": 0,
                "full": 0,
                "source_generated_utc": _ts(1, 1),
            }
        ],
        generated_utc="2026-07-13T00:00:00Z",
    )

    assert bundle.partitions == []
    assert bundle.partition_items == []
    assert bundle.index.available_dates == []
    assert bundle.index.partitions == []
    assert bundle.index.collection_generation_id is not None
    assert all(metric.first_available_date is None for metric in bundle.index.metrics)


def test_network_history_builder_retains_all_ghost_delay_without_fabricating_average():
    bundle = build_network_history_from_rows(
        delay_rows=[
            {
                "local_date": date(2026, 6, 1),
                "observation_count": 4,
                "in_clamp_observation_count": 0,
                "on_time_count": 0,
                "severe_count": 0,
                "sum_delay_seconds": 0,
                "source_generated_utc": "2026-07-01T08:00:00-04:00",
            }
        ],
        fact_rows=[],
        cancellation_rows=[],
        occupancy_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
    )

    delay = bundle.partitions[0].days[0].delay
    assert delay is not None
    assert delay.observation_count == 4
    assert delay.on_time_count == 0
    assert delay.in_clamp_observation_count is None
    assert delay.sum_delay_seconds is None
    assert bundle.partitions[0].generated_utc == "2026-07-01T12:00:00Z"


def test_network_history_builder_ignores_later_empty_rows_for_partition_provenance():
    local_date = date(2026, 6, 1)
    bundle = build_network_history_from_rows(
        delay_rows=[
            {
                "local_date": local_date,
                "observation_count": 2,
                "in_clamp_observation_count": 2,
                "on_time_count": 1,
                "severe_count": 0,
                "sum_delay_seconds": 30,
                "source_generated_utc": _ts(1, 1),
            },
            {
                "local_date": local_date,
                "observation_count": 0,
                "in_clamp_observation_count": 0,
                "on_time_count": 0,
                "severe_count": 0,
                "sum_delay_seconds": 0,
                "source_generated_utc": _ts(10, 1),
            },
        ],
        fact_rows=[],
        cancellation_rows=[
            {
                "local_date": local_date,
                "canceled_trip_days": 0,
                "total_trip_days": 3,
                "scheduled_trip_days": None,
                "delivered_trip_days": None,
                "silent_trip_days": None,
                "source_generated_utc": _ts(1, 2),
            },
            {
                "local_date": local_date,
                "canceled_trip_days": 0,
                "total_trip_days": 0,
                "scheduled_trip_days": None,
                "delivered_trip_days": None,
                "silent_trip_days": None,
                "source_generated_utc": _ts(11, 2),
            },
        ],
        occupancy_rows=[
            {
                "local_date": local_date,
                "observation_count": 1,
                "empty": 1,
                "many_seats": 0,
                "few_seats": 0,
                "standing": 0,
                "full": 0,
                "source_generated_utc": _ts(1, 3),
            },
            {
                "local_date": local_date,
                "observation_count": 0,
                "empty": 0,
                "many_seats": 0,
                "few_seats": 0,
                "standing": 0,
                "full": 0,
                "source_generated_utc": _ts(12, 3),
            },
        ],
        generated_utc="2026-07-13T00:00:00Z",
    )

    assert bundle.partitions[0].generated_utc == "2026-07-01T03:00:00Z"


def test_network_history_builder_rejects_duplicate_noncomposable_fact_day_and_bad_occupancy():
    fact = {
        "local_date": date(2026, 6, 1),
        "observation_count": 2,
        "p90_delay_seconds": 30,
        "vehicles": 1,
        "source_generated_utc": _ts(1, 1),
    }
    with pytest.raises(ValueError, match="duplicate raw fact day"):
        build_network_history_from_rows(
            delay_rows=[],
            fact_rows=[fact, dict(fact)],
            cancellation_rows=[],
            occupancy_rows=[],
            generated_utc="2026-07-13T00:00:00Z",
        )


@pytest.mark.parametrize(
    "observation_count,p90_delay_seconds,vehicles",
    [
        (0, None, 1),
        (1, None, 2),
        (1, 30, 2),
    ],
)
def test_network_history_builder_rejects_vehicle_counts_above_raw_observations(
    observation_count: int,
    p90_delay_seconds: int | None,
    vehicles: int,
):
    with pytest.raises(ValueError, match="vehicles cannot exceed observation_count"):
        build_network_history_from_rows(
            delay_rows=[],
            fact_rows=[
                {
                    "local_date": date(2026, 6, 1),
                    "observation_count": observation_count,
                    "p90_delay_seconds": p90_delay_seconds,
                    "vehicles": vehicles,
                    "source_generated_utc": _ts(1, 1),
                }
            ],
            cancellation_rows=[],
            occupancy_rows=[],
            generated_utc="2026-07-13T00:00:00Z",
        )


def test_network_history_cancellation_keeps_scheduled_numerators_in_known_universe():
    shared = {
        "local_date": date(2026, 6, 1),
        "canceled_trip_days": 0,
        "source_generated_utc": _ts(1, 1),
    }
    bundle = build_network_history_from_rows(
        delay_rows=[],
        fact_rows=[],
        cancellation_rows=[
            {
                **shared,
                "total_trip_days": 10,
                "scheduled_trip_days": 12,
                "delivered_trip_days": 8,
                "silent_trip_days": 4,
            },
            {
                **shared,
                "total_trip_days": 5,
                "scheduled_trip_days": None,
                "delivered_trip_days": 99,
                "silent_trip_days": 99,
            },
        ],
        occupancy_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
    )

    metric = bundle.partitions[0].days[0].cancellation
    assert metric is not None
    assert metric.total_trip_days == 15
    assert metric.scheduled_trip_days == 12
    assert metric.delivered_trip_days == 8
    assert metric.silent_trip_days == 4
    cancellation_sql = str(_NETWORK_HISTORY_CANCELLATION_SQL)
    assert (
        "SUM(rcd.delivered_trip_days) FILTER (WHERE rcd.scheduled_trip_days IS NOT NULL)"
        in cancellation_sql
    )
    assert (
        "SUM(rcd.silent_trip_days) FILTER (WHERE rcd.scheduled_trip_days IS NOT NULL)"
        in cancellation_sql
    )

    with pytest.raises(ValueError, match="occupancy observation_count"):
        build_network_history_from_rows(
            delay_rows=[],
            fact_rows=[],
            cancellation_rows=[],
            occupancy_rows=[
                {
                    "local_date": date(2026, 6, 1),
                    "observation_count": 2,
                    "empty": 1,
                    "many_seats": 0,
                    "few_seats": 0,
                    "standing": 0,
                    "full": 0,
                    "source_generated_utc": _ts(1, 1),
                }
            ],
            generated_utc="2026-07-13T00:00:00Z",
        )


def test_network_history_builder_executes_each_full_retention_source_once():
    class RecordingConn(NamedQueryConn):
        def __init__(self):
            super().__init__(
                {
                    "history.network.delay": [],
                    "history.network.fact": [],
                    "history.network.cancellation": [],
                    "history.network.occupancy": [],
                }
            )
            self.names: list[str | None] = []
            self.params: list[dict] = []

        def execute(self, statement, params=None):  # noqa: ANN001
            self.names.append(query_name(statement))
            self.params.append(dict(params or {}))
            return super().execute(statement, params)

    conn = RecordingConn()
    bundle = build_network_history(
        conn,
        provider_id="stm",
        generated_utc="2026-07-13T00:00:00Z",
    )

    assert bundle.partitions == []
    assert conn.names == [
        "history.network.delay",
        "history.network.fact",
        "history.network.cancellation",
        "history.network.occupancy",
    ]
    assert set(conn.params[0]) == {"provider_id", "warm_retention_days"}
    assert set(conn.params[1]) == {"provider_id", "fact_retention_days"}
    assert set(conn.params[2]) == {"provider_id", "warm_retention_days"}
    assert set(conn.params[3]) == {"provider_id", "warm_retention_days"}
    assert all(params["provider_id"] == "stm" for params in conn.params)
    assert "gold.route_delay_spine" in str(_NETWORK_HISTORY_DELAY_SQL)
    assert "gold.fact_trip_delay_snapshot" in str(_NETWORK_HISTORY_FACT_SQL)
    assert "gold.route_cancellation_daily" in str(_NETWORK_HISTORY_CANCELLATION_SQL)
    assert "gold.route_occupancy_band_daily" in str(_NETWORK_HISTORY_OCCUPANCY_SQL)
    assert "MAX(sp.built_at_utc) FILTER (WHERE sp.delay_observation_count > 0)" in str(
        _NETWORK_HISTORY_DELAY_SQL
    )
    assert "MAX(fts.captured_at_utc)" in str(_NETWORK_HISTORY_FACT_SQL)
    cancellation_sql = " ".join(str(_NETWORK_HISTORY_CANCELLATION_SQL).split())
    assert (
        "MAX(rcd.built_at_utc) FILTER ( "
        "WHERE rcd.total_trip_days > 0 OR rcd.scheduled_trip_days > 0 )" in cancellation_sql
    )
    assert "MAX(rob.built_at_utc) FILTER (WHERE rob.observation_count > 0)" in str(
        _NETWORK_HISTORY_OCCUPANCY_SQL
    )
    assert ":warm_retention_days" in str(_NETWORK_HISTORY_DELAY_SQL)
    assert ":fact_retention_days" in str(_NETWORK_HISTORY_FACT_SQL)
    assert "- 90" not in str(_NETWORK_HISTORY_DELAY_SQL)
    assert "- 371" not in str(_NETWORK_HISTORY_DELAY_SQL)
    assert "provider_local_date <" in str(_NETWORK_HISTORY_DELAY_SQL)
    assert "timezone(dp.timezone, fts.captured_at_utc)::date <" in str(_NETWORK_HISTORY_FACT_SQL)
    assert "timezone(dp.timezone, fts.captured_at_utc)::date >" in str(_NETWORK_HISTORY_FACT_SQL)
    assert "now() - make_interval(days => :fact_retention_days)" in str(_NETWORK_HISTORY_FACT_SQL)
    assert "SUM(rob.observation_count)" in str(_NETWORK_HISTORY_OCCUPANCY_SQL)


def _line_history_module():
    return import_module("transit_ops.snapshots.builders.historic.line_history")


def _line_history_rows():
    delay = [
        {
            "route_id": "1",
            "local_date": date(2026, 6, 30),
            "observation_count": 4,
            "in_clamp_observation_count": 3,
            "on_time_count": 2,
            "severe_count": 1,
            "sum_delay_seconds": 90,
            "source_generated_utc": _ts(1, 10),
        },
        {
            "route_id": "10",
            "local_date": date(2026, 6, 30),
            "observation_count": 2,
            "in_clamp_observation_count": 2,
            "on_time_count": 2,
            "severe_count": 0,
            "sum_delay_seconds": -30,
            "source_generated_utc": _ts(1, 9),
        },
        {
            "route_id": "1",
            "local_date": date(2026, 7, 2),
            "observation_count": 5,
            "in_clamp_observation_count": 4,
            "on_time_count": 1,
            "severe_count": 2,
            "sum_delay_seconds": 120,
            "source_generated_utc": _ts(3, 8),
        },
        {
            "route_id": "A/B",
            "local_date": date(2026, 7, 3),
            "observation_count": 3,
            "in_clamp_observation_count": 3,
            "on_time_count": 0,
            "severe_count": 1,
            "sum_delay_seconds": 60,
            "source_generated_utc": _ts(4, 8),
        },
    ]
    percentiles = [
        {
            "route_id": "1",
            "local_date": date(2026, 6, 30),
            "observation_count": 4,
            "p50_delay_seconds": 20,
            "p90_delay_seconds": 240,
            "source_generated_utc": _ts(1, 11),
        },
        {
            "route_id": "A/B",
            "local_date": date(2026, 7, 3),
            "observation_count": 3,
            "p50_delay_seconds": None,
            "p90_delay_seconds": 180,
            "source_generated_utc": _ts(4, 9),
        },
    ]
    cancellations = [
        {
            "route_id": "1",
            "local_date": date(2026, 7, 2),
            "canceled_trip_days": 1,
            "total_trip_days": 8,
            "scheduled_trip_days": 9,
            "delivered_trip_days": 7,
            "silent_trip_days": 2,
            "source_generated_utc": _ts(3, 9),
        }
    ]
    occupancy = [
        {
            "route_id": "10",
            "local_date": date(2026, 7, 4),
            "observation_count": 3,
            "empty": 0,
            "many_seats": 1,
            "few_seats": 1,
            "standing": 1,
            "full": 0,
            "source_generated_utc": _ts(5, 9),
        }
    ]
    service_spans = [
        {
            "route_id": "A/B",
            "local_date": date(2026, 7, 3),
            "trip_count": 6,
            "first_trip_start_utc": "2026-07-03T05:00:00-04:00",
            "last_trip_start_utc": "2026-07-03T23:00:00-04:00",
            "first_trip_delay_seconds": 30,
            "last_trip_delay_seconds": -10,
            "source_generated_utc": _ts(4, 10),
        }
    ]
    skipped_stops = [
        {
            "route_id": "1",
            "local_date": date(2026, 7, 2),
            "skipped_stop_count": 2,
            "stop_time_update_count": 40,
            "source_generated_utc": _ts(3, 10),
        }
    ]
    return delay, percentiles, cancellations, occupancy, service_spans, skipped_stops


def _build_line_history_fixture(*, reverse: bool = False):
    module = _line_history_module()
    rows = _line_history_rows()
    if reverse:
        rows = tuple(list(reversed(source)) for source in rows)
    return module.build_line_history_from_rows(
        delay_rows=rows[0],
        percentile_rows=rows[1],
        cancellation_rows=rows[2],
        occupancy_rows=rows[3],
        service_span_rows=rows[4],
        skipped_stop_rows=rows[5],
        generated_utc="2026-07-13T00:00:00Z",
    )


def test_line_history_builder_isolates_prefix_ids_and_splits_entity_months():
    bundle = _build_line_history_fixture()

    assert [(item.entity_id, item.month) for item in bundle.partitions] == [
        ("1", "2026-06"),
        ("1", "2026-07"),
        ("10", "2026-06"),
        ("10", "2026-07"),
        ("A/B", "2026-07"),
    ]
    june_one, july_one, june_ten, july_ten, awkward = bundle.partitions
    assert june_one.days[0].delay.model_dump() == {
        "observation_count": 4,
        "in_clamp_observation_count": 3,
        "on_time_count": 2,
        "severe_count": 1,
        "sum_delay_seconds": 90,
    }
    assert june_one.days[0].delay_percentiles.model_dump() == {
        "observation_count": 4,
        "p50_delay_seconds": 20.0,
        "p90_delay_seconds": 240.0,
    }
    assert july_one.days[0].cancellation.delivered_trip_days == 7
    assert july_one.days[0].skipped_stops.skipped_stop_count == 2
    assert june_ten.days[0].delay.sum_delay_seconds == -30
    assert july_ten.days[0].occupancy.standing == 1
    assert awkward.days[0].service_span.trip_count == 6
    assert awkward.days[0].service_span.first_trip_utc == "2026-07-03T09:00:00Z"
    assert awkward.days[0].service_span.last_trip_utc == "2026-07-04T03:00:00Z"
    assert awkward.days[0].delay_percentiles.p90_delay_seconds == 180
    assert not hasattr(awkward.days[0], "headway")
    assert not hasattr(awkward.days[0], "habits")


def test_line_history_builder_has_stable_bytes_safe_identity_and_sparse_metric_coverage():
    first = _build_line_history_fixture()
    second = _build_line_history_fixture(reverse=True)

    assert [snapshot_json_bytes(item) for item in first.partitions] == [
        snapshot_json_bytes(item) for item in second.partitions
    ]
    assert first.indexes == second.indexes
    assert first.directory == second.directory
    assert [entry.entity_id for entry in first.directory.entities] == ["1", "10", "A/B"]
    assert [entry.encoded_id for entry in first.directory.entities] == [
        b"1".hex(),
        b"10".hex(),
        b"A/B".hex(),
    ]
    for entry in first.directory.entities:
        assert entry.index_path == f"historic/history/lines/{entry.encoded_id}/index.json"
    one = next(index for index in first.indexes if index.entity_id == "1")
    metrics = {metric.metric.value: metric for metric in one.metrics}
    assert metrics["delay"].first_available_date == "2026-06-30"
    assert metrics["delay"].last_available_date == "2026-07-02"
    assert metrics["delay_percentiles"].last_available_date == "2026-06-30"
    assert metrics["occupancy"].first_available_date is None
    assert metrics["service_span"].first_available_date is None
    assert metrics["skipped_stops"].first_available_date == "2026-07-02"
    assert len({index.collection_generation_id for index in first.indexes}) == 3

    changed = first.directory.model_copy(deep=True)
    changed.entities = changed.entities[:-1]
    assert (
        history_entity_directory_generation_id(changed) != first.directory.collection_generation_id
    )


def test_line_history_source_backed_bytes_ignore_publish_run_stamp():
    first = _build_line_history_fixture()
    rows = _line_history_rows()
    second = _line_history_module().build_line_history_from_rows(
        delay_rows=rows[0],
        percentile_rows=rows[1],
        cancellation_rows=rows[2],
        occupancy_rows=rows[3],
        service_span_rows=rows[4],
        skipped_stop_rows=rows[5],
        generated_utc="2030-01-01T00:00:00Z",
    )

    assert [snapshot_json_bytes(item) for item in first.partitions] == [
        snapshot_json_bytes(item) for item in second.partitions
    ]
    assert [index.collection_generation_id for index in first.indexes] == [
        index.collection_generation_id for index in second.indexes
    ]
    assert first.directory.collection_generation_id == second.directory.collection_generation_id

    changed = first.directory.model_copy(deep=True)
    changed.entities[0].collection_generation_id = "different-child-generation"
    assert (
        history_entity_directory_generation_id(changed) != first.directory.collection_generation_id
    )


def test_line_history_entity_index_generation_includes_raw_entity_identity():
    module = _line_history_module()
    common = {
        "local_date": date(2026, 7, 2),
        "observation_count": 2,
        "in_clamp_observation_count": 2,
        "on_time_count": 1,
        "severe_count": 1,
        "sum_delay_seconds": 30,
        "source_generated_utc": _ts(3, 8),
    }
    bundle = module.build_line_history_from_rows(
        delay_rows=[{"route_id": entity_id, **common} for entity_id in ("same/A", "same?A")],
        percentile_rows=[],
        cancellation_rows=[],
        occupancy_rows=[],
        service_span_rows=[],
        skipped_stop_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
    )

    assert len(bundle.indexes) == 2
    assert bundle.indexes[0].available_dates == bundle.indexes[1].available_dates
    assert bundle.indexes[0].collection_generation_id != bundle.indexes[1].collection_generation_id
    identical_semantics = bundle.indexes[0].model_copy(deep=True)
    identical_semantics.entity_id = "different/raw-id"
    assert history_index_generation_id(identical_semantics) != history_index_generation_id(
        bundle.indexes[0]
    )


def test_line_history_plan_retains_no_day_or_partition_models_between_batches():
    module = _line_history_module()
    rows = _line_history_rows()
    plan = module.build_line_history_plan_from_rows(
        delay_rows=rows[0],
        percentile_rows=rows[1],
        cancellation_rows=rows[2],
        occupancy_rows=rows[3],
        service_span_rows=rows[4],
        skipped_stop_rows=rows[5],
        generated_utc="2026-07-13T00:00:00Z",
        entity_batch_size=2,
    )

    def retained_payloads(value):  # noqa: ANN001, ANN202
        if isinstance(value, LineHistoryDay | LineHistoryPartition):
            return [value]
        if isinstance(value, dict):
            return [item for child in value.values() for item in retained_payloads(child)]
        if isinstance(value, list | tuple | set):
            return [item for child in value for item in retained_payloads(child)]
        return []

    assert retained_payloads(vars(plan)) == []
    iterator = plan.iter_partition_items()
    _ref, first = next(iterator)
    assert first.entity_id == "1"
    assert retained_payloads(vars(plan)) == []


def test_line_history_builder_omits_empty_entities_and_rejects_duplicate_daily_only_rows():
    module = _line_history_module()
    empty = module.build_line_history_from_rows(
        delay_rows=[],
        percentile_rows=[],
        cancellation_rows=[],
        occupancy_rows=[],
        service_span_rows=[],
        skipped_stop_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
        entity_ids=["empty"],
    )
    assert empty.partitions == []
    assert empty.indexes == []
    assert empty.directory.entities == []

    percentile = _line_history_rows()[1][0]
    with pytest.raises(ValueError, match="duplicate Line percentile day"):
        module.build_line_history_from_rows(
            delay_rows=[],
            percentile_rows=[percentile, dict(percentile)],
            cancellation_rows=[],
            occupancy_rows=[],
            service_span_rows=[],
            skipped_stop_rows=[],
            generated_utc="2026-07-13T00:00:00Z",
        )

    service_span = _line_history_rows()[4][0]
    with pytest.raises(ValueError, match="duplicate Line service-span day"):
        module.build_line_history_from_rows(
            delay_rows=[],
            percentile_rows=[],
            cancellation_rows=[],
            occupancy_rows=[],
            service_span_rows=[service_span, dict(service_span)],
            skipped_stop_rows=[],
            generated_utc="2026-07-13T00:00:00Z",
        )


def test_line_history_builder_handles_honest_denominators_and_sparse_ramp_in():
    module = _line_history_module()
    shared = {"route_id": "sparse", "local_date": date(2026, 7, 1)}
    bundle = module.build_line_history_from_rows(
        delay_rows=[
            {
                **shared,
                "observation_count": 4,
                "in_clamp_observation_count": 0,
                "on_time_count": 0,
                "severe_count": 0,
                "sum_delay_seconds": 0,
                "source_generated_utc": _ts(1, 1),
            }
        ],
        percentile_rows=[],
        cancellation_rows=[
            {
                **shared,
                "canceled_trip_days": 0,
                "total_trip_days": 5,
                "scheduled_trip_days": None,
                "delivered_trip_days": 99,
                "silent_trip_days": 99,
                "source_generated_utc": _ts(1, 2),
            },
            {
                **shared,
                "local_date": date(2026, 7, 2),
                "canceled_trip_days": 0,
                "total_trip_days": 0,
                "scheduled_trip_days": 8,
                "delivered_trip_days": 0,
                "silent_trip_days": 8,
                "source_generated_utc": _ts(2, 2),
            },
            {
                **shared,
                "local_date": date(2026, 7, 3),
                "canceled_trip_days": 0,
                "total_trip_days": 0,
                "scheduled_trip_days": None,
                "delivered_trip_days": 0,
                "silent_trip_days": 0,
                "source_generated_utc": _ts(3, 2),
            },
        ],
        occupancy_rows=[
            {
                **shared,
                "local_date": date(2026, 7, 3),
                "observation_count": 0,
                "empty": 0,
                "many_seats": 0,
                "few_seats": 0,
                "standing": 0,
                "full": 0,
                "source_generated_utc": _ts(3, 3),
            }
        ],
        service_span_rows=[],
        skipped_stop_rows=[
            {
                **shared,
                "skipped_stop_count": 0,
                "stop_time_update_count": 10,
                "source_generated_utc": _ts(1, 4),
            },
            {
                **shared,
                "local_date": date(2026, 7, 3),
                "skipped_stop_count": 0,
                "stop_time_update_count": 0,
                "source_generated_utc": _ts(3, 4),
            },
        ],
        generated_utc="2026-07-13T00:00:00Z",
    )

    days = {day.date: day for day in bundle.partitions[0].days}
    assert days["2026-07-01"].delay.in_clamp_observation_count is None
    assert days["2026-07-01"].delay.sum_delay_seconds is None
    assert days["2026-07-01"].cancellation.delivered_trip_days is None
    assert days["2026-07-01"].cancellation.silent_trip_days is None
    assert days["2026-07-01"].skipped_stops.skipped_stop_count == 0
    assert days["2026-07-02"].cancellation.scheduled_trip_days == 8
    assert "2026-07-03" not in days
    assert bundle.partitions[0].generated_utc == "2026-07-02T02:00:00Z"


@pytest.mark.parametrize(
    ("source", "match"),
    [
        (
            "occupancy",
            "occupancy observation_count must equal the sum of bands",
        ),
        ("skipped", "skipped_stop_count cannot exceed stop_time_update_count"),
        ("delay", "on_time_count plus severe_count"),
        ("percentile", "p50_delay_seconds cannot exceed p90_delay_seconds"),
    ],
)
def test_line_history_builder_rejects_impossible_metric_relationships(source, match):  # noqa: ANN001
    module = _line_history_module()
    shared = {
        "route_id": "bad",
        "local_date": date(2026, 7, 1),
        "source_generated_utc": _ts(1, 1),
    }
    rows = {
        "delay_rows": [],
        "percentile_rows": [],
        "cancellation_rows": [],
        "occupancy_rows": [],
        "service_span_rows": [],
        "skipped_stop_rows": [],
    }
    if source == "occupancy":
        rows["occupancy_rows"] = [
            {
                **shared,
                "observation_count": 2,
                "empty": 1,
                "many_seats": 0,
                "few_seats": 0,
                "standing": 0,
                "full": 0,
            }
        ]
    elif source == "skipped":
        rows["skipped_stop_rows"] = [
            {**shared, "skipped_stop_count": 2, "stop_time_update_count": 1}
        ]
    elif source == "delay":
        rows["delay_rows"] = [
            {
                **shared,
                "observation_count": 3,
                "in_clamp_observation_count": 2,
                "on_time_count": 2,
                "severe_count": 1,
                "sum_delay_seconds": 0,
            }
        ]
    else:
        rows["percentile_rows"] = [
            {
                **shared,
                "observation_count": 2,
                "p50_delay_seconds": 100,
                "p90_delay_seconds": 50,
            }
        ]
    with pytest.raises(ValueError, match=match):
        module.build_line_history_from_rows(
            **rows,
            generated_utc="2026-07-13T00:00:00Z",
        )


def test_line_history_builder_batches_six_sources_once_per_entity_batch():
    module = _line_history_module()

    class RecordingConn(NamedQueryConn):
        def __init__(self):
            super().__init__({"history.lines.ids": [{"route_id": f"R{i:02d}"} for i in range(26)]})
            self.names: list[str | None] = []
            self.params: list[dict] = []

        def execute(self, statement, params=None):  # noqa: ANN001
            self.names.append(query_name(statement))
            self.params.append(dict(params or {}))
            return super().execute(statement, params)

    conn = RecordingConn()
    bundle = module.build_line_history(
        conn,
        provider_id="stm",
        generated_utc="2026-07-13T00:00:00Z",
        entity_batch_size=25,
    )

    assert bundle.partitions == []
    assert conn.names == [
        "history.lines.ids",
        *[
            name
            for _batch in range(2)
            for name in (
                "history.lines.delay",
                "history.lines.percentiles",
                "history.lines.cancellation",
                "history.lines.occupancy",
                "history.lines.service_span",
                "history.lines.skipped_stops",
            )
        ],
    ]
    metric_sql = (
        module._LINE_HISTORY_DELAY_SQL,
        module._LINE_HISTORY_PERCENTILES_SQL,
        module._LINE_HISTORY_CANCELLATION_SQL,
        module._LINE_HISTORY_OCCUPANCY_SQL,
        module._LINE_HISTORY_SERVICE_SPAN_SQL,
        module._LINE_HISTORY_SKIPPED_STOPS_SQL,
    )
    assert all("route_id = ANY(:entity_ids)" in str(statement) for statement in metric_sql)
    assert all("provider_id = :provider_id" in str(statement) for statement in metric_sql)
    assert conn.params[0] == {"provider_id": "stm", "warm_retention_days": 730}
    assert all(
        params
        == {
            "provider_id": "stm",
            "warm_retention_days": 730,
            "entity_ids": [f"R{i:02d}" for i in range(25)],
        }
        for params in conn.params[1:7]
    )
    assert all(
        params
        == {
            "provider_id": "stm",
            "warm_retention_days": 730,
            "entity_ids": ["R25"],
        }
        for params in conn.params[7:]
    )
    for statement in (
        module._LINE_HISTORY_DELAY_SQL,
        module._LINE_HISTORY_CANCELLATION_SQL,
        module._LINE_HISTORY_OCCUPANCY_SQL,
        module._LINE_HISTORY_SKIPPED_STOPS_SQL,
    ):
        sql = str(statement)
        assert ":warm_retention_days" in sql
        assert "timezone(dp.timezone, now())::date" in sql
        assert "< timezone(dp.timezone, now())::date" in sql
        assert "MAX(" in sql and "built_at_utc" in sql
    for statement in (
        module._LINE_HISTORY_PERCENTILES_SQL,
        module._LINE_HISTORY_SERVICE_SPAN_SQL,
    ):
        sql = str(statement)
        assert ":warm_retention_days" in sql
        assert "< timezone(dp.timezone, now())::date" in sql
        assert "GROUP BY" not in sql
        assert "built_at_utc AS source_generated_utc" in sql
    ids_sql = str(module._LINE_HISTORY_IDS_SQL)
    for table in (
        "gold.route_delay_spine",
        "gold.route_delay_percentile_daily",
        "gold.route_cancellation_daily",
        "gold.route_occupancy_band_daily",
        "gold.route_service_span_daily",
        "gold.route_skipped_stop_daily",
    ):
        assert table in ids_sql
    assert "__unrouted__" in ids_sql
    assert "gold.dim_route" not in ids_sql
    assert ":warm_retention_days" in ids_sql
    assert "< timezone(dp.timezone, now())::date" in ids_sql


def test_line_history_builder_is_exported_through_both_builder_facades():
    module = _line_history_module()
    from transit_ops.snapshots import builders
    from transit_ops.snapshots.builders import historic

    assert historic.build_line_history is module.build_line_history
    assert historic.build_line_history_plan is module.build_line_history_plan
    assert builders.build_line_history is module.build_line_history
    assert builders.build_line_history_plan is module.build_line_history_plan


def _stop_history_module():
    try:
        return import_module("transit_ops.snapshots.builders.historic.stop_history")
    except ModuleNotFoundError:
        pytest.fail("Stop retained-history builder has not been implemented")


def _stop_history_rows():
    delay = [
        {
            "stop_id": "A/B é雪",
            "local_date": date(2026, 6, 30),
            "observation_count": 4,
            "severe_count": 0,
            "sum_delay_seconds": 90,
            "source_generated_utc": _ts(1, 10),
        },
        {
            "stop_id": "A/B é雪",
            "local_date": date(2026, 6, 30),
            "observation_count": 6,
            "severe_count": 2,
            "sum_delay_seconds": 150,
            "source_generated_utc": _ts(1, 11),
        },
        {
            "stop_id": "A/B é雪",
            "local_date": date(2026, 7, 2),
            "observation_count": 5,
            "severe_count": 0,
            "sum_delay_seconds": -40,
            "source_generated_utc": _ts(3, 8),
        },
        {
            "stop_id": "A/B é雪-2",
            "local_date": date(2026, 7, 2),
            "observation_count": 3,
            "severe_count": 1,
            "sum_delay_seconds": 60,
            "source_generated_utc": _ts(3, 9),
        },
    ]
    percentiles = [
        {
            "stop_id": "A/B é雪",
            "local_date": date(2026, 6, 30),
            "observation_count": 10,
            "p50_delay_seconds": 20,
            "p90_delay_seconds": 240,
            "source_generated_utc": _ts(1, 12),
        },
        {
            "stop_id": "aux-only/%",
            "local_date": date(2026, 7, 3),
            "observation_count": 2,
            "p50_delay_seconds": None,
            "p90_delay_seconds": 180,
            "source_generated_utc": _ts(4, 9),
        },
    ]
    occupancy = [
        {
            "stop_id": "A/B é雪",
            "local_date": date(2026, 7, 4),
            "observation_count": 4,
            "empty": 0,
            "many_seats": 1,
            "few_seats": 1,
            "standing": 1,
            "full": 1,
            "source_generated_utc": _ts(5, 9),
        }
    ]
    return delay, percentiles, occupancy


def _build_stop_history_fixture(*, reverse: bool = False):
    rows = _stop_history_rows()
    if reverse:
        rows = tuple(list(reversed(source)) for source in rows)
    return _stop_history_module().build_stop_history_from_rows(
        delay_rows=rows[0],
        percentile_rows=rows[1],
        occupancy_rows=rows[2],
        generated_utc="2026-07-13T00:00:00Z",
    )


def test_stop_history_builder_sums_routes_preserves_real_zero_and_splits_months():
    bundle = _build_stop_history_fixture()

    assert [(item.entity_id, item.month) for item in bundle.partitions] == [
        ("A/B é雪", "2026-06"),
        ("A/B é雪", "2026-07"),
        ("A/B é雪-2", "2026-07"),
        ("aux-only/%", "2026-07"),
    ]
    june, july, isolated, aux_only = bundle.partitions
    assert june.days[0].delay.model_dump() == {
        "observation_count": 10,
        "in_clamp_observation_count": 10,
        "on_time_count": None,
        "severe_count": 2,
        "sum_delay_seconds": 240,
    }
    assert june.days[0].delay_percentiles.p90_delay_seconds == 240
    assert july.days[0].delay.severe_count == 0
    assert july.days[0].delay.in_clamp_observation_count == 5
    assert july.days[-1].occupancy.model_dump() == {
        "empty": 0,
        "many_seats": 1,
        "few_seats": 1,
        "standing": 1,
        "full": 1,
    }
    assert isolated.days[0].delay.observation_count == 3
    assert aux_only.days[0].delay is None
    assert aux_only.days[0].delay_percentiles.observation_count == 2
    assert not hasattr(july.days[0], "habits")
    assert not hasattr(july.days[0], "by_route")


def test_stop_history_builder_has_stable_bytes_safe_identity_and_metric_coverage():
    first = _build_stop_history_fixture()
    second = _build_stop_history_fixture(reverse=True)

    assert [snapshot_json_bytes(item) for item in first.partitions] == [
        snapshot_json_bytes(item) for item in second.partitions
    ]
    assert first.indexes == second.indexes
    assert first.directory == second.directory
    awkward = next(index for index in first.indexes if index.entity_id == "A/B é雪")
    metrics = {metric.metric.value: metric for metric in awkward.metrics}
    assert metrics["delay"].first_available_date == "2026-06-30"
    assert metrics["delay"].last_available_date == "2026-07-02"
    assert metrics["delay"].gaps[0].start_date == "2026-07-01"
    assert metrics["delay_percentiles"].last_available_date == "2026-06-30"
    assert metrics["occupancy"].first_available_date == "2026-07-04"
    entry = next(item for item in first.directory.entities if item.entity_id == "A/B é雪")
    assert entry.encoded_id == "A/B é雪".encode().hex()
    assert entry.index_path == f"historic/history/stops/{entry.encoded_id}/index.json"


def test_stop_history_builder_omits_empty_days_and_rejects_duplicate_daily_percentiles():
    module = _stop_history_module()
    shared = {
        "stop_id": "empty",
        "local_date": date(2026, 7, 1),
        "source_generated_utc": _ts(1, 1),
    }
    empty = module.build_stop_history_from_rows(
        delay_rows=[
            {
                **shared,
                "observation_count": 0,
                "severe_count": 0,
                "sum_delay_seconds": 0,
            }
        ],
        percentile_rows=[],
        occupancy_rows=[
            {
                **shared,
                "observation_count": 0,
                "empty": 0,
                "many_seats": 0,
                "few_seats": 0,
                "standing": 0,
                "full": 0,
            }
        ],
        generated_utc="2026-07-13T00:00:00Z",
        entity_ids=["empty"],
    )
    assert empty.partitions == []
    assert empty.indexes == []
    assert empty.directory.entities == []

    percentile = _stop_history_rows()[1][0]
    with pytest.raises(ValueError, match="duplicate Stop percentile day"):
        module.build_stop_history_from_rows(
            delay_rows=[],
            percentile_rows=[percentile, dict(percentile)],
            occupancy_rows=[],
            generated_utc="2026-07-13T00:00:00Z",
        )


def test_stop_history_plan_batches_three_sources_and_retains_no_payload_models():
    module = _stop_history_module()

    class RecordingConn(NamedQueryConn):
        def __init__(self):
            super().__init__({"history.stops.ids": [{"stop_id": f"S{i:03d}"} for i in range(101)]})
            self.names: list[str | None] = []
            self.params: list[dict] = []

        def execute(self, statement, params=None):  # noqa: ANN001
            self.names.append(query_name(statement))
            self.params.append(dict(params or {}))
            return super().execute(statement, params)

    conn = RecordingConn()
    plan = module.build_stop_history_plan(
        conn,
        provider_id="stm",
        generated_utc="2026-07-13T00:00:00Z",
    )

    assert list(plan.iter_partition_items()) == []
    assert conn.names == [
        "history.stops.ids",
        *[
            name
            for _batch in range(2)
            for name in (
                "history.stops.delay",
                "history.stops.percentiles",
                "history.stops.occupancy",
            )
        ],
    ]
    assert all(
        "stop_id = ANY(:entity_ids)" in str(query)
        for query in (
            module._STOP_HISTORY_DELAY_SQL,
            module._STOP_HISTORY_PERCENTILES_SQL,
            module._STOP_HISTORY_OCCUPANCY_SQL,
        )
    )
    assert "gold.dim_stop" not in str(module._STOP_HISTORY_IDS_SQL)
    assert "route_id <> '__unrouted__'" not in str(module._STOP_HISTORY_DELAY_SQL)

    def retained_payloads(value):  # noqa: ANN001, ANN202
        if isinstance(value, StopHistoryDay | StopHistoryPartition):
            return [value]
        if isinstance(value, dict):
            return [item for child in value.values() for item in retained_payloads(child)]
        if isinstance(value, list | tuple | set):
            return [item for child in value for item in retained_payloads(child)]
        return []

    assert retained_payloads(vars(plan)) == []


def test_stop_history_builder_is_exported_through_both_builder_facades():
    module = _stop_history_module()
    from transit_ops.snapshots import builders
    from transit_ops.snapshots.builders import historic

    assert historic.build_stop_history is module.build_stop_history
    assert historic.build_stop_history_plan is module.build_stop_history_plan
    assert builders.build_stop_history is module.build_stop_history
    assert builders.build_stop_history_plan is module.build_stop_history_plan


def test_stop_history_stream_summary_retains_compact_date_masks_not_daily_strings():
    module = _stop_history_module()
    plan = module.build_stop_history_plan_from_rows(
        delay_rows=[
            {
                "stop_id": "S1",
                "local_date": date(2024, 7, 1).fromordinal(date(2024, 7, 1).toordinal() + offset),
                "observation_count": 1,
                "severe_count": 0,
                "sum_delay_seconds": 0,
                "source_generated_utc": _ts(1, 10),
            }
            for offset in range(730)
        ],
        percentile_rows=[],
        occupancy_rows=[],
        generated_utc="2026-07-13T00:00:00Z",
    )
    summary = module.StopHistoryStreamSummary()
    for ref, partition in plan.iter_partition_items():
        summary.observe(ref, partition)

    entity = summary.entities["S1"]
    assert not isinstance(entity.available_dates, list)
    assert all(not isinstance(dates, list) for dates in entity.metric_dates.values())
    assert list(entity.available_dates) == [
        date(2024, 7, 1).fromordinal(date(2024, 7, 1).toordinal() + offset).isoformat()
        for offset in range(730)
    ]
    assert not isinstance(entity.generated_utc, list)


def test_line_and_stop_history_artifact_bytes_are_frozen():
    expected = {
        "line": {
            "partitions": {
                ("1", "2026-06"): (
                    481,
                    "498efeb1e8de828d808882500702a676edd75c8c6e85df430f14af7ac362602e",
                ),
                ("1", "2026-07"): (
                    569,
                    "17a286c3a89fa2c9f118f4b9c184864595b04fa0d1e152eaa2a22f8d9a65d7de",
                ),
                ("10", "2026-06"): (
                    413,
                    "79acf1f9208fdb8582f4179943dec50bbce353c917e095d72d9d6e92f36d769e",
                ),
                ("10", "2026-07"): (
                    362,
                    "12b499a794115fba1587673a77b4eb650929b3b04a49a1621b980ef732a28d79",
                ),
                ("A/B", "2026-07"): (
                    634,
                    "a82df473e60a52b68db573ad4cb621db2b94f0a3836ac2b01136b08070281706",
                ),
            },
            "indexes": {
                "1": (1892, "8aceaa97e0145a93ec3af6f743fb1a2fecf22d67c7a4467d18e40535d13bb8cb"),
                "10": (1800, "67ad52a24aedf9f9ea9504bc6d573b9fd39f503b2b657cd629ab43ed59850aca"),
                "A/B": (1452, "f6eb3f0b44e48b77e76ede31b08db9309b657c1e35da3ad6f20f7d367af1ac34"),
            },
            "directory": (1116, "172288b179195578ed384ab3c8d338a1027cc7f0e4fba806d0a045fab9445ded"),
        },
        "stop": {
            "partitions": {
                ("A/B é雪", "2026-06"): (
                    435,
                    "33da367be41daa5ff3151fb34c9d6b1ecb05add5a376b87afa5bf524cc98f06b",
                ),
                ("A/B é雪", "2026-07"): (
                    497,
                    "f48c0a7125ca5e8e7a7eebf8b375ab9ec78145b6167be0c61e17fb30403230f6",
                ),
                ("A/B é雪-2", "2026-07"): (
                    363,
                    "60efc86a1ece093ec324bd0e03f52b6bdfbdae9e266e2f31db05aef04795546b",
                ),
                ("aux-only/%", "2026-07"): (
                    321,
                    "7a37e7f608466340b02d2ab15d8f5e414c25b00a22654035187abfde94fe66db",
                ),
            },
            "indexes": {
                "A/B é雪": (
                    1644,
                    "6e2e5b2eaa8558cbb64759849e710b41042878439a2fe3805fe87b04ad567ad2",
                ),
                "A/B é雪-2": (
                    1093,
                    "bc5fcadd51396c2f08f79288b0d4e23203a7520bb4bb6080f6f1dfc2ba32e845",
                ),
                "aux-only/%": (
                    1090,
                    "cbb45c94956b69de661a082f322b59f0b1ce4a61322c92bfe4b43da60235649f",
                ),
            },
            "directory": (1236, "f9c2ad78b2453f8b5898aab470b478fac44e308f454afe2cea66457861189cb4"),
        },
    }

    for family, bundle in (
        ("line", _build_line_history_fixture()),
        ("stop", _build_stop_history_fixture()),
    ):
        actual_partitions = {
            (partition.entity_id, partition.month): (
                len(snapshot_json_bytes(partition)),
                snapshot_sha256(partition),
            )
            for partition in bundle.partitions
        }
        actual_indexes = {
            index.entity_id: (len(snapshot_json_bytes(index)), snapshot_sha256(index))
            for index in bundle.indexes
        }
        actual_directory = (
            len(snapshot_json_bytes(bundle.directory)),
            snapshot_sha256(bundle.directory),
        )
        assert actual_partitions == expected[family]["partitions"]
        assert actual_indexes == expected[family]["indexes"]
        assert actual_directory == expected[family]["directory"]


def test_line_and_stop_history_sql_text_is_frozen():
    line = _line_history_module()
    stop = _stop_history_module()
    statements = {
        "line.ids": line._LINE_HISTORY_IDS_SQL,
        "line.delay": line._LINE_HISTORY_DELAY_SQL,
        "line.percentiles": line._LINE_HISTORY_PERCENTILES_SQL,
        "line.cancellation": line._LINE_HISTORY_CANCELLATION_SQL,
        "line.occupancy": line._LINE_HISTORY_OCCUPANCY_SQL,
        "line.service_span": line._LINE_HISTORY_SERVICE_SPAN_SQL,
        "line.skipped": line._LINE_HISTORY_SKIPPED_STOPS_SQL,
        "stop.ids": stop._STOP_HISTORY_IDS_SQL,
        "stop.delay": stop._STOP_HISTORY_DELAY_SQL,
        "stop.percentiles": stop._STOP_HISTORY_PERCENTILES_SQL,
        "stop.occupancy": stop._STOP_HISTORY_OCCUPANCY_SQL,
    }
    expected = {
        "line.ids": "0642b8a1ab2f9df6df56a8a1c1b063cca2e236ac2114733b8212f6340eb79595",
        "line.delay": "65aac7777f19b18c435aad1efd31f953b266a614955ee08f560b41156b16ec48",
        "line.percentiles": "2393e0e88b036c8ef42bfe1341b9a252e4b8015c52024eaac19af4267e96294e",
        "line.cancellation": "9c01fcdfd3186c098479d9c2c49c93aa67fba442aa256da19afa26b6067e26e9",
        "line.occupancy": "697fd3008231132a6e15ad6fdb5309808a30ff7ee93041ccb2de757412a87ee8",
        "line.service_span": "7047e155453e28f823a337d4c2dbb0281de12178e1ef23d404214ae107f2449f",
        "line.skipped": "3b270a948c168c92f15d43ea94fb06c97ce197ba911244812fd6fcdb18db9ff0",
        "stop.ids": "b865607ceb55550c60cfdf8fd7bab2ab0308278a481eeb6bb00879d0322267a0",
        "stop.delay": "bc99d98ac6cd88c3d2a4c4fc910e8ee2744aef813eab502c709c8ff26904e6f8",
        "stop.percentiles": "c6034c05ca45b9ccaab352f91e6151a2c1aee3806c547a551c3f9ab81277256b",
        "stop.occupancy": "7f776febf4c89708a1625967915b7e9d710ec389b613a8107fb3987bb0b50a24",
    }

    assert {
        name: hashlib.sha256(str(statement).encode()).hexdigest()
        for name, statement in statements.items()
    } == expected


def test_history_common_numeric_grouping_and_write_helpers():
    common = import_module("transit_ops.snapshots.builders.historic.history_common")
    optional_sum = common.history_optional_sum
    row_float = common.history_row_float
    group_rows = common.group_history_entity_date_rows
    put_metric = common.put_history_entity_metric
    put_timestamps = common.put_history_entity_timestamps
    clean_ids = common.clean_history_entity_ids

    assert optional_sum([None, 2, None, 3]) == 5
    assert optional_sum([None, None]) is None
    assert row_float({"value": "2.5"}, "value") == 2.5
    assert row_float({"value": None}, "value") is None
    with pytest.raises(ValueError, match="must be numeric"):
        row_float({"value": True}, "value")

    rows = [
        {"entity": "B", "local_date": date(2026, 7, 2), "source_generated_utc": _ts(3, 8)},
        {"entity": "A", "local_date": "2026-07-01", "source_generated_utc": _ts(2, 8)},
        {"entity": "B", "local_date": "2026-07-02", "source_generated_utc": _ts(3, 9)},
    ]
    grouped = group_rows(rows, entity_id_of=lambda row: row["entity"])
    assert list(grouped) == [("B", "2026-07-02"), ("A", "2026-07-01")]
    assert grouped[("B", "2026-07-02")] == [rows[0], rows[2]]

    metrics = {}
    timestamps = {}
    put_metric(metrics, "B", "2026-07-02", "metric")
    put_timestamps(timestamps, "B", "2026-07-02", grouped[("B", "2026-07-02")])
    assert metrics == {"B": {"2026-07-02": "metric"}}
    assert timestamps == {"B": {"2026-07-02": ["2026-07-03T08:00:00Z", "2026-07-03T09:00:00Z"]}}
    assert clean_ids(["B", "", None, "A", "B", "__unrouted__"], excluded=("__unrouted__",)) == (
        "A",
        "B",
    )


def test_history_common_entity_plan_and_month_partition_helpers():
    common = import_module("transit_ops.snapshots.builders.historic.history_common")
    metric_sources = (
        {"A": {"2026-07-01": "delay"}},
        {"B": {"2026-06-30": "occupancy"}},
    )
    timestamp_sources = (
        {"A": {"2026-07-01": ["2026-07-02T08:00:00Z"]}},
        {"B": {"2026-06-30": ["2026-07-01T08:00:00Z"]}},
    )
    plans = common.build_history_entity_metric_plans(
        entity_ids=("empty", "B", "A"),
        metric_sources=metric_sources,
        timestamp_sources=timestamp_sources,
    )
    assert all(isinstance(plan, common.HistoryEntityMetricPlan) for plan in plans)
    assert [(plan.entity_id, plan.available_dates) for plan in plans] == [
        ("A", ("2026-07-01",)),
        ("B", ("2026-06-30",)),
    ]
    assert list(common.iter_history_month_groups(("2026-07-02", "2026-06-30", "2026-07-01"))) == [
        ("2026-06", ("2026-06-30",)),
        ("2026-07", ("2026-07-01", "2026-07-02")),
    ]

    ref, partition = common.history_month_partition_ref(
        lambda local_date: StopHistoryDay(
            date=local_date,
            delay={
                "observation_count": 1,
                "in_clamp_observation_count": 1,
                "sum_delay_seconds": 0,
            },
        ),
        lambda generated_utc, month, days: StopHistoryPartition(
            generated_utc=generated_utc,
            methodology_version="history-1",
            entity_id="S",
            month=month,
            days=days,
        ),
        lambda digest, month: f"historic/history/stops/53/generations/{digest}/{month}.json",
        month="2026-07",
        dates=("2026-07-01",),
        source_timestamps=({"2026-07-01": ["2026-07-02T08:00:00Z"]},),
    )
    assert ref.path.endswith(f"/{snapshot_sha256(partition)}/2026-07.json")
    assert ref.sha256 == snapshot_sha256(partition)
    assert partition.generated_utc == "2026-07-02T08:00:00Z"


def test_history_common_batch_loader_helpers_and_family_adoption():
    common = import_module("transit_ops.snapshots.builders.historic.history_common")
    assert common.HistoryRow is not None
    assert common.HistoryMetricRows is not None
    assert common.HistoryBatchLoader is not None

    sources = (
        ({"stop_id": "B", "value": 1}, {"stop_id": "A", "value": 2}),
        ({"stop_id": "A", "value": 3},),
    )
    row_loader = common.prepare_history_row_batch_loader(sources, entity_field="stop_id")
    assert row_loader(["A"]) == ([sources[0][1]], [sources[1][0]])

    stop = _stop_history_module()
    conn = NamedQueryConn(
        {
            "history.stops.delay": [{"stop_id": "A"}],
            "history.stops.percentiles": [{"stop_id": "B"}],
        },
        strict=True,
    )
    sql_loader = common.prepare_history_sql_batch_loader(
        conn,
        (stop._STOP_HISTORY_DELAY_SQL, stop._STOP_HISTORY_PERCENTILES_SQL),
        base_params={"provider_id": "stm"},
    )
    assert sql_loader(["A"]) == ([{"stop_id": "A"}], [{"stop_id": "B"}])

    line_source = inspect.getsource(_line_history_module())
    stop_source = inspect.getsource(stop)
    network_source = inspect.getsource(
        import_module("transit_ops.snapshots.builders.historic.network_history")
    )
    for source in (line_source, stop_source):
        assert "HistoryEntityMetricPlan" in source
        assert "build_history_entity_metric_plans" in source
        assert "prepare_history_row_batch_loader" in source
        assert "prepare_history_sql_batch_loader" in source
        assert "def _group_rows(" not in source
        assert "def _float_value(" not in source
        assert "def _put_metric(" not in source
        assert "def _put_timestamps(" not in source
        assert "def _clean_entity_ids(" not in source
    assert "def _optional_sum(" not in line_source
    assert "def _optional_sum(" not in network_source
    assert "def _float_value(" not in network_source
