import hashlib
import importlib.util
import json
import os
import signal
import socket
import sys
from itertools import product
from pathlib import Path
from subprocess import PIPE, Popen

import pytest
from test_rescue_fact_day import fact_source  # noqa: F401

SCRIPT = Path(__file__).parents[1] / "scripts/measure_fact_day.py"
spec = importlib.util.spec_from_file_location("measure", SCRIPT)
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)
ACTIVE_WRITER = """import json,os,signal,socket,sys,time
from pathlib import Path
signal.signal(signal.SIGTERM,signal.SIG_IGN)
s=socket.socket();s.bind(('127.0.0.1',0));s.listen()
folder=Path(sys.argv[2]);(folder/'nested').mkdir()
(folder/'nested/fact.csv.partial').write_bytes(b'private')
ready=Path(sys.argv[3]);partial=ready.with_suffix('.partial')
partial.write_text(json.dumps([os.getpid(),sys.argv[2],s.getsockname()[1]]));partial.replace(ready)
while True: time.sleep(0.1)
"""


def fixture_csv(folder, table):
    schema = measure.rescue.SCHEMAS[table]
    path = folder / (table + ".csv")
    values = dict(
        token.split("=", 1)
        for token in (
            "provider_id=sample realtime_snapshot_id=42 entity_index=1 snapshot_date_key=20261101 "
            "snapshot_local_date=2026-11-01 captured_at_utc=2026-11-01T05:00:00.123456+00 "
            "feed_timestamp_utc=2026-11-01T05:00:00+00 trip_id= stop_time_update_count=0 "
            "skipped_stop_count=0 latitude=1.23456789012345"
        ).split()
    )
    payload = ",".join(row[0] for row in schema) + "\n"
    # COPY quotes empty strings, leaving unquoted empty fields for SQL NULL.
    payload += (
        ",".join('""' if values.get(n) == "" else str(values.get(n, "")) for n, _, _ in schema)
        + "\n"
    )
    path.write_text(payload, encoding="utf-8", newline="")
    return path


def test_fact_measurement_preserves_null_empty_float_and_microsecond_values(tmp_path):
    table = "fact_vehicle_snapshot"
    fixture_csv(tmp_path, table)
    with measure.local_connection(tmp_path) as conn:
        measure.load_csv(conn, tmp_path, table)
        row = conn.execute(
            "SELECT trip_id, vehicle_id, latitude, epoch_us(captured_at_utc) FROM " + table
        ).fetchone()
        assert row[:3] == ("", None, 1.23456789012345)
        assert row[3] % 1000000 == 123456


def test_fact_measurement_reports_all_codec_order_and_row_group_candidates(tmp_path):
    for table in measure.rescue.SCHEMAS:
        source = fixture_csv(tmp_path, table)
        with measure.local_connection(tmp_path) as conn:
            measure.load_csv(conn, tmp_path, table)
            result = measure.codecs(conn, tmp_path, table)
        assert len(result["parquet"]) == 12
        assert {
            (r["level"], r["order"], r["requested_row_group_rows"]) for r in result["parquet"]
        } == set(product((3, 9, 19), ("primary", "analytical"), (122880, 1048576)))
        assert all(r["rows"] == 1 and r["actual_row_group_rows"] == [1] for r in result["parquet"])
        assert result["csv_bytes"] == source.stat().st_size
        assert result["gzip_bytes"] > 0
        assert not list(tmp_path.glob("*.parquet"))


def test_fact_measurement_reads_full_query_results_and_counts_actual_bytes(tmp_path):
    for table in measure.rescue.SCHEMAS:
        path = fixture_csv(tmp_path, table)
        header, row = path.read_bytes().splitlines(keepends=True)
        payload = header + row * 2056 + row.replace(b",42,1,", b",42,2,", 1)
        path.write_bytes(payload)
        assert measure.rescue.compress(path)["csv_bytes"] == len(payload)
    with measure.local_connection(tmp_path) as conn:
        for table in measure.rescue.SCHEMAS:
            measure.load_csv(conn, tmp_path, table)
        result = measure.queries(conn)
        assert len(result) == 3
        assert all(r["sha256"] == r["warm_sha256"] for r in result)
        assert result[2]["trip_outcome"] == "empty_string"
        assert result[2]["rows"] == 2057
        expected = (
            '["sample",42,1,20261101,"2026-11-01","2026-11-01 05:00:00+00",'
            '"2026-11-01 05:00:00.123456+00",null,"",null,null,null,null,null,null,'
            "0,null,null,0,null]\n"
        )
        expected = expected.encode()
        expected = expected * 2056 + expected.replace(b",42,1,", b",42,2,", 1)
        assert result[2]["sha256"] == hashlib.sha256(expected).hexdigest()
        conn.execute("UPDATE fact_trip_delay_snapshot SET trip_id=NULL")
        assert measure.queries(conn)[2]["trip_outcome"] == "null_only"
        conn.execute("DELETE FROM fact_trip_delay_snapshot")
        assert measure.queries(conn)[2]["trip_outcome"] == "no_rows"


def test_arguments_redact_rejected_credentials(capsys):
    secret = "postgresql://FAKE_USER:FAKE_PASSWORD@invalid.example/db"
    args = "--provider sample --date 2026-11-01 --not-after 2099-11-14T05:45:00Z".split()
    assert measure.main(args + ["--database-url", secret]) == 2
    output = capsys.readouterr()
    assert json.loads(output.out)["reason"] == "invalid_arguments" and not output.err
    assert "FAKE_PASSWORD" not in output.out + output.err


def test_guard_hard_exit_removes_partial_scratch(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(measure.tempfile, "tempdir", str(tmp_path))
    probe = """import os,runpy,sys,time
from unittest.mock import Mock
r=runpy.run_path(sys.argv[1])['rescue']
with open(os.path.join(sys.argv[2],'fact.csv.partial'),'wb') as f: f.write(b'private')
source=Mock();source.info.backend_pid=42;source.cancel_safe.side_effect=OSError()
source.execute.return_value.fetchone.return_value=(None,'transit-ls04-rescue-'+'a'*32)
r.connect=Mock(side_effect=[source,Mock(execute=Mock(side_effect=[None,OSError()])),OSError()])
with r.guarded(source,Mock(db_phase_s=0.05)): time.sleep(10)
"""
    assert measure.supervise([], worker=probe) == 75
    assert not list(tmp_path.glob("transit-measure-*"))
    output = capsys.readouterr()
    assert json.loads(output.out)["reason"] == "measurement_failed" and not output.err


@pytest.mark.parametrize(
    "stop", ["SIGTERM", "SIGINT", "abrupt"] + (["SIGBREAK"] if hasattr(signal, "SIGBREAK") else [])
)
def test_parent_stop_reaps_worker_and_preserves_outside_sentinel(tmp_path, stop, capsys):
    sentinel, ready = tmp_path / "outside", tmp_path / "ready"
    sentinel.write_text("preserve")
    parent = """import os,runpy,signal,sys,tempfile,threading,time
from pathlib import Path
m=runpy.run_path(sys.argv[1]);tempfile.tempdir=sys.argv[2]
def stop():
 while not Path(sys.argv[3]).exists(): time.sleep(0.01)
 print('READY',os.getpid(),flush=True)
 if sys.argv[5]!='abrupt': signal.raise_signal(getattr(signal,sys.argv[5]))
threading.Thread(target=stop,daemon=True).start()
sys.exit(m['supervise']([sys.argv[3]],worker=sys.argv[4]))
"""
    command = [sys.executable, "-I", "-c", parent, SCRIPT, tmp_path, ready, ACTIVE_WRITER, stop]
    try:
        with Popen(command, stdout=PIPE, stderr=PIPE, text=True) as result:
            handshake = result.stdout.readline().split()
            if handshake[:1] != ["READY"]:
                output, error = result.communicate(timeout=8)
                pytest.fail(error or output or "supervisor exited before READY")
            if stop == "abrupt":
                os.kill(int(handshake[1]), getattr(signal, "SIGKILL", signal.SIGTERM))
            try:
                output, error = result.communicate(timeout=8)
            finally:
                if result.poll() is None:
                    result.kill()
        pid, directory, port = json.loads(ready.read_text())
        with socket.socket() as observer:
            observer.settimeout(2)
            if observer.connect_ex(("127.0.0.1", port)) == 0:
                try:
                    assert observer.recv(1) == b""
                except ConnectionResetError:
                    pass
        assert not Path(directory).exists(), "owned scratch remains after worker exit"
        assert sentinel.read_text() == "preserve"
        if stop != "abrupt":
            assert result.returncode == 128 + getattr(signal, stop)
            assert json.loads(output)["reason"] == "measurement_failed" and not error
    finally:
        if ready.exists():
            pid, _, port = json.loads(ready.read_text())
            with socket.socket() as observer:
                if observer.connect_ex(("127.0.0.1", port)) == 0:
                    os.kill(pid, getattr(signal, "SIGKILL", signal.SIGTERM))


def test_occupancy_family_sample_detects_one_changed_value(tmp_path):
    for table in measure.rescue.SCHEMAS:
        fixture_csv(tmp_path, table)
    params = dict(
        p="sample",
        start="2026-11-01T00:00:00Z",
        end="2026-11-02T00:00:00Z",
        day="2026-11-01",
        key=20261101,
        tz="America/Toronto",
        built="2026-11-03T00:00:00Z",
    )
    left, right, reports = tmp_path / "left", tmp_path / "right", []
    with measure.local_connection(tmp_path) as conn:
        for table in measure.rescue.SCHEMAS:
            measure.load_csv(conn, tmp_path, table)
        conn.execute("UPDATE fact_vehicle_snapshot SET route_id='route',occupancy_status=2")
        conn.execute(
            "INSERT INTO fact_vehicle_snapshot SELECT * REPLACE "
            "(captured_at_utc+INTERVAL '2 hours' AS captured_at_utc) FROM fact_vehicle_snapshot"
        )
        conn.execute("DELETE FROM fact_trip_delay_snapshot")
        conn.execute(
            "INSERT INTO fact_trip_delay_snapshot BY NAME SELECT 'sample' AS provider_id, "
            "'route' AS route_id,2 AS occupancy_status,delay AS delay_seconds, "
            "'2026-11-01 06:00:00+00'::timestamptz AS captured_at_utc "
            "FROM (VALUES (-3601),(-3600),(3600),(3601)) AS delays(delay)"
        )
        crowd = measure.execute_family(conn, "crowding", params, local=True).fetchall()
        assert len(crowd) == 1 and crowd[0][4:7] == (2, 0, 0)
        for kind in ("route", "hourly", "stop", "crowding"):
            cursor = measure.execute_family(conn, kind, params, local=True)
            fields = [c[0] for c in cursor.description]
            assert len(fields) == len(set(fields))
            if kind != "hourly":
                continue
            measure.write_result(cursor, left)
            for ordinal, field in enumerate(("few_seats_count", "standing_count")):
                rows = [json.loads(row) for row in left.read_bytes().splitlines()]
                rows[ordinal][fields.index(field)] += 1
                right.write_bytes(b"".join(measure.rescue.encoded(row) + b"\n" for row in rows))
                reports.append(measure.compare(left, right, fields, key_count=4))
    assert [r["first_field"] for r in reports] == ["few_seats_count", "standing_count"]
    assert reports[0]["safe_key_sha256"] != reports[1]["safe_key_sha256"]


def test_fact_measurement_closes_database_before_parquet_work(measurement_db, monkeypatch):
    opened, connect, local = [], measure.rescue.connect, measure.local_connection

    def record():
        conn = connect()
        opened.append(conn)
        return conn

    def verify(folder):
        assert opened and all(c.closed for c in opened)
        return local(folder)

    monkeypatch.setattr(measure.rescue, "connect", record)
    monkeypatch.setattr(measure, "local_connection", verify)
    measure.measure(measurement_db[0])


def test_fact_measurement_cleans_scratch_and_redacts_failure(monkeypatch, capsys):
    folders = []

    def broken(args, folder):
        folders.append(folder)
        (folder / "partial").write_bytes(b"private")
        raise RuntimeError("postgresql://secret:password@host/private")

    monkeypatch.setattr(measure, "read_source", broken)
    args = "--provider sample --date 2026-11-01 --not-after 2099-11-14T05:45:00Z".split()
    assert measure.main(args, worker=True) == 1
    assert "secret" not in capsys.readouterr().out
    assert folders and not folders[0].exists()


def test_fact_measurement_refuses_unclosed_day_before_copy(monkeypatch, capsys):
    from contextlib import nullcontext
    from types import SimpleNamespace as NS

    seen, now = [], measure.datetime(2026, 11, 2, 5, tzinfo=measure.UTC)
    db = NS(
        execute=lambda *a: NS(fetchone=lambda: seen.append(now) or (now, "test")),
        transaction=lambda: nullcontext(),
        prove_visibility=lambda: pytest.fail("source read before closure"),
    )
    monkeypatch.setattr(measure.rescue, "connect", lambda: nullcontext(db))
    monkeypatch.setattr(measure.rescue, "guarded", lambda *a: nullcontext(db))
    monkeypatch.setattr(measure.rescue, "copy_fact_table", lambda *a, **kw: pytest.fail("COPY"))
    args = "--provider sample --date 2026-11-01 --not-after 2099-11-14T05:45:00Z".split()
    assert measure.main(args, worker=True) == 1
    assert seen == [now]
    assert json.loads(capsys.readouterr().out)["reason"] == "measurement_failed"


@pytest.fixture
def measurement_db(real_db_engine, fact_source, monkeypatch):  # noqa: F811
    from uuid import uuid4

    from sqlalchemy import text

    provider, start, end = fact_source

    def connect():
        return measure.rescue.psycopg.connect(
            **real_db_engine.url.translate_connect_args(username="user", database="dbname"),
            autocommit=True,
            application_name="transit-ls04-rescue-" + uuid4().hex,
        )

    monkeypatch.setattr(measure.rescue, "connect", connect)
    monkeypatch.setattr(
        measure.rescue, "history_storage", lambda *a: pytest.fail("storage mutation")
    )
    with real_db_engine.begin() as conn:
        for table in measure.rescue.SCHEMAS:
            extra = ",stop_time_update_count,delay_seconds" if table == measure.TRIP else ",stop_id"
            value = (
                ",0,(ARRAY[-3601,-3600,-1,0,1,2,3600,3601,NULL])[1+n%9]"
                if table == measure.TRIP
                else ",CASE WHEN n%2=0 THEN NULL ELSE 'stop' END"
            )
            occupancy = "n%6" if table == measure.TRIP else "n%8"
            conn.execute(
                text(f"""INSERT INTO gold.{table}
              (provider_id,realtime_snapshot_id,entity_index,snapshot_date_key,snapshot_local_date,
               feed_timestamp_utc,captured_at_utc,route_id,occupancy_status{extra})
              SELECT provider_id,realtime_snapshot_id,100+n,20261101,'2026-11-01',
                feed_timestamp_utc,CAST(:at AS timestamptz)+(4+n%3)*INTERVAL '1 hour',
                CASE WHEN n IN (0,1,6,7,9) OR n%3<>0 THEN 'route' END,{occupancy}{value}
              FROM gold.{table} CROSS JOIN generate_series(0,14) AS n
              WHERE provider_id=:p AND entity_index=1"""),
                dict(p=provider, at=start),
            )
    args = measure.options(
        f"--provider {provider} --date {start.date()} --not-after 2099-11-14T05:45:00Z".split()
    )
    return args, connect, start


def test_fact_measurement_is_read_only_and_preserves_sources(real_db_engine, measurement_db):
    from sqlalchemy import text

    tables = [
        *("gold." + t for t in measure.rescue.SCHEMAS),
        *"""raw.ingestion_runs
        raw.ingestion_objects raw.realtime_snapshot_index core.history_window
        core.history_archive_copy core.history_event core.pipeline_switches""".split(),
    ]

    def snapshot():
        with real_db_engine.connect() as conn:
            return [
                sorted(conn.execute(text(f"SELECT row_to_json(t)::text FROM {t} t")).scalars())
                for t in tables
            ]

    before = snapshot()
    report = measure.measure(measurement_db[0])
    assert snapshot() == before
    assert report["family_comparison"]["status"] == "equal"
    assert all(t["copy_rows"] > 0 for t in report["tables"].values())


def test_occupancy_family_sample_matches_postgres_serialized_bytes(measurement_db):
    report = measure.measure(measurement_db[0])
    outputs = report["family_comparison"]["outputs"]
    assert {r["postgres"]["kind"] for r in outputs.values()} == {
        "route",
        "hourly",
        "stop",
        "crowding",
    }
    assert all(r["deterministic"] for r in outputs.values())
    assert all(a["status"] == "equal" for r in outputs.values() for a in r["duckdb"])


def test_fact_measurement_uses_one_snapshot_for_csv_and_postgres_oracle(
    measurement_db, monkeypatch, tmp_path
):
    args, connect, start = measurement_db
    original = measure.rescue.copy_fact_table
    changed = []

    def copy(conn, **kwargs):
        assert conn.execute("SHOW transaction_read_only").fetchone()[0] == "on"
        assert conn.execute("SHOW transaction_isolation").fetchone()[0] == "repeatable read"
        if not changed:
            with connect() as other:
                other.execute(
                    "UPDATE gold.fact_trip_delay_snapshot SET delay_seconds=3599 "
                    "WHERE provider_id=%s",
                    (args.provider,),
                )
            changed.append(True)
        return original(conn, **kwargs)

    monkeypatch.setattr(measure.rescue, "copy_fact_table", copy)
    report = measure.measure(args)
    assert changed and report["family_comparison"]["status"] == "equal"
