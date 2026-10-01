from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import bindparam, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.settings import Settings, get_settings

# Identity separator must match migration 0021.
_HASH_FIELD_SEP = "\x1f"


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
    extra_active_periods: list[tuple[datetime | None, datetime | None]] | None = None,
) -> str:

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
    # Append extra-window identity only for multi-period alerts to preserve single-period hashes.
    if extra_active_periods:
        parts.append(",".join(f"{_ts(start)}:{_ts(end)}" for start, end in extra_active_periods))
    canonical = _HASH_FIELD_SEP.join(parts)
    return hashlib.md5(canonical.encode("utf-8")).hexdigest()


DELETE_I3_ENTITIES = text(
    """
    DELETE FROM silver.i3_alert_informed_entities
    WHERE i3_alert_snapshot_id = :i3_alert_snapshot_id
    """
)

DELETE_I3_ACTIVE_PERIODS = text(
    """
    DELETE FROM silver.i3_alert_active_periods
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
        alert_header_text_en,
        description_text_en,
        severity,
        cause,
        effect,
        url,
        url_en,
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
        :alert_header_text_en,
        :description_text_en,
        :severity,
        :cause,
        :effect,
        :url,
        :url_en,
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
    DO UPDATE SET last_seen_at = excluded.last_seen_at,
        alert_header_text_en = COALESCE(
            excluded.alert_header_text_en, silver.i3_alerts.alert_header_text_en),
        description_text_en = COALESCE(
            excluded.description_text_en, silver.i3_alerts.description_text_en),
        url = COALESCE(excluded.url, silver.i3_alerts.url),
        url_en = COALESCE(excluded.url_en, silver.i3_alerts.url_en)
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
    ON CONFLICT (i3_alert_snapshot_id, alert_index, entity_index) DO NOTHING
    """
).bindparams(bindparam("raw_entity_json", type_=postgresql.JSONB))

INSERT_I3_ACTIVE_PERIODS = text(
    """
    INSERT INTO silver.i3_alert_active_periods (
        i3_alert_snapshot_id,
        alert_index,
        period_index,
        start_utc,
        end_utc
    )
    VALUES (
        :i3_alert_snapshot_id,
        :alert_index,
        :period_index,
        :start_utc,
        :end_utc
    )
    ON CONFLICT (i3_alert_snapshot_id, alert_index, period_index) DO NOTHING
    """
)

# Key entities to the surviving alert after an ON CONFLICT redirect.
SELECT_ACTIVE_ALERT_KEYS = text(
    """
    SELECT content_hash, i3_alert_snapshot_id, alert_index
    FROM silver.i3_alerts
    WHERE provider_id = :provider_id
      AND valid_to IS NULL
      AND content_hash IN :content_hashes
    """
).bindparams(bindparam("content_hashes", expanding=True))

# Exclude legacy NULL hashes and skip close-out for empty batches.
SUPERSEDE_VANISHED_ALERTS = text(
    """
    UPDATE silver.i3_alerts
    SET valid_to = :captured_at_utc
    WHERE provider_id = :provider_id
      AND valid_to IS NULL
      AND content_hash IS NOT NULL
      AND content_hash NOT IN :content_hashes
    """
).bindparams(bindparam("content_hashes", expanding=True))

UPSERT_ALERT_LANGUAGE_OBSERVATIONS = text(
    """
    INSERT INTO raw.alert_language_observations (
        provider_id,
        alert_logical_id,
        observation_date,
        has_explicit_fr,
        has_explicit_en,
        undetermined,
        observed_at_utc
    )
    VALUES (
        :provider_id,
        :alert_logical_id,
        :observation_date,
        :has_explicit_fr,
        :has_explicit_en,
        :undetermined,
        :observed_at_utc
    )
    ON CONFLICT (provider_id, alert_logical_id, observation_date)
    DO UPDATE SET
        has_explicit_fr = excluded.has_explicit_fr,
        has_explicit_en = excluded.has_explicit_en,
        undetermined = excluded.undetermined,
        observed_at_utc = excluded.observed_at_utc
    WHERE excluded.observed_at_utc
          >= alert_language_observations.observed_at_utc
    """
)

UPSERT_ALERT_FEED_OBSERVATION = text(
    """
    INSERT INTO raw.alert_feed_observations (
        provider_id,
        observation_date,
        alert_count,
        observed_at_utc
    )
    VALUES (
        :provider_id,
        :observation_date,
        :alert_count,
        :observed_at_utc
    )
    ON CONFLICT (provider_id, observation_date)
    DO UPDATE SET
        alert_count = excluded.alert_count,
        observed_at_utc = excluded.observed_at_utc
    WHERE excluded.observed_at_utc
          >= alert_feed_observations.observed_at_utc
    """
)

ACQUIRE_I3_LOAD_LOCK = text(
    "SELECT pg_advisory_xact_lock(hashtext('transit.silver.i3'), hashtext(:provider_id))"
)

SELECT_NEWER_FEED_OBSERVATION = text(
    """
    SELECT observed_at_utc
    FROM raw.alert_feed_observations
    WHERE provider_id = :provider_id AND observed_at_utc > :captured_at_utc
    LIMIT 1
    """
)


@dataclass(frozen=True)
class RawI3AlertSnapshot:
    i3_alert_snapshot_id: int
    provider_id: str
    provider_timezone: str
    captured_at_utc: datetime
    raw_payload_json: object


@dataclass(frozen=True)
class AlertLanguageObservation:
    provider_id: str
    alert_logical_id: str
    observation_date: date
    has_explicit_fr: bool
    has_explicit_en: bool
    undetermined: bool
    observed_at_utc: datetime


@dataclass(frozen=True)
class I3SilverLoadResult:
    provider_id: str
    i3_alert_snapshot_id: int
    alert_rows_inserted: int
    informed_entity_rows_inserted: int
    loaded_at_utc: datetime
    alerts_redirected_to_existing: int = 0
    alerts_superseded: int = 0
    entities_dropped_missing_parent: int = 0
    skipped_older_capture: bool = False

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


def _primary_language(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().lower().replace("_", "-").split("-", 1)[0]


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
            if isinstance(item, dict) and _primary_language(item.get("language")) in {"fr", "fra"}
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
    if isinstance(payload, int | float):
        return str(payload)
    return None


def _text_en(payload: object) -> str | None:
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict) and _primary_language(item.get("language")) in {"en", "eng"}:
                value = _text(item.get("text") or item.get("value"))
                if value:
                    return value
        return None
    if isinstance(payload, dict):
        english = payload.get("en")
        if isinstance(english, dict):
            return _text(english.get("text") or english.get("value"))
        return _text(english)
    return None


def _has_explicit_language(payload: object, accepted: set[str]) -> bool:

    if isinstance(payload, list):
        return any(
            isinstance(item, dict)
            and _primary_language(item.get("language")) in accepted
            and _text(item.get("text") or item.get("value")) is not None
            for item in payload
        )
    if not isinstance(payload, dict):
        return False
    if (
        _primary_language(payload.get("language")) in accepted
        and _text(payload.get("text") or payload.get("value")) is not None
    ):
        return True
    return any(
        _primary_language(key) in accepted and _text(value) is not None
        for key, value in payload.items()
        if isinstance(key, str)
    )


_ALERT_HEADER_KEYS = ("header", "title", "summary", "header_texts")
_ALERT_DESCRIPTION_KEYS = (
    "description",
    "body",
    "message",
    "description_texts",
)
_SCD_ENRICHMENT_KEYS = frozenset(
    {
        "alert_header_text_en",
        "description_text_en",
        "header_text_en",
        "description_en",
    }
)


def _without_explicit_english(payload: object) -> object:
    if isinstance(payload, list):
        return [
            _without_explicit_english(item)
            for item in payload
            if not (
                isinstance(item, dict) and _primary_language(item.get("language")) in {"en", "eng"}
            )
        ]
    if isinstance(payload, dict):
        if _primary_language(payload.get("language")) in {"en", "eng"}:
            return {}
        return {
            key: _without_explicit_english(value)
            for key, value in payload.items()
            if not (isinstance(key, str) and _primary_language(key) in {"en", "eng"})
        }
    return payload


def _fallback_alert_logical_id(raw_alert: dict[str, Any]) -> str:
    enrichment_neutral: dict[str, object] = {}
    text_keys = {*_ALERT_HEADER_KEYS, *_ALERT_DESCRIPTION_KEYS}
    text_without_english = {
        key: _without_explicit_english(value)
        for key, value in raw_alert.items()
        if key in text_keys
    }
    has_non_english_identity_text = any(
        _text(value) is not None for value in text_without_english.values()
    )
    for key, value in raw_alert.items():
        if key in _SCD_ENRICHMENT_KEYS:
            continue
        if key in text_keys and has_non_english_identity_text:
            stripped = text_without_english[key]
            # English-only fields are absent from identity so translation additions preserve logical
            # IDs.
            if _text(stripped) is None:
                continue
            enrichment_neutral[key] = stripped
        else:
            enrichment_neutral[key] = value
    encoded = json.dumps(
        enrichment_neutral,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        default=str,
    ).encode("utf-8")
    return f"content:{hashlib.sha256(encoded).hexdigest()}"


def _provider_local_observation_date(snapshot: RawI3AlertSnapshot) -> date:
    if snapshot.captured_at_utc.utcoffset() is None:
        raise ValueError("captured_at_utc must be timezone-aware")
    return snapshot.captured_at_utc.astimezone(ZoneInfo(snapshot.provider_timezone)).date()


def build_alert_language_observations(
    snapshot: RawI3AlertSnapshot,
) -> list[AlertLanguageObservation]:

    observation_date = _provider_local_observation_date(snapshot)
    latest_by_logical_id: dict[str, AlertLanguageObservation] = {}
    for raw_alert in _payload_alerts(snapshot.raw_payload_json):
        if not isinstance(raw_alert, dict):
            continue
        alert_id = _text(_value(raw_alert, "id", "alertId", "messageId"))
        logical_id = f"id:{alert_id}" if alert_id else _fallback_alert_logical_id(raw_alert)
        header = _value(raw_alert, *_ALERT_HEADER_KEYS)
        description = _value(raw_alert, *_ALERT_DESCRIPTION_KEYS)
        has_explicit_fr = _has_explicit_language(header, {"fr", "fra"}) or _has_explicit_language(
            description, {"fr", "fra"}
        )
        has_explicit_en = _has_explicit_language(header, {"en", "eng"}) or _has_explicit_language(
            description, {"en", "eng"}
        )
        latest_by_logical_id[logical_id] = AlertLanguageObservation(
            provider_id=snapshot.provider_id,
            alert_logical_id=logical_id,
            observation_date=observation_date,
            has_explicit_fr=has_explicit_fr,
            has_explicit_en=has_explicit_en,
            undetermined=not (has_explicit_fr or has_explicit_en),
            observed_at_utc=snapshot.captured_at_utc,
        )
    return sorted(
        latest_by_logical_id.values(),
        key=lambda observation: observation.alert_logical_id,
    )


def record_alert_language_observations(
    connection: Connection,
    *,
    snapshot: RawI3AlertSnapshot,
) -> int:

    observations = build_alert_language_observations(snapshot)
    observation_date = _provider_local_observation_date(snapshot)
    source_alert_count = sum(
        isinstance(item, dict) for item in _payload_alerts(snapshot.raw_payload_json)
    )
    connection.execute(
        UPSERT_ALERT_FEED_OBSERVATION,
        {
            "provider_id": snapshot.provider_id,
            "observation_date": observation_date,
            "alert_count": source_alert_count,
            "observed_at_utc": snapshot.captured_at_utc,
        },
    )
    if observations:
        connection.execute(
            UPSERT_ALERT_LANGUAGE_OBSERVATIONS,
            [asdict(observation) for observation in observations],
        )
    return len(observations)


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


def _period_bounds(period: object) -> tuple[datetime | None, datetime | None]:
    if not isinstance(period, dict):
        return None, None
    return (
        _timestamp(_value(period, "start", "startTime", "start_time")),
        _timestamp(_value(period, "end", "endTime", "end_time")),
    )


def _active_periods(alert: dict[str, Any]) -> list[tuple[datetime | None, datetime | None]]:
    period = _value(alert, "activePeriod", "active_period", "activePeriods", "active_periods")
    if isinstance(period, list):
        return [_period_bounds(item) for item in period]
    if isinstance(period, dict):
        return [_period_bounds(period)]
    return []


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
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    alert_rows: list[dict[str, object]] = []
    entity_rows: list[dict[str, object]] = []
    period_rows: list[dict[str, object]] = []

    for alert_index, raw_alert in enumerate(_payload_alerts(snapshot.raw_payload_json)):
        if not isinstance(raw_alert, dict):
            continue
        periods = _active_periods(raw_alert)
        active_start, active_end = periods[0] if periods else (None, None)
        alert_id = _text(_value(raw_alert, "id", "alertId", "messageId"))
        alert_header_text = _text(_value(raw_alert, "header", "title", "summary", "header_texts"))
        description_text = _text(
            _value(raw_alert, "description", "body", "message", "description_texts")
        )
        alert_header_text_en = _text_en(
            _value(raw_alert, "header", "title", "summary", "header_texts")
        )
        description_text_en = _text_en(
            _value(raw_alert, "description", "body", "message", "description_texts")
        )
        severity = _text(_value(raw_alert, "severity", "priority"))
        cause = _text(_value(raw_alert, "cause"))
        effect = _text(_value(raw_alert, "effect"))
        # URL is a display passthrough and is excluded from identity.
        url = _text(_value(raw_alert, "url", "link"))
        url_en = _text_en(_value(raw_alert, "url", "link"))
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
            extra_active_periods=periods[1:] if len(periods) > 1 else None,
        )
        alert_rows.append(
            {
                "i3_alert_snapshot_id": snapshot.i3_alert_snapshot_id,
                "alert_index": alert_index,
                "provider_id": snapshot.provider_id,
                "alert_id": alert_id,
                "alert_header_text": alert_header_text,
                "description_text": description_text,
                "alert_header_text_en": alert_header_text_en,
                "description_text_en": description_text_en,
                "severity": severity,
                "cause": cause,
                "effect": effect,
                "url": url,
                "url_en": url_en,
                "active_period_start_utc": active_start,
                "active_period_end_utc": active_end,
                "published_at_utc": published_at_utc,
                "updated_at_utc": updated_at_utc,
                "captured_at_utc": snapshot.captured_at_utc,
                "raw_alert_json": raw_alert,
                "content_hash": content_hash,
            }
        )
        for period_index, (start_utc, end_utc) in enumerate(periods):
            period_rows.append(
                {
                    "i3_alert_snapshot_id": snapshot.i3_alert_snapshot_id,
                    "alert_index": alert_index,
                    "period_index": period_index,
                    "start_utc": start_utc,
                    "end_utc": end_utc,
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

    # Deduplicate content hashes before INSERT ON CONFLICT and discard orphaned entities.
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
            period_rows = [p for p in period_rows if p["alert_index"] in kept_indexes]

    return alert_rows, entity_rows, period_rows


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
    connection.execute(ACQUIRE_I3_LOAD_LOCK, {"provider_id": snapshot.provider_id})
    record_alert_language_observations(connection, snapshot=snapshot)
    newer_observations = connection.execute(
        SELECT_NEWER_FEED_OBSERVATION,
        {"provider_id": snapshot.provider_id, "captured_at_utc": snapshot.captured_at_utc},
    ).mappings()
    if any(newer_observations):
        return I3SilverLoadResult(
            provider_id=snapshot.provider_id,
            i3_alert_snapshot_id=snapshot.i3_alert_snapshot_id,
            alert_rows_inserted=0,
            informed_entity_rows_inserted=0,
            loaded_at_utc=loaded_at_utc or datetime.now(UTC),
            skipped_older_capture=True,
        )
    alert_rows, entity_rows, period_rows = normalize_i3_alert_payload(snapshot)
    connection.execute(
        DELETE_I3_ACTIVE_PERIODS,
        {"i3_alert_snapshot_id": snapshot.i3_alert_snapshot_id},
    )
    connection.execute(
        DELETE_I3_ENTITIES,
        {"i3_alert_snapshot_id": snapshot.i3_alert_snapshot_id},
    )
    connection.execute(
        DELETE_I3_ALERTS,
        {"i3_alert_snapshot_id": snapshot.i3_alert_snapshot_id},
    )
    alert_count = _execute_insert(connection, INSERT_I3_ALERTS, alert_rows)

    surviving_by_hash: dict[object, tuple[int, int]] = {}
    if alert_rows:
        surviving_by_hash = {
            row["content_hash"]: (int(row["i3_alert_snapshot_id"]), int(row["alert_index"]))
            for row in connection.execute(
                SELECT_ACTIVE_ALERT_KEYS,
                {
                    "provider_id": snapshot.provider_id,
                    "content_hashes": [row["content_hash"] for row in alert_rows],
                },
            ).mappings()
        }

    # A redirected entity at an existing index keeps its old value until alert identity changes.
    hash_by_index = {row["alert_index"]: row["content_hash"] for row in alert_rows}
    redirected = sum(
        1
        for row in alert_rows
        if surviving_by_hash.get(row["content_hash"])
        not in (None, (snapshot.i3_alert_snapshot_id, row["alert_index"]))
    )
    rekeyed_entities: list[dict[str, object]] = []
    dropped_missing_parent = 0
    for entity in entity_rows:
        surviving = surviving_by_hash.get(hash_by_index.get(entity["alert_index"]))
        if surviving is None:
            dropped_missing_parent += 1
            continue
        snap_id, alert_index = surviving
        if (snap_id, alert_index) != (entity["i3_alert_snapshot_id"], entity["alert_index"]):
            entity = {**entity, "i3_alert_snapshot_id": snap_id, "alert_index": alert_index}
        rekeyed_entities.append(entity)
    entity_count = _execute_insert(connection, INSERT_I3_ENTITIES, rekeyed_entities)

    rekeyed_periods: list[dict[str, object]] = []
    for period in period_rows:
        surviving = surviving_by_hash.get(hash_by_index.get(period["alert_index"]))
        if surviving is None:
            continue
        snap_id, alert_index = surviving
        if (snap_id, alert_index) != (period["i3_alert_snapshot_id"], period["alert_index"]):
            period = {**period, "i3_alert_snapshot_id": snap_id, "alert_index": alert_index}
        rekeyed_periods.append(period)
    _execute_insert(connection, INSERT_I3_ACTIVE_PERIODS, rekeyed_periods)

    superseded = 0
    if alert_rows:
        result = connection.execute(
            SUPERSEDE_VANISHED_ALERTS,
            {
                "provider_id": snapshot.provider_id,
                "captured_at_utc": snapshot.captured_at_utc,
                "content_hashes": sorted(
                    {row["content_hash"] for row in alert_rows if row["content_hash"]}
                ),
            },
        )
        superseded = result.rowcount or 0

    return I3SilverLoadResult(
        provider_id=snapshot.provider_id,
        i3_alert_snapshot_id=snapshot.i3_alert_snapshot_id,
        alert_rows_inserted=alert_count,
        informed_entity_rows_inserted=entity_count,
        loaded_at_utc=loaded_at_utc or datetime.now(UTC),
        alerts_redirected_to_existing=redirected,
        alerts_superseded=superseded,
        entities_dropped_missing_parent=dropped_missing_parent,
    )


def find_i3_raw_snapshot(
    connection: Connection,
    *,
    provider_id: str,
    snapshot_id: int | None = None,
    endpoint_key: str | None = None,
) -> RawI3AlertSnapshot:
    if snapshot_id is not None and (type(snapshot_id) is not int or snapshot_id <= 0):
        raise ValueError("Snapshot ID must be a positive integer")
    if endpoint_key is not None and endpoint_key not in {"i3_alerts", "service_alerts"}:
        raise ValueError(f"Unsupported alert endpoint {endpoint_key!r}")
    snapshot_filter = "AND i3.i3_alert_snapshot_id = :snapshot_id" if snapshot_id else ""
    endpoint_filter = "AND fe.endpoint_key = :endpoint_key" if endpoint_key else ""
    row = (
        connection.execute(
            text(
                f"""
            SELECT
                i3.i3_alert_snapshot_id,
                i3.provider_id,
                p.timezone AS provider_timezone,
                i3.captured_at_utc,
                i3.raw_payload_json
            FROM raw.i3_alert_snapshots AS i3
            INNER JOIN core.providers AS p
                ON p.provider_id = i3.provider_id
            INNER JOIN raw.ingestion_runs AS ir
                ON ir.ingestion_run_id = i3.ingestion_run_id
            INNER JOIN core.feed_endpoints AS fe
                ON fe.feed_endpoint_id = i3.feed_endpoint_id
            WHERE i3.provider_id = :provider_id
              AND ir.status = 'succeeded'
              AND ir.provider_id = i3.provider_id
              AND ir.feed_endpoint_id = i3.feed_endpoint_id
              AND fe.provider_id = i3.provider_id
              {snapshot_filter}
              {endpoint_filter}
            ORDER BY i3.captured_at_utc DESC, i3.i3_alert_snapshot_id DESC
            LIMIT 1
            """
            ),
            {"provider_id": provider_id}
            | ({"snapshot_id": snapshot_id} if snapshot_id else {})
            | ({"endpoint_key": endpoint_key} if endpoint_key else {}),
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        if snapshot_id is not None:
            raise ValueError(
                f"No successful raw alert snapshot {snapshot_id} "
                f"belongs to {provider_id}/{endpoint_key or 'alerts'}"
            )
        raise ValueError(
            "No successful raw i3 alert snapshot was found for this provider. "
            "Run capture-i3 before load-i3-silver."
        )
    return RawI3AlertSnapshot(
        i3_alert_snapshot_id=int(row["i3_alert_snapshot_id"]),
        provider_id=str(row["provider_id"]),
        provider_timezone=str(row["provider_timezone"]),
        captured_at_utc=row["captured_at_utc"],
        raw_payload_json=row["raw_payload_json"],
    )


find_latest_i3_raw_snapshot = find_i3_raw_snapshot


def load_i3_to_silver(
    provider_id: str,
    *,
    snapshot_id: int | None = None,
    endpoint_key: str | None = None,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> I3SilverLoadResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    with engine.begin() as connection:
        snapshot = find_i3_raw_snapshot(
            connection, provider_id=provider_id, snapshot_id=snapshot_id, endpoint_key=endpoint_key
        )
        return load_i3_snapshot_to_silver(connection, snapshot=snapshot)


load_latest_i3_to_silver = load_i3_to_silver
