import subprocess
import sys
from dataclasses import replace
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import duckdb
import pytest

from transit_ops.history.poll_record import CaptureEntry, PollEntry
from transit_ops.live.local_file import LocalFile, LocalFileMismatch, connect_live
from transit_ops.live.settings import LaneSettings

AT = datetime(2026, 1, 2, 3, 4, 5, 123456, tzinfo=UTC)
SETTINGS = LaneSettings(duckdb_memory_limit_mb=64, duckdb_threads=1, temp_dir_max_mb=32)
POLL = PollEntry(
    1,
    "capture",
    "stored",
    None,
    None,
    AT,
    AT,
    AT,
    200,
    None,
    AT,
    "header",
    None,
    "realtime_snapshot",
    2,
    None,
    None,
)
CAPTURE = CaptureEntry(
    "realtime_snapshot",
    2,
    1,
    3,
    False,
    None,
    None,
    7,
    "a" * 64,
    "local",
    "é/车辆",
    "feed",
    None,
    AT,
    AT,
    AT,
    AT,
    "header",
    None,
    200,
    None,
    None,
)


def opened(path):
    return LocalFile.open(path, provider_id="network", settings=SETTINGS)


def test_semantic_settings_match_the_batch_session(tmp_path):
    with connect_live(
        None, temp_directory=tmp_path, memory_limit_mb=64, threads=1, temp_max_mb=32
    ) as conn:
        assert conn.execute("SELECT 7 / 2").fetchone() == (3,)
        assert conn.execute("SELECT x FROM (VALUES (NULL), (1)) t(x) ORDER BY x").fetchall() == [
            (1,),
            (None,),
        ]
        assert conn.execute(
            "SELECT x FROM (VALUES (NULL), (1)) t(x) ORDER BY x DESC"
        ).fetchall() == [(None,), (1,)]
        assert conn.execute(
            "SELECT current_setting('TimeZone'), current_setting('threads'), "
            "current_setting('preserve_insertion_order'), "
            "current_setting('autoinstall_known_extensions'), "
            "current_setting('autoload_known_extensions')"
        ).fetchone() == ("UTC", 1, True, False, False)


def test_missing_resource_settings_are_refused(tmp_path):
    assert LaneSettings().local_dir is None
    for field in ("duckdb_memory_limit_mb", "duckdb_threads", "temp_dir_max_mb"):
        with pytest.raises(ValueError):
            LocalFile.open(
                tmp_path / "missing.db",
                provider_id="network",
                settings=SETTINGS.model_copy(update={field: None}),
            )
    for value in (None, 0, -1):
        with pytest.raises(ValueError):
            connect_live(
                None, temp_directory=tmp_path, memory_limit_mb=value, threads=1, temp_max_mb=32
            )


def test_non_utc_timestamp_round_trips_as_utc(tmp_path):
    local = opened(tmp_path / "worker.db")
    try:
        eastern = AT.astimezone(ZoneInfo("America/Toronto"))
        local.record_polls([replace(POLL, time_utc=eastern)], endpoint_key="vehicles")
        with local.transaction() as conn:
            value = conn.execute("SELECT time_utc FROM polls").fetchone()[0]
            assert value.isoformat() == "2026-01-02T03:04:05.123456"
    finally:
        local.close()


def test_other_provider_or_schema_is_refused(tmp_path):
    path = tmp_path / "worker.db"
    opened(path).close()
    with pytest.raises(LocalFileMismatch):
        LocalFile.open(path, provider_id="other", settings=SETTINGS)
    with duckdb.connect(str(path)) as conn:
        conn.execute("UPDATE meta SET schema_version = 99")
    with pytest.raises(LocalFileMismatch):
        opened(path)


def test_recording_is_idempotent_and_refuses_changed_rows(tmp_path):
    local = opened(tmp_path / "worker.db")
    try:
        for record, entry, table in (
            (local.record_polls, POLL, "polls"),
            (local.record_captures, CAPTURE, "captures"),
        ):
            assert record([entry], endpoint_key="vehicles") == 1
            assert record([entry], endpoint_key="vehicles") == 0
            with pytest.raises(LocalFileMismatch, match="realtime_snapshot"):
                record([replace(entry, entity_count=0)], endpoint_key="vehicles")
            with pytest.raises(LocalFileMismatch):
                record([entry], endpoint_key="other")
            with local.transaction() as conn:
                assert conn.execute(
                    f"SELECT entity_count, segment_seq FROM {table}"
                ).fetchall() == [(None, None)]
        with pytest.raises(RuntimeError), local.transaction() as conn:
            conn.execute("DELETE FROM polls")
            raise RuntimeError("roll back")
        with local.transaction() as conn:
            assert conn.execute("SELECT started_at_utc FROM polls").fetchall() == [
                (AT.replace(tzinfo=None),)
            ]
            assert conn.execute("SELECT storage_path FROM captures").fetchall() == [("é/车辆",)]
    finally:
        local.close()


CHILD = """
import runpy, sys
from pathlib import Path
from transit_ops.live.local_file import LocalFileLocked
ns = runpy.run_path(sys.argv[1])
if sys.argv[3] == 'lock':
    try:
        ns['opened'](Path(sys.argv[2]))
    except LocalFileLocked as exc:
        assert type(exc.__cause__).__name__ == 'IOException', repr(exc.__cause__)
    else:
        raise AssertionError('second writer admitted')
else:
    local = ns['opened'](Path(sys.argv[2]))
    if sys.argv[3] == 'uncommitted':
        tx = local.transaction()
        conn = tx.__enter__()
        conn.execute("INSERT INTO polls (index_family, ingestion_run_id, endpoint_key) "
                     "VALUES ('realtime_snapshot', 1, 'vehicles')")
    else:
        local.record_polls([ns['POLL']], endpoint_key='vehicles')
    print('ready', flush=True)
    sys.stdin.read()
"""


def test_second_writer_is_refused(tmp_path):
    path = tmp_path / "worker.db"
    local = opened(path)
    try:
        result = subprocess.run(
            [sys.executable, "-c", CHILD, __file__, str(path), "lock"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
    finally:
        local.close()


def killed_rows(tmp_path, mode):
    path = tmp_path / "worker.db"
    opened(path).close()
    child = subprocess.Popen(
        [sys.executable, "-c", CHILD, __file__, str(path), mode],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert child.stdout.readline().strip() == "ready"
    finally:
        child.kill()
        child.communicate(timeout=30)
    local = opened(path)
    try:
        with local.transaction() as conn:
            return conn.execute(
                "SELECT ingestion_run_id, entity_count, time_utc FROM polls"
            ).fetchall()
    finally:
        local.close()


def test_committed_polls_survive_a_killed_process(tmp_path):
    assert killed_rows(tmp_path, "committed") == [(1, None, AT.replace(tzinfo=None))]


def test_uncommitted_rows_are_gone_after_a_kill(tmp_path):
    assert killed_rows(tmp_path, "uncommitted") == []
