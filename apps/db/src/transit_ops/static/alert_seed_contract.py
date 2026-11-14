"""Versioned alert bundle contract, independent of capture and storage engines."""

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

TABLES = (
    "silver.i3_alerts",
    "silver.i3_alert_informed_entities",
    "silver.i3_alert_active_periods",
    "raw.alert_feed_observations",
    "raw.alert_language_observations",
    "raw.i3_alert_snapshots",
)


def _schema(**groups: str) -> dict[str, str]:
    return {
        column: ("timestamp with time zone" if kind == "timestamp" else kind)
        for kind, names in groups.items()
        for column in names.split()
    }


V1_TABLES = (
    _schema(
        bigint="i3_alert_snapshot_id message_snapshot_id",
        integer="alert_index message_alert_index",
        text="provider_id alert_id alert_header_text description_text severity cause effect "
        "content_hash alert_header_text_en description_text_en url url_en",
        timestamp="active_period_start_utc active_period_end_utc published_at_utc "
        "updated_at_utc captured_at_utc first_seen_at last_seen_at valid_to",
        jsonb="raw_alert_json",
    ),
    _schema(
        bigint="i3_alert_snapshot_id",
        integer="alert_index entity_index",
        text="provider_id route_id stop_id trip_id area_id",
        jsonb="raw_entity_json",
    ),
    _schema(
        bigint="i3_alert_snapshot_id",
        integer="alert_index period_index",
        timestamp="start_utc end_utc",
    ),
    _schema(
        text="provider_id",
        date="observation_date",
        integer="alert_count",
        timestamp="observed_at_utc",
    ),
    _schema(
        text="provider_id alert_logical_id",
        date="observation_date",
        boolean="has_explicit_fr has_explicit_en undetermined",
        timestamp="observed_at_utc",
    ),
    _schema(
        bigint="i3_alert_snapshot_id feed_endpoint_id ingestion_run_id "
        "ingestion_object_id byte_size",
        text="provider_id source_url storage_backend storage_path checksum_sha256 api_version",
        integer="http_status_code alert_count",
        timestamp="captured_at_utc",
        jsonb="raw_payload_json",
    ),
)
SCHEMAS = dict(zip(TABLES, V1_TABLES, strict=True))
V1_KEYS = (
    "i3_alert_snapshot_id alert_index",
    "i3_alert_snapshot_id alert_index entity_index",
    "i3_alert_snapshot_id alert_index period_index",
    "provider_id observation_date",
    "provider_id alert_logical_id observation_date",
    "i3_alert_snapshot_id",
)
KEYS = dict(zip(TABLES, map(str.split, V1_KEYS), strict=True))
V1_REQUIRED = (
    "provider_id captured_at_utc raw_alert_json content_hash",
    "provider_id raw_entity_json",
    "",
    "alert_count observed_at_utc",
    "has_explicit_fr has_explicit_en undetermined observed_at_utc",
    "provider_id feed_endpoint_id ingestion_run_id captured_at_utc raw_payload_json",
)
REQUIRED = dict(zip(TABLES, map(str.split, V1_REQUIRED), strict=True))


class AlertSeedInvalid(ValueError):
    pass


class SeedTable(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    columns: dict[str, str]
    rows: list[dict[str, Any]]


def encode_seed_value(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.utcoffset() is None:
            raise AlertSeedInvalid("naive timestamp")
        return value.astimezone(UTC).isoformat(timespec="microseconds")
    return value.isoformat() if isinstance(value, date) else value


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


class AlertSeed(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: Literal[1]
    provider_id: str
    snapshot_at: datetime
    global_max_snapshot_id: int | None
    tables: dict[str, SeedTable]

    @model_validator(mode="after")
    def validate_state(self) -> Self:
        if (
            not self.provider_id
            or self.snapshot_at.utcoffset() is None
            or set(self.tables) != set(TABLES)
        ):
            raise AlertSeedInvalid("invalid provider, timestamp or table schema")
        for name, table in self.tables.items():
            _validate_table(name, table, self.provider_id)
        alerts = self.tables[TABLES[0]].rows
        parents = {(r["i3_alert_snapshot_id"], r["alert_index"]) for r in alerts}
        raw_ids = {r["i3_alert_snapshot_id"] for r in self.tables[TABLES[5]].rows}
        for row in alerts:
            refs = {row["i3_alert_snapshot_id"], row["message_snapshot_id"]} - {None}
            if row["valid_to"] is not None or not refs <= raw_ids:
                raise AlertSeedInvalid("superseded alert or missing raw provenance")
        for name in TABLES[1:3]:
            for row in self.tables[name].rows:
                if (row["i3_alert_snapshot_id"], row["alert_index"]) not in parents:
                    raise AlertSeedInvalid("dangling child")
        if raw_ids and (
            self.global_max_snapshot_id is None or max(raw_ids) > self.global_max_snapshot_id
        ):
            raise AlertSeedInvalid("missing or inconsistent global id floor")
        return self

    def to_json(self) -> bytes:
        data = self.model_dump(mode="json")
        data["snapshot_at"] = encode_seed_value(self.snapshot_at)
        try:
            self.model_validate_json(canonical_json(data))
            return canonical_json(
                data | {"sha256": hashlib.sha256(canonical_json(data)).hexdigest()}
            )
        except (ValueError, KeyError, TypeError) as exc:
            raise AlertSeedInvalid(str(exc)) from exc

    @classmethod
    def from_json(cls, payload: bytes) -> Self:
        try:
            data = json.loads(payload)
            digest = data.pop("sha256")
            if digest != hashlib.sha256(canonical_json(data)).hexdigest():
                raise AlertSeedInvalid("digest mismatch")
            return cls.model_validate_json(canonical_json(data))
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise AlertSeedInvalid(str(exc)) from exc


def _validate_cell(value: Any, kind: str) -> None:
    if value is None:
        return
    expected = dict(text=str, bigint=int, integer=int, boolean=bool, jsonb=str, date=str)
    expected["timestamp with time zone"] = str
    if kind not in expected or type(value) is not expected[kind]:
        raise AlertSeedInvalid(f"invalid cell type: {kind}")
    if kind == "timestamp with time zone":
        if datetime.fromisoformat(str(value)).utcoffset() is None:
            raise AlertSeedInvalid("naive timestamp")
    elif kind == "date":
        date.fromisoformat(str(value))
    elif kind == "jsonb":
        json.loads(str(value))


def _validate_table(name: str, table: SeedTable, provider_id: str) -> None:
    if table.columns != SCHEMAS[name]:
        raise AlertSeedInvalid("versioned schema mismatch")
    required = KEYS[name] + REQUIRED[name]
    for row in table.rows:
        if set(row) != set(SCHEMAS[name]) or any(row[c] is None for c in required):
            raise AlertSeedInvalid("row schema or required identity mismatch")
        if row.get("provider_id", provider_id) != provider_id:
            raise AlertSeedInvalid("provider mismatch")
        for column, kind in SCHEMAS[name].items():
            _validate_cell(row[column], kind)
    indexes = [KEYS[name]]
    if name == TABLES[0]:
        indexes.append(["provider_id", "content_hash"])
    if name == TABLES[5]:
        indexes.append(["ingestion_run_id"])
    for columns in indexes:
        keys = [tuple(row[c] for c in columns) for row in table.rows]
        if len(set(keys)) != len(keys):
            raise AlertSeedInvalid("duplicate persisted key")
