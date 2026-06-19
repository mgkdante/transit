"""Bronze ingestion services."""

from transit_ops.ingestion.gis import (
    GisIngestionConfig,
    GisIngestionResult,
    build_gis_ingestion_config,
    build_gis_object_storage_path,
    ingest_gis_feed,
)
from transit_ops.ingestion.i3 import (
    I3IngestionConfig,
    I3IngestionResult,
    build_i3_ingestion_config,
    build_i3_object_storage_path,
    build_service_alerts_ingestion_config,
    capture_i3_alerts,
    capture_service_alerts,
    extract_i3_metadata,
    extract_service_alerts_metadata,
)
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
    "GisIngestionConfig",
    "GisIngestionResult",
    "I3IngestionConfig",
    "I3IngestionResult",
    "StaticIngestionConfig",
    "StaticIngestionResult",
    "RealtimeIngestionConfig",
    "RealtimeIngestionResult",
    "build_gis_ingestion_config",
    "build_gis_object_storage_path",
    "build_i3_ingestion_config",
    "build_i3_object_storage_path",
    "build_realtime_ingestion_config",
    "build_realtime_object_storage_path",
    "build_static_ingestion_config",
    "build_static_object_storage_path",
    "build_service_alerts_ingestion_config",
    "capture_i3_alerts",
    "capture_realtime_feed",
    "capture_service_alerts",
    "extract_service_alerts_metadata",
    "extract_i3_metadata",
    "extract_realtime_metadata",
    "ingest_gis_feed",
    "ingest_static_feed",
]
