"""Subprocess adapter for daily-run stages. No shell or GNU timeout dependency."""

from __future__ import annotations

import codecs
import os
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from contextlib import ExitStack
from types import FrameType, TracebackType
from typing import IO

from transit_ops.daily_run import Stage, StageResult


def _stop_tree(process: subprocess.Popen[bytes], *, force: bool) -> None:
    if sys.platform == "win32":
        # Windows has no SIGTERM process-group equivalent. taskkill owns descendants too.
        result = subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode and process.poll() is None:
            raise OSError("taskkill could not terminate the daily-run process tree")
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
        except ProcessLookupError:
            pass


def _spawn(stage: Stage, output: IO[bytes] | None, piped: bool) -> subprocess.Popen[bytes]:
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
    return subprocess.Popen(
        stage.argv,
        env={**os.environ, **stage.env},
        stdout=subprocess.PIPE if piped else output,
        stderr=subprocess.STDOUT if stage.merge_stderr else None,
        bufsize=0,
        start_new_session=sys.platform != "win32",
        creationflags=creationflags,
    )


class SubprocessRunner:
    """Own stage trees and job signal handlers for one main-thread CLI invocation."""

    def __init__(self) -> None:
        self._live: set[subprocess.Popen[bytes]] = set()
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._signal: int | None = None
        self._errors: list[OSError] = []
        self._previous: dict[int, Callable[[int, FrameType | None], object] | int | None] = {}
        self._watcher = threading.Thread(target=self._watch_cancellation)

    @property
    def cancel_exit_code(self) -> int:
        return 128 + self._signal if self._signal is not None else 0

    def _request_stop(self, signum: int, _frame: FrameType | None) -> None:
        # Do no locking or process I/O inside Python's main-thread signal handler.
        if self._signal is None:
            self._signal = signum
        self._wake.set()

    def _watch_cancellation(self) -> None:
        self._wake.wait()
        if self._signal is None:
            return
        with self._lock:
            processes = list(self._live)
        for force in (False, True):
            for process in processes:
                try:
                    _stop_tree(process, force=force)
                except OSError as exc:
                    self._errors.append(exc)
            if not force:
                # Finish cleanup before a CI runner's subsequent hard termination.
                time.sleep(1)

    def __enter__(self) -> SubprocessRunner:
        if threading.current_thread() is not threading.main_thread():
            raise RuntimeError("SubprocessRunner signal scope requires the main thread")
        for sig in (signal.SIGTERM, signal.SIGINT):
            self._previous[sig] = signal.signal(sig, self._request_stop)
        self._watcher.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if exc_type is not None:
            self._request_stop(signal.SIGTERM, None)
        self._wake.set()
        self._watcher.join()
        for sig, previous in self._previous.items():
            signal.signal(sig, previous)
        if self._errors:
            raise RuntimeError("Could not stop all daily-run stage trees") from self._errors[0]

    def _start(
        self, stage: Stage, output: IO[bytes] | None, piped: bool
    ) -> subprocess.Popen[bytes] | None:
        with self._lock:
            if self._signal is not None:
                return None
            process = _spawn(stage, output, piped)
            self._live.add(process)
            return process

    def __call__(self, stage: Stage) -> StageResult:
        if self.cancel_exit_code:
            return StageResult(self.cancel_exit_code)
        result = run_stage(stage, owner=self)
        return StageResult(self.cancel_exit_code) if self.cancel_exit_code else result


def run_stage(stage: Stage, *, owner: SubprocessRunner | None = None) -> StageResult:
    """Return command status, with log errors taking precedence as with the old tee pipe."""
    try:
        with ExitStack() as stack:
            output = (
                stack.enter_context(stage.output.open("ab" if stage.append else "wb"))
                if stage.output
                else None
            )
            piped = stage.capture or stage.tee
            process = owner._start(stage, output, piped) if owner else _spawn(stage, output, piped)
            if process is None:
                assert owner is not None
                return StageResult(owner.cancel_exit_code)
            log_errors = []
            captured = bytearray()

            def drain() -> None:
                assert process.stdout is not None
                decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
                try:
                    while chunk := process.stdout.read(65536):
                        if stage.capture:
                            captured.extend(chunk)
                        if output is not None:
                            try:
                                output.write(chunk)
                                output.flush()
                            except OSError as exc:
                                log_errors.append(exc)
                        if stage.tee:
                            try:
                                sys.stdout.write(decoder.decode(chunk))
                                sys.stdout.flush()
                            except OSError as exc:
                                log_errors.append(exc)
                    if stage.tee:
                        try:
                            sys.stdout.write(decoder.decode(b"", final=True))
                            sys.stdout.flush()
                        except OSError as exc:
                            log_errors.append(exc)
                finally:
                    process.stdout.close()

            reader = threading.Thread(target=drain) if piped else None
            if reader:
                reader.start()

            def wait_for_completion(budget: float | None) -> int:
                started = time.monotonic()
                code = process.wait(timeout=budget)
                if reader:
                    remaining = (
                        None if budget is None else max(0.0, budget - (time.monotonic() - started))
                    )
                    reader.join(timeout=remaining)
                    if reader.is_alive():
                        # A descendant can retain stdout after its parent exits on TERM.
                        assert budget is not None
                        raise subprocess.TimeoutExpired(stage.argv, budget)
                return code

            try:
                status = wait_for_completion(stage.timeout_seconds)
                status = status if status >= 0 else 128 - status
            except subprocess.TimeoutExpired:
                _stop_tree(process, force=False)
                status = 124
                try:
                    wait_for_completion(stage.kill_after_seconds)
                except subprocess.TimeoutExpired:
                    direct_child_needed_kill = process.poll() is None
                    _stop_tree(process, force=True)
                    wait_for_completion(None)
                    status = 137 if direct_child_needed_kill else 124
            finally:
                if reader:
                    reader.join()
                if owner:
                    with owner._lock:
                        owner._live.discard(process)
            if log_errors:
                print(f"Daily-run stage log failed: {log_errors[0]}", file=sys.stderr)
                status = 1
            return StageResult(
                status, captured.decode("utf-8", errors="replace").replace("\r\n", "\n")
            )
    except FileNotFoundError as exc:
        print(f"Daily-run stage unavailable: {exc}", file=sys.stderr)
        return StageResult(1 if stage.output and exc.filename == str(stage.output) else 127)
    except PermissionError as exc:
        print(f"Daily-run stage permission failure: {exc}", file=sys.stderr)
        return StageResult(1 if stage.output else 126)
    except OSError as exc:
        print(f"Daily-run stage failed: {exc}", file=sys.stderr)
        return StageResult(1)
