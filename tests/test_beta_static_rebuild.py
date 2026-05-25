from __future__ import annotations

import json
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest

from transit_ops.ingestion.storage import BronzeObjectInfo
from transit_ops.rebuild import static_beta as static_beta_module
from transit_ops.rebuild.static_beta import rebuild_beta_static_contract
from transit_ops.settings import Settings


def oracle_settings(database_url: str | None = "postgresql://oracle:secret@oracle-vm.local/transit"):
    return Settings(_env_file=None, DATABASE_URL=database_url)


class FakeStorage:
    storage_backend = "local"

    def __init__(self, *, fail_delete_keys: set[str] | None = None) -> None:
        self.keys = [
            "stm/static_schedule/ingested_at_utc=2026-05-24/20260524T120000000000Z__abcdef123456__gtfs.zip",
            "stm/static_schedule/malformed-but-active.zip",
            "stm/trip_updates/captured_at_utc=2026-05-24/20260524T120000000000Z__abcdef123457__trip_updates.pb",
            "stm/vehicle_positions/captured_at_utc=2026-05-24/20260524T120000000000Z__abcdef123458__vehicle_positions.pb",
            "stm/proof/slice-8.3/keep.json",
        ]
        self.fail_delete_keys = fail_delete_keys or set()
        self.listed_prefixes: list[str] = []
        self.deleted_keys: list[str] = []
        self.pre_delete_report_path: Path | None = None

    def list_objects(self, prefix: str) -> list[BronzeObjectInfo]:
        self.listed_prefixes.append(prefix)
        return [
            BronzeObjectInfo(storage_path=key, byte_size=100, last_modified=None)
            for key in self.keys
            if key.startswith(prefix)
        ]

    def delete_object(self, storage_path: str) -> None:
        if self.pre_delete_report_path is not None:
            assert self.pre_delete_report_path.exists()
        if storage_path in self.fail_delete_keys:
            raise RuntimeError(f"delete failed for {storage_path}")
        self.deleted_keys.append(storage_path)


class FakeConnection:
    def __init__(self, events: list[str]) -> None:
        self.events = events


class FakeConnectionContext(AbstractContextManager[FakeConnection]):
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.connection = FakeConnection(events)

    def __enter__(self) -> FakeConnection:
        self.events.append("begin")
        return self.connection

    def __exit__(self, exc_type, exc, traceback) -> None:  # noqa: ANN001
        self.events.append("commit" if exc_type is None else "rollback")


class FakeEngine:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def begin(self) -> FakeConnectionContext:
        return FakeConnectionContext(self.events)


@dataclass(frozen=True)
class FakeDisplayResult:
    label: str
    completed_at_utc: datetime = datetime(2026, 5, 24, 12, 0, tzinfo=UTC)

    def display_dict(self) -> dict[str, object]:
        return {
            "label": self.label,
            "completed_at_utc": self.completed_at_utc.isoformat(),
        }


def patch_execute_steps(monkeypatch, events: list[str]) -> None:  # noqa: ANN001
    def fake_reset(connection) -> None:  # noqa: ANN001
        events.append("reset-static")

    def fake_ingest(provider_id, *, settings, registry, engine):  # noqa: ANN001
        events.append("ingest-beta-static")
        return FakeDisplayResult(f"ingest-{provider_id}")

    def fake_load(provider_id, *, settings, registry, engine):  # noqa: ANN001
        events.append("load-beta-silver")
        return FakeDisplayResult(f"silver-{provider_id}")

    def fake_gold(provider_id, *, settings, registry, engine):  # noqa: ANN001
        events.append("refresh-beta-gold")
        return FakeDisplayResult(f"gold-{provider_id}")

    monkeypatch.setattr(static_beta_module, "reset_static_rebuild_tables", fake_reset)
    monkeypatch.setattr(static_beta_module, "ingest_static_feed", fake_ingest)
    monkeypatch.setattr(static_beta_module, "load_latest_static_to_silver", fake_load)
    monkeypatch.setattr(static_beta_module, "refresh_gold_static", fake_gold)


def test_dry_run_builds_active_r2_cleanup_plan_without_mutation() -> None:
    storage = FakeStorage()

    result = rebuild_beta_static_contract(
        "stm",
        settings=oracle_settings(),
        engine=FakeEngine([]),
        bronze_storage=storage,
    )

    report = result.display_dict()
    assert report["dry_run"] is True
    assert report["reset_executed"] is False
    assert report["r2_cleanup_plan"]["planned_count"] == 4
    assert report["r2_cleanup_plan"]["prefixes"] == [
        "stm/static_schedule/",
        "stm/trip_updates/",
        "stm/vehicle_positions/",
    ]
    assert report["r2_cleanup_result"] is None
    assert storage.deleted_keys == []
    assert "stm/proof/slice-8.3/keep.json" not in json.dumps(report["r2_cleanup_plan"])


def test_execute_wipes_active_r2_prefixes_then_rebuilds_beta_static_layers(monkeypatch) -> None:
    events: list[str] = []
    storage = FakeStorage()
    patch_execute_steps(monkeypatch, events)

    result = rebuild_beta_static_contract(
        "stm",
        execute=True,
        delete_r2=True,
        confirm_reset=True,
        confirm_worker_stopped=True,
        confirm_r2_active_prefix_wipe=True,
        settings=oracle_settings(),
        engine=FakeEngine(events),
        bronze_storage=storage,
    )

    assert storage.deleted_keys == storage.keys[:4]
    assert events == [
        "begin",
        "reset-static",
        "commit",
        "ingest-beta-static",
        "load-beta-silver",
        "refresh-beta-gold",
    ]
    report = result.display_dict()
    assert report["dry_run"] is False
    assert report["delete_r2"] is True
    assert report["reset_executed"] is True
    assert report["r2_cleanup_result"]["delete_requested"] is True
    assert report["static_ingestion"]["label"] == "ingest-stm"
    assert report["static_silver_load"]["label"] == "silver-stm"
    assert report["gold_static_refresh"]["label"] == "gold-stm"


def test_execute_writes_pre_delete_inventory_before_active_r2_wipe(
    monkeypatch,
    tmp_path,
) -> None:
    events: list[str] = []
    storage = FakeStorage()
    pre_delete_report_path = tmp_path / "beta-static-rebuild.json"
    storage.pre_delete_report_path = pre_delete_report_path
    patch_execute_steps(monkeypatch, events)

    rebuild_beta_static_contract(
        "stm",
        execute=True,
        delete_r2=True,
        confirm_reset=True,
        confirm_worker_stopped=True,
        confirm_r2_active_prefix_wipe=True,
        pre_cleanup_report_path=pre_delete_report_path,
        settings=oracle_settings(),
        engine=FakeEngine(events),
        bronze_storage=storage,
    )

    pre_delete_report = json.loads(pre_delete_report_path.read_text(encoding="utf-8"))
    assert pre_delete_report["stage"] == "before_r2_active_prefix_wipe"
    assert pre_delete_report["r2_cleanup_plan"]["planned_count"] == 4
    assert pre_delete_report["execute_confirmations"]["confirm_r2_active_prefix_wipe"] is True


def test_execute_aborts_when_active_r2_wipe_has_failures(monkeypatch) -> None:
    events: list[str] = []
    failing_key = (
        "stm/static_schedule/ingested_at_utc=2026-05-24/"
        "20260524T120000000000Z__abcdef123456__gtfs.zip"
    )
    storage = FakeStorage(fail_delete_keys={failing_key})
    patch_execute_steps(monkeypatch, events)

    with pytest.raises(RuntimeError, match="Active R2 prefix cleanup failed"):
        rebuild_beta_static_contract(
            "stm",
            execute=True,
            delete_r2=True,
            confirm_reset=True,
            confirm_worker_stopped=True,
            confirm_r2_active_prefix_wipe=True,
            settings=oracle_settings(),
            engine=FakeEngine(events),
            bronze_storage=storage,
        )

    assert events == []
    assert failing_key not in storage.deleted_keys


@pytest.mark.parametrize(
    ("confirm_reset", "confirm_worker_stopped"),
    [(False, True), (True, False), (False, False)],
)
def test_execute_requires_reset_and_worker_confirmations(
    confirm_reset: bool,
    confirm_worker_stopped: bool,
) -> None:
    with pytest.raises(ValueError, match="requires --confirm-reset and --confirm-worker-stopped"):
        rebuild_beta_static_contract(
            "stm",
            execute=True,
            confirm_reset=confirm_reset,
            confirm_worker_stopped=confirm_worker_stopped,
            settings=oracle_settings(),
            engine=FakeEngine([]),
            bronze_storage=FakeStorage(),
        )


def test_delete_r2_requires_execute_and_active_prefix_confirmation() -> None:
    with pytest.raises(ValueError, match="requires --execute"):
        rebuild_beta_static_contract(
            "stm",
            delete_r2=True,
            confirm_r2_active_prefix_wipe=True,
            settings=oracle_settings(),
            engine=FakeEngine([]),
            bronze_storage=FakeStorage(),
        )

    with pytest.raises(ValueError, match="requires --confirm-r2-active-prefix-wipe"):
        rebuild_beta_static_contract(
            "stm",
            execute=True,
            delete_r2=True,
            confirm_reset=True,
            confirm_worker_stopped=True,
            settings=oracle_settings(),
            engine=FakeEngine([]),
            bronze_storage=FakeStorage(),
        )


def test_neon_railway_hosts_rejected_before_destructive_work() -> None:
    with pytest.raises(ValueError, match="Refusing beta static rebuild against protected"):
        rebuild_beta_static_contract(
            "stm",
            execute=True,
            confirm_reset=True,
            confirm_worker_stopped=True,
            settings=oracle_settings("postgresql://user:secret@ep-old.us-east-2.aws.neon.tech/transit"),
            engine=FakeEngine([]),
            bronze_storage=FakeStorage(),
        )
