"""Ledger sessions in the caller's PostgreSQL transaction."""

import json
from collections.abc import Collection, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import asdict, fields
from datetime import date, datetime
from typing import cast, get_args

from sqlalchemy import Connection, event, text
from sqlalchemy.engine import ExceptionContext

from transit_ops.history import ledger
from transit_ops.history.ledger import ArchiveCopy, EventKind, WindowState, WorkingState
from transit_ops.history.ledger_store import NewCopy, RecordedEvent, WindowIdentity, WindowSession

_WINDOW = """dataset_id=:dataset_id AND provider_id=:provider_id
             AND revision=:revision AND window_key=:window_key"""
_COPY = _WINDOW + " AND content_version=:content_version"


def _aware(at: datetime) -> datetime:
    if not isinstance(at, datetime) or at.utcoffset() is None:
        raise ValueError("copy time must be an aware datetime")
    return at


class PostgresLedger:
    def __init__(self, connection: Connection) -> None:
        self.connection = connection

    @contextmanager
    def session(self, identity: WindowIdentity) -> Iterator[WindowSession]:
        if not self.connection.in_transaction():
            raise ValueError("ledger session needs the caller's transaction")
        ledger.acquire_window_lock(self.connection, **asdict(identity))
        failed = False

        def note_failure(context: ExceptionContext) -> None:
            nonlocal failed
            failed |= context.connection is self.connection

        event.listen(self.connection.engine, "handle_error", note_failure)
        try:
            with self.connection.begin_nested():
                session = _Session(self.connection, identity)
                yield session
                if failed or session.failed:
                    raise RuntimeError("ledger session failed; all session writes rolled back")
        finally:
            event.remove(self.connection.engine, "handle_error", note_failure)

    def window_state(self, identity: WindowIdentity) -> WindowState | None:
        return ledger.window_state(self.connection, **asdict(identity))

    def find_copies(
        self, *, dataset_id: str, provider_id: str, start: date, end: date, revision: int = 0
    ) -> list[ArchiveCopy]:
        return ledger.find_copies(
            self.connection,
            dataset_id=dataset_id,
            provider_id=provider_id,
            start=start,
            end=end,
            revision=revision,
        )


class _Session:
    def __init__(self, connection: Connection, identity: WindowIdentity) -> None:
        self._connection, self.identity = connection, identity
        self.failed = False

    @property
    def connection(self) -> Connection:
        if self.failed:
            raise RuntimeError("ledger session failed; only exit is permitted")
        return self._connection

    def state(self) -> WindowState | None:
        return ledger.window_state(self.connection, **asdict(self.identity))

    def now(self) -> datetime:
        return cast(
            datetime, self.connection.execute(text("SELECT clock_timestamp()")).scalar_one()
        )

    def mark_changed(self, *, actor: str | None = None) -> None:
        ledger.lock_window(self.connection, **asdict(self.identity), actor=actor)

    def allocate_version(self, *, above_version: int = 0) -> int:
        return ledger.allocate_version(
            self.connection, **asdict(self.identity), above_version=above_version
        )

    def set_working_state(self, state: WorkingState) -> None:
        if state not in get_args(WorkingState):
            raise ValueError("unknown working state")
        self.connection.execute(
            text("""
            UPDATE core.history_window SET working_state=:state
            WHERE dataset_id=:dataset_id AND provider_id=:provider_id
              AND revision=:revision AND window_key=:window_key
              AND working_state IN ('present', 'empty')
            """),
            {**asdict(self.identity), "state": state},
        )

    def hold(self, *, until_utc: datetime | None, reason: str, actor: str | None = None) -> None:
        ledger.hold(
            self.connection,
            **asdict(self.identity),
            until_utc=until_utc,
            reason=reason,
            actor=actor,
        )

    def record_event(
        self,
        kind: EventKind,
        *,
        content_version: int | None = None,
        reason: str | None = None,
        details: Mapping[str, object] | None = None,
        actor: str | None = None,
    ) -> None:
        ledger.record_event(
            self.connection,
            **asdict(self.identity),
            kind=kind,
            content_version=content_version,
            reason=reason,
            details=details,
            actor=actor,
        )

    def events(self, *, kinds: Collection[str] | None = None) -> list[RecordedEvent]:
        rows = self.connection.execute(
            text("""
            SELECT kind, content_version, reason, details, actor, at_utc FROM core.history_event
            WHERE dataset_id=:dataset_id AND provider_id=:provider_id
              AND revision=:revision AND window_key=:window_key
              AND (:all_kinds OR kind = ANY(:kinds)) ORDER BY event_id
            """),
            {**asdict(self.identity), "all_kinds": kinds is None, "kinds": list(kinds or ())},
        ).mappings()
        return [RecordedEvent(**row) for row in rows]

    def processing_events(self) -> list[RecordedEvent]:
        return self.events(kinds={"processing_evidence"})

    def copies(self) -> list[ArchiveCopy]:
        columns = ", ".join(
            f"c.{f.name}"
            for f in fields(ArchiveCopy)
            if f.name not in {"window_start", "is_current"}
        )
        predicate = " AND ".join(f"c.{name}=:{name}" for name in asdict(self.identity))
        rows = self.connection.execute(
            text(f"""
            SELECT {columns}, w.window_start,
                   COALESCE(w.current_version=c.content_version, false) AS is_current
            FROM core.history_archive_copy c JOIN core.history_window w
              USING (dataset_id, provider_id, revision, window_key)
            WHERE {predicate} ORDER BY c.content_version
        """),
            asdict(self.identity),
        ).mappings()
        return [ArchiveCopy(**row) for row in rows]

    def insert_allocated_copy(self, copy: NewCopy) -> None:
        self._copy_values(copy.content_version, None)
        values = {**asdict(self.identity), **{f.name: getattr(copy, f.name) for f in fields(copy)}}
        values["details"] = json.dumps(dict(copy.details), sort_keys=True)
        columns = ", ".join(values)
        params = ", ".join("CAST(:details AS jsonb)" if k == "details" else f":{k}" for k in values)
        self._update(
            f"""
            INSERT INTO core.history_archive_copy ({columns}, allocated_at_utc)
            VALUES ({params}, clock_timestamp())
            ON CONFLICT (dataset_id, provider_id, revision, window_key, content_version) DO NOTHING
        """,
            values,
            "insert",
        )

    def mark_sealed(self, content_version: int, *, actor: str | None = None) -> None:
        values = self._copy_values(content_version, actor)
        self._update(
            f"""
            UPDATE core.history_archive_copy SET sealed_at_utc=clock_timestamp()
            WHERE {_COPY} AND sealed_at_utc IS NULL AND rejected_at_utc IS NULL
        """,
            values,
            "seal",
        )
        self.record_event("seal", content_version=content_version, actor=actor)

    def mark_rejected(
        self, content_version: int, *, rejected_at: datetime, reason: str, actor: str | None = None
    ) -> None:
        values = self._copy_values(content_version, actor, _aware(rejected_at), reason)
        self._update(
            f"""
            UPDATE core.history_archive_copy SET rejected_at_utc=:at, reject_reason=:reason
            WHERE {_COPY} AND rejected_at_utc IS NULL AND verified_at_utc IS NULL
        """,
            values,
            "reject",
        )
        self.record_event("reject", content_version=content_version, reason=reason, actor=actor)

    def make_current(
        self, content_version: int, *, verified_at: datetime, actor: str | None = None
    ) -> None:
        values = self._copy_values(content_version, actor, _aware(verified_at))
        window = self.state()
        previous = window.current_version if window else None
        self._update(
            f"""
            UPDATE core.history_archive_copy SET verified_at_utc=:at
            WHERE {_COPY} AND sealed_at_utc IS NOT NULL
              AND verified_at_utc IS NULL AND rejected_at_utc IS NULL
        """,
            values,
            "verify",
        )
        self._update(
            f"""
            UPDATE core.history_window SET current_version=:content_version
            WHERE {_WINDOW} AND (current_version IS NULL OR current_version < :content_version)
        """,
            values,
            "make current",
        )
        self.record_event("verify", content_version=content_version, actor=actor)
        self.record_event(
            "current",
            content_version=content_version,
            actor=actor,
            details={"previous_version": previous},
        )

    def _copy_values(
        self, version: int, actor: str | None, at: datetime | None = None, reason: str | None = None
    ) -> dict[str, object]:
        if version < 1:
            raise ValueError("content_version must be positive")
        if actor == "" or reason == "":
            raise ValueError("reason and actor must not be empty")
        return {**asdict(self.identity), "content_version": version, "at": at, "reason": reason}

    def _update(self, sql: str, values: dict[str, object], action: str) -> None:
        if self.connection.execute(text(sql), values).rowcount != 1:
            self.failed = True
            identity = {**asdict(self.identity), "content_version": values["content_version"]}
            verb = "make copy current" if action == "make current" else f"{action} copy"
            raise RuntimeError(f"could not {verb} {identity}")
