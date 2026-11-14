"""Parse verified captures into the same child rows Silver stores, without I/O."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from types import MappingProxyType

from google.protobuf.message import DecodeError  # type: ignore[import-untyped]
from google.transit import gtfs_realtime_pb2

from transit_ops.core.models import ProviderManifest
from transit_ops.gtfs.types import ProviderBounds
from transit_ops.history.poll_record import CaptureEntry
from transit_ops.silver.realtime_gtfs import (
    RealtimeNormalizationContext,
    manifest_provider_bounds,
    normalize_realtime_message,
)


class CaptureIntegrityError(ValueError):
    """The payload differs from the capture record."""


class CaptureParseError(ValueError):
    """The verified payload is not a protobuf feed message."""


@dataclass(frozen=True)
class CaptureRef:
    provider_id: str
    endpoint_key: str
    capture_row_id: int
    captured_at_utc: datetime
    feed_timestamp_utc: datetime
    byte_size: int
    sha256: str

    @classmethod
    def from_entry(cls, entry: CaptureEntry, *, provider_id: str, endpoint_key: str) -> CaptureRef:
        return cls(
            provider_id,
            endpoint_key,
            entry.capture_row_id,
            entry.captured_at_utc,
            entry.feed_timestamp_utc,
            entry.byte_size,
            entry.sha256,
        )


@dataclass(frozen=True)
class ParsePolicy:
    provider_bounds: ProviderBounds | None
    max_vehicle_speed_kmh: float

    @classmethod
    def from_manifest(cls, manifest: ProviderManifest) -> ParsePolicy:
        return cls(manifest_provider_bounds(manifest), manifest.provider.max_vehicle_speed_kmh)


@dataclass(frozen=True)
class Frame:
    table: str
    columns: tuple[str, ...]
    rows: tuple[tuple[object, ...], ...]

    def column(self, name: str) -> list[object]:
        index = self.columns.index(name)
        return [row[index] for row in self.rows]


@dataclass(frozen=True)
class ParsedCapture:
    capture: CaptureRef
    gtfs_realtime_version: str | None
    incrementality: str | None
    entity_count: int
    frames: Mapping[str, Frame]


FRAME_COLUMNS: Mapping[str, tuple[str, ...]] = MappingProxyType(
    {
        "rt_entities": tuple(
            "entity_index entity_id entity_kind is_deleted raw_entity_json".split()
        ),
        "rt_trip_updates": tuple(
            "entity_index trip_id route_id direction_id start_date schedule_relationship "
            "trip_update_timestamp_utc feed_timestamp_utc captured_at_utc".split()
        ),
        "rt_trip_update_stop_times": tuple(
            "entity_index stop_time_update_index stop_sequence stop_id arrival_time_utc "
            "departure_time_utc schedule_relationship".split()
        ),
        "rt_vehicle_positions": tuple(
            "entity_index vehicle_id trip_id route_id direction_id start_time start_date latitude "
            "longitude bearing speed stop_id current_stop_sequence current_status occupancy_status "
            "congestion_level vehicle_timestamp_utc position_quality feed_timestamp_utc "
            "captured_at_utc".split()
        ),
    }
)


def parse_capture(payload: bytes, capture: CaptureRef, policy: ParsePolicy) -> ParsedCapture:
    if len(payload) != capture.byte_size:
        raise CaptureIntegrityError("Capture byte size mismatch")
    if sha256(payload).hexdigest() != capture.sha256.lower():
        raise CaptureIntegrityError("Capture checksum mismatch")
    message = gtfs_realtime_pb2.FeedMessage()
    try:
        message.ParseFromString(payload)
    except DecodeError as exc:
        raise CaptureParseError("Failed to parse GTFS-RT capture") from exc
    context = RealtimeNormalizationContext(
        capture.provider_id,
        capture.endpoint_key,
        capture.feed_timestamp_utc,
        capture.captured_at_utc,
    )
    rows = normalize_realtime_message(
        message,
        context=context,
        rt_feed_snapshot_id=capture.capture_row_id,
        provider_bounds=policy.provider_bounds,
        max_vehicle_speed_kmh=policy.max_vehicle_speed_kmh,
    )
    frames = {
        table: Frame(
            table,
            FRAME_COLUMNS[table],
            tuple(tuple(row[column] for column in FRAME_COLUMNS[table]) for row in values),
        )
        for table, values in rows.items()
    }
    header = message.header
    incrementality = (
        gtfs_realtime_pb2.FeedHeader.Incrementality.Name(header.incrementality)
        if header.HasField("incrementality")
        else None
    )
    return ParsedCapture(
        capture,
        header.gtfs_realtime_version.strip() or None,
        incrementality,
        len(message.entity),
        MappingProxyType(frames),
    )
