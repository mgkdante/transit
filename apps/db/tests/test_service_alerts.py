"""GTFS-RT service alerts → i3-shaped payload → existing silver normalizer."""

from __future__ import annotations

from datetime import UTC, datetime

from google.transit import gtfs_realtime_pb2

from transit_ops.ingestion.service_alerts import (
    _enum_name,
    convert_gtfs_rt_alerts_to_i3_payload,
)
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


def _build_multi_period_protobuf_with_url() -> bytes:
    """A GTFS-RT alert with THREE active windows + a bilingual url (S15)."""
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    entity = message.entity.add()
    entity.id = "multi-1"
    alert = entity.alert
    for start, end in (
        (1_774_000_000, 1_774_100_000),
        (1_774_600_000, 1_774_700_000),
        (1_775_200_000, 1_775_300_000),
    ):
        period = alert.active_period.add()
        period.start = start
        period.end = end
    header = alert.header_text.translation.add()
    header.language = "fr"
    header.text = "Fermeture de fin de semaine"
    url_fr = alert.url.translation.add()
    url_fr.language = "fr"
    url_fr.text = "https://stm.info/avis/multi-1"
    url_en = alert.url.translation.add()
    url_en.language = "en"
    url_en.text = "https://stm.info/en/alert/multi-1"
    return message.SerializeToString()


def test_convert_emits_every_active_period_not_just_the_first() -> None:
    # S15 truncation fix #1: the converter must emit ALL active_period windows,
    # not just active_period[0]. Order is preserved so period_index is stable.
    payload = convert_gtfs_rt_alerts_to_i3_payload(_build_multi_period_protobuf_with_url())
    alert = payload["alerts"][0]
    assert alert["activePeriod"] == [
        {"start": 1_774_000_000, "end": 1_774_100_000},
        {"start": 1_774_600_000, "end": 1_774_700_000},
        {"start": 1_775_200_000, "end": 1_775_300_000},
    ]


def test_convert_extracts_alert_url_translatedstring() -> None:
    # S15: alert.url (a TranslatedString) surfaces as [{language, text}], mirroring
    # header/description, so the silver normalizer can pick fr as url + en as url_en.
    payload = convert_gtfs_rt_alerts_to_i3_payload(_build_multi_period_protobuf_with_url())
    url = payload["alerts"][0]["url"]
    assert {"language": "fr", "text": "https://stm.info/avis/multi-1"} in url
    assert {"language": "en", "text": "https://stm.info/en/alert/multi-1"} in url


def test_multi_period_url_flows_into_silver_rows_and_periods() -> None:
    # S15 truncation fix #2 + url: the converted payload normalizes into ONE alert
    # row (scalar = period[0]), a full period_rows list, and fr/en url columns.
    payload = convert_gtfs_rt_alerts_to_i3_payload(_build_multi_period_protobuf_with_url())
    snapshot = RawI3AlertSnapshot(
        i3_alert_snapshot_id=7,
        provider_id="sto",
        captured_at_utc=datetime(2026, 6, 19, tzinfo=UTC),
        raw_payload_json=payload,
    )
    alert_rows, _entities, period_rows = normalize_i3_alert_payload(snapshot)

    assert len(alert_rows) == 1
    row = alert_rows[0]
    # scalar pair = period[0] (backward-compat)
    assert row["active_period_start_utc"] == datetime.fromtimestamp(1_774_000_000, tz=UTC)
    assert row["url"] == "https://stm.info/avis/multi-1"
    assert row["url_en"] == "https://stm.info/en/alert/multi-1"
    # all THREE windows persisted as child period rows, period_index stable.
    assert [p["period_index"] for p in period_rows] == [0, 1, 2]
    assert all(p["alert_index"] == 0 for p in period_rows)
    assert period_rows[2]["start_utc"] == datetime.fromtimestamp(1_775_200_000, tz=UTC)


def test_enum_name_decodes_known_value_and_degrades_unknown_to_string() -> None:
    # Known enum values decode to their published name...
    assert (
        _enum_name(gtfs_realtime_pb2.Alert.Cause, gtfs_realtime_pb2.Alert.CONSTRUCTION)
        == "CONSTRUCTION"
    )
    # ...while a vendor-extension value outside the published set degrades to the
    # raw int as a string instead of raising and failing the whole capture.
    assert _enum_name(gtfs_realtime_pb2.Alert.Cause, 9999) == "9999"
    assert _enum_name(gtfs_realtime_pb2.Alert.Effect, 8888) == "8888"
    assert _enum_name(gtfs_realtime_pb2.Alert.SeverityLevel, 7777) == "7777"


def test_unknown_enum_value_on_wire_does_not_crash_converter() -> None:
    # Hand-crafted FeedMessage bytes carrying Alert.cause = 9999 (a value outside
    # the published Cause enum). Depending on the active protobuf runtime the
    # value is either dropped to the unknown-field set or retained and degraded;
    # either way the converter must not raise.
    raw = bytes(
        [
            0x0A, 0x05, 0x0A, 0x03, 0x32, 0x2E, 0x30,  # header { version="2.0" }
            0x12, 0x08, 0x0A, 0x01, 0x78,              # entity { id="x" ...
            0x2A, 0x03, 0x30, 0x8F, 0x4E,              # ... alert { cause=9999 } }
        ]
    )

    payload = convert_gtfs_rt_alerts_to_i3_payload(raw)

    assert len(payload["alerts"]) == 1
    cause = payload["alerts"][0].get("cause")
    assert cause is None or cause == "9999"


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

    alert_rows, entity_rows, period_rows = normalize_i3_alert_payload(snapshot)

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
