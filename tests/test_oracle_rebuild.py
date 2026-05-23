from __future__ import annotations

import json
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime

import pytest

from transit_ops.ingestion.storage import BronzeObjectInfo
from transit_ops.rebuild import oracle as oracle_module
from transit_ops.rebuild.bronze_cleanup import BronzeCleanupResult
from transit_ops.rebuild.oracle import rebuild_oracle_data
from transit_ops.settings import Settings

MAY_STATIC_KEY = (
    "stm/static_schedule/ingested_at_utc=2026-05-01/"
    "20260501T000000000000Z__aaaabbbbcccc__gtfs.zip"
)
MAY_TRIP_UPDATES_KEY = (
    "stm/trip_updates/captured_at_utc=2026-05-01/"
    "20260501T001500000000Z__ddddeeeeffff__trip_updates.pb"
)
MAY_VEHICLE_POSITIONS_KEY = (
    "stm/vehicle_positions/captured_at_utc=2026-05-01/"
    "20260501T002000000000Z__111122223333__vehicle_positions.pb"
)
APRIL_TRIP_UPDATES_KEY = (
    "stm/trip_updates/captured_at_utc=2026-04-30/"
    "20260430T235500000000Z__444455556666__trip_updates.pb"
)


def oracle_settings(database_url: str | None = "postgresql://oracle:secret@oracle-vm.local/transit"):
    return Settings(_env_file=None, DATABASE_URL=database_url)


class FakeStorage:
    storage_backend = "local"

    def __init__(self) -> None:
        self.keys = [
            MAY_STATIC_KEY,
            MAY_TRIP_UPDATES_KEY,
            MAY_VEHICLE_POSITIONS_KEY,
            APRIL_TRIP_UPDATES_KEY,
        ]
        self.deleted_keys: list[str] = []

    def list_objects(self, prefix: str) -> list[BronzeObjectInfo]:
        return [
            BronzeObjectInfo(storage_path=key, byte_size=100, last_modified=None)
            for key in self.keys
            if key.startswith(prefix)
        ]

    def delete_object(self, storage_path: str) -> None:
        self.deleted_keys.append(storage_path)


class FakeConnection:
    def __init__(self, events: list[str]) -> None:
        self.events = events


class FakeConnectionContext(AbstractContextManager[FakeConnection]):
    def __init__(self, events: list[str], enter_event: str, exit_event: str) -> None:
        self.events = events
        self.enter_event = enter_event
        self.exit_event = exit_event
        self.connection = FakeConnection(events)

    def __enter__(self) -> FakeConnection:
        self.events.append(self.enter_event)
        return self.connection

    def __exit__(self, exc_type, exc, traceback) -> None:  # noqa: ANN001
        if exc_type is None:
            self.events.append(self.exit_event)
        elif self.exit_event == "commit":
            self.events.append("rollback")
        else:
            self.events.append(self.exit_event)


class FakeEngine:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def connect(self) -> FakeConnectionContext:
        return FakeConnectionContext(self.events, "connect", "connect-exit")

    def begin(self) -> FakeConnectionContext:
        return FakeConnectionContext(self.events, "begin", "commit")


@dataclass(frozen=True)
class FakeDisplayResult:
    name: str
    happened_at_utc: datetime = datetime(2026, 5, 1, tzinfo=UTC)

    def display_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "happened_at_utc": self.happened_at_utc.isoformat(),
        }


def patch_execute_dependencies(monkeypatch, events: list[str]) -> None:  # noqa: ANN001
    def fake_collect_parity_evidence(connection, *, provider_id):  # noqa: ANN001
        phase = "before" if "before-parity" not in events else "after"
        events.append(f"{phase}-parity")
        return FakeDisplayResult(f"{phase}-parity")

    def fake_execute_cleanup(storage, plan, *, delete):  # noqa: ANN001
        events.append(f"cleanup-delete-{delete}")
        return BronzeCleanupResult.from_plan(
            plan,
            delete_requested=delete,
            deleted_keys=["old-key"] if delete else [],
            failed_keys=[],
        )

    def fake_reset(connection) -> None:  # noqa: ANN001
        events.append("reset")

    def fake_rebuild_raw_catalog(
        connection,
        *,
        provider_id,
        selection,
        settings,
        registry,
        storage,
    ):  # noqa: ANN001
        events.append("raw-catalog")
        return FakeDisplayResult("raw-catalog")

    def fake_find_static(connection, *, provider_id, endpoint_key, settings, project_root):  # noqa: ANN001
        events.append("static-find")
        return FakeDisplayResult("static-archive")

    def fake_load_static(connection, *, archive, bronze_storage):  # noqa: ANN001
        events.append("static-load")
        return FakeDisplayResult("static-load")

    def fake_find_realtime(connection, *, provider_id, start_utc, end_utc, settings, project_root):  # noqa: ANN001
        events.append("realtime-find")
        return [FakeDisplayResult("trip-updates"), FakeDisplayResult("vehicle-positions")]

    def fake_load_realtime(
        connection,
        *,
        provider_id,
        snapshots,
        bronze_storage,
        skip_existing,
    ):  # noqa: ANN001
        events.append(f"realtime-load-skip-{skip_existing}")
        return FakeDisplayResult("realtime-load")

    def fake_build_gold(provider_id, *, settings, registry, engine):  # noqa: ANN001
        events.append("gold")
        return FakeDisplayResult("gold")

    def fake_build_warm(provider_id, *, settings, engine, since_utc):  # noqa: ANN001
        events.append(f"warm-{since_utc.isoformat()}")
        return FakeDisplayResult("warm")

    def fake_build_gold_in_transaction(
        connection,
        *,
        provider_id,
        settings,
        registry,
    ):  # noqa: ANN001
        events.append("gold")
        return FakeDisplayResult("gold")

    def fake_build_warm_in_transaction(
        connection,
        *,
        provider_id,
        since_utc,
    ):  # noqa: ANN001
        events.append(f"warm-{since_utc.isoformat()}")
        return FakeDisplayResult("warm")

    monkeypatch.setattr(oracle_module, "collect_parity_evidence", fake_collect_parity_evidence)
    monkeypatch.setattr(oracle_module, "execute_bronze_cleanup_plan", fake_execute_cleanup)
    monkeypatch.setattr(oracle_module, "reset_rebuild_tables", fake_reset)
    monkeypatch.setattr(oracle_module, "rebuild_raw_catalog", fake_rebuild_raw_catalog)
    monkeypatch.setattr(oracle_module, "find_latest_static_bronze_archive", fake_find_static)
    monkeypatch.setattr(oracle_module, "load_static_zip_to_silver", fake_load_static)
    monkeypatch.setattr(oracle_module, "find_realtime_bronze_snapshots", fake_find_realtime)
    monkeypatch.setattr(oracle_module, "load_realtime_snapshots_to_silver", fake_load_realtime)
    monkeypatch.setattr(oracle_module, "build_gold_marts", fake_build_gold, raising=False)
    monkeypatch.setattr(oracle_module, "build_warm_rollups", fake_build_warm, raising=False)
    monkeypatch.setattr(
        oracle_module,
        "_build_gold_marts_in_transaction",
        fake_build_gold_in_transaction,
        raising=False,
    )
    monkeypatch.setattr(
        oracle_module,
        "_build_warm_rollups_in_transaction",
        fake_build_warm_in_transaction,
        raising=False,
    )


def test_missing_database_url_rejected() -> None:
    with pytest.raises(ValueError, match="DATABASE_URL is required"):
        rebuild_oracle_data(
            "stm",
            settings=oracle_settings(None),
            engine=FakeEngine([]),
            bronze_storage=FakeStorage(),
        )


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://user:secret@ep-old.us-east-2.aws.neon.tech/transit",
        "postgresql://user:secret@containers-us-west-1.railway.app/transit",
        "postgresql://user:secret@roundhouse.proxy.rlwy.net/transit",
    ],
)
def test_neon_railway_hosts_rejected_before_destructive_work(
    monkeypatch,
    database_url: str,
) -> None:
    events: list[str] = []
    patch_execute_dependencies(monkeypatch, events)

    with pytest.raises(ValueError) as excinfo:
        rebuild_oracle_data(
            "stm",
            execute=True,
            confirm_reset=True,
            confirm_worker_stopped=True,
            settings=oracle_settings(database_url),
            engine=FakeEngine(events),
            bronze_storage=FakeStorage(),
        )

    assert "Refusing Oracle rebuild against protected hosted database host" in str(excinfo.value)
    assert "secret" not in str(excinfo.value)
    assert events == []


def test_non_stm_provider_rejected_before_r2_or_database_work(monkeypatch) -> None:
    events: list[str] = []
    patch_execute_dependencies(monkeypatch, events)

    with pytest.raises(ValueError, match="only supports provider 'stm'"):
        rebuild_oracle_data(
            "exo",
            execute=True,
            delete_r2=True,
            confirm_reset=True,
            confirm_worker_stopped=True,
            confirm_r2_delete_before=date(2026, 5, 1),
            settings=oracle_settings(),
            engine=FakeEngine(events),
            bronze_storage=FakeStorage(),
        )

    assert events == []


def test_database_target_report_strips_query_and_fragment_secrets(monkeypatch) -> None:
    events: list[str] = []
    patch_execute_dependencies(monkeypatch, events)

    result = rebuild_oracle_data(
        "stm",
        settings=oracle_settings(
            "postgresql://oracle:secret@oracle-vm.local/transit"
            "?sslmode=require&sslpassword=secret-query#secret-fragment"
        ),
        engine=FakeEngine(events),
        bronze_storage=FakeStorage(),
    )

    target = result.display_dict()["database_target"]
    assert target["url"] == "postgresql://oracle-vm.local/transit"
    assert "secret" not in json.dumps(target)


def test_dry_run_builds_plan_selection_and_before_parity_without_destructive_steps(
    monkeypatch,
) -> None:
    events: list[str] = []
    patch_execute_dependencies(monkeypatch, events)

    result = rebuild_oracle_data(
        "stm",
        settings=oracle_settings(),
        engine=FakeEngine(events),
        bronze_storage=FakeStorage(),
    )

    report = result.display_dict()
    assert report["provider_id"] == "stm"
    assert report["month"] == "2026-05"
    assert report["dry_run"] is True
    assert report["reset_executed"] is False
    assert report["before_parity"] == {
        "name": "before-parity",
        "happened_at_utc": "2026-05-01T00:00:00+00:00",
    }
    assert report["cleanup_plan"]["eligible_count"] == 1
    assert report["selection"]["static_count"] == 1
    assert report["selection"]["realtime_count"] == 2
    assert report["execute_confirmations"] == {
        "execute": False,
        "confirm_reset": False,
        "confirm_worker_stopped": False,
        "delete_r2": False,
        "confirm_r2_delete_before": None,
        "r2_delete_confirmation_required": "2026-05-01",
    }
    assert events == ["connect", "before-parity", "connect-exit"]


@pytest.mark.parametrize(
    ("confirm_reset", "confirm_worker_stopped"),
    [(False, True), (True, False), (False, False)],
)
def test_execute_requires_reset_and_worker_confirmations(
    confirm_reset: bool,
    confirm_worker_stopped: bool,
) -> None:
    with pytest.raises(ValueError, match="requires --confirm-reset and --confirm-worker-stopped"):
        rebuild_oracle_data(
            "stm",
            execute=True,
            confirm_reset=confirm_reset,
            confirm_worker_stopped=confirm_worker_stopped,
            settings=oracle_settings(),
            engine=FakeEngine([]),
            bronze_storage=FakeStorage(),
        )


def test_delete_r2_requires_execute_and_exact_confirmation() -> None:
    with pytest.raises(ValueError, match="requires --execute"):
        rebuild_oracle_data(
            "stm",
            delete_r2=True,
            confirm_r2_delete_before=date(2026, 5, 1),
            settings=oracle_settings(),
            engine=FakeEngine([]),
            bronze_storage=FakeStorage(),
        )

    with pytest.raises(ValueError, match="requires --confirm-r2-delete-before 2026-05-01"):
        rebuild_oracle_data(
            "stm",
            execute=True,
            delete_r2=True,
            confirm_reset=True,
            confirm_worker_stopped=True,
            confirm_r2_delete_before=date(2026, 4, 30),
            settings=oracle_settings(),
            engine=FakeEngine([]),
            bronze_storage=FakeStorage(),
        )


def test_rejects_non_may_month_before_cleanup_selection_and_destructive_work(
    monkeypatch,
) -> None:
    events: list[str] = []
    patch_execute_dependencies(monkeypatch, events)

    with pytest.raises(ValueError, match="only supports month 2026-05"):
        rebuild_oracle_data(
            "stm",
            month="2026-04",
            execute=True,
            confirm_reset=True,
            confirm_worker_stopped=True,
            settings=oracle_settings(),
            engine=FakeEngine(events),
            bronze_storage=FakeStorage(),
        )

    assert events == []


def test_execute_order_deletes_cleanup_before_reset_then_rebuilds_all_layers(
    monkeypatch,
) -> None:
    events: list[str] = []
    patch_execute_dependencies(monkeypatch, events)

    result = rebuild_oracle_data(
        "stm",
        execute=True,
        delete_r2=True,
        confirm_reset=True,
        confirm_worker_stopped=True,
        confirm_r2_delete_before="2026-05-01",
        settings=oracle_settings(),
        engine=FakeEngine(events),
        bronze_storage=FakeStorage(),
    )

    assert events == [
        "connect",
        "before-parity",
        "connect-exit",
        "cleanup-delete-True",
        "begin",
        "reset",
        "raw-catalog",
        "static-find",
        "static-load",
        "realtime-find",
        "realtime-load-skip-True",
        "gold",
        "warm-2026-05-01T00:00:00+00:00",
        "after-parity",
        "commit",
    ]
    report = result.display_dict()
    assert report["dry_run"] is False
    assert report["delete_r2"] is True
    assert report["reset_executed"] is True
    assert report["cleanup_result"]["delete_requested"] is True
    assert report["after_parity"] == {
        "name": "after-parity",
        "happened_at_utc": "2026-05-01T00:00:00+00:00",
    }


def test_gold_failure_rolls_back_execute_transaction(monkeypatch) -> None:
    events: list[str] = []
    patch_execute_dependencies(monkeypatch, events)

    def fail_gold_public(provider_id, *, settings, registry, engine):  # noqa: ANN001
        events.append("gold")
        raise RuntimeError("gold failed")

    def fail_gold_transaction(connection, *, provider_id, settings, registry):  # noqa: ANN001
        events.append("gold")
        raise RuntimeError("gold failed")

    monkeypatch.setattr(oracle_module, "build_gold_marts", fail_gold_public, raising=False)
    monkeypatch.setattr(
        oracle_module,
        "_build_gold_marts_in_transaction",
        fail_gold_transaction,
        raising=False,
    )

    with pytest.raises(RuntimeError, match="gold failed"):
        rebuild_oracle_data(
            "stm",
            execute=True,
            confirm_reset=True,
            confirm_worker_stopped=True,
            settings=oracle_settings(),
            engine=FakeEngine(events),
            bronze_storage=FakeStorage(),
        )

    assert events == [
        "connect",
        "before-parity",
        "connect-exit",
        "cleanup-delete-False",
        "begin",
        "reset",
        "raw-catalog",
        "static-find",
        "static-load",
        "realtime-find",
        "realtime-load-skip-True",
        "gold",
        "rollback",
    ]
    assert "commit" not in events


def test_warm_rollup_failure_rolls_back_execute_transaction(monkeypatch) -> None:
    events: list[str] = []
    patch_execute_dependencies(monkeypatch, events)

    def fail_warm_public(provider_id, *, settings, engine, since_utc):  # noqa: ANN001
        events.append(f"warm-{since_utc.isoformat()}")
        raise RuntimeError("warm failed")

    def fail_warm_transaction(connection, *, provider_id, since_utc):  # noqa: ANN001
        events.append(f"warm-{since_utc.isoformat()}")
        raise RuntimeError("warm failed")

    monkeypatch.setattr(oracle_module, "build_warm_rollups", fail_warm_public, raising=False)
    monkeypatch.setattr(
        oracle_module,
        "_build_warm_rollups_in_transaction",
        fail_warm_transaction,
        raising=False,
    )

    with pytest.raises(RuntimeError, match="warm failed"):
        rebuild_oracle_data(
            "stm",
            execute=True,
            confirm_reset=True,
            confirm_worker_stopped=True,
            settings=oracle_settings(),
            engine=FakeEngine(events),
            bronze_storage=FakeStorage(),
        )

    assert events == [
        "connect",
        "before-parity",
        "connect-exit",
        "cleanup-delete-False",
        "begin",
        "reset",
        "raw-catalog",
        "static-find",
        "static-load",
        "realtime-find",
        "realtime-load-skip-True",
        "gold",
        "warm-2026-05-01T00:00:00+00:00",
        "rollback",
    ]
    assert "commit" not in events


def test_display_dict_is_json_safe_for_dry_run_and_execute(monkeypatch) -> None:
    dry_events: list[str] = []
    patch_execute_dependencies(monkeypatch, dry_events)
    dry_run = rebuild_oracle_data(
        "stm",
        settings=oracle_settings(),
        engine=FakeEngine(dry_events),
        bronze_storage=FakeStorage(),
    )
    json.dumps(dry_run.display_dict(), sort_keys=True)

    execute_events: list[str] = []
    patch_execute_dependencies(monkeypatch, execute_events)
    executed = rebuild_oracle_data(
        "stm",
        execute=True,
        confirm_reset=True,
        confirm_worker_stopped=True,
        settings=oracle_settings(),
        engine=FakeEngine(execute_events),
        bronze_storage=FakeStorage(),
    )
    json.dumps(executed.display_dict(), sort_keys=True)
