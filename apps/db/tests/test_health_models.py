import json
from datetime import UTC, datetime

import pytest

from transit_ops.health import (
    HEALTH_STATUSES,
    ComponentHealthResult,
    OverallHealthResult,
    aggregate_health_status,
)


def test_health_statuses_are_exact_runtime_values() -> None:
    assert HEALTH_STATUSES == ("ok", "degraded", "down")


def test_component_health_result_rejects_unknown_status() -> None:
    with pytest.raises(ValueError, match="Unsupported health status"):
        ComponentHealthResult(
            name="database",
            status="unknown",
            message="bad status",
        )


def test_component_health_result_display_dict_is_json_safe() -> None:
    checked_at = datetime(2026, 5, 22, 12, 30, tzinfo=UTC)

    result = ComponentHealthResult(
        name="database",
        status="ok",
        message="connected",
        latency_ms=12.5,
        checked_at_utc=checked_at,
        details={"pool": "primary", "attempt": 1},
    )

    assert result.display_dict() == {
        "name": "database",
        "status": "ok",
        "message": "connected",
        "latency_ms": 12.5,
        "checked_at_utc": "2026-05-22T12:30:00+00:00",
        "details": {"pool": "primary", "attempt": 1},
    }


def test_component_health_result_display_dict_serializes_nested_detail_datetimes() -> None:
    checked_at = datetime(2026, 5, 22, 12, 30, tzinfo=UTC)
    detail_time = datetime(2026, 5, 22, 12, 29, 30, tzinfo=UTC)

    result = ComponentHealthResult(
        name="database",
        status="degraded",
        message="slow query",
        checked_at_utc=checked_at,
        details={
            "last_success_at_utc": detail_time,
            "recent_checks": [
                {"checked_at_utc": detail_time, "latency_ms": 22.4},
                ("ok", detail_time),
            ],
        },
    )

    payload = result.display_dict()

    assert payload["details"] == {
        "last_success_at_utc": "2026-05-22T12:29:30+00:00",
        "recent_checks": [
            {"checked_at_utc": "2026-05-22T12:29:30+00:00", "latency_ms": 22.4},
            ["ok", "2026-05-22T12:29:30+00:00"],
        ],
    }
    json.dumps(payload)


def test_overall_health_result_down_wins_over_degraded_and_ok() -> None:
    checked_at = datetime(2026, 5, 22, 12, 45, tzinfo=UTC)

    result = OverallHealthResult.from_components(
        checked_at_utc=checked_at,
        components=[
            ComponentHealthResult(
                name="worker",
                status="degraded",
                message="lagging",
            ),
            ComponentHealthResult(
                name="database",
                status="down",
                message="connection failed",
            ),
            ComponentHealthResult(
                name="static-feed",
                status="ok",
                message="fresh",
            ),
        ],
    )

    assert result.status == "down"
    assert result.display_dict() == {
        "status": "down",
        "checked_at_utc": "2026-05-22T12:45:00+00:00",
        "needs_attention": True,
        "component_counts": {"ok": 1, "degraded": 1, "down": 1},
        "components": [
            {
                "name": "worker",
                "status": "degraded",
                "message": "lagging",
                "latency_ms": None,
                "checked_at_utc": None,
                "details": None,
            },
            {
                "name": "database",
                "status": "down",
                "message": "connection failed",
                "latency_ms": None,
                "checked_at_utc": None,
                "details": None,
            },
            {
                "name": "static-feed",
                "status": "ok",
                "message": "fresh",
                "latency_ms": None,
                "checked_at_utc": None,
                "details": None,
            },
        ],
    }


def test_overall_health_result_degraded_wins_over_ok() -> None:
    result = OverallHealthResult.from_components(
        checked_at_utc=datetime(2026, 5, 22, 12, 45, tzinfo=UTC),
        components=[
            ComponentHealthResult(
                name="database",
                status="ok",
                message="connected",
            ),
            ComponentHealthResult(
                name="pipeline_freshness",
                status="degraded",
                message="stale",
            ),
        ],
    )

    assert result.status == "degraded"
    assert result.display_dict()["needs_attention"] is True
    assert result.display_dict()["component_counts"] == {
        "ok": 1,
        "degraded": 1,
        "down": 0,
    }


def test_overall_health_result_ok_has_no_attention_flag_and_counts() -> None:
    result = OverallHealthResult.from_components(
        checked_at_utc=datetime(2026, 5, 22, 12, 45, tzinfo=UTC),
        components=[
            ComponentHealthResult(
                name="database",
                status="ok",
                message="connected",
            ),
            ComponentHealthResult(
                name="worker",
                status="ok",
                message="running",
            ),
        ],
    )

    assert result.display_dict()["needs_attention"] is False
    assert result.display_dict()["component_counts"] == {
        "ok": 2,
        "degraded": 0,
        "down": 0,
    }


def test_component_public_dict_omits_message_details_and_latency() -> None:
    # x-security#4: the public /health must not echo error strings, feed URLs,
    # DB/storage detail, or latency — only the coarse name + status survive.
    checked_at = datetime(2026, 5, 22, 12, 30, tzinfo=UTC)
    result = ComponentHealthResult(
        name="stm_trip_updates_feed",
        status="down",
        message="STM feed check failed: <ConnectError> https://feed/x?apiKey=SECRET",
        latency_ms=42.0,
        checked_at_utc=checked_at,
        details={"url": "https://feed.example.com/tripUpdates?apiKey=SECRET"},
    )

    assert result.public_dict() == {
        "name": "stm_trip_updates_feed",
        "status": "down",
    }


def test_overall_public_dict_trims_to_coarse_status_and_freshness_age() -> None:
    checked_at = datetime(2026, 5, 22, 12, 45, tzinfo=UTC)
    captured_at = datetime(2026, 5, 22, 12, 40, tzinfo=UTC)
    result = OverallHealthResult.from_components(
        checked_at_utc=checked_at,
        components=[
            ComponentHealthResult(
                name="database",
                status="ok",
                message="connected to postgresql://user:pw@db.internal/transit",
                latency_ms=1.5,
                details={"database_url": "postgresql://user:pw@db.internal/transit"},
            ),
            ComponentHealthResult(
                name="stm_trip_updates",
                status="ok",
                message="stm/trip_updates: capture is fresh.",
                details={
                    "provider_id": "stm",
                    "endpoint_key": "trip_updates",
                    "feed_kind": "trip_updates",
                    "age_seconds": 120,
                    "threshold_seconds": 900,
                    "latest_captured_at_utc": captured_at,
                },
            ),
            ComponentHealthResult(
                name="stm_vehicle_positions",
                status="ok",
                message="stm/vehicle_positions: capture is fresh.",
                details={
                    "provider_id": "stm",
                    "endpoint_key": "vehicle_positions",
                    "feed_kind": "vehicle_positions",
                    "age_seconds": 300,
                    "threshold_seconds": 900,
                    "latest_captured_at_utc": captured_at,
                    "url": "https://feed.example.com/tripUpdates?apiKey=SECRET",
                },
            ),
        ],
    )

    payload = result.public_dict()

    assert payload == {
        "status": "ok",
        "checked_at_utc": "2026-05-22T12:45:00+00:00",
        "needs_attention": False,
        "component_counts": {"ok": 3, "degraded": 0, "down": 0},
        "components": [
            {"name": "database", "status": "ok"},
            {"name": "stm_trip_updates", "status": "ok"},
            {"name": "stm_vehicle_positions", "status": "ok"},
        ],
        # freshness age = max feed-capture age across providers, a non-sensitive scalar
        "pipeline_freshness_age_seconds": 300,
    }
    serialized = json.dumps(payload)
    # No URLs, hosts, credentials, DB DSNs, or raw error strings leak.
    assert "SECRET" not in serialized
    assert "feed.example.com" not in serialized
    assert "postgresql://" not in serialized
    assert "db.internal" not in serialized


def test_overall_public_dict_freshness_age_is_none_when_unavailable() -> None:
    result = OverallHealthResult.from_components(
        checked_at_utc=datetime(2026, 5, 22, 12, 45, tzinfo=UTC),
        components=[
            ComponentHealthResult(name="database", status="down", message="boom"),
        ],
    )

    payload = result.public_dict()

    assert payload["pipeline_freshness_age_seconds"] is None
    assert payload["components"] == [{"name": "database", "status": "down"}]


def test_aggregate_health_status_rejects_unknown_component_status() -> None:
    class BadComponent:
        status = "unknown"

    with pytest.raises(ValueError, match="Unsupported health status"):
        aggregate_health_status([BadComponent()])


def test_overall_health_result_empty_components_is_degraded_with_message() -> None:
    checked_at = datetime(2026, 5, 22, 13, 0, tzinfo=UTC)

    result = OverallHealthResult.from_components(
        checked_at_utc=checked_at,
        components=[],
    )

    assert result.status == "degraded"
    assert result.components == [
        ComponentHealthResult(
            name="components",
            status="degraded",
            message="No health components were checked.",
            checked_at_utc=checked_at,
        )
    ]
