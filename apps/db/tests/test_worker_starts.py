from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine

from transit_ops import worker_starts as starts


def test_missing_table_record_fails_without_exception_text(caplog):
    engine = create_engine("sqlite://")
    assert starts.record(engine, "stm") is False
    assert "startup observation unavailable" in caplog.text
    assert "INSERT" not in caplog.text


@pytest.mark.parametrize("error", [PermissionError("secret"), OSError("secret")])
def test_recorder_failure_is_best_effort(error, monkeypatch, caplog):
    monkeypatch.setattr(starts.subprocess, "Popen", Mock(side_effect=error))
    starts.observe_start("stm")
    assert caplog.text.count("startup observation unavailable") == 1
    assert "secret" not in caplog.text


def test_observe_start_uses_five_second_feed_wait(monkeypatch):
    observe = Mock()
    monkeypatch.setattr(starts, "_observe_command", observe)
    starts.observe_start("stm")
    assert observe.call_args.kwargs["wait_seconds"] == 5


def test_cli_cycles_continue_after_missing_table(monkeypatch, caplog):
    from transit_ops import cli

    engine = create_engine("sqlite://")
    monkeypatch.setattr(starts.subprocess, "Popen", Mock(side_effect=OSError("fixture failure")))
    observed = Mock(wraps=starts.observe_start)
    monkeypatch.setattr(cli, "observe_start", observed)
    monkeypatch.setattr(cli, "_provider_registry", Mock())
    monkeypatch.setattr(cli, "_install_worker_shutdown_handlers", lambda: lambda: False)
    cycle = Mock()
    monkeypatch.setattr(cli, "run_realtime_worker_loop", cycle)
    assert starts.record(engine, "stm") is False
    cli.run_realtime_worker_command("stm", max_cycles=2)
    observed.assert_called_once_with("stm")
    cycle.assert_called_once()


def test_stop_during_recording_skips_loop(monkeypatch):
    import threading

    from transit_ops import cli

    stop = threading.Event()
    monkeypatch.setattr(cli, "_install_worker_shutdown_handlers", lambda: stop.is_set)
    monkeypatch.setattr(cli, "observe_start", lambda _: stop.set())
    loop = Mock()
    monkeypatch.setattr(cli, "run_realtime_worker_loop", loop)
    cli.run_realtime_worker_command("stm", max_cycles=1)
    loop.assert_not_called()


def test_real_db_counter_is_bounded_and_missing_table_is_safe(real_db_engine, seed_provider):
    from contextlib import nullcontext

    from sqlalchemy import text

    with real_db_engine.connect() as conn:
        transaction = conn.begin()
        try:
            seed_provider(conn, "worker_start_test", display_name="Test")
            # record() needs the connection returned by a transaction context.
            class EngineView:
                def begin(self):
                    return nullcontext(conn)

            for _ in range(50):
                assert starts.record(EngineView(), "worker_start_test")
            row = conn.execute(text("SELECT start_count FROM core.worker_starts "
                                    "WHERE provider_id = 'worker_start_test'" )).all()
            assert row == [(50,)]
            with conn.begin_nested() as savepoint:
                conn.execute(text("DROP TABLE core.worker_starts"))
                # Catch the failed INSERT inside its own savepoint so outer test survives.
                with conn.begin_nested() as failed:
                    assert not starts.record(EngineView(), "worker_start_test")
                    failed.rollback()
                savepoint.rollback()
        finally:
            transaction.rollback()


def test_real_db_migration_explicit_grants_and_transactional_retry(real_db_engine, monkeypatch):
    from importlib import import_module

    from sqlalchemy import text

    migration = import_module("transit_ops.db.migrations.versions.0094_worker_starts")
    with real_db_engine.connect() as conn, conn.begin():
        with conn.begin_nested() as checkpoint:
            for role in ("transit_app", "transit-db"):
                if not conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname=:role"),
                                    {"role": role}).scalar():
                    conn.exec_driver_sql(f'CREATE ROLE "{role}"')
            conn.exec_driver_sql("DROP TABLE core.worker_starts")
            monkeypatch.setattr(migration.op, "execute", conn.exec_driver_sql)
            # Simulate an interrupted migration. All DDL/grants roll back.
            with conn.begin_nested() as failed:
                migration.upgrade()
                failed.rollback()
            assert conn.execute(text("SELECT to_regclass('core.worker_starts')")).scalar() is None
            migration.upgrade()
            assert conn.exec_driver_sql("SHOW lock_timeout").scalar() == "2s"
            assert conn.exec_driver_sql("SHOW statement_timeout").scalar() == "15s"
            assert conn.execute(text("SELECT count(*) FROM pg_constraint "
                                     "WHERE conrelid = 'core.worker_starts'::regclass "
                                     "AND contype = 'f'")).scalar() == 0
            for role, privileges in (("transit_app", "SELECT,INSERT,UPDATE"),
                                     ("transit-db", "SELECT")):
                assert conn.execute(text("SELECT has_table_privilege(:role, "
                                         "'core.worker_starts', :privileges)"),
                                    {"role": role, "privileges": privileges}).scalar()
            assert not conn.execute(text("SELECT has_table_privilege('transit-db', "
                                         "'core.worker_starts', 'INSERT')")).scalar()
            checkpoint.rollback()


def test_migration_sets_its_own_short_timeouts_before_ddl(monkeypatch):
    from importlib import import_module

    migration = import_module("transit_ops.db.migrations.versions.0094_worker_starts")
    execute = Mock()
    monkeypatch.setattr(migration.op, "execute", execute)
    migration.upgrade()
    assert execute.call_args_list[0].args == ("SET LOCAL lock_timeout = '2s'",)
    assert execute.call_args_list[1].args == ("SET LOCAL statement_timeout = '15s'",)


def test_image_import_smoke_needs_no_network_or_worker_cycle():
    import subprocess
    import sys

    smoke = """
import socket
def forbidden(*args, **kwargs):
    raise AssertionError('Network attempted during import')
socket.socket.connect = forbidden
socket.getaddrinfo = forbidden
import transit_ops.cli as cli
from transit_ops.worker_starts import observe_start, record
assert cli.observe_start is observe_start
assert callable(record)
"""
    result = subprocess.run([sys.executable, "-c", smoke], capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr.decode()


def test_real_stalled_child_does_not_hold_feed_path(monkeypatch, tmp_path, caplog):
    import subprocess
    import sys
    import time

    ready = tmp_path / "recorder-ready"
    actual_popen = subprocess.Popen
    children = []

    def launch(_command, **kwargs):
        child = actual_popen([sys.executable, "-c",
                              "import pathlib,sys,time; pathlib.Path(sys.argv[1]).touch(); "
                              "time.sleep(60)", str(ready)], **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(starts.subprocess, "Popen", launch)
    started = time.monotonic()
    try:
        starts.observe_start("stm")
        elapsed = time.monotonic() - started
        assert ready.exists(), "real recorder child did not start"
        assert 4.5 <= elapsed < 6.5
        assert caplog.text.count("startup observation unavailable") == 1
        children[0].wait(timeout=3)
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=3)


def test_feed_deadline_does_not_wait_for_stalled_process_creation(monkeypatch):
    import subprocess
    import sys
    import threading
    import time

    gate = threading.Event()
    reaped = threading.Event()
    actual_popen = subprocess.Popen

    def delayed_launch(_command, **kwargs):
        gate.wait(3)
        child = actual_popen([sys.executable, "-c", "import time; time.sleep(60)"], **kwargs)
        actual_wait = child.wait

        def wait(*args, **kwargs):
            result = actual_wait(*args, **kwargs)
            reaped.set()
            return result

        child.wait = wait
        return child

    monkeypatch.setattr(starts.subprocess, "Popen", delayed_launch)
    started = time.monotonic()
    try:
        starts._observe_command([sys.executable], wait_seconds=0.15)
        assert time.monotonic() - started < 0.8
    finally:
        gate.set()
        assert reaped.wait(5), "recorder owner did not reap its late-created child"


def test_feed_deadline_does_not_wait_for_stalled_reaping(monkeypatch):
    import subprocess
    import sys
    import threading
    import time

    release_reap = threading.Event()
    reaped = threading.Event()
    actual_popen = subprocess.Popen

    def launch(_command, **kwargs):
        child = actual_popen([sys.executable, "-c", "import time; time.sleep(60)"], **kwargs)
        actual_wait = child.wait

        def wait(*args, **kwargs):
            if kwargs.get("timeout") is None:
                release_reap.wait(3)
            result = actual_wait(*args, **kwargs)
            reaped.set()
            return result

        child.wait = wait
        return child

    monkeypatch.setattr(starts.subprocess, "Popen", launch)
    started = time.monotonic()
    try:
        starts._observe_command([sys.executable], wait_seconds=0.15)
        assert time.monotonic() - started < 0.8
    finally:
        release_reap.set()
        assert reaped.wait(5), "recorder owner did not finish reaping"


@pytest.mark.skipif(__import__("os").name == "nt", reason="POSIX SIGTERM requires hosted Linux")
def test_sigterm_during_recording_prevents_first_cycle_in_real_process(tmp_path):
    import os
    import signal
    import subprocess
    import sys
    import time

    ready = tmp_path / "recording"
    cycled = tmp_path / "cycle-started"
    script = """
import pathlib, signal, subprocess, sys
from transit_ops import cli
from transit_ops.settings import Settings
ready, cycled = map(pathlib.Path, sys.argv[1:])
# Emulate the ignored disposition at the PID-1 boundary without running Docker.
signal.signal(signal.SIGTERM, signal.SIG_IGN)
cli.get_settings = lambda: Settings(_env_file=None)
cli._provider_registry = lambda _: object()
def recording(_):
    ready.touch()
    try:
        subprocess.run([sys.executable, '-c', 'import time; time.sleep(60)'], timeout=1)
    except subprocess.TimeoutExpired:
        pass
cli.observe_start = recording
cli.run_realtime_worker_loop = lambda *args, **kwargs: cycled.touch()
cli.run_realtime_worker_command('stm', max_cycles=1)
"""
    child = subprocess.Popen([sys.executable, "-c", script, str(ready), str(cycled)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline and child.poll() is None:
            time.sleep(0.02)
        assert ready.exists(), "worker did not reach recording boundary"
        os.kill(child.pid, signal.SIGTERM)
        _, errors = child.communicate(timeout=5)
        assert child.returncode == 0, errors.decode()
        assert not cycled.exists()
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=3)


def test_recorder_engine_uses_single_statement_autocommit(monkeypatch):
    factory = Mock()
    monkeypatch.setattr(starts, "create_engine", factory)
    starts.recorder_engine("postgresql://fixture.invalid/test")
    assert factory.call_args.kwargs["isolation_level"] == "AUTOCOMMIT"


def test_real_db_abandoned_autocommit_session_allows_later_start(real_db_engine):
    from contextlib import nullcontext
    from uuid import uuid4

    from sqlalchemy import text

    provider = "abandoned_" + uuid4().hex[:12]
    recorder = starts.recorder_engine(real_db_engine.url)
    try:
        # Leave this connection open without a client COMMIT after its UPSERT.
        with recorder.connect() as abandoned:
            class AbandonedRecorder:
                def begin(self):
                    return nullcontext(abandoned)

            assert starts.record(AbandonedRecorder(), provider)
            pid = abandoned.exec_driver_sql("SELECT pg_backend_pid()").scalar()
            with real_db_engine.connect() as check:
                row = check.execute(text("SELECT state, xact_start FROM pg_stat_activity "
                                         "WHERE pid = :pid"), {"pid": pid}).one()
                assert row.state == "idle" and row.xact_start is None
            assert starts.record(recorder, provider)
            assert abandoned.execute(text("SELECT start_count FROM core.worker_starts "
                                          "WHERE provider_id=:provider"),
                                     {"provider": provider}).scalar() == 2
    finally:
        with real_db_engine.begin() as cleanup:
            cleanup.execute(text("DELETE FROM core.worker_starts WHERE provider_id=:provider"),
                            {"provider": provider})
        recorder.dispose()
