"""One process-wide native timer owned by the realtime worker entrypoint.

faulthandler writes locations only, then _exit(1), bypassing executor joins.
Its `Timeout (...)!` line is the stuck-exit marker. No Python logging callback
can reliably run when native code holds the GIL. Keep stderr open and draining.
"""
from __future__ import annotations

import faulthandler
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class _Watchdog:
    timeout: float
    shutdown_grace: float
    stopping: bool = False

    def progress(self, sleep_seconds: float = 0) -> None:
        if not self.stopping:
            faulthandler.dump_traceback_later(self.timeout + sleep_seconds, file=2, exit=True)

    def stop(self) -> None:
        if not self.stopping:
            self.stopping = True
            faulthandler.dump_traceback_later(self.shutdown_grace, file=2, exit=True)


_ACTIVE: ContextVar[_Watchdog | None] = ContextVar("worker_watchdog", default=None)


def worker_progress(*, sleep_seconds: float = 0) -> None:
    if watchdog := _ACTIVE.get():
        watchdog.progress(sleep_seconds)


def worker_stopping() -> None:
    if watchdog := _ACTIVE.get():
        watchdog.stop()


@contextmanager
def worker_watchdog(*, timeout: float, shutdown_grace: float) -> Iterator[None]:
    if _ACTIVE.get() is not None:
        yield
        return
    watchdog = _Watchdog(timeout, shutdown_grace)
    token = _ACTIVE.set(watchdog)
    try:
        watchdog.progress()
        yield
    finally:
        faulthandler.cancel_dump_traceback_later()
        _ACTIVE.reset(token)
