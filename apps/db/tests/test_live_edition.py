import duckdb
import pytest
from sqlalchemy import text

from transit_ops.live.edition import (
    EditionId,
    EditionMissing,
    create_edition_tables,
    current_edition_id,
    loaded_edition,
)


def test_edition_tables_have_the_contract_columns():
    contracts = {
        "edition_stop_times": "trip_id VARCHAR, stop_sequence INTEGER, arrival_time VARCHAR, "
        "departure_time VARCHAR, stop_id VARCHAR",
        "edition_trips": "trip_id VARCHAR, route_id VARCHAR, service_id VARCHAR",
        "edition_calendar": "service_id VARCHAR, start_date DATE, end_date DATE, monday BOOLEAN, "
        "tuesday BOOLEAN, wednesday BOOLEAN, thursday BOOLEAN, friday BOOLEAN, "
        "saturday BOOLEAN, sunday BOOLEAN",
        "edition_calendar_dates": "service_id VARCHAR, service_date DATE, exception_type INTEGER",
        "edition_trip_service_span": "trip_id VARCHAR, route_id VARCHAR, service_id VARCHAR, "
        "first_seconds BIGINT, last_seconds BIGINT",
        "edition_routes": "route_id VARCHAR, route_type INTEGER",
        "edition_stops": "stop_id VARCHAR, stop_lat DOUBLE, stop_lon DOUBLE",
        "edition_meta": "provider_id VARCHAR, dataset_version_id BIGINT, source_version VARCHAR",
    }
    with duckdb.connect() as duck:
        create_edition_tables(duck)
        assert {row[0] for row in duck.execute("SHOW TABLES").fetchall()} == set(contracts)
        for table, columns in contracts.items():
            actual = [row[:2] for row in duck.execute(f"DESCRIBE {table}").fetchall()]
            assert actual == [tuple(column.split()) for column in columns.split(", ")]


def test_create_is_idempotent():
    with duckdb.connect() as duck:
        create_edition_tables(duck)
        assert loaded_edition(duck) is None
        duck.execute("INSERT INTO edition_meta VALUES ('network', 42, NULL)")
        create_edition_tables(duck)
        assert loaded_edition(duck) == EditionId("network", 42, None)
        duck.execute("UPDATE edition_meta SET source_version = 'édition'")
        assert loaded_edition(duck) == EditionId("network", 42, "édition")


def test_current_edition_follows_the_old_rule(real_db_engine, seed_provider):
    with real_db_engine.connect() as pg, pg.begin() as transaction:
        seed_provider(pg, "edition_contract", display_name="Edition contract")
        ids = (
            pg.execute(
                text("""
            WITH endpoint AS (
                INSERT INTO core.feed_endpoints
                    (provider_id, endpoint_key, feed_kind, source_format)
                VALUES ('edition_contract', 'schedule', 'static_schedule', 'gtfs_schedule_zip')
                RETURNING feed_endpoint_id
            ), run AS (
                INSERT INTO raw.ingestion_runs (provider_id, feed_endpoint_id, run_kind, status)
                SELECT 'edition_contract', feed_endpoint_id, 'static_schedule', 'succeeded'
                FROM endpoint RETURNING feed_endpoint_id, ingestion_run_id
            )
            INSERT INTO core.dataset_versions
                (provider_id, feed_endpoint_id, source_ingestion_run_id, content_hash,
                 source_version, loaded_at_utc)
            SELECT 'edition_contract', feed_endpoint_id, ingestion_run_id, version, version,
                   loaded::timestamptz
            FROM run CROSS JOIN (VALUES ('older', '2026-01-01T00:00:00Z'),
                ('later', '2026-01-02T00:00:00Z'),
                ('tie', '2026-01-02T00:00:00Z')) v(version, loaded)
            RETURNING dataset_version_id
        """)
            )
            .scalars()
            .all()
        )
        assert current_edition_id(pg, provider_id="edition_contract") == EditionId(
            "edition_contract", ids[2], "tie"
        )
        pg.execute(
            text(
                "UPDATE core.dataset_versions SET is_current = false WHERE dataset_version_id = :id"
            ),
            {"id": ids[2]},
        )
        assert current_edition_id(pg, provider_id="edition_contract") == EditionId(
            "edition_contract", ids[1], "later"
        )
        transaction.rollback()


def test_missing_current_edition_is_named(real_db_engine):
    with real_db_engine.connect() as pg:
        with pytest.raises(EditionMissing, match="absent_edition_contract"):
            current_edition_id(pg, provider_id="absent_edition_contract")
