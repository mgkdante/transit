import gzip
import importlib.util
import io
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from transit_ops.ingestion.storage import LocalBronzeStorage, ObjectAlreadyExists

SCRIPT = Path(__file__).parents[1] / "scripts/rescue_fact_day.py"
spec = importlib.util.spec_from_file_location("rescue", SCRIPT)
rescue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rescue)
NOW = datetime(2026, 11, 13, 23, tzinfo=UTC)


def args(tmp_path, *extra):
    return rescue.parser().parse_args(
        [
            "--provider",
            "sample",
            "--date",
            "2026-11-01",
            "--spool-dir",
            str(tmp_path),
            "--not-after",
            "2026-11-14T05:45:00Z",
            "--statement-timeout-s",
            "60",
            "--db-phase-s",
            "180",
            *extra,
        ]
    )


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


def test_rescue_enforces_timeouts_and_0545_deadline(tmp_path):
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
    adapter = rescue.RescueObjects(storage)
    with pytest.raises(ValueError):
        adapter.ensure(tmp_path / "missing", "outside/prefix")
    assert not (tmp_path / "remote").exists()


def test_rescue_resumes_spool_after_source_rows_have_been_pruned(tmp_path):
    identity = rescue.bounds(args(tmp_path), NOW)
    tables = {}
    for table, schema in rescue.SCHEMAS.items():
        source = tmp_path / (table + ".csv")
        source.write_bytes((",".join(row[0] for row in schema) + "\n").encode())
        tables[table] = {
            **rescue.compress(source),
            "schema": schema,
            "schema_sha256": rescue.hashlib.sha256(rescue.encoded(schema)).hexdigest(),
        }
    checkpoint = {**identity, "tables": tables}
    (tmp_path / "checkpoint.json").write_text(json.dumps(checkpoint))
    assert rescue.resume(tmp_path, identity) == checkpoint
    (tmp_path / (next(iter(tables)) + ".csv.gz")).write_bytes(b"corrupt")
    with pytest.raises(ValueError):
        rescue.resume(tmp_path, identity)


def test_rescue_report_counts_actual_bytes_and_redacts_failures(capsys):
    assert rescue.main(["--provider", "unsafe/value"]) == 2
    report = json.loads(capsys.readouterr().out)
    assert report["reason"] == "invalid_arguments"


def test_rescue_copies_both_fact_tables_in_one_read_only_snapshot(real_db_engine, tmp_path):
    with real_db_engine.connect() as sa:
        connection = sa.connection.driver_connection
        with connection.transaction():
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            connection.execute("SET LOCAL TimeZone = 'UTC'")
            for table in rescue.SCHEMAS:
                result = rescue.copy_fact_table(
                    connection,
                    table=table,
                    provider_id="absent-fixture-provider",
                    start_utc=NOW,
                    end_utc=NOW,
                    destination=tmp_path / (table + ".csv"),
                )
                assert result["copy_rows"] == 0
                assert result["schema"] == rescue.SCHEMAS[table]


def test_rescue_copy_requires_active_read_only_transaction(real_db_engine, tmp_path):
    with real_db_engine.connect() as sa:
        with pytest.raises(ValueError):
            rescue.copy_fact_table(
                sa.connection.driver_connection,
                table=next(iter(rescue.SCHEMAS)),
                provider_id="sample",
                start_utc=NOW,
                end_utc=NOW,
                destination=tmp_path / "refused.csv",
            )


def test_rescue_checkpoint_rejects_changed_counts_and_schema(tmp_path):
    identity = rescue.bounds(args(tmp_path), NOW)
    tables = {}
    for table, schema in rescue.SCHEMAS.items():
        source = tmp_path / (table + ".csv")
        source.write_bytes((",".join(row[0] for row in schema) + "\n").encode())
        tables[table] = {
            **rescue.compress(source),
            "schema": schema,
            "schema_sha256": rescue.hashlib.sha256(rescue.encoded(schema)).hexdigest(),
        }
    checkpoint = {**identity, "tables": tables}
    tables[next(iter(tables))]["rows"] = 7
    (tmp_path / "checkpoint.json").write_bytes(rescue.encoded(checkpoint))
    with pytest.raises(ValueError):
        rescue.resume(tmp_path, identity)


def test_rescue_refuses_queued_exclusive_lock_and_cancels_only_itself(tmp_path, monkeypatch):
    from types import SimpleNamespace

    class Monitor:
        def execute(self, query, params=None):
            return self

        def fetchone(self):
            return (True,)

        def close(self):
            pass

    cancelled = []
    source = SimpleNamespace(
        info=SimpleNamespace(backend_pid=42), cancel_safe=lambda **kw: cancelled.append(42)
    )
    monkeypatch.setattr(rescue, "connect", Monitor)
    with pytest.raises(ValueError):
        with rescue.guarded(source, args(tmp_path)):
            pytest.fail("source must never run behind a queued exclusive lock")
    assert cancelled == [42]


@pytest.fixture
def fact_source(real_db_engine):
    from datetime import timedelta
    from uuid import uuid4

    from sqlalchemy import text

    provider = "rescue-" + uuid4().hex
    start = datetime(2026, 11, 1, tzinfo=UTC)
    end = start + timedelta(days=1)
    with real_db_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO core.providers (provider_id,display_name,timezone,provider_key) "
                "VALUES (:p,:p,'America/Toronto',:p)"
            ),
            {"p": provider},
        )
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


def test_rescue_uses_strict_utc_bounds_and_reports_partial_oldest_day(
    real_db_engine, fact_source, tmp_path
):
    import csv

    provider, start, end = fact_source
    # A separate, fresh connection sees the seeded rows; no writer transaction is reused.
    connection = rescue.psycopg.connect(
        **real_db_engine.url.translate_connect_args(username="user", database="dbname"),
        autocommit=True,
    )
    with connection, connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        connection.execute("SET LOCAL TimeZone = 'UTC'")
        for table in rescue.SCHEMAS:
            destination = tmp_path / (table + ".csv")
            meta = rescue.copy_fact_table(
                connection,
                table=table,
                provider_id=provider,
                start_utc=start,
                end_utc=end,
                destination=destination,
            )
            parsed = list(csv.DictReader(io.StringIO(destination.read_text(encoding="utf-8"))))
            assert [row["entity_index"] for row in parsed] == ["1", "2", "3"]
            assert all(row["entity_id"] == "Montréal\n南" for row in parsed)
            assert "23:59:59.999999" in parsed[-1]["captured_at_utc"]
            assert b',"",' in destination.read_bytes()
            compressed = rescue.compress(destination)
            assert meta["copy_rows"] == compressed["rows"] == 3
            assert meta["csv_sha256"] == compressed["csv_sha256"]
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
    checkpoint = {**identity, "tables": {}}
    for table, schema in rescue.SCHEMAS.items():
        path = tmp_path / (table + ".csv")
        path.write_bytes((",".join(row[0] for row in schema) + "\n").encode())
        checkpoint["tables"][table] = {**rescue.compress(path), "schema": schema}
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
    from datetime import timedelta

    provider, _, _ = fact_source
    connections = []

    def connect():
        conn = rescue.psycopg.connect(
            **real_db_engine.url.translate_connect_args(username="user", database="dbname"),
            autocommit=True,
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
    from copy import deepcopy
    from types import SimpleNamespace

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
        rescue.copy_fact_table(
            Connection(),
            table=table,
            provider_id="sample",
            start_utc=NOW,
            end_utc=NOW,
            destination=tmp_path / "refused",
        )
    assert not (tmp_path / "refused").exists()


def test_rescue_real_queued_lock_cancels_only_source(
    real_db_engine, fact_source, tmp_path, monkeypatch
):
    import threading

    def connect():
        return rescue.psycopg.connect(
            **real_db_engine.url.translate_connect_args(username="user", database="dbname"),
            autocommit=True,
        )

    monkeypatch.setattr(rescue, "connect", connect)
    completed = threading.Event()
    failures = []

    def exclusive():
        try:
            with connect() as locker, locker.transaction():
                locker.execute("SET LOCAL statement_timeout = '10s'")
                locker.execute("LOCK TABLE gold.fact_vehicle_snapshot IN ACCESS EXCLUSIVE MODE")
            completed.set()
        except Exception as error:
            failures.append(type(error).__name__)

    worker = threading.Thread(target=exclusive)
    with connect() as source:
        with pytest.raises((rescue.psycopg.errors.QueryCanceled, ValueError)):
            with rescue.guarded(source, args(tmp_path)), source.transaction():
                source.execute("SET TRANSACTION READ ONLY")
                source.execute("SELECT * FROM gold.fact_vehicle_snapshot LIMIT 0")
                worker.start()
                source.execute("SELECT pg_sleep(5)")
    worker.join(timeout=12)
    assert completed.is_set() and not failures
