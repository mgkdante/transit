"""Bronze ingestion services."""

from transit_ops.ingestion.realtime_gtfs import (
    RealtimeIngestionConfig,
    RealtimeIngestionResult,
    build_realtime_ingestion_config,
    build_realtime_object_storage_path,
    capture_realtime_feed,
    extract_realtime_metadata,
)
from transit_ops.ingestion.static_gtfs import (
    StaticIngestionConfig,
    StaticIngestionResult,
    build_static_ingestion_config,
    build_static_object_storage_path,
    ingest_static_feed,
)

__all__ = [
    "StaticIngestionConfig",
    "StaticIngestionResult",
    "RealtimeIngestionConfig",
    "RealtimeIngestionResult",
    "build_realtime_ingestion_config",
    "build_realtime_object_storage_path",
    "build_static_ingestion_config",
    "build_static_object_storage_path",
    "capture_realtime_feed",
    "extract_realtime_metadata",
    "ingest_static_feed",
]
