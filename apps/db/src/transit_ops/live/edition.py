"""The schedule edition relations read by the local live engine."""

from collections.abc import Mapping
from dataclasses import dataclass

import duckdb
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
    ),
}


class EditionMissing(LookupError):
    """The provider has no current static schedule edition."""


@dataclass(frozen=True)
class EditionId:
    provider_id: str
    dataset_version_id: int
    source_version: str | None


def create_edition_tables(duck: duckdb.DuckDBPyConnection) -> None:
    for table, columns in EDITION_TABLES.items():
        definition = ", ".join(f"{column} {kind}" for column, kind in columns)
        duck.execute(f"CREATE TABLE IF NOT EXISTS {table} ({definition})")


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
    row = duck.execute(
        "SELECT provider_id, dataset_version_id, source_version FROM edition_meta"
    ).fetchone()
    return None if row is None else EditionId(*row)
