from __future__ import annotations

import inspect
import json
import logging
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

import transit_ops.ingestion.storage as bronze_storage_module
import transit_ops.orchestration as orchestration
from transit_ops.gold import GoldBuildResult, GoldRealtimeRefreshResult, GoldStaticRefreshResult
from transit_ops.ingestion import I3IngestionResult, RealtimeIngestionResult, StaticIngestionResult
from transit_ops.ingestion.gis import GisIngestionResult
from transit_ops.orchestration import (
    run_pruner_loop,
    run_realtime_cycle,
    run_realtime_worker_loop,
    run_static_pipeline,
)
from transit_ops.settings import Settings
from transit_ops.silver import I3SilverLoadResult, RealtimeSilverLoadResult, StaticSilverLoadResult
from transit_ops.silver.gis import GisSilverLoadResult


class _FakeEngine:
    """Minimal engine stub supporting 'with engine.connect() as conn'."""

    def connect(self):
        return self

    def __enter__(self):
        return self  # used as connection object

    def __exit__(self, *args):
        pass


def _static_ingestion_result(
    *,
    content_changed: bool = True,
    status: str = "succeeded",
    storage_path: str | None = "stm/static_schedule/example.zip",
    archive_full_path: str | None = "s3://transit-raw/stm/static_schedule/example.zip",
    ingestion_object_id: int | None = 11,
    skipped_reason: str | None = None,
) -> StaticIngestionResult:
    return StaticIngestionResult(
        provider_id="stm",
        endpoint_key="static_schedule",
        source_url="https://example.com/static.zip",
        storage_backend="s3",
        storage_path=storage_path,
        archive_full_path=archive_full_path,
        byte_size=100,
        checksum_sha256="a" * 64,
        http_status_code=200,
        ingestion_run_id=1,
        ingestion_object_id=ingestion_object_id,
        status=status,
        started_at_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
        content_changed=content_changed,
        dataset_version_id=7,
        first_seen_at_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        last_seen_at_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
        observed_from_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        observed_until_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
        skipped_reason=skipped_reason,
    )


def _static_silver_result() -> StaticSilverLoadResult:
    return StaticSilverLoadResult(
        provider_id="stm",
        dataset_version_id=7,
        source_ingestion_run_id=1,
        source_ingestion_object_id=11,
        storage_path="stm/static_schedule/example.zip",
        archive_full_path="s3://transit-raw/stm/static_schedule/example.zip",
        content_hash="b" * 64,
        source_version="stm/static_schedule/example.zip",
        loaded_at_utc=datetime(2026, 3, 25, 0, 1, 0, tzinfo=UTC),
        row_counts={"routes": 1},
    )


def _gold_result() -> GoldBuildResult:
    return GoldBuildResult(
        provider_id="stm",
        provider_timezone="America/Toronto",
        dataset_version_id=7,
        latest_trip_updates_snapshot_id=20,
        latest_vehicle_snapshot_id=21,
        built_at_utc=datetime(2026, 3, 25, 0, 2, 0, tzinfo=UTC),
        row_counts={"fact_trip_delay_snapshot": 1, "fact_vehicle_snapshot": 1},
    )


def _gold_static_refresh_result() -> GoldStaticRefreshResult:
    return GoldStaticRefreshResult(
        provider_id="stm",
        provider_timezone="America/Toronto",
        dataset_version_id=7,
        refreshed_at_utc=datetime(2026, 3, 25, 0, 2, 0, tzinfo=UTC),
        row_counts={"dim_route": 100, "dim_stop": 200, "dim_date": 365},
    )


def _gis_ingestion_result(
    *,
    content_changed: bool = True,
    status: str = "succeeded",
    skipped_reason: str | None = None,
) -> GisIngestionResult:
    return GisIngestionResult(
        provider_id="stm",
        endpoint_key="gis_static",
        source_url="https://stm.info/gis/stm_sig.zip",
        storage_backend="s3",
        storage_path="stm/gis_static/2026/06/10/stm_sig.zip",
        archive_full_path="s3://transit-raw/stm/gis_static/2026/06/10/stm_sig.zip",
        byte_size=5_000_000,
        checksum_sha256="f" * 64,
        http_status_code=200,
        ingestion_run_id=99,
        ingestion_object_id=199,
        status=status,
        started_at_utc=datetime(2026, 3, 25, 0, 3, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 3, 25, 0, 3, 5, tzinfo=UTC),
        content_changed=content_changed,
        dataset_version_id=9,
        first_seen_at_utc=datetime(2026, 3, 25, 0, 3, 0, tzinfo=UTC),
        last_seen_at_utc=datetime(2026, 3, 25, 0, 3, 5, tzinfo=UTC),
        observed_from_utc=datetime(2026, 3, 25, 0, 3, 0, tzinfo=UTC),
        observed_until_utc=datetime(2026, 3, 25, 0, 3, 5, tzinfo=UTC),
        skipped_reason=skipped_reason,
    )


def _gis_silver_result() -> GisSilverLoadResult:
    return GisSilverLoadResult(
        provider_id="stm",
        dataset_version_id=9,
        static_dataset_version_id=7,
        source_ingestion_run_id=99,
        source_ingestion_object_id=199,
        storage_path="stm/gis_static/2026/06/10/stm_sig.zip",
        archive_full_path="s3://transit-raw/stm/gis_static/2026/06/10/stm_sig.zip",
        content_hash="f" * 64,
        row_counts={
            "gis_datasets": 1,
            "gis_stop_features": 9000,
            "gis_line_features": 800,
            "gis_gtfs_matches": 8500,
        },
        shapefile_count=4,
        stop_feature_count=9000,
        line_feature_count=800,
        match_count=8500,
    )


def _skipped_gis_silver_result() -> GisSilverLoadResult:
    return GisSilverLoadResult(
        provider_id="stm",
        dataset_version_id=9,
        static_dataset_version_id=7,
        source_ingestion_run_id=99,
        source_ingestion_object_id=199,
        storage_path="stm/gis_static/2026/06/10/stm_sig.zip",
        archive_full_path="s3://transit-raw/stm/gis_static/2026/06/10/stm_sig.zip",
        content_hash="f" * 64,
        row_counts={
            "gis_datasets": 1,
            "gis_stop_features": 9000,
            "gis_line_features": 800,
            "gis_gtfs_matches": 8500,
        },
        shapefile_count=4,
        stop_feature_count=9000,
        line_feature_count=800,
        match_count=8500,
        load_performed=False,
        skipped_reason="gis_static_pair_unchanged",
    )


def _patch_gis_steps(monkeypatch, call_order: list[str] | None = None) -> None:
    """Default-success GIS monkeypatches so static-pipeline tests never hit the network."""

    def _ingest(provider_id, *, settings, registry, engine):  # noqa: ANN001, ANN202, ARG001
        if call_order is not None:
            call_order.append("ingest-gis")
        return _gis_ingestion_result()

    def _silver(provider_id, *, settings, registry, engine):  # noqa: ANN001, ANN202, ARG001
        if call_order is not None:
            call_order.append("load-gis-silver")
        return _gis_silver_result()

    monkeypatch.setattr(orchestration, "ingest_gis_feed", _ingest, raising=False)
    monkeypatch.setattr(orchestration, "load_latest_gis_to_silver", _silver, raising=False)


def _gold_refresh_result() -> GoldRealtimeRefreshResult:
    return GoldRealtimeRefreshResult(
        provider_id="stm",
        provider_timezone="America/Toronto",
        dataset_version_id=7,
        latest_trip_updates_snapshot_id=20,
        latest_vehicle_snapshot_id=21,
        refreshed_at_utc=datetime(2026, 3, 25, 0, 2, 0, tzinfo=UTC),
        row_counts={
            "fact_trip_delay_snapshot_upserted": 10,
            "fact_vehicle_snapshot_upserted": 5,
            "latest_trip_delay_snapshot": 10,
            "latest_vehicle_snapshot": 5,
        },
    )


def _realtime_ingestion_result(endpoint_key: str, snapshot_id: int) -> RealtimeIngestionResult:
    return RealtimeIngestionResult(
        provider_id="stm",
        endpoint_key=endpoint_key,
        feed_kind=endpoint_key,
        source_url=f"https://example.com/{endpoint_key}.pb",
        storage_backend="s3",
        storage_path=f"stm/{endpoint_key}/sample.pb",
        archive_full_path=f"s3://transit-raw/stm/{endpoint_key}/sample.pb",
        byte_size=100,
        checksum_sha256="c" * 64,
        http_status_code=200,
        ingestion_run_id=snapshot_id,
        ingestion_object_id=snapshot_id + 100,
        realtime_snapshot_id=snapshot_id,
        feed_timestamp_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        entity_count=10,
        status="succeeded",
        started_at_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
    )


def _realtime_silver_result(endpoint_key: str, snapshot_id: int) -> RealtimeSilverLoadResult:
    row_counts = (
        {"trip_updates": 10}
        if endpoint_key == "trip_updates"
        else {"vehicle_positions": 5}
    )
    return RealtimeSilverLoadResult(
        provider_id="stm",
        endpoint_key=endpoint_key,
        realtime_snapshot_id=snapshot_id,
        source_ingestion_run_id=snapshot_id,
        source_ingestion_object_id=snapshot_id + 100,
        storage_path=f"stm/{endpoint_key}/sample.pb",
        archive_full_path=f"s3://transit-raw/stm/{endpoint_key}/sample.pb",
        content_hash="d" * 64,
        feed_timestamp_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        captured_at_utc=datetime(2026, 3, 25, 0, 0, 2, tzinfo=UTC),
        row_counts=row_counts,
    )


def _i3_ingestion_result(snapshot_id: int = 30) -> I3IngestionResult:
    return I3IngestionResult(
        provider_id="stm",
        endpoint_key="i3_alerts",
        feed_kind="i3_alerts",
        source_url="https://example.com/i3.json",
        storage_backend="s3",
        storage_path="stm/i3_alerts/sample.json",
        archive_full_path="s3://transit-raw/stm/i3_alerts/sample.json",
        byte_size=100,
        checksum_sha256="e" * 64,
        http_status_code=200,
        ingestion_run_id=snapshot_id,
        ingestion_object_id=snapshot_id + 100,
        i3_alert_snapshot_id=snapshot_id + 200,
        api_version="2",
        alert_count=4,
        status="succeeded",
        started_at_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
    )


def _i3_silver_result(snapshot_id: int = 230) -> I3SilverLoadResult:
    return I3SilverLoadResult(
        provider_id="stm",
        i3_alert_snapshot_id=snapshot_id,
        alert_rows_inserted=4,
        informed_entity_rows_inserted=9,
        loaded_at_utc=datetime(2026, 3, 25, 0, 0, 2, tzinfo=UTC),
    )


def test_run_static_pipeline_orders_existing_steps(monkeypatch) -> None:
    call_order: list[str] = []

    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: (
            call_order.append("ingest-static"),
            _static_ingestion_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_static_to_silver",
        lambda provider_id, settings, registry, engine: (
            call_order.append("load-static-silver"),
            _static_silver_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_static",
        lambda provider_id, settings, registry, engine: (
            call_order.append("refresh-gold-static"),
            _gold_static_refresh_result(),
        )[1],
    )
    _patch_gis_steps(monkeypatch, call_order)

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert call_order == [
        "ingest-static",
        "load-static-silver",
        "refresh-gold-static",
        "ingest-gis",
        "load-gis-silver",
    ]
    assert result.status == "succeeded"
    assert result.static_ingestion["storage_backend"] == "s3"
    assert result.gold_build["dataset_version_id"] == 7
    assert result.total_duration_seconds >= 0
    assert result.static_ingestion_duration_seconds >= 0
    assert result.silver_load_duration_seconds >= 0
    assert result.gold_build_duration_seconds >= 0
    assert result.static_changed is True
    assert result.skipped_reason is None


def test_run_realtime_cycle_reports_partial_failure_and_continues(monkeypatch) -> None:
    call_order: list[str] = []

    def fake_capture(provider_id, endpoint_key, settings, registry, engine):  # noqa: ANN001
        call_order.append(f"capture:{endpoint_key}")
        if endpoint_key == "vehicle_positions":
            raise RuntimeError("vehicle endpoint down")
        return _realtime_ingestion_result(endpoint_key, 20)

    def fake_load(provider_id, endpoint_key, settings, registry, engine):  # noqa: ANN001
        call_order.append(f"load:{endpoint_key}")
        return _realtime_silver_result(endpoint_key, 20)

    monkeypatch.setattr(orchestration, "capture_realtime_feed", fake_capture)
    monkeypatch.setattr(orchestration, "load_latest_realtime_to_silver", fake_load)
    monkeypatch.setattr(
        orchestration,
        "capture_i3_alerts",
        lambda provider_id, settings, registry, engine: (
            call_order.append("capture:i3_alerts"),
            _i3_ingestion_result(),
        )[1],
        raising=False,
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_i3_to_silver",
        lambda provider_id, settings, engine: (
            call_order.append("load:i3_alerts"),
            _i3_silver_result(),
        )[1],
        raising=False,
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_realtime",
        lambda provider_id, settings, registry, engine: (
            call_order.append("refresh-gold-realtime"),
            _gold_refresh_result(),
        )[1],
    )
    # PR-B / slice-9.8: pruning is DECOUPLED from the cycle. The cycle must NOT
    # call prune_silver_storage / prune_gold_storage — fail loudly if it does.
    monkeypatch.setattr(
        orchestration,
        "prune_silver_storage",
        lambda *a, **k: pytest.fail("run_realtime_cycle must not prune silver in-cycle"),
    )
    monkeypatch.setattr(
        orchestration,
        "prune_gold_storage",
        lambda *a, **k: pytest.fail("run_realtime_cycle must not prune gold in-cycle"),
    )

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=object(),
    )

    # Decoupled cycle: capture -> silver-load -> refresh-gold -> (publish). No prune.
    assert call_order == [
        "capture:trip_updates",
        "load:trip_updates",
        "capture:vehicle_positions",
        "capture:i3_alerts",
        "load:i3_alerts",
        "refresh-gold-realtime",
    ]
    assert result.status == "partial_failure"
    assert result.successful_endpoint_count == 2
    assert result.failed_endpoint_count == 1
    assert result.total_duration_seconds >= 0
    assert result.gold_build is not None
    assert result.gold_build_duration_seconds is not None
    assert result.step_timings_seconds["capture_trip_updates"] is not None
    assert result.step_timings_seconds["load_trip_updates_to_silver"] is not None
    assert result.step_timings_seconds["capture_vehicle_positions"] is not None
    assert result.step_timings_seconds["load_vehicle_positions_to_silver"] is None
    assert result.step_timings_seconds["capture_i3_alerts"] is not None
    assert result.step_timings_seconds["load_i3_alerts_to_silver"] is not None
    assert result.step_timings_seconds["refresh_gold_realtime"] is not None
    # Prune timings are gone from the cycle — the pruner service owns them now.
    assert "prune_silver_storage" not in result.step_timings_seconds
    assert "prune_gold_storage" not in result.step_timings_seconds
    assert not hasattr(result, "silver_maintenance")
    assert not hasattr(result, "gold_maintenance")
    assert result.endpoint_results[0].capture_duration_seconds is not None
    assert result.endpoint_results[0].silver_load_duration_seconds is not None
    assert result.endpoint_results[0].total_endpoint_duration_seconds >= 0
    assert result.endpoint_results[1].capture_duration_seconds is not None
    assert result.endpoint_results[1].silver_load_duration_seconds is None
    assert result.endpoint_results[1].total_endpoint_duration_seconds >= 0
    assert (
        result.endpoint_results[1].error_message
        == "capture-realtime failed: vehicle endpoint down"
    )
    assert result.endpoint_results[2].endpoint_key == "i3_alerts"
    assert result.endpoint_results[2].status == "succeeded"


def test_run_realtime_worker_loop_targets_start_to_start_cadence(
    monkeypatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sleep_calls: list[float] = []
    cycle_calls: list[str] = []
    utc_now_values = iter(
        [
            datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
            datetime(2026, 3, 25, 0, 0, 13, 250000, tzinfo=UTC),
            datetime(2026, 3, 25, 0, 5, 0, tzinfo=UTC),
            datetime(2026, 3, 25, 0, 5, 13, 500000, tzinfo=UTC),
        ]
    )
    perf_counter_values = iter([100.0, 113.25, 130.0, 143.5])

    monkeypatch.setattr(
        orchestration,
        "_validate_realtime_worker_startup",
        lambda provider_id, settings, registry: SimpleNamespace(
            provider=SimpleNamespace(
                provider_id=provider_id,
                display_name="STM",
            )
        ),
    )

    def fake_cycle(  # noqa: ANN001
        provider_id,
        settings,
        registry,
        engine,
        last_captures=None,
        bronze_storage_resolver=None,
    ):
        cycle_calls.append(provider_id)
        return orchestration.RealtimeCycleResult(
            provider_id=provider_id,
            status="succeeded",
            started_at_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
            completed_at_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
            total_duration_seconds=1.0,
            successful_endpoint_count=2,
            failed_endpoint_count=0,
            endpoint_results=[],
            step_timings_seconds={
                "capture_trip_updates": 0.25,
                "load_trip_updates_to_silver": 0.5,
                "capture_vehicle_positions": 0.25,
                "load_vehicle_positions_to_silver": 0.5,
                "refresh_gold_realtime": 0.25,
            },
            gold_build=None,
            gold_build_duration_seconds=0.25,
            gold_error_message=None,
        )

    monkeypatch.setattr(
        orchestration,
        "_run_realtime_cycle",
        fake_cycle,
    )
    caplog.set_level(logging.INFO, logger="transit_ops.orchestration")

    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:pass@example.com/transit",
        REALTIME_POLL_SECONDS=300,
        REALTIME_STARTUP_DELAY_SECONDS=3,
    )

    run_realtime_worker_loop(
        "stm",
        settings=settings,
        registry=object(),
        engine=object(),
        sleep_fn=sleep_calls.append,
        max_cycles=2,
        perf_counter_fn=lambda: next(perf_counter_values),
        utc_now_fn=lambda: next(utc_now_values),
    )

    assert cycle_calls == ["stm", "stm"]
    assert sleep_calls == [3, 286.75]
    assert '"computed_sleep_seconds": 286.75' in caplog.text
    assert '"effective_start_to_start_seconds": 300.0' in caplog.text


def test_run_realtime_worker_loop_warns_on_cycle_overrun(
    monkeypatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sleep_calls: list[float] = []
    utc_now_values = iter(
        [
            datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
            datetime(2026, 3, 25, 0, 0, 12, 500000, tzinfo=UTC),
        ]
    )
    perf_counter_values = iter([200.0, 212.5])

    monkeypatch.setattr(
        orchestration,
        "_validate_realtime_worker_startup",
        lambda provider_id, settings, registry: SimpleNamespace(
            provider=SimpleNamespace(
                provider_id=provider_id,
                display_name="STM",
            )
        ),
    )
    def _fake_overrun_cycle(  # noqa: ANN001
        provider_id,
        settings,
        registry,
        engine,
        last_captures=None,
        bronze_storage_resolver=None,
    ):
        return orchestration.RealtimeCycleResult(
            provider_id=provider_id,
            status="succeeded",
            started_at_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
            completed_at_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
            total_duration_seconds=1.0,
            successful_endpoint_count=2,
            failed_endpoint_count=0,
            endpoint_results=[],
            step_timings_seconds={
                "capture_trip_updates": 0.25,
                "load_trip_updates_to_silver": 0.5,
                "capture_vehicle_positions": 0.25,
                "load_vehicle_positions_to_silver": 0.5,
                "refresh_gold_realtime": 0.25,
            },
            gold_build=None,
            gold_build_duration_seconds=0.25,
            gold_error_message=None,
        )

    monkeypatch.setattr(orchestration, "_run_realtime_cycle", _fake_overrun_cycle)
    caplog.set_level(logging.WARNING, logger="transit_ops.orchestration")

    run_realtime_worker_loop(
        "stm",
        settings=Settings(
            _env_file=None,
            DATABASE_URL="postgresql://user:pass@example.com/transit",
            REALTIME_POLL_SECONDS=10,
        ),
        registry=object(),
        engine=object(),
        sleep_fn=sleep_calls.append,
        max_cycles=1,
        perf_counter_fn=lambda: next(perf_counter_values),
        utc_now_fn=lambda: next(utc_now_values),
    )

    assert sleep_calls == []
    assert "exceeded the requested poll interval" in caplog.text
    assert '"computed_sleep_seconds": 0.0' in caplog.text


def test_run_realtime_worker_loop_rejects_invalid_poll_seconds() -> None:
    with pytest.raises(ValueError, match="REALTIME_POLL_SECONDS must be greater than 0"):
        run_realtime_worker_loop(
            "stm",
            settings=Settings(
                _env_file=None,
                DATABASE_URL="postgresql://user:pass@example.com/transit",
                REALTIME_POLL_SECONDS=0,
            ),
            registry=object(),
            engine=object(),
            max_cycles=1,
        )


def test_run_realtime_worker_loop_rejects_invalid_max_cycles() -> None:
    with pytest.raises(ValueError, match="max_cycles must be greater than 0"):
        run_realtime_worker_loop(
            "stm",
            settings=Settings(
                _env_file=None,
                DATABASE_URL="postgresql://user:pass@example.com/transit",
            ),
            registry=object(),
            engine=object(),
            max_cycles=0,
        )


def _worker_loop_cycle_result(provider_id: str):
    """Build a minimal succeeded RealtimeCycleResult for worker-loop tests."""
    return orchestration.RealtimeCycleResult(
        provider_id=provider_id,
        status="succeeded",
        started_at_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
        total_duration_seconds=1.0,
        successful_endpoint_count=2,
        failed_endpoint_count=0,
        endpoint_results=[],
        step_timings_seconds={},
        gold_build=None,
        gold_build_duration_seconds=0.25,
        gold_error_message=None,
    )


class _ClosableS3Client:
    def __init__(self) -> None:
        self.close_calls = 0

    def close(self) -> None:
        self.close_calls += 1


def _worker_s3_settings(**overrides) -> Settings:
    values = {
        "_env_file": None,
        "DATABASE_URL": "postgresql://user:pass@example.com/transit",
        "BRONZE_STORAGE_BACKEND": "s3",
        "BRONZE_S3_ENDPOINT": "https://example.r2.cloudflarestorage.com",
        "BRONZE_S3_BUCKET": "bronze-bucket",
        "BRONZE_S3_ACCESS_KEY": "access",
        "BRONZE_S3_SECRET_KEY": "secret",
        "BRONZE_S3_REGION": "auto",
        "REALTIME_POLL_SECONDS": 10,
    }
    values.update(overrides)
    return Settings(**values)


def test_run_realtime_worker_loop_continues_after_cycle_raises(
    monkeypatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """An uncaught in-cycle exception is logged and the loop continues to the next cycle."""
    cycle_calls: list[str] = []
    storage_identities: list[tuple[int, int]] = []
    sleep_calls: list[float] = []
    client = _ClosableS3Client()
    construction_calls = 0

    def build_client(settings):  # noqa: ANN001, ANN202
        nonlocal construction_calls
        construction_calls += 1
        return client

    monkeypatch.setattr(bronze_storage_module, "build_s3_client", build_client)

    monkeypatch.setattr(
        orchestration,
        "_validate_realtime_worker_startup",
        lambda provider_id, settings, registry: SimpleNamespace(
            provider=SimpleNamespace(provider_id=provider_id, display_name="STM"),
        ),
    )

    def _flaky_cycle(  # noqa: ANN001
        provider_id,
        settings,
        registry,
        engine,
        last_captures=None,
        bronze_storage_resolver=None,
    ):
        cycle_calls.append(provider_id)
        storage = bronze_storage_resolver("s3")
        storage_identities.append((id(storage), id(storage.client)))
        if len(cycle_calls) == 1:
            raise RuntimeError("transient capture failure")
        return _worker_loop_cycle_result(provider_id)

    monkeypatch.setattr(orchestration, "_run_realtime_cycle", _flaky_cycle)
    caplog.set_level(logging.ERROR, logger="transit_ops.orchestration")

    run_realtime_worker_loop(
        "stm",
        settings=_worker_s3_settings(),
        registry=object(),
        engine=object(),
        sleep_fn=sleep_calls.append,
        max_cycles=2,
    )

    # The first cycle raised; the loop must NOT die — a second cycle ran.
    assert cycle_calls == ["stm", "stm"]
    assert storage_identities[0] == storage_identities[1]
    assert construction_calls == 1
    assert client.close_calls == 1
    assert "transient capture failure" in caplog.text


def test_run_realtime_worker_loop_breaks_on_shutdown_flag(
    monkeypatch,
) -> None:
    """Flipping the shutdown flag at the top of the loop breaks cleanly without a crash."""
    cycle_calls: list[str] = []
    shutdown = {"requested": False}

    monkeypatch.setattr(
        orchestration,
        "_validate_realtime_worker_startup",
        lambda provider_id, settings, registry: SimpleNamespace(
            provider=SimpleNamespace(provider_id=provider_id, display_name="STM"),
        ),
    )

    def _cycle_then_request_shutdown(  # noqa: ANN001
        provider_id,
        settings,
        registry,
        engine,
        last_captures=None,
        bronze_storage_resolver=None,
    ):
        cycle_calls.append(provider_id)
        # After draining this cycle, ask the worker to shut down.
        shutdown["requested"] = True
        return _worker_loop_cycle_result(provider_id)

    monkeypatch.setattr(orchestration, "_run_realtime_cycle", _cycle_then_request_shutdown)

    run_realtime_worker_loop(
        "stm",
        settings=Settings(
            _env_file=None,
            DATABASE_URL="postgresql://user:pass@example.com/transit",
            REALTIME_POLL_SECONDS=10,
        ),
        registry=object(),
        engine=object(),
        sleep_fn=lambda _seconds: None,
        # No max_cycles cap: only the shutdown flag can stop this loop.
        max_cycles=None,
        should_shutdown=lambda: shutdown["requested"],
    )

    # Exactly one cycle drained, then the flag broke the loop.
    assert cycle_calls == ["stm"]


def _install_worker_storage_cycle_stubs(
    monkeypatch,
    call_order: list[str],
    storage_identities: list[tuple[int, int]],
) -> None:
    def record_storage(resolver, backend: str = "s3") -> None:  # noqa: ANN001
        storage = resolver(backend)
        storage_identities.append((id(storage), id(storage.client)))

    def capture_gtfs(  # noqa: ANN001
        provider_id,
        endpoint_key,
        *,
        settings,
        registry,
        engine,
        bronze_storage_resolver,
    ):
        call_order.append(f"capture:{endpoint_key}")
        record_storage(bronze_storage_resolver)
        return _realtime_ingestion_result(endpoint_key, 20)

    def load_gtfs(  # noqa: ANN001
        provider_id,
        endpoint_key,
        *,
        settings,
        registry,
        engine,
        bronze_storage_resolver,
    ):
        call_order.append(f"load:{endpoint_key}")
        record_storage(bronze_storage_resolver)
        record_storage(bronze_storage_resolver)
        return _realtime_silver_result(endpoint_key, 20)

    def capture_i3(  # noqa: ANN001
        provider_id,
        *,
        settings,
        registry,
        engine,
        bronze_storage_resolver,
    ):
        call_order.append("capture:i3_alerts")
        record_storage(bronze_storage_resolver)
        return _i3_ingestion_result()

    monkeypatch.setattr(orchestration, "_capture_realtime_feed", capture_gtfs, raising=False)
    monkeypatch.setattr(
        orchestration,
        "_load_latest_realtime_to_silver",
        load_gtfs,
        raising=False,
    )
    monkeypatch.setattr(orchestration, "_capture_i3_alerts", capture_i3, raising=False)
    monkeypatch.setattr(
        orchestration,
        "load_latest_i3_to_silver",
        lambda provider_id, settings, engine: (
            call_order.append("load:i3_alerts"),
            _i3_silver_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_realtime",
        lambda provider_id, settings, registry, engine: (
            call_order.append("refresh-gold-realtime"),
            _gold_refresh_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "_best_effort_publish_live",
        lambda provider_id, settings, engine, registry: (
            call_order.append("publish-live"),
            0,
        )[1],
    )


def test_worker_reuses_one_s3_client_across_endpoints_and_cycles_in_order(
    monkeypatch,
) -> None:
    call_order: list[str] = []
    storage_identities: list[tuple[int, int]] = []
    client = _ClosableS3Client()
    construction_calls = 0
    registry = _fake_registry_with_intervals(
        trip_updates=0,
        vehicle_positions=0,
        i3_alerts=0,
    )

    def build_client(settings):  # noqa: ANN001, ANN202
        nonlocal construction_calls
        construction_calls += 1
        return client

    monkeypatch.setattr(bronze_storage_module, "build_s3_client", build_client)
    monkeypatch.setattr(
        orchestration,
        "_validate_realtime_worker_startup",
        lambda provider_id, settings, registry: registry.get_provider(provider_id),
    )
    _install_worker_storage_cycle_stubs(monkeypatch, call_order, storage_identities)

    run_realtime_worker_loop(
        "stm",
        settings=_worker_s3_settings(
            REALTIME_POLL_SECONDS=1,
            SNAPSHOT_STORAGE_BACKEND="local",
        ),
        registry=registry,
        engine=object(),
        sleep_fn=lambda seconds: None,
        max_cycles=2,
        should_shutdown=lambda: False,
    )

    expected_cycle = [
        "capture:trip_updates",
        "load:trip_updates",
        "capture:vehicle_positions",
        "load:vehicle_positions",
        "capture:i3_alerts",
        "load:i3_alerts",
        "refresh-gold-realtime",
        "publish-live",
    ]
    assert call_order == expected_cycle * 2
    assert len(storage_identities) == 14
    assert len(set(storage_identities)) == 1
    assert construction_calls == 1
    assert client.close_calls == 1


def test_worker_cycle_retries_constructor_after_endpoint_local_failure(
    monkeypatch,
) -> None:
    call_order: list[str] = []
    storage_identities: list[tuple[int, int]] = []
    client = _ClosableS3Client()
    outcomes = iter([RuntimeError("S3 constructor unavailable"), client])
    construction_calls = 0

    def build_client(settings):  # noqa: ANN001, ANN202
        nonlocal construction_calls
        construction_calls += 1
        outcome = next(outcomes)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(bronze_storage_module, "build_s3_client", build_client)
    _install_worker_storage_cycle_stubs(monkeypatch, call_order, storage_identities)
    scope = bronze_storage_module.BronzeStorageScope(
        _worker_s3_settings(SNAPSHOT_STORAGE_BACKEND="local"),
        project_root=orchestration._project_root(),
    )

    result = orchestration._run_realtime_cycle(
        "stm",
        settings=_worker_s3_settings(SNAPSHOT_STORAGE_BACKEND="local"),
        registry=_fake_registry_with_intervals(),
        engine=object(),
        last_captures=None,
        bronze_storage_resolver=scope.resolve,
    )
    scope.close()

    assert [endpoint.status for endpoint in result.endpoint_results] == [
        "failed",
        "succeeded",
        "succeeded",
    ]
    assert result.endpoint_results[0].error_message == (
        "capture-realtime failed: S3 constructor unavailable"
    )
    assert call_order == [
        "capture:trip_updates",
        "capture:vehicle_positions",
        "load:vehicle_positions",
        "capture:i3_alerts",
        "load:i3_alerts",
        "refresh-gold-realtime",
        "publish-live",
    ]
    assert construction_calls == 2
    assert len(set(storage_identities)) == 1
    assert client.close_calls == 1


def test_worker_graceful_shutdown_closes_scope_once_without_resolving(
    monkeypatch,
) -> None:
    instances = []

    class RecordingScope:
        def __init__(self, settings, *, project_root) -> None:  # noqa: ANN001
            self.resolve_calls = 0
            self.close_calls = 0
            instances.append(self)

        def resolve(self, storage_backend: str):  # noqa: ANN201
            self.resolve_calls += 1
            raise AssertionError("shutdown-before-cycle must not resolve storage")

        def close(self) -> None:
            self.close_calls += 1

    monkeypatch.setattr(orchestration, "BronzeStorageScope", RecordingScope, raising=False)
    monkeypatch.setattr(
        orchestration,
        "_validate_realtime_worker_startup",
        lambda provider_id, settings, registry: SimpleNamespace(
            provider=SimpleNamespace(provider_id=provider_id, display_name="STM")
        ),
    )

    run_realtime_worker_loop(
        "stm",
        settings=_worker_s3_settings(),
        registry=object(),
        engine=object(),
        max_cycles=None,
        should_shutdown=lambda: True,
    )

    assert len(instances) == 1
    assert instances[0].resolve_calls == 0
    assert instances[0].close_calls == 1


@pytest.mark.parametrize(
    ("pipeline_paused", "shutdown_results"),
    [(False, [True]), (True, [False, True])],
)
def test_worker_without_first_cycle_never_constructs_s3(
    monkeypatch,
    pipeline_paused: bool,
    shutdown_results: list[bool],
) -> None:
    monkeypatch.setattr(
        bronze_storage_module,
        "build_s3_client",
        lambda settings: pytest.fail("worker without a cycle must not construct S3"),
    )
    monkeypatch.setattr(
        orchestration,
        "_validate_realtime_worker_startup",
        lambda provider_id, settings, registry: SimpleNamespace(
            provider=SimpleNamespace(provider_id=provider_id, display_name="STM")
        ),
    )
    shutdown = iter(shutdown_results)

    run_realtime_worker_loop(
        "stm",
        settings=_worker_s3_settings(PIPELINE_PAUSED=pipeline_paused),
        registry=object(),
        engine=object(),
        sleep_fn=lambda seconds: None,
        max_cycles=None,
        should_shutdown=lambda: next(shutdown),
    )


def test_worker_cleanup_failure_preserves_return_and_escaping_exception(
    monkeypatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    instances = []

    class FailingCloseScope:
        def __init__(self, settings, *, project_root) -> None:  # noqa: ANN001
            self.close_calls = 0
            instances.append(self)

        def resolve(self, storage_backend: str):  # noqa: ANN201
            raise AssertionError("storage must stay lazy in this lifecycle test")

        def close(self) -> None:
            self.close_calls += 1
            raise RuntimeError("scope cleanup failed")

    monkeypatch.setattr(orchestration, "BronzeStorageScope", FailingCloseScope, raising=False)
    monkeypatch.setattr(
        orchestration,
        "_validate_realtime_worker_startup",
        lambda provider_id, settings, registry: SimpleNamespace(
            provider=SimpleNamespace(provider_id=provider_id, display_name="STM")
        ),
    )
    caplog.set_level(logging.ERROR, logger="transit_ops.orchestration")

    assert (
        run_realtime_worker_loop(
            "stm",
            settings=_worker_s3_settings(),
            registry=object(),
            engine=object(),
            max_cycles=None,
            should_shutdown=lambda: True,
        )
        is None
    )

    def worker_escaped() -> bool:
        raise RuntimeError("worker escaped")

    with pytest.raises(RuntimeError, match="worker escaped"):
        run_realtime_worker_loop(
            "stm",
            settings=_worker_s3_settings(),
            registry=object(),
            engine=object(),
            max_cycles=None,
            should_shutdown=worker_escaped,
        )

    assert [instance.close_calls for instance in instances] == [1, 1]
    assert caplog.text.count("Failed to close worker Bronze storage scope") == 2


def test_realtime_orchestration_public_signatures_are_unchanged() -> None:
    cycle_signature = inspect.signature(run_realtime_cycle)
    assert list(cycle_signature.parameters) == [
        "provider_id",
        "settings",
        "registry",
        "engine",
        "last_captures",
    ]
    worker_signature = inspect.signature(run_realtime_worker_loop)
    assert list(worker_signature.parameters) == [
        "provider_id",
        "settings",
        "registry",
        "engine",
        "sleep_fn",
        "max_cycles",
        "perf_counter_fn",
        "utc_now_fn",
        "should_shutdown",
    ]


# --- PR-B / slice-9.8: dedicated pruner loop (decoupled retention) -------------


def _pruner_settings(**overrides) -> Settings:
    base = {
        "_env_file": None,
        "DATABASE_URL": "postgresql://user:pass@example.com/transit",
        "PRUNER_SLEEP_SECONDS": 15,
    }
    base.update(overrides)
    return Settings(**base)


def test_run_pruner_loop_runs_both_prunes_each_pass(monkeypatch) -> None:
    """One pass runs prune_silver_storage THEN prune_gold_storage."""
    call_order: list[str] = []
    monkeypatch.setattr(
        orchestration,
        "prune_silver_storage",
        lambda provider_id, *, settings, engine: (
            call_order.append("silver"),
            SimpleNamespace(display_dict=lambda: {"deleted_row_counts": {}}),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "prune_gold_storage",
        lambda provider_id, *, settings, engine: (
            call_order.append("gold"),
            SimpleNamespace(display_dict=lambda: {"deleted_row_counts": {}}),
        )[1],
    )

    run_pruner_loop(
        "stm",
        settings=_pruner_settings(),
        engine=object(),
        sleep_fn=lambda _seconds: None,
        max_cycles=1,
        should_shutdown=lambda: False,
    )

    assert call_order == ["silver", "gold"]


def test_run_pruner_loop_runs_gold_even_when_silver_prune_raises(monkeypatch) -> None:
    """0034 invariant: a silver-prune failure must NOT skip the gold prune nor the
    loop, and vice versa — each prune is independent and best-effort."""
    call_order: list[str] = []

    def _failing_silver(provider_id, *, settings, engine):  # noqa: ANN001
        call_order.append("silver")
        raise RuntimeError("silver prune blew up")

    monkeypatch.setattr(orchestration, "prune_silver_storage", _failing_silver)
    monkeypatch.setattr(
        orchestration,
        "prune_gold_storage",
        lambda provider_id, *, settings, engine: (
            call_order.append("gold"),
            SimpleNamespace(display_dict=lambda: {"deleted_row_counts": {}}),
        )[1],
    )

    # Must not raise — the loop swallows the per-prune failure and continues.
    run_pruner_loop(
        "stm",
        settings=_pruner_settings(),
        engine=object(),
        sleep_fn=lambda _seconds: None,
        max_cycles=1,
        should_shutdown=lambda: False,
    )

    # Gold still ran despite silver raising.
    assert call_order == ["silver", "gold"]


def test_run_pruner_loop_is_interruptible_via_shutdown(monkeypatch) -> None:
    """A shutdown predicate that flips true after one pass stops the loop cleanly."""
    passes = {"silver": 0}
    shutdown = {"requested": False}

    def _silver(provider_id, *, settings, engine):  # noqa: ANN001
        passes["silver"] += 1
        shutdown["requested"] = True
        return SimpleNamespace(display_dict=lambda: {"deleted_row_counts": {}})

    monkeypatch.setattr(orchestration, "prune_silver_storage", _silver)
    monkeypatch.setattr(
        orchestration,
        "prune_gold_storage",
        lambda provider_id, *, settings, engine: SimpleNamespace(
            display_dict=lambda: {"deleted_row_counts": {}}
        ),
    )

    run_pruner_loop(
        "stm",
        settings=_pruner_settings(),
        engine=object(),
        sleep_fn=lambda _seconds: None,
        max_cycles=None,  # only the shutdown flag can stop it
        should_shutdown=lambda: shutdown["requested"],
    )

    # Exactly one pass ran, then the flag broke the loop on the next iteration.
    assert passes["silver"] == 1


def test_run_pruner_loop_honors_pipeline_paused(monkeypatch) -> None:
    """PIPELINE_PAUSED=true sleeps and skips pruning (mirrors the worker loop)."""
    monkeypatch.setattr(
        orchestration,
        "prune_silver_storage",
        lambda *a, **k: pytest.fail("paused pruner must not prune"),
    )
    monkeypatch.setattr(
        orchestration,
        "prune_gold_storage",
        lambda *a, **k: pytest.fail("paused pruner must not prune"),
    )
    sleep_calls: list[float] = []
    stop = {"after": 0}

    def _should_shutdown() -> bool:
        # Let the paused branch sleep once, then stop the loop.
        stop["after"] += 1
        return stop["after"] > 2

    run_pruner_loop(
        "stm",
        settings=_pruner_settings(PIPELINE_PAUSED=True),
        engine=object(),
        sleep_fn=sleep_calls.append,
        max_cycles=None,
        should_shutdown=_should_shutdown,
    )

    # It slept on the paused branch rather than pruning.
    assert sleep_calls == [15.0, 15.0]


def test_run_pruner_loop_rejects_non_positive_sleep() -> None:
    with pytest.raises(ValueError, match="PRUNER_SLEEP_SECONDS"):
        run_pruner_loop(
            "stm",
            settings=_pruner_settings(PRUNER_SLEEP_SECONDS=0),
            engine=object(),
            sleep_fn=lambda _seconds: None,
            should_shutdown=lambda: False,
        )


def test_run_static_pipeline_skips_silver_and_gold_when_ingestion_skips_unchanged(
    monkeypatch,
) -> None:
    """Unchanged static ingestion: Silver load and Gold refresh are skipped entirely."""
    silver_called = False
    gold_called = False

    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: _static_ingestion_result(
            content_changed=False,
            status="skipped_unchanged",
            storage_path=None,
            archive_full_path=None,
            ingestion_object_id=None,
            skipped_reason="static_content_unchanged",
        ),
    )

    def _should_not_be_called_silver(*args, **kwargs):  # noqa: ANN002, ANN003
        nonlocal silver_called
        silver_called = True
        return _static_silver_result()

    def _should_not_be_called_gold(*args, **kwargs):  # noqa: ANN002, ANN003
        nonlocal gold_called
        gold_called = True
        return _gold_static_refresh_result()

    monkeypatch.setattr(orchestration, "load_latest_static_to_silver", _should_not_be_called_silver)
    monkeypatch.setattr(orchestration, "refresh_gold_static", _should_not_be_called_gold)
    _patch_gis_steps(monkeypatch)

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert not silver_called
    assert not gold_called
    assert result.status == "succeeded"
    assert result.static_changed is False
    assert result.skipped_reason == "static_content_unchanged"
    assert result.silver_load is None
    assert result.gold_build is None
    assert result.silver_load_duration_seconds is None
    assert result.gold_build_duration_seconds is None
    assert result.static_ingestion is not None
    assert result.static_ingestion_duration_seconds >= 0


def test_run_static_pipeline_uses_ingestion_content_changed_without_hash_lookup(
    monkeypatch,
) -> None:
    silver_called = False
    gold_called = False
    skipped_ingestion = SimpleNamespace(
        provider_id="stm",
        content_changed=False,
        status="skipped_unchanged",
        checksum_sha256="new-static-checksum",
        display_dict=lambda: {
            "provider_id": "stm",
            "status": "skipped_unchanged",
            "content_changed": False,
            "dataset_version_id": 77,
        },
    )

    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: skipped_ingestion,
    )

    def _should_not_be_called_silver(*args, **kwargs):  # noqa: ANN002, ANN003
        nonlocal silver_called
        silver_called = True
        return _static_silver_result()

    def _should_not_be_called_gold(*args, **kwargs):  # noqa: ANN002, ANN003
        nonlocal gold_called
        gold_called = True
        return _gold_static_refresh_result()

    monkeypatch.setattr(orchestration, "load_latest_static_to_silver", _should_not_be_called_silver)
    monkeypatch.setattr(orchestration, "refresh_gold_static", _should_not_be_called_gold)
    _patch_gis_steps(monkeypatch)

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert result.status == "succeeded"
    assert result.static_changed is False
    assert result.skipped_reason == "static_content_unchanged"
    assert not silver_called
    assert not gold_called


def test_run_static_pipeline_runs_silver_and_gold_when_ingestion_changed(monkeypatch) -> None:
    """Changed static ingestion: Silver load and Gold refresh both run."""
    call_order: list[str] = []

    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: (
            call_order.append("ingest"),
            _static_ingestion_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_static_to_silver",
        lambda provider_id, settings, registry, engine: (
            call_order.append("silver"),
            _static_silver_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_static",
        lambda provider_id, settings, registry, engine: (
            call_order.append("gold"),
            _gold_static_refresh_result(),
        )[1],
    )
    _patch_gis_steps(monkeypatch)

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert call_order == ["ingest", "silver", "gold"]
    assert result.static_changed is True
    assert result.skipped_reason is None
    assert result.silver_load is not None
    assert result.gold_build is not None
    assert result.silver_load_duration_seconds >= 0
    assert result.gold_build_duration_seconds >= 0


def test_run_static_pipeline_runs_silver_and_gold_when_ingestion_reports_new_version(
    monkeypatch,
) -> None:
    """A new static dataset version runs steps 2 and 3."""
    call_order: list[str] = []

    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: (
            call_order.append("ingest"),
            _static_ingestion_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_static_to_silver",
        lambda provider_id, settings, registry, engine: (
            call_order.append("silver"),
            _static_silver_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_static",
        lambda provider_id, settings, registry, engine: (
            call_order.append("gold"),
            _gold_static_refresh_result(),
        )[1],
    )
    _patch_gis_steps(monkeypatch)

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert call_order == ["ingest", "silver", "gold"]
    assert result.static_changed is True
    assert result.skipped_reason is None
    assert result.silver_load is not None
    assert result.gold_build is not None


# ---------------------------------------------------------------------------
# GIS best-effort tail (slice-9.1.1v)
# ---------------------------------------------------------------------------


def test_run_static_pipeline_runs_gis_after_static_chain(monkeypatch) -> None:
    """GIS chain runs after the full static chain on the changed path."""
    call_order: list[str] = []

    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: (
            call_order.append("ingest-static"),
            _static_ingestion_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_static_to_silver",
        lambda provider_id, settings, registry, engine: (
            call_order.append("load-static-silver"),
            _static_silver_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_static",
        lambda provider_id, settings, registry, engine: (
            call_order.append("refresh-gold-static"),
            _gold_static_refresh_result(),
        )[1],
    )
    _patch_gis_steps(monkeypatch, call_order)

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert call_order == [
        "ingest-static",
        "load-static-silver",
        "refresh-gold-static",
        "ingest-gis",
        "load-gis-silver",
    ]
    assert result.gis_status == "succeeded"
    assert result.gis_ingestion is not None
    assert result.gis_silver_load is not None
    assert result.gis_ingestion_duration_seconds >= 0
    assert result.gis_silver_load_duration_seconds >= 0
    assert result.gis_error_message is None
    assert result.status == "succeeded"


def test_run_static_pipeline_runs_gis_when_static_unchanged(monkeypatch) -> None:
    """GIS silver load runs even when static content is unchanged (unconditional reload)."""
    call_order: list[str] = []

    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: (
            call_order.append("ingest-static"),
            _static_ingestion_result(
                content_changed=False,
                status="skipped_unchanged",
                storage_path=None,
                archive_full_path=None,
                ingestion_object_id=None,
                skipped_reason="static_content_unchanged",
            ),
        )[1],
    )

    def _should_not_run(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("static silver/gold must not run on unchanged path")

    monkeypatch.setattr(orchestration, "load_latest_static_to_silver", _should_not_run)
    monkeypatch.setattr(orchestration, "refresh_gold_static", _should_not_run)
    _patch_gis_steps(monkeypatch, call_order)

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert call_order == ["ingest-static", "ingest-gis", "load-gis-silver"]
    assert result.static_changed is False
    assert result.gis_status == "succeeded"
    assert result.gis_ingestion is not None
    assert result.gis_silver_load is not None
    assert result.status == "succeeded"


def test_run_static_pipeline_reports_gis_pair_skip_as_success(monkeypatch) -> None:
    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: _static_ingestion_result(
            content_changed=False,
            status="skipped_unchanged",
            storage_path=None,
            archive_full_path=None,
            ingestion_object_id=None,
            skipped_reason="static_content_unchanged",
        ),
    )

    def _should_not_run(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("static silver/gold must not run on unchanged path")

    monkeypatch.setattr(orchestration, "load_latest_static_to_silver", _should_not_run)
    monkeypatch.setattr(orchestration, "refresh_gold_static", _should_not_run)
    monkeypatch.setattr(
        orchestration,
        "ingest_gis_feed",
        lambda provider_id, *, settings, registry, engine: _gis_ingestion_result(
            content_changed=False,
            status="skipped_unchanged",
            skipped_reason="gis_content_unchanged",
        ),
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_gis_to_silver",
        lambda provider_id, *, settings, registry, engine: _skipped_gis_silver_result(),
    )

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert result.status == "succeeded"
    assert result.gis_status == "succeeded"
    assert result.gis_silver_load is not None
    assert result.gis_silver_load["load_performed"] is False
    assert result.gis_silver_load["skipped_reason"] == "gis_static_pair_unchanged"


def test_run_static_pipeline_gis_ingest_failure_does_not_fail_pipeline(monkeypatch) -> None:
    """An ingest-gis exception is isolated: pipeline still succeeds, silver load skipped."""
    silver_called = False

    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: _static_ingestion_result(),
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_static_to_silver",
        lambda provider_id, settings, registry, engine: _static_silver_result(),
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_static",
        lambda provider_id, settings, registry, engine: _gold_static_refresh_result(),
    )

    def _ingest_gis_raises(provider_id, *, settings, registry, engine):  # noqa: ANN001, ANN202, ARG001
        raise RuntimeError("stm sig endpoint down")

    def _gis_silver(provider_id, *, settings, registry, engine):  # noqa: ANN001, ANN202, ARG001
        nonlocal silver_called
        silver_called = True
        return _gis_silver_result()

    monkeypatch.setattr(orchestration, "ingest_gis_feed", _ingest_gis_raises, raising=False)
    monkeypatch.setattr(orchestration, "load_latest_gis_to_silver", _gis_silver, raising=False)

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert result.status == "succeeded"
    assert result.gis_status == "failed"
    assert result.gis_error_message == "ingest-gis failed: stm sig endpoint down"
    assert result.gis_ingestion is None
    assert result.gis_silver_load is None
    assert not silver_called


def test_run_static_pipeline_gis_silver_failure_recorded_not_raised(monkeypatch) -> None:
    """A load-gis-silver exception is isolated; the successful ingest dict is kept."""
    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: _static_ingestion_result(),
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_static_to_silver",
        lambda provider_id, settings, registry, engine: _static_silver_result(),
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_static",
        lambda provider_id, settings, registry, engine: _gold_static_refresh_result(),
    )

    def _gis_silver_raises(provider_id, *, settings, registry, engine):  # noqa: ANN001, ANN202, ARG001
        raise RuntimeError("shapefile parse error")

    monkeypatch.setattr(
        orchestration,
        "ingest_gis_feed",
        lambda provider_id, *, settings, registry, engine: _gis_ingestion_result(),
        raising=False,
    )
    monkeypatch.setattr(
        orchestration, "load_latest_gis_to_silver", _gis_silver_raises, raising=False
    )

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert result.status == "succeeded"
    assert result.gis_status == "failed"
    assert result.gis_error_message is not None
    assert result.gis_error_message.startswith("load-gis-silver failed:")
    assert result.gis_ingestion is not None
    assert result.gis_silver_load is None


def test_run_static_pipeline_display_dict_carries_gis_fields(monkeypatch) -> None:
    """display_dict() is json-serializable and carries every gis_* field."""
    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: _static_ingestion_result(),
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_static_to_silver",
        lambda provider_id, settings, registry, engine: _static_silver_result(),
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_static",
        lambda provider_id, settings, registry, engine: _gold_static_refresh_result(),
    )
    _patch_gis_steps(monkeypatch)

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=_FakeEngine(),
    )

    payload = result.display_dict()
    for key in (
        "gis_ingestion",
        "gis_silver_load",
        "gis_ingestion_duration_seconds",
        "gis_silver_load_duration_seconds",
        "gis_status",
        "gis_error_message",
    ):
        assert key in payload
    json.dumps(payload)


# ---------------------------------------------------------------------------
# Per-endpoint cadence gating (slice-8.7 i3 cadence work)
# ---------------------------------------------------------------------------


def _fake_registry_with_intervals(
    *, trip_updates: int = 30, vehicle_positions: int = 30, i3_alerts: int = 300
):
    """Fake provider registry whose manifest exposes refresh_interval_seconds."""
    manifest = SimpleNamespace(
        feeds={
            "trip_updates": SimpleNamespace(
                endpoint_key="trip_updates",
                refresh_interval_seconds=trip_updates,
            ),
            "vehicle_positions": SimpleNamespace(
                endpoint_key="vehicle_positions",
                refresh_interval_seconds=vehicle_positions,
            ),
            "i3_alerts": SimpleNamespace(
                endpoint_key="i3_alerts",
                refresh_interval_seconds=i3_alerts,
            ),
        },
        provider=SimpleNamespace(provider_id="stm", display_name="STM"),
    )
    return SimpleNamespace(get_provider=lambda provider_id: manifest)


def _install_realtime_cycle_stubs(monkeypatch, call_order: list[str]) -> None:
    """Common monkeypatches for run_realtime_cycle dependencies."""

    def fake_capture(provider_id, endpoint_key, settings, registry, engine):  # noqa: ANN001
        call_order.append(f"capture:{endpoint_key}")
        return _realtime_ingestion_result(endpoint_key, 20)

    def fake_load(provider_id, endpoint_key, settings, registry, engine):  # noqa: ANN001
        call_order.append(f"load:{endpoint_key}")
        return _realtime_silver_result(endpoint_key, 20)

    monkeypatch.setattr(orchestration, "capture_realtime_feed", fake_capture)
    monkeypatch.setattr(orchestration, "load_latest_realtime_to_silver", fake_load)
    monkeypatch.setattr(
        orchestration,
        "capture_i3_alerts",
        lambda provider_id, settings, registry, engine: (
            call_order.append("capture:i3_alerts"),
            _i3_ingestion_result(),
        )[1],
        raising=False,
    )
    monkeypatch.setattr(
        orchestration,
        "load_latest_i3_to_silver",
        lambda provider_id, settings, engine: (
            call_order.append("load:i3_alerts"),
            _i3_silver_result(),
        )[1],
        raising=False,
    )
    monkeypatch.setattr(
        orchestration,
        "refresh_gold_realtime",
        lambda provider_id, settings, registry, engine: (
            call_order.append("refresh-gold-realtime"),
            _gold_refresh_result(),
        )[1],
    )
    # PR-B / slice-9.8: the cycle is decoupled from pruning. These guards fail the
    # test if run_realtime_cycle ever calls a prune again.
    monkeypatch.setattr(
        orchestration,
        "prune_silver_storage",
        lambda *a, **k: pytest.fail("run_realtime_cycle must not prune silver in-cycle"),
    )
    monkeypatch.setattr(
        orchestration,
        "prune_gold_storage",
        lambda *a, **k: pytest.fail("run_realtime_cycle must not prune gold in-cycle"),
    )


def test_run_realtime_cycle_skips_i3_when_interval_not_elapsed(monkeypatch) -> None:
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    # Freeze now so elapsed math is exact
    frozen_now = datetime(2026, 5, 26, 22, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(orchestration, "utc_now", lambda: frozen_now)

    last_captures = {
        "trip_updates": datetime(2026, 5, 26, 21, 59, 30, tzinfo=UTC),  # 30s ago
        "vehicle_positions": datetime(2026, 5, 26, 21, 59, 30, tzinfo=UTC),  # 30s ago
        "i3_alerts": datetime(2026, 5, 26, 21, 58, 0, tzinfo=UTC),  # 120s ago (<300)
    }

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=object(),
        last_captures=last_captures,
    )

    # i3 should be skipped; trip_updates + vehicle_positions still ran (30s elapsed == 30s interval)
    assert "capture:i3_alerts" not in call_order
    assert "load:i3_alerts" not in call_order
    assert "capture:trip_updates" in call_order
    assert "capture:vehicle_positions" in call_order

    i3_result = next(
        r for r in result.endpoint_results if r.endpoint_key == "i3_alerts"
    )
    assert i3_result.status == "skipped"
    assert i3_result.capture_result["reason"] == "interval_not_elapsed"
    assert i3_result.capture_result["refresh_interval_seconds"] == 300
    assert i3_result.capture_result["elapsed_seconds"] == 120.0


def test_run_realtime_cycle_runs_i3_when_interval_elapsed(monkeypatch) -> None:
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    frozen_now = datetime(2026, 5, 26, 22, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(orchestration, "utc_now", lambda: frozen_now)

    last_captures = {
        "trip_updates": datetime(2026, 5, 26, 21, 59, 30, tzinfo=UTC),
        "vehicle_positions": datetime(2026, 5, 26, 21, 59, 30, tzinfo=UTC),
        "i3_alerts": datetime(2026, 5, 26, 21, 54, 30, tzinfo=UTC),  # 330s ago (>=300)
    }

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=object(),
        last_captures=last_captures,
    )

    assert "capture:i3_alerts" in call_order
    assert "load:i3_alerts" in call_order

    i3_result = next(
        r for r in result.endpoint_results if r.endpoint_key == "i3_alerts"
    )
    assert i3_result.status == "succeeded"
    # last_captures was mutated to record this cycle's start
    assert last_captures["i3_alerts"] == frozen_now


def test_run_realtime_cycle_without_last_captures_runs_every_endpoint(monkeypatch) -> None:
    """Backward compatibility: omitting last_captures bypasses all gating."""
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    # Bare registry — never accessed when last_captures is None
    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=object(),
    )

    assert "capture:trip_updates" in call_order
    assert "capture:vehicle_positions" in call_order
    assert "capture:i3_alerts" in call_order
    for endpoint_result in result.endpoint_results:
        assert endpoint_result.status == "succeeded"


def _fake_registry_with_service_alerts():
    """A non-STM provider: the two RT feeds + a generic GTFS-RT service-alerts
    feed, and NO proprietary i3 feed (the STO / future-provider shape)."""
    manifest = SimpleNamespace(
        feeds={
            "trip_updates": SimpleNamespace(
                endpoint_key="trip_updates", refresh_interval_seconds=30
            ),
            "vehicle_positions": SimpleNamespace(
                endpoint_key="vehicle_positions", refresh_interval_seconds=30
            ),
            "service_alerts": SimpleNamespace(
                endpoint_key="service_alerts", refresh_interval_seconds=300
            ),
        },
        provider=SimpleNamespace(provider_id="sto", display_name="STO"),
    )
    return SimpleNamespace(get_provider=lambda provider_id: manifest)


def test_single_shot_cycle_is_manifest_driven_captures_service_alerts(monkeypatch) -> None:
    # Holistic per provider: a single-shot cycle for a provider that publishes
    # the generic service-alerts feed (and no i3) captures its alerts and never
    # polls the STM-specific i3 feed it doesn't have.
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)
    monkeypatch.setattr(
        orchestration,
        "capture_service_alerts",
        lambda provider_id, settings, registry, engine: (
            call_order.append("capture:service_alerts"),
            _i3_ingestion_result(),
        )[1],
        raising=False,
    )

    result = run_realtime_cycle(
        "sto",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_service_alerts(),
        engine=object(),
    )

    assert "capture:trip_updates" in call_order
    assert "capture:vehicle_positions" in call_order
    assert "capture:service_alerts" in call_order
    assert "capture:i3_alerts" not in call_order
    assert {r.endpoint_key for r in result.endpoint_results} == {
        "trip_updates",
        "vehicle_positions",
        "service_alerts",
    }


def test_run_realtime_cycle_first_endpoint_call_runs_without_gating(monkeypatch) -> None:
    """Empty last_captures dict (worker startup) means no prior capture, so endpoint runs."""
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    frozen_now = datetime(2026, 5, 26, 22, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(orchestration, "utc_now", lambda: frozen_now)

    last_captures: dict[str, datetime] = {}

    run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=object(),
        last_captures=last_captures,
    )

    assert "capture:i3_alerts" in call_order
    assert last_captures["i3_alerts"] == frozen_now
    assert last_captures["trip_updates"] == frozen_now
    assert last_captures["vehicle_positions"] == frozen_now


def test_run_realtime_cycle_does_not_prune_even_when_gold_refresh_fails(monkeypatch) -> None:
    """PR-B / slice-9.8: pruning is DECOUPLED — the cycle never prunes.

    The `prune_silver_storage`/`prune_gold_storage` guards installed by
    `_install_realtime_cycle_stubs` fail the test if the cycle calls a prune. A
    gold-refresh failure no longer marks the cycle "failed" via a prune error and
    no longer drags retention into the cycle. Retention now lives in the dedicated
    always-on pruner service (run_pruner_loop), which never skips on a gold
    failure — the 0034 "prune must run regardless" invariant, satisfied elsewhere.
    """
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    def failing_gold_refresh(provider_id, settings, registry, engine):  # noqa: ANN001
        call_order.append("refresh-gold-realtime")
        raise RuntimeError("gold build stalled on 0034 backfill")

    monkeypatch.setattr(orchestration, "refresh_gold_realtime", failing_gold_refresh)

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=object(),
    )

    # Gold refresh failed, but NO prune ran this cycle (the guards would have
    # failed the test) and the result no longer carries maintenance fields.
    assert result.gold_error_message is not None
    assert "refresh-gold-realtime" in call_order
    assert "prune-silver-storage" not in call_order
    assert "prune-gold-storage" not in call_order
    assert not hasattr(result, "silver_maintenance")
    assert not hasattr(result, "gold_maintenance")


def test_run_realtime_cycle_does_not_prune_when_all_endpoints_fail(monkeypatch) -> None:
    """A busy/failing cycle no longer touches retention (decoupled pruner)."""
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    def failing_capture(provider_id, endpoint_key, settings, registry, engine):  # noqa: ANN001
        call_order.append(f"capture:{endpoint_key}")
        raise RuntimeError(f"{endpoint_key} endpoint down")

    monkeypatch.setattr(orchestration, "capture_realtime_feed", failing_capture)
    monkeypatch.setattr(
        orchestration,
        "capture_i3_alerts",
        lambda provider_id, settings, registry, engine: (_ for _ in ()).throw(
            RuntimeError("i3 endpoint down")
        ),
        raising=False,
    )

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=object(),
    )

    assert result.successful_endpoint_count == 0
    assert "refresh-gold-realtime" not in call_order
    # Pruning is decoupled — the cycle never prunes (the guards would have failed).
    assert "prune-silver-storage" not in call_order
    assert "prune-gold-storage" not in call_order


# --- slice-9.1.1o: silver-load failure persistence ----------------------------


class _RecordingFailureEngine:
    """Fake engine whose .begin() yields a recording connection.

    Records every insert_failed_ingestion_run call the orchestrator makes
    inside its fresh failure-persistence transaction. _explode=True makes
    .begin() raise to prove the persistence path is strictly best-effort.
    """

    def __init__(self, *, explode: bool = False) -> None:
        self.inserts: list[dict] = []
        self._explode = explode

    def begin(self):  # noqa: ANN201
        if self._explode:
            raise RuntimeError("engine.begin exploded")
        return self

    def connect(self):  # noqa: ANN201
        return self

    def __enter__(self):  # noqa: ANN204
        return self

    def __exit__(self, *args) -> None:  # noqa: ANN002
        return None


def _install_failure_persistence_spies(monkeypatch, engine: _RecordingFailureEngine) -> None:
    """Stub the two DB primitives the failure-persistence helper calls.

    get_feed_endpoint_id resolves a deterministic id per endpoint;
    insert_failed_ingestion_run records its kwargs onto the engine so tests
    can assert exactly what would be written.
    """

    def fake_get_feed_endpoint_id(connection, *, provider_id, endpoint_key, missing_message):  # noqa: ANN001
        return {"trip_updates": 11, "vehicle_positions": 12, "i3_alerts": 13}[endpoint_key]

    def fake_insert_failed(connection, **kwargs):  # noqa: ANN001
        engine.inserts.append(kwargs)
        return 9999

    monkeypatch.setattr(orchestration, "get_feed_endpoint_id", fake_get_feed_endpoint_id)
    monkeypatch.setattr(orchestration, "insert_failed_ingestion_run", fake_insert_failed)


def test_shared_capture_load_executor_preserves_order_payload_and_rounding(
    monkeypatch,
) -> None:
    call_order: list[str] = []
    capture_payload = {"kind": "capture", "rows": 5}
    silver_payload = {"kind": "silver", "rows": 4}
    durations = {
        "capture-realtime[trip_updates]": 1.235,
        "load-realtime-silver[trip_updates]": 2.346,
    }

    def fake_timed_step(label, step):  # noqa: ANN001, ANN202
        call_order.append(label)
        return step(), durations[label]

    perf_values = iter([10.0, 10.1, 11.0, 12.3456])
    monkeypatch.setattr(orchestration, "_run_timed_realtime_step", fake_timed_step)
    monkeypatch.setattr(orchestration.time, "perf_counter", lambda: next(perf_values))
    monkeypatch.setattr(
        orchestration,
        "utc_now",
        lambda: datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
    )

    result = orchestration._run_capture_load_steps(
        "stm",
        "trip_updates",
        capture_step=lambda: (
            call_order.append("capture"),
            SimpleNamespace(display_dict=lambda: capture_payload),
        )[1],
        silver_load_step=lambda: (
            call_order.append("load"),
            SimpleNamespace(display_dict=lambda: silver_payload),
        )[1],
        capture_label_prefix="capture-realtime",
        silver_label_prefix="load-realtime-silver",
        engine=object(),
    )

    assert call_order == [
        "capture-realtime[trip_updates]",
        "capture",
        "load-realtime-silver[trip_updates]",
        "load",
    ]
    assert result.display_dict() == {
        "endpoint_key": "trip_updates",
        "status": "succeeded",
        "capture_duration_seconds": 1.235,
        "silver_load_duration_seconds": 2.346,
        "total_endpoint_duration_seconds": 2.346,
        "capture_result": capture_payload,
        "silver_load_result": silver_payload,
        "error_message": None,
    }


def test_shared_capture_load_executor_capture_failure_skips_load_and_receipt(
    monkeypatch,
) -> None:
    load_calls: list[str] = []
    receipts: list[dict[str, object]] = []

    def fake_timed_step(label, step):  # noqa: ANN001, ANN202
        return step(), 0.25

    def fail_capture():
        raise RuntimeError("capture down")

    perf_values = iter([20.0, 20.1, 20.4567, 20.789])
    monkeypatch.setattr(orchestration, "_run_timed_realtime_step", fake_timed_step)
    monkeypatch.setattr(orchestration.time, "perf_counter", lambda: next(perf_values))
    monkeypatch.setattr(
        orchestration,
        "_persist_silver_load_failure",
        lambda *args, **kwargs: receipts.append(kwargs),
    )

    result = orchestration._run_capture_load_steps(
        "sto",
        "service_alerts",
        capture_step=fail_capture,
        silver_load_step=lambda: load_calls.append("load"),
        capture_label_prefix="capture-service-alerts",
        silver_label_prefix="load-service-alerts-silver",
        engine=object(),
    )

    assert load_calls == []
    assert receipts == []
    assert result.display_dict() == {
        "endpoint_key": "service_alerts",
        "status": "failed",
        "capture_duration_seconds": 0.357,
        "silver_load_duration_seconds": None,
        "total_endpoint_duration_seconds": 0.789,
        "capture_result": None,
        "silver_load_result": None,
        "error_message": "capture-service-alerts failed: capture down",
    }


def test_shared_capture_load_executor_load_failure_persists_exact_receipt(
    monkeypatch,
) -> None:
    receipt_calls: list[tuple[object, dict[str, object]]] = []
    capture_payload = {"snapshot_id": 20}
    started_at_utc = datetime(2026, 7, 21, 12, 0, tzinfo=UTC)
    engine = object()

    def fake_timed_step(label, step):  # noqa: ANN001, ANN202
        if label.startswith("capture-"):
            return step(), 0.111
        return step(), 0.222

    def fail_load():
        raise RuntimeError("silver down")

    perf_values = iter([30.0, 30.1, 31.0, 31.5678, 32.3456])
    monkeypatch.setattr(orchestration, "_run_timed_realtime_step", fake_timed_step)
    monkeypatch.setattr(orchestration.time, "perf_counter", lambda: next(perf_values))
    monkeypatch.setattr(orchestration, "utc_now", lambda: started_at_utc)
    monkeypatch.setattr(
        orchestration,
        "_persist_silver_load_failure",
        lambda receipt_engine, **kwargs: receipt_calls.append(
            (receipt_engine, kwargs)
        ),
    )

    result = orchestration._run_capture_load_steps(
        "stm",
        "i3_alerts",
        capture_step=lambda: SimpleNamespace(display_dict=lambda: capture_payload),
        silver_load_step=fail_load,
        capture_label_prefix="capture-i3",
        silver_label_prefix="load-i3-silver",
        engine=engine,
    )

    assert receipt_calls == [
        (
            engine,
            {
                "provider_id": "stm",
                "endpoint_key": "i3_alerts",
                "error_message": "load-i3-silver failed: silver down",
                "started_at_utc": started_at_utc,
            },
        )
    ]
    assert result.display_dict() == {
        "endpoint_key": "i3_alerts",
        "status": "failed",
        "capture_duration_seconds": 0.111,
        "silver_load_duration_seconds": 0.568,
        "total_endpoint_duration_seconds": 2.346,
        "capture_result": capture_payload,
        "silver_load_result": None,
        "error_message": "load-i3-silver failed: silver down",
    }


def test_shared_capture_load_executor_swallows_receipt_persistence_failure(
    monkeypatch,
) -> None:
    capture_payload = {"snapshot_id": 20}

    def fake_timed_step(label, step):  # noqa: ANN001, ANN202
        if label.startswith("capture-"):
            return step(), 0.111
        return step(), 0.222

    def fail_load():
        raise RuntimeError("silver down")

    perf_values = iter([40.0, 40.1, 41.0, 41.25, 42.0])
    monkeypatch.setattr(orchestration, "_run_timed_realtime_step", fake_timed_step)
    monkeypatch.setattr(orchestration.time, "perf_counter", lambda: next(perf_values))
    monkeypatch.setattr(
        orchestration,
        "utc_now",
        lambda: datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
    )

    result = orchestration._run_capture_load_steps(
        "stm",
        "trip_updates",
        capture_step=lambda: SimpleNamespace(display_dict=lambda: capture_payload),
        silver_load_step=fail_load,
        capture_label_prefix="capture-realtime",
        silver_label_prefix="load-realtime-silver",
        engine=_RecordingFailureEngine(explode=True),
    )

    assert result.status == "failed"
    assert result.capture_result == capture_payload
    assert result.error_message == "load-realtime-silver failed: silver down"


@pytest.mark.parametrize(
    ("adapter_name", "endpoint_key", "capture_label", "silver_label"),
    [
        (
            "_capture_and_load_endpoint",
            "trip_updates",
            "capture-realtime",
            "load-realtime-silver",
        ),
        ("_capture_and_load_i3_alerts", "i3_alerts", "capture-i3", "load-i3-silver"),
        (
            "_capture_and_load_service_alerts",
            "service_alerts",
            "capture-service-alerts",
            "load-service-alerts-silver",
        ),
    ],
)
def test_capture_load_adapters_delegate_exact_labels(
    monkeypatch,
    adapter_name: str,
    endpoint_key: str,
    capture_label: str,
    silver_label: str,
) -> None:
    executor_calls: list[dict[str, object]] = []
    sentinel = orchestration.RealtimeEndpointCycleResult(
        endpoint_key=endpoint_key,
        status="succeeded",
        capture_duration_seconds=0.1,
        silver_load_duration_seconds=0.2,
        total_endpoint_duration_seconds=0.3,
        capture_result={"capture": True},
        silver_load_result={"silver": True},
        error_message=None,
    )

    def fake_executor(provider_id, delegated_endpoint_key, **kwargs):  # noqa: ANN001, ANN202
        executor_calls.append(
            {
                "provider_id": provider_id,
                "endpoint_key": delegated_endpoint_key,
                "capture_label_prefix": kwargs["capture_label_prefix"],
                "silver_label_prefix": kwargs["silver_label_prefix"],
                "capture_callable": callable(kwargs["capture_step"]),
                "silver_callable": callable(kwargs["silver_load_step"]),
            }
        )
        return sentinel

    def fail_eager_call(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        pytest.fail("thin adapters must not invoke capture/load before delegation")

    monkeypatch.setattr(
        orchestration,
        "_run_capture_load_steps",
        fake_executor,
        raising=False,
    )
    monkeypatch.setattr(orchestration, "capture_realtime_feed", fail_eager_call)
    monkeypatch.setattr(orchestration, "load_latest_realtime_to_silver", fail_eager_call)
    monkeypatch.setattr(orchestration, "capture_i3_alerts", fail_eager_call)
    monkeypatch.setattr(orchestration, "capture_service_alerts", fail_eager_call)
    monkeypatch.setattr(orchestration, "load_latest_i3_to_silver", fail_eager_call)

    adapter = getattr(orchestration, adapter_name)
    kwargs = {
        "settings": Settings(
            _env_file=None,
            DATABASE_URL="postgresql://user:pass@example.com/transit",
        ),
        "registry": object(),
        "engine": object(),
    }
    if adapter_name == "_capture_and_load_endpoint":
        result = adapter("stm", endpoint_key, **kwargs)
    else:
        result = adapter("stm", **kwargs)

    assert result is sentinel
    assert executor_calls == [
        {
            "provider_id": "stm",
            "endpoint_key": endpoint_key,
            "capture_label_prefix": capture_label,
            "silver_label_prefix": silver_label,
            "capture_callable": True,
            "silver_callable": True,
        }
    ]


def test_run_realtime_cycle_persists_gtfs_silver_load_failure_row(monkeypatch) -> None:
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    def fake_load(provider_id, endpoint_key, settings, registry, engine):  # noqa: ANN001
        call_order.append(f"load:{endpoint_key}")
        if endpoint_key == "trip_updates":
            raise RuntimeError("silver loader exploded")
        return _realtime_silver_result(endpoint_key, 20)

    monkeypatch.setattr(orchestration, "load_latest_realtime_to_silver", fake_load)

    engine = _RecordingFailureEngine()
    _install_failure_persistence_spies(monkeypatch, engine)

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=engine,
    )

    # Cycle semantics unchanged: one endpoint failed, the rest succeeded.
    assert result.status == "partial_failure"
    assert result.endpoint_results[0].error_message == (
        "load-realtime-silver failed: silver loader exploded"
    )
    # Exactly one silver_load failure row persisted, for trip_updates.
    assert len(engine.inserts) == 1
    insert = engine.inserts[0]
    assert insert["provider_id"] == "stm"
    assert insert["feed_endpoint_id"] == 11
    assert insert["run_kind"] == "silver_load"
    assert insert["error_message"] == "load-realtime-silver failed: silver loader exploded"
    assert insert["started_at_utc"] is not None
    assert insert["completed_at_utc"] is not None


def test_run_realtime_cycle_persists_i3_silver_load_failure_row(monkeypatch) -> None:
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    def fake_i3_load(provider_id, settings, engine):  # noqa: ANN001
        call_order.append("load:i3_alerts")
        raise RuntimeError("i3 silver loader exploded")

    monkeypatch.setattr(orchestration, "load_latest_i3_to_silver", fake_i3_load, raising=False)

    engine = _RecordingFailureEngine()
    _install_failure_persistence_spies(monkeypatch, engine)

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=engine,
    )

    assert result.status == "partial_failure"
    i3_result = next(r for r in result.endpoint_results if r.endpoint_key == "i3_alerts")
    assert i3_result.error_message == "load-i3-silver failed: i3 silver loader exploded"
    assert len(engine.inserts) == 1
    insert = engine.inserts[0]
    assert insert["feed_endpoint_id"] == 13
    assert insert["run_kind"] == "silver_load"
    assert insert["error_message"] == "load-i3-silver failed: i3 silver loader exploded"


def test_silver_load_failure_persistence_is_best_effort(monkeypatch) -> None:
    """If the persistence helper itself raises, the cycle result is identical."""
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    def fake_load(provider_id, endpoint_key, settings, registry, engine):  # noqa: ANN001
        call_order.append(f"load:{endpoint_key}")
        if endpoint_key == "trip_updates":
            raise RuntimeError("silver loader exploded")
        return _realtime_silver_result(endpoint_key, 20)

    monkeypatch.setattr(orchestration, "load_latest_realtime_to_silver", fake_load)

    # engine.begin() explodes -> persistence is impossible, but must not propagate.
    engine = _RecordingFailureEngine(explode=True)
    _install_failure_persistence_spies(monkeypatch, engine)

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=engine,
    )

    # No insert recorded (begin exploded before any write), cycle still partial.
    assert engine.inserts == []
    assert result.status == "partial_failure"
    assert result.endpoint_results[0].error_message == (
        "load-realtime-silver failed: silver loader exploded"
    )


def test_capture_failures_do_not_write_silver_load_rows(monkeypatch) -> None:
    """Capture failures persist via mark_ingestion_run_failed already — no
    silver_load row may be written for a capture-phase failure."""
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)

    def fake_capture(provider_id, endpoint_key, settings, registry, engine):  # noqa: ANN001
        call_order.append(f"capture:{endpoint_key}")
        if endpoint_key == "vehicle_positions":
            raise RuntimeError("capture down")
        return _realtime_ingestion_result(endpoint_key, 20)

    monkeypatch.setattr(orchestration, "capture_realtime_feed", fake_capture)

    engine = _RecordingFailureEngine()
    _install_failure_persistence_spies(monkeypatch, engine)

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=_fake_registry_with_intervals(),
        engine=engine,
    )

    assert result.status == "partial_failure"
    assert engine.inserts == []


def test_realtime_endpoints_for_manifest_filters_absent_and_disabled_feeds() -> None:
    full = SimpleNamespace(
        feeds={
            "trip_updates": SimpleNamespace(is_enabled=True),
            "vehicle_positions": SimpleNamespace(is_enabled=True),
            "i3_alerts": SimpleNamespace(is_enabled=True),
        }
    )
    assert orchestration.realtime_endpoints_for_manifest(full) == (
        "trip_updates",
        "vehicle_positions",
        "i3_alerts",
    )

    no_i3 = SimpleNamespace(
        feeds={
            "trip_updates": SimpleNamespace(is_enabled=True),
            "vehicle_positions": SimpleNamespace(is_enabled=True),
        }
    )
    assert orchestration.realtime_endpoints_for_manifest(no_i3) == (
        "trip_updates",
        "vehicle_positions",
    )

    disabled_vehicles = SimpleNamespace(
        feeds={
            "trip_updates": SimpleNamespace(is_enabled=True),
            "vehicle_positions": SimpleNamespace(is_enabled=False),
            "i3_alerts": SimpleNamespace(is_enabled=True),
        }
    )
    assert orchestration.realtime_endpoints_for_manifest(disabled_vehicles) == (
        "trip_updates",
        "i3_alerts",
    )


def _fake_registry_without_i3(*, trip_updates: int = 30, vehicle_positions: int = 30):
    manifest = SimpleNamespace(
        feeds={
            "trip_updates": SimpleNamespace(
                endpoint_key="trip_updates",
                refresh_interval_seconds=trip_updates,
                is_enabled=True,
            ),
            "vehicle_positions": SimpleNamespace(
                endpoint_key="vehicle_positions",
                refresh_interval_seconds=vehicle_positions,
                is_enabled=True,
            ),
        },
        provider=SimpleNamespace(provider_id="sto", display_name="STO"),
    )
    return SimpleNamespace(get_provider=lambda provider_id: manifest)


def test_run_realtime_cycle_does_not_poll_an_absent_i3_feed(monkeypatch) -> None:
    # A provider without an i3 alerts feed (e.g. STO/OC Transpo) must not be
    # polled for it every worker cycle.
    call_order: list[str] = []
    _install_realtime_cycle_stubs(monkeypatch, call_order)
    frozen_now = datetime(2026, 5, 26, 22, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(orchestration, "utc_now", lambda: frozen_now)

    result = run_realtime_cycle(
        "sto",
        settings=Settings(
            _env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"
        ),
        registry=_fake_registry_without_i3(),
        engine=object(),
        last_captures={},  # worker path, nothing gated yet
    )

    assert "capture:i3_alerts" not in call_order
    assert "capture:trip_updates" in call_order
    assert "capture:vehicle_positions" in call_order
    assert {r.endpoint_key for r in result.endpoint_results} == {
        "trip_updates",
        "vehicle_positions",
    }
