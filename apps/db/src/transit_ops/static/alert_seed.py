"""Present-state cutover bundles; callers own the PostgreSQL snapshot transaction."""

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import Connection, text

TABLES = (
    "silver.i3_alerts",
    "silver.i3_alert_informed_entities",
    "silver.i3_alert_active_periods",
    "raw.alert_feed_observations",
    "raw.alert_language_observations",
    "raw.i3_alert_snapshots",
)


class AlertSeedInvalid(ValueError):
    pass


class AlertSeedReadRefused(ValueError):
    pass


class SeedTable(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    columns: dict[str, str]
    rows: list[dict[str, Any]]


def _encode(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.utcoffset() is None:
            raise AlertSeedInvalid("naive timestamp")
        return value.astimezone(UTC).isoformat(timespec="microseconds")
    return value.isoformat() if isinstance(value, date) else value


def _json(value: Any) -> bytes:
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
        for table in self.tables.values():
            if not table.columns:
                raise AlertSeedInvalid("missing columns")
            for row in table.rows:
                if (
                    set(row) != set(table.columns)
                    or row.get("provider_id", self.provider_id) != self.provider_id
                ):
                    raise AlertSeedInvalid("row schema or provider mismatch")
                for column, kind in table.columns.items():
                    _validate_cell(row[column], kind)
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
        data["snapshot_at"] = _encode(self.snapshot_at)
        try:
            self.model_validate_json(_json(data))
            return _json(data | {"sha256": hashlib.sha256(_json(data)).hexdigest()})
        except (ValueError, KeyError, TypeError) as exc:
            raise AlertSeedInvalid(str(exc)) from exc

    @classmethod
    def from_json(cls, payload: bytes) -> Self:
        try:
            data = json.loads(payload)
            digest = data.pop("sha256")
            if digest != hashlib.sha256(_json(data)).hexdigest():
                raise AlertSeedInvalid("digest mismatch")
            return cls.model_validate_json(_json(data))
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


def read_alert_seed(pg: Connection, *, provider_id: str) -> AlertSeed:
    if not pg.in_transaction():
        raise AlertSeedReadRefused("caller must hold a transaction")
    mode = pg.execute(
        text(
            "SELECT current_setting('transaction_read_only'), "
            "current_setting('transaction_isolation')"
        )
    ).one()
    if tuple(mode) != ("on", "repeatable read"):
        raise AlertSeedReadRefused("requires READ ONLY REPEATABLE READ")
    tables = {}
    active = "SELECT * FROM silver.i3_alerts WHERE provider_id=:p AND valid_to IS NULL"
    refs = (
        f"WITH active AS ({active}) SELECT i3_alert_snapshot_id FROM active "
        "UNION SELECT message_snapshot_id FROM active"
    )
    for name in TABLES:
        tables[name] = _read_table(pg, name, provider_id, active, refs)
    try:
        return AlertSeed(
            version=1,
            provider_id=provider_id,
            tables=tables,
            snapshot_at=pg.execute(text("SELECT transaction_timestamp()")).scalar_one(),
            global_max_snapshot_id=pg.execute(
                text("SELECT max(i3_alert_snapshot_id) FROM raw.i3_alert_snapshots")
            ).scalar_one(),
        )
    except (ValueError, KeyError, TypeError) as exc:
        raise AlertSeedInvalid(str(exc)) from exc


def _read_table(pg: Connection, name: str, provider_id: str, active: str, refs: str) -> SeedTable:

    columns = dict(
        pg.execute(
            text(
                "SELECT attname, format_type(atttypid, atttypmod) FROM pg_attribute "
                "WHERE attrelid=CAST(:name AS regclass) AND attnum>0 AND NOT attisdropped "
                "ORDER BY attnum"
            ),
            {"name": name},
        )
        .tuples()
        .all()
    )
    projection = ", ".join(
        f't."{c}"::text AS "{c}"' if k == "jsonb" else f't."{c}"' for c, k in columns.items()
    )
    if name in TABLES[1:3]:
        where = (
            f"EXISTS (SELECT 1 FROM ({active}) a WHERE "
            "(a.i3_alert_snapshot_id, a.alert_index) = (t.i3_alert_snapshot_id, t.alert_index))"
        )
    elif name == TABLES[5]:
        where = f"t.i3_alert_snapshot_id IN ({refs})"
    else:
        where = "t.provider_id=:p" + (" AND t.valid_to IS NULL" if name == TABLES[0] else "")
    rows = [
        {c: _encode(v) for c, v in r.items()}
        for r in pg.execute(
            text(f"SELECT {projection} FROM {name} t WHERE {where}"), {"p": provider_id}
        ).mappings()
    ]
    return SeedTable(columns=columns, rows=sorted(rows, key=_json))
