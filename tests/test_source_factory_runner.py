from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest

from transit_ops.settings import Settings
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


class FakeRegistry:
    def __init__(self) -> None:
        self.provider_ids: list[str] = []

    def get_provider(self, provider_id: str) -> object:
        self.provider_ids.append(provider_id)
        return object()


class FakeEngine:
    def __init__(self) -> None:
        self.connection = object()
        self.begin_calls = 0

    def begin(self) -> FakeBegin:
        self.begin_calls += 1
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

    return SourceFactoryOperationImpls(
        r2_prune_cycle=r2_prune_cycle,
        reset_tables=record("reset"),
        ingest_static_feed=record("static_ingest"),
        capture_realtime_feed=lambda *args, endpoint_key, **kwargs: record(
            f"{endpoint_key}_capture"
        )(),
        ingest_gis_feed=record("gis_ingest"),
        capture_i3_alerts=record("i3_capture"),
        load_latest_static_to_silver=record("static_silver"),
        load_latest_realtime_to_silver=lambda *args, endpoint_key, **kwargs: record(
            f"{endpoint_key}_silver"
        )(),
        load_latest_gis_to_silver=record("gis_silver"),
        load_latest_i3_to_silver=record("i3_silver"),
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
    assert "source_factory_result" in result.artifacts
    assert (tmp_path / "stm-source-factory-result.json").exists()


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

    impls = SourceFactoryOperationImpls(
        **{**impls.__dict__, "r2_prune_cycle": r2_prune_cycle}
    )

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
            settings=ORACLE_SETTINGS,
            registry=FakeRegistry(),
            engine=FakeEngine(),
            bronze_storage=object(),
            clock=ticking_clock(),
            operation_impls=make_impls(calls),
        )

    assert calls == []


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

    impls = SourceFactoryOperationImpls(
        **{**impls.__dict__, "r2_prune_cycle": r2_prune_cycle}
    )

    with pytest.raises(RuntimeError, match="aborting before database reset"):
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
        "warm_rollups",
    ]
    assert result.phase_status[FactoryPhase.DB_RESET] == PhaseStatus.OK
    assert result.phase_status[FactoryPhase.SOURCE_BACKFILL] == PhaseStatus.OK
    assert result.phase_status[FactoryPhase.GOLD_VALIDATION] == PhaseStatus.OK


def test_execute_records_optional_gis_and_i3_missing_source_as_skipped(tmp_path) -> None:
    calls: list[str] = []

    result = run_source_factory_rebuild(
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
                ValueError(
                    "i3 alert feed for provider 'stm' does not have a resolved URL."
                )
            ),
        }
    )

    result = run_source_factory_rebuild(
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
            "load_latest_i3_to_silver": lambda *args, **kwargs: (_ for _ in ()).throw(
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
    impls = SourceFactoryOperationImpls(
        **{**impls.__dict__, "ingest_static_feed": static_failure}
    )

    with pytest.raises(RuntimeError, match="static source failed"):
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
            operation_impls=impls,
        )

    assert calls == ["r2_prune_cycle", "reset", "static_ingest"]


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

    report_path = tmp_path / "stm-source-factory-result.json"
    report_bytes = report_path.read_bytes()
    payload = json.loads(report_bytes)

    assert "source_factory_result" in result.display_dict()["artifacts"]
    assert "source_factory_result" not in payload["artifacts"]
    assert payload["artifacts"]["r2_pre_inventory"]["path"].endswith("pre.json")
    assert payload["artifacts"]["r2_cleanup_plan"]["path"].endswith("plan.json")
    assert payload["artifacts"]["r2_post_inventory"]["path"].endswith("post.json")
    assert result.display_dict()["artifacts"]["source_factory_result"]["path"].endswith(
        "stm-source-factory-result.json"
    )
    assert result.display_dict()["artifacts"]["source_factory_result"]["byte_size"] == len(
        report_bytes
    )
    assert result.display_dict()["artifacts"]["source_factory_result"]["sha256"] == (
        hashlib.sha256(report_bytes).hexdigest()
    )
    assert payload["summaries"]["catalog"]["provider_id"] == "stm"
    assert payload["summaries"]["guard_proofs"]["destructive_confirmations"]["execute"] is False
