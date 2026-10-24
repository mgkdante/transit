from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from pathlib import Path

import real_db_seed as db_seed
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from transit_ops.maintenance import (
    COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
    SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
)
from transit_ops.settings import get_settings

DB_ROOT = Path(__file__).resolve().parents[1]


def _alembic_config(database_url: str) -> Config:
    config = Config(str(DB_ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location",
        str(DB_ROOT / "src" / "transit_ops" / "db" / "migrations"),
    )
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_embedded_alembic_uses_disposable_url_when_settings_are_cached(
    real_db_engine,
    monkeypatch,
) -> None:
    database_url = real_db_engine.url.render_as_string(hide_password=False)
    stale_database_url = "postgresql+psycopg://sentinel:sentinel@127.0.0.1:1/stale"
    get_settings.cache_clear()
    try:
        monkeypatch.setenv("DATABASE_URL", stale_database_url)
        cached_settings = get_settings()
        assert cached_settings.sqlalchemy_database_url == stale_database_url
        monkeypatch.setenv("DATABASE_URL", database_url)
        assert get_settings() is cached_settings
        assert get_settings().sqlalchemy_database_url == stale_database_url
        config = _alembic_config(database_url)
        assert config.get_main_option("sqlalchemy.url") == database_url
        command.current(config)
    finally:
        get_settings.cache_clear()


def test_embedded_alembic_preserves_existing_application_loggers(real_db_engine) -> None:
    logger = logging.getLogger("transit_ops.orchestration")
    previous_disabled = logger.disabled
    logger.disabled = False
    try:
        database_url = real_db_engine.url.render_as_string(hide_password=False)
        command.current(_alembic_config(database_url))
        assert logger.disabled is False
    finally:
        logger.disabled = previous_disabled


EXPECTED_INDEXES = {
    ("gold", "ix_gold_ftds_realtime_snapshot_id"),
    ("gold", "ix_gold_fvs_realtime_snapshot_id"),
    ("raw", "ix_raw_rsi_ingestion_object_id"),
}
PERF_PROVIDER = "retention_index_perf_test"
PERF_ENDPOINT_ID = 8_600_000_001
PERF_BASE_ID = 8_600_000_000
PERF_OBJECT_COUNT = 30_000
PERF_SILVER_COUNT = 2_000
PERF_GOLD_COUNT = 300_000
PERF_CUTOFF = datetime(2027, 1, 1, tzinfo=UTC)


def _index_state(connection) -> dict[tuple[str, str], tuple[bool, bool]]:
    rows = connection.execute(
        text(
            """
            SELECT namespace.nspname,
                   index_relation.relname,
                   index_state.indisready,
                   index_state.indisvalid
            FROM pg_index index_state
            JOIN pg_class index_relation
              ON index_relation.oid = index_state.indexrelid
            JOIN pg_namespace namespace
              ON namespace.oid = index_relation.relnamespace
            WHERE (namespace.nspname, index_relation.relname) IN (
                ('gold', 'ix_gold_ftds_realtime_snapshot_id'),
                ('gold', 'ix_gold_fvs_realtime_snapshot_id'),
                ('raw', 'ix_raw_rsi_ingestion_object_id')
            )
            ORDER BY namespace.nspname, index_relation.relname
            """
        )
    )
    return {
        (str(schema), str(index_name)): (bool(indisready), bool(indisvalid))
        for schema, index_name, indisready, indisvalid in rows
    }


def _cleanup_perf_rows(engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id = :provider"),
            {"provider": PERF_PROVIDER},
        )
        connection.execute(
            text("DELETE FROM gold.fact_vehicle_snapshot WHERE provider_id = :provider"),
            {"provider": PERF_PROVIDER},
        )
        connection.execute(
            text("DELETE FROM silver.rt_feed_snapshots WHERE provider_id = :provider"),
            {"provider": PERF_PROVIDER},
        )
        connection.execute(
            text("DELETE FROM raw.realtime_snapshot_index WHERE provider_id = :provider"),
            {"provider": PERF_PROVIDER},
        )
        connection.execute(
            text("DELETE FROM raw.ingestion_objects WHERE provider_id = :provider"),
            {"provider": PERF_PROVIDER},
        )
        connection.execute(
            text("DELETE FROM raw.ingestion_runs WHERE provider_id = :provider"),
            {"provider": PERF_PROVIDER},
        )
        connection.execute(
            text("DELETE FROM core.feed_endpoints WHERE provider_id = :provider"),
            {"provider": PERF_PROVIDER},
        )
        connection.execute(
            text("DELETE FROM core.providers WHERE provider_id = :provider"),
            {"provider": PERF_PROVIDER},
        )


def _seed_perf_rows(engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO core.providers
                    (provider_id, provider_key, display_name, timezone)
                VALUES (:provider, :provider, 'Retention index performance test', 'UTC')
                """
            ),
            {"provider": PERF_PROVIDER},
        )
        db_seed.feed_endpoints(
            connection, {'endpoint': PERF_ENDPOINT_ID, 'provider': PERF_PROVIDER},
            feed_endpoint_id=':endpoint', provider_id=':provider',
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id,
                     run_kind, status, started_at_utc)
                SELECT :base + generated_id,
                       :provider,
                       :endpoint,
                       'trip_updates',
                       'succeeded',
                       TIMESTAMPTZ '2026-01-01 00:00:00+00'
                         + generated_id * INTERVAL '1 second'
                FROM generate_series(1, :object_count) AS generated(generated_id)
                """
            ),
            {
                "base": PERF_BASE_ID,
                "provider": PERF_PROVIDER,
                "endpoint": PERF_ENDPOINT_ID,
                "object_count": PERF_OBJECT_COUNT,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_objects
                    (ingestion_object_id, ingestion_run_id, provider_id,
                     object_kind, storage_backend, storage_path)
                SELECT :base + generated_id,
                       :base + generated_id,
                       :provider,
                       'gtfs_rt_feed',
                       's3',
                       'retention-index-perf/' || generated_id || '.pb'
                FROM generate_series(1, :object_count) AS generated(generated_id)
                """
            ),
            {
                "base": PERF_BASE_ID,
                "provider": PERF_PROVIDER,
                "object_count": PERF_OBJECT_COUNT,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.realtime_snapshot_index
                    (realtime_snapshot_id, ingestion_run_id, ingestion_object_id,
                     provider_id, feed_endpoint_id, feed_timestamp_utc, captured_at_utc)
                SELECT :base + generated_id,
                       :base + generated_id,
                       :base + generated_id,
                       :provider,
                       :endpoint,
                       TIMESTAMPTZ '2026-01-01 00:00:00+00'
                         + generated_id * INTERVAL '1 second',
                       TIMESTAMPTZ '2026-01-01 00:00:00+00'
                         + generated_id * INTERVAL '1 second'
                FROM generate_series(1, :object_count) AS generated(generated_id)
                """
            ),
            {
                "base": PERF_BASE_ID,
                "provider": PERF_PROVIDER,
                "endpoint": PERF_ENDPOINT_ID,
                "object_count": PERF_OBJECT_COUNT,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO silver.rt_feed_snapshots
                    (rt_feed_snapshot_id, provider_id, feed_endpoint_id,
                     ingestion_run_id, ingestion_object_id, endpoint_key,
                     source_realtime_snapshot_id)
                SELECT :base + 100000 + generated_id,
                       :provider,
                       :endpoint,
                       :base + 5000 + generated_id,
                       :base + 5000 + generated_id,
                       'trip_updates',
                       :base + 5000 + generated_id
                FROM generate_series(1, :silver_count) AS generated(generated_id)
                """
            ),
            {
                "base": PERF_BASE_ID,
                "provider": PERF_PROVIDER,
                "endpoint": PERF_ENDPOINT_ID,
                "silver_count": PERF_SILVER_COUNT,
            },
        )
        for table_name, required_tail in (
            ("fact_trip_delay_snapshot", ", stop_time_update_count"),
            ("fact_vehicle_snapshot", ""),
        ):
            tail_value = ", 0" if required_tail else ""
            connection.execute(
                text(
                    f"""
                    INSERT INTO gold.{table_name}
                        (provider_id, realtime_snapshot_id, entity_index,
                         snapshot_date_key, snapshot_local_date,
                         feed_timestamp_utc, captured_at_utc{required_tail})
                    SELECT :provider,
                           :base + 5001 + ((generated_id - 1) % 25000),
                           ((generated_id - 1) / 25000)::integer,
                           20260101,
                           DATE '2026-01-01',
                           TIMESTAMPTZ '2026-01-01 00:00:00+00',
                           TIMESTAMPTZ '2026-01-01 00:00:00+00'{tail_value}
                    FROM generate_series(1, :gold_count) AS generated(generated_id)
                    """
                ),
                {
                    "base": PERF_BASE_ID,
                    "provider": PERF_PROVIDER,
                    "gold_count": PERF_GOLD_COUNT,
                },
            )

    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        for relation in (
            "core.feed_endpoints",
            "raw.ingestion_objects",
            "raw.realtime_snapshot_index",
            "silver.rt_feed_snapshots",
            "gold.fact_trip_delay_snapshot",
            "gold.fact_vehicle_snapshot",
        ):
            connection.execute(text(f"ANALYZE {relation}"))


def _provider_row_counts(connection) -> tuple[int, int, int, int, int]:
    return tuple(
        int(value)
        for value in connection.execute(
            text(
                """
                SELECT
                    (SELECT COUNT(*) FROM raw.ingestion_objects
                     WHERE provider_id = :provider),
                    (SELECT COUNT(*) FROM raw.realtime_snapshot_index
                     WHERE provider_id = :provider),
                    (SELECT COUNT(*) FROM silver.rt_feed_snapshots
                     WHERE provider_id = :provider),
                    (SELECT COUNT(*) FROM gold.fact_trip_delay_snapshot
                     WHERE provider_id = :provider),
                    (SELECT COUNT(*) FROM gold.fact_vehicle_snapshot
                     WHERE provider_id = :provider)
                """
            ),
            {"provider": PERF_PROVIDER},
        ).one()
    )


def _explain(connection, statement: str, parameters: dict[str, int]) -> str:
    return "\n".join(
        str(row[0])
        for row in connection.execute(text(f"EXPLAIN (COSTS OFF) {statement}"), parameters)
    )


def test_bronze_realtime_retention_uses_indexes_and_bounded_fk_delete(
    real_db_engine,
) -> None:
    candidate_object_ids = [PERF_BASE_ID + value for value in range(1, 101)]
    candidate_snapshot_ids = candidate_object_ids.copy()
    full_batch_object_ids = [PERF_BASE_ID + value for value in range(1, 5_001)]
    expected_selector_ids = full_batch_object_ids.copy()

    _cleanup_perf_rows(real_db_engine)
    try:
        _seed_perf_rows(real_db_engine)
        with real_db_engine.connect() as connection:
            assert _provider_row_counts(connection) == (
                PERF_OBJECT_COUNT,
                PERF_OBJECT_COUNT,
                PERF_SILVER_COUNT,
                PERF_GOLD_COUNT,
                PERF_GOLD_COUNT,
            )

        selector_params = {
            "provider_id": PERF_PROVIDER,
            "cutoff_utc": PERF_CUTOFF,
            "excluded_object_ids": [],
            "max_objects": 5_000,
        }
        with real_db_engine.connect() as connection:
            assert _index_state(connection) == {index: (True, True) for index in EXPECTED_INDEXES}
            trip_plan = _explain(
                connection,
                "SELECT 1 FROM gold.fact_trip_delay_snapshot "
                "WHERE realtime_snapshot_id = :snapshot_id",
                {"snapshot_id": candidate_snapshot_ids[0]},
            )
            vehicle_plan = _explain(
                connection,
                "SELECT 1 FROM gold.fact_vehicle_snapshot "
                "WHERE realtime_snapshot_id = :snapshot_id",
                {"snapshot_id": candidate_snapshot_ids[0]},
            )
            rsi_plan = _explain(
                connection,
                "SELECT realtime_snapshot_id FROM raw.realtime_snapshot_index "
                "WHERE ingestion_object_id = :object_id",
                {"object_id": candidate_object_ids[0]},
            )
            assert "ix_gold_ftds_realtime_snapshot_id" in trip_plan
            assert "ix_gold_fvs_realtime_snapshot_id" in vehicle_plan
            assert "ix_raw_rsi_ingestion_object_id" in rsi_plan

        with real_db_engine.connect() as connection:
            transaction = connection.begin()
            connection.execute(text("SET LOCAL statement_timeout = '2s'"))
            started = time.perf_counter()
            selected_object_ids = list(
                connection.execute(
                    SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
                    selector_params,
                ).scalars()
            )
            selector_elapsed_seconds = time.perf_counter() - started
            started = time.perf_counter()
            eligible_count = int(
                connection.execute(
                    COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
                    {
                        "provider_id": PERF_PROVIDER,
                        "cutoff_utc": PERF_CUTOFF,
                    },
                ).scalar_one()
            )
            count_elapsed_seconds = time.perf_counter() - started
            assert selected_object_ids == expected_selector_ids
            assert eligible_count == 5_000
            assert selector_elapsed_seconds < 2
            assert count_elapsed_seconds < 2
            transaction.rollback()

        with real_db_engine.connect() as connection:
            transaction = connection.begin()
            connection.execute(text("SET LOCAL statement_timeout = '2s'"))
            started = time.perf_counter()
            deleted_snapshot_ids = connection.execute(
                text(
                    """
                    DELETE FROM raw.realtime_snapshot_index
                    WHERE ingestion_object_id = ANY(
                        CAST(:ingestion_object_ids AS bigint[])
                    )
                    RETURNING realtime_snapshot_id
                    """
                ),
                {"ingestion_object_ids": candidate_object_ids},
            ).scalars()
            deleted_snapshot_ids = sorted(int(value) for value in deleted_snapshot_ids)
            elapsed_seconds = time.perf_counter() - started
            assert deleted_snapshot_ids == candidate_snapshot_ids
            assert elapsed_seconds < 2
            transaction.rollback()

        with real_db_engine.connect() as connection:
            transaction = connection.begin()
            connection.execute(text("SET LOCAL statement_timeout = '60s'"))
            started = time.perf_counter()
            deleted_full_batch_ids = connection.execute(
                text(
                    """
                    DELETE FROM raw.realtime_snapshot_index
                    WHERE ingestion_object_id = ANY(
                        CAST(:ingestion_object_ids AS bigint[])
                    )
                    RETURNING realtime_snapshot_id
                    """
                ),
                {"ingestion_object_ids": full_batch_object_ids},
            ).scalars()
            deleted_full_batch_ids = sorted(int(value) for value in deleted_full_batch_ids)
            full_batch_elapsed_seconds = time.perf_counter() - started
            assert deleted_full_batch_ids == full_batch_object_ids
            assert full_batch_elapsed_seconds < 60
            transaction.rollback()

        with real_db_engine.connect() as connection:
            retained_after_rollback = connection.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM raw.realtime_snapshot_index
                    WHERE realtime_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
                    """
                ),
                {"snapshot_ids": candidate_snapshot_ids},
            ).scalar_one()
            assert retained_after_rollback == 100
            retained_full_batch_after_rollback = connection.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM raw.realtime_snapshot_index
                    WHERE realtime_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
                    """
                ),
                {"snapshot_ids": full_batch_object_ids},
            ).scalar_one()
            assert retained_full_batch_after_rollback == 5_000
    finally:
        _cleanup_perf_rows(real_db_engine)
