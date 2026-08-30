"""Contract and real-PostgreSQL proof for retention-path migration 0086."""

from __future__ import annotations

import importlib
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from transit_ops.maintenance import (
    COUNT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
    SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
)

MIGRATION_MODULE = "transit_ops.db.migrations.versions.0086_daily_warm_retention_indexes"
REVISION = "0086_daily_warm_retention_indexes"
DOWN_REVISION = "0085_repair_otp_count_universe"
DB_ROOT = Path(__file__).resolve().parents[1]

EXPECTED_UPGRADE_OPERATIONS = [
    (
        "DROP INDEX CONCURRENTLY IF EXISTS gold.ix_gold_ftds_realtime_snapshot_id",
        "CREATE INDEX CONCURRENTLY ix_gold_ftds_realtime_snapshot_id "
        "ON gold.fact_trip_delay_snapshot (realtime_snapshot_id)",
    ),
    (
        "DROP INDEX CONCURRENTLY IF EXISTS gold.ix_gold_fvs_realtime_snapshot_id",
        "CREATE INDEX CONCURRENTLY ix_gold_fvs_realtime_snapshot_id "
        "ON gold.fact_vehicle_snapshot (realtime_snapshot_id)",
    ),
    (
        "DROP INDEX CONCURRENTLY IF EXISTS raw.ix_raw_rsi_ingestion_object_id",
        "CREATE INDEX CONCURRENTLY ix_raw_rsi_ingestion_object_id "
        "ON raw.realtime_snapshot_index (ingestion_object_id)",
    ),
]
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
PERF_ELIGIBLE_COUNT = 27_999

OLD_SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS = text(
    """
    SELECT io.ingestion_object_id
    FROM raw.ingestion_objects io
    JOIN raw.realtime_snapshot_index rsi
      ON rsi.ingestion_object_id = io.ingestion_object_id
    JOIN core.feed_endpoints fe
      ON fe.feed_endpoint_id = rsi.feed_endpoint_id
    WHERE rsi.provider_id = :provider_id
      AND rsi.captured_at_utc < :cutoff_utc
      AND NOT EXISTS (
          SELECT 1
          FROM silver.rt_feed_snapshots rfs
          WHERE rfs.source_realtime_snapshot_id = rsi.realtime_snapshot_id
             OR rfs.ingestion_object_id = io.ingestion_object_id
      )
      AND rsi.realtime_snapshot_id <> COALESCE((
          SELECT MAX(rsi_latest.realtime_snapshot_id)
          FROM raw.realtime_snapshot_index rsi_latest
          JOIN core.feed_endpoints fe_latest
            ON fe_latest.feed_endpoint_id = rsi_latest.feed_endpoint_id
          WHERE rsi_latest.provider_id = :provider_id
            AND fe_latest.endpoint_key = fe.endpoint_key
      ), -1)
      AND NOT (io.ingestion_object_id = ANY(CAST(:excluded_object_ids AS bigint[])))
    ORDER BY rsi.captured_at_utc ASC, io.ingestion_object_id ASC
    LIMIT :max_objects
    """
)


class RecordingMigrationContext:
    def __init__(self) -> None:
        self.blocks = 0

    @contextmanager
    def autocommit_block(self):
        self.blocks += 1
        yield


class RecordingOperations:
    def __init__(self) -> None:
        self.context = RecordingMigrationContext()
        self.executed: list[str] = []

    def get_context(self) -> RecordingMigrationContext:
        return self.context

    def execute(self, statement: str) -> None:
        self.executed.append(statement)


def _migration_module():
    return importlib.import_module(MIGRATION_MODULE)


def _alembic_config() -> Config:
    config = Config(str(DB_ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location",
        str(DB_ROOT / "src" / "transit_ops" / "db" / "migrations"),
    )
    return config


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


def _database_revision(engine) -> str:
    with engine.connect() as connection:
        return str(connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one())


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
        connection.execute(
            text(
                """
                INSERT INTO core.feed_endpoints
                    (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
                VALUES (:endpoint, :provider, 'trip_updates',
                        'trip_updates', 'gtfs_rt_trip_updates')
                """
            ),
            {"endpoint": PERF_ENDPOINT_ID, "provider": PERF_PROVIDER},
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
            "raw.realtime_snapshot_index",
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


def test_migration_metadata_and_exact_concurrent_operations(monkeypatch) -> None:
    migration = _migration_module()
    assert migration.revision == REVISION
    assert migration.down_revision == DOWN_REVISION

    operations = RecordingOperations()
    monkeypatch.setattr(migration, "op", operations)
    migration.upgrade()

    assert operations.context.blocks == 3
    assert operations.executed == [
        statement for pair in EXPECTED_UPGRADE_OPERATIONS for statement in pair
    ]

    operations = RecordingOperations()
    monkeypatch.setattr(migration, "op", operations)
    migration.downgrade()

    assert operations.context.blocks == 3
    assert operations.executed == [pair[0] for pair in reversed(EXPECTED_UPGRADE_OPERATIONS)]


def test_real_postgres_migration_indexes_and_fk_delete_performance(
    real_db_engine,
    monkeypatch,
) -> None:
    database_url = real_db_engine.url.render_as_string(hide_password=False)
    monkeypatch.setenv("DATABASE_URL", database_url)
    config = _alembic_config()
    original_revision = _database_revision(real_db_engine)
    candidate_object_ids = [PERF_BASE_ID + value for value in range(1, 101)]
    candidate_snapshot_ids = candidate_object_ids.copy()
    full_batch_object_ids = [PERF_BASE_ID + value for value in range(1, 5_001)]
    expected_selector_ids = full_batch_object_ids.copy()

    _cleanup_perf_rows(real_db_engine)
    try:
        command.downgrade(config, DOWN_REVISION)
        with real_db_engine.connect() as connection:
            assert _index_state(connection) == {}

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
            transaction = connection.begin()
            connection.execute(text("SET LOCAL statement_timeout = '250ms'"))
            with pytest.raises(DBAPIError) as selector_timeout_error:
                connection.execute(
                    OLD_SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS,
                    selector_params,
                ).all()
            assert selector_timeout_error.value.orig.sqlstate == "57014"
            transaction.rollback()

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
            assert eligible_count == PERF_ELIGIBLE_COUNT
            assert selector_elapsed_seconds < 2
            assert count_elapsed_seconds < 2
            transaction.rollback()

        with real_db_engine.connect() as connection:
            transaction = connection.begin()
            connection.execute(text("SET LOCAL statement_timeout = '250ms'"))
            with pytest.raises(DBAPIError) as timeout_error:
                connection.execute(
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
                ).all()
            assert timeout_error.value.orig.sqlstate == "57014"
            transaction.rollback()

        command.upgrade(config, REVISION)
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
        command.upgrade(config, original_revision)
        _cleanup_perf_rows(real_db_engine)

    assert _database_revision(real_db_engine) == original_revision
