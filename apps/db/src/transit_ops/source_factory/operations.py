from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Protocol

from sqlalchemy.engine import Connection, Engine

from transit_ops.gold.marts import GoldBuildResult, GoldRealtimeRefreshResult, build_gold_marts
from transit_ops.gold.realtime import initialize_realtime_serving, refresh_gold_realtime
from transit_ops.gold.rollups import WarmRollupBuildResult, build_warm_rollups
from transit_ops.ingestion.gis import GisIngestionResult, ingest_gis_feed
from transit_ops.ingestion.i3 import I3IngestionResult, capture_i3_alerts
from transit_ops.ingestion.realtime_gtfs import RealtimeIngestionResult, capture_realtime_feed
from transit_ops.ingestion.static_gtfs import StaticIngestionResult, ingest_static_feed
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings
from transit_ops.silver.gis import GisSilverLoadResult, load_latest_gis_to_silver
from transit_ops.silver.i3 import I3SilverLoadResult, load_i3_to_silver
from transit_ops.silver.realtime_gtfs import RealtimeSilverLoadResult, load_realtime_to_silver
from transit_ops.silver.static_gtfs import StaticSilverLoadResult, load_latest_static_to_silver
from transit_ops.source_factory.catalog import reset_source_factory_tables
from transit_ops.source_factory.r2 import (
    R2CleanupStorage,
    R2PruneCycleResult,
    run_r2_prune_cycle,
)


class _ProviderOperation[Result](Protocol):
    def __call__(
        self,
        provider_id: str,
        *,
        settings: Settings,
        registry: ProviderRegistry,
        engine: Engine,
    ) -> Result: ...


class _R2PruneCycle(Protocol):
    def __call__(
        self,
        storage: R2CleanupStorage,
        *,
        provider_id: str,
        keep_from_date: date,
        artifact_dir: Path,
        endpoint_keys: Iterable[str],
        execute: bool,
        confirm_r2_cleanup: bool,
        active_prefix_wipe: bool,
        confirm_active_prefix_wipe: bool,
        clock: Callable[[], datetime],
    ) -> R2PruneCycleResult: ...


class _RealtimeCapture(Protocol):
    def __call__(
        self,
        provider_id: str,
        *,
        endpoint_key: str,
        settings: Settings,
        registry: ProviderRegistry,
        engine: Engine,
    ) -> RealtimeIngestionResult: ...


class _StaticSilverLoad(Protocol):
    def __call__(
        self,
        provider_id: str,
        *,
        expected_checksum_sha256: str,
        settings: Settings,
        registry: ProviderRegistry,
        engine: Engine,
    ) -> StaticSilverLoadResult: ...


class _RealtimeSilverLoad(Protocol):
    def __call__(
        self,
        provider_id: str,
        *,
        endpoint_key: str,
        snapshot_id: int,
        settings: Settings,
        registry: ProviderRegistry,
        engine: Engine,
    ) -> RealtimeSilverLoadResult: ...


class _I3SilverLoad(Protocol):
    def __call__(
        self,
        provider_id: str,
        *,
        endpoint_key: str,
        snapshot_id: int,
        settings: Settings,
        engine: Engine,
    ) -> I3SilverLoadResult: ...


class _InitializeRealtimeServing(Protocol):
    def __call__(
        self,
        provider_id: str,
        endpoint_keys: Sequence[str],
        *,
        settings: Settings,
        engine: Engine,
    ) -> None: ...


class _RefreshGoldRealtime(Protocol):
    def __call__(
        self,
        provider_id: str,
        *,
        snapshots: Sequence[RealtimeSilverLoadResult],
        settings: Settings,
        registry: ProviderRegistry,
        engine: Engine,
    ) -> GoldRealtimeRefreshResult: ...


class _BuildWarmRollups(Protocol):
    def __call__(
        self,
        provider_id: str,
        *,
        settings: Settings,
        engine: Engine,
    ) -> WarmRollupBuildResult: ...


@dataclass(frozen=True)
class SourceFactoryOperationImpls:
    r2_prune_cycle: _R2PruneCycle = run_r2_prune_cycle
    reset_tables: Callable[[Connection, str], dict[str, object]] = reset_source_factory_tables
    ingest_static_feed: _ProviderOperation[StaticIngestionResult] = ingest_static_feed
    capture_realtime_feed: _RealtimeCapture = capture_realtime_feed
    ingest_gis_feed: _ProviderOperation[GisIngestionResult] = ingest_gis_feed
    capture_i3_alerts: _ProviderOperation[I3IngestionResult] = capture_i3_alerts
    load_latest_static_to_silver: _StaticSilverLoad = load_latest_static_to_silver
    load_realtime_to_silver: _RealtimeSilverLoad = load_realtime_to_silver
    load_latest_gis_to_silver: _ProviderOperation[GisSilverLoadResult] = load_latest_gis_to_silver
    load_i3_to_silver: _I3SilverLoad = load_i3_to_silver
    initialize_realtime_serving: _InitializeRealtimeServing = initialize_realtime_serving
    refresh_gold_realtime: _RefreshGoldRealtime = refresh_gold_realtime
    build_gold_marts: _ProviderOperation[GoldBuildResult] = build_gold_marts
    build_warm_rollups: _BuildWarmRollups = build_warm_rollups
