from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from itertools import islice
from pathlib import Path

from google.transit import gtfs_realtime_pb2
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import project_root
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings

CHUNK_SIZE = 10_000

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


def _project_root() -> Path:
    return project_root()


def _blank_to_none(value: str) -> str | None:
    stripped = value.strip()
    return stripped or None


def _parse_optional_gtfs_date(value: str) -> date | None:
    normalized = _blank_to_none(value)
    if normalized is None:
        return None
    try:
        return datetime.strptime(normalized, "%Y%m%d").date()
    except ValueError as exc:
        raise ValueError(f"GTFS-RT date '{normalized}' must be in YYYYMMDD format.") from exc


def _parse_optional_timestamp(timestamp: int | None) -> datetime | None:
    if not timestamp:
        return None
    try:
        return datetime.fromtimestamp(int(timestamp), tz=UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise ValueError(f"GTFS-RT timestamp '{timestamp}' is malformed.") from exc


def _has_field(message, field_name: str) -> bool:  # noqa: ANN001
    try:
        return message.HasField(field_name)
    except ValueError:
        return False


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
    bronze_storage = get_bronze_storage(
        settings,
        project_root=project_root,
        storage_backend=str(snapshot_row["storage_backend"]),
    )

    return BronzeRealtimeSnapshot(
        provider_id=str(snapshot_row["provider_id"]),
        endpoint_key=str(snapshot_row["endpoint_key"]),
        storage_backend=str(snapshot_row["storage_backend"]),
        feed_endpoint_id=int(snapshot_row["feed_endpoint_id"]),
        ingestion_run_id=int(snapshot_row["ingestion_run_id"]),
        ingestion_object_id=int(snapshot_row["ingestion_object_id"]),
        realtime_snapshot_id=int(snapshot_row["realtime_snapshot_id"]),
        storage_path=str(snapshot_row["storage_path"]),
        archive_full_path=bronze_storage.describe_location(str(snapshot_row["storage_path"])),
        source_url=str(snapshot_row["source_url"]) if snapshot_row["source_url"] else None,
        checksum_sha256=str(snapshot_row["checksum_sha256"]),
        byte_size=int(snapshot_row["byte_size"]) if snapshot_row["byte_size"] is not None else None,
        feed_timestamp_utc=snapshot_row["feed_timestamp_utc"],
        captured_at_utc=snapshot_row["captured_at_utc"],
    )


def _ensure_snapshot_not_loaded(
    connection: Connection,
    *,
    endpoint_key: str,
    realtime_snapshot_id: int,
) -> None:
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
    if int(existing_rows):
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
        endpoint_key=snapshot.endpoint_key,
        realtime_snapshot_id=snapshot.realtime_snapshot_id,
    )

    message = gtfs_realtime_pb2.FeedMessage()
    try:
        message.ParseFromString(bronze_storage.read_bytes(snapshot.storage_path))
    except Exception as exc:
        raise ValueError(f"Failed to parse GTFS-RT Bronze snapshot: {exc}") from exc

    if snapshot.endpoint_key == "trip_updates":
        trip_update_rows, stop_time_rows = normalize_trip_updates(message, snapshot=snapshot)
        row_counts = {
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
    elif snapshot.endpoint_key == "vehicle_positions":
        vehicle_rows = normalize_vehicle_positions(message, snapshot=snapshot)
        row_counts = {
            "vehicle_positions": _execute_batched_insert(
                connection,
                statement=VEHICLE_POSITIONS_INSERT,
                rows=vehicle_rows,
            )
        }
    else:
        raise ValueError(f"Unsupported realtime endpoint '{snapshot.endpoint_key}'.")

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
