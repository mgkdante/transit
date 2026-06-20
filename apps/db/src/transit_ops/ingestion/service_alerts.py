"""Convert a GTFS-RT Service Alerts feed into the i3-shaped JSON the silver
alert normalizer already understands.

STM publishes alerts through its proprietary i3 JSON API; STO / OC Transpo / STS
publish the standard GTFS-RT Service Alerts protobuf. Rather than build a second
SCD-2 silver path, we translate the protobuf Alert entities into the same payload
shape ``transit_ops.silver.i3.normalize_i3_alert_payload`` consumes (it already
handles ``[{language, text}]`` TranslatedStrings, ``informedEntities`` with
route/stop/trip ids, and ``activePeriod`` epoch ranges). The converted payload is
stored in ``raw.i3_alert_snapshots`` and flows through the existing silver merge
and ``gold.current_i3_alerts`` view unchanged.

This module is intentionally dependency-light (only the protobuf bindings) so the
conversion is a pure, unit-testable function.
"""

from __future__ import annotations

from google.transit import gtfs_realtime_pb2


def _has_field(message: object, field_name: str) -> bool:
    try:
        return message.HasField(field_name)
    except ValueError:
        return False


def _enum_name(enum_type, value: int) -> str:  # noqa: ANN001
    """Decode a protobuf enum int to its name, tolerating vendor extensions.

    GTFS-RT lets providers carry enum values outside the published Cause / Effect
    / SeverityLevel sets; ``EnumType.Name(unknown_int)`` raises ``ValueError`` on
    those. Fall back to the raw int as a string so an extension value degrades
    gracefully instead of failing the whole alerts capture. Mirrors
    ``transit_ops.silver.realtime_gtfs._enum_name``."""
    try:
        return enum_type.Name(value)
    except ValueError:
        return str(value)


def _translations(translated_string: object) -> list[dict[str, str]]:
    """TranslatedString -> [{"language": .., "text": ..}] (language optional)."""
    out: list[dict[str, str]] = []
    for translation in translated_string.translation:
        text = translation.text
        if not text:
            continue
        item: dict[str, str] = {"text": text}
        if translation.language:
            item["language"] = translation.language
        out.append(item)
    return out


def _informed_entity(selector: object) -> dict[str, object]:
    out: dict[str, object] = {}
    if selector.agency_id:
        out["agencyId"] = selector.agency_id
    if selector.route_id:
        out["routeId"] = selector.route_id
    if selector.stop_id:
        out["stopId"] = selector.stop_id
    if _has_field(selector, "trip") and selector.trip.trip_id:
        out["tripId"] = selector.trip.trip_id
    if _has_field(selector, "route_type"):
        out["routeType"] = selector.route_type
    return out


def _active_period(alert: object) -> list[dict[str, int]] | None:
    if len(alert.active_period) == 0:
        return None
    time_range = alert.active_period[0]
    period: dict[str, int] = {}
    if _has_field(time_range, "start"):
        period["start"] = int(time_range.start)
    if _has_field(time_range, "end"):
        period["end"] = int(time_range.end)
    return [period] if period else None


def convert_gtfs_rt_alerts_to_i3_payload(protobuf_bytes: bytes) -> dict[str, object]:
    """Parse a GTFS-RT Service Alerts FeedMessage into the i3-shaped JSON payload.

    Language note: header/description carry the feed's language tags verbatim. The
    silver normalizer prefers ``fr``/``fra``; a feed tagged ``fr-CA`` still loads
    (it falls through to the first non-empty translation) — fine for v1.
    """
    message = gtfs_realtime_pb2.FeedMessage()
    message.ParseFromString(protobuf_bytes)

    alerts: list[dict[str, object]] = []
    for entity in message.entity:
        if not _has_field(entity, "alert"):
            continue
        alert = entity.alert
        record: dict[str, object] = {"id": entity.id or None}
        if _has_field(alert, "header_text"):
            record["header"] = _translations(alert.header_text)
        if _has_field(alert, "description_text"):
            record["description"] = _translations(alert.description_text)
        if _has_field(alert, "cause"):
            record["cause"] = _enum_name(gtfs_realtime_pb2.Alert.Cause, alert.cause)
        if _has_field(alert, "effect"):
            record["effect"] = _enum_name(gtfs_realtime_pb2.Alert.Effect, alert.effect)
        if _has_field(alert, "severity_level"):
            record["severity"] = _enum_name(
                gtfs_realtime_pb2.Alert.SeverityLevel, alert.severity_level
            )
        active_period = _active_period(alert)
        if active_period is not None:
            record["activePeriod"] = active_period
        record["informedEntities"] = [
            selector
            for raw_selector in alert.informed_entity
            if (selector := _informed_entity(raw_selector))
        ]
        alerts.append(record)

    return {
        "gtfsRealtimeVersion": message.header.gtfs_realtime_version or None,
        "timestamp": (
            int(message.header.timestamp)
            if _has_field(message.header, "timestamp")
            else None
        ),
        "alerts": alerts,
    }
