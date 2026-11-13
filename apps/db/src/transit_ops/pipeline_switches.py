"""Owner-controlled switches; setters own their transaction and row-lock barrier."""

from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from unicodedata import category

from sqlalchemy import Connection, text


@dataclass(frozen=True)
class PipelineSwitch:
    switch_key: str
    enabled: bool
    updated_at_utc: datetime
    updated_by: str
    reason: str


@dataclass(frozen=True)
class GuardResult:
    allowed: bool
    reason: str | None = None


class GuardRefused(ValueError):
    pass


class SchemaNotReady(ValueError):
    pass


_guards: dict[str, Callable[[Connection, str], GuardResult]] = {}
_columns = "switch_key, enabled, updated_at_utc, updated_by, reason"


def validate_text(value: str, name: str) -> None:
    if not value.strip() or any(category(char).startswith("C") for char in value):
        raise ValueError(f"{name} must be nonblank and contain no control characters")


def register_guard(prefix: str, guard: Callable[[Connection, str], GuardResult]) -> None:
    validate_text(prefix, "prefix")
    if prefix in _guards:
        raise ValueError("guard prefix already registered")
    _guards[prefix] = guard


def _exists(connection: Connection, table: str) -> bool:
    return (
        connection.execute(text("SELECT to_regclass(:table)"), {"table": table}).scalar_one()
        is not None
    )


def enabled(connection: Connection) -> frozenset[str]:
    if not _exists(connection, "core.pipeline_switches"):
        return frozenset()
    return frozenset(
        connection.execute(
            text("SELECT switch_key FROM core.pipeline_switches WHERE enabled")
        ).scalars()
    )


def list_switches(connection: Connection) -> list[PipelineSwitch]:
    if not _exists(connection, "core.pipeline_switches"):
        return []
    return [
        PipelineSwitch(**row)
        for row in connection.execute(
            text(f"SELECT {_columns} FROM core.pipeline_switches ORDER BY switch_key")
        ).mappings()
    ]


def show_switch(connection: Connection, switch_key: str) -> PipelineSwitch | None:
    if not _exists(connection, "core.pipeline_switches"):
        return None
    row = (
        connection.execute(
            text(f"SELECT {_columns} FROM core.pipeline_switches WHERE switch_key=:key"),
            {"key": switch_key},
        )
        .mappings()
        .one_or_none()
    )
    return PipelineSwitch(**row) if row is not None else None


def history_daily_guard(connection: Connection, key: str) -> GuardResult:
    """Check schema readiness only; deployment and operating approval belong to the owner."""
    if key != "history_daily":
        return GuardResult(False, "history daily guard requires the exact key")
    for table in ("history_window", "history_archive_copy", "history_event"):
        if not _exists(connection, "core." + table):
            return GuardResult(False, "history ledger schema is not ready")
    return GuardResult(True)


register_guard("history_daily", history_daily_guard)


def _check_guard(connection: Connection, switch_key: str) -> None:
    prefixes = sorted((p for p in _guards if switch_key.startswith(p)), key=len, reverse=True)
    if not prefixes:
        raise GuardRefused("no guard registered for this switch")
    result = _guards[prefixes[0]](connection, switch_key)
    if not result.allowed:
        raise GuardRefused(result.reason or "switch guard refused enablement")


def set_switch(
    connection: Connection, switch_key: str, *, on: bool, updated_by: str, reason: str
) -> None:
    """Commit a transition after locking; repeated values preserve all stored metadata."""
    for name, value in (("switch key", switch_key), ("actor", updated_by), ("reason", reason)):
        validate_text(value, name)
    if switch_key.startswith("stop_time_diet:"):
        raise ValueError("use set-stop-time-diet for this key")
    if connection.in_transaction():
        raise ValueError("set_switch requires a connection without a transaction")
    with connection.begin():
        if not _exists(connection, "core.pipeline_switches"):
            if on:
                raise SchemaNotReady("pipeline switch schema is not ready")
            return
        params = {"key": switch_key, "on": on, "actor": updated_by, "reason": reason}
        connection.execute(
            text(
                "INSERT INTO core.pipeline_switches "
                "(switch_key, enabled, updated_at_utc, updated_by, reason) "
                "VALUES (:key, false, clock_timestamp(), :actor, :reason) "
                "ON CONFLICT (switch_key) DO NOTHING"
            ),
            params,
        )
        previous = connection.execute(
            text("SELECT enabled FROM core.pipeline_switches WHERE switch_key=:key FOR UPDATE"),
            params,
        ).scalar_one()
        if on:
            _check_guard(connection, switch_key)
        if previous != on:
            connection.execute(
                text(
                    "UPDATE core.pipeline_switches SET enabled=:on, "
                    "updated_at_utc=clock_timestamp(), updated_by=:actor, reason=:reason "
                    "WHERE switch_key=:key"
                ),
                params,
            )


def display_switch(row: PipelineSwitch | None, key: str | None = None) -> dict[str, object]:
    if row is None:
        return dict(
            switch_key=key,
            enabled=False,
            updated_at_utc=None,
            updated_by=None,
            reason=None,
            present=False,
        )
    result = asdict(row)
    result["updated_at_utc"] = row.updated_at_utc.astimezone(UTC).isoformat()
    if key is not None:
        result["present"] = True
    return result
