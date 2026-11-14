"""The schedule edition relations read by the local live engine."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast

import duckdb
from psycopg import Connection as PsycopgConnection
from sqlalchemy import Connection, text

EDITION_TABLES: Mapping[str, tuple[tuple[str, str], ...]] = {
    "edition_stop_times": (
        ("trip_id", "VARCHAR"),
        ("stop_sequence", "INTEGER"),
        ("arrival_time", "VARCHAR"),
        ("departure_time", "VARCHAR"),
        ("stop_id", "VARCHAR"),
    ),
    "edition_trips": (("trip_id", "VARCHAR"), ("route_id", "VARCHAR"), ("service_id", "VARCHAR")),
    "edition_calendar": (
        ("service_id", "VARCHAR"),
        ("start_date", "DATE"),
        ("end_date", "DATE"),
        ("monday", "BOOLEAN"),
        ("tuesday", "BOOLEAN"),
        ("wednesday", "BOOLEAN"),
        ("thursday", "BOOLEAN"),
        ("friday", "BOOLEAN"),
        ("saturday", "BOOLEAN"),
        ("sunday", "BOOLEAN"),
    ),
    "edition_calendar_dates": (
        ("service_id", "VARCHAR"),
        ("service_date", "DATE"),
        ("exception_type", "INTEGER"),
    ),
    "edition_trip_service_span": (
        ("trip_id", "VARCHAR"),
        ("route_id", "VARCHAR"),
        ("service_id", "VARCHAR"),
        ("first_seconds", "BIGINT"),
        ("last_seconds", "BIGINT"),
    ),
    "edition_routes": (("route_id", "VARCHAR"), ("route_type", "INTEGER")),
    "edition_stops": (("stop_id", "VARCHAR"), ("stop_lat", "DOUBLE"), ("stop_lon", "DOUBLE")),
    "edition_meta": (
        ("provider_id", "VARCHAR"),
        ("dataset_version_id", "BIGINT"),
        ("source_version", "VARCHAR"),
        ("routes_dataset_version_id", "BIGINT"),
        ("stops_dataset_version_id", "BIGINT"),
    ),
}


class EditionMissing(LookupError):
    """The provider has no current static schedule edition."""


@dataclass(frozen=True)
class EditionId:
    provider_id: str
    dataset_version_id: int
    source_version: str | None
    dimension_versions: tuple[int | None, int | None] = field(default=(None, None), compare=False)


def create_edition_tables(duck: duckdb.DuckDBPyConnection) -> None:
    for table, columns in EDITION_TABLES.items():
        definition = ", ".join(f"{column} {kind}" for column, kind in columns)
        duck.execute(f"CREATE TABLE IF NOT EXISTS {table} ({definition})")
        actual = tuple(row[:2] for row in duck.execute(f"DESCRIBE {table}").fetchall())
        if actual != columns:
            raise ValueError(f"Incompatible edition schema for {table}")


def current_edition_id(pg: Connection, *, provider_id: str) -> EditionId:
    row = pg.execute(
        text("""
            SELECT provider_id, dataset_version_id, source_version
            FROM core.dataset_versions
            WHERE provider_id = :provider_id
              AND dataset_kind = 'static_schedule' AND is_current = true
            ORDER BY loaded_at_utc DESC, dataset_version_id DESC
            LIMIT 1
        """),
        {"provider_id": provider_id},
    ).one_or_none()
    if row is None:
        raise EditionMissing(f"No current static schedule edition for provider {provider_id!r}")
    return EditionId(row.provider_id, row.dataset_version_id, row.source_version)


def loaded_edition(duck: duckdb.DuckDBPyConnection) -> EditionId | None:
    row = duck.execute("SELECT * FROM edition_meta").fetchone()
    return None if row is None else EditionId(row[0], row[1], row[2], (row[3], row[4]))


_EDITION_SOURCES = {
    "edition_stop_times": ("silver.stop_times", "trip_id, stop_sequence"),
    "edition_trips": ("silver.trips", "trip_id"),
    "edition_calendar": ("silver.calendar", "service_id"),
    "edition_calendar_dates": ("silver.calendar_dates", "service_id, service_date"),
    "edition_trip_service_span": ("gold.trip_service_span", "trip_id"),
    "edition_routes": ("gold.dim_route", "route_id"),
    "edition_stops": ("gold.dim_stop", "stop_id"),
}


def _copy_edition_relation(
    duck: duckdb.DuckDBPyConnection, pg: Connection, edition: EditionId, table: str
) -> int:
    source, key = _EDITION_SOURCES[table]
    columns = EDITION_TABLES[table]
    names = ", ".join(name for name, _ in columns)
    versioned = not source.startswith("gold.dim_")
    predicate = " AND dataset_version_id = %s" if versioned else ""
    parameters = (
        (edition.provider_id, edition.dataset_version_id) if versioned else (edition.provider_id,)
    )
    query = f"SELECT {names} FROM {source} WHERE provider_id = %s{predicate} ORDER BY {key}"
    duck.execute(f"DELETE FROM {table}")
    with TemporaryDirectory(prefix="transit-edition-") as directory:
        path = Path(directory).resolve() / "relation.csv"
        if any(character in str(path) for character in "*?[]{}"):
            raise ValueError("Edition staging path must not contain glob characters")
        connection = cast(PsycopgConnection[tuple[object, ...]], pg.connection.dbapi_connection)
        with connection.cursor() as cursor, path.open("wb") as output:
            with cursor.copy(
                f"COPY ({query}) TO STDOUT "
                "(FORMAT csv, HEADER false, FORCE_QUOTE *, ENCODING 'UTF8')",
                parameters,
            ) as stream:
                for block in stream:
                    output.write(block)
        if not path.stat().st_size:
            return 0
        row = duck.execute(
            f"INSERT INTO {table} ({names}) SELECT * FROM read_csv(?, columns=?, header=false, "
            "auto_detect=false, delim=',', allow_quoted_nulls=false, hive_partitioning=false)",
            [str(path), dict(columns)],
        ).fetchone()
        assert row is not None
        return int(row[0])


def current_dim_versions(pg: Connection, *, provider_id: str) -> tuple[int | None, int | None]:
    """Return the provider's (route, stop) Gold versions in the caller's snapshot."""
    row = pg.execute(
        text("""
        SELECT (SELECT max(dataset_version_id) FROM gold.dim_route WHERE provider_id = :p),
               (SELECT max(dataset_version_id) FROM gold.dim_stop WHERE provider_id = :p)
    """),
        {"p": provider_id},
    ).one()
    return row[0], row[1]


def _edition_metadata(pg: Connection, edition: EditionId) -> list[str | int | None]:
    row = pg.execute(
        text("""
        SELECT dataset_version_id, source_version FROM core.dataset_versions
        WHERE provider_id = :provider_id AND dataset_version_id = :dataset_version_id
          AND dataset_kind = 'static_schedule'
    """),
        {"provider_id": edition.provider_id, "dataset_version_id": edition.dataset_version_id},
    ).one_or_none()
    if row is None or row[1] != edition.source_version:
        raise EditionMissing(
            f"Edition {edition.provider_id}/{edition.dataset_version_id} missing or changed"
        )
    versions = current_dim_versions(pg, provider_id=edition.provider_id)
    return [edition.provider_id, *row, *versions]


def load_edition_from_postgres(
    duck: duckdb.DuckDBPyConnection, pg: Connection, edition: EditionId
) -> dict[str, int]:
    """Replace an edition using an idle non-autocommit PostgreSQL connection.

    The caller must ensure a single writer for the local file.
    """
    if pg.in_transaction() or getattr(pg.connection.dbapi_connection, "autocommit", True):
        raise ValueError("Edition loading requires an idle non-autocommit PostgreSQL connection")
    duck.execute("BEGIN TRANSACTION")
    try:
        with pg.begin():
            pg.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
            metadata = _edition_metadata(pg, edition)
            create_edition_tables(duck)
            counts = {
                table: _copy_edition_relation(duck, pg, edition, table)
                for table in _EDITION_SOURCES
            }
            if not counts["edition_stop_times"] or not counts["edition_trips"]:
                raise EditionMissing(
                    f"Empty schedule for {edition.provider_id}/{edition.dataset_version_id}"
                )
            duck.execute("DELETE FROM edition_meta")
            duck.execute("INSERT INTO edition_meta VALUES (?, ?, ?, ?, ?)", metadata)
            counts["edition_meta"] = 1
        duck.execute("COMMIT")
    except BaseException:
        duck.execute("ROLLBACK")
        raise
    return counts
