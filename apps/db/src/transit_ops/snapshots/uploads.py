from collections.abc import Callable, Iterable, Iterator, Sequence
from concurrent.futures import FIRST_COMPLETED, Executor, Future, ThreadPoolExecutor, wait
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


class UploadWindow[ItemT]:
    """Bound payload futures while retaining the caller's written-key order."""

    def __init__(self, put: Callable[[ItemT], list[str]], size: int) -> None:
        if size < 1:
            raise ValueError("Snapshot upload window size must be positive")
        self.put = put
        self.size = size
        self.executor = _ACTIVE_PUBLISH_EXECUTOR.get()
        self.pending: dict[Future[list[str]], int] = {}
        self.results: list[list[str]] = []

    def collect_completed(self) -> None:
        for future in list(self.pending):
            if future.done():
                self.results[self.pending.pop(future)] = future.result()

    def submit(self, item: ItemT) -> None:
        self.collect_completed()
        if self.executor is None:
            self.results.append(self.put(item))
            return
        self.pending[self.executor.submit(self.put, item)] = len(self.results)
        self.results.append([])
        if len(self.pending) >= self.size:
            wait(self.pending, return_when=FIRST_COMPLETED)
            self.collect_completed()

    def finish(self) -> list[str]:
        while self.pending:
            wait(self.pending, return_when=FIRST_COMPLETED)
            self.collect_completed()
        return [key for keys in self.results for key in keys]

    def cancel_and_drain(self) -> None:
        for future in self.pending:
            future.cancel()
        wait([future for future in self.pending if not future.cancelled()])


@contextmanager
def upload_window[ItemT](
    put: Callable[[ItemT], list[str]], size: int,
) -> Iterator[UploadWindow[ItemT]]:
    window = UploadWindow(put, size)
    try:
        yield window
        window.finish()
    finally:
        # Drain even when production, validation, submission or an upload fails.
        window.cancel_and_drain()


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
    def put(item: PutItem) -> list[str]:
        # The window owns scheduling; avoid submitting nested work to its pool.
        return put_batch(storage, [item], concurrency=1, write_mode=write_mode)

    with provider_executor(concurrency), upload_window(put, batch_size) as window:
        iterator = iter(items)
        while True:
            window.collect_completed()
            try:
                item = next(iterator)
            except StopIteration:
                break
            window.submit(item)
        return window.finish()
