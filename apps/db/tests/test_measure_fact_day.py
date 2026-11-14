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
        fixture_csv(tmp_path, table)
    with measure.local_connection(tmp_path) as conn:
        for table in measure.rescue.SCHEMAS:
            measure.load_csv(conn, tmp_path, table)
        result = measure.queries(conn)
        assert len(result) == 3
        assert all(r["sha256"] == r["warm_sha256"] for r in result)
        assert result[2]["trip_outcome"] == "empty_string"
        assert result[2]["rows"] == 1
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
