"""Worker-owned live upload resources, reused across cycles and drained on exit."""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from transit_ops.settings import Settings
from transit_ops.snapshots.storage import (
    LocalSnapshotStorage,
    SnapshotStorage,
    build_snapshot_storage,
)
from transit_ops.snapshots.uploads import concurrency, provider_executor


@dataclass
class _LiveScope:
    provider_id: str
    settings: Settings
    storage: SnapshotStorage | LocalSnapshotStorage | None = None


_ACTIVE: ContextVar[_LiveScope | None] = ContextVar("live_publish_scope", default=None)


def worker_live_storage(
    provider_id: str,
    settings: Settings,
) -> SnapshotStorage | LocalSnapshotStorage | None:
    scope = _ACTIVE.get()
    if scope is None or scope.provider_id != provider_id or scope.settings is not settings:
        return None
    if scope.storage is None:
        scope.storage = build_snapshot_storage(settings, provider_id=provider_id)
    return scope.storage


@contextmanager
def live_publish_scope(provider_id: str, settings: Settings) -> Iterator[None]:
    scope = _LiveScope(provider_id, settings)
    token = _ACTIVE.set(scope)
    try:
        # Executor exit drains tasks before any client is closed.
        with provider_executor(concurrency(settings)):
            yield
    finally:
        _ACTIVE.reset(token)
        if isinstance(scope.storage, SnapshotStorage):
            scope.storage.close()
