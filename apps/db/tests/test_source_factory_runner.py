from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import transit_ops.silver.static_gtfs as static_silver
from transit_ops.gold.marts import GoldRealtimeRefreshResult
from transit_ops.ingestion.i3 import I3IngestionResult
from transit_ops.ingestion.realtime_gtfs import RealtimeIngestionResult
from transit_ops.ingestion.static_gtfs import StaticIngestionResult
from transit_ops.settings import Settings
from transit_ops.silver.i3 import I3SilverLoadResult
from transit_ops.silver.realtime_gtfs import RealtimeSilverLoadResult
from transit_ops.source_factory.models import FactoryPhase, PhaseStatus
from transit_ops.source_factory.runner import (
    OptionalSourceUnavailable,
    SourceFactoryOperationImpls,
    run_source_factory_rebuild,
)

ORACLE_SETTINGS = Settings(
    DATABASE_URL="postgresql://transit:secret@oracle-transit.example.com:5432/transit"
)
STARTED_AT = datetime(2026, 5, 25, 12, 0, tzinfo=UTC)
COMPLETED_AT = datetime(2026, 5, 25, 12, 1, tzinfo=UTC)


class _FakeManifest:
    provider = SimpleNamespace(provider_id="stm", strict_gtfs=False)
    # Full STM-shaped feed set so the source-factory catalog keeps trip_updates /
    # vehicle_positions required (present_feed_kinds = these keys).
    feeds = {
        "static_schedule": object(),
        "gis_static": object(),
        "trip_updates": object(),
        "vehicle_positions": object(),
        "i3_alerts": object(),
    }


class FakeRegistry:
    def __init__(self) -> None:
        self.provider_ids: list[str] = []

    def get_provider(self, provider_id: str) -> object:
        self.provider_ids.append(provider_id)
        return _FakeManifest()


class FakeEngine:
    def __init__(self) -> None:
        self.connection = object()
        self.begin_calls = 0

    def begin(self) -> FakeBegin:
        self.begin_calls += 1
        return FakeBegin(self.connection)

    def connect(self) -> FakeBegin:
        return FakeBegin(self.connection)


class FakeBegin:
    def __init__(self, connection: object) -> None:
        self.connection = connection

    def __enter__(self) -> object:
        return self.connection

    def __exit__(self, *exc_info: object) -> None:
        return None


@dataclass(frozen=True)
class FakeArtifact:
    path: Path

    def display_dict(self) -> dict[str, object]:
        return {
            "path": str(self.path),
            "byte_size": 2,
            "sha256": "0" * 64,
        }


@dataclass(frozen=True)
class FakeCleanupResult:
    failed_keys: list[str]

    def display_dict(self) -> dict[str, object]:
        return {"deleted_keys": [], "failed_keys": list(self.failed_keys)}


class FakeR2CycleResult:
    def __init__(
        self,
        artifact_dir: Path,
        *,
        execute: bool,
        failed_keys: list[str] | None = None,
    ) -> None:
        self.execute = execute
        self.cleanup_result = FakeCleanupResult(failed_keys or [])
        self.artifacts = {
            "pre_inventory": FakeArtifact(artifact_dir / "pre.json"),
            "cleanup_plan": FakeArtifact(artifact_dir / "plan.json"),
            "post_inventory": FakeArtifact(artifact_dir / "post.json"),
        }

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": "stm",
            "execute": self.execute,
            "cleanup_result": self.cleanup_result.display_dict(),
            "artifacts": {
                name: artifact.display_dict() for name, artifact in self.artifacts.items()
            },
        }


def ticking_clock() -> Any:
    timestamps = iter([STARTED_AT, COMPLETED_AT])
    return lambda: next(timestamps)


def _static_capture() -> StaticIngestionResult:
    return StaticIngestionResult(
        provider_id="stm",
        endpoint_key="static_schedule",
        source_url="https://example.com/static.zip",
        storage_backend="local",
        storage_path="stm/static_schedule/capture.zip",
        archive_full_path="/unused/capture.zip",
        byte_size=20,
        checksum_sha256="a" * 64,
        http_status_code=200,
        ingestion_run_id=30,
        ingestion_object_id=40,
        status="changed",
        started_at_utc=STARTED_AT,
        completed_at_utc=COMPLETED_AT,
    )


def _captured(endpoint_key: str) -> RealtimeIngestionResult | I3IngestionResult:
    common = dict(
        provider_id="stm",
        endpoint_key=endpoint_key,
        feed_kind=endpoint_key,
        source_url="https://example.com/capture",
        storage_backend="local",
        storage_path=f"stm/{endpoint_key}/capture",
        archive_full_path="/unused/fixture",
        byte_size=20,
        checksum_sha256="a" * 64,
        http_status_code=200,
        ingestion_run_id=31,
        ingestion_object_id=41,
        status="succeeded",
        started_at_utc=STARTED_AT,
        completed_at_utc=COMPLETED_AT,
    )
    if endpoint_key == "i3_alerts":
        return I3IngestionResult(**common, i3_alert_snapshot_id=73, api_version="2", alert_count=1)
    return RealtimeIngestionResult(
        **common,
        realtime_snapshot_id=71 if endpoint_key == "trip_updates" else 72,
        feed_timestamp_utc=STARTED_AT,
        entity_count=1,
    )


def _silver_receipt(endpoint_key: str) -> RealtimeSilverLoadResult:
    capture = _captured(endpoint_key)
    return RealtimeSilverLoadResult(
        provider_id=capture.provider_id,
        endpoint_key=endpoint_key,
        realtime_snapshot_id=capture.realtime_snapshot_id,
        source_ingestion_run_id=capture.ingestion_run_id,
        source_ingestion_object_id=capture.ingestion_object_id,
        storage_path=capture.storage_path,
        archive_full_path=capture.archive_full_path,
        content_hash=capture.checksum_sha256,
        feed_timestamp_utc=capture.feed_timestamp_utc,
        captured_at_utc=capture.completed_at_utc,
        row_counts={
            "rt_feed_snapshots": 1,
            "rt_entities": 1,
            "rt_trip_updates" if endpoint_key == "trip_updates" else "rt_vehicle_positions": 1,
        },
    )


def _live_result(snapshot_ids=(71, 72)) -> GoldRealtimeRefreshResult:
    return GoldRealtimeRefreshResult(
        provider_id="stm",
        provider_timezone="America/Toronto",
        dataset_version_id=1,
        latest_trip_updates_snapshot_id=71,
        latest_vehicle_snapshot_id=72,
        refreshed_at_utc=COMPLETED_AT,
        row_counts={},
        projected_snapshot_ids=tuple(snapshot_ids),
    )


def make_impls(
    calls: list[str],
    *,
    optional_missing: set[str] | None = None,
) -> SourceFactoryOperationImpls:
    optional_missing = optional_missing or set()

    def record(name: str) -> Any:
        def inner(*args: object, **kwargs: object) -> dict[str, object]:
            if name in optional_missing:
                raise OptionalSourceUnavailable(f"{name} unavailable")
            calls.append(name)
            return {"operation": name}

        return inner

    def r2_prune_cycle(*args: object, **kwargs: object) -> FakeR2CycleResult:
        calls.append("r2_prune_cycle")
        artifact_dir = kwargs["artifact_dir"]
        assert isinstance(artifact_dir, Path)
        return FakeR2CycleResult(artifact_dir, execute=bool(kwargs["execute"]))

    def initialize(*args, **kwargs) -> None:
        record("initialize_serving")()

    def refresh(*args, **kwargs) -> GoldRealtimeRefreshResult:
        record("refresh_live")()
        return _live_result()

    return SourceFactoryOperationImpls(
        r2_prune_cycle=r2_prune_cycle,
        reset_tables=record("reset"),
        ingest_static_feed=lambda *args, **kwargs: (record("static_ingest")(), _static_capture())[
            1
        ],
        capture_realtime_feed=lambda *args, endpoint_key, **kwargs: (
            record(f"{endpoint_key}_capture")(),
            _captured(endpoint_key),
        )[1],
        ingest_gis_feed=record("gis_ingest"),
        capture_i3_alerts=lambda *args, **kwargs: (record("i3_capture")(), _captured("i3_alerts"))[
            1
        ],
        load_latest_static_to_silver=record("static_silver"),
        load_realtime_to_silver=lambda *args, endpoint_key, **kwargs: (
            record(f"{endpoint_key}_silver")(),
            _silver_receipt(endpoint_key),
        )[1],
        load_latest_gis_to_silver=record("gis_silver"),
        load_i3_to_silver=lambda *args, **kwargs: (
            record("i3_silver")(),
            I3SilverLoadResult("stm", 73, 1, 0, COMPLETED_AT),
        )[1],
        initialize_realtime_serving=initialize,
        refresh_gold_realtime=refresh,
        build_gold_marts=record("gold_marts"),
        build_warm_rollups=record("warm_rollups"),
    )


def test_dry_run_returns_proof_without_calling_mutating_operations(tmp_path) -> None:
    calls: list[str] = []

    result = run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        settings=ORACLE_SETTINGS,
        registry=FakeRegistry(),
        engine=FakeEngine(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=make_impls(calls),
    )

    assert result.execute is False
    assert calls == ["r2_prune_cycle"]
    assert result.phase_status[FactoryPhase.DB_RESET] == PhaseStatus.SKIPPED
    assert result.phase_status[FactoryPhase.SOURCE_BACKFILL] == PhaseStatus.SKIPPED
    planned_order = result.summaries["planned_backfill_order"]
    assert [step["family"] for step in planned_order] == [
        "static_schedule",
        "trip_updates",
        "vehicle_positions",
        "gis_static",
        "i3_alerts",
    ]
    assert planned_order[1]["sibling_group"] == "gtfs_rt"
    assert planned_order[2]["sibling_group"] == "gtfs_rt"
    assert "preflight" in result.artifacts
    assert "final_report" in result.artifacts
    assert (tmp_path / "preflight.json").exists()
    assert (tmp_path / "final-report.json").exists()


def test_dry_run_records_destructive_r2_cleanup_plan_without_executing_it(
    tmp_path,
) -> None:
    calls: list[str] = []

    result = run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        destructive_r2_cleanup=True,
        settings=ORACLE_SETTINGS,
        registry=FakeRegistry(),
        engine=FakeEngine(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=make_impls(calls),
    )

    assert (
        result.summaries["guard_proofs"]["destructive_confirmations"]["destructive_r2_cleanup"]
        is True
    )
    assert result.summaries["r2_prune_cycle"]["execute"] is False
    assert result.phase_status[FactoryPhase.DB_RESET] == PhaseStatus.SKIPPED


def test_r2_prune_cycle_uses_source_factory_catalog_endpoint_keys(tmp_path) -> None:
    calls: list[str] = []
    captured_endpoint_keys: list[tuple[str, ...]] = []
    impls = make_impls(calls)

    def r2_prune_cycle(*args: object, **kwargs: object) -> FakeR2CycleResult:
        calls.append("r2_prune_cycle")
        captured_endpoint_keys.append(tuple(kwargs["endpoint_keys"]))
        artifact_dir = kwargs["artifact_dir"]
        assert isinstance(artifact_dir, Path)
        return FakeR2CycleResult(artifact_dir, execute=bool(kwargs["execute"]))

    impls = SourceFactoryOperationImpls(**{**impls.__dict__, "r2_prune_cycle": r2_prune_cycle})

    run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        settings=ORACLE_SETTINGS,
        registry=FakeRegistry(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=impls,
    )

    assert calls == ["r2_prune_cycle"]
    assert captured_endpoint_keys == [
        (
            "static_schedule",
            "trip_updates",
            "vehicle_positions",
            "gis_static",
            "i3_alerts",
        )
    ]


def test_dry_run_does_not_require_database_engine_or_database_url(tmp_path) -> None:
    calls: list[str] = []

    result = run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        settings=Settings(_env_file=None, DATABASE_URL=None),
        registry=FakeRegistry(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=make_impls(calls),
    )

    assert result.execute is False
    assert calls == ["r2_prune_cycle"]
    assert result.phase_status[FactoryPhase.DB_RESET] == PhaseStatus.SKIPPED


def test_execute_without_confirmations_raises_before_mutating_operations(tmp_path) -> None:
    calls: list[str] = []

    with pytest.raises(ValueError, match="confirm_worker_stopped"):
        run_source_factory_rebuild(
            "stm",
            artifact_dir=tmp_path,
            keep_from_date=date(2026, 5, 1),
            execute=True,
            destructive_r2_cleanup=True,
            settings=ORACLE_SETTINGS,
            registry=FakeRegistry(),
            engine=FakeEngine(),
            bronze_storage=object(),
            clock=ticking_clock(),
            operation_impls=make_impls(calls),
        )

    assert calls == []


def test_execute_requires_destructive_r2_cleanup_gate(tmp_path) -> None:
    calls: list[str] = []

    with pytest.raises(ValueError, match="destructive_r2_cleanup"):
        run_source_factory_rebuild(
            "stm",
            artifact_dir=tmp_path,
            keep_from_date=date(2026, 5, 1),
            execute=True,
            confirm_worker_stopped=True,
            confirm_oracle_target=True,
            confirm_r2_cleanup=True,
            settings=ORACLE_SETTINGS,
            registry=FakeRegistry(),
            engine=FakeEngine(),
            bronze_storage=object(),
            clock=ticking_clock(),
            operation_impls=make_impls(calls),
        )

    assert calls == []


@pytest.mark.parametrize(
    "receipt, error",
    [
        pytest.param(None, AttributeError, id="missing-cycle"),
        pytest.param(SimpleNamespace(), AttributeError, id="missing-cleanup"),
        pytest.param(
            SimpleNamespace(cleanup_result=SimpleNamespace()),
            AttributeError,
            id="missing-failures",
        ),
        pytest.param(
            SimpleNamespace(cleanup_result=SimpleNamespace(failed_keys=None)),
            TypeError,
            id="null-failures",
        ),
        pytest.param(
            SimpleNamespace(cleanup_result=SimpleNamespace(failed_keys=[])),
            AttributeError,
            id="missing-artifacts",
        ),
    ],
)
def test_incomplete_cleanup_receipt_cannot_authorize_database_reset(
    tmp_path, receipt, error
) -> None:
    calls: list[str] = []
    engine = FakeEngine()

    def incomplete_cleanup(*args: object, **kwargs: object) -> object:
        calls.append("r2_prune_cycle")
        return receipt

    with pytest.raises(error):
        run_source_factory_rebuild(
            "stm",
            artifact_dir=tmp_path,
            keep_from_date=date(2026, 5, 1),
            execute=True,
            destructive_r2_cleanup=True,
            confirm_worker_stopped=True,
            confirm_oracle_target=True,
            confirm_r2_cleanup=True,
            settings=ORACLE_SETTINGS,
            registry=FakeRegistry(),
            engine=engine,
            bronze_storage=object(),
            clock=ticking_clock(),
            operation_impls=replace(make_impls(calls), r2_prune_cycle=incomplete_cleanup),
        )

    assert calls == ["r2_prune_cycle"]
    assert engine.begin_calls == 0
    assert not (tmp_path / "final-report.json").exists()


def test_execute_aborts_before_database_reset_when_r2_cleanup_fails(tmp_path) -> None:
    calls: list[str] = []
    impls = make_impls(calls)

    def r2_prune_cycle(*args: object, **kwargs: object) -> FakeR2CycleResult:
        calls.append("r2_prune_cycle")
        artifact_dir = kwargs["artifact_dir"]
        assert isinstance(artifact_dir, Path)
        return FakeR2CycleResult(
            artifact_dir,
            execute=bool(kwargs["execute"]),
            failed_keys=["stm/trip_updates/captured_at_utc=2026-04-30/key.pb"],
        )

    impls = SourceFactoryOperationImpls(**{**impls.__dict__, "r2_prune_cycle": r2_prune_cycle})

    with pytest.raises(RuntimeError, match="aborting before database reset"):
        run_source_factory_rebuild(
            "stm",
            artifact_dir=tmp_path,
            keep_from_date=date(2026, 5, 1),
            execute=True,
            destructive_r2_cleanup=True,
            confirm_worker_stopped=True,
            confirm_oracle_target=True,
            confirm_r2_cleanup=True,
            settings=ORACLE_SETTINGS,
            registry=FakeRegistry(),
            engine=FakeEngine(),
            bronze_storage=object(),
            clock=ticking_clock(),
            operation_impls=impls,
        )

    assert calls == ["r2_prune_cycle"]


def test_execute_calls_operations_in_required_order(tmp_path) -> None:
    calls: list[str] = []

    result = run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        execute=True,
        destructive_r2_cleanup=True,
        confirm_worker_stopped=True,
        confirm_oracle_target=True,
        confirm_r2_cleanup=True,
        settings=ORACLE_SETTINGS,
        registry=FakeRegistry(),
        engine=FakeEngine(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=make_impls(calls),
    )

    assert calls == [
        "r2_prune_cycle",
        "reset",
        "initialize_serving",
        "static_ingest",
        "static_silver",
        "trip_updates_capture",
        "trip_updates_silver",
        "vehicle_positions_capture",
        "vehicle_positions_silver",
        "gis_ingest",
        "gis_silver",
        "i3_capture",
        "i3_silver",
        "gold_marts",
        "refresh_live",
        "warm_rollups",
    ]
    assert result.phase_status[FactoryPhase.DB_RESET] == PhaseStatus.OK
    assert result.phase_status[FactoryPhase.SOURCE_BACKFILL] == PhaseStatus.OK
    # Honesty: the silver/gold phases report a BUILD completing, not a
    # validation check (none runs in this path), so the phases are *_BUILD.
    assert result.phase_status[FactoryPhase.SILVER_BUILD] == PhaseStatus.OK
    assert result.phase_status[FactoryPhase.GOLD_BUILD] == PhaseStatus.OK
    # The retired "*_validation: ok" claim must not reappear in the report.
    assert "silver_validation" not in result.phase_status
    assert "gold_validation" not in result.phase_status


def test_execute_records_optional_gis_and_i3_missing_source_as_skipped(tmp_path) -> None:
    calls: list[str] = []

    result = run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        execute=True,
        destructive_r2_cleanup=True,
        confirm_worker_stopped=True,
        confirm_oracle_target=True,
        confirm_r2_cleanup=True,
        settings=ORACLE_SETTINGS,
        registry=FakeRegistry(),
        engine=FakeEngine(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=make_impls(calls, optional_missing={"gis_ingest", "i3_capture"}),
    )

    assert "gis_silver" not in calls
    assert "i3_silver" not in calls
    backfill = {item["family"]: item for item in result.summaries["source_backfill"]}
    assert backfill["gis_static"]["status"] == "skipped"
    assert backfill["i3_alerts"]["status"] == "skipped"
    assert result.phase_status[FactoryPhase.SOURCE_BACKFILL] == PhaseStatus.OK


def test_execute_records_optional_value_error_missing_source_as_skipped(tmp_path) -> None:
    calls: list[str] = []
    impls = make_impls(calls)
    impls = SourceFactoryOperationImpls(
        **{
            **impls.__dict__,
            "ingest_gis_feed": lambda *args, **kwargs: (_ for _ in ()).throw(
                ValueError("GIS feed for provider 'stm' does not have a resolved URL.")
            ),
            "capture_i3_alerts": lambda *args, **kwargs: (_ for _ in ()).throw(
                ValueError("i3 alert feed for provider 'stm' does not have a resolved URL.")
            ),
        }
    )

    result = run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        execute=True,
        destructive_r2_cleanup=True,
        confirm_worker_stopped=True,
        confirm_oracle_target=True,
        confirm_r2_cleanup=True,
        settings=ORACLE_SETTINGS,
        registry=FakeRegistry(),
        engine=FakeEngine(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=impls,
    )

    assert "gis_silver" not in calls
    assert "i3_silver" not in calls
    backfill = {item["family"]: item for item in result.summaries["source_backfill"]}
    assert backfill["gis_static"]["status"] == "skipped"
    assert backfill["i3_alerts"]["status"] == "skipped"


def test_execute_records_optional_missing_endpoint_as_skipped(tmp_path) -> None:
    calls: list[str] = []
    impls = make_impls(calls)
    impls = SourceFactoryOperationImpls(
        **{
            **impls.__dict__,
            "ingest_gis_feed": lambda *args, **kwargs: (_ for _ in ()).throw(
                ValueError(
                    "GIS feed endpoint was not found in core.feed_endpoints. "
                    "Run seed-core before ingest-gis."
                )
            ),
            "capture_i3_alerts": lambda *args, **kwargs: (_ for _ in ()).throw(
                ValueError(
                    "i3 alert feed endpoint was not found in core.feed_endpoints. "
                    "Run seed-core before capture-i3."
                )
            ),
        }
    )

    result = run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        execute=True,
        destructive_r2_cleanup=True,
        confirm_worker_stopped=True,
        confirm_oracle_target=True,
        confirm_r2_cleanup=True,
        settings=ORACLE_SETTINGS,
        registry=FakeRegistry(),
        engine=FakeEngine(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=impls,
    )

    assert "gis_silver" not in calls
    assert "i3_silver" not in calls
    backfill = {item["family"]: item for item in result.summaries["source_backfill"]}
    assert backfill["gis_static"]["status"] == "skipped"
    assert backfill["i3_alerts"]["status"] == "skipped"


def test_execute_optional_file_not_found_bug_still_raises(tmp_path) -> None:
    calls: list[str] = []
    impls = make_impls(calls)
    impls = SourceFactoryOperationImpls(
        **{
            **impls.__dict__,
            "ingest_gis_feed": lambda *args, **kwargs: {"operation": "gis_ingest"},
            "load_latest_gis_to_silver": lambda *args, **kwargs: (_ for _ in ()).throw(
                FileNotFoundError("Bronze GIS archive file not found")
            ),
        }
    )

    with pytest.raises(FileNotFoundError, match="Bronze GIS archive file not found"):
        run_source_factory_rebuild(
            "stm",
            artifact_dir=tmp_path,
            keep_from_date=date(2026, 5, 1),
            execute=True,
            destructive_r2_cleanup=True,
            confirm_worker_stopped=True,
            confirm_oracle_target=True,
            confirm_r2_cleanup=True,
            settings=ORACLE_SETTINGS,
            registry=FakeRegistry(),
            engine=FakeEngine(),
            bronze_storage=object(),
            clock=ticking_clock(),
            operation_impls=impls,
        )


def test_execute_optional_i3_silver_missing_snapshot_still_raises(tmp_path) -> None:
    calls: list[str] = []
    impls = make_impls(calls)
    impls = SourceFactoryOperationImpls(
        **{
            **impls.__dict__,
            "load_i3_to_silver": lambda *args, **kwargs: (_ for _ in ()).throw(
                ValueError("No successful raw i3 alert snapshot was found for this provider.")
            ),
        }
    )

    with pytest.raises(ValueError, match="No successful raw i3 alert snapshot"):
        run_source_factory_rebuild(
            "stm",
            artifact_dir=tmp_path,
            keep_from_date=date(2026, 5, 1),
            execute=True,
            destructive_r2_cleanup=True,
            confirm_worker_stopped=True,
            confirm_oracle_target=True,
            confirm_r2_cleanup=True,
            settings=ORACLE_SETTINGS,
            registry=FakeRegistry(),
            engine=FakeEngine(),
            bronze_storage=object(),
            clock=ticking_clock(),
            operation_impls=impls,
        )

    assert "i3_capture" in calls


def test_execute_required_source_failure_raises(tmp_path) -> None:
    calls: list[str] = []

    def static_failure(*args: object, **kwargs: object) -> None:
        calls.append("static_ingest")
        raise RuntimeError("static source failed")

    impls = make_impls(calls)
    impls = SourceFactoryOperationImpls(**{**impls.__dict__, "ingest_static_feed": static_failure})

    with pytest.raises(RuntimeError, match="static source failed"):
        run_source_factory_rebuild(
            "stm",
            artifact_dir=tmp_path,
            keep_from_date=date(2026, 5, 1),
            execute=True,
            destructive_r2_cleanup=True,
            confirm_worker_stopped=True,
            confirm_oracle_target=True,
            confirm_r2_cleanup=True,
            settings=ORACLE_SETTINGS,
            registry=FakeRegistry(),
            engine=FakeEngine(),
            bronze_storage=object(),
            clock=ticking_clock(),
            operation_impls=impls,
        )

    assert calls == ["r2_prune_cycle", "reset", "initialize_serving", "static_ingest"]


def test_final_artifact_json_is_stable_and_includes_artifacts_and_summaries(tmp_path) -> None:
    result = run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        settings=ORACLE_SETTINGS,
        registry=FakeRegistry(),
        engine=FakeEngine(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=make_impls([]),
    )

    report_path = tmp_path / "final-report.json"
    report_bytes = report_path.read_bytes()
    payload = json.loads(report_bytes)

    assert "final_report" in result.display_dict()["artifacts"]
    assert "final_report" not in payload["artifacts"]
    assert payload["artifacts"]["preflight"]["path"].endswith("preflight.json")
    assert payload["artifacts"]["r2_pre_inventory"]["path"].endswith("pre.json")
    assert payload["artifacts"]["r2_cleanup_plan"]["path"].endswith("plan.json")
    assert payload["artifacts"]["r2_post_inventory"]["path"].endswith("post.json")
    assert result.display_dict()["artifacts"]["final_report"]["path"].endswith("final-report.json")
    assert result.display_dict()["artifacts"]["final_report"]["byte_size"] == len(report_bytes)
    assert result.display_dict()["artifacts"]["final_report"]["sha256"] == (
        hashlib.sha256(report_bytes).hexdigest()
    )
    assert payload["summaries"]["catalog"]["provider_id"] == "stm"
    assert payload["summaries"]["guard_proofs"]["destructive_confirmations"]["execute"] is False


@pytest.mark.parametrize("optional_missing", [set(), {"gis_ingest", "i3_capture"}])
def test_execute_passes_exact_capture_receipts_through_silver_and_live(tmp_path, optional_missing):
    calls = []
    impls = make_impls(calls, optional_missing=optional_missing)
    receipts = {
        endpoint: _silver_receipt(endpoint) for endpoint in ("trip_updates", "vehicle_positions")
    }
    initialized = []
    selected = []

    def initialize(provider_id, endpoint_keys, **kwargs):
        assert not any("capture" in call for call in calls)
        assert calls[-1] == "reset"
        initialized.append((provider_id, endpoint_keys))
        calls.append("initialize_serving")

    def load_rt(provider_id, *, endpoint_key, snapshot_id, **kwargs):
        assert snapshot_id == _captured(endpoint_key).realtime_snapshot_id
        calls.append(f"{endpoint_key}_silver")
        return receipts[endpoint_key]

    def load_alert(provider_id, *, snapshot_id, endpoint_key, **kwargs):
        assert (snapshot_id, endpoint_key) == (73, "i3_alerts")
        calls.append("i3_silver")
        return I3SilverLoadResult(provider_id, snapshot_id, 1, 0, COMPLETED_AT)

    def refresh(provider_id, *, snapshots, **kwargs):
        assert calls[-1] == "gold_marts"
        assert not kwargs.get("bootstrap_from_archive", False)
        assert all(receipt is receipts[receipt.endpoint_key] for receipt in snapshots)
        selected.extend(snapshots)
        calls.append("refresh_live")
        return _live_result(receipt.realtime_snapshot_id for receipt in snapshots)

    result = _execute_fixture(
        tmp_path,
        replace(
            impls,
            initialize_realtime_serving=initialize,
            load_realtime_to_silver=load_rt,
            load_i3_to_silver=load_alert,
            refresh_gold_realtime=refresh,
        ),
    )
    assert initialized == [("stm", ("trip_updates", "vehicle_positions"))]
    assert selected == list(receipts.values())
    backfill = {step["endpoint_key"]: step for step in result.summaries["source_backfill"]}
    assert backfill["trip_updates"]["capture"]["realtime_snapshot_id"] == 71
    assert backfill["trip_updates"]["silver"]["realtime_snapshot_id"] == 71
    assert result.summaries["gold"]["refresh_gold_realtime"]["projected_snapshot_ids"] == (71, 72)
    assert json.loads((tmp_path / "final-report.json").read_text())["summaries"]["source_backfill"]


def _execute_fixture(tmp_path, impls):
    return run_source_factory_rebuild(
        "stm",
        artifact_dir=tmp_path,
        keep_from_date=date(2026, 5, 1),
        execute=True,
        destructive_r2_cleanup=True,
        confirm_worker_stopped=True,
        confirm_oracle_target=True,
        confirm_r2_cleanup=True,
        settings=ORACLE_SETTINGS,
        registry=FakeRegistry(),
        engine=FakeEngine(),
        bronze_storage=object(),
        clock=ticking_clock(),
        operation_impls=impls,
    )


@pytest.mark.parametrize("kind", ["realtime", "alerts"])
def test_execute_refuses_a_silver_receipt_for_a_different_capture(tmp_path, kind):
    calls = []
    impls = make_impls(calls)
    if kind == "realtime":
        impls = replace(
            impls,
            load_realtime_to_silver=lambda *a, endpoint_key, **k: replace(
                _silver_receipt(endpoint_key), realtime_snapshot_id=999
            ),
        )
    else:
        impls = replace(
            impls,
            load_i3_to_silver=lambda *a, **k: I3SilverLoadResult("stm", 999, 1, 0, COMPLETED_AT),
        )
    with pytest.raises(ValueError, match="capture"):
        _execute_fixture(tmp_path, impls)
    assert "gold_marts" not in calls
    assert "refresh_live" not in calls


def test_execute_initializer_failure_prevents_new_capture(tmp_path):
    calls = []

    def fail_initialize(*args, **kwargs):
        raise RuntimeError("serving state unavailable")

    with pytest.raises(RuntimeError, match="serving state unavailable"):
        _execute_fixture(
            tmp_path, replace(make_impls(calls), initialize_realtime_serving=fail_initialize)
        )
    assert calls == ["r2_prune_cycle", "reset"]


def test_execute_live_projection_failure_prevents_warm_build_and_final_report(tmp_path):
    calls = []

    def fail_refresh(*args, **kwargs):
        calls.append("refresh_live")
        raise RuntimeError("live projection failed")

    with pytest.raises(RuntimeError, match="live projection failed"):
        _execute_fixture(tmp_path, replace(make_impls(calls), refresh_gold_realtime=fail_refresh))
    assert calls[-2:] == ["gold_marts", "refresh_live"]
    assert "warm_rollups" not in calls
    assert not (tmp_path / "final-report.json").exists()


@pytest.mark.parametrize("content_changed", [True, False])
def test_execute_refuses_a_latest_static_archive_with_different_bytes(
    tmp_path, monkeypatch, content_changed
):
    calls = []
    captured = replace(_static_capture(), content_changed=content_changed)
    archive = static_silver.BronzeStaticArchive(
        provider_id="stm",
        storage_backend="local",
        feed_endpoint_id=1,
        source_ingestion_run_id=99,
        source_ingestion_object_id=100,
        storage_path="stm/static_schedule/different.zip",
        archive_full_path="/unused/different.zip",
        source_url=captured.source_url,
        checksum_sha256="b" * 64,
        byte_size=20,
        source_completed_at_utc=COMPLETED_AT,
    )
    monkeypatch.setattr(
        static_silver,
        "build_static_ingestion_config",
        lambda *a: SimpleNamespace(endpoint_key="static_schedule"),
    )
    monkeypatch.setattr(static_silver, "find_latest_static_bronze_archive", lambda *a, **k: archive)
    monkeypatch.setattr(static_silver, "get_bronze_storage", lambda *a, **k: object())

    def materialize(*args, **kwargs):
        raise AssertionError("A different archive reached Silver materialization")

    monkeypatch.setattr(static_silver, "load_static_zip_to_silver", materialize)
    impls = replace(
        make_impls(calls),
        ingest_static_feed=lambda *a, **k: captured,
        load_latest_static_to_silver=static_silver.load_latest_static_to_silver,
    )
    with pytest.raises(ValueError, match="does not match the captured checksum"):
        _execute_fixture(tmp_path, impls)
    assert calls == ["r2_prune_cycle", "reset", "initialize_serving"]
    assert not (tmp_path / "final-report.json").exists()


def test_execute_retries_failed_static_silver_with_unchanged_capture_bytes(tmp_path):
    calls = []
    first_capture = _static_capture()
    captures = iter(
        [
            first_capture,
            replace(
                first_capture,
                content_changed=False,
                ingestion_run_id=31,
                ingestion_object_id=None,
                storage_path=None,
                archive_full_path=None,
                status="skipped_unchanged",
            ),
        ]
    )
    selected = []

    def load_static(provider_id, *, expected_checksum_sha256, **kwargs):
        selected.append(expected_checksum_sha256)
        if len(selected) == 1:
            raise RuntimeError("static Silver interrupted")
        return {"content_hash": expected_checksum_sha256, "dataset_version_id": 9}

    impls = replace(
        make_impls(calls),
        ingest_static_feed=lambda *a, **k: next(captures),
        load_latest_static_to_silver=load_static,
    )
    with pytest.raises(RuntimeError, match="static Silver interrupted"):
        _execute_fixture(tmp_path, impls)
    assert calls == ["r2_prune_cycle", "reset", "initialize_serving"]
    assert not (tmp_path / "final-report.json").exists()

    result = _execute_fixture(tmp_path, impls)
    assert selected == [first_capture.checksum_sha256] * 2
    static_step = result.summaries["source_backfill"][0]
    assert static_step["status"] == "ok"
    assert static_step["capture"]["content_changed"] is False
    assert static_step["silver"]["content_hash"] == static_step["capture"]["checksum_sha256"]
    assert calls[-3:] == ["gold_marts", "refresh_live", "warm_rollups"]
    report = json.loads((tmp_path / "final-report.json").read_bytes())
    assert report["summaries"]["source_backfill"][0] == static_step
