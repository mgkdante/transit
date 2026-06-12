"""Real-database regressions for immutable closed-period history.

These tests run only against a disposable Postgres database migrated to head:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_immutable_history_real_db.py -v

Never point this at production.
"""

from __future__ import annotations

import importlib.util
import os
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold import rollups
from transit_ops.settings import Settings

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - real-DB regression tests skipped",
)

PROVIDER = "stm_immutable_history_test"
TRIP_ENDPOINT_ID = 993300
VEHICLE_ENDPOINT_ID = 993301
BASE_RUN_ID = 993400
BASE_SNAPSHOT_ID = 993500
ROUTE = "51"
STOP = "S51"
BUILT_OLD = datetime(2026, 5, 1, 7, 0, tzinfo=UTC)
BUILT_T = datetime(2026, 6, 12, 7, 3, 22, tzinfo=UTC)


class _NoCommitEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    @contextmanager
    def begin(self):  # noqa: ANN201
        yield self._connection


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed_provider(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _migration_0033():
    path = (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0033_trip_delay_summary_severe_counts.py"
    )
    spec = importlib.util.spec_from_file_location("m0033", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _settings() -> Settings:
    return Settings.model_construct(
        DATABASE_URL=None,
        GOLD_FACT_RETENTION_DAYS=14,
        GOLD_REPORTING_OPEN_WINDOW_DAYS=10,
        GOLD_WARM_ROLLUP_RETENTION_DAYS=365,
    )


def _seed_provider(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM immutable history regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    for endpoint_id, endpoint_key, feed_kind, source_format in (
        (TRIP_ENDPOINT_ID, "trip_updates", "trip_updates", "gtfs_rt_trip_updates"),
        (
            VEHICLE_ENDPOINT_ID,
            "vehicle_positions",
            "vehicle_positions",
            "gtfs_rt_vehicle_positions",
        ),
    ):
        connection.execute(
            text(
                """
                INSERT INTO core.feed_endpoints
                    (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
                VALUES (:e, :p, :endpoint_key, :feed_kind, :source_format)
                """
            ),
            {
                "e": endpoint_id,
                "p": PROVIDER,
                "endpoint_key": endpoint_key,
                "feed_kind": feed_kind,
                "source_format": source_format,
            },
        )


def _insert_snapshot(
    connection,  # noqa: ANN001
    *,
    captured_at: datetime,
    run_id: int,
    snapshot_id: int,
    endpoint_id: int,
    run_kind: str,
    entity_count: int = 1,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :p, :endpoint_id, :run_kind, 'succeeded')
            """
        ),
        {
            "run_id": run_id,
            "p": PROVIDER,
            "endpoint_id": endpoint_id,
            "run_kind": run_kind,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id,
                 feed_timestamp_utc, entity_count, captured_at_utc)
            VALUES (:snapshot_id, :run_id, :p, :endpoint_id, :captured, :n, :captured)
            """
        ),
        {
            "snapshot_id": snapshot_id,
            "run_id": run_id,
            "p": PROVIDER,
            "endpoint_id": endpoint_id,
            "captured": captured_at,
            "n": entity_count,
        },
    )


def _insert_trip_fact(
    connection,  # noqa: ANN001
    *,
    captured_at: datetime,
    snapshot_id: int,
    entity_index: int,
    delay_seconds: int,
    trip_id: str,
) -> None:
    local_date = captured_at.date()
    _insert_snapshot(
        connection,
        captured_at=captured_at,
        run_id=BASE_RUN_ID + snapshot_id,
        snapshot_id=snapshot_id,
        endpoint_id=TRIP_ENDPOINT_ID,
        run_kind="trip_updates",
    )
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count)
            VALUES
                (:p, :snapshot_id, :entity_index, :date_key, :local_date,
                 :captured, :captured, :entity_id, :trip_id, :route_id, 0,
                 :local_date, :vehicle_id, 0, :delay, 1)
            """
        ),
        {
            "p": PROVIDER,
            "snapshot_id": snapshot_id,
            "entity_index": entity_index,
            "date_key": int(local_date.strftime("%Y%m%d")),
            "local_date": local_date,
            "captured": captured_at,
            "entity_id": f"{trip_id}-{snapshot_id}",
            "trip_id": trip_id,
            "route_id": ROUTE,
            "vehicle_id": f"V-{trip_id}",
            "delay": delay_seconds,
        },
    )


def _insert_vehicle_fact(
    connection,  # noqa: ANN001
    *,
    captured_at: datetime,
    snapshot_id: int,
    entity_index: int,
    trip_id: str,
) -> None:
    local_date = captured_at.date()
    _insert_snapshot(
        connection,
        captured_at=captured_at,
        run_id=BASE_RUN_ID + snapshot_id,
        snapshot_id=snapshot_id,
        endpoint_id=VEHICLE_ENDPOINT_ID,
        run_kind="vehicle_positions",
    )
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_vehicle_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc,
                 entity_id, vehicle_id, trip_id, route_id, stop_id)
            VALUES
                (:p, :snapshot_id, :entity_index, :date_key, :local_date,
                 :captured, :captured, :entity_id, :vehicle_id, :trip_id,
                 :route_id, :stop_id)
            """
        ),
        {
            "p": PROVIDER,
            "snapshot_id": snapshot_id,
            "entity_index": entity_index,
            "date_key": int(local_date.strftime("%Y%m%d")),
            "local_date": local_date,
            "captured": captured_at,
            "entity_id": f"veh-{snapshot_id}",
            "vehicle_id": f"veh-{snapshot_id}",
            "trip_id": trip_id,
            "route_id": ROUTE,
            "stop_id": STOP,
        },
    )


def _insert_5m(
    connection,  # noqa: ANN001
    *,
    period: datetime,
    route_id: str = ROUTE,
    severe: int,
    built_at: datetime = BUILT_OLD,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO gold.trip_delay_summary_5m
                (provider_id, period_start_utc, route_id, trip_count, observation_count,
                 delay_observation_count, on_time_observation_count, avg_delay_seconds,
                 avg_delay_seconds_capped, max_delay_seconds, max_delay_seconds_capped,
                 min_delay_seconds, delayed_trip_count, outlier_count,
                 severe_delay_observation_count, built_at_utc)
            VALUES
                (:p, :period, :route_id, 1, 1, 1, 0, 400.0, 400.0, 400, 400,
                 400, 1, 0, :severe, :built_at)
            """
        ),
        {
            "p": PROVIDER,
            "period": period,
            "route_id": route_id,
            "severe": severe,
            "built_at": built_at,
        },
    )


def _run_build(connection, monkeypatch: pytest.MonkeyPatch, built_at: datetime) -> None:  # noqa: ANN001
    monkeypatch.setattr(rollups, "utc_now", lambda: built_at)
    rollups.build_warm_rollups(
        PROVIDER,
        settings=_settings(),
        engine=_NoCommitEngine(connection),
    )


def _row(connection, sql: str, params: dict[str, object]) -> dict[str, object]:  # noqa: ANN001
    return dict(connection.execute(text(sql), params).mappings().one())


def _checksum(connection, table_name: str) -> str:  # noqa: ANN001
    return connection.execute(
        text(
            f"""
            SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text), ''))
            FROM gold.{table_name} AS t
            WHERE provider_id = :p
            """
        ),
        {"p": PROVIDER},
    ).scalar_one()


def test_frozen_hourly_rows_survive_fact_prune(
    conn, monkeypatch: pytest.MonkeyPatch
) -> None:  # noqa: ANN001
    captured_at = BUILT_T - timedelta(hours=2)
    _insert_trip_fact(
        conn,
        captured_at=captured_at,
        snapshot_id=BASE_SNAPSHOT_ID + 1,
        entity_index=0,
        delay_seconds=400,
        trip_id="late-1",
    )
    _insert_vehicle_fact(
        conn,
        captured_at=captured_at,
        snapshot_id=BASE_SNAPSHOT_ID + 2,
        entity_index=0,
        trip_id="late-1",
    )
    _run_build(conn, monkeypatch, BUILT_T)

    hour = captured_at.replace(minute=0, second=0, microsecond=0)
    old_hour = hour - timedelta(days=20)
    conn.execute(
        text(
            """
            UPDATE gold.route_delay_hourly
            SET period_start_utc = :old_hour
            WHERE provider_id = :p AND period_start_utc = :hour
            """
        ),
        {"p": PROVIDER, "hour": hour, "old_hour": old_hour},
    )
    conn.execute(
        text(
            """
            UPDATE gold.stop_delay_hourly
            SET period_start_utc = :old_hour
            WHERE provider_id = :p AND period_start_utc = :hour
            """
        ),
        {"p": PROVIDER, "hour": hour, "old_hour": old_hour},
    )
    conn.execute(
        text(
            """
            UPDATE gold.trip_delay_summary_5m
            SET period_start_utc = period_start_utc - interval '20 days'
            WHERE provider_id = :p
            """
        ),
        {"p": PROVIDER},
    )
    conn.execute(
        text(
            """
            UPDATE gold.warm_rollup_periods
            SET period_start_utc = period_start_utc - interval '20 days'
            WHERE provider_id = :p
            """
        ),
        {"p": PROVIDER},
    )
    conn.execute(
        text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id = :p"),
        {"p": PROVIDER},
    )
    conn.execute(
        text("DELETE FROM gold.fact_vehicle_snapshot WHERE provider_id = :p"),
        {"p": PROVIDER},
    )
    before = _row(
        conn,
        """
        SELECT severe_delay_count, built_at_utc
        FROM gold.route_delay_hourly
        WHERE provider_id = :p AND period_start_utc = :old_hour
        """,
        {"p": PROVIDER, "old_hour": old_hour},
    )

    _run_build(conn, monkeypatch, BUILT_T + timedelta(hours=1))

    after = _row(
        conn,
        """
        SELECT severe_delay_count, built_at_utc
        FROM gold.route_delay_hourly
        WHERE provider_id = :p AND period_start_utc = :old_hour
        """,
        {"p": PROVIDER, "old_hour": old_hour},
    )
    stop_count = conn.execute(
        text(
            """
            SELECT count(*)
            FROM gold.stop_delay_hourly
            WHERE provider_id = :p AND period_start_utc = :old_hour
            """
        ),
        {"p": PROVIDER, "old_hour": old_hour},
    ).scalar_one()
    assert after == before
    assert after["severe_delay_count"] == 1
    assert stop_count == 1


def test_citizen_closed_dates_untouched(
    conn, monkeypatch: pytest.MonkeyPatch
) -> None:  # noqa: ANN001
    closed_date = date(2026, 5, 1)
    conn.execute(
        text(
            """
            INSERT INTO gold.citizen_accountability_daily
                (provider_id, provider_local_date, affected_route_count,
                 affected_stop_count, delayed_trip_count, severe_delay_count,
                 alert_count, rider_impact_score, built_at_utc)
            VALUES (:p, :d, 1, 2, 3, 7, 0, 27.0, :built_at)
            """
        ),
        {"p": PROVIDER, "d": closed_date, "built_at": BUILT_OLD},
    )
    before = _row(
        conn,
        "SELECT * FROM gold.citizen_accountability_daily WHERE provider_id = :p",
        {"p": PROVIDER},
    )

    _run_build(conn, monkeypatch, BUILT_T)

    after = _row(
        conn,
        "SELECT * FROM gold.citizen_accountability_daily WHERE provider_id = :p",
        {"p": PROVIDER},
    )
    assert after == before


def test_0033_backfill_matches_fact_counts(conn) -> None:  # noqa: ANN001
    period = BUILT_T - timedelta(hours=1)
    bucket = period.replace(minute=0, second=0, microsecond=0)
    _insert_5m(conn, period=bucket, severe=0)
    _insert_trip_fact(
        conn,
        captured_at=bucket + timedelta(minutes=1),
        snapshot_id=BASE_SNAPSHOT_ID + 10,
        entity_index=0,
        delay_seconds=400,
        trip_id="late-backfill",
    )
    _insert_trip_fact(
        conn,
        captured_at=bucket + timedelta(minutes=2),
        snapshot_id=BASE_SNAPSHOT_ID + 11,
        entity_index=0,
        delay_seconds=25622,
        trip_id="ghost-backfill",
    )

    conn.execute(text(_migration_0033()._BACKFILL_SEVERE_DELAY_OBSERVATION_COUNTS))

    severe = conn.execute(
        text(
            """
            SELECT severe_delay_observation_count
            FROM gold.trip_delay_summary_5m
            WHERE provider_id = :p AND period_start_utc = :bucket
            """
        ),
        {"p": PROVIDER, "bucket": bucket},
    ).scalar_one()
    assert severe == 1


def test_boundary_hour_not_partially_rebuilt(
    conn, monkeypatch: pytest.MonkeyPatch
) -> None:  # noqa: ANN001
    cutoff = BUILT_T.replace(minute=0, second=0, microsecond=0) - timedelta(days=10)
    sentinel_hour = cutoff - timedelta(hours=1)
    _insert_5m(conn, period=cutoff, severe=1)
    _insert_5m(conn, period=cutoff + timedelta(minutes=5), route_id="52", severe=2)
    conn.execute(
        text(
            """
            INSERT INTO gold.route_delay_hourly
                (provider_id, period_start_utc, route_id, trip_count, observation_count,
                 delay_observation_count, on_time_observation_count, avg_delay_seconds,
                 max_delay_seconds, delayed_trip_count, severe_delay_count, built_at_utc)
            VALUES (:p, :hour, :route_id, 99, 99, 99, 0, 99.0, 99, 0, 99, :built_at)
            """
        ),
        {"p": PROVIDER, "hour": sentinel_hour, "route_id": ROUTE, "built_at": BUILT_OLD},
    )

    _run_build(conn, monkeypatch, BUILT_T)

    frozen = _row(
        conn,
        """
        SELECT severe_delay_count, built_at_utc
        FROM gold.route_delay_hourly
        WHERE provider_id = :p AND period_start_utc = :hour
        """,
        {"p": PROVIDER, "hour": sentinel_hour},
    )
    rebuilt = conn.execute(
        text(
            """
            SELECT SUM(severe_delay_count)::integer
            FROM gold.route_delay_hourly
            WHERE provider_id = :p AND period_start_utc = :hour
            """
        ),
        {"p": PROVIDER, "hour": cutoff},
    ).scalar_one()
    assert frozen["severe_delay_count"] == 99
    assert frozen["built_at_utc"] == BUILT_OLD
    assert rebuilt == 3


def test_rebuild_idempotent_under_pinned_clock(
    conn, monkeypatch: pytest.MonkeyPatch
) -> None:  # noqa: ANN001
    captured_at = BUILT_T - timedelta(hours=3)
    _insert_trip_fact(
        conn,
        captured_at=captured_at,
        snapshot_id=BASE_SNAPSHOT_ID + 20,
        entity_index=0,
        delay_seconds=400,
        trip_id="late-idempotent",
    )
    _insert_vehicle_fact(
        conn,
        captured_at=captured_at,
        snapshot_id=BASE_SNAPSHOT_ID + 21,
        entity_index=0,
        trip_id="late-idempotent",
    )

    _run_build(conn, monkeypatch, BUILT_T)
    before = {
        table: _checksum(conn, table)
        for table in (
            "route_delay_hourly",
            "stop_delay_hourly",
            "citizen_accountability_daily",
        )
    }
    _run_build(conn, monkeypatch, BUILT_T)
    after = {
        table: _checksum(conn, table)
        for table in (
            "route_delay_hourly",
            "stop_delay_hourly",
            "citizen_accountability_daily",
        )
    }
    assert after == before


def test_window_edge_advance_freezes_exactly_one_hour(
    conn, monkeypatch: pytest.MonkeyPatch
) -> None:  # noqa: ANN001
    cutoff_t = BUILT_T.replace(minute=0, second=0, microsecond=0) - timedelta(days=10)
    cutoff_t_plus_1h = cutoff_t + timedelta(hours=1)
    _insert_5m(conn, period=cutoff_t, severe=1)
    _insert_5m(conn, period=cutoff_t_plus_1h, route_id="52", severe=1)

    _run_build(conn, monkeypatch, BUILT_T)
    first_hour_built_at = conn.execute(
        text(
            """
            SELECT built_at_utc
            FROM gold.route_delay_hourly
            WHERE provider_id = :p AND period_start_utc = :hour AND route_id = :route_id
            """
        ),
        {"p": PROVIDER, "hour": cutoff_t, "route_id": ROUTE},
    ).scalar_one()

    _run_build(conn, monkeypatch, BUILT_T + timedelta(hours=1))
    rows = conn.execute(
        text(
            """
            SELECT route_id, built_at_utc
            FROM gold.route_delay_hourly
            WHERE provider_id = :p
              AND period_start_utc IN (:first_hour, :second_hour)
            ORDER BY period_start_utc, route_id
            """
        ),
        {
            "p": PROVIDER,
            "first_hour": cutoff_t,
            "second_hour": cutoff_t_plus_1h,
        },
    ).mappings().all()

    assert rows[0]["route_id"] == ROUTE
    assert rows[0]["built_at_utc"] == first_hour_built_at
    assert rows[1]["route_id"] == "52"
    assert rows[1]["built_at_utc"] == BUILT_T + timedelta(hours=1)
