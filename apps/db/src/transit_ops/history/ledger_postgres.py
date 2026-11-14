"""Ledger sessions in the caller's PostgreSQL transaction."""

from collections.abc import Collection, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import asdict
from datetime import date, datetime
from typing import cast, get_args

from sqlalchemy import Connection, event, text
from sqlalchemy.engine import ExceptionContext

from transit_ops.history import ledger
from transit_ops.history.ledger import ArchiveCopy, EventKind, WindowState, WorkingState
from transit_ops.history.ledger_store import NewCopy, RecordedEvent, WindowIdentity, WindowSession


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
                yield _Session(self.connection, identity)
                if failed:
                    raise RuntimeError("ledger session failed; all session writes rolled back")
        finally:
            event.remove(self.connection.engine, "handle_error", note_failure)

    def window_state(self, identity: WindowIdentity) -> WindowState | None:
        return ledger.window_state(self.connection, **asdict(identity))

    def find_copies(
        self, *, dataset_id: str, provider_id: str, start: date, end: date, revision: int = 0
    ) -> list[ArchiveCopy]:
        raise NotImplementedError("copy reads arrive in LS3.1d-2 (PR 2)")


class _Session:
    def __init__(self, connection: Connection, identity: WindowIdentity) -> None:
        self.connection, self.identity = connection, identity

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
        raise NotImplementedError("copy reads arrive in LS3.1d-2 (PR 2)")

    def insert_allocated_copy(self, copy: NewCopy) -> None:
        raise NotImplementedError("copy writes arrive in LS3.1d-2 (PR 2)")

    def mark_sealed(self, content_version: int, *, actor: str | None = None) -> None:
        raise NotImplementedError("copy writes arrive in LS3.1d-2 (PR 2)")

    def mark_rejected(
        self, content_version: int, *, rejected_at: datetime, reason: str, actor: str | None = None
    ) -> None:
        raise NotImplementedError("copy writes arrive in LS3.1d-2 (PR 2)")

    def make_current(
        self, content_version: int, *, verified_at: datetime, actor: str | None = None
    ) -> None:
        raise NotImplementedError("copy writes arrive in LS3.1d-2 (PR 2)")
