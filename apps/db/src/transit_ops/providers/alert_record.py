"""Alert occurrences and their dormant, in-memory Silver row projection."""

from dataclasses import asdict, dataclass
from datetime import datetime

from transit_ops.silver.i3 import _text, compute_alert_content_hash

type Period = tuple[datetime | None, datetime | None]


@dataclass(frozen=True)
class AlertIdentityInputs:
    alert_id: str | None
    alert_header_text: str | None
    description_text: str | None
    severity: str | None
    cause: str | None
    effect: str | None
    active_period_start_utc: datetime | None
    active_period_end_utc: datetime | None
    published_at_utc: datetime | None
    updated_at_utc: datetime | None
    extra_active_periods: tuple[Period, ...]

    def content_hash(self) -> str:
        inputs = asdict(self)
        inputs["extra_active_periods"] = list(self.extra_active_periods)
        return compute_alert_content_hash(**inputs)


@dataclass(frozen=True)
class InformedEntity:
    agency_id: str | None
    route_id: str | None
    route_type: int | None
    stop_id: str | None
    area_id: str | None
    trip_id: str | None
    raw: dict[str, object]


@dataclass(frozen=True)
class AlertRecord:
    occurrence_index: int
    id: str | None
    header: dict[str, str]
    description: dict[str, str]
    url: dict[str, str]
    cause: str | None
    effect: str | None
    severity_level: str | None
    cause_standard: str | None
    effect_standard: str | None
    active_periods: tuple[Period, ...]
    informed_entities: tuple[InformedEntity, ...]
    published_at: datetime | None
    updated_at: datetime | None
    identity: AlertIdentityInputs
    raw: dict[str, object]


def alert_rows(
    records: tuple[AlertRecord, ...],
    *,
    provider_id: str,
    i3_alert_snapshot_id: int,
    captured_at_utc: datetime,
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    parents: list[dict[str, object]] = []
    entities: list[dict[str, object]] = []
    periods: list[dict[str, object]] = []
    seen: set[str] = set()
    for record in records:
        content_hash = record.identity.content_hash()
        if content_hash in seen:
            continue
        seen.add(content_hash)
        key: dict[str, object] = {
            "i3_alert_snapshot_id": i3_alert_snapshot_id,
            "alert_index": record.occurrence_index,
        }
        parents.append(
            {
                **key,
                **_parent(record),
                "provider_id": provider_id,
                "captured_at_utc": captured_at_utc,
            }
        )
        for index, (start, end) in enumerate(record.active_periods):
            periods.append({**key, "period_index": index, "start_utc": start, "end_utc": end})
        for index, entity in enumerate(record.informed_entities):
            entities.append(
                {
                    **key,
                    "entity_index": index,
                    "provider_id": provider_id,
                    "route_id": _text(entity.route_id),
                    "stop_id": _text(entity.stop_id),
                    "trip_id": _text(entity.trip_id),
                    "area_id": _text(entity.area_id),
                    "raw_entity_json": entity.raw,
                }
            )
    return parents, entities, periods


def _parent(record: AlertRecord) -> dict[str, object]:
    start, end = record.active_periods[0] if record.active_periods else (None, None)
    return {
        "alert_id": _text(record.id),
        "alert_header_text": record.header.get("fr") or next(iter(record.header.values()), None),
        "description_text": record.description.get("fr")
        or next(iter(record.description.values()), None),
        "alert_header_text_en": record.header.get("en"),
        "description_text_en": record.description.get("en"),
        "severity": _text(record.severity_level),
        "cause": _text(record.cause),
        "effect": _text(record.effect),
        "url": record.url.get("fr") or next(iter(record.url.values()), None),
        "url_en": record.url.get("en"),
        "active_period_start_utc": start,
        "active_period_end_utc": end,
        "published_at_utc": record.published_at,
        "updated_at_utc": record.updated_at,
        "raw_alert_json": record.raw,
        "content_hash": record.identity.content_hash(),
    }
