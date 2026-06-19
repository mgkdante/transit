"""GTFS-RT service alerts → i3-shaped payload → existing silver normalizer."""

from __future__ import annotations

from datetime import UTC, datetime

from google.transit import gtfs_realtime_pb2

from transit_ops.ingestion.service_alerts import convert_gtfs_rt_alerts_to_i3_payload
from transit_ops.silver.i3 import RawI3AlertSnapshot, normalize_i3_alert_payload


def _build_alerts_protobuf() -> bytes:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.timestamp = 1_774_837_200
    entity = message.entity.add()
    entity.id = "alert-1"
    alert = entity.alert
    period = alert.active_period.add()
    period.start = 1_774_837_200
    period.end = 1_774_900_000
    alert.cause = gtfs_realtime_pb2.Alert.CONSTRUCTION
    alert.effect = gtfs_realtime_pb2.Alert.DETOUR
    alert.severity_level = gtfs_realtime_pb2.Alert.WARNING
    header_fr = alert.header_text.translation.add()
    header_fr.language = "fr"
    header_fr.text = "Détour ligne 33"
    header_en = alert.header_text.translation.add()
    header_en.language = "en"
    header_en.text = "Route 33 detour"
    description_fr = alert.description_text.translation.add()
    description_fr.language = "fr"
    description_fr.text = "Travaux majeurs"
    selector = alert.informed_entity.add()
    selector.route_id = "33"
    selector.stop_id = "S1"
    return message.SerializeToString()


def test_convert_gtfs_rt_alerts_to_i3_payload() -> None:
    payload = convert_gtfs_rt_alerts_to_i3_payload(_build_alerts_protobuf())

    assert payload["gtfsRealtimeVersion"] == "2.0"
    assert payload["timestamp"] == 1_774_837_200
    alert = payload["alerts"][0]
    assert alert["id"] == "alert-1"
    assert alert["cause"] == "CONSTRUCTION"
    assert alert["effect"] == "DETOUR"
    assert alert["severity"] == "WARNING"
    assert {"language": "fr", "text": "Détour ligne 33"} in alert["header"]
    assert {"language": "en", "text": "Route 33 detour"} in alert["header"]
    assert alert["activePeriod"][0] == {"start": 1_774_837_200, "end": 1_774_900_000}
    assert alert["informedEntities"][0] == {"routeId": "33", "stopId": "S1"}


def test_no_alert_entities_yields_empty_alerts() -> None:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    payload = convert_gtfs_rt_alerts_to_i3_payload(message.SerializeToString())
    assert payload["alerts"] == []


def test_converted_payload_normalizes_into_silver_alert_rows() -> None:
    payload = convert_gtfs_rt_alerts_to_i3_payload(_build_alerts_protobuf())
    snapshot = RawI3AlertSnapshot(
        i3_alert_snapshot_id=1,
        provider_id="sto",
        captured_at_utc=datetime(2026, 6, 19, tzinfo=UTC),
        raw_payload_json=payload,
    )

    alert_rows, entity_rows = normalize_i3_alert_payload(snapshot)

    assert len(alert_rows) == 1
    row = alert_rows[0]
    assert row["alert_id"] == "alert-1"
    assert row["alert_header_text"] == "Détour ligne 33"  # fr preferred for identity
    assert row["alert_header_text_en"] == "Route 33 detour"
    assert row["cause"] == "CONSTRUCTION"
    assert row["effect"] == "DETOUR"
    assert row["content_hash"]
    assert len(entity_rows) == 1
    assert entity_rows[0]["route_id"] == "33"
    assert entity_rows[0]["stop_id"] == "S1"
