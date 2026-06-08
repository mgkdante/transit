from __future__ import annotations

import logging
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

import transit_ops.orchestration as orchestration
from transit_ops.gold import GoldBuildResult, GoldRealtimeRefreshResult, GoldStaticRefreshResult
from transit_ops.ingestion import I3IngestionResult, RealtimeIngestionResult, StaticIngestionResult
from transit_ops.orchestration import (
    run_realtime_cycle,
    run_realtime_worker_loop,
    run_static_pipeline,
)
from transit_ops.settings import Settings
from transit_ops.silver import I3SilverLoadResult, RealtimeSilverLoadResult, StaticSilverLoadResult


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

    result = run_static_pipeline(
        "stm",
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
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
        settings=Settings(_env_file=None, DATABASE_URL="postgresql://user:pass@example.com/transit"),
        registry=object(),
        engine=object(),
    )

    assert call_order == [
        "capture:trip_updates",
        "load:trip_updates",
        "capture:vehicle_positions",
        "capture:i3_alerts",
        "load:i3_alerts",
        "refresh-gold-realtime",
        "prune-silver-storage",
        "prune-gold-storage",
    ]
    assert result.status == "partial_failure"
    assert result.successful_endpoint_count == 2
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
    assert result.step_timings_seconds["capture_i3_alerts"] is not None
    assert result.step_timings_seconds["load_i3_alerts_to_silver"] is not None
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
    monkeypatch.setattr(
        orchestration,
        "run_realtime_cycle",
        lambda provider_id, settings, registry, engine, last_captures=None: (
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
        provider_id, settings, registry, engine, last_captures=None
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
        )

    monkeypatch.setattr(orchestration, "run_realtime_cycle", _fake_overrun_cycle)
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
    monkeypatch.setattr(
        orchestration,
        "get_current_static_content_hash",
        lambda connection, provider_id: (_ for _ in ()).throw(
            AssertionError("legacy hash lookup should not be called")
        ),
        raising=False,
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
    monkeypatch.setattr(
        orchestration,
        "prune_silver_storage",
        lambda provider_id, settings, engine: (
            call_order.append("prune-silver-storage"),
            SimpleNamespace(display_dict=lambda: {"deleted_row_counts": {}}),
        )[1],
    )
    monkeypatch.setattr(
        orchestration,
        "prune_gold_storage",
        lambda provider_id, settings, engine: (
            call_order.append("prune-gold-storage"),
            SimpleNamespace(display_dict=lambda: {"deleted_row_counts": {}}),
        )[1],
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
        registry=object(),
        engine=object(),
    )

    assert "capture:trip_updates" in call_order
    assert "capture:vehicle_positions" in call_order
    assert "capture:i3_alerts" in call_order
    for endpoint_result in result.endpoint_results:
        assert endpoint_result.status == "succeeded"


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
