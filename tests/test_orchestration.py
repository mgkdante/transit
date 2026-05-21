from __future__ import annotations

import logging
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

import transit_ops.orchestration as orchestration
from transit_ops.gold import GoldBuildResult, GoldRealtimeRefreshResult, GoldStaticRefreshResult
from transit_ops.ingestion import RealtimeIngestionResult, StaticIngestionResult
from transit_ops.orchestration import (
    run_realtime_cycle,
    run_realtime_worker_loop,
    run_static_pipeline,
)
from transit_ops.settings import Settings
from transit_ops.silver import RealtimeSilverLoadResult, StaticSilverLoadResult


class _FakeEngine:
    """Minimal engine stub supporting 'with engine.connect() as conn'."""

    def connect(self):
        return self

    def __enter__(self):
        return self  # used as connection object

    def __exit__(self, *args):
        pass


def _static_ingestion_result() -> StaticIngestionResult:
    return StaticIngestionResult(
        provider_id="stm",
        endpoint_key="static_schedule",
        source_url="https://example.com/static.zip",
        storage_backend="s3",
        storage_path="stm/static_schedule/example.zip",
        archive_full_path="s3://transit-raw/stm/static_schedule/example.zip",
        byte_size=100,
        checksum_sha256="a" * 64,
        http_status_code=200,
        ingestion_run_id=1,
        ingestion_object_id=11,
        status="succeeded",
        started_at_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
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
    # Return a different hash so the gate treats this as a changed feed.
    monkeypatch.setattr(
        orchestration,
        "get_current_static_content_hash",
        lambda connection, provider_id: "b" * 64,
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

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert call_order == ["ingest-static", "load-static-silver", "refresh-gold-static"]
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
        "refresh_gold_realtime",
        lambda provider_id, settings, registry, engine: (
            call_order.append("refresh-gold-realtime"),
            _gold_refresh_result(),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "prune_silver_storage",
        lambda provider_id, settings, engine: (
            call_order.append("prune-silver-storage"),
            SimpleNamespace(
                display_dict=lambda: {"deleted_row_counts": {"silver.trip_updates": 3}}
            ),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "prune_gold_storage",
        lambda provider_id, settings, engine: (
            call_order.append("prune-gold-storage"),
            SimpleNamespace(
                display_dict=lambda: {"deleted_row_counts": {"gold.fact_trip_delay_snapshot": 0}}
            ),
        )[1],
    )

    result = run_realtime_cycle(
        "stm",
        settings=Settings(_env_file=None, NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb"),
        registry=object(),
        engine=object(),
    )

    assert call_order == [
        "capture:trip_updates",
        "load:trip_updates",
        "capture:vehicle_positions",
        "refresh-gold-realtime",
        "prune-silver-storage",
        "prune-gold-storage",
    ]
    assert result.status == "partial_failure"
    assert result.successful_endpoint_count == 1
    assert result.failed_endpoint_count == 1
    assert result.total_duration_seconds >= 0
    assert result.gold_build is not None
    assert result.gold_build_duration_seconds is not None
    assert result.silver_maintenance is not None
    assert result.silver_maintenance_duration_seconds is not None
    assert result.step_timings_seconds["capture_trip_updates"] is not None
    assert result.step_timings_seconds["load_trip_updates_to_silver"] is not None
    assert result.step_timings_seconds["capture_vehicle_positions"] is not None
    assert result.step_timings_seconds["load_vehicle_positions_to_silver"] is None
    assert result.step_timings_seconds["refresh_gold_realtime"] is not None
    assert result.step_timings_seconds["prune_silver_storage"] is not None
    assert result.step_timings_seconds["prune_gold_storage"] is not None
    assert result.gold_maintenance is not None
    assert result.gold_maintenance_duration_seconds is not None
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
    monkeypatch.setattr(
        orchestration,
        "run_realtime_cycle",
        lambda provider_id, settings, registry, engine: (
            cycle_calls.append(provider_id),
            orchestration.RealtimeCycleResult(
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
                    "prune_silver_storage": 0.1,
                    "prune_gold_storage": 0.1,
                },
                gold_build=None,
                gold_build_duration_seconds=0.25,
                gold_error_message=None,
                silver_maintenance=None,
                silver_maintenance_duration_seconds=0.1,
                silver_maintenance_error_message=None,
                gold_maintenance=None,
                gold_maintenance_duration_seconds=0.1,
                gold_maintenance_error_message=None,
            ),
        )[1],
    )
    caplog.set_level(logging.INFO, logger="transit_ops.orchestration")

    settings = Settings(
        _env_file=None,
        NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb",
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
    monkeypatch.setattr(
        orchestration,
        "run_realtime_cycle",
        lambda provider_id, settings, registry, engine: orchestration.RealtimeCycleResult(
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
                "prune_silver_storage": 0.1,
                "prune_gold_storage": 0.1,
            },
            gold_build=None,
            gold_build_duration_seconds=0.25,
            gold_error_message=None,
            silver_maintenance=None,
            silver_maintenance_duration_seconds=0.1,
            silver_maintenance_error_message=None,
            gold_maintenance=None,
            gold_maintenance_duration_seconds=0.1,
            gold_maintenance_error_message=None,
        ),
    )
    caplog.set_level(logging.WARNING, logger="transit_ops.orchestration")

    run_realtime_worker_loop(
        "stm",
        settings=Settings(
            _env_file=None,
            NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb",
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
                NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb",
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
                NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb",
            ),
            registry=object(),
            engine=object(),
            max_cycles=0,
        )


def test_run_static_pipeline_skips_silver_and_gold_when_hash_unchanged(monkeypatch) -> None:
    """Unchanged Bronze hash: Silver load and Gold refresh are skipped entirely."""
    silver_called = False
    gold_called = False

    monkeypatch.setattr(
        orchestration,
        "ingest_static_feed",
        lambda provider_id, settings, registry, engine: _static_ingestion_result(),
    )
    # Return the same hash as StaticIngestionResult.checksum_sha256 ("a" * 64).
    monkeypatch.setattr(
        orchestration,
        "get_current_static_content_hash",
        lambda connection, provider_id: "a" * 64,
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

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb"),
        registry=object(),
        engine=_FakeEngine(),
    )

    # Silver load was never called → no Silver INSERT ran → no core.dataset_versions row created.
    assert not silver_called
    # Gold refresh was never called.
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


def test_run_static_pipeline_runs_silver_and_gold_when_hash_changed(monkeypatch) -> None:
    """Different Bronze hash: Silver load and Gold refresh both run."""
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
        "get_current_static_content_hash",
        lambda connection, provider_id: "z" * 64,  # different from "a" * 64
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

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb"),
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


def test_run_static_pipeline_runs_silver_and_gold_when_no_existing_version(monkeypatch) -> None:
    """No existing Silver version (None): treated as changed, steps 2 and 3 run."""
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
        "get_current_static_content_hash",
        lambda connection, provider_id: None,
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

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb"),
        registry=object(),
        engine=_FakeEngine(),
    )

    assert call_order == ["ingest", "silver", "gold"]
    assert result.static_changed is True
    assert result.skipped_reason is None
    assert result.silver_load is not None
    assert result.gold_build is not None
