"""Real-database regressions for per-stop delay attribution and stop rollups.

These tests run only against a disposable Postgres database migrated to head:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_stop_delay_real_db_regression.py -v

Never point this at production.
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
import time
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.pool import NullPool

from transit_ops.gold import marts, rollups
from transit_ops.snapshots.builders.historic.small_surfaces import _RECEIPTS_WORST_STOP_SQL
from transit_ops.snapshots.builders.historic.stop_reliability import _STOP_HABIT_SQL

PROVIDER = "stm_stopdelay_test"
STATIC_ENDPOINT_ID = 993401
TRIP_ENDPOINT_ID = 993402
STATIC_RUN_ID = 993500
TRIP_RUN_ID = 993501
SNAPSHOT_ID = 993600
RT_FEED_SNAPSHOT_ID = 993700
DATASET_VERSION_ID = 993800
BUILT_AT = datetime(2026, 6, 12, 13, 0, tzinfo=UTC)
PERIOD = datetime(2026, 6, 12, 12, 15, tzinfo=UTC)


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _ensure_delay_stop_columns(connection)
        _seed_provider(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _ensure_delay_stop_columns(connection) -> None:  # noqa: ANN001
    for table_name in ("fact_trip_delay_snapshot", "latest_trip_delay_snapshot"):
        connection.execute(
            text(
                f"""
                ALTER TABLE gold.{table_name}
                ADD COLUMN IF NOT EXISTS delay_stop_id text
                """
            )
        )
        connection.execute(
            text(
                f"""
                ALTER TABLE gold.{table_name}
                ADD COLUMN IF NOT EXISTS delay_stop_sequence integer
                """
            )
        )


def _seed_provider(connection, seed_provider) -> None:  # noqa: ANN001
    seed_provider(connection, PROVIDER, display_name="STM stop-delay regression")
    endpoints = [
        (STATIC_ENDPOINT_ID, "static_schedule", "static_schedule", "gtfs_schedule_zip"),
        (TRIP_ENDPOINT_ID, "trip_updates", "trip_updates", "gtfs_rt_trip_updates"),
    ]
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:endpoint_id, :p, :endpoint_key, :feed_kind, :source_format)
            """
        ),
        [
            {
                "endpoint_id": endpoint_id,
                "p": PROVIDER,
                "endpoint_key": endpoint_key,
                "feed_kind": feed_kind,
                "source_format": source_format,
            }
            for endpoint_id, endpoint_key, feed_kind, source_format in endpoints
        ],
    )


def _seed_raw_snapshot(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :p, :endpoint_id, 'trip_updates', 'succeeded')
            """
        ),
        {"run_id": TRIP_RUN_ID, "p": PROVIDER, "endpoint_id": TRIP_ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id,
                 feed_timestamp_utc, entity_count, captured_at_utc)
            VALUES (:snapshot_id, :run_id, :p, :endpoint_id, :captured, 0, :captured)
            """
        ),
        {
            "snapshot_id": SNAPSHOT_ID,
            "run_id": TRIP_RUN_ID,
            "p": PROVIDER,
            "endpoint_id": TRIP_ENDPOINT_ID,
            "captured": PERIOD,
        },
    )


def _insert_trip_delay_fact(
    connection,  # noqa: ANN001
    *,
    entity_index: int,
    stop_id: str | None,
    stop_sequence: int,
    delay_seconds: int | None,
    route_id: str = "51",
    captured_at: datetime = PERIOD,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count,
                 delay_stop_id, delay_stop_sequence)
            VALUES
                (:p, :snapshot_id, :entity_index, 20260612, :local_date,
                 :captured, :captured, :entity_id, :trip_id, :route_id, 0,
                 :local_date, :vehicle_id, 0, :delay, 1, :stop_id, :stop_sequence)
            """
        ),
        {
            "p": PROVIDER,
            "snapshot_id": SNAPSHOT_ID,
            "entity_index": entity_index,
            "local_date": date(2026, 6, 12),
            "captured": captured_at,
            "entity_id": f"E{entity_index}",
            "trip_id": f"T{entity_index}",
            "route_id": route_id,
            "vehicle_id": f"V{entity_index}",
            "delay": delay_seconds,
            "stop_id": stop_id,
            "stop_sequence": stop_sequence,
        },
    )


def _run_stop_hourly_rollup(connection, *, built_at: datetime = BUILT_AT) -> tuple[int, int]:  # noqa: ANN001
    connection.execute(text("DROP TABLE IF EXISTS stop_delay_hourly_source_summary"))
    params = {"provider_id": PROVIDER, "built_at_utc": built_at, "open_window_days": 10}
    connection.execute(rollups.SET_STOP_DELAY_HOURLY_WORK_MEM)
    assert connection.execute(
        rollups.TRY_STOP_DELAY_HOURLY_LOCK,
        {"provider_id": PROVIDER},
    ).scalar_one()
    connection.execute(rollups.CREATE_STOP_DELAY_HOURLY_SOURCE_SUMMARY, params)
    connection.execute(rollups.ANALYZE_STOP_DELAY_HOURLY_SOURCE_SUMMARY)
    deleted = connection.execute(
        rollups.DELETE_REPORTING_AGGREGATES["stop_delay_hourly"], params
    ).rowcount
    changed = connection.execute(
        rollups.REPORTING_AGGREGATE_UPSERTS["stop_delay_hourly"], params
    ).rowcount
    return max(deleted or 0, 0), max(changed or 0, 0)


LEGACY_STOP_DELAY_HOURLY_INSERT = text(
    f"""
    INSERT INTO gold.stop_delay_hourly (
        provider_id, period_start_utc, stop_id, route_id, observation_count,
        avg_arrival_delay_seconds, avg_departure_delay_seconds,
        severe_delay_count, built_at_utc
    )
    SELECT
        f.provider_id,
        date_trunc('hour', f.captured_at_utc),
        f.delay_stop_id,
        COALESCE(f.route_id, '__unrouted__'),
        COUNT(*)::integer,
        ROUND(AVG(f.delay_seconds::numeric), 2),
        ROUND(AVG(f.delay_seconds::numeric), 2),
        COUNT(*) FILTER (
            WHERE f.delay_seconds > 300
              AND ABS(f.delay_seconds) <= 3600
        )::integer,
        :built_at_utc
    FROM gold.fact_trip_delay_snapshot AS f
    WHERE f.provider_id = :provider_id
      AND f.delay_stop_id IS NOT NULL
      AND f.delay_seconds IS NOT NULL
      AND ABS(f.delay_seconds) <= 3600
      AND f.captured_at_utc >= {rollups.OPEN_WINDOW_HOURLY_CUTOFF_SQL}
    GROUP BY 1, 2, 3, 4
    """
)


def _run_legacy_stop_hourly_rollup(connection, *, built_at: datetime) -> None:  # noqa: ANN001
    params = {"provider_id": PROVIDER, "built_at_utc": BUILT_AT, "open_window_days": 10}
    params["built_at_utc"] = built_at
    connection.execute(
        text(
            f"""
            DELETE FROM gold.stop_delay_hourly
            WHERE provider_id = :provider_id
              AND period_start_utc >= {rollups.OPEN_WINDOW_HOURLY_CUTOFF_SQL}
            """
        ),
        params,
    )
    connection.execute(LEGACY_STOP_DELAY_HOURLY_INSERT, params)


def _refresh_citizen_accountability(connection, *, built_at: datetime) -> None:  # noqa: ANN001
    params = {"provider_id": PROVIDER, "built_at_utc": built_at, "open_window_days": 10}
    connection.execute(rollups.DELETE_REPORTING_AGGREGATES["citizen_accountability_daily"], params)
    connection.execute(rollups.UPSERT_CITIZEN_ACCOUNTABILITY_DAILY, params)


def _seed_stop_rollup_facts(connection) -> None:  # noqa: ANN001
    _seed_raw_snapshot(connection)
    for entity_index in range(1, 5):
        _insert_trip_delay_fact(
            connection,
            entity_index=entity_index,
            stop_id="SA",
            stop_sequence=1,
            delay_seconds=600,
        )
    for entity_index in range(5, 7):
        _insert_trip_delay_fact(
            connection,
            entity_index=entity_index,
            stop_id="SB",
            stop_sequence=2,
            delay_seconds=30,
        )
    _insert_trip_delay_fact(
        connection,
        entity_index=7,
        stop_id="SC",
        stop_sequence=3,
        delay_seconds=25000,
    )


def test_stop_delay_hourly_severe_is_per_stop_not_route_max(conn) -> None:  # noqa: ANN001
    _seed_stop_rollup_facts(conn)
    _run_stop_hourly_rollup(conn)

    rows = {
        row["stop_id"]: row
        for row in conn.execute(
            text(
                """
                SELECT stop_id, observation_count, severe_delay_count,
                       avg_arrival_delay_seconds
                FROM gold.stop_delay_hourly
                WHERE provider_id = :p
                ORDER BY stop_id
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    }

    assert rows["SB"]["observation_count"] == 2
    assert rows["SB"]["severe_delay_count"] == 0
    assert float(rows["SB"]["avg_arrival_delay_seconds"]) == 30.0
    assert rows["SA"]["severe_delay_count"] == 4
    assert "SC" not in rows


def _relation_values(connection, relation: str) -> list[str]:  # noqa: ANN001
    return list(
        connection.execute(
            text(
                f"""
                SELECT (to_jsonb(row_value) - 'built_at_utc')::text
                FROM (
                    SELECT * FROM gold.{relation} WHERE provider_id = :p
                ) AS row_value
                ORDER BY 1
                """
            ),
            {"p": PROVIDER},
        ).scalars()
    )


def _consumer_values(connection) -> dict[str, list]:  # noqa: ANN001
    receipt_params = {
        "provider_id": PROVIDER,
        "receipt_start": date(2026, 6, 12),
        "receipt_end": date(2026, 6, 12),
    }
    return {
        "public_stop_delay_daily": _relation_values(connection, "public_stop_delay_daily"),
        "citizen_accountability_daily": _relation_values(
            connection, "citizen_accountability_daily"
        ),
        "worst_stop": [
            tuple(row)
            for row in connection.execute(_RECEIPTS_WORST_STOP_SQL, receipt_params).all()
        ],
        "stop_habits": [
            tuple(row)
            for row in connection.execute(
                _STOP_HABIT_SQL,
                {"provider_id": PROVIDER},
            ).all()
        ],
    }


def test_stop_delay_differential_matches_legacy_across_corrections_and_consumers(
    conn,  # noqa: ANN001
) -> None:
    _seed_raw_snapshot(conn)
    initial_facts = (
        (1, "S_DELAY", 100, "51", PERIOD),
        (2, "S_MOVE", 200, "51", PERIOD),
        (3, "S_ROUTE", 200, "51", PERIOD),
        (4, "S_HOUR", 200, "51", PERIOD),
        (5, "S_NULL", 200, "51", PERIOD),
        (6, "S_GHOST", 200, "51", PERIOD),
        (7, "S_VANISH", 200, "51", PERIOD),
        (8, None, 200, "51", PERIOD),
        (9, "S_UNCHANGED", 50, "51", PERIOD),
    )
    for entity_index, stop_id, delay, route_id, captured_at in initial_facts:
        _insert_trip_delay_fact(
            conn,
            entity_index=entity_index,
            stop_id=stop_id,
            stop_sequence=entity_index,
            delay_seconds=delay,
            route_id=route_id,
            captured_at=captured_at,
        )

    _run_stop_hourly_rollup(conn, built_at=BUILT_AT)
    frozen_hour = BUILT_AT - timedelta(days=11)
    conn.execute(
        text(
            """
            INSERT INTO gold.stop_delay_hourly (
                provider_id, period_start_utc, stop_id, route_id, observation_count,
                avg_arrival_delay_seconds, avg_departure_delay_seconds,
                severe_delay_count, built_at_utc
            ) VALUES (:p, :hour, 'S_FROZEN', '51', 1, 999, 999, 1, :built)
            """
        ),
        {"p": PROVIDER, "hour": frozen_hour, "built": BUILT_AT},
    )
    frozen_before = conn.execute(
        text(
            """
            SELECT (to_jsonb(row_value) - 'built_at_utc')::text
            FROM gold.stop_delay_hourly AS row_value
            WHERE provider_id = :p AND stop_id = 'S_FROZEN'
            """
        ),
        {"p": PROVIDER},
    ).scalar_one()

    conn.execute(
        text(
            """
            UPDATE gold.fact_trip_delay_snapshot
            SET delay_seconds = CASE entity_index
                    WHEN 1 THEN 500
                    WHEN 5 THEN NULL
                    WHEN 6 THEN 4001
                    ELSE delay_seconds
                END,
                delay_stop_id = CASE entity_index
                    WHEN 2 THEN 'S_MOVED'
                    WHEN 8 THEN 'S_NEW'
                    ELSE delay_stop_id
                END,
                route_id = CASE WHEN entity_index = 3 THEN '52' ELSE route_id END,
                captured_at_utc = CASE
                    WHEN entity_index = 4 THEN captured_at_utc + interval '1 hour'
                    ELSE captured_at_utc
                END
            WHERE provider_id = :p
            """
        ),
        {"p": PROVIDER},
    )
    conn.execute(
        text(
            """
            DELETE FROM gold.fact_trip_delay_snapshot
            WHERE provider_id = :p AND entity_index = 7
            """
        ),
        {"p": PROVIDER},
    )

    conn.execute(
        text(
            """
            CREATE TEMP TABLE initial_stop_delay_target ON COMMIT DROP AS
            SELECT * FROM gold.stop_delay_hourly
            WHERE provider_id = :p AND period_start_utc >= :cutoff
            """
        ),
        {"p": PROVIDER, "cutoff": BUILT_AT - timedelta(days=10)},
    )

    corrected_at = BUILT_AT + timedelta(hours=1)
    _run_legacy_stop_hourly_rollup(conn, built_at=corrected_at)
    _refresh_citizen_accountability(conn, built_at=corrected_at)
    expected_values = _relation_values(conn, "stop_delay_hourly")
    expected_consumers = _consumer_values(conn)

    conn.execute(
        text(
            """
            DELETE FROM gold.stop_delay_hourly
            WHERE provider_id = :p AND period_start_utc >= :cutoff
            """
        ),
        {"p": PROVIDER, "cutoff": BUILT_AT - timedelta(days=10)},
    )
    conn.execute(
        text("INSERT INTO gold.stop_delay_hourly SELECT * FROM initial_stop_delay_target")
    )
    conn.execute(
        text("DELETE FROM gold.citizen_accountability_daily WHERE provider_id = :p"),
        {"p": PROVIDER},
    )

    deleted, changed = _run_stop_hourly_rollup(conn, built_at=corrected_at)
    _refresh_citizen_accountability(conn, built_at=corrected_at)

    assert deleted == 6
    assert changed == 5
    assert _relation_values(conn, "stop_delay_hourly") == expected_values
    assert _consumer_values(conn) == expected_consumers
    assert frozen_before in _relation_values(conn, "stop_delay_hourly")

    keys = set(
        conn.execute(
            text(
                """
                SELECT stop_id, route_id, period_start_utc
                FROM gold.stop_delay_hourly
                WHERE provider_id = :p
                """
            ),
            {"p": PROVIDER},
        ).all()
    )
    assert not any(stop_id in {"S_MOVE", "S_NULL", "S_GHOST", "S_VANISH"} for stop_id, _, _ in keys)
    assert any(stop_id == "S_MOVED" for stop_id, _, _ in keys)
    assert any(stop_id == "S_NEW" for stop_id, _, _ in keys)
    assert any(stop_id == "S_ROUTE" and route_id == "52" for stop_id, route_id, _ in keys)
    assert any(
        stop_id == "S_HOUR" and hour.astimezone(UTC).hour == 13
        for stop_id, _, hour in keys
    )

    unchanged_before = conn.execute(
        text(
            """
            SELECT xmin::text, ctid::text, built_at_utc
            FROM gold.stop_delay_hourly
            WHERE provider_id = :p AND stop_id = 'S_UNCHANGED'
            """
        ),
        {"p": PROVIDER},
    ).one()
    assert unchanged_before.built_at_utc == BUILT_AT
    assert _run_stop_hourly_rollup(conn, built_at=corrected_at + timedelta(hours=1)) == (0, 0)
    unchanged_after = conn.execute(
        text(
            """
            SELECT xmin::text, ctid::text, built_at_utc
            FROM gold.stop_delay_hourly
            WHERE provider_id = :p AND stop_id = 'S_UNCHANGED'
            """
        ),
        {"p": PROVIDER},
    ).one()
    assert unchanged_after == unchanged_before


def test_terminated_client_rolls_back_active_dml_and_removes_named_backend(
    real_db_engine,  # noqa: ANN001
) -> None:
    application_name = f"dwr-test-stop-{secrets.token_hex(8)}"
    assert application_name.isascii() and len(application_name.encode("ascii")) <= 63
    timeout_provider = "stm_rollup_timeout_test"
    child = '''
import os
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

engine = create_engine(
    os.environ["TEST_DATABASE_URL"],
    poolclass=NullPool,
    connect_args={"application_name": os.environ["TEST_APPLICATION_NAME"]},
)
try:
    with engine.begin() as connection:
        connection.execute(text("SET LOCAL statement_timeout = '2s'"))
        connection.execute(text("SET LOCAL lock_timeout = '100ms'"))
        connection.execute(
            text(
                """
                INSERT INTO core.providers
                    (provider_id, display_name, timezone, provider_key)
                SELECT :provider, 'Timeout rollback probe', 'America/Toronto', :provider
                FROM (SELECT pg_sleep(5)) AS delayed
                """
            ),
            {"provider": os.environ["TEST_PROVIDER"]},
        )
finally:
    engine.dispose()
'''
    environment = os.environ.copy()
    environment.update(
        {
            "TEST_APPLICATION_NAME": application_name,
            "TEST_DATABASE_URL": real_db_engine.url.render_as_string(hide_password=False),
            "TEST_PROVIDER": timeout_provider,
        }
    )
    active_backend = None
    process = subprocess.Popen([sys.executable, "-c", child], env=environment)
    try:
        deadline = time.monotonic() + 3
        with real_db_engine.connect() as monitor:
            while time.monotonic() < deadline:
                monitor.execute(text("SELECT pg_stat_clear_snapshot()"))
                active_backend = monitor.execute(
                    text(
                        """
                        SELECT pid, backend_start
                        FROM pg_stat_activity
                        WHERE application_name = :name
                          AND state = 'active'
                          AND query LIKE '%INSERT INTO core.providers%'
                        """
                    ),
                    {"name": application_name},
                ).one_or_none()
                if active_backend is not None:
                    break
                time.sleep(0.02)
        assert active_backend is not None

        process.kill()
        process.wait(timeout=3)

        deadline = time.monotonic() + 3
        with real_db_engine.connect() as monitor:
            while time.monotonic() < deadline:
                monitor.execute(text("SELECT pg_stat_clear_snapshot()"))
                remaining = monitor.execute(
                    text("SELECT COUNT(*) FROM pg_stat_activity WHERE application_name = :name"),
                    {"name": application_name},
                ).scalar_one()
                if remaining == 0:
                    break
                time.sleep(0.02)
            assert remaining == 0
            assert monitor.execute(
                text("SELECT COUNT(*) FROM core.providers WHERE provider_id = :provider"),
                {"provider": timeout_provider},
            ).scalar_one() == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=3)
        with real_db_engine.begin() as cleanup:
            if active_backend is not None:
                cleanup.execute(
                    text(
                        """
                        SELECT pg_terminate_backend(pid)
                        FROM pg_stat_activity
                        WHERE pid = :pid
                          AND backend_start = :backend_start
                          AND application_name = :name
                        """
                    ),
                    {
                        "pid": active_backend.pid,
                        "backend_start": active_backend.backend_start,
                        "name": application_name,
                    },
                ).scalar_one_or_none()
            cleanup.execute(
                text("DELETE FROM core.providers WHERE provider_id = :provider"),
                {"provider": timeout_provider},
            )


def test_rollup_statement_timeout_is_57014_and_nullpool_rolls_back(
    real_db_engine,  # noqa: ANN001
) -> None:
    application_name = f"dwr-test-57014-{secrets.token_hex(8)}"
    timeout_provider = "stm_rollup_57014_test"
    isolated_engine = create_engine(
        real_db_engine.url,
        poolclass=NullPool,
        connect_args={"application_name": application_name},
    )
    connection = isolated_engine.connect()
    transaction = connection.begin()
    try:
        connection.execute(text("SET LOCAL statement_timeout = '25ms'"))
        connection.execute(text("SET LOCAL lock_timeout = '50ms'"))
        connection.execute(
            text(
                """
                INSERT INTO core.providers
                    (provider_id, display_name, timezone, provider_key)
                VALUES (:provider, 'Timeout rollback probe', 'America/Toronto', :provider)
                """
            ),
            {"provider": timeout_provider},
        )
        with pytest.raises(DBAPIError) as timeout_error:
            connection.execute(text("SELECT pg_sleep(0.2)"))
        assert timeout_error.value.orig.sqlstate == "57014"
    finally:
        transaction.rollback()
        connection.close()
        isolated_engine.dispose()

    with real_db_engine.connect() as monitor:
        assert monitor.execute(
            text("SELECT COUNT(*) FROM core.providers WHERE provider_id = :provider"),
            {"provider": timeout_provider},
        ).scalar_one() == 0
        assert monitor.execute(
            text("SELECT COUNT(*) FROM pg_stat_activity WHERE application_name = :name"),
            {"name": application_name},
        ).scalar_one() == 0


def test_rollup_lock_timeout_and_advisory_probe_fail_fast(real_db_engine) -> None:  # noqa: ANN001
    holder = real_db_engine.connect()
    contender = real_db_engine.connect()
    holder_transaction = holder.begin()
    contender_transaction = contender.begin()
    try:
        holder.execute(
            text(
                """
                SELECT pg_advisory_xact_lock(
                    hashtext('transit.warm_rollup.stop_delay_hourly'), hashtext('stm')
                )
                """
            )
        )
        contender.execute(text("SET LOCAL statement_timeout = '1s'"))
        contender.execute(text("SET LOCAL lock_timeout = '50ms'"))
        started = time.perf_counter()
        with pytest.raises(DBAPIError) as lock_error:
            contender.execute(
                text(
                    """
                    SELECT pg_advisory_xact_lock(
                        hashtext('transit.warm_rollup.stop_delay_hourly'), hashtext('stm')
                    )
                    """
                )
            )
        assert lock_error.value.orig.sqlstate == "55P03"
        assert time.perf_counter() - started < 0.5
        contender_transaction.rollback()

        contender_transaction = contender.begin()
        assert contender.execute(
            rollups.TRY_STOP_DELAY_HOURLY_LOCK,
            {"provider_id": "stm"},
        ).scalar_one() is False
    finally:
        contender_transaction.rollback()
        holder_transaction.rollback()
        contender.close()
        holder.close()

    with real_db_engine.begin() as released:
        assert released.execute(
            rollups.TRY_STOP_DELAY_HOURLY_LOCK,
            {"provider_id": "stm"},
        ).scalar_one() is True


def _seed_static_schedule(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :p, :endpoint_id, 'static_schedule', 'succeeded')
            """
        ),
        {"run_id": STATIC_RUN_ID, "p": PROVIDER, "endpoint_id": STATIC_ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.dataset_versions
                (dataset_version_id, provider_id, feed_endpoint_id,
                 source_ingestion_run_id, dataset_kind, content_hash, is_current)
            VALUES (:dataset_version_id, :p, :endpoint_id, :run_id,
                    'static_schedule', 'stop-delay-static', true)
            """
        ),
        {
            "dataset_version_id": DATASET_VERSION_ID,
            "p": PROVIDER,
            "endpoint_id": STATIC_ENDPOINT_ID,
            "run_id": STATIC_RUN_ID,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.routes
                (dataset_version_id, provider_id, route_id, route_type)
            VALUES (:dataset_version_id, :p, '51', 3)
            """
        ),
        {"dataset_version_id": DATASET_VERSION_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.stops
                (dataset_version_id, provider_id, stop_id, stop_name)
            VALUES
                (:dataset_version_id, :p, 'S1', 'Stop 1'),
                (:dataset_version_id, :p, 'S2', 'Stop 2')
            """
        ),
        {"dataset_version_id": DATASET_VERSION_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.trips
                (dataset_version_id, provider_id, trip_id, route_id, service_id)
            VALUES (:dataset_version_id, :p, 'T_ATTR', '51', 'WK')
            """
        ),
        {"dataset_version_id": DATASET_VERSION_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.stop_times
                (dataset_version_id, provider_id, trip_id, stop_sequence,
                 stop_id, arrival_time, departure_time)
            VALUES
                (:dataset_version_id, :p, 'T_ATTR', 1, 'S1', '08:00:00', '08:00:00'),
                (:dataset_version_id, :p, 'T_ATTR', 2, 'S2', '08:08:00', '08:08:00')
            """
        ),
        {"dataset_version_id": DATASET_VERSION_ID, "p": PROVIDER},
    )


def _seed_trip_update_with_past_and_future_stops(connection) -> None:  # noqa: ANN001
    _seed_raw_snapshot(connection)
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_feed_snapshots
                (rt_feed_snapshot_id, provider_id, feed_endpoint_id, ingestion_run_id,
                 endpoint_key, feed_timestamp_utc, captured_at_utc,
                 source_realtime_snapshot_id)
            VALUES
                (:rt_snapshot, :p, :endpoint_id, :run_id, 'trip_updates',
                 :feed_ts, :feed_ts, :source_snapshot)
            """
        ),
        {
            "rt_snapshot": RT_FEED_SNAPSHOT_ID,
            "p": PROVIDER,
            "endpoint_id": TRIP_ENDPOINT_ID,
            "run_id": TRIP_RUN_ID,
            "feed_ts": datetime(2026, 6, 12, 12, 5, tzinfo=UTC),
            "source_snapshot": SNAPSHOT_ID,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_entities
                (rt_feed_snapshot_id, entity_index, provider_id, entity_id, entity_kind)
            VALUES (:rt_snapshot, 1, :p, 'E_ATTR', 'trip_update')
            """
        ),
        {"rt_snapshot": RT_FEED_SNAPSHOT_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_updates
                (rt_feed_snapshot_id, entity_index, provider_id, trip_id, route_id,
                 direction_id, start_date, schedule_relationship,
                 feed_timestamp_utc, captured_at_utc)
            VALUES
                (:rt_snapshot, 1, :p, 'T_ATTR', '51', 0, :start_date, 0,
                 :feed_ts, :feed_ts)
            """
        ),
        {
            "rt_snapshot": RT_FEED_SNAPSHOT_ID,
            "p": PROVIDER,
            "start_date": date(2026, 6, 12),
            "feed_ts": datetime(2026, 6, 12, 12, 5, tzinfo=UTC),
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_update_stop_times
                (rt_feed_snapshot_id, entity_index, stop_time_update_index,
                 provider_id, stop_sequence, stop_id, arrival_time_utc,
                 departure_time_utc, schedule_relationship)
            VALUES
                (:rt_snapshot, 1, 1, :p, 1, 'S1', :past_ts, :past_ts, 0),
                (:rt_snapshot, 1, 2, :p, 2, 'S2', :future_ts, :future_ts, 0)
            """
        ),
        {
            "rt_snapshot": RT_FEED_SNAPSHOT_ID,
            "p": PROVIDER,
            "past_ts": datetime(2026, 6, 12, 12, 1, tzinfo=UTC),
            "future_ts": datetime(2026, 6, 12, 12, 10, tzinfo=UTC),
        },
    )


def test_refresh_attributes_delay_to_next_upcoming_stop(conn) -> None:  # noqa: ANN001
    _seed_static_schedule(conn)
    _seed_trip_update_with_past_and_future_stops(conn)

    conn.execute(
        marts.UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST,
        {
            "provider_id": PROVIDER,
            "provider_timezone": "America/Toronto",
            "dataset_version_id": DATASET_VERSION_ID,
            "realtime_snapshot_id": SNAPSHOT_ID,
        },
    )

    row = (
        conn.execute(
            text(
                """
            SELECT delay_seconds, delay_stop_id, delay_stop_sequence
            FROM gold.fact_trip_delay_snapshot
            WHERE provider_id = :p AND realtime_snapshot_id = :snapshot_id
            """
            ),
            {"p": PROVIDER, "snapshot_id": SNAPSHOT_ID},
        )
        .mappings()
        .one()
    )

    assert row["delay_seconds"] == 120
    assert row["delay_stop_id"] == "S2"
    assert row["delay_stop_sequence"] == 2
