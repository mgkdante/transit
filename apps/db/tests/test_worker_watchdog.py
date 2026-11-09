"""Process tests use real native waits, never a production worker or network."""
import os
import subprocess
import sys
import textwrap

import pytest

from transit_ops.settings import Settings


@pytest.mark.parametrize("key,value", [
    ("REALTIME_WATCHDOG_SECONDS", 0), ("REALTIME_WATCHDOG_SECONDS", -1),
    ("REALTIME_WATCHDOG_SECONDS", "nan"),
    ("REALTIME_SHUTDOWN_GRACE_SECONDS", 180), ("REALTIME_SHUTDOWN_GRACE_SECONDS", 0),
])
def test_reject_invalid_watchdog_settings(key, value):
    with pytest.raises(ValueError):
        Settings(_env_file=None, **{key: value})


LOOP_SETUP = '''
import threading, time
from types import SimpleNamespace
import transit_ops.orchestration as orch
from transit_ops.settings import Settings
from transit_ops.worker_watchdog import worker_watchdog
settings = Settings(_env_file=None, REALTIME_POLL_SECONDS=1)
orch._validate_realtime_worker_startup = lambda *a, **k: SimpleNamespace(
    provider=SimpleNamespace(provider_id="test", display_name="Test"))
'''


def test_worker_failed_cycles_are_progress():
    result = run_child(LOOP_SETUP + '''
def fail(*a, **k):
    raise RuntimeError("feed unavailable")
orch._run_realtime_cycle = fail
with worker_watchdog(timeout=0.4, shutdown_grace=0.2):
    orch.run_realtime_worker_loop("test", settings=settings, engine=object(),
        registry=object(), max_cycles=4)
''')
    assert result.returncode == 0, result.stderr


def test_worker_cycle_native_stall_exits():
    result = run_child(LOOP_SETUP + '''
def stalled_cycle(*a, **k):
    threading.Event().wait()
orch._run_realtime_cycle = stalled_cycle
with worker_watchdog(timeout=0.4, shutdown_grace=0.2):
    orch.run_realtime_worker_loop("test", settings=settings, engine=object(),
        registry=object())
''')
    assert result.returncode == 1
    assert "Timeout" in result.stderr
    assert "in stalled_cycle" in result.stderr


def test_healthy_133_second_cycle_is_within_default_budget():
    # Virtual cycle timing verifies the measured long cycle remains accepted;
    # the separate process tests exercise the native timer with scaled deadlines.
    result = run_child(LOOP_SETUP + '''
from datetime import UTC, datetime
times = iter([0, 133])
orch._run_realtime_cycle = lambda *a, **k: SimpleNamespace(
    status="ok", has_failures=False, display_dict=lambda: {})
orch.run_realtime_worker_loop("test", settings=settings, engine=object(),
    registry=object(), max_cycles=1, perf_counter_fn=lambda: next(times),
    utc_now_fn=lambda: datetime.now(UTC))
''')
    assert result.returncode == 0, result.stderr


def run_child(body, timeout=10):
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(body)],
        capture_output=True, text=True, timeout=timeout,
    )


def test_native_wait_exits_with_all_thread_stacks():
    result = run_child('''
        import threading
        from transit_ops.worker_watchdog import worker_watchdog
        def upload_stall():
            threading.Event().wait()
        with worker_watchdog(timeout=0.3, shutdown_grace=0.2):
            threading.Thread(target=upload_stall).start()
            upload_stall()
    ''')
    assert result.returncode == 1
    assert "Timeout" in result.stderr
    assert result.stderr.count("in upload_stall") == 2


@pytest.mark.skipif(os.name == "nt", reason="libc native wait, exercised on Linux CI")
def test_native_code_holding_gil_cannot_defeat_watchdog():
    result = run_child('''
        import ctypes
        from transit_ops.worker_watchdog import worker_watchdog
        libc = ctypes.PyDLL(None)  # PyDLL retains the GIL through the call.
        with worker_watchdog(timeout=0.3, shutdown_grace=0.2):
            libc.sleep(30)
    ''', timeout=5)
    assert result.returncode == 1
    assert "Timeout" in result.stderr


def test_healthy_long_cycle_survives_real_timer():
    result = run_child(LOOP_SETUP + '''
from datetime import UTC, datetime
def slow_cycle(*a, **k):
    time.sleep(0.45)  # 75 percent of the test budget, well above poll cadence.
    return SimpleNamespace(status="ok", has_failures=False, display_dict=lambda: {})
orch._run_realtime_cycle = slow_cycle
with worker_watchdog(timeout=0.6, shutdown_grace=0.2):
    orch.run_realtime_worker_loop("test", settings=settings, engine=object(),
        registry=object(), max_cycles=3)
''')
    assert result.returncode == 0, result.stderr


@pytest.mark.skipif(os.name == "nt", reason="POSIX SIGTERM delivery, exercised on Linux CI")
def test_sigterm_finishes_healthy_cycle():
    result = run_child(LOOP_SETUP + '''
import os, signal
def slow_cycle(*a, **k):
    threading.Timer(0.05, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()
    time.sleep(0.15)
    print("cycle-finished", flush=True)
    return SimpleNamespace(status="ok", has_failures=False, display_dict=lambda: {})
orch._run_realtime_cycle = slow_cycle
stop = orch._install_worker_shutdown_handlers()
with worker_watchdog(timeout=2, shutdown_grace=0.5):
    orch.run_realtime_worker_loop("test", settings=settings, engine=object(),
        registry=object(), should_shutdown=stop, sleep_fn=lambda _: None)
''')
    assert result.returncode == 0, result.stderr
    assert result.stdout.count("cycle-finished") == 1


@pytest.mark.skipif(os.name == "nt", reason="POSIX SIGTERM delivery, exercised on Linux CI")
def test_sigterm_during_stall_dumps_before_stop_deadline():
    result = run_child('''
        import os, signal, threading
        from transit_ops.orchestration import _install_worker_shutdown_handlers
        from transit_ops.worker_watchdog import worker_watchdog
        stop = _install_worker_shutdown_handlers()
        with worker_watchdog(timeout=30, shutdown_grace=0.2):
            threading.Timer(0.2, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()
            threading.Event().wait()
    ''', timeout=5)
    assert result.returncode == 1
    assert "Timeout" in result.stderr


def test_progress_and_intentional_sleep_survive_then_cancel():
    result = run_child('''
        import time
        from transit_ops.worker_watchdog import worker_watchdog, worker_progress
        with worker_watchdog(timeout=0.3, shutdown_grace=0.2):
            for _ in range(4):
                worker_progress(sleep_seconds=0.4)
                time.sleep(0.4)
                worker_progress()
                time.sleep(0.15)
        time.sleep(0.4)
    ''')
    assert result.returncode == 0, result.stderr


def test_worker_cleanup_stall_is_still_guarded():
    result = run_child(LOOP_SETUP + '''
class Scope:
    def __init__(self, *a, **k): pass
    def resolve(self, *a, **k): pass
    def close(self): threading.Event().wait()
orch.BronzeStorageScope = Scope
with worker_watchdog(timeout=0.4, shutdown_grace=0.2):
    orch.run_realtime_worker_loop("test", settings=settings, engine=object(),
        registry=object(), should_shutdown=lambda: True)
''')
    assert result.returncode == 1
    assert "Timeout" in result.stderr
    assert "in close" in result.stderr


@pytest.mark.skipif(os.name == "nt", reason="POSIX SIGTERM delivery, exercised on Linux CI")
def test_stop_during_start_recording_prevents_cycle():
    result = run_child('''
        import os, signal, threading, time
        import transit_ops.cli as cli
        from transit_ops.settings import Settings
        from transit_ops.worker_watchdog import worker_watchdog
        cli.get_settings = lambda: Settings(_env_file=None)
        def record(*a):
            os.kill(os.getpid(), signal.SIGTERM)
            time.sleep(0.1)
        cli.observe_start = record
        def unexpected(*a, **k):
            raise AssertionError("cycle started after stop")
        cli.run_realtime_worker_loop = unexpected
        with worker_watchdog(timeout=2, shutdown_grace=0.5):
            cli.run_realtime_worker_command("test", max_cycles=None)
    ''')
    assert result.returncode == 0, result.stderr


def test_only_worker_engine_has_connect_deadline(monkeypatch):
    from transit_ops.db import connection

    calls = []
    monkeypatch.setattr(connection, "create_engine", lambda *a, **k: calls.append(k))
    settings = Settings(_env_file=None, DATABASE_URL="postgresql://localhost/test")
    connection.make_engine(settings, connect_timeout=10)
    connection.make_engine(settings)
    assert calls[0]["connect_args"]["connect_timeout"] == 10
    assert "connect_timeout" not in calls[1]["connect_args"]
    assert "options" not in calls[0]["connect_args"]
