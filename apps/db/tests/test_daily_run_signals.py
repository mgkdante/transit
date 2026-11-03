"""Cancellation must stop detached stage trees before the job process returns."""

import os
import signal
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from transit_ops.daily_run import Stage
from transit_ops.daily_run_process import SubprocessRunner


def test_cancel_scope_prevents_later_stages_and_restores_handlers(tmp_path):
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    marker = tmp_path / "must-not-start"
    with SubprocessRunner() as runner:
        handler = signal.getsignal(signal.SIGTERM)
        assert callable(handler)
        handler(signal.SIGTERM, None)
        result = runner(Stage((sys.executable, "-c", f"open({str(marker)!r},'w').close()")))
        assert result.exit_code == 143
    assert not marker.exists()
    assert {sig: signal.getsignal(sig) for sig in previous} == previous


def test_cancel_scope_drains_parallel_live_stages(tmp_path):
    markers = [tmp_path / str(index) for index in range(2)]
    with SubprocessRunner() as runner, ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(
                runner,
                Stage(
                    (
                        sys.executable,
                        "-c",
                        f"import time; open({str(marker)!r},'w').close(); time.sleep(30)",
                    )
                ),
            )
            for marker in markers
        ]
        handler = signal.getsignal(signal.SIGTERM)
        assert callable(handler)
        try:
            deadline = time.monotonic() + 6
            while not all(marker.exists() for marker in markers) and time.monotonic() < deadline:
                time.sleep(0.02)
            assert all(marker.exists() for marker in markers)
        finally:
            handler(signal.SIGTERM, None)
        assert [future.result(timeout=4).exit_code for future in futures] == [143, 143]


@pytest.mark.skipif(os.name == "nt", reason="POSIX job cancellation signals")
@pytest.mark.parametrize("cancel_signal", [signal.SIGTERM, signal.SIGINT])
def test_parent_cancellation_stops_stage_and_descendant_writers(tmp_path, cancel_signal):
    writes = tmp_path / "writes"
    stage_pid = tmp_path / "stage.pid"
    later = tmp_path / "later-stage"
    descendant = f"""import signal,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
with open({str(writes)!r},'ab',buffering=0) as stream:
    while True:
        stream.write(b'x')
        time.sleep(.01)
"""
    stage = f"""import os,signal,subprocess,sys,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
open({str(stage_pid)!r},'w').write(str(os.getpid()))
subprocess.Popen([sys.executable,'-c',{descendant!r}])
time.sleep(30)
"""
    next_stage = f"open({str(later)!r},'w').close()"
    controller = f"""import sys
from transit_ops.daily_run import Stage
from transit_ops.daily_run_process import SubprocessRunner
with SubprocessRunner() as runner:
    result=runner(Stage((sys.executable,'-c',{stage!r})))
    runner(Stage((sys.executable,'-c',{next_stage!r})))
sys.exit(runner.cancel_exit_code or result.exit_code)
"""
    process = subprocess.Popen(
        [sys.executable, "-c", controller],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        deadline = time.monotonic() + 6
        while not writes.exists() and time.monotonic() < deadline and process.poll() is None:
            time.sleep(0.02)
        assert writes.exists(), process.communicate(timeout=1)
        process.send_signal(cancel_signal)
        stdout, stderr = process.communicate(timeout=8)
        assert process.returncode == 128 + cancel_signal, (stdout, stderr)
        assert not later.exists()
        size = writes.stat().st_size
        time.sleep(0.15)
        assert writes.stat().st_size == size, "descendant kept writing after cancellation"
    finally:
        if stage_pid.exists():
            try:
                os.killpg(int(stage_pid.read_text()), signal.SIGKILL)
            except ProcessLookupError:
                pass
        if process.poll() is None:
            process.kill()
        process.wait(timeout=3)
