from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from transit_ops.health.app import create_app
from transit_ops.health.models import ComponentHealthResult, HealthStatus, OverallHealthResult

NOW = datetime(2026, 5, 22, 15, 0, tzinfo=UTC)
FAKE_SECRET = "fake-secret-should-not-leak"


def test_health_live_returns_ok_without_running_component_checks() -> None:
    def broken_check_runner() -> list[ComponentHealthResult]:
        raise AssertionError("liveness must not run component checks")

    client = TestClient(create_app(check_runner=broken_check_runner, clock=lambda: NOW))

    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_returns_200_and_minimal_public_component_payload() -> None:
    # x-security#4: the internet-facing /health emits the coarse public view
    # (public_dict), NOT the detailed display_dict — no messages, details,
    # latency, feed URLs, or DB DSNs on the anonymous surface.
    components = _components()
    expected = OverallHealthResult.from_components(
        checked_at_utc=NOW,
        components=components,
    ).public_dict()

    client = TestClient(create_app(check_runner=lambda: components, clock=lambda: NOW))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == expected
    assert response.json()["status"] == "ok"
    assert len(response.json()["components"]) == 6
    assert response.json()["components"][0] == {
        "name": "database",
        "status": "ok",
    }
    # Internal fields are absent from every component on the public surface.
    for component in response.json()["components"]:
        assert set(component) == {"name", "status"}
    assert "pipeline_freshness_age_seconds" in response.json()


def test_health_returns_503_for_degraded_overall() -> None:
    components = _components(pipeline_freshness="degraded")
    client = TestClient(create_app(check_runner=lambda: components, clock=lambda: NOW))

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["needs_attention"] is True
    assert response.json()["component_counts"] == {"ok": 5, "degraded": 1, "down": 0}


def test_health_returns_503_for_down_overall() -> None:
    components = _components(database="down")
    client = TestClient(create_app(check_runner=lambda: components, clock=lambda: NOW))

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json()["status"] == "down"
    assert response.json()["needs_attention"] is True
    assert response.json()["component_counts"] == {"ok": 5, "degraded": 0, "down": 1}


def test_health_returns_structured_down_payload_when_runner_fails() -> None:
    def broken_check_runner() -> list[ComponentHealthResult]:
        raise RuntimeError("registry config missing")

    client = TestClient(create_app(check_runner=broken_check_runner, clock=lambda: NOW))

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "down",
        "checked_at_utc": "2026-05-22T15:00:00+00:00",
        "needs_attention": True,
        "component_counts": {"ok": 0, "degraded": 0, "down": 1},
        "components": [
            {
                "name": "health_runner",
                "status": "down",
            }
        ],
        "pipeline_freshness_age_seconds": None,
    }
    # The runner's raw failure reason never reaches the public surface.
    assert "registry config missing" not in response.text


def test_health_response_does_not_leak_component_details_or_messages() -> None:
    # x-security#4: the public surface must drop ALL component detail/message
    # content — feed URLs, DB DSNs, and any error strings — not just secrets.
    feed_url = "https://feed.example.com/tripUpdates?apiKey=LIVE-STM-KEY"
    components = _components()
    components[0] = ComponentHealthResult(
        name="database",
        status="down",
        message="connect failed: postgresql://user:pw@db.internal/transit",
        checked_at_utc=NOW,
        details={
            "database_url": "postgresql://user:pw@db.internal/transit",
            "feed_url": feed_url,
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
    ).public_dict()
    # No DSNs, feed URLs, hosts, credentials, or raw error strings leak.
    assert "postgresql://" not in response.text
    assert "db.internal" not in response.text
    assert "feed.example.com" not in response.text
    assert "LIVE-STM-KEY" not in response.text
    assert "connect failed" not in response.text
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
