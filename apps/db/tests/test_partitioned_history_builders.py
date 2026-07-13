from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from _sqlfakes import NamedQueryConn

from transit_ops.snapshots.builders.historic.network_history import (
    _NETWORK_HISTORY_CANCELLATION_SQL,
    _NETWORK_HISTORY_DELAY_SQL,
    _NETWORK_HISTORY_FACT_SQL,
    _NETWORK_HISTORY_OCCUPANCY_SQL,
    build_network_history,
    build_network_history_from_rows,
    build_network_history_plan_from_rows,
)
from transit_ops.snapshots.contract import NetworkHistoryDay
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
