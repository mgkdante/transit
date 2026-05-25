from __future__ import annotations

from datetime import UTC, datetime

from transit_ops.silver.i3 import (
    RawI3AlertSnapshot,
    load_i3_snapshot_to_silver,
    normalize_i3_alert_payload,
)


class FakeResult:
    def __init__(self, scalar_value=None, mapping_value=None) -> None:  # noqa: ANN001
        self.scalar_value = scalar_value
        self.mapping_value = mapping_value

    def scalar_one_or_none(self):  # noqa: ANN201
        return self.scalar_value

    def mappings(self):  # noqa: ANN201
        return self

    def one_or_none(self):  # noqa: ANN201
        return self.mapping_value


class RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        self.calls.append((str(statement), params))
        return FakeResult()


def _snapshot(payload: object) -> RawI3AlertSnapshot:
    return RawI3AlertSnapshot(
        i3_alert_snapshot_id=505,
        provider_id="stm",
        captured_at_utc=datetime(2026, 5, 25, 4, 5, 6, tzinfo=UTC),
        raw_payload_json=payload,
    )


def test_normalize_i3_alert_payload_accepts_common_alert_shapes() -> None:
    snapshot = _snapshot(
        {
            "alerts": [
                {
                    "id": "alert-1",
                    "header": {"text": "Service interruption"},
                    "description": {"text": "Blue line issue"},
                    "severity": "warning",
                    "cause": "technical_problem",
                    "effect": "delay",
                    "activePeriod": {
                        "start": "2026-05-25T04:00:00Z",
                        "end": "2026-05-25T05:00:00Z",
                    },
                    "informedEntities": [
                        {"routeId": "2", "stopId": "43"},
                        {"areaId": "metro"},
                    ],
                }
            ]
        }
    )

    alerts, entities = normalize_i3_alert_payload(snapshot)

    assert alerts[0]["alert_id"] == "alert-1"
    assert alerts[0]["alert_header_text"] == "Service interruption"
    assert alerts[0]["description_text"] == "Blue line issue"
    assert alerts[0]["active_period_start_utc"] == datetime(2026, 5, 25, 4, tzinfo=UTC)
    assert entities[0]["route_id"] == "2"
    assert entities[0]["stop_id"] == "43"
    assert entities[1]["area_id"] == "metro"


def test_load_i3_snapshot_to_silver_inserts_alerts_and_entities() -> None:
    connection = RecordingConnection()
    snapshot = _snapshot(
        {
            "messages": [
                {
                    "messageId": "m1",
                    "title": "Route 10 delayed",
                    "routes": ["10"],
                    "stops": ["10001", "10002"],
                }
            ]
        }
    )

    result = load_i3_snapshot_to_silver(connection, snapshot=snapshot)

    assert result.i3_alert_snapshot_id == 505
    assert result.alert_rows_inserted == 1
    assert result.informed_entity_rows_inserted == 2
    assert "DELETE FROM silver.i3_alert_informed_entities" in connection.calls[0][0]
    assert "DELETE FROM silver.i3_alerts" in connection.calls[1][0]
    assert "INSERT INTO silver.i3_alerts" in connection.calls[2][0]
    assert "INSERT INTO silver.i3_alert_informed_entities" in connection.calls[3][0]
