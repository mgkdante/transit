"""Subprocess adapter for daily-run stages. No shell or GNU timeout dependency."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
from contextlib import ExitStack

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


def run_stage(stage: Stage) -> StageResult:
    """Return command status, with log errors taking precedence as with the old tee pipe."""
    try:
        with ExitStack() as stack:
            output = (
                stack.enter_context(stage.output.open("ab" if stage.append else "wb"))
                if stage.output
                else None
            )
            piped = stage.capture or stage.tee
            creationflags = 0
            if sys.platform == "win32":
                creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
            process = subprocess.Popen(
                stage.argv,
                env={**os.environ, **stage.env},
                stdout=subprocess.PIPE if piped else output,
                stderr=subprocess.STDOUT if stage.merge_stderr else None,
                bufsize=0,
                start_new_session=sys.platform != "win32",
                creationflags=creationflags,
            )
            log_errors = []
            captured = bytearray()

            def drain() -> None:
                assert process.stdout is not None
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
                                sys.stdout.write(chunk.decode("utf-8", errors="replace"))
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
                    _stop_tree(process, force=True)
                    wait_for_completion(None)
                    status = 137
            finally:
                if reader:
                    reader.join()
            if log_errors:
                print(f"Daily-run stage log failed: {log_errors[0]}", file=sys.stderr)
                status = 1
            return StageResult(status, captured.decode("utf-8").replace("\r\n", "\n"))
    except FileNotFoundError as exc:
        print(f"Daily-run stage unavailable: {exc}", file=sys.stderr)
        return StageResult(1 if stage.output and exc.filename == str(stage.output) else 127)
    except PermissionError as exc:
        print(f"Daily-run stage permission failure: {exc}", file=sys.stderr)
        return StageResult(1 if stage.output else 126)
    except OSError as exc:
        print(f"Daily-run stage failed: {exc}", file=sys.stderr)
        return StageResult(1)
