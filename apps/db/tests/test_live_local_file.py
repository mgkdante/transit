import subprocess
import sys
from contextlib import closing
from dataclasses import replace
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import duckdb
import pytest
from history_fixtures import scripted_feed_day

from transit_ops.live.local_file import LocalFile, LocalFileLocked, LocalFileMismatch, connect_live
from transit_ops.live.settings import LaneSettings

AT = datetime(2026, 1, 2, 3, 4, 5, 123456, tzinfo=UTC)
SETTINGS = LaneSettings(duckdb_memory_limit_mb=64, duckdb_threads=1, temp_dir_max_mb=32)
RECORD, _ = scripted_feed_day()
POLL = replace(
    RECORD.polls[0],
    ingestion_run_id=1,
    capture_row_id=2,
    started_at_utc=AT,
    time_utc=AT,
    entity_count=None,
)
CAPTURE = replace(
    RECORD.captures[0],
    ingestion_run_id=1,
    capture_row_id=2,
    storage_path="é/车辆",
    entity_count=None,
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
        with conn.cursor() as cursor:
            assert cursor.execute("SELECT current_setting('TimeZone')").fetchone() == ("UTC",)
            assert cursor.execute(
                "SELECT epoch_us(TIMESTAMP '2026-01-02 03:04:05.123456'::TIMESTAMPTZ)"
            ).fetchone() == (1767323045123456,)


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
    with closing(opened(tmp_path / "worker.db")) as local:
        eastern = AT.astimezone(ZoneInfo("America/Toronto"))
        local.record_polls([replace(POLL, time_utc=eastern)], endpoint_key="vehicles")
        with local.transaction() as conn:
            value = conn.execute("SELECT time_utc FROM polls").fetchone()[0]
            assert value.isoformat() == "2026-01-02T03:04:05.123456"


def test_other_provider_or_schema_is_refused(tmp_path):
    path = tmp_path / "worker.db"
    opened(path).close()
    with pytest.raises(LocalFileMismatch):
        LocalFile.open(path, provider_id="other", settings=SETTINGS)
    with duckdb.connect(str(path)) as conn:
        conn.execute("UPDATE meta SET schema_version = 99")
    with pytest.raises(LocalFileMismatch):
        opened(path)


@pytest.mark.parametrize(
    "change",
    [
        "DROP TABLE meta",
        "DELETE FROM meta",
        "ALTER TABLE polls DROP COLUMN missing_reason",
        "ALTER TABLE captures ALTER byte_size TYPE VARCHAR",
    ],
)
def test_damaged_identity_or_shape_is_refused(tmp_path, change):
    path = tmp_path / "worker.db"
    with closing(opened(path)) as local:
        local.record_polls([POLL], endpoint_key="vehicles")
        local.connection.execute(change)
    with pytest.raises(LocalFileMismatch, match="meta|polls|captures"):
        opened(path)
    with duckdb.connect(str(path)) as conn:
        assert conn.execute("SELECT ingestion_run_id FROM polls").fetchall() == [(1,)]


def test_second_open_in_the_same_process_is_refused(tmp_path):
    path = tmp_path / "worker.db"
    with closing(opened(path)):
        for settings in (SETTINGS, SETTINGS.model_copy(update={"duckdb_memory_limit_mb": 32})):
            with pytest.raises(LocalFileLocked):
                LocalFile.open(
                    path.parent / "." / path.name, provider_id="network", settings=settings
                )
    opened(path).close()


def test_configuration_is_locked_and_spill_is_capped(tmp_path):
    settings = SETTINGS.model_copy(update={"duckdb_memory_limit_mb": 16, "temp_dir_max_mb": 1})
    with closing(
        LocalFile.open(tmp_path / "worker.db", provider_id="network", settings=settings)
    ) as local:
        conn = local.connection
        assert conn.execute(
            "SELECT current_setting('memory_limit'), current_setting('max_temp_directory_size')"
        ).fetchone() == ("15.2 MiB", "976.5 KiB")
        assert conn.execute("SELECT current_setting('temp_directory')").fetchone() == (
            str(tmp_path / "worker.tmp"),
        )
        for setting, value in (
            ("memory_limit", "'128MB'"),
            ("threads", "2"),
            ("temp_directory", "'changed'"),
            ("max_temp_directory_size", "'64MB'"),
            ("integer_division", "false"),
            ("TimeZone", "'America/Toronto'"),
        ):
            with pytest.raises(duckdb.Error):
                conn.execute(f"SET {setting}={value}")
        with pytest.raises(duckdb.OutOfMemoryException):
            conn.execute(
                "CREATE TEMP TABLE payload AS SELECT i, repeat(md5(i::VARCHAR), 8) AS payload "
                "FROM range(200000) t(i)"
            )
        assert conn.execute("SELECT 7 / 2").fetchone() == (3,)


def test_recording_is_idempotent_and_refuses_changed_rows(tmp_path):
    with closing(opened(tmp_path / "worker.db")) as local:
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


CHILD = """
import runpy, sys
from pathlib import Path
from transit_ops.live.local_file import LocalFileLocked
sys.path.insert(0, str(Path(sys.argv[1]).parent))
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
    tx = local.transaction()
    tx.__enter__()
    local.record_polls([ns['POLL']], endpoint_key='vehicles')
    local.record_captures([ns['CAPTURE']], endpoint_key='vehicles')
    if sys.argv[3] == 'committed':
        tx.__exit__(None, None, None)
    print('ready', flush=True)
    sys.stdin.read()
"""


def test_second_writer_is_refused(tmp_path):
    path = tmp_path / "worker.db"
    with closing(opened(path)):
        result = subprocess.run(
            [sys.executable, "-c", CHILD, __file__, str(path), "lock"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr


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
    with closing(opened(path)) as local:
        with local.transaction() as conn:
            return conn.execute(
                "SELECT p.ingestion_run_id, c.capture_row_id FROM polls p "
                "FULL JOIN captures c ON p.ingestion_run_id=c.ingestion_run_id"
            ).fetchall()


def test_committed_polls_survive_a_killed_process(tmp_path):
    assert killed_rows(tmp_path, "committed") == [(1, 2)]


def test_uncommitted_rows_are_gone_after_a_kill(tmp_path):
    assert killed_rows(tmp_path, "uncommitted") == []


def test_corrupt_file_is_typed_and_releases_ownership(tmp_path):
    from transit_ops.live.local_file import LocalFileUnreadable

    path = tmp_path / "worker.db"
    path.write_bytes(b"not a DuckDB file")
    with pytest.raises(LocalFileUnreadable, match="worker.db"):
        opened(path)
    assert path.read_bytes() == b"not a DuckDB file"
    path.unlink()
    opened(path).close()


def test_caught_nested_failure_aborts_the_outer_transaction(tmp_path):
    with closing(opened(tmp_path / "worker.db")) as local:
        with pytest.raises(RuntimeError, match="aborted"), local.transaction():
            local.record_polls([POLL], endpoint_key="vehicles")
            with pytest.raises(LocalFileMismatch):
                local.record_polls([replace(POLL, entity_count=0)], endpoint_key="vehicles")
        assert local.connection.execute("SELECT ingestion_run_id FROM polls").fetchall() == []


@pytest.mark.parametrize(
    "statement", ["INSERT INTO polls SELECT * FROM polls", "SELECT 'bad'::INT"]
)
def test_caught_engine_error_cannot_report_a_commit(tmp_path, statement):
    with closing(opened(tmp_path / "worker.db")) as local:
        with pytest.raises(duckdb.TransactionException, match="aborted"):
            with local.transaction() as conn:
                local.record_polls([POLL], endpoint_key="vehicles")
                with pytest.raises(duckdb.Error):
                    conn.execute(statement)
        assert local.connection.execute("SELECT ingestion_run_id FROM polls").fetchall() == []
        assert local.record_polls([POLL], endpoint_key="vehicles") == 1


@pytest.mark.parametrize("interrupted", [False, True])
def test_empty_database_after_first_open_can_initialize(tmp_path, interrupted):
    path = tmp_path / "worker.db"
    if interrupted:
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import duckdb, os, sys; c=duckdb.connect(sys.argv[1]); "
                "c.execute('BEGIN'); c.execute('CREATE TABLE meta (schema_version INTEGER)'); "
                "os._exit(17)",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 17, result.stderr
    else:
        duckdb.connect(str(path)).close()
    with closing(opened(path)) as local:
        assert local.record_polls([POLL], endpoint_key="vehicles") == 1
    with closing(opened(path)) as local:
        assert local.connection.execute("SELECT ingestion_run_id FROM polls").fetchall() == [(1,)]


@pytest.mark.parametrize("constraint", ["CHECK (ingestion_run_id < 100)", "UNIQUE (endpoint_key)"])
def test_constraint_drift_is_refused_without_changing_rows(tmp_path, constraint):
    path = tmp_path / "worker.db"
    with closing(opened(path)) as local:
        local.record_polls([POLL], endpoint_key="vehicles")
        conn = local.connection
        ddl = conn.execute("SELECT sql FROM duckdb_tables() WHERE table_name='polls'").fetchone()[0]
        conn.execute("CREATE TEMP TABLE retained AS SELECT * FROM polls")
        conn.execute("DROP TABLE polls")
        conn.execute(ddl.rstrip(";")[:-1] + ", " + constraint + ")")
        conn.execute("INSERT INTO polls SELECT * FROM retained")
    with pytest.raises(LocalFileMismatch, match="polls"):
        opened(path).close()
    with duckdb.connect(str(path)) as conn:
        assert conn.execute("SELECT ingestion_run_id FROM polls").fetchall() == [(1,)]
