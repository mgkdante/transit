import csv
from contextlib import contextmanager
from datetime import date
from io import StringIO
from itertools import islice
from unittest.mock import MagicMock

import duckdb
import pytest
from sqlalchemy import text
from test_static_silver_copy_real_db import (
    MemoryBronzeStorage,
    _archive,
    _cleanup,
    _edge_members,
    _seed_lineage,
    _zip_bytes,
)

from transit_ops.gold.marts import INSERT_DIM_ROUTE, INSERT_DIM_STOP
from transit_ops.live.edition import (
    EDITION_TABLES,
    EditionId,
    EditionMissing,
    create_edition_tables,
    current_edition_id,
    load_edition_from_postgres,
    loaded_edition,
)
from transit_ops.silver.static_gtfs import load_static_zip_to_silver


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
        "edition_meta": "provider_id VARCHAR, dataset_version_id BIGINT, source_version VARCHAR, "
        "routes_dataset_version_id BIGINT, stops_dataset_version_id BIGINT",
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
        duck.execute(
            "INSERT INTO edition_meta (provider_id, dataset_version_id) VALUES ('network', 42)"
        )
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


SOURCES = {
    "edition_stop_times": "silver.stop_times",
    "edition_trips": "silver.trips",
    "edition_calendar": "silver.calendar",
    "edition_calendar_dates": "silver.calendar_dates",
    "edition_trip_service_span": "gold.trip_service_span",
    "edition_routes": "gold.dim_route",
    "edition_stops": "gold.dim_stop",
}


@pytest.fixture
def editions(real_db_engine, seed_provider):
    provider, base = "live_edition_load", 998_350_000
    try:
        with real_db_engine.begin() as pg:
            _seed_lineage(pg, provider_id=provider, base=base, seed_provider=seed_provider)
            versions = []
            for suffix in ("first", "second"):
                members = {
                    name: rows.replace("N1,,,,,3", "N1,Entrance,,,,3")
                    .replace("S1", f"駅é-{suffix}")
                    .replace("R1", f"R-{suffix}")
                    .replace("T1", f"T-{suffix}")
                    .replace("N1", f"N-{suffix}")
                    for name, rows in _edge_members().items()
                }
                members["calendar_dates.txt"] = "service_id,date,exception_type\nWK,20260325,2\n"
                payload = _zip_bytes(members)
                archive = _archive(provider_id=provider, base=base, payload=payload)
                result = load_static_zip_to_silver(
                    pg, archive=archive, bronze_storage=MemoryBronzeStorage(payload)
                )
                params = {"p": provider, "d": result.dataset_version_id}
                if suffix == "first":
                    for statement in (INSERT_DIM_ROUTE, INSERT_DIM_STOP):
                        pg.execute(
                            statement,
                            {
                                "provider_id": provider,
                                "dataset_version_id": result.dataset_version_id,
                            },
                        )
                pg.execute(
                    text(
                        "UPDATE silver.stop_times SET departure_time = '' "
                        "WHERE dataset_version_id = :d"
                    ),
                    params,
                )
                versions.append(
                    EditionId(provider, result.dataset_version_id, archive.storage_path)
                )
        yield real_db_engine, versions
    finally:
        with real_db_engine.begin() as pg:
            for table in ("gold.dim_route", "gold.dim_stop"):
                pg.execute(text(f"DELETE FROM {table} WHERE provider_id = :p"), {"p": provider})
        _cleanup(real_db_engine, provider)


def _local_rows(duck):
    return {
        table: sorted(duck.execute(f"SELECT * FROM {table}").fetchall(), key=repr)
        for table in (*SOURCES, "edition_meta")
    }


def test_loaded_rows_equal_postgres_rows(editions):
    engine, (older, first) = editions
    with engine.begin() as pg:
        pg.execute(
            text("""
            INSERT INTO silver.stop_times
                (provider_id, dataset_version_id, trip_id, stop_sequence,
                 arrival_time, departure_time, stop_id)
            SELECT provider_id, dataset_version_id, trip_id, n,
                   arrival_time, departure_time, stop_id
            FROM silver.stop_times CROSS JOIN generate_series(13, 20013) AS n
            WHERE dataset_version_id = :d
        """),
            {"d": first.dataset_version_id},
        )
    with engine.connect() as pg, duckdb.connect() as duck:
        load_edition_from_postgres(duck, pg, first)
        assert (
            duck.execute(
                "SELECT routes_dataset_version_id, stops_dataset_version_id FROM edition_meta"
            ).fetchone()
            == (older.dataset_version_id,) * 2
        )
        for table, source in SOURCES.items():
            predicate = "" if source.startswith("gold.dim_") else " AND dataset_version_id = :d"
            columns = [row[0] for row in duck.execute(f"DESCRIBE {table}").fetchall()]
            selected = ", ".join(columns)
            expected = pg.execute(
                text(f"SELECT {selected} FROM {source} WHERE provider_id = :p {predicate}"),
                {"p": first.provider_id, "d": first.dataset_version_id},
            ).all()
            assert _local_rows(duck)[table] == sorted(map(tuple, expected), key=repr)
        assert loaded_edition(duck) == first
        assert duck.execute(
            "SELECT arrival_time, departure_time FROM edition_stop_times"
        ).fetchone() == ("25:35:00", "")
        assert duck.execute(
            "SELECT stop_id, stop_lon FROM edition_stops WHERE stop_lat IS NOT NULL"
        ).fetchone() == ("駅é-first", None)


def test_reload_replaces_the_edition_atomically(editions, tmp_path):
    engine, (first, second) = editions
    with engine.connect() as pg, duckdb.connect(str(tmp_path / "live.duckdb")) as duck:
        load_edition_from_postgres(duck, pg, first)
        before = _local_rows(duck)
        duck.execute("DROP TABLE edition_meta")
        duck.execute(
            "CREATE TABLE edition_meta (provider_id VARCHAR, dataset_version_id BIGINT "
            f"CHECK (dataset_version_id = {first.dataset_version_id}), source_version VARCHAR, "
            "routes_dataset_version_id BIGINT, stops_dataset_version_id BIGINT)"
        )
        duck.execute(
            "INSERT INTO edition_meta VALUES (?, ?, ?, ?, ?)",
            before["edition_meta"][0],
        )
        with pytest.raises(duckdb.ConstraintException):
            load_edition_from_postgres(duck, pg, second)
        assert _local_rows(duck) == before
        duck.execute("DROP TABLE edition_meta")
        load_edition_from_postgres(duck, pg, first)
        with duck.cursor() as reader:
            reader.execute("BEGIN")
            assert _local_rows(reader) == before
            load_edition_from_postgres(duck, pg, second)
            assert _local_rows(reader) == before
            reader.execute("COMMIT")
            assert _local_rows(reader) == _local_rows(duck)
        assert loaded_edition(duck) == second
        assert duck.execute("SELECT trip_id FROM edition_trips").fetchall() == [("T-second",)]


def test_counts_are_returned_per_table(editions):
    engine, (first, _) = editions
    with engine.connect() as pg, duckdb.connect() as duck:
        assert load_edition_from_postgres(duck, pg, first) == {
            "edition_stop_times": 1,
            "edition_trips": 1,
            "edition_calendar": 1,
            "edition_calendar_dates": 1,
            "edition_trip_service_span": 1,
            "edition_routes": 1,
            "edition_stops": 2,
            "edition_meta": 1,
        }


@pytest.mark.parametrize("active, autocommit", [(True, False), (False, True)])
def test_load_refuses_to_change_the_callers_postgres_transaction(active, autocommit):
    pg = MagicMock()
    pg.in_transaction.return_value = active
    pg.connection.dbapi_connection.autocommit = autocommit
    with duckdb.connect() as duck:
        create_edition_tables(duck)
        duck.execute(
            "INSERT INTO edition_meta (provider_id, dataset_version_id) VALUES ('preserved', 1)"
        )
        with pytest.raises(ValueError, match="idle non-autocommit"):
            load_edition_from_postgres(duck, pg, EditionId("replacement", 2, None))
        assert loaded_edition(duck) == EditionId("preserved", 1, None)


def _source_pg(rows, *, failure=None):
    pg = MagicMock()
    pg.in_transaction.return_value = False
    pg.connection.dbapi_connection.autocommit = False
    if failure == "exit":
        pg.begin.return_value.__exit__.side_effect = RuntimeError("source exit failed")

    def execute(statement, parameters=None, **options):
        result = MagicMock()
        result.__enter__.return_value = result
        version = (parameters or {}).get("dataset_version_id")
        identity = (version, "wrong" if failure == "mismatch" else None, None, None)
        result.one_or_none.return_value = None if failure == "missing" else identity
        result.fetchmany.side_effect = AssertionError("COPY required; no Python row conversion")
        return result

    @contextmanager
    def copy(statement, parameters):
        source = statement.split(" FROM ")[1].split()[0]
        selected = {
            "silver.stop_times": () if failure == "empty_stop_times" else rows,
            "silver.trips": [] if failure == "empty_trips" else [("trip", "route", "service")],
        }.get(source, ())

        def blocks():
            iterator = iter(selected)
            while batch := list(islice(iterator, 10_000)):
                output = StringIO()
                csv.writer(output, quoting=csv.QUOTE_NOTNULL).writerows(batch)
                yield output.getvalue().encode("utf-8")
                if failure == "read":
                    raise RuntimeError("source read failed")

        yield blocks()

    pg.execute.side_effect = execute
    cursor = pg.connection.dbapi_connection.cursor.return_value.__enter__.return_value
    cursor.copy.side_effect = copy
    return pg


def test_source_rows_stream_in_bounded_batches():
    rows = [("trip", n, "25:10:00", None if n % 2 else "", "駅é") for n in range(25_001)]
    with duckdb.connect() as duck:
        counts = load_edition_from_postgres(
            duck, _source_pg(iter(rows)), EditionId("streamed", 2, None)
        )
        assert counts == {
            **dict.fromkeys(SOURCES, 0),
            "edition_stop_times": 25_001,
            "edition_trips": 1,
            "edition_meta": 1,
        }
        actual = duck.execute("SELECT * FROM edition_stop_times ORDER BY stop_sequence").fetchall()
        assert actual == rows
        assert loaded_edition(duck) == EditionId("streamed", 2, None)


@pytest.mark.parametrize(
    "failure", ["read", "exit", "missing", "mismatch", "empty_trips", "empty_stop_times"]
)
def test_source_failure_preserves_every_table_after_reopen(tmp_path, failure):
    path = str(tmp_path / "preserved.duckdb")
    values = {
        "VARCHAR": "old",
        "INTEGER": 1,
        "BIGINT": 1,
        "DOUBLE": 1.5,
        "BOOLEAN": True,
        "DATE": date(2026, 1, 1),
    }
    with duckdb.connect(path) as duck:
        create_edition_tables(duck)
        for table, columns in EDITION_TABLES.items():
            placeholders = ", ".join("?" for _ in columns)
            duck.execute(
                f"INSERT INTO {table} VALUES ({placeholders})",
                [values[kind] for _, kind in columns],
            )
        before = _local_rows(duck)
        rows = (("new", n, "26:00:00", "", "新") for n in range(25_001))
        pg = _source_pg(rows, failure=failure)
        error = RuntimeError if failure in {"read", "exit"} else EditionMissing
        with pytest.raises(error, match="source" if error is RuntimeError else "replacement/2"):
            load_edition_from_postgres(duck, pg, EditionId("replacement", 2, None))
    with duckdb.connect(path) as reopened:
        assert _local_rows(reopened) == before


@pytest.mark.parametrize("definition", ["trip_id INTEGER", "route_id VARCHAR, trip_id VARCHAR"])
def test_create_refuses_incompatible_schema(definition):
    with duckdb.connect() as duck:
        duck.execute(f"CREATE TABLE edition_trips ({definition})")
        with pytest.raises(ValueError, match="edition_trips"):
            create_edition_tables(duck)
