from collections.abc import Callable
from datetime import date, datetime
from pathlib import Path
from typing import assert_type

from sqlalchemy.engine import Connection, Engine

from transit_ops.ingestion.i3 import I3IngestionResult
from transit_ops.ingestion.realtime_gtfs import RealtimeIngestionResult
from transit_ops.ingestion.static_gtfs import StaticIngestionResult
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings
from transit_ops.silver.i3 import I3SilverLoadResult
from transit_ops.silver.realtime_gtfs import RealtimeSilverLoadResult
from transit_ops.silver.static_gtfs import StaticSilverLoadResult
from transit_ops.source_factory.r2 import R2CleanupStorage, R2PruneCycleResult
from transit_ops.source_factory.runner import SourceFactoryOperationImpls


def check_operation_contracts(
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
    connection: Connection,
    storage: R2CleanupStorage,
    artifact_dir: Path,
    clock: Callable[[], datetime],
) -> None:
    operations = SourceFactoryOperationImpls()
    assert_type(operations.reset_tables(connection, "stm"), dict[str, object])
    assert_type(
        operations.r2_prune_cycle(
            storage,
            provider_id="stm",
            keep_from_date=date(2026, 5, 1),
            artifact_dir=artifact_dir,
            endpoint_keys=("static_schedule", "trip_updates", "i3_alerts"),
            execute=False,
            confirm_r2_cleanup=False,
            active_prefix_wipe=False,
            confirm_active_prefix_wipe=False,
            clock=clock,
        ),
        R2PruneCycleResult,
    )
    static_capture = operations.ingest_static_feed(
        "stm", settings=settings, registry=registry, engine=engine
    )
    assert_type(static_capture, StaticIngestionResult)
    assert_type(static_capture.checksum_sha256, str)
    assert_type(
        operations.load_latest_static_to_silver(
            "stm",
            expected_checksum_sha256=static_capture.checksum_sha256,
            settings=settings,
            registry=registry,
            engine=engine,
        ),
        StaticSilverLoadResult,
    )
    realtime_capture = operations.capture_realtime_feed(
        "stm", endpoint_key="trip_updates", settings=settings, registry=registry, engine=engine
    )
    assert_type(realtime_capture, RealtimeIngestionResult)
    assert_type(realtime_capture.realtime_snapshot_id, int)
    assert_type(
        operations.load_realtime_to_silver(
            "stm",
            endpoint_key="trip_updates",
            snapshot_id=realtime_capture.realtime_snapshot_id,
            settings=settings,
            registry=registry,
            engine=engine,
        ),
        RealtimeSilverLoadResult,
    )
    alert_capture = operations.capture_i3_alerts(
        "stm", settings=settings, registry=registry, engine=engine
    )
    assert_type(alert_capture, I3IngestionResult)
    assert_type(alert_capture.i3_alert_snapshot_id, int)
    assert_type(
        operations.load_i3_to_silver(
            "stm",
            endpoint_key="i3_alerts",
            snapshot_id=alert_capture.i3_alert_snapshot_id,
            settings=settings,
            engine=engine,
        ),
        I3SilverLoadResult,
    )
    operations.load_latest_static_to_silver(  # type: ignore[call-arg]
        "stm", settings=settings, registry=registry, engine=engine
    )
    operations.load_realtime_to_silver(  # type: ignore[call-arg]
        "stm", endpoint_key="trip_updates", settings=settings, registry=registry, engine=engine
    )
    operations.load_i3_to_silver(  # type: ignore[call-arg]
        "stm", endpoint_key="i3_alerts", settings=settings, engine=engine
    )
    SourceFactoryOperationImpls(
        load_latest_static_to_silver=load_without_checksum,  # type: ignore[arg-type]
        ingest_static_feed=capture_with_wrong_receipt,  # type: ignore[arg-type]
        load_realtime_to_silver=load_without_snapshot,  # type: ignore[arg-type]
    )


def load_without_checksum(
    provider_id: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
) -> StaticSilverLoadResult:
    raise NotImplementedError


def capture_with_wrong_receipt(
    provider_id: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
) -> I3IngestionResult:
    raise NotImplementedError


def load_without_snapshot(
    provider_id: str,
    *,
    endpoint_key: str,
    settings: Settings,
    registry: ProviderRegistry,
    engine: Engine,
) -> RealtimeSilverLoadResult:
    raise NotImplementedError
