"""GTFS-Realtime alert occurrences, without storage or caller activation."""

from typing import Any, cast

from google.transit import gtfs_realtime_pb2

from transit_ops.ingestion.service_alerts import (
    _active_period,
    _enum_name,
    _has_field,
    _informed_entity,
    _translations,
)
from transit_ops.providers.alert_record import AlertIdentityInputs, AlertRecord, InformedEntity
from transit_ops.providers.formats import decode_gtfs_rt
from transit_ops.silver.i3 import _text, _timestamp, _translated_texts


def gtfs_rt_alerts(payload: bytes) -> tuple[AlertRecord, ...]:
    records: list[AlertRecord] = []
    for entity in decode_gtfs_rt(payload).entity:
        if _has_field(entity, "alert"):
            records.append(_record(entity, len(records)))
    return tuple(records)


def _raw(entity: Any) -> dict[str, object]:
    alert = entity.alert
    raw: dict[str, object] = {"id": entity.id or None}
    for field, key in (("header_text", "header"), ("description_text", "description")):
        if _has_field(alert, field):
            raw[key] = _translations(getattr(alert, field))
    for field, key, enum in (
        ("cause", "cause", gtfs_realtime_pb2.Alert.Cause),
        ("effect", "effect", gtfs_realtime_pb2.Alert.Effect),
        ("severity_level", "severity", gtfs_realtime_pb2.Alert.SeverityLevel),
    ):
        if _has_field(alert, field):
            raw[key] = _enum_name(enum, getattr(alert, field))
    if _has_field(alert, "url") and (url := _translations(alert.url)):
        raw["url"] = url
    if (periods := _active_period(alert)) is not None:
        raw["activePeriod"] = periods
    raw["informedEntities"] = [
        item for selector in alert.informed_entity if (item := _informed_entity(selector))
    ]
    return raw


def _record(entity: Any, index: int) -> AlertRecord:
    raw = _raw(entity)
    periods = tuple(
        (_timestamp(p.get("start")), _timestamp(p.get("end")))
        for p in cast(list[dict[str, int]], raw.get("activePeriod", []))
    )
    selectors = tuple(
        InformedEntity(
            cast(str | None, s.get("agencyId")),
            cast(str | None, s.get("routeId")),
            cast(int | None, s.get("routeType")),
            cast(str | None, s.get("stopId")),
            None,
            cast(str | None, s.get("tripId")),
            s,
        )
        for s in cast(list[dict[str, object]], raw["informedEntities"])
    )
    cause, effect, severity = (_text(raw.get(key)) for key in ("cause", "effect", "severity"))
    identity = AlertIdentityInputs(
        _text(raw["id"]),
        _text(raw.get("header")),
        _text(raw.get("description")),
        severity,
        cause,
        effect,
        *(periods[0] if periods else (None, None)),
        None,
        None,
        periods[1:],
    )
    return AlertRecord(
        index,
        cast(str | None, raw["id"]),
        _translated_texts(raw.get("header")),
        _translated_texts(raw.get("description")),
        _translated_texts(raw.get("url")),
        cause,
        effect,
        severity,
        cause,
        effect,
        periods,
        selectors,
        None,
        None,
        identity,
        raw,
    )
