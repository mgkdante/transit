from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.settings import Settings, get_settings

# ASCII Unit Separator — non-printable so it won't collide with real text in
# alert headers/descriptions. MUST match the SQL backfill in migration 0021.
_HASH_FIELD_SEP = "\x1F"


def compute_alert_content_hash(
    *,
    alert_id: str | None,
    alert_header_text: str | None,
    description_text: str | None,
    severity: str | None,
    cause: str | None,
    effect: str | None,
    active_period_start_utc: datetime | None,
    active_period_end_utc: datetime | None,
    published_at_utc: datetime | None,
    updated_at_utc: datetime | None,
) -> str:
    """SCD2 content hash for silver.i3_alerts.

    Must match the md5() expression in migration 0021 exactly:
      - Same 10 fields in the same order
      - NULL → empty string
      - Timestamps → integer epoch seconds (sub-second precision dropped on
        purpose — content identity, not snapshot identity)
      - Joined by ASCII Unit Separator (U+001F)
      - md5 over UTF-8 bytes
    """

    def _ts(value: datetime | None) -> str:
        if value is None:
            return ""
        return str(int(value.timestamp()))

    parts = [
        alert_id or "",
        alert_header_text or "",
        description_text or "",
        severity or "",
        cause or "",
        effect or "",
        _ts(active_period_start_utc),
        _ts(active_period_end_utc),
        _ts(published_at_utc),
        _ts(updated_at_utc),
    ]
    canonical = _HASH_FIELD_SEP.join(parts)
    return hashlib.md5(canonical.encode("utf-8")).hexdigest()

DELETE_I3_ENTITIES = text(
    """
    DELETE FROM silver.i3_alert_informed_entities
    WHERE i3_alert_snapshot_id = :i3_alert_snapshot_id
    """
)

DELETE_I3_ALERTS = text(
    """
    DELETE FROM silver.i3_alerts
    WHERE i3_alert_snapshot_id = :i3_alert_snapshot_id
    """
)

INSERT_I3_ALERTS = text(
    """
    INSERT INTO silver.i3_alerts (
        i3_alert_snapshot_id,
        alert_index,
        provider_id,
        alert_id,
        alert_header_text,
        description_text,
        severity,
        cause,
        effect,
        active_period_start_utc,
        active_period_end_utc,
        published_at_utc,
        updated_at_utc,
        captured_at_utc,
        raw_alert_json,
        content_hash,
        first_seen_at,
        last_seen_at
    )
    VALUES (
        :i3_alert_snapshot_id,
        :alert_index,
        :provider_id,
        :alert_id,
        :alert_header_text,
        :description_text,
        :severity,
        :cause,
        :effect,
        :active_period_start_utc,
        :active_period_end_utc,
        :published_at_utc,
        :updated_at_utc,
        :captured_at_utc,
        :raw_alert_json,
        :content_hash,
        :captured_at_utc,
        :captured_at_utc
    )
    ON CONFLICT (provider_id, content_hash) WHERE content_hash IS NOT NULL AND valid_to IS NULL
    DO UPDATE SET last_seen_at = excluded.last_seen_at
    """
).bindparams(bindparam("raw_alert_json", type_=postgresql.JSONB))

INSERT_I3_ENTITIES = text(
    """
    INSERT INTO silver.i3_alert_informed_entities (
        i3_alert_snapshot_id,
        alert_index,
        entity_index,
        provider_id,
        route_id,
        stop_id,
        trip_id,
        area_id,
        raw_entity_json
    )
    VALUES (
        :i3_alert_snapshot_id,
        :alert_index,
        :entity_index,
        :provider_id,
        :route_id,
        :stop_id,
        :trip_id,
        :area_id,
        :raw_entity_json
    )
    """
).bindparams(bindparam("raw_entity_json", type_=postgresql.JSONB))


@dataclass(frozen=True)
class RawI3AlertSnapshot:
    i3_alert_snapshot_id: int
    provider_id: str
    captured_at_utc: datetime
    raw_payload_json: object


@dataclass(frozen=True)
class I3SilverLoadResult:
    provider_id: str
    i3_alert_snapshot_id: int
    alert_rows_inserted: int
    informed_entity_rows_inserted: int
    loaded_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["loaded_at_utc"] = self.loaded_at_utc.isoformat()
        return payload


def _payload_alerts(payload: object) -> list[object]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("alerts", "messages", "data", "items", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _value(payload: dict[str, Any], *keys: str) -> object:
    for key in keys:
        if key in payload:
            return payload[key]
    return None


def _text(payload: object) -> str | None:
    if payload is None:
        return None
    if isinstance(payload, str):
        stripped = payload.strip()
        return stripped or None
    if isinstance(payload, list):
        preferred = [
            item
            for item in payload
            if isinstance(item, dict)
            and str(item.get("language", "")).lower() in {"fr", "fra"}
        ]
        for item in [*preferred, *payload]:
            value = _text(item)
            if value:
                return value
        return None
    if isinstance(payload, dict):
        for key in ("text", "value", "fr", "en"):
            value = _text(payload.get(key))
            if value:
                return value
    return str(payload)


def _timestamp(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, int | float):
        return datetime.fromtimestamp(value, tz=UTC)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        if normalized.isdigit():
            return datetime.fromtimestamp(int(normalized), tz=UTC)
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        return datetime.fromisoformat(normalized).astimezone(UTC)
    return None


def _active_period(alert: dict[str, Any]) -> tuple[datetime | None, datetime | None]:
    period = _value(alert, "activePeriod", "active_period", "activePeriods", "active_periods")
    if isinstance(period, list):
        period = period[0] if period else {}
    if not isinstance(period, dict):
        return None, None
    return (
        _timestamp(_value(period, "start", "startTime", "start_time")),
        _timestamp(_value(period, "end", "endTime", "end_time")),
    )


def _entity_value(entity: dict[str, Any], *keys: str) -> str | None:
    value = _value(entity, *keys)
    return _text(value)


def _informed_entities(alert: dict[str, Any]) -> list[dict[str, object]]:
    explicit = _value(alert, "informedEntities", "informed_entities", "entities")
    if isinstance(explicit, list):
        return [entity for entity in explicit if isinstance(entity, dict)]

    routes = _value(alert, "routes", "routeIds", "route_ids")
    stops = _value(alert, "stops", "stopIds", "stop_ids")
    route_ids = [str(route) for route in routes] if isinstance(routes, list) else []
    stop_ids = [str(stop) for stop in stops] if isinstance(stops, list) else []
    if route_ids and stop_ids:
        return [{"routeId": route_ids[0], "stopId": stop_id} for stop_id in stop_ids]
    if route_ids:
        return [{"routeId": route_id} for route_id in route_ids]
    if stop_ids:
        return [{"stopId": stop_id} for stop_id in stop_ids]
    return []


def normalize_i3_alert_payload(
    snapshot: RawI3AlertSnapshot,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    alert_rows: list[dict[str, object]] = []
    entity_rows: list[dict[str, object]] = []

    for alert_index, raw_alert in enumerate(_payload_alerts(snapshot.raw_payload_json)):
        if not isinstance(raw_alert, dict):
            continue
        active_start, active_end = _active_period(raw_alert)
        alert_id = _text(_value(raw_alert, "id", "alertId", "messageId"))
        alert_header_text = _text(
            _value(raw_alert, "header", "title", "summary", "header_texts")
        )
        description_text = _text(
            _value(raw_alert, "description", "body", "message", "description_texts")
        )
        severity = _text(_value(raw_alert, "severity", "priority"))
        cause = _text(_value(raw_alert, "cause"))
        effect = _text(_value(raw_alert, "effect"))
        published_at_utc = _timestamp(_value(raw_alert, "publishedAt", "published_at"))
        updated_at_utc = _timestamp(_value(raw_alert, "updatedAt", "updated_at"))
        content_hash = compute_alert_content_hash(
            alert_id=alert_id,
            alert_header_text=alert_header_text,
            description_text=description_text,
            severity=severity,
            cause=cause,
            effect=effect,
            active_period_start_utc=active_start,
            active_period_end_utc=active_end,
            published_at_utc=published_at_utc,
            updated_at_utc=updated_at_utc,
        )
        alert_rows.append(
            {
                "i3_alert_snapshot_id": snapshot.i3_alert_snapshot_id,
                "alert_index": alert_index,
                "provider_id": snapshot.provider_id,
                "alert_id": alert_id,
                "alert_header_text": alert_header_text,
                "description_text": description_text,
                "severity": severity,
                "cause": cause,
                "effect": effect,
                "active_period_start_utc": active_start,
                "active_period_end_utc": active_end,
                "published_at_utc": published_at_utc,
                "updated_at_utc": updated_at_utc,
                "captured_at_utc": snapshot.captured_at_utc,
                "raw_alert_json": raw_alert,
                "content_hash": content_hash,
            }
        )
        for entity_index, raw_entity in enumerate(_informed_entities(raw_alert)):
            entity_rows.append(
                {
                    "i3_alert_snapshot_id": snapshot.i3_alert_snapshot_id,
                    "alert_index": alert_index,
                    "entity_index": entity_index,
                    "provider_id": snapshot.provider_id,
                    "route_id": _entity_value(
                        raw_entity,
                        "routeId",
                        "route_id",
                        "route",
                        "route_short_name",
                    ),
                    "stop_id": _entity_value(
                        raw_entity,
                        "stopId",
                        "stop_id",
                        "stop",
                        "stop_code",
                    ),
                    "trip_id": _entity_value(raw_entity, "tripId", "trip_id", "trip"),
                    "area_id": _entity_value(raw_entity, "areaId", "area_id", "area"),
                    "raw_entity_json": raw_entity,
                }
            )

    # The i3 feed can emit multiple alerts with identical content (e.g. one
    # "Service normal du métro" per metro line), which collapse to the same
    # content_hash. The SCD-2 unique index is on (provider_id, content_hash),
    # so a single batch INSERT ... ON CONFLICT cannot carry two rows with the
    # same hash (Postgres: "ON CONFLICT DO UPDATE command cannot affect row a
    # second time"). Dedup by content_hash, keeping the first occurrence, and
    # drop the now-orphaned informed entities so the FK stays consistent.
    if alert_rows:
        seen: set[tuple[object, object]] = set()
        kept_indexes: set[object] = set()
        deduped: list[dict[str, object]] = []
        for row in alert_rows:
            key = (row["provider_id"], row["content_hash"])
            if row["content_hash"] is not None and key in seen:
                continue
            seen.add(key)
            kept_indexes.add(row["alert_index"])
            deduped.append(row)
        if len(deduped) != len(alert_rows):
            alert_rows = deduped
            entity_rows = [e for e in entity_rows if e["alert_index"] in kept_indexes]

    return alert_rows, entity_rows


def _execute_insert(connection: Connection, statement, rows: list[dict[str, object]]) -> int:
    if not rows:
        return 0
    connection.execute(statement, rows)
    return len(rows)


def load_i3_snapshot_to_silver(
    connection: Connection,
    *,
    snapshot: RawI3AlertSnapshot,
    loaded_at_utc: datetime | None = None,
) -> I3SilverLoadResult:
    alert_rows, entity_rows = normalize_i3_alert_payload(snapshot)
    connection.execute(
        DELETE_I3_ENTITIES,
        {"i3_alert_snapshot_id": snapshot.i3_alert_snapshot_id},
    )
    connection.execute(
        DELETE_I3_ALERTS,
        {"i3_alert_snapshot_id": snapshot.i3_alert_snapshot_id},
    )
    alert_count = _execute_insert(connection, INSERT_I3_ALERTS, alert_rows)
    entity_count = _execute_insert(connection, INSERT_I3_ENTITIES, entity_rows)
    return I3SilverLoadResult(
        provider_id=snapshot.provider_id,
        i3_alert_snapshot_id=snapshot.i3_alert_snapshot_id,
        alert_rows_inserted=alert_count,
        informed_entity_rows_inserted=entity_count,
        loaded_at_utc=loaded_at_utc or datetime.now(UTC),
    )


def find_latest_i3_raw_snapshot(
    connection: Connection,
    *,
    provider_id: str,
) -> RawI3AlertSnapshot:
    row = connection.execute(
        text(
            """
            SELECT
                i3.i3_alert_snapshot_id,
                i3.provider_id,
                i3.captured_at_utc,
                i3.raw_payload_json
            FROM raw.i3_alert_snapshots AS i3
            INNER JOIN raw.ingestion_runs AS ir
                ON ir.ingestion_run_id = i3.ingestion_run_id
            WHERE i3.provider_id = :provider_id
              AND ir.status = 'succeeded'
            ORDER BY i3.captured_at_utc DESC, i3.i3_alert_snapshot_id DESC
            LIMIT 1
            """
        ),
        {"provider_id": provider_id},
    ).mappings().one_or_none()
    if row is None:
        raise ValueError(
            "No successful raw i3 alert snapshot was found for this provider. "
            "Run capture-i3 before load-i3-silver."
        )
    return RawI3AlertSnapshot(
        i3_alert_snapshot_id=int(row["i3_alert_snapshot_id"]),
        provider_id=str(row["provider_id"]),
        captured_at_utc=row["captured_at_utc"],
        raw_payload_json=row["raw_payload_json"],
    )


def load_latest_i3_to_silver(
    provider_id: str,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> I3SilverLoadResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    with engine.begin() as connection:
        snapshot = find_latest_i3_raw_snapshot(connection, provider_id=provider_id)
        return load_i3_snapshot_to_silver(connection, snapshot=snapshot)
