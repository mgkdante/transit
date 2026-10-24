"""Foundation INSERTs for real-DB tests.

Column arguments are trusted SQL expressions, not escaped Python values. Keeping
the original literals, casts and bind names preserves each fixture's SQL contract;
parameters are passed to SQLAlchemy unchanged. None omits an optional column.
"""

from typing import Any

from sqlalchemy import Connection, CursorResult, text

Parameters = dict[str, Any] | list[dict[str, Any]] | None


def _insert(
    connection: Connection, table: str, parameters: Parameters, **columns: str | None
) -> CursorResult[Any]:
    values = {column: value for column, value in columns.items() if value is not None}
    statement = text(
        f"INSERT INTO {table} ({', '.join(values)}) "
        f"VALUES ({', '.join(values.values())})"
    )
    return connection.execute(statement, parameters)


def feed_endpoints(
    connection: Connection,
    parameters: Parameters,
    *,
    feed_endpoint_id: str | None = ":e", provider_id: str | None = ":p",
    endpoint_key: str | None = "'trip_updates'", feed_kind: str | None = "'trip_updates'",
    source_format: str | None = "'gtfs_rt_trip_updates'",
) -> CursorResult[Any]:
    return _insert(
        connection,
        "core.feed_endpoints",
        parameters,
        feed_endpoint_id=feed_endpoint_id, provider_id=provider_id, endpoint_key=endpoint_key,
        feed_kind=feed_kind, source_format=source_format,
    )


def ingestion_runs(
    connection: Connection,
    parameters: Parameters,
    *,
    ingestion_run_id: str | None = ":r", provider_id: str | None = ":p",
    feed_endpoint_id: str | None = ":e", run_kind: str | None = "'trip_updates'",
    status: str | None = "'succeeded'", started_at_utc: str | None = None,
    completed_at_utc: str | None = None,
) -> CursorResult[Any]:
    return _insert(
        connection,
        "raw.ingestion_runs",
        parameters,
        ingestion_run_id=ingestion_run_id, provider_id=provider_id,
        feed_endpoint_id=feed_endpoint_id, run_kind=run_kind, status=status,
        started_at_utc=started_at_utc, completed_at_utc=completed_at_utc,
    )


def realtime_snapshot_index(
    connection: Connection,
    parameters: Parameters,
    *,
    realtime_snapshot_id: str | None = ":s", ingestion_run_id: str | None = ":r",
    ingestion_object_id: str | None = None, provider_id: str | None = ":p",
    feed_endpoint_id: str | None = ":e", feed_timestamp_utc: str | None = ":ts",
    entity_count: str | None = ":n", captured_at_utc: str | None = ":ts",
) -> CursorResult[Any]:
    return _insert(
        connection,
        "raw.realtime_snapshot_index",
        parameters,
        realtime_snapshot_id=realtime_snapshot_id, ingestion_run_id=ingestion_run_id,
        ingestion_object_id=ingestion_object_id, provider_id=provider_id,
        feed_endpoint_id=feed_endpoint_id, feed_timestamp_utc=feed_timestamp_utc,
        entity_count=entity_count, captured_at_utc=captured_at_utc,
    )


def dataset_versions(
    connection: Connection,
    parameters: Parameters,
    *,
    dataset_version_id: str | None = ":d", provider_id: str | None = ":p",
    feed_endpoint_id: str | None = ":e", source_ingestion_run_id: str | None = ":r",
    source_ingestion_object_id: str | None = None, dataset_kind: str | None = "'static_schedule'",
    content_hash: str | None = ":h", is_current: str | None = "true",
    loaded_at_utc: str | None = None,
) -> CursorResult[Any]:
    return _insert(
        connection,
        "core.dataset_versions",
        parameters,
        dataset_version_id=dataset_version_id, provider_id=provider_id,
        feed_endpoint_id=feed_endpoint_id, source_ingestion_run_id=source_ingestion_run_id,
        source_ingestion_object_id=source_ingestion_object_id, dataset_kind=dataset_kind,
        content_hash=content_hash, is_current=is_current, loaded_at_utc=loaded_at_utc,
    )


def ingestion_objects(
    connection: Connection,
    parameters: Parameters,
    *,
    ingestion_object_id: str | None = ":o", ingestion_run_id: str | None = ":r",
    provider_id: str | None = ":p", object_kind: str | None = "'gtfs_rt_feed'",
    storage_backend: str | None = "'s3'", storage_path: str | None = ":path",
    checksum_sha256: str | None = None, byte_size: str | None = None,
) -> CursorResult[Any]:
    return _insert(
        connection,
        "raw.ingestion_objects",
        parameters,
        ingestion_object_id=ingestion_object_id, ingestion_run_id=ingestion_run_id,
        provider_id=provider_id, object_kind=object_kind, storage_backend=storage_backend,
        storage_path=storage_path, checksum_sha256=checksum_sha256, byte_size=byte_size,
    )


def replay_static_graph(
    connection: Connection, parameters: dict[str, Any], *,
    version: str = ":dv", route_short_name: str | None = None,
) -> None:
    route_name_column = ", route_short_name" if route_short_name is not None else ""
    route_name_value = f", {route_short_name}" if route_short_name is not None else ""
    for statement in (
        "INSERT INTO silver.routes (dataset_version_id, provider_id, route_id, route_type"
        f"{route_name_column}) VALUES ({version}, :p, '51', 3{route_name_value})",
        "INSERT INTO silver.stops (dataset_version_id, provider_id, stop_id, stop_name) "
        f"VALUES ({version}, :p, 'S1', 'Stop 1'), ({version}, :p, 'S2', 'Stop 2')",
        "INSERT INTO silver.trips (dataset_version_id, provider_id, trip_id, route_id, service_id) "
        f"VALUES ({version}, :p, 'T_REPLAY', '51', 'WK')",
        "INSERT INTO silver.stop_times (dataset_version_id, provider_id, trip_id, stop_sequence, "
        "stop_id, arrival_time, departure_time) "
        f"VALUES ({version}, :p, 'T_REPLAY', 1, 'S1', '12:00:00', '12:00:00'), "
        f"({version}, :p, 'T_REPLAY', 2, 'S2', '12:08:00', '12:08:00')",
    ):
        connection.execute(text(statement), parameters)
