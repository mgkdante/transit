from __future__ import annotations

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
from transit_ops.snapshots.contract import LineHistoryDay, LineHistoryPartition, NetworkHistoryDay
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
