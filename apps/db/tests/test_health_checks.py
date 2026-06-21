from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from transit_ops.health.checks import (
    check_bronze_storage,
    check_database_connectivity,
    check_feed_conformance,
    check_provider_feed_freshness,
    check_runtime_vm_health,
    run_health_checks,
)
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings

NOW = datetime(2026, 5, 22, 14, 0, tzinfo=UTC)


class FakeConnection:
    def __init__(
        self,
        rows: list[dict[str, Any]] | None = None,
        exc: Exception | None = None,
        conformance_rows: list[dict[str, Any]] | None = None,
    ):
        self.rows = rows or []
        self.exc = exc
        self.conformance_rows = conformance_rows or []
        self.queries: list[object] = []

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, query: object, *_args: object, **_kwargs: object) -> list[dict[str, Any]]:
        self.queries.append(query)
        if self.exc:
            raise self.exc
        # The feed-conformance check runs a distinct query against
        # silver.gtfs_extra_rows; route it to its own fixture so freshness rows
        # never leak into it (they lack provider_id).
        if "gtfs_extra_rows" in str(query):
            return self.conformance_rows
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


def test_feed_conformance_ok_when_no_extra_members() -> None:
    conformance_rows = [
        {
            "provider_id": "stm",
            "dataset_version_id": 42,
            "extra_row_count": 0,
            "unknown_members": None,
        }
    ]

    result = check_feed_conformance(
        settings(),
        engine_factory=lambda _: FakeEngine(
            FakeConnection(conformance_rows=conformance_rows)
        ),
        now=NOW,
    )

    assert result.name == "feed_conformance"
    assert result.status == "ok"
    assert result.message == "Latest static load matched the expected GTFS shape."
    assert result.details is not None
    assert result.details["label"] == "conformant"


def test_feed_conformance_degraded_when_out_of_norm_members_present() -> None:
    conformance_rows = [
        {
            "provider_id": "stm",
            "dataset_version_id": 42,
            "extra_row_count": 0,
            "unknown_members": None,
        },
        {
            "provider_id": "sto",
            "dataset_version_id": 7,
            "extra_row_count": 57,
            "unknown_members": ["pathways.txt", "levels.txt"],
        },
    ]

    result = check_feed_conformance(
        settings(),
        engine_factory=lambda _: FakeEngine(
            FakeConnection(conformance_rows=conformance_rows)
        ),
        now=NOW,
    )

    assert result.status == "degraded"
    assert "sto" in result.message
    assert "silver.gtfs_extra_rows" in result.message
    assert result.details["label"] == "out_of_norm"
    # The detail block carries the per-provider breakdown but is dropped from the
    # anonymous-safe public_dict (name + status only).
    assert set(result.public_dict()) == {"name", "status"}


def _feed_row(
    provider_id: str,
    endpoint_key: str,
    feed_kind: str,
    refresh_interval_seconds: int,
    latest: datetime | None,
) -> dict[str, Any]:
    return {
        "provider_id": provider_id,
        "endpoint_key": endpoint_key,
        "feed_kind": feed_kind,
        "refresh_interval_seconds": refresh_interval_seconds,
        "latest_captured_at_utc": latest,
    }


def test_provider_feed_freshness_emits_ok_component_per_fresh_feed() -> None:
    # Holistic per provider: one component per (provider, feed), and a second
    # provider's feeds appear automatically — no hardcoded provider.
    rows = [
        _feed_row("stm", "trip_updates", "trip_updates", 30, NOW - timedelta(seconds=60)),
        _feed_row("sto", "trip_updates", "trip_updates", 30, NOW - timedelta(seconds=120)),
    ]

    results = check_provider_feed_freshness(
        settings(HEALTH_MAX_PIPELINE_AGE_SECONDS=900),
        engine_factory=lambda _: FakeEngine(FakeConnection(rows)),
        now=NOW,
    )

    by_name = {r.name: r for r in results}
    assert set(by_name) == {"stm_trip_updates", "sto_trip_updates"}
    assert all(r.status == "ok" for r in results)
    assert by_name["stm_trip_updates"].details["age_seconds"] == 60
    assert by_name["sto_trip_updates"].details["provider_id"] == "sto"


def test_provider_feed_freshness_degraded_when_feed_is_stale() -> None:
    rows = [
        _feed_row("stm", "trip_updates", "trip_updates", 30, NOW - timedelta(seconds=1000)),
    ]

    results = check_provider_feed_freshness(
        settings(HEALTH_MAX_PIPELINE_AGE_SECONDS=900),
        engine_factory=lambda _: FakeEngine(FakeConnection(rows)),
        now=NOW,
    )

    assert results[0].name == "stm_trip_updates"
    assert results[0].status == "degraded"
    assert "exceeds" in results[0].message
    # 30s refresh * 3 grace = 90, floored at the 900s pipeline budget.
    assert results[0].details["threshold_seconds"] == 900


def test_provider_feed_freshness_uses_per_feed_cadence_for_daily_static() -> None:
    # A daily static feed 2h old is fresh: its threshold derives from its own
    # 86400s refresh, not the 900s realtime floor.
    rows = [
        _feed_row(
            "stm", "static_schedule", "static_schedule", 86400, NOW - timedelta(hours=2)
        ),
    ]

    results = check_provider_feed_freshness(
        settings(HEALTH_MAX_PIPELINE_AGE_SECONDS=900),
        engine_factory=lambda _: FakeEngine(FakeConnection(rows)),
        now=NOW,
    )

    assert results[0].status == "ok"
    assert results[0].details["threshold_seconds"] == 86400 * 3


def test_provider_feed_freshness_degraded_when_no_successful_capture() -> None:
    rows = [_feed_row("stm", "i3_alerts", "i3_alerts", 300, None)]

    results = check_provider_feed_freshness(
        settings(),
        engine_factory=lambda _: FakeEngine(FakeConnection(rows)),
        now=NOW,
    )

    assert results[0].status == "degraded"
    assert "no successful capture" in results[0].message
    assert results[0].details["age_seconds"] is None


def test_provider_feed_freshness_down_when_query_fails() -> None:
    results = check_provider_feed_freshness(
        settings(),
        engine_factory=lambda _: FakeEngine(FakeConnection(exc=RuntimeError("db offline"))),
        now=NOW,
    )

    assert len(results) == 1
    assert results[0].name == "provider_feeds"
    assert results[0].status == "down"
    assert "Provider feed freshness query failed" in results[0].message


def test_provider_feed_freshness_degraded_when_no_feeds_configured() -> None:
    results = check_provider_feed_freshness(
        settings(),
        engine_factory=lambda _: FakeEngine(FakeConnection(rows=[])),
        now=NOW,
    )

    assert len(results) == 1
    assert results[0].name == "provider_feeds"
    assert results[0].status == "degraded"
    assert "No active provider feeds" in results[0].message


def test_provider_feed_freshness_down_when_database_url_missing() -> None:
    results = check_provider_feed_freshness(settings(DATABASE_URL=""), now=NOW)

    assert len(results) == 1
    assert results[0].name == "provider_feeds"
    assert results[0].status == "down"
    assert "DATABASE_URL is not configured" in results[0].message


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
			"bronze_realtime": 90,
			"bronze_static": 30,
			"silver_realtime": 1,
			"gold_fact": 14,
			"gold_warm_rollup": 730,
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
        _feed_row("stm", "trip_updates", "trip_updates", 30, NOW - timedelta(seconds=60)),
        _feed_row(
            "stm", "vehicle_positions", "vehicle_positions", 30, NOW - timedelta(seconds=120)
        ),
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

    # database, then one component per (provider, feed) from the freshness query,
    # then feed_conformance, bronze_storage, runtime_vm.
    assert [result.name for result in results] == [
        "database",
        "stm_trip_updates",
        "stm_vehicle_positions",
        "feed_conformance",
        "bronze_storage",
        "runtime_vm",
    ]
