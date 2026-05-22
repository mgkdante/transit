from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from transit_ops.health.app import create_app
from transit_ops.health.models import ComponentHealthResult, HealthStatus, OverallHealthResult

NOW = datetime(2026, 5, 22, 15, 0, tzinfo=UTC)
FAKE_SECRET = "fake-secret-should-not-leak"


def test_health_returns_200_and_overall_ok_with_component_payload() -> None:
    components = _components()
    expected = OverallHealthResult.from_components(
        checked_at_utc=NOW,
        components=components,
    ).display_dict()

    client = TestClient(create_app(check_runner=lambda: components, clock=lambda: NOW))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == expected
    assert response.json()["status"] == "ok"
    assert len(response.json()["components"]) == 6
    assert response.json()["components"][0] == {
        "name": "database",
        "status": "ok",
        "message": "connected",
        "latency_ms": 1.5,
        "checked_at_utc": "2026-05-22T15:00:00+00:00",
        "details": {"pool": "primary"},
    }


def test_health_returns_200_for_degraded_overall() -> None:
    components = _components(pipeline_freshness="degraded")
    client = TestClient(create_app(check_runner=lambda: components, clock=lambda: NOW))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"


def test_health_returns_503_for_down_overall() -> None:
    components = _components(database="down")
    client = TestClient(create_app(check_runner=lambda: components, clock=lambda: NOW))

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json()["status"] == "down"


def test_health_returns_structured_down_payload_when_runner_fails() -> None:
    def broken_check_runner() -> list[ComponentHealthResult]:
        raise RuntimeError("registry config missing")

    client = TestClient(create_app(check_runner=broken_check_runner, clock=lambda: NOW))

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "down",
        "checked_at_utc": "2026-05-22T15:00:00+00:00",
        "components": [
            {
                "name": "health_runner",
                "status": "down",
                "message": "Health check runner failed: registry config missing",
                "latency_ms": None,
                "checked_at_utc": "2026-05-22T15:00:00+00:00",
                "details": None,
            }
        ],
    }


def test_health_response_uses_only_component_display_payload_without_settings_dump() -> None:
    safe_token = "safe-token-reference"
    components = _components()
    components[0] = ComponentHealthResult(
        name="database",
        status="ok",
        message="connected",
        checked_at_utc=NOW,
        details={
            "database_url": "postgresql://example.test/transit",
            "safe_token": safe_token,
        },
    )

    def check_runner() -> list[ComponentHealthResult]:
        configured_secret_that_must_not_be_serialized = FAKE_SECRET
        assert configured_secret_that_must_not_be_serialized == FAKE_SECRET
        return components

    client = TestClient(create_app(check_runner=check_runner, clock=lambda: NOW))

    response = client.get("/health")

    assert response.json() == OverallHealthResult.from_components(
        checked_at_utc=NOW,
        components=components,
    ).display_dict()
    assert safe_token in response.text
    assert FAKE_SECRET not in response.text
    assert "settings" not in response.json()


def test_health_app_does_not_expose_extra_fastapi_routes() -> None:
    client = TestClient(create_app(check_runner=lambda: _components(), clock=lambda: NOW))

    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def _components(**statuses: HealthStatus) -> list[ComponentHealthResult]:
    defaults: dict[str, HealthStatus] = {
        "database": "ok",
        "pipeline_freshness": "ok",
        "bronze_storage": "ok",
        "stm_static_feed": "ok",
        "stm_trip_updates_feed": "ok",
        "stm_vehicle_positions_feed": "ok",
    }
    defaults.update(statuses)

    return [
        ComponentHealthResult(
            name=name,
            status=status,
            message=_message(name, status),
            latency_ms=1.5,
            checked_at_utc=NOW,
            details={"pool": "primary"} if name == "database" else None,
        )
        for name, status in defaults.items()
    ]


def _message(name: str, status: HealthStatus) -> str:
    if status == "ok":
        return "connected" if name == "database" else "healthy"
    if status == "degraded":
        return "stale"
    return "unavailable"
