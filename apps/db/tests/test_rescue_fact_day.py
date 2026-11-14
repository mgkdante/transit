import gzip
import importlib.util
import io
import json
import os
import signal
import sqlite3
import sys
import threading
from contextlib import contextmanager
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text

from transit_ops.ingestion.storage import LocalBronzeStorage, ObjectAlreadyExists

SCRIPT = Path(__file__).parents[1] / "scripts/rescue_fact_day.py"
spec = importlib.util.spec_from_file_location("rescue", SCRIPT)
rescue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rescue)
NOW = datetime(2026, 11, 13, 23, tzinfo=UTC)


def copy_to(connection, path, table=None, provider="sample", start=NOW, end=NOW):
    return rescue.copy_fact_table(
        connection,
        table=table or next(iter(rescue.SCHEMAS)),
        provider_id=provider,
        start_utc=start,
        end_utc=end,
        destination=path,
    )


def args(tmp_path, *extra):
    defaults = dict(
        provider="sample",
        date="2026-11-01",
        spool_dir=str(tmp_path),
        not_after="2026-11-14T05:45:00Z",
        statement_timeout_s=60,
        db_phase_s=180,
    )
    return rescue.parser().parse_args([*command_for(SimpleNamespace(**defaults)), *extra])


@pytest.mark.parametrize(
    "extra",
    [
        ["--provider", "../bad"],
        ["--date", "2026-11-14"],
        ["--statement-timeout-s", "901"],
        ["--db-phase-s", "1801"],
        ["--not-after", "2026-11-14T06:00:00Z"],
        ["--as-of", "2026-11-01T23:00:00Z"],
    ],
)
def test_rescue_rejects_schema_drift_and_unsafe_arguments_before_copy(tmp_path, extra):
    with pytest.raises(ValueError):
        rescue.bounds(args(tmp_path, *extra), NOW)


def test_rescue_allows_only_explicit_current_day_asof(tmp_path):
    with pytest.raises(ValueError):
        rescue.bounds(args(tmp_path, "--date", "2026-11-13"), NOW)
    result = rescue.bounds(
        args(tmp_path, "--date", "2026-11-13", "--as-of", "2026-11-13T22:00:00Z"), NOW
    )
    assert result["status"] == "partial_asof"
    assert result["end"] == "2026-11-13T22:00:00+00:00"
    with pytest.raises(ValueError):
        rescue.bounds(args(tmp_path, "--date", "2026-11-12"), datetime(2026, 11, 13, 5, tzinfo=UTC))


def test_rescue_bounds_refuse_insufficient_budget_before_0545(tmp_path):
    with pytest.raises(ValueError):
        rescue.bounds(args(tmp_path), datetime(2026, 11, 14, 5, 44, tzinfo=UTC))


def test_rescue_preserves_postgres_csv_nulls_unicode_newlines_floats_and_microseconds(tmp_path):
    payload = 'a,b,c,d\n,"","Montréal\n南",1.23456789012345\n'.encode()
    source = tmp_path / "table.csv"
    source.write_bytes(payload)
    result = rescue.compress(source)
    assert gzip.decompress(source.with_suffix(".csv.gz").read_bytes()) == payload
    assert result["rows"] == 1
    assert result["csv_bytes"] == len(payload)
    assert result["csv_sha256"] == rescue.digest(io.BytesIO(payload))[0]
    assert source.with_suffix(".csv.gz").read_bytes()[4:8] == bytes(4)


@pytest.mark.parametrize("status", [409, 412])
@pytest.mark.parametrize("equal", [True, False])
def test_rescue_create_only_collision_equal_succeeds_different_stops(tmp_path, status, equal):
    payload = tmp_path / "payload"
    payload.write_bytes(b"expected")

    class Collision:
        def put_if_absent(self, path, key):
            raise ObjectAlreadyExists("collision", status)

        def open_stream(self, key):
            return io.BytesIO(b"expected" if equal else b"different")

    adapter = rescue.RescueObjects(Collision())
    if equal:
        assert adapter.ensure(payload, "rescue/v1/facts/sample/day/table") == 8
    else:
        with pytest.raises(ValueError):
            adapter.ensure(payload, "rescue/v1/facts/sample/day/table")
    assert payload.read_bytes() == b"expected"


def test_rescue_incomplete_upload_has_no_completion_receipt(tmp_path):
    storage = LocalBronzeStorage("local", tmp_path / "remote")
    with pytest.raises(ValueError):
        rescue.RescueObjects(storage).ensure(tmp_path / "missing", "outside/prefix")
    assert not (tmp_path / "remote").exists()


def test_rescue_resumes_spool_after_source_rows_have_been_pruned(tmp_path):
    identity = rescue.bounds(args(tmp_path), NOW)
    checkpoint = empty_checkpoint(tmp_path, identity)
    assert rescue.resume(tmp_path, identity) == checkpoint
    (tmp_path / (next(iter(rescue.SCHEMAS)) + ".csv.gz")).write_bytes(b"corrupt")
    with pytest.raises(ValueError):
        rescue.resume(tmp_path, identity)


def test_rescue_invalid_arguments_emit_safe_json(capsys):
    assert rescue.main(["--provider", "unsafe/value"]) == 2
    assert json.loads(capsys.readouterr().out)["reason"] == "invalid_arguments"


def test_rescue_checkpoint_rejects_changed_counts_and_schema(tmp_path):
    identity = rescue.bounds(args(tmp_path), NOW)
    checkpoint = empty_checkpoint(tmp_path, identity)
    checkpoint["tables"][next(iter(rescue.SCHEMAS))]["rows"] = 7
    (tmp_path / "checkpoint.json").write_bytes(rescue.encoded(checkpoint))
    with pytest.raises(ValueError):
        rescue.resume(tmp_path, identity)


def test_rescue_refuses_queued_exclusive_lock_and_cancels_only_itself(tmp_path, monkeypatch):
    monitor = SimpleNamespace(fetchone=lambda: monitor.row, close=lambda: None)

    def execute(query, params=None):
        monitor.row = (
            (NOW, "transit-ls04-rescue-" + "a" * 32) if "SELECT backend_start" in query else (True,)
        )
        return monitor

    monitor.execute = execute
    cancelled = []
    source = SimpleNamespace(
        info=SimpleNamespace(backend_pid=42),
        cancel_safe=lambda **kw: cancelled.append(42),
        rollback=lambda: None,
        close=lambda: None,
    )
    monkeypatch.setattr(rescue, "connect", lambda: monitor)
    with pytest.raises(ValueError):
        with rescue.guarded(source, args(tmp_path)):
            pytest.fail("source must never run behind a queued exclusive lock")
    assert cancelled == [42]


@pytest.fixture
def fact_source(real_db_engine, seed_provider):
    provider = "rescue-" + uuid4().hex
    start = datetime(2026, 11, 1, tzinfo=UTC)
    end = start + timedelta(days=1)
    with real_db_engine.begin() as conn:
        seed_provider(conn, provider, display_name=provider)
        snapshot = conn.execute(
            text("""
            WITH endpoint AS (
              INSERT INTO core.feed_endpoints(provider_id,endpoint_key,feed_kind,source_format)
              VALUES (:p,'trip_updates','trip_updates','gtfs_rt_trip_updates')
              RETURNING feed_endpoint_id
            ), run AS (
              INSERT INTO raw.ingestion_runs(provider_id,feed_endpoint_id,run_kind,status)
              SELECT :p,feed_endpoint_id,'trip_updates','succeeded' FROM endpoint
              RETURNING ingestion_run_id,feed_endpoint_id
            ), object AS (
              INSERT INTO raw.ingestion_objects(provider_id,ingestion_run_id,object_kind,
                storage_backend,storage_path,checksum_sha256,byte_size)
              SELECT :p,ingestion_run_id,'trip_updates','local',:p,repeat('a',64),1 FROM run
              RETURNING ingestion_object_id,ingestion_run_id
            ) INSERT INTO raw.realtime_snapshot_index(provider_id,feed_endpoint_id,ingestion_run_id,
                ingestion_object_id,feed_timestamp_utc,captured_at_utc,entity_count)
              SELECT :p,feed_endpoint_id,ingestion_run_id,ingestion_object_id,:at,:at,5
              FROM run JOIN object USING(ingestion_run_id) RETURNING realtime_snapshot_id
        """),
            {"p": provider, "at": start},
        ).scalar_one()
        for index, at in enumerate(
            [
                start - timedelta(microseconds=1),
                start,
                start + timedelta(hours=4),
                end - timedelta(microseconds=1),
                end,
            ]
        ):
            for table in rescue.SCHEMAS:
                extra = ",stop_time_update_count" if "trip" in table else ",latitude"
                value = ",0" if "trip" in table else ",1.23456789012345"
                conn.execute(
                    text(
                        f"INSERT INTO gold.{table} (provider_id,realtime_snapshot_id,"
                        "entity_index,snapshot_date_key,snapshot_local_date,feed_timestamp_utc,"
                        f"captured_at_utc,entity_id,trip_id,vehicle_id{extra}) "
                        "VALUES (:p,:snapshot,:i,20261101,'2026-11-01',:at,:at,:entity,'',"
                        f"NULL{value})"
                    ),
                    dict(p=provider, snapshot=snapshot, i=index, at=at, entity="Montréal\n南"),
                )
    try:
        yield provider, start, end
    finally:
        with real_db_engine.begin() as conn:
            for table in [
                *("gold." + table for table in rescue.SCHEMAS),
                "raw.realtime_snapshot_index",
                "raw.ingestion_objects",
                "raw.ingestion_runs",
                "core.feed_endpoints",
                "core.providers",
            ]:
                conn.execute(text(f"DELETE FROM {table} WHERE provider_id=:p"), {"p": provider})


def test_rescue_uses_strict_utc_bounds_and_preserves_csv_values(
    real_db_engine, fact_source, tmp_path
):
    import csv

    provider, start, end = fact_source
    # A separate, fresh connection sees the seeded rows; no writer transaction is reused.
    connection = rescue.psycopg.connect(
        **real_db_engine.url.translate_connect_args(username="user", database="dbname"),
        autocommit=True,
        application_name="transit-ls04-rescue-" + uuid4().hex,
    )
    with pytest.raises(ValueError):
        copy_to(connection, tmp_path / "inactive.csv")
    with connection, connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        connection.execute("SET LOCAL TimeZone = 'UTC'")
        for table in rescue.SCHEMAS:
            destination = tmp_path / (table + ".csv")
            meta = copy_to(connection, destination, table, provider, start, end)
            parsed = list(csv.DictReader(io.StringIO(destination.read_text(encoding="utf-8"))))
            assert [row["entity_index"] for row in parsed] == ["1", "2", "3"]
            assert all(row["entity_id"] == "Montréal\n南" for row in parsed)
            assert "23:59:59.999999" in parsed[-1]["captured_at_utc"]
            assert b',"",' in destination.read_bytes()
            compressed = rescue.compress(destination)
            assert meta["copy_rows"] == compressed["rows"] == 3
            assert meta["csv_sha256"] == compressed["csv_sha256"]
            empty = copy_to(
                connection, tmp_path / (table + "-empty.csv"), table, "absent-fixture-provider"
            )
            assert empty["copy_rows"] == 0 and empty["schema"] == rescue.SCHEMAS[table]
            assert connection.execute("SHOW transaction_read_only").fetchone() == ("on",)
            assert connection.execute("SHOW transaction_isolation").fetchone() == (
                "repeatable read",
            )


def test_rescue_partial_upload_resumes_without_receipt_until_both_match(tmp_path, monkeypatch):
    class Scope:
        def resolve(self, backend):
            return storage

        def close(self):
            pass

    identity = rescue.bounds(args(tmp_path), NOW)
    checkpoint = empty_checkpoint(tmp_path, identity)
    storage = LocalBronzeStorage("local", tmp_path / "remote")
    monkeypatch.setattr(rescue, "history_storage", Scope)
    original = rescue.RescueObjects.ensure
    calls = []

    def fail_second(self, *arguments):
        calls.append(arguments[1])
        if len(calls) == 2:
            raise OSError("simulated_failure")
        return original(self, *arguments)

    monkeypatch.setattr(rescue.RescueObjects, "ensure", fail_second)
    with pytest.raises(OSError):
        rescue.publish(checkpoint, tmp_path)
    assert not (storage.root / identity["prefix"] / "receipt.json").exists()
    monkeypatch.setattr(rescue.RescueObjects, "ensure", original)
    assert rescue.publish(checkpoint, tmp_path)["object_get_bytes"] > 0
    receipt = storage.root / identity["prefix"] / "receipt.json"
    first = receipt.read_bytes()
    rescue.publish(checkpoint, tmp_path)
    assert receipt.read_bytes() == first


def test_rescue_closes_source_transaction_before_object_io(
    real_db_engine, fact_source, tmp_path, monkeypatch
):
    provider, _, _ = fact_source
    connections = []

    def connect():
        conn = rescue.psycopg.connect(
            **real_db_engine.url.translate_connect_args(username="user", database="dbname"),
            autocommit=True,
            application_name="transit-ls04-rescue-" + uuid4().hex,
        )
        connections.append(conn)
        return conn

    monkeypatch.setattr(rescue, "connect", connect)
    options = args(
        tmp_path,
        "--provider",
        provider,
        "--not-after",
        (datetime.now(UTC) + timedelta(days=1)).strftime("%Y-%m-%dT05:45:00Z"),
    )
    identity = rescue.bounds(options, datetime.now(UTC))
    original = rescue.compress

    def compress(path):
        assert all(conn.closed for conn in connections)
        with connect() as live:
            live.execute("SET statement_timeout = '1s'")
            live.execute(
                "UPDATE gold.fact_vehicle_snapshot SET route_id='live' WHERE provider_id=%s",
                (provider,),
            )
        return original(path)

    monkeypatch.setattr(rescue, "compress", compress)
    checkpoint = rescue.export(options, identity, tmp_path)
    assert all(meta["rows"] == 3 for meta in checkpoint["tables"].values())
    with connect() as pruner:
        for table in rescue.SCHEMAS:
            pruner.execute(f"DELETE FROM gold.{table} WHERE provider_id=%s", (provider,))
    assert rescue.resume(tmp_path, identity) == checkpoint


@pytest.mark.parametrize("drift", ["type", "nullable", "order", "pk"])
def test_rescue_refuses_catalog_drift_before_copy(tmp_path, drift):
    table = next(iter(rescue.SCHEMAS))
    schema = deepcopy(rescue.SCHEMAS[table])
    if drift == "type":
        schema[0][1] = "integer"
    elif drift == "nullable":
        schema[0][2] = False
    elif drift == "order":
        schema.reverse()

    class Connection:
        info = SimpleNamespace(transaction_status=rescue.TransactionStatus.INTRANS)

        def execute(self, query, params=None):
            if query.startswith("SHOW"):
                return SimpleNamespace(fetchone=lambda: ("on",))
            if "SELECT attname" in query:
                return schema
            return SimpleNamespace(
                fetchone=lambda: (["entity_index"] if drift == "pk" else rescue.PK,)
            )

    with pytest.raises(ValueError, match="schema_drift"):
        copy_to(Connection(), tmp_path / "refused", table)
    assert not (tmp_path / "refused").exists()


@pytest.fixture
def rescue_login(real_db_engine):
    role, password = "rescue_" + uuid4().hex, uuid4().hex
    with real_db_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as admin:
        admin.exec_driver_sql(
            rescue.sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER PASSWORD {}")
            .format(rescue.sql.Identifier(role), rescue.sql.Literal(password))
            .as_string()
        )
        try:
            admin.exec_driver_sql(f'GRANT USAGE ON SCHEMA gold TO "{role}"')
            for table in rescue.SCHEMAS:
                admin.exec_driver_sql(f'GRANT SELECT ON gold.{table} TO "{role}"')
            yield real_db_engine.url.set(username=role, password=password)
        finally:
            admin.exec_driver_sql(f'DROP OWNED BY "{role}"')
            admin.exec_driver_sql(f'DROP ROLE "{role}"')


@pytest.mark.parametrize("idle", [False, True])
def test_rescue_real_queued_lock_releases_only_source(
    real_db_engine, fact_source, tmp_path, monkeypatch, idle, rescue_login
):
    def connect():
        return rescue.psycopg.connect(
            **rescue_login.translate_connect_args(username="user", database="dbname"),
            autocommit=True,
            application_name="transit-ls04-rescue-" + uuid4().hex,
            options="-c statement_timeout=1000",
        )

    monkeypatch.setattr(rescue, "connect", connect)
    completed = threading.Event()
    failures = []

    def exclusive():
        try:
            with (
                rescue.psycopg.connect(
                    **real_db_engine.url.translate_connect_args(username="user", database="dbname"),
                    autocommit=True,
                    application_name="transit-ls04-rescue-" + uuid4().hex,
                ) as locker,
                locker.transaction(),
            ):
                locker.execute("SET LOCAL statement_timeout = '15s'")
                locker.execute("LOCK TABLE gold.fact_vehicle_snapshot IN ACCESS EXCLUSIVE MODE")
            completed.set()
        except Exception as error:
            failures.append(type(error).__name__)

    worker = threading.Thread(target=exclusive)
    with connect() as source:
        pid = source.info.backend_pid
        assert source.execute(
            "SELECT pg_has_role(current_user,'pg_monitor','MEMBER'), "
            "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user)"
        ).fetchone() == (False, False)
        monkeypatch.setattr(source, "cancel_safe", lambda **kw: None)  # deliberately miss
        started = rescue.time.monotonic()
        with pytest.raises((rescue.psycopg.OperationalError, ValueError, KeyboardInterrupt)):
            with rescue.guarded(source, args(tmp_path)) as protected, protected.transaction():
                protected.execute("SET TRANSACTION READ ONLY")
                protected.prove_visibility()
                protected.execute("SET LOCAL statement_timeout = '30s'")
                worker.start()
                if idle is True:
                    assert completed.wait(10), "idle backend must release locks within the bound"
                    protected.execute("SELECT 1")
                else:
                    with (
                        protected.cursor() as cursor,
                        cursor.copy("COPY (SELECT pg_sleep(30)) TO STDOUT") as blocks,
                    ):
                        list(blocks)
        assert rescue.time.monotonic() - started < 10
    worker.join(timeout=12)
    assert completed.is_set() and not failures
    with real_db_engine.connect() as observer:
        assert (
            observer.execute(
                text("SELECT count(*) FROM pg_stat_activity WHERE pid=:pid"), {"pid": pid}
            ).scalar_one()
            == 0
        )
        assert (
            observer.execute(
                text("SELECT count(*) FROM pg_locks WHERE pid=:pid"), {"pid": pid}
            ).scalar_one()
            == 0
        )


def empty_checkpoint(folder, identity):
    tables = {}
    for table, schema in rescue.SCHEMAS.items():
        path = folder / (table + ".csv")
        path.write_bytes((",".join(row[0] for row in schema) + "\n").encode())
        tables[table] = {
            **rescue.compress(path),
            "schema": schema,
            "schema_sha256": rescue.hashlib.sha256(rescue.encoded(schema)).hexdigest(),
        }
    checkpoint = {**identity, "tables": tables}
    (folder / "checkpoint.json").write_bytes(rescue.encoded(checkpoint))
    (folder / "export.json").write_bytes(rescue.encoded(checkpoint))
    return checkpoint


def test_rescue_asof_checkpoint_resumes_after_midnight(tmp_path, monkeypatch, capsys):
    previous = datetime.now(UTC) - timedelta(days=2)
    options = args(
        tmp_path,
        "--date",
        previous.date().isoformat(),
        "--as-of",
        previous.replace(hour=12).isoformat(),
        "--not-after",
        (previous + timedelta(days=1)).strftime("%Y-%m-%dT05:45:00Z"),
        "--upload",
    )
    identity = rescue.bounds(options, previous.replace(hour=23))
    checkpoint = empty_checkpoint(tmp_path, identity)
    monkeypatch.setattr(rescue.tempfile, "gettempdir", lambda: str(tmp_path.parent))
    monkeypatch.setattr(rescue, "connect", lambda: pytest.fail("resume must not query Postgres"))
    uploaded = []
    monkeypatch.setattr(rescue, "publish", lambda saved, folder: uploaded.append(saved) or {})
    command = command_for(options)
    assert rescue.main(command) == 0
    assert uploaded == [checkpoint]
    assert json.loads(capsys.readouterr().out)["reused_spool"] is True


@pytest.mark.parametrize("complete", [False, True])
def test_rescue_interrupt_reports_json_and_preserves_completed_spool(
    tmp_path, monkeypatch, capsys, complete
):
    options = args(
        tmp_path,
        "--not-after",
        (datetime.now(UTC) + timedelta(days=1)).strftime("%Y-%m-%dT05:45:00Z"),
    )
    identity = rescue.bounds(options, datetime.now(UTC))
    saved = empty_checkpoint(tmp_path, identity) if complete else None
    before = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    monkeypatch.setattr(rescue.tempfile, "gettempdir", lambda: str(tmp_path.parent))

    def interrupted(*unused):
        if not complete:
            (tmp_path / "fact_vehicle_snapshot.csv.partial").write_bytes(b"incomplete")
        raise KeyboardInterrupt

    monkeypatch.setattr(rescue, "export", interrupted)
    monkeypatch.setattr(rescue, "publish", interrupted)
    assert rescue.main([*command_for(options), "--upload"]) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["reason"] == "interrupted"
    after = {path.name: path.read_bytes() for path in tmp_path.iterdir() if path.is_file()}
    assert all(after[name] == value for name, value in before.items())
    if not complete:
        assert after["fact_vehicle_snapshot.csv.partial"] == b"incomplete"
    if complete:
        assert rescue.resume(tmp_path, identity) == saved


def test_rescue_observation_changes_do_not_change_completion_receipt(tmp_path, monkeypatch):
    checkpoint = empty_checkpoint(tmp_path, rescue.bounds(args(tmp_path), NOW))
    storage = LocalBronzeStorage("local", tmp_path / "remote")
    monkeypatch.setattr(
        rescue,
        "history_storage",
        lambda: SimpleNamespace(resolve=lambda backend: storage, close=lambda: None),
    )
    for meta in checkpoint["tables"].values():
        meta["leading_interval_unobserved"] = None
    rescue.publish(checkpoint, tmp_path)
    receipt = (storage.root / checkpoint["prefix"] / "receipt.json").read_bytes()
    for meta in checkpoint["tables"].values():
        meta["leading_interval_unobserved"] = [checkpoint["start"], checkpoint["end"]]
    rescue.publish(checkpoint, tmp_path)
    assert (storage.root / checkpoint["prefix"] / "receipt.json").read_bytes() == receipt


def test_rescue_stream_checks_persistent_failure_before_reading_more_bytes():
    failed, reads = threading.Event(), []
    source = rescue.GuardedSource(SimpleNamespace(info=None), failed)
    cursor = rescue.GuardedCursor(None, source)

    def read():
        reads.append("read")
        return b"first block"

    blocks = cursor.blocks(SimpleNamespace(read=read))
    assert next(blocks) == b"first block"
    failed.set()
    with pytest.raises(ValueError, match="interference_or_deadline"):
        next(blocks)
    assert reads == ["read"]


@pytest.mark.parametrize(
    "cancel_fails,terminate_fails,stderr_mode",
    [
        (False, False, "ok"),
        (True, False, "ok"),
        (True, True, "ok"),
        (True, True, "error"),
        (True, True, "blocked"),
    ],
)
def test_missed_cancel_releases_without_export_driver_lock(
    tmp_path, monkeypatch, capfd, cancel_fails, terminate_fails, stderr_mode
):
    queued, released, done = (threading.Event() for _ in range(3))
    lock, methods, targets = threading.Lock(), [], []

    class Source:
        info = SimpleNamespace(backend_pid=42)
        closed = False

        def cancel_safe(self, **kwargs):
            if cancel_fails:
                raise TimeoutError("synthetic transport failure")

        def rollback(self):
            methods.append("rollback")
            with lock:
                pass

        def close(self):
            methods.append("close")
            with lock:
                pass

        def execute(self, *unused):
            with lock:
                queued.set()
                released.wait(12)

    class Monitor:
        def execute(self, query, params=None):
            if "pg_terminate_backend" in query:
                targets.append(params)
                if terminate_fails:
                    raise TimeoutError("all channels unavailable")
                released.set()
            self.row = (
                (NOW, "transit-ls04-rescue-" + "a" * 32)
                if "SELECT backend_start" in query
                else (queued.is_set(),)
            )
            return self

        def fetchone(self):
            return self.row

        def close(self):
            pass

    monkeypatch.setattr(rescue, "connect", Monitor)
    errors, exits, source = [], [], Source()
    started = rescue.time.monotonic()

    def exit_process(code):
        exits.append(code)
        source.closed = True
        released.set()

    stderr_calls, release_stderr = [], threading.Event()
    write = os.write

    def stderr(fd, data):
        if fd != 2:
            return write(fd, data)
        stderr_calls.append(True)
        if stderr_mode == "error":
            raise OSError("closed stderr")
        if stderr_mode == "blocked":
            release_stderr.wait(20)
        return len(data)

    monkeypatch.setattr(os, "write", stderr)
    monkeypatch.setattr(os, "_exit", exit_process)

    def run():
        try:
            with rescue.guarded(source, args(tmp_path)) as protected:
                protected.execute("synthetic blocked COPY")
        except ValueError:
            with pytest.raises(ValueError, match="interference_or_deadline"):
                protected.execute("SELECT 1")
            with pytest.raises(ValueError, match="interference_or_deadline"):
                with protected.cursor():
                    pytest.fail("COPY cursor opened after persistent failure")
            errors.append("stopped")
        finally:
            done.set()

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    try:
        assert queued.wait(2)
        assert released.wait(3), "termination must not wait for the export driver lock"
        assert methods == []
        assert targets == [(42, NOW, "transit-ls04-rescue-" + "a" * 32)] * (
            2 if terminate_fails else 1
        )
    finally:
        release_stderr.set()
        released.set()
        worker.join(3)
    assert done.is_set() and errors == ["stopped"]
    assert rescue.time.monotonic() - started < 15
    assert exits == ([75] if terminate_fails else [])
    assert stderr_calls == []
    assert capfd.readouterr().err == ""
    if terminate_fails:
        assert source.closed


@pytest.fixture
def fake_copy_source(tmp_path, monkeypatch):
    class Source:
        closed = False

        def __enter__(self):
            return self

        def __exit__(self, *unused):
            self.closed = True

        @contextmanager
        def transaction(self):
            yield

        def execute(self, *unused):
            return SimpleNamespace(fetchone=lambda: (datetime.now(UTC), "fixture"))

    source, copied = Source(), []
    monkeypatch.setattr(rescue, "connect", lambda: source)

    @contextmanager
    def guard(connection, *unused, **kwargs):
        connection.check = lambda: None
        connection.prove_visibility = lambda: None
        yield connection

    monkeypatch.setattr(rescue, "guarded", guard)
    monkeypatch.setattr(
        rescue,
        "inventory",
        lambda conn: [
            dict(provider="sample", table=table, minimum=None) for table in rescue.SCHEMAS
        ],
    )

    def copy(connection, *, table, destination, **kwargs):
        payload = (",".join(row[0] for row in rescue.SCHEMAS[table]) + "\n").encode()
        destination.write_bytes(payload)
        copied.append(table)
        return dict(
            schema=rescue.SCHEMAS[table],
            schema_sha256=rescue.hashlib.sha256(rescue.encoded(rescue.SCHEMAS[table])).hexdigest(),
            copy_rows=0,
            csv_sha256=rescue.hashlib.sha256(payload).hexdigest(),
            csv_bytes=len(payload),
        )

    monkeypatch.setattr(rescue, "copy_fact_table", copy)
    monkeypatch.setattr(rescue.tempfile, "gettempdir", lambda: str(tmp_path.parent))
    options = args(
        tmp_path,
        "--not-after",
        (datetime.now(UTC) + timedelta(days=1)).strftime("%Y-%m-%dT05:45:00Z"),
    )
    return source, copied, copy, command_for(options)


def command_for(options):
    command = []
    for key, value in vars(options).items():
        if value not in (None, False):
            command.append("--" + key.replace("_", "-"))
            if value is not True:
                command.append(str(value))
    return command


def test_interrupt_first_compression_resumes_both_raw_tables(
    tmp_path, monkeypatch, capsys, fake_copy_source
):
    source, copied, _, command = fake_copy_source
    original = rescue.compress

    def interrupt(path):
        assert source.closed and len(copied) == 2
        raise KeyboardInterrupt

    monkeypatch.setattr(rescue, "compress", interrupt)
    assert rescue.main(command) == 1
    assert (tmp_path / "export.json").exists()
    for table in rescue.SCHEMAS:
        assert (tmp_path / (table + ".csv")).exists()
    monkeypatch.setattr(rescue, "compress", original)
    monkeypatch.setattr(rescue, "connect", lambda: pytest.fail("protected raw resume queried DB"))
    assert rescue.main(command) == 0
    reports = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert reports[-1]["reused_spool"] and not reports[-1]["queried_postgres"]
    raw = json.loads((tmp_path / "export.json").read_bytes())
    for table, meta in reports[-1]["checkpoint"]["tables"].items():
        assert meta["csv_sha256"] == raw["tables"][table]["csv_sha256"]


@pytest.mark.parametrize("registered_bytes", [False, True])
def test_interrupt_second_copy_retains_and_quarantines_both_streams(
    tmp_path, monkeypatch, capsys, fake_copy_source, registered_bytes
):
    _, copied, original, command = fake_copy_source
    first, second = rescue.SCHEMAS

    def interrupt(connection, **kwargs):
        if kwargs["table"] == second:
            if registered_bytes:
                original(connection, **kwargs)
            else:
                kwargs["destination"].with_suffix(".csv.partial").write_bytes(b"unfinished")
            raise KeyboardInterrupt
        return original(connection, **kwargs)

    monkeypatch.setattr(rescue, "copy_fact_table", interrupt)
    assert rescue.main(command) == 1
    retained = {p.name: p.read_bytes() for p in tmp_path.iterdir() if p.is_file()}
    assert len(retained) == 2 and not (tmp_path / "export.json").exists()
    if not registered_bytes:
        assert retained[second + ".csv.partial"] == b"unfinished"
    monkeypatch.setattr(rescue, "copy_fact_table", original)
    assert rescue.main(command) == 0
    report = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert report["queried_postgres"] and not report["reused_spool"]
    assert all(
        (Path(report["quarantine"]) / name).read_bytes() == value
        for name, value in retained.items()
    )
    assert copied == (
        [first, second, first, second] if registered_bytes else [first, first, second]
    )


def test_visibility_requires_observed_self_locks_before_copy(monkeypatch):
    statements = []
    raw = SimpleNamespace(
        info=SimpleNamespace(backend_pid=42), execute=lambda query: statements.append(query)
    )
    monitor = SimpleNamespace(
        execute=lambda *args: SimpleNamespace(fetchone=lambda: (False,)), close=lambda: None
    )
    monkeypatch.setattr(rescue, "connect", lambda: monitor)
    with pytest.raises(ValueError, match="lock_visibility_required"):
        rescue.GuardedSource(raw, threading.Event()).prove_visibility()
    assert len(statements) == 2


@pytest.mark.parametrize("changed", [None, "pid", "backend_start", "application_name"])
def test_termination_matches_exact_backend_identity(changed):
    expected = dict(pid=42, backend_start="original", application_name="rescue-token")
    actual = {**expected, **({changed: 43 if changed == "pid" else "different"} if changed else {})}
    with sqlite3.connect(":memory:") as db:
        db.execute(
            "CREATE TABLE pg_stat_activity(pid,backend_start,application_name,usename,xact_start)"
        )
        db.execute(
            "INSERT INTO pg_stat_activity VALUES (?,?,?,'same-role','active')",
            tuple(actual.values()),
        )
        victims = []
        db.create_function("current_user", 0, lambda: "same-role")
        db.create_function("pg_terminate_backend", 2, lambda pid, ms: victims.append(pid) or 1)
        control = SimpleNamespace(
            execute=lambda query, params: db.execute(
                query.replace("%s", "?").replace("current_user", "current_user()"), params
            )
        )
        rescue.terminate_self(control, **expected)
        assert victims == ([] if changed else [42])


def test_timer_join_cannot_cancel_after_clean_guard_exit(tmp_path, monkeypatch):
    calls, joined = [], []

    def timer(interval, callback):
        return SimpleNamespace(
            start=lambda: None, cancel=lambda: None, join=lambda: (joined.append(True), callback())
        )

    def controller():
        return SimpleNamespace(
            execute=lambda query, params=None: SimpleNamespace(
                fetchone=lambda: (
                    (NOW, "transit-ls04-rescue-" + "a" * 32)
                    if "SELECT backend_start" in query
                    else (False,)
                )
            ),
            close=lambda: None,
        )

    monkeypatch.setattr(rescue.threading, "Timer", timer)
    monkeypatch.setattr(rescue, "connect", controller)
    source = SimpleNamespace(
        info=SimpleNamespace(backend_pid=42),
        cancel_safe=lambda **kwargs: calls.append("late cancel"),
    )
    with rescue.guarded(source, args(tmp_path)):
        pass
    assert joined == [True] and calls == []


def test_finalization_cannot_replace_copy_digest(tmp_path, monkeypatch, fake_copy_source):
    _, _, _, command = fake_copy_source
    original = rescue.compress

    def mutate(path):
        path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
        return original(path)

    monkeypatch.setattr(rescue, "compress", mutate)
    assert rescue.main(command) == 1
    assert not (tmp_path / "checkpoint.json").exists()


def nested_sigint_scenario(folder):
    from unittest.mock import patch

    import psycopg.connection as driver

    class Source:
        info = SimpleNamespace(backend_pid=42)
        pgconn = SimpleNamespace(socket=123, transaction_status=driver.ACTIVE)

        def _try_cancel(self, **kwargs):
            (folder / "nested").write_text("nested")
            signal.raise_signal(signal.SIGINT)

    source = Source()

    def wait(*unused, **kwargs):
        signal.raise_signal(signal.SIGINT)
        raise AssertionError("SIGINT was deferred")

    options = args(
        folder / "spool",
        "--not-after",
        (datetime.now(UTC) + timedelta(days=1)).strftime("%Y-%m-%dT05:45:00Z"),
    )

    def export(*unused):
        try:
            assert signal.getsignal(signal.SIGINT) is signal.default_int_handler
            driver.Connection.wait(source, iter(()))
        finally:
            (folder / "closed").write_text("closed")

    with (
        patch.object(rescue, "export", export),
        patch.object(driver.waiting, "wait", wait),
    ):
        return rescue.main(command_for(options))


def test_nested_sigint_in_real_driver_wait_exits_and_closes_source(tmp_path):
    import subprocess

    code = "import runpy,sys; from pathlib import Path; ns=runpy.run_path(sys.argv[1]); "
    code += "print('READY',flush=True);sys.exit(ns['nested_sigint_scenario'](Path(sys.argv[2])))"
    with subprocess.Popen(
        [sys.executable, "-I", "-c", code, __file__, str(tmp_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    ) as process:
        assert process.stdout.readline() == "READY\n"  # Imports are outside the cancellation bound.
        try:
            output, error = process.communicate(timeout=8)
        finally:
            if process.poll() is None:
                process.kill()
        assert process.returncode == 1 and (tmp_path / "nested").exists()
    assert (tmp_path / "closed").exists()
    assert json.loads(output)["reason"] == "interrupted"


@pytest.mark.parametrize("mode", ["SIGINTx2", "SIGTERM"])
def test_default_process_signals_release_real_copy_backend(
    real_db_engine, rescue_login, tmp_path, mode
):
    import os
    import subprocess

    if sys.platform == "win32":
        pytest.skip("POSIX process signalling is exercised by Linux CI")
    code = """import importlib.util,os,sys,tempfile
from pathlib import Path
s=importlib.util.spec_from_file_location('rescue',sys.argv[1]);r=importlib.util.module_from_spec(s)
s.loader.exec_module(r)
os.environ['DATABASE_URL']=os.environ['RESCUE_TEST_URL']
tempfile.gettempdir=lambda:sys.argv[2]
r.inventory=lambda c:[dict(table=t,provider='sample',minimum=None) for t in r.SCHEMAS]
def slow(c,**kw):
 print(c.info.backend_pid,flush=True)
 with c.cursor() as cur,cur.copy('COPY (SELECT pg_sleep(60)) TO STDOUT') as blocks:list(blocks)
r.copy_fact_table=slow
sys.exit(r.main(sys.argv[3:]))"""
    options = args(
        tmp_path / "spool",
        "--not-after",
        (datetime.now(UTC) + timedelta(days=1)).strftime("%Y-%m-%dT05:45:00Z"),
    )
    environment = {
        **os.environ,
        "RESCUE_TEST_URL": rescue_login.render_as_string(hide_password=False),
    }
    process = subprocess.Popen(
        [sys.executable, "-I", "-c", code, str(SCRIPT), str(tmp_path), *command_for(options)],
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    try:
        pid = int(process.stdout.readline())
        with real_db_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
            ready_by = rescue.time.monotonic() + 5
            while not observer.execute(
                text(
                    "SELECT state='active' AND query LIKE '%pg_sleep%' "
                    "FROM pg_stat_activity WHERE pid=:p"
                ),
                {"p": pid},
            ).scalar():
                assert rescue.time.monotonic() < ready_by, "COPY never reached the server"
                rescue.time.sleep(0.02)
            started = rescue.time.monotonic()
            if mode == "SIGTERM":
                process.terminate()
            else:
                os.kill(process.pid, signal.SIGINT)
                if process.poll() is None:
                    try:
                        os.kill(process.pid, signal.SIGINT)
                    except ProcessLookupError:
                        pass
            process.wait(timeout=5)
            while rescue.time.monotonic() - started < 5:
                remaining = observer.execute(
                    text("SELECT count(*) FROM pg_locks WHERE pid=:p"), {"p": pid}
                ).scalar_one()
                if not remaining:
                    break
                rescue.time.sleep(0.02)
            assert remaining == 0 and process.returncode != 0
            assert (
                observer.execute(
                    text("SELECT count(*) FROM pg_stat_activity WHERE pid=:p"), {"p": pid}
                ).scalar_one()
                == 0
            )
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)


def test_directory_sync_publication_order_and_posix_failure(tmp_path, monkeypatch):
    import stat

    events, directory_fds = [], {}
    rename, fsync = Path.rename, os.fsync
    directory_flag = getattr(os, "O_DIRECTORY", 0x10000)

    def open_directory(path, flags):
        assert flags == os.O_RDONLY | directory_flag
        descriptor = os.open(path, flags) if os.name != "nt" else -100
        if descriptor >= 0:
            assert stat.S_ISDIR(os.fstat(descriptor).st_mode)
        directory_fds[descriptor] = Path(path)
        return descriptor

    def sync(descriptor):
        if descriptor in directory_fds:
            events.append(("sync", directory_fds[descriptor]))
        else:
            events.append(("file", None))
        if descriptor >= 0:
            fsync(descriptor)

    def close(descriptor):
        directory_fds.pop(descriptor)
        if descriptor >= 0:
            os.close(descriptor)

    def move(path, target):
        events.append(("rename", Path(target)))
        return rename(path, target)

    proxy = SimpleNamespace(**vars(os))
    proxy.name, proxy.O_DIRECTORY = "posix", directory_flag
    proxy.open, proxy.fsync, proxy.close = open_directory, sync, close
    monkeypatch.setattr(rescue, "os", proxy)
    monkeypatch.setattr(Path, "rename", move)
    for name in ("raw.csv", "export.json", "checkpoint.json", "receipt.json"):
        events.clear()
        if name == "raw.csv":
            partial = tmp_path / "raw.csv.partial"
            with partial.open("xb") as output:
                output.write(b"csv")
                rescue.sync_file(output)
            rescue.finish_file(partial, tmp_path / name)
        else:
            rescue.write_record(tmp_path, name, {"data": "verified"})
        assert events == [("file", None), ("rename", tmp_path / name), ("sync", tmp_path)]
    events.clear()
    archive = rescue.quarantine(tmp_path, [tmp_path / "raw.csv", tmp_path / "export.json"])
    assert events == [
        ("sync", tmp_path),
        ("sync", archive),
        ("rename", archive / "raw.csv"),
        ("sync", tmp_path),
        ("sync", archive),
        ("rename", archive / "export.json"),
        ("sync", tmp_path),
        ("sync", archive),
    ]

    def denied(descriptor):
        raise OSError("directory fsync failed")

    proxy.fsync = denied
    partial = tmp_path / "failure.partial"
    partial.write_bytes(b"retained")
    with pytest.raises(OSError, match="directory fsync failed"):
        rescue.finish_file(partial, tmp_path / "failure")
    assert (tmp_path / "failure").read_bytes() == b"retained"
    assert not directory_fds
    monkeypatch.setattr(rescue, "connect", lambda: pytest.fail("fsync failure reached Postgres"))
    assert rescue.main(command_for(args(tmp_path))) == 1
