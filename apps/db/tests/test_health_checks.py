from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from transit_ops.health.checks import (
    check_bronze_storage,
    check_database_connectivity,
    check_pipeline_freshness,
    check_runtime_vm_health,
    run_health_checks,
)
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings

NOW = datetime(2026, 5, 22, 14, 0, tzinfo=UTC)


class FakeConnection:
    def __init__(self, rows: list[dict[str, Any]] | None = None, exc: Exception | None = None):
        self.rows = rows or []
        self.exc = exc
        self.queries: list[object] = []

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, query: object, *_args: object, **_kwargs: object) -> list[dict[str, Any]]:
        self.queries.append(query)
        if self.exc:
            raise self.exc
        return self.rows


class FakeEngine:
    def __init__(self, connection: FakeConnection | None = None, exc: Exception | None = None):
        self.connection = connection or FakeConnection()
        self.exc = exc

    def connect(self) -> FakeConnection:
        if self.exc:
            raise self.exc
        return self.connection


@dataclass
class FakeStorage:
    storage_backend: str
    root: Path | None = None
    bucket: str | None = None
    client: object | None = None
    exists_result: bool = False
    exists_exc: Exception | None = None
    exists_calls: list[str] | None = None

    def describe_location(self, storage_path: str) -> str:
        if self.storage_backend == "s3":
            return f"s3://{self.bucket}/{storage_path}"
        return str((self.root or Path("/tmp/bronze")) / storage_path)

    def exists(self, storage_path: str) -> bool:
        if self.exists_calls is None:
            self.exists_calls = []
        self.exists_calls.append(storage_path)
        if self.exists_exc:
            raise self.exists_exc
        return self.exists_result


class FakeS3Client:
    def __init__(self, exc: Exception | None = None):
        self.exc = exc
        self.calls: list[dict[str, object]] = []

    def list_objects_v2(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        if self.exc:
            raise self.exc
        return {"KeyCount": 0}


class FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code


def settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "_env_file": None,
        "DATABASE_URL": "postgresql://user:pass@example.test/transit",
        "BRONZE_STORAGE_BACKEND": "local",
        "BRONZE_LOCAL_ROOT": "./bronze",
        "STM_API_KEY": "super-secret-api-key",
    }
    defaults.update(overrides)
    return Settings(**defaults)


def test_database_connectivity_ok_runs_select_1() -> None:
    connection = FakeConnection()

    result = check_database_connectivity(
        settings(),
        engine_factory=lambda _: FakeEngine(connection),
        now=NOW,
    )

    assert result.name == "database"
    assert result.status == "ok"
    assert result.checked_at_utc == NOW
    assert result.latency_ms is not None
    assert len(connection.queries) == 1
    assert "SELECT 1" in str(connection.queries[0])


def test_database_connectivity_down_when_database_url_missing() -> None:
    result = check_database_connectivity(
        settings(DATABASE_URL=None),
        engine_factory=lambda _: FakeEngine(),
        now=NOW,
    )

    assert result.name == "database"
    assert result.status == "down"
    assert "DATABASE_URL" in result.message


def test_database_connectivity_down_when_query_fails() -> None:
    result = check_database_connectivity(
        settings(),
        engine_factory=lambda _: FakeEngine(FakeConnection(exc=RuntimeError("boom"))),
        now=NOW,
    )

    assert result.name == "database"
    assert result.status == "down"
    assert "Database connectivity check failed" in result.message


def test_pipeline_freshness_ok_when_realtime_endpoints_are_recent() -> None:
    rows = [
        {
            "endpoint_key": "trip_updates",
            "latest_captured_at_utc": NOW - timedelta(seconds=60),
        },
        {
            "endpoint_key": "vehicle_positions",
            "latest_captured_at_utc": NOW - timedelta(seconds=120),
        },
        {
            "endpoint_key": "i3_alerts",
            "latest_captured_at_utc": NOW - timedelta(seconds=90),
        },
    ]

    result = check_pipeline_freshness(
        settings(HEALTH_MAX_PIPELINE_AGE_SECONDS=300),
        engine_factory=lambda _: FakeEngine(FakeConnection(rows)),
        now=NOW,
    )

    assert result.name == "pipeline_freshness"
    assert result.status == "ok"
    assert result.details is not None
    assert result.details["threshold_seconds"] == 300
    assert result.details["endpoints"]["trip_updates"]["age_seconds"] == 60
    assert result.details["endpoints"]["vehicle_positions"]["age_seconds"] == 120
    assert result.details["endpoints"]["i3_alerts"]["age_seconds"] == 90


def test_pipeline_freshness_degraded_when_endpoint_is_stale() -> None:
    rows = [
        {
            "endpoint_key": "trip_updates",
            "latest_captured_at_utc": NOW - timedelta(seconds=301),
        },
        {
            "endpoint_key": "vehicle_positions",
            "latest_captured_at_utc": NOW - timedelta(seconds=30),
        },
        {
            "endpoint_key": "i3_alerts",
            "latest_captured_at_utc": NOW - timedelta(seconds=30),
        },
    ]

    result = check_pipeline_freshness(
        settings(HEALTH_MAX_PIPELINE_AGE_SECONDS=300),
        engine_factory=lambda _: FakeEngine(FakeConnection(rows)),
        now=NOW,
    )

    assert result.status == "degraded"
    assert "stale" in result.message


def test_pipeline_freshness_degraded_when_endpoint_data_is_missing() -> None:
    rows = [
        {
            "endpoint_key": "trip_updates",
            "latest_captured_at_utc": NOW - timedelta(seconds=60),
        },
    ]

    result = check_pipeline_freshness(
        settings(),
        engine_factory=lambda _: FakeEngine(FakeConnection(rows)),
        now=NOW,
    )

    assert result.status == "degraded"
    assert "vehicle_positions" in result.message
    assert result.details is not None
    assert result.details["endpoints"]["vehicle_positions"]["latest_captured_at_utc"] is None


def test_pipeline_freshness_down_when_query_fails() -> None:
    result = check_pipeline_freshness(
        settings(),
        engine_factory=lambda _: FakeEngine(FakeConnection(exc=RuntimeError("db offline"))),
        now=NOW,
    )

    assert result.status == "down"
    assert "Pipeline freshness query failed" in result.message


def test_local_bronze_storage_ok_when_root_exists_and_can_be_read(tmp_path: Path) -> None:
    local_root = tmp_path / "health-bronze"
    local_root.mkdir()

    result = check_bronze_storage(
        settings(BRONZE_STORAGE_BACKEND="local", BRONZE_LOCAL_ROOT="./health-bronze"),
        project_root=tmp_path,
        now=NOW,
    )

    assert result.name == "bronze_storage"
    assert result.status == "ok"
    assert (tmp_path / "health-bronze").is_dir()
    assert result.details == {
        "backend": "local",
        "location": str(tmp_path / "health-bronze"),
    }


def test_local_bronze_storage_down_when_root_is_missing(tmp_path: Path) -> None:
    local_root = tmp_path / "health-bronze"

    result = check_bronze_storage(
        settings(BRONZE_STORAGE_BACKEND="local", BRONZE_LOCAL_ROOT="./health-bronze"),
        project_root=tmp_path,
        now=NOW,
    )

    assert result.name == "bronze_storage"
    assert result.status == "down"
    assert local_root.exists() is False
    assert "does not exist" in result.message
    assert result.details == {
        "backend": "local",
        "location": str(local_root),
    }


def test_local_bronze_storage_down_when_root_cannot_be_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    local_root = tmp_path / "health-bronze"
    local_root.mkdir()
    original_iterdir = Path.iterdir

    def unreadable_iterdir(path: Path) -> Any:
        if path == local_root:
            raise PermissionError("directory read denied")
        return original_iterdir(path)

    monkeypatch.setattr(Path, "iterdir", unreadable_iterdir)

    result = check_bronze_storage(
        settings(BRONZE_STORAGE_BACKEND="local", BRONZE_LOCAL_ROOT="./health-bronze"),
        project_root=tmp_path,
        now=NOW,
    )

    assert result.name == "bronze_storage"
    assert result.status == "down"
    assert "directory read denied" in result.message
    assert result.details == {
        "backend": "local",
        "location": str(local_root),
    }


def test_s3_bronze_storage_ok_when_sentinel_is_absent_but_access_path_is_checked(
    tmp_path: Path,
) -> None:
    fake_client = FakeS3Client()
    fake_storage = FakeStorage(
        storage_backend="s3",
        bucket="transit-raw",
        client=fake_client,
        exists_result=False,
    )

    result = check_bronze_storage(
        settings(BRONZE_STORAGE_BACKEND="s3"),
        project_root=tmp_path,
        storage_factory=lambda *_args, **_kwargs: fake_storage,
        now=NOW,
    )

    assert result.name == "bronze_storage"
    assert result.status == "ok"
    assert fake_client.calls == [{"Bucket": "transit-raw", "MaxKeys": 1}]
    assert fake_storage.exists_calls == ["healthcheck/sentinel"]
    assert result.details == {
        "backend": "s3",
        "location": "s3://transit-raw/",
    }


def test_s3_bronze_storage_down_when_access_check_fails(tmp_path: Path) -> None:
    fake_client = FakeS3Client(exc=RuntimeError("access denied"))
    fake_storage = FakeStorage(
        storage_backend="s3",
        bucket="transit-raw",
        client=fake_client,
    )

    result = check_bronze_storage(
        settings(BRONZE_STORAGE_BACKEND="s3"),
        project_root=tmp_path,
        storage_factory=lambda *_args, **_kwargs: fake_storage,
        now=NOW,
    )

    assert result.name == "bronze_storage"
    assert result.status == "down"
    assert "access denied" in result.message
    assert result.details == {
        "backend": "s3",
        "location": "s3://transit-raw/",
    }


def test_runtime_vm_health_exposes_sanitized_cost_free_metrics() -> None:
    result = check_runtime_vm_health(
        settings(),
        now=NOW,
        stats_provider=lambda: {
            "disk_used_percent": 72.5,
            "memory_used_percent": 61.2,
            "load_1m": 0.42,
            "cpu_count": 4,
            "uptime_seconds": 123456,
            "python_version": "3.12.9",
            "platform_system": "Linux",
            "platform_machine": "aarch64",
            "hostname": "must-not-leak",
            "ip_address": "203.0.113.10",
            "home_path": "/home/mgkdante",
        },
        use_cache=False,
    )

    assert result.name == "runtime_vm"
    assert result.status == "ok"
    assert result.details is not None
    assert result.details["disk_used_percent"] == 72.5
    assert result.details["memory_used_percent"] == 61.2
    assert result.details["python_version"] == "3.12.9"
    assert result.details["retention_days"] == {
        "bronze_realtime": 30,
        "bronze_static": 30,
        "silver_realtime": 14,
        "gold_fact": 14,
        "gold_warm_rollup": 365,
    }
    serialized = str(result.display_dict())
    assert "must-not-leak" not in serialized
    assert "203.0.113.10" not in serialized
    assert "/home/mgkdante" not in serialized


def test_runtime_vm_health_degrades_on_high_storage_or_memory() -> None:
    result = check_runtime_vm_health(
        settings(),
        now=NOW,
        stats_provider=lambda: {
            "disk_used_percent": 96.0,
            "memory_used_percent": 80.0,
        },
        use_cache=False,
    )

    assert result.status == "degraded"
    assert "resource pressure" in result.message


def test_run_health_checks_returns_quota_free_components_in_order(tmp_path: Path) -> None:
    rows = [
        {
            "endpoint_key": "trip_updates",
            "latest_captured_at_utc": NOW - timedelta(seconds=60),
        },
        {
            "endpoint_key": "vehicle_positions",
            "latest_captured_at_utc": NOW - timedelta(seconds=120),
        },
        {
            "endpoint_key": "i3_alerts",
            "latest_captured_at_utc": NOW - timedelta(seconds=90),
        },
    ]

    health_settings = settings(
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT="./bronze",
        HEALTH_MAX_PIPELINE_AGE_SECONDS=300,
    )
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=health_settings,
    )

    def forbidden_requester(*_args: object, **_kwargs: object) -> FakeResponse:
        raise AssertionError("normal /health must not call STM feeds")

    results = run_health_checks(
        health_settings,
        registry=registry,
        now=NOW,
        project_root=tmp_path,
        engine_factory=lambda _: FakeEngine(FakeConnection(rows)),
        requester=forbidden_requester,
    )

    assert [result.name for result in results] == [
        "database",
        "pipeline_freshness",
        "bronze_storage",
        "runtime_vm",
    ]
