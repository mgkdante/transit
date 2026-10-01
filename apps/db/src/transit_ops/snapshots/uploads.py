from collections.abc import Iterable, Iterator, Sequence
from concurrent.futures import Executor, ThreadPoolExecutor, wait
from contextlib import contextmanager
from contextvars import ContextVar

from transit_ops.settings import Settings
from transit_ops.snapshots.protocols import (
    ImmutablePayloadSink,
    PayloadSink,
    PublishStage,
    PutItem,
    SnapshotOutcomeWriter,
)

_ACTIVE_PUBLISH_EXECUTOR: ContextVar[Executor | None] = ContextVar(
    "snapshot_publish_executor",
    default=None,
)


@contextmanager
def provider_executor(concurrency: int) -> Iterator[None]:
    if concurrency <= 1 or _ACTIVE_PUBLISH_EXECUTOR.get() is not None:
        yield
        return
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        token = _ACTIVE_PUBLISH_EXECUTOR.set(executor)
        try:
            yield
        finally:
            _ACTIVE_PUBLISH_EXECUTOR.reset(token)


def concurrency(settings: Settings) -> int:
    value = getattr(settings, "SNAPSHOT_PUBLISH_CONCURRENCY", 16)
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 16


def put_batch(
    storage: PayloadSink,
    items: Sequence[PutItem],
    *,
    concurrency: int,
    write_mode: str = "normal",
    executor: Executor | None = None,
) -> list[str]:
    if not items:
        return []
    if write_mode not in {"normal", "immutable"}:
        raise ValueError(f"unknown snapshot write mode {write_mode!r}")

    immutable_sink = None
    if write_mode == "immutable":
        if not isinstance(storage, ImmutablePayloadSink):
            raise TypeError("immutable upload requires an immutable payload sink")
        immutable_sink = storage

    def put(item: PutItem) -> str:
        rel_key, payload, tier = item
        if immutable_sink is not None:
            return immutable_sink.put_immutable_json(rel_key, payload)
        return storage.put_json(rel_key, payload, tier=tier)

    if concurrency <= 1:
        return [put(item) for item in items]

    if executor is None:
        executor = _ACTIVE_PUBLISH_EXECUTOR.get()
    if executor is not None:
        futures = [executor.submit(put, item) for item in items]
        wait(futures)
        return [future.result() for future in futures]

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(put, item) for item in items]
        wait(futures)
        return [future.result() for future in futures]


def put_stages(
    storage: PayloadSink,
    stages: Sequence[PublishStage],
    *,
    concurrency: int,
) -> list[str]:

    written: list[str] = []
    for stage, write_mode in stages:
        written.extend(
            put_batch(
                storage,
                stage,
                concurrency=concurrency,
                write_mode=write_mode,
            )
        )
    return written


def stable_item_total(items: Sequence[PutItem]) -> int:

    return sum(1 for item in items if not is_immutable_item(item[0], item[2]))


def is_immutable_item(rel_key: str, tier: str | None = None) -> bool:

    return tier == "historic_immutable" or "/generations/" in rel_key


def stable_outcome_total(storage: SnapshotOutcomeWriter) -> int:

    mutable_outcomes = [
        *storage.written,
        *storage.skipped,
    ]
    return sum(1 for rel_key in mutable_outcomes if not is_immutable_item(rel_key))


def put_batches(
    storage: PayloadSink,
    items: Iterable[PutItem],
    *,
    concurrency: int,
    batch_size: int,
    write_mode: str = "normal",
) -> list[str]:
    if batch_size < 1:
        raise ValueError("Snapshot upload batch size must be positive")
    written: list[str] = []
    batch: list[PutItem] = []
    for item in items:
        batch.append(item)
        if len(batch) == batch_size:
            written.extend(
                put_batch(storage, batch, concurrency=concurrency, write_mode=write_mode)
            )
            batch.clear()
    if batch:
        written.extend(put_batch(storage, batch, concurrency=concurrency, write_mode=write_mode))
    return written
