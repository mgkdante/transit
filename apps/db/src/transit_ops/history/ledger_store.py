"""Window sessions shared by ledger adapters.

Reads see the session's own writes. Writes become visible together or not at all;
an exception inside the session leaves nothing written by it. A failed write
guard raises RuntimeError naming the copy and leaves the session usable only for
exit. PostgreSQL holds the window lock and never raises WindowChanged; R2 may
raise it at exit, requiring the caller to decide again. Values are validated
before any write with today's ValueError and WindowNotFound errors.
State changes persist even with no public audit records; events() stays empty.
Read-only sessions write nothing.
"""

from collections.abc import Collection, Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from transit_ops.history.ledger import ArchiveCopy, EventKind, WindowState, WorkingState


@dataclass(frozen=True)
class WindowIdentity:
    dataset_id: str
    provider_id: str
    window_key: str
    revision: int = 0


@dataclass(frozen=True)
class NewCopy:
    content_version: int
    schema_version: int
    storage_backend: str
    storage_path: str | None
    manifest_path: str | None
    byte_size: int | None
    sha256: str | None
    manifest_sha256: str | None
    record_count: int | None
    poll_count: int | None
    source_bytes: int | None
    content_sha256: str | None
    poll_record_sha256: str | None
    first_time_utc: datetime | None
    last_time_utc: datetime | None
    details: Mapping[str, object]


@dataclass(frozen=True)
class RecordedEvent:
    kind: EventKind
    content_version: int | None
    reason: str | None
    details: Mapping[str, object]
    actor: str
    at_utc: datetime


class WindowChanged(RuntimeError):
    """The window moved after this session read it; decide again from a new session."""


class WindowSession(Protocol):
    identity: WindowIdentity

    def state(self) -> WindowState | None: ...
    def copies(self) -> list[ArchiveCopy]: ...
    def now(self) -> datetime: ...
    def mark_changed(self, *, actor: str | None = None) -> None: ...
    def allocate_version(self, *, above_version: int = 0) -> int: ...
    def set_working_state(self, state: WorkingState) -> None: ...
    def insert_allocated_copy(self, copy: NewCopy) -> None: ...
    def mark_sealed(self, content_version: int, *, actor: str | None = None) -> None: ...
    def mark_rejected(
        self, content_version: int, *, rejected_at: datetime, reason: str, actor: str | None = None
    ) -> None: ...
    def make_current(
        self, content_version: int, *, verified_at: datetime, actor: str | None = None
    ) -> None: ...
    def hold(
        self, *, until_utc: datetime | None, reason: str, actor: str | None = None
    ) -> None: ...
    def record_event(
        self,
        kind: EventKind,
        *,
        content_version: int | None = None,
        reason: str | None = None,
        details: Mapping[str, object] | None = None,
        actor: str | None = None,
    ) -> None: ...
    def events(self, *, kinds: Collection[str] | None = None) -> list[RecordedEvent]: ...
    def processing_events(self) -> list[RecordedEvent]: ...


class LedgerStore(Protocol):
    def session(self, identity: WindowIdentity) -> AbstractContextManager[WindowSession]: ...
    def window_state(self, identity: WindowIdentity) -> WindowState | None: ...
    def find_copies(
        self, *, dataset_id: str, provider_id: str, start: date, end: date, revision: int = 0
    ) -> list[ArchiveCopy]: ...
