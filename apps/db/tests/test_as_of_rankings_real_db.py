from __future__ import annotations

import hashlib
import os
from contextlib import contextmanager
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine, text

from transit_ops.snapshots import gate, publish
from transit_ops.snapshots.builders import historic
from transit_ops.snapshots.builders.historic.history_common import (
    PointHistorySummary,
    history_pointer_path,
)
from transit_ops.snapshots.builders.historic.small_surfaces import (
    build_hotspots,
    build_repeat_offenders,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256
from transit_ops.sql_registry import query_name

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - as-of ranking publication gate skipped",
)

PROVIDER = "stm_as_of_rankings_publish_test"
STAMP = "2026-07-13T00:00:00Z"
DATES = [date(2026, 7, day) for day in (4, 6, 8, 10)]
FUTURE_DATE = date(2099, 12, 31)


class _NamedQueryConnection:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self.connection = connection
        self.names: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ANN201
        if (name := query_name(statement)) is not None:
            self.names.append(name)
        return self.connection.execute(statement, params or {})


@contextmanager
def _seeded_connection():  # noqa: ANN201
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(
                text(
                    "INSERT INTO core.providers "
                    "(provider_id, display_name, timezone, provider_key) "
                    "VALUES (:provider_id, 'As-of ranking publication', "
                    "'America/Toronto', :provider_id) "
                    "ON CONFLICT (provider_id) DO NOTHING"
                ),
                {"provider_id": PROVIDER},
            )
            for table in (
                "repeat_offender",
                "repeat_offender_daily_spine",
                "repeated_problem_route_stop",
                "stop_delay_shift_daily",
                "stop_delay_spine",
                "route_delay_spine",
            ):
                connection.execute(
                    text(f"DELETE FROM gold.{table} WHERE provider_id = :provider_id"),
                    {"provider_id": PROVIDER},
                )

            route_insert = text(
                "INSERT INTO gold.route_delay_spine "
                "(provider_id, route_id, provider_local_date, hour_of_day_local, direction_id, "
                "observation_count, delay_observation_count, on_time_observation_count, "
                "severe_delay_count, sum_delay_seconds, delay_histogram, built_at_utc) "
                "VALUES (:provider_id, :route_id, :local_date, 8, 0, :observations, "
                ":observations, :on_time, :severe, :delay_sum, "
                "CAST(:histogram AS smallint[]), :built_at)"
            )
            stop_insert = text(
                "INSERT INTO gold.stop_delay_spine "
                "(provider_id, stop_id, route_id, provider_local_date, observation_count, "
                "severe_delay_count, sum_delay_seconds, built_at_utc) "
                "VALUES (:provider_id, :stop_id, 'R1', :local_date, :observations, "
                ":severe, :delay_sum, :built_at)"
            )
            offender_insert = text(
                "INSERT INTO gold.repeat_offender_daily_spine "
                "(provider_id, entity_kind, entity_id, route_id, provider_local_date, "
                "observation_count, severe_delay_count, sum_delay_seconds, built_at_utc) "
                "VALUES (:provider_id, :kind, :entity_id, 'R1', :local_date, "
                ":observations, :severe, :delay_sum, :built_at)"
            )

            empty_histogram = [0] * 21
            connection.execute(
                route_insert,
                {
                    "provider_id": PROVIDER,
                    "route_id": "__unrouted__",
                    "local_date": DATES[0],
                    "observations": 0,
                    "on_time": 0,
                    "severe": 0,
                    "delay_sum": 0,
                    "histogram": empty_histogram,
                    "built_at": datetime(2026, 7, 5, tzinfo=UTC),
                },
            )
            connection.execute(
                offender_insert,
                {
                    "provider_id": PROVIDER,
                    "kind": "trip",
                    "entity_id": "empty-day",
                    "local_date": DATES[0],
                    "observations": 0,
                    "severe": 0,
                    "delay_sum": 0,
                    "built_at": datetime(2026, 7, 5, 1, tzinfo=UTC),
                },
            )

            future_histogram = [0] * 21
            future_histogram[10] = 40
            connection.execute(
                route_insert,
                {
                    "provider_id": PROVIDER,
                    "route_id": "R_FUTURE",
                    "local_date": FUTURE_DATE,
                    "observations": 40,
                    "on_time": 0,
                    "severe": 40,
                    "delay_sum": 40 * 3_600,
                    "histogram": future_histogram,
                    "built_at": datetime(2100, 1, 1, tzinfo=UTC),
                },
            )
            connection.execute(
                stop_insert,
                {
                    "provider_id": PROVIDER,
                    "stop_id": "S_FUTURE",
                    "local_date": FUTURE_DATE,
                    "observations": 40,
                    "severe": 40,
                    "delay_sum": 40 * 3_600,
                    "built_at": datetime(2100, 1, 1, tzinfo=UTC),
                },
            )
            connection.execute(
                offender_insert,
                {
                    "provider_id": PROVIDER,
                    "kind": "trip",
                    "entity_id": "T_FUTURE",
                    "local_date": FUTURE_DATE,
                    "observations": 40,
                    "severe": 40,
                    "delay_sum": 40 * 3_600,
                    "built_at": datetime(2100, 1, 1, tzinfo=UTC),
                },
            )

            for offset, local_date in enumerate(DATES[1:]):
                histogram = [0] * 21
                histogram[10] = 40
                built_at = datetime(2026, 7, local_date.day + 1, tzinfo=UTC)
                connection.execute(
                    route_insert,
                    {
                        "provider_id": PROVIDER,
                        "route_id": "R1",
                        "local_date": local_date,
                        "observations": 40,
                        "on_time": 20,
                        "severe": 6 + offset,
                        "delay_sum": 40 * 400,
                        "histogram": histogram,
                        "built_at": built_at,
                    },
                )
                connection.execute(
                    stop_insert,
                    {
                        "provider_id": PROVIDER,
                        "stop_id": "S1",
                        "local_date": local_date,
                        "observations": 35,
                        "severe": 12 - offset,
                        "delay_sum": 35 * 500,
                        "built_at": built_at,
                    },
                )
                for kind, entity_id, severe, average in (
                    ("trip", "T1", 5, 400),
                    ("vehicle", "V1", 10, 500),
                ):
                    connection.execute(
                        offender_insert,
                        {
                            "provider_id": PROVIDER,
                            "kind": kind,
                            "entity_id": entity_id,
                            "local_date": local_date,
                            "observations": 40,
                            "severe": severe,
                            "delay_sum": 40 * average,
                            "built_at": built_at,
                        },
                    )

            week_start = date(2026, 7, 6)
            for kind, entity_id, issues, average in (
                ("route", "R1", 21, 400),
                ("stop", "S1", 33, 500),
            ):
                connection.execute(
                    text(
                        "INSERT INTO gold.repeated_problem_route_stop "
                        "(provider_id, entity_kind, entity_id, route_id, period_grain, "
                        "period_start_local, issue_count, avg_delay_seconds, severity_label) "
                        "VALUES (:provider_id, :kind, :entity_id, 'R1', 'week', "
                        ":week_start, :issues, :average, 'critical')"
                    ),
                    {
                        "provider_id": PROVIDER,
                        "kind": kind,
                        "entity_id": entity_id,
                        "week_start": week_start,
                        "issues": issues,
                        "average": average,
                    },
                )
            for kind, entity_id, average in (
                ("trip", "T1", 400),
                ("vehicle", "V1", 500),
            ):
                connection.execute(
                    text(
                        "INSERT INTO gold.repeat_offender "
                        "(provider_id, entity_kind, entity_id, route_id, recurrence_days, "
                        "window_days, avg_delay_seconds, severity_label) "
                        "VALUES (:provider_id, :kind, :entity_id, 'R1', 3, 14, "
                        ":average, 'watch')"
                    ),
                    {
                        "provider_id": PROVIDER,
                        "kind": kind,
                        "entity_id": entity_id,
                        "average": average,
                    },
                )
            yield connection
        finally:
            transaction.rollback()
    engine.dispose()


def _repeat_grain_core(grain) -> dict[str, object]:  # noqa: ANN001
    value = grain.model_dump(mode="json")
    value.pop("date", None)
    value.pop("window_end", None)
    return value


def test_publish_advisory_transaction_lock_serializes_provider_history_lane() -> None:
    engine = create_engine(DB_URL)
    with engine.connect() as first, engine.connect() as second:
        first_tx = first.begin()
        second_tx = second.begin()
        params = {"provider_id": PROVIDER, "tier": "historic"}
        try:
            assert first.execute(publish._PUBLISH_LOCK_SQL, params).scalar_one() is True  # noqa: SLF001
            assert second.execute(publish._PUBLISH_LOCK_SQL, params).scalar_one() is False  # noqa: SLF001
            assert (  # a different tier remains an independent lane
                second.execute(
                    publish._PUBLISH_LOCK_SQL,  # noqa: SLF001
                    {"provider_id": PROVIDER, "tier": "static"},
                ).scalar_one()
                is True
            )
            first_tx.rollback()
            assert second.execute(publish._PUBLISH_LOCK_SQL, params).scalar_one() is True  # noqa: SLF001
        finally:
            if first_tx.is_active:
                first_tx.rollback()
            second_tx.rollback()
    engine.dispose()


def test_production_point_plans_are_bounded_closed_parity_exactly_addressed() -> None:
    with _seeded_connection() as connection:
        recorded = _NamedQueryConnection(connection)
        hotspot_plan = historic.build_hotspots_history_plan(recorded, PROVIDER)
        repeat_plan = historic.build_repeat_offenders_history_plan(recorded, PROVIDER)
        hotspot_days = list(hotspot_plan.iter_days())
        repeat_days = list(repeat_plan.iter_days())

        assert recorded.names == [
            "history.hotspots.timezone",
            "history.hotspots.names",
            "history.hotspots.route_daily",
            "history.hotspots.stop_daily",
            "history.repeat_offenders.timezone",
            "history.repeat_offenders.names",
            "history.repeat_offenders.daily",
        ]
        expected_dates = [value.isoformat() for value in DATES]
        assert [payload.date for payload in hotspot_days] == expected_dates
        assert [payload.date for payload in repeat_days] == expected_dates
        assert FUTURE_DATE.isoformat() not in {
            *(payload.date for payload in hotspot_days),
            *(payload.date for payload in repeat_days),
        }
        provider_today = connection.execute(
            text(
                "SELECT timezone(dp.timezone, now())::date "
                "FROM gold.dim_provider AS dp WHERE dp.provider_id = :provider_id"
            ),
            {"provider_id": PROVIDER},
        ).scalar_one()
        assert all(date.fromisoformat(value) < provider_today for value in expected_dates)
        assert hotspot_days[0].hotspots == [] and hotspot_days[0].by_grain == []
        assert repeat_days[0].offenders == [] and repeat_days[0].by_grain == []

        for table in (
            "route_delay_spine",
            "stop_delay_spine",
            "repeat_offender_daily_spine",
        ):
            connection.execute(
                text(
                    f"DELETE FROM gold.{table} "
                    "WHERE provider_id = :provider_id AND provider_local_date = :future_date"
                ),
                {"provider_id": PROVIDER, "future_date": FUTURE_DATE},
            )

        current_hotspots = build_hotspots(
            connection,
            provider_id=PROVIDER,
            generated_utc=STAMP,
        )
        current_repeat = build_repeat_offenders(
            connection,
            provider_id=PROVIDER,
            generated_utc=STAMP,
        )

    assert current_hotspots.hotspots == hotspot_days[-1].hotspots
    assert [value.model_dump(mode="json") for value in current_hotspots.by_grain] == [
        value.model_dump(mode="json") for value in hotspot_days[-1].by_grain
    ]
    assert current_repeat.offenders == repeat_days[-1].offenders
    assert [_repeat_grain_core(value) for value in current_repeat.by_grain] == [
        _repeat_grain_core(value) for value in repeat_days[-1].by_grain
    ]

    for family, payloads in (
        ("hotspots", hotspot_days),
        ("repeat_offenders", repeat_days),
    ):
        summary = PointHistorySummary(family)
        for payload in payloads:
            ref = summary.observe(payload)
            raw = snapshot_json_bytes(payload)
            digest = hashlib.sha256(raw).hexdigest()
            assert ref.sha256 == digest
            assert ref.byte_size == len(raw)
            assert ref.coverage_start == payload.date == ref.coverage_end
            assert ref.path.endswith(f"/{digest}/{payload.date}.json")
            assert gate.check_point_history_day_ref(ref, payload, family=family) == []
        index = summary.build_index(fallback_generated_utc=STAMP)
        publish._stamp_envelope(  # noqa: SLF001
            [("unused", index, "historic")],
            provider_id=PROVIDER,
            stamp=STAMP,
        )
        path = history_pointer_path(f"historic/history/{family}", index)
        assert path.endswith(f"/{snapshot_sha256(index)}/index.json")
        assert (
            gate.check_point_history_index(
                index,
                rel_key=path,
                family=family,
                expected_refs=summary.refs,
                fallback_generated_utc=STAMP,
            )
            == []
        )
