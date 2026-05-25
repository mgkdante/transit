from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from datetime import date, datetime
from itertools import islice
from pathlib import Path

from google.transit import gtfs_realtime_pb2
from sqlalchemy import bindparam, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.gtfs.types import (
    ProviderBounds,
    parse_gtfs_date,
    parse_gtfs_realtime_timestamp,
    validate_wgs84_position,
)
from transit_ops.ingestion.common import project_root
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings

CHUNK_SIZE = 10_000
PARSER_VERSION = "transit_ops.silver.realtime_gtfs.v1"
MONTREAL_MIN_LONGITUDE = -74.1
MONTREAL_MAX_LONGITUDE = -73.2
MONTREAL_MIN_LATITUDE = 45.25
MONTREAL_MAX_LATITUDE = 45.75

RT_FEED_SNAPSHOTS_INSERT = text(
    """
    INSERT INTO silver.rt_feed_snapshots (
        provider_id,
        feed_endpoint_id,
        ingestion_run_id,
        ingestion_object_id,
        endpoint_key,
        gtfs_realtime_version,
        incrementality,
        feed_timestamp_utc,
        captured_at_utc,
        source_url,
        storage_backend,
        storage_path,
        checksum_sha256,
        byte_size,
        parser_version,
        manifest_json
    )
    VALUES (
        :provider_id,
        :feed_endpoint_id,
        :ingestion_run_id,
        :ingestion_object_id,
        :endpoint_key,
        :gtfs_realtime_version,
        :incrementality,
        :feed_timestamp_utc,
        :captured_at_utc,
        :source_url,
        :storage_backend,
        :storage_path,
        :checksum_sha256,
        :byte_size,
        :parser_version,
        :manifest_json
    )
    RETURNING rt_feed_snapshot_id
    """
).bindparams(bindparam("manifest_json", type_=postgresql.JSONB))

RT_ENTITIES_INSERT = text(
    """
    INSERT INTO silver.rt_entities (
        rt_feed_snapshot_id,
        entity_index,
        provider_id,
        entity_id,
        entity_kind,
        is_deleted,
        raw_entity_json
    )
    VALUES (
        :rt_feed_snapshot_id,
        :entity_index,
        :provider_id,
        :entity_id,
        :entity_kind,
        :is_deleted,
        :raw_entity_json
    )
    """
).bindparams(bindparam("raw_entity_json", type_=postgresql.JSONB))

RT_TRIP_UPDATES_INSERT = text(
    """
    INSERT INTO silver.rt_trip_updates (
        rt_feed_snapshot_id,
        entity_index,
        provider_id,
        trip_id,
        route_id,
        direction_id,
        start_date,
        schedule_relationship,
        trip_update_timestamp_utc,
        feed_timestamp_utc,
        captured_at_utc
    )
    VALUES (
        :rt_feed_snapshot_id,
        :entity_index,
        :provider_id,
        :trip_id,
        :route_id,
        :direction_id,
        :start_date,
        :schedule_relationship,
        :trip_update_timestamp_utc,
        :feed_timestamp_utc,
        :captured_at_utc
    )
    """
)

RT_TRIP_UPDATE_STOP_TIMES_INSERT = text(
    """
    INSERT INTO silver.rt_trip_update_stop_times (
        rt_feed_snapshot_id,
        entity_index,
        stop_time_update_index,
        provider_id,
        stop_sequence,
        stop_id,
        arrival_time_utc,
        departure_time_utc,
        schedule_relationship
    )
    VALUES (
        :rt_feed_snapshot_id,
        :entity_index,
        :stop_time_update_index,
        :provider_id,
        :stop_sequence,
        :stop_id,
        :arrival_time_utc,
        :departure_time_utc,
        :schedule_relationship
    )
    """
)

RT_VEHICLE_POSITIONS_INSERT = text(
    """
    INSERT INTO silver.rt_vehicle_positions (
        rt_feed_snapshot_id,
        entity_index,
        provider_id,
        vehicle_id,
        trip_id,
        route_id,
        direction_id,
        start_time,
        start_date,
        latitude,
        longitude,
        bearing,
        speed,
        stop_id,
        current_stop_sequence,
        current_status,
        occupancy_status,
        congestion_level,
        vehicle_timestamp_utc,
        position_quality,
        feed_timestamp_utc,
        captured_at_utc
    )
    VALUES (
        :rt_feed_snapshot_id,
        :entity_index,
        :provider_id,
        :vehicle_id,
        :trip_id,
        :route_id,
        :direction_id,
        :start_time,
        :start_date,
        :latitude,
        :longitude,
        :bearing,
        :speed,
        :stop_id,
        :current_stop_sequence,
        :current_status,
        :occupancy_status,
        :congestion_level,
        :vehicle_timestamp_utc,
        :position_quality,
        :feed_timestamp_utc,
        :captured_at_utc
    )
    """
)

TRIP_UPDATES_INSERT = text(
    """
    INSERT INTO silver.trip_updates (
        realtime_snapshot_id,
        entity_index,
        provider_id,
        entity_id,
        trip_id,
        route_id,
        direction_id,
        start_date,
        vehicle_id,
        trip_schedule_relationship,
        delay_seconds,
        feed_timestamp_utc,
        captured_at_utc
    )
    VALUES (
        :realtime_snapshot_id,
        :entity_index,
        :provider_id,
        :entity_id,
        :trip_id,
        :route_id,
        :direction_id,
        :start_date,
        :vehicle_id,
        :trip_schedule_relationship,
        :delay_seconds,
        :feed_timestamp_utc,
        :captured_at_utc
    )
    """
)

TRIP_UPDATE_STOP_TIMES_INSERT = text(
    """
    INSERT INTO silver.trip_update_stop_time_updates (
        realtime_snapshot_id,
        trip_update_entity_index,
        stop_time_update_index,
        provider_id,
        stop_sequence,
        stop_id,
        arrival_delay_seconds,
        arrival_time_utc,
        departure_delay_seconds,
        departure_time_utc,
        schedule_relationship
    )
    VALUES (
        :realtime_snapshot_id,
        :trip_update_entity_index,
        :stop_time_update_index,
        :provider_id,
        :stop_sequence,
        :stop_id,
        :arrival_delay_seconds,
        :arrival_time_utc,
        :departure_delay_seconds,
        :departure_time_utc,
        :schedule_relationship
    )
    """
)

VEHICLE_POSITIONS_INSERT = text(
    """
    INSERT INTO silver.vehicle_positions (
        realtime_snapshot_id,
        entity_index,
        provider_id,
        entity_id,
        vehicle_id,
        trip_id,
        route_id,
        stop_id,
        current_stop_sequence,
        current_status,
        occupancy_status,
        latitude,
        longitude,
        bearing,
        speed,
        position_timestamp_utc,
        feed_timestamp_utc,
        captured_at_utc
    )
    VALUES (
        :realtime_snapshot_id,
        :entity_index,
        :provider_id,
        :entity_id,
        :vehicle_id,
        :trip_id,
        :route_id,
        :stop_id,
        :current_stop_sequence,
        :current_status,
        :occupancy_status,
        :latitude,
        :longitude,
        :bearing,
        :speed,
        :position_timestamp_utc,
        :feed_timestamp_utc,
        :captured_at_utc
    )
    """
)


SELECT_REALTIME_SNAPSHOTS_IN_WINDOW = text(
    """
    SELECT
        rsi.realtime_snapshot_id,
        rsi.provider_id,
        fe.endpoint_key,
        io.storage_backend,
        rsi.feed_endpoint_id,
        rsi.ingestion_run_id,
        rsi.ingestion_object_id,
        io.storage_path,
        io.source_url,
        io.checksum_sha256,
        io.byte_size,
        rsi.feed_timestamp_utc,
        rsi.captured_at_utc
    FROM raw.realtime_snapshot_index AS rsi
    INNER JOIN raw.ingestion_runs AS ir
        ON ir.ingestion_run_id = rsi.ingestion_run_id
    INNER JOIN core.feed_endpoints AS fe
        ON fe.feed_endpoint_id = rsi.feed_endpoint_id
    INNER JOIN raw.ingestion_objects AS io
        ON io.ingestion_object_id = rsi.ingestion_object_id
    WHERE rsi.provider_id = :provider_id
      AND rsi.captured_at_utc >= :start_utc
      AND rsi.captured_at_utc < :end_utc
      AND ir.status = 'succeeded'
    ORDER BY rsi.captured_at_utc ASC, fe.endpoint_key ASC, rsi.realtime_snapshot_id ASC
    """
)


@dataclass(frozen=True)
class BronzeRealtimeSnapshot:
    provider_id: str
    endpoint_key: str
    storage_backend: str
    feed_endpoint_id: int
    ingestion_run_id: int
    ingestion_object_id: int
    realtime_snapshot_id: int
    storage_path: str
    archive_full_path: str
    source_url: str | None
    checksum_sha256: str
    byte_size: int | None
    feed_timestamp_utc: datetime
    captured_at_utc: datetime


@dataclass(frozen=True)
class RealtimeSilverLoadResult:
    provider_id: str
    endpoint_key: str
    realtime_snapshot_id: int
    source_ingestion_run_id: int
    source_ingestion_object_id: int
    storage_path: str
    archive_full_path: str
    content_hash: str
    feed_timestamp_utc: datetime
    captured_at_utc: datetime
    row_counts: dict[str, int]

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["feed_timestamp_utc"] = self.feed_timestamp_utc.isoformat()
        payload["captured_at_utc"] = self.captured_at_utc.isoformat()
        return payload


@dataclass(frozen=True)
class RealtimeSilverBatchLoadResult:
    provider_id: str
    loaded_count: int
    skipped_existing_snapshot_ids: list[int]
    row_counts: dict[str, int]
    results: list[RealtimeSilverLoadResult]

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["results"] = [result.display_dict() for result in self.results]
        return payload


def _project_root() -> Path:
    return project_root()


def _blank_to_none(value: str) -> str | None:
    stripped = value.strip()
    return stripped or None


def _parse_optional_gtfs_date(value: str) -> date | None:
    normalized = _blank_to_none(value)
    if normalized is None:
        return None
    return parse_gtfs_date(normalized, field_name="GTFS-RT start_date")


def _parse_optional_timestamp(timestamp: int | None) -> datetime | None:
    if not timestamp:
        return None
    return parse_gtfs_realtime_timestamp(timestamp, field_name="GTFS-RT timestamp")


def _has_field(message, field_name: str) -> bool:  # noqa: ANN001
    try:
        return message.HasField(field_name)
    except ValueError:
        return False


def classify_montreal_position_quality(
    latitude: float | None,
    longitude: float | None,
) -> str:
    quality = validate_wgs84_position(
        latitude,
        longitude,
        bounds=ProviderBounds(
            min_latitude=MONTREAL_MIN_LATITUDE,
            max_latitude=MONTREAL_MAX_LATITUDE,
            min_longitude=MONTREAL_MIN_LONGITUDE,
            max_longitude=MONTREAL_MAX_LONGITUDE,
        ),
    )
    if quality == "valid_provider_bbox":
        return "valid_montreal_bbox"
    if quality == "outside_provider_bbox":
        return "outside_montreal_bbox"
    return quality


def _enum_name(enum_type, value: int | None) -> str | None:  # noqa: ANN001
    if value is None:
        return None
    try:
        return enum_type.Name(value)
    except ValueError:
        return str(value)


def _feed_incrementality_name(header: gtfs_realtime_pb2.FeedHeader) -> str | None:
    if not _has_field(header, "incrementality"):
        return None
    return _enum_name(gtfs_realtime_pb2.FeedHeader.Incrementality, header.incrementality)


def _entity_kind(entity: gtfs_realtime_pb2.FeedEntity) -> str:
    if _has_field(entity, "trip_update"):
        return "trip_update"
    if _has_field(entity, "vehicle"):
        return "vehicle_position"
    return "unknown"


def _raw_entity_manifest(entity: gtfs_realtime_pb2.FeedEntity) -> dict[str, object]:
    return {
        "entity_id": _blank_to_none(entity.id),
        "entity_kind": _entity_kind(entity),
    }


def _chunked(
    rows: Iterable[dict[str, object]],
    chunk_size: int,
) -> Iterator[list[dict[str, object]]]:
    iterator = iter(rows)
    while chunk := list(islice(iterator, chunk_size)):
        yield chunk


def _execute_batched_insert(
    connection: Connection,
    *,
    statement,
    rows: Iterable[dict[str, object]],
) -> int:
    row_count = 0
    for chunk in _chunked(rows, CHUNK_SIZE):
        connection.execute(statement, chunk)
        row_count += len(chunk)
    return row_count


def _row_to_bronze_realtime_snapshot(
    row,
    *,
    settings: Settings,
    project_root: Path,
) -> BronzeRealtimeSnapshot:
    bronze_storage = get_bronze_storage(
        settings,
        project_root=project_root,
        storage_backend=str(row["storage_backend"]),
    )

    return BronzeRealtimeSnapshot(
        provider_id=str(row["provider_id"]),
        endpoint_key=str(row["endpoint_key"]),
        storage_backend=str(row["storage_backend"]),
        feed_endpoint_id=int(row["feed_endpoint_id"]),
        ingestion_run_id=int(row["ingestion_run_id"]),
        ingestion_object_id=int(row["ingestion_object_id"]),
        realtime_snapshot_id=int(row["realtime_snapshot_id"]),
        storage_path=str(row["storage_path"]),
        archive_full_path=bronze_storage.describe_location(str(row["storage_path"])),
        source_url=str(row["source_url"]) if row["source_url"] else None,
        checksum_sha256=str(row["checksum_sha256"]),
        byte_size=int(row["byte_size"]) if row["byte_size"] is not None else None,
        feed_timestamp_utc=row["feed_timestamp_utc"],
        captured_at_utc=row["captured_at_utc"],
    )


def find_latest_realtime_bronze_snapshot(
    connection: Connection,
    *,
    provider_id: str,
    endpoint_key: str,
    settings: Settings,
    project_root: Path,
) -> BronzeRealtimeSnapshot:
    snapshot_row = connection.execute(
        text(
            """
            SELECT
                rsi.realtime_snapshot_id,
                rsi.provider_id,
                fe.endpoint_key,
                io.storage_backend,
                rsi.feed_endpoint_id,
                rsi.ingestion_run_id,
                rsi.ingestion_object_id,
                io.storage_path,
                io.source_url,
                io.checksum_sha256,
                io.byte_size,
                rsi.feed_timestamp_utc,
                rsi.captured_at_utc
            FROM raw.realtime_snapshot_index AS rsi
            INNER JOIN raw.ingestion_runs AS ir
                ON ir.ingestion_run_id = rsi.ingestion_run_id
            INNER JOIN core.feed_endpoints AS fe
                ON fe.feed_endpoint_id = rsi.feed_endpoint_id
            INNER JOIN raw.ingestion_objects AS io
                ON io.ingestion_object_id = rsi.ingestion_object_id
            WHERE rsi.provider_id = :provider_id
              AND fe.endpoint_key = :endpoint_key
              AND ir.status = 'succeeded'
            ORDER BY rsi.captured_at_utc DESC, rsi.realtime_snapshot_id DESC
            LIMIT 1
            """
        ),
        {"provider_id": provider_id, "endpoint_key": endpoint_key},
    ).mappings().one_or_none()

    if snapshot_row is None:
        raise ValueError(
            "No successful Bronze realtime snapshot was found for this provider and endpoint. "
            "Run capture-realtime before load-realtime-silver."
        )
    return _row_to_bronze_realtime_snapshot(
        snapshot_row,
        settings=settings,
        project_root=project_root,
    )


def find_realtime_bronze_snapshots(
    connection: Connection,
    *,
    provider_id: str,
    start_utc: datetime,
    end_utc: datetime,
    settings: Settings,
    project_root: Path,
) -> list[BronzeRealtimeSnapshot]:
    rows = connection.execute(
        SELECT_REALTIME_SNAPSHOTS_IN_WINDOW,
        {"provider_id": provider_id, "start_utc": start_utc, "end_utc": end_utc},
    ).mappings()
    return [
        _row_to_bronze_realtime_snapshot(row, settings=settings, project_root=project_root)
        for row in rows
    ]


def _snapshot_loaded(
    connection: Connection,
    *,
    endpoint_key: str,
    realtime_snapshot_id: int,
) -> bool:
    table_name = "trip_updates" if endpoint_key == "trip_updates" else "vehicle_positions"
    existing_rows = connection.execute(
        text(
            f"""
            SELECT count(*)
            FROM silver.{table_name}
            WHERE realtime_snapshot_id = :realtime_snapshot_id
            """
        ),
        {"realtime_snapshot_id": realtime_snapshot_id},
    ).scalar_one()
    return bool(int(existing_rows))


def _silver_row_count(
    connection: Connection,
    *,
    table_name: str,
    realtime_snapshot_id: int,
) -> int:
    return int(
        connection.execute(
            text(
                f"""
                SELECT count(*)
                FROM silver.{table_name}
                WHERE realtime_snapshot_id = :realtime_snapshot_id
                """
            ),
            {"realtime_snapshot_id": realtime_snapshot_id},
        ).scalar_one()
    )


def _rt_feed_snapshot_id(
    connection: Connection,
    *,
    ingestion_run_id: int,
) -> int | None:
    result = connection.execute(
        text(
            """
            SELECT rt_feed_snapshot_id
            FROM silver.rt_feed_snapshots
            WHERE ingestion_run_id = :ingestion_run_id
            """
        ),
        {"ingestion_run_id": ingestion_run_id},
    ).scalar_one_or_none()
    return int(result) if result is not None else None


def _rt_child_row_count(
    connection: Connection,
    *,
    table_name: str,
    rt_feed_snapshot_id: int,
) -> int:
    return int(
        connection.execute(
            text(
                f"""
                SELECT count(*)
                FROM silver.{table_name}
                WHERE rt_feed_snapshot_id = :rt_feed_snapshot_id
                """
            ),
            {"rt_feed_snapshot_id": rt_feed_snapshot_id},
        ).scalar_one()
    )


def _ensure_snapshot_not_loaded(
    connection: Connection,
    *,
    snapshot: BronzeRealtimeSnapshot,
) -> None:
    source_snapshot_id = _rt_feed_snapshot_id(
        connection,
        ingestion_run_id=snapshot.ingestion_run_id,
    )
    if source_snapshot_id is not None:
        raise ValueError(
            f"Bronze realtime snapshot {snapshot.realtime_snapshot_id} was already loaded into "
            f"silver.rt_feed_snapshots as rt_feed_snapshot_id {source_snapshot_id}."
        )

    endpoint_key = snapshot.endpoint_key
    realtime_snapshot_id = snapshot.realtime_snapshot_id
    table_name = "trip_updates" if endpoint_key == "trip_updates" else "vehicle_positions"
    if _snapshot_loaded(
        connection,
        endpoint_key=endpoint_key,
        realtime_snapshot_id=realtime_snapshot_id,
    ):
        raise ValueError(
            f"Bronze realtime snapshot {realtime_snapshot_id} was already loaded into "
            f"silver.{table_name}."
        )


def normalize_trip_updates(
    message: gtfs_realtime_pb2.FeedMessage,
    *,
    snapshot: BronzeRealtimeSnapshot,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    trip_update_rows: list[dict[str, object]] = []
    stop_time_rows: list[dict[str, object]] = []

    for entity_index, entity in enumerate(message.entity):
        if not _has_field(entity, "trip_update"):
            continue

        trip_update = entity.trip_update
        trip_descriptor = trip_update.trip
        vehicle_descriptor = trip_update.vehicle

        trip_update_rows.append(
            {
                "realtime_snapshot_id": snapshot.realtime_snapshot_id,
                "entity_index": entity_index,
                "provider_id": snapshot.provider_id,
                "entity_id": _blank_to_none(entity.id),
                "trip_id": _blank_to_none(trip_descriptor.trip_id),
                "route_id": _blank_to_none(trip_descriptor.route_id),
                "direction_id": trip_descriptor.direction_id
                if _has_field(trip_descriptor, "direction_id")
                else None,
                "start_date": _parse_optional_gtfs_date(trip_descriptor.start_date),
                "vehicle_id": _blank_to_none(vehicle_descriptor.id),
                "trip_schedule_relationship": trip_descriptor.schedule_relationship
                if _has_field(trip_descriptor, "schedule_relationship")
                else None,
                "delay_seconds": trip_update.delay if _has_field(trip_update, "delay") else None,
                "feed_timestamp_utc": snapshot.feed_timestamp_utc,
                "captured_at_utc": snapshot.captured_at_utc,
            }
        )

        for stop_time_update_index, stop_time_update in enumerate(trip_update.stop_time_update):
            arrival = stop_time_update.arrival
            departure = stop_time_update.departure
            stop_time_rows.append(
                {
                    "realtime_snapshot_id": snapshot.realtime_snapshot_id,
                    "trip_update_entity_index": entity_index,
                    "stop_time_update_index": stop_time_update_index,
                    "provider_id": snapshot.provider_id,
                    "stop_sequence": stop_time_update.stop_sequence
                    if _has_field(stop_time_update, "stop_sequence")
                    else None,
                    "stop_id": _blank_to_none(stop_time_update.stop_id),
                    "arrival_delay_seconds": (
                        arrival.delay if _has_field(arrival, "delay") else None
                    ),
                    "arrival_time_utc": _parse_optional_timestamp(arrival.time)
                    if _has_field(arrival, "time")
                    else None,
                    "departure_delay_seconds": departure.delay
                    if _has_field(departure, "delay")
                    else None,
                    "departure_time_utc": _parse_optional_timestamp(departure.time)
                    if _has_field(departure, "time")
                    else None,
                    "schedule_relationship": stop_time_update.schedule_relationship
                    if _has_field(stop_time_update, "schedule_relationship")
                    else None,
                }
            )

    return trip_update_rows, stop_time_rows


def normalize_vehicle_positions(
    message: gtfs_realtime_pb2.FeedMessage,
    *,
    snapshot: BronzeRealtimeSnapshot,
) -> list[dict[str, object]]:
    vehicle_rows: list[dict[str, object]] = []

    for entity_index, entity in enumerate(message.entity):
        if not _has_field(entity, "vehicle"):
            continue

        vehicle = entity.vehicle
        trip = vehicle.trip
        descriptor = vehicle.vehicle
        position = vehicle.position

        vehicle_rows.append(
            {
                "realtime_snapshot_id": snapshot.realtime_snapshot_id,
                "entity_index": entity_index,
                "provider_id": snapshot.provider_id,
                "entity_id": _blank_to_none(entity.id),
                "vehicle_id": _blank_to_none(descriptor.id),
                "trip_id": _blank_to_none(trip.trip_id),
                "route_id": _blank_to_none(trip.route_id),
                "stop_id": _blank_to_none(vehicle.stop_id),
                "current_stop_sequence": vehicle.current_stop_sequence
                if _has_field(vehicle, "current_stop_sequence")
                else None,
                "current_status": vehicle.current_status
                if _has_field(vehicle, "current_status")
                else None,
                "occupancy_status": vehicle.occupancy_status
                if _has_field(vehicle, "occupancy_status")
                else None,
                "latitude": position.latitude if _has_field(vehicle, "position") else None,
                "longitude": position.longitude if _has_field(vehicle, "position") else None,
                "bearing": position.bearing
                if _has_field(vehicle, "position") and _has_field(position, "bearing")
                else None,
                "speed": position.speed
                if _has_field(vehicle, "position") and _has_field(position, "speed")
                else None,
                "position_timestamp_utc": _parse_optional_timestamp(vehicle.timestamp)
                if _has_field(vehicle, "timestamp")
                else None,
                "feed_timestamp_utc": snapshot.feed_timestamp_utc,
                "captured_at_utc": snapshot.captured_at_utc,
            }
        )

    return vehicle_rows


def _insert_rt_feed_snapshot(
    connection: Connection,
    *,
    snapshot: BronzeRealtimeSnapshot,
    message: gtfs_realtime_pb2.FeedMessage,
) -> int:
    header = message.header
    return int(
        connection.execute(
            RT_FEED_SNAPSHOTS_INSERT,
            {
                "provider_id": snapshot.provider_id,
                "feed_endpoint_id": snapshot.feed_endpoint_id,
                "ingestion_run_id": snapshot.ingestion_run_id,
                "ingestion_object_id": snapshot.ingestion_object_id,
                "endpoint_key": snapshot.endpoint_key,
                "gtfs_realtime_version": _blank_to_none(header.gtfs_realtime_version),
                "incrementality": _feed_incrementality_name(header),
                "feed_timestamp_utc": snapshot.feed_timestamp_utc,
                "captured_at_utc": snapshot.captured_at_utc,
                "source_url": snapshot.source_url,
                "storage_backend": snapshot.storage_backend,
                "storage_path": snapshot.storage_path,
                "checksum_sha256": snapshot.checksum_sha256,
                "byte_size": snapshot.byte_size,
                "parser_version": PARSER_VERSION,
                "manifest_json": {
                    "source_realtime_snapshot_id": snapshot.realtime_snapshot_id,
                    "archive_full_path": snapshot.archive_full_path,
                    "entity_count": len(message.entity),
                },
            },
        ).scalar_one()
    )


def _normalize_rt_entities(
    message: gtfs_realtime_pb2.FeedMessage,
    *,
    snapshot: BronzeRealtimeSnapshot,
    rt_feed_snapshot_id: int,
) -> list[dict[str, object]]:
    return [
        {
            "rt_feed_snapshot_id": rt_feed_snapshot_id,
            "entity_index": entity_index,
            "provider_id": snapshot.provider_id,
            "entity_id": _blank_to_none(entity.id),
            "entity_kind": _entity_kind(entity),
            "is_deleted": bool(entity.is_deleted) if _has_field(entity, "is_deleted") else False,
            "raw_entity_json": _raw_entity_manifest(entity),
        }
        for entity_index, entity in enumerate(message.entity)
    ]


def _normalize_rt_trip_updates(
    message: gtfs_realtime_pb2.FeedMessage,
    *,
    snapshot: BronzeRealtimeSnapshot,
    rt_feed_snapshot_id: int,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    trip_update_rows: list[dict[str, object]] = []
    stop_time_rows: list[dict[str, object]] = []

    for entity_index, entity in enumerate(message.entity):
        if not _has_field(entity, "trip_update"):
            continue

        trip_update = entity.trip_update
        trip_descriptor = trip_update.trip
        trip_update_rows.append(
            {
                "rt_feed_snapshot_id": rt_feed_snapshot_id,
                "entity_index": entity_index,
                "provider_id": snapshot.provider_id,
                "trip_id": _blank_to_none(trip_descriptor.trip_id),
                "route_id": _blank_to_none(trip_descriptor.route_id),
                "direction_id": trip_descriptor.direction_id
                if _has_field(trip_descriptor, "direction_id")
                else None,
                "start_date": _parse_optional_gtfs_date(trip_descriptor.start_date),
                "schedule_relationship": trip_descriptor.schedule_relationship
                if _has_field(trip_descriptor, "schedule_relationship")
                else None,
                "trip_update_timestamp_utc": _parse_optional_timestamp(trip_update.timestamp)
                if _has_field(trip_update, "timestamp")
                else None,
                "feed_timestamp_utc": snapshot.feed_timestamp_utc,
                "captured_at_utc": snapshot.captured_at_utc,
            }
        )

        for stop_time_update_index, stop_time_update in enumerate(trip_update.stop_time_update):
            arrival = stop_time_update.arrival
            departure = stop_time_update.departure
            stop_time_rows.append(
                {
                    "rt_feed_snapshot_id": rt_feed_snapshot_id,
                    "entity_index": entity_index,
                    "stop_time_update_index": stop_time_update_index,
                    "provider_id": snapshot.provider_id,
                    "stop_sequence": stop_time_update.stop_sequence
                    if _has_field(stop_time_update, "stop_sequence")
                    else None,
                    "stop_id": _blank_to_none(stop_time_update.stop_id),
                    "arrival_time_utc": _parse_optional_timestamp(arrival.time)
                    if _has_field(arrival, "time")
                    else None,
                    "departure_time_utc": _parse_optional_timestamp(departure.time)
                    if _has_field(departure, "time")
                    else None,
                    "schedule_relationship": stop_time_update.schedule_relationship
                    if _has_field(stop_time_update, "schedule_relationship")
                    else None,
                }
            )

    return trip_update_rows, stop_time_rows


def _normalize_rt_vehicle_positions(
    message: gtfs_realtime_pb2.FeedMessage,
    *,
    snapshot: BronzeRealtimeSnapshot,
    rt_feed_snapshot_id: int,
) -> list[dict[str, object]]:
    vehicle_rows: list[dict[str, object]] = []

    for entity_index, entity in enumerate(message.entity):
        if not _has_field(entity, "vehicle"):
            continue

        vehicle = entity.vehicle
        trip = vehicle.trip
        descriptor = vehicle.vehicle
        position = vehicle.position
        latitude = position.latitude if _has_field(vehicle, "position") else None
        longitude = position.longitude if _has_field(vehicle, "position") else None
        vehicle_rows.append(
            {
                "rt_feed_snapshot_id": rt_feed_snapshot_id,
                "entity_index": entity_index,
                "provider_id": snapshot.provider_id,
                "vehicle_id": _blank_to_none(descriptor.id),
                "trip_id": _blank_to_none(trip.trip_id),
                "route_id": _blank_to_none(trip.route_id),
                "direction_id": trip.direction_id if _has_field(trip, "direction_id") else None,
                "start_time": _blank_to_none(trip.start_time),
                "start_date": _parse_optional_gtfs_date(trip.start_date),
                "latitude": latitude,
                "longitude": longitude,
                "bearing": position.bearing
                if _has_field(vehicle, "position") and _has_field(position, "bearing")
                else None,
                "speed": position.speed
                if _has_field(vehicle, "position") and _has_field(position, "speed")
                else None,
                "stop_id": _blank_to_none(vehicle.stop_id),
                "current_stop_sequence": vehicle.current_stop_sequence
                if _has_field(vehicle, "current_stop_sequence")
                else None,
                "current_status": vehicle.current_status
                if _has_field(vehicle, "current_status")
                else None,
                "occupancy_status": vehicle.occupancy_status
                if _has_field(vehicle, "occupancy_status")
                else None,
                "congestion_level": vehicle.congestion_level
                if _has_field(vehicle, "congestion_level")
                else None,
                "vehicle_timestamp_utc": _parse_optional_timestamp(vehicle.timestamp)
                if _has_field(vehicle, "timestamp")
                else None,
                "position_quality": classify_montreal_position_quality(latitude, longitude),
                "feed_timestamp_utc": snapshot.feed_timestamp_utc,
                "captured_at_utc": snapshot.captured_at_utc,
            }
        )

    return vehicle_rows


def _read_bronze_realtime_message(
    *,
    snapshot: BronzeRealtimeSnapshot,
    bronze_storage,
) -> gtfs_realtime_pb2.FeedMessage:
    if not bronze_storage.exists(snapshot.storage_path):
        raise FileNotFoundError(
            "Bronze realtime archive file not found: "
            f"{bronze_storage.describe_location(snapshot.storage_path)}"
        )

    message = gtfs_realtime_pb2.FeedMessage()
    try:
        message.ParseFromString(bronze_storage.read_bytes(snapshot.storage_path))
    except Exception as exc:
        raise ValueError(f"Failed to parse GTFS-RT Bronze snapshot: {exc}") from exc
    return message


def _expected_realtime_row_counts(
    message: gtfs_realtime_pb2.FeedMessage,
    *,
    snapshot: BronzeRealtimeSnapshot,
) -> dict[str, int]:
    rt_entity_count = len(message.entity)
    if snapshot.endpoint_key == "trip_updates":
        trip_update_rows, stop_time_rows = normalize_trip_updates(message, snapshot=snapshot)
        return {
            "rt_feed_snapshots": 1,
            "rt_entities": rt_entity_count,
            "rt_trip_updates": len(trip_update_rows),
            "rt_trip_update_stop_times": len(stop_time_rows),
            "trip_updates": len(trip_update_rows),
            "trip_update_stop_time_updates": len(stop_time_rows),
        }
    if snapshot.endpoint_key == "vehicle_positions":
        vehicle_rows = normalize_vehicle_positions(message, snapshot=snapshot)
        return {
            "rt_feed_snapshots": 1,
            "rt_entities": rt_entity_count,
            "rt_vehicle_positions": len(vehicle_rows),
            "vehicle_positions": len(vehicle_rows),
        }
    raise ValueError(f"Unsupported realtime endpoint '{snapshot.endpoint_key}'.")


def _actual_realtime_row_counts(
    connection: Connection,
    *,
    snapshot: BronzeRealtimeSnapshot,
) -> dict[str, int]:
    rt_snapshot_id = _rt_feed_snapshot_id(
        connection,
        ingestion_run_id=snapshot.ingestion_run_id,
    )
    source_counts = {"rt_feed_snapshots": 1 if rt_snapshot_id is not None else 0}
    if snapshot.endpoint_key == "trip_updates":
        source_counts.update(
            {
                "rt_entities": _rt_child_row_count(
                    connection,
                    table_name="rt_entities",
                    rt_feed_snapshot_id=rt_snapshot_id,
                )
                if rt_snapshot_id is not None
                else 0,
                "rt_trip_updates": _rt_child_row_count(
                    connection,
                    table_name="rt_trip_updates",
                    rt_feed_snapshot_id=rt_snapshot_id,
                )
                if rt_snapshot_id is not None
                else 0,
                "rt_trip_update_stop_times": _rt_child_row_count(
                    connection,
                    table_name="rt_trip_update_stop_times",
                    rt_feed_snapshot_id=rt_snapshot_id,
                )
                if rt_snapshot_id is not None
                else 0,
            }
        )
        source_counts.update(
            {
                "trip_updates": _silver_row_count(
                    connection,
                    table_name="trip_updates",
                    realtime_snapshot_id=snapshot.realtime_snapshot_id,
                ),
                "trip_update_stop_time_updates": _silver_row_count(
                    connection,
                    table_name="trip_update_stop_time_updates",
                    realtime_snapshot_id=snapshot.realtime_snapshot_id,
                ),
            }
        )
        return source_counts
    if snapshot.endpoint_key == "vehicle_positions":
        source_counts.update(
            {
                "rt_entities": _rt_child_row_count(
                    connection,
                    table_name="rt_entities",
                    rt_feed_snapshot_id=rt_snapshot_id,
                )
                if rt_snapshot_id is not None
                else 0,
                "rt_vehicle_positions": _rt_child_row_count(
                    connection,
                    table_name="rt_vehicle_positions",
                    rt_feed_snapshot_id=rt_snapshot_id,
                )
                if rt_snapshot_id is not None
                else 0,
            }
        )
        source_counts.update(
            {
                "vehicle_positions": _silver_row_count(
                    connection,
                    table_name="vehicle_positions",
                    realtime_snapshot_id=snapshot.realtime_snapshot_id,
                )
            }
        )
        return source_counts
    raise ValueError(f"Unsupported realtime endpoint '{snapshot.endpoint_key}'.")


def _is_complete_existing_load(
    connection: Connection,
    *,
    snapshot: BronzeRealtimeSnapshot,
    message: gtfs_realtime_pb2.FeedMessage,
) -> bool:
    expected_counts = _expected_realtime_row_counts(message, snapshot=snapshot)
    actual_counts = _actual_realtime_row_counts(connection, snapshot=snapshot)
    if actual_counts == expected_counts:
        return True
    if any(actual_counts.values()):
        raise ValueError(
            f"Incomplete Silver load for Bronze realtime snapshot {snapshot.realtime_snapshot_id}: "
            f"expected {expected_counts}, found {actual_counts}."
        )
    return False


def _load_realtime_message_to_silver(
    connection: Connection,
    *,
    snapshot: BronzeRealtimeSnapshot,
    message: gtfs_realtime_pb2.FeedMessage,
) -> RealtimeSilverLoadResult:
    if snapshot.endpoint_key not in {"trip_updates", "vehicle_positions"}:
        raise ValueError(f"Unsupported realtime endpoint '{snapshot.endpoint_key}'.")

    rt_feed_snapshot_id = _insert_rt_feed_snapshot(
        connection,
        snapshot=snapshot,
        message=message,
    )
    rt_entity_rows = _normalize_rt_entities(
        message,
        snapshot=snapshot,
        rt_feed_snapshot_id=rt_feed_snapshot_id,
    )
    row_counts = {
        "rt_feed_snapshots": 1,
        "rt_entities": _execute_batched_insert(
            connection,
            statement=RT_ENTITIES_INSERT,
            rows=rt_entity_rows,
        ),
    }

    if snapshot.endpoint_key == "trip_updates":
        rt_trip_update_rows, rt_stop_time_rows = _normalize_rt_trip_updates(
            message,
            snapshot=snapshot,
            rt_feed_snapshot_id=rt_feed_snapshot_id,
        )
        trip_update_rows, stop_time_rows = normalize_trip_updates(message, snapshot=snapshot)
        row_counts.update(
            {
                "rt_trip_updates": _execute_batched_insert(
                    connection,
                    statement=RT_TRIP_UPDATES_INSERT,
                    rows=rt_trip_update_rows,
                ),
                "rt_trip_update_stop_times": _execute_batched_insert(
                    connection,
                    statement=RT_TRIP_UPDATE_STOP_TIMES_INSERT,
                    rows=rt_stop_time_rows,
                ),
                "trip_updates": _execute_batched_insert(
                    connection,
                    statement=TRIP_UPDATES_INSERT,
                    rows=trip_update_rows,
                ),
                "trip_update_stop_time_updates": _execute_batched_insert(
                    connection,
                    statement=TRIP_UPDATE_STOP_TIMES_INSERT,
                    rows=stop_time_rows,
                ),
            }
        )
    elif snapshot.endpoint_key == "vehicle_positions":
        rt_vehicle_rows = _normalize_rt_vehicle_positions(
            message,
            snapshot=snapshot,
            rt_feed_snapshot_id=rt_feed_snapshot_id,
        )
        vehicle_rows = normalize_vehicle_positions(message, snapshot=snapshot)
        row_counts.update(
            {
                "rt_vehicle_positions": _execute_batched_insert(
                    connection,
                    statement=RT_VEHICLE_POSITIONS_INSERT,
                    rows=rt_vehicle_rows,
                ),
                "vehicle_positions": _execute_batched_insert(
                    connection,
                    statement=VEHICLE_POSITIONS_INSERT,
                    rows=vehicle_rows,
                ),
            }
        )

    return RealtimeSilverLoadResult(
        provider_id=snapshot.provider_id,
        endpoint_key=snapshot.endpoint_key,
        realtime_snapshot_id=snapshot.realtime_snapshot_id,
        source_ingestion_run_id=snapshot.ingestion_run_id,
        source_ingestion_object_id=snapshot.ingestion_object_id,
        storage_path=snapshot.storage_path,
        archive_full_path=snapshot.archive_full_path,
        content_hash=snapshot.checksum_sha256,
        feed_timestamp_utc=snapshot.feed_timestamp_utc,
        captured_at_utc=snapshot.captured_at_utc,
        row_counts=row_counts,
    )


def load_realtime_snapshot_to_silver(
    connection: Connection,
    *,
    snapshot: BronzeRealtimeSnapshot,
    bronze_storage,
) -> RealtimeSilverLoadResult:
    if not bronze_storage.exists(snapshot.storage_path):
        raise FileNotFoundError(
            "Bronze realtime archive file not found: "
            f"{bronze_storage.describe_location(snapshot.storage_path)}"
        )
    _ensure_snapshot_not_loaded(
        connection,
        snapshot=snapshot,
    )
    message = _read_bronze_realtime_message(snapshot=snapshot, bronze_storage=bronze_storage)
    return _load_realtime_message_to_silver(
        connection,
        snapshot=snapshot,
        message=message,
    )


def load_realtime_snapshots_to_silver(
    connection: Connection,
    *,
    provider_id: str,
    snapshots: list[BronzeRealtimeSnapshot],
    bronze_storage,
    skip_existing: bool = False,
) -> RealtimeSilverBatchLoadResult:
    results: list[RealtimeSilverLoadResult] = []
    skipped_existing_snapshot_ids: list[int] = []
    row_counts: dict[str, int] = {}

    for snapshot in snapshots:
        message = None
        if skip_existing:
            message = _read_bronze_realtime_message(
                snapshot=snapshot,
                bronze_storage=bronze_storage,
            )
            if _is_complete_existing_load(
                connection,
                snapshot=snapshot,
                message=message,
            ):
                skipped_existing_snapshot_ids.append(snapshot.realtime_snapshot_id)
                continue

        if message is None:
            result = load_realtime_snapshot_to_silver(
                connection,
                snapshot=snapshot,
                bronze_storage=bronze_storage,
            )
        else:
            _ensure_snapshot_not_loaded(
                connection,
                snapshot=snapshot,
            )
            result = _load_realtime_message_to_silver(
                connection,
                snapshot=snapshot,
                message=message,
            )
        results.append(result)
        for table_name, count in result.row_counts.items():
            row_counts[table_name] = row_counts.get(table_name, 0) + count

    return RealtimeSilverBatchLoadResult(
        provider_id=provider_id,
        loaded_count=len(results),
        skipped_existing_snapshot_ids=skipped_existing_snapshot_ids,
        row_counts=row_counts,
        results=results,
    )


def load_latest_realtime_to_silver(
    provider_id: str,
    endpoint_key: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> RealtimeSilverLoadResult:
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(
        project_root=_project_root(),
        settings=settings,
    )
    manifest = registry.get_provider(provider_id)
    realtime_feed = manifest.realtime_feed(endpoint_key)
    engine = engine or make_engine(settings)

    with engine.connect() as connection:
        snapshot = find_latest_realtime_bronze_snapshot(
            connection,
            provider_id=manifest.provider.provider_id,
            endpoint_key=realtime_feed.endpoint_key,
            settings=settings,
            project_root=_project_root(),
        )
    bronze_storage = get_bronze_storage(
        settings,
        project_root=_project_root(),
        storage_backend=snapshot.storage_backend,
    )

    with engine.begin() as connection:
        return load_realtime_snapshot_to_silver(
            connection,
            snapshot=snapshot,
            bronze_storage=bronze_storage,
        )
