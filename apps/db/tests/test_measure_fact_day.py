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

PARENT = """import os,runpy,signal,sys,tempfile,threading,time
from pathlib import Path
m=runpy.run_path(sys.argv[1]);tempfile.tempdir=sys.argv[2]
def stop():
 while not Path(sys.argv[3]).exists(): time.sleep(0.01)
 print('READY',os.getpid(),flush=True)
 if sys.argv[5].startswith('SIG'): signal.raise_signal(getattr(signal,sys.argv[5]))
threading.Thread(target=stop,daemon=True).start()
sys.exit(m['supervise']([sys.argv[3]],worker=sys.argv[4]))
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


def change_owner(root, kind, parent):
    assert root.parent == parent.resolve()
    data = json.loads((root / ".owner").read_text())
    if kind == "replacement":
        root.rename(root.with_name(root.name + "-original"))
        root.mkdir()
        (root / "replacement").write_bytes(b"another directory with a copied marker")
    else:
        data["invocation" if kind == "invocation" else "path"] = "different-owner"
    (root / ".owner").write_text(json.dumps(data))
    return {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}


@pytest.mark.parametrize(
    "stop",
    ["SIGTERM", "SIGINT", "abrupt", "invocation", "path", "replacement"]
    + (["SIGBREAK"] if hasattr(signal, "SIGBREAK") else []),
)
def test_parent_stop_reaps_worker_and_preserves_outside_sentinel(tmp_path, stop, capsys):
    sentinel, ready = tmp_path / "outside", tmp_path / "ready"
    sentinel.write_text("preserve")
    command = [sys.executable, "-I", "-c", PARENT, SCRIPT, tmp_path, ready, ACTIVE_WRITER, stop]
    try:
        with Popen(command, stdout=PIPE, stderr=PIPE, text=True) as result:
            first = result.stdout.readline()
            handshake = first.split()
            if handshake[:1] != ["READY"]:
                output, error = result.communicate(timeout=8)
                pytest.fail(
                    f"first stdout: {first!r}\nremaining stdout: {output!r}\nstderr: {error!r}"
                )
            if not stop.startswith("SIG"):
                if stop != "abrupt":
                    preserved = change_owner(Path(json.loads(ready.read_text())[1]), stop, tmp_path)
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
        if stop in ("invocation", "path", "replacement"):
            assert all(p.exists() and p.read_bytes() == value for p, value in preserved.items())
            assert json.loads(error)["leftover_paths"] == [directory]
        else:
            assert not Path(directory).exists(), "owned scratch remains after worker exit"
        assert sentinel.read_text() == "preserve"
        if stop.startswith("SIG"):
            assert result.returncode == 128 + getattr(signal, stop)
            assert json.loads(output)["reason"] == "measurement_failed" and not error
    finally:
        if ready.exists():
            pid, _, port = json.loads(ready.read_text())
            with socket.socket() as observer:
                if observer.connect_ex(("127.0.0.1", port)) == 0:
                    os.kill(pid, getattr(signal, "SIGKILL", signal.SIGTERM))


@pytest.mark.parametrize("stderr", [False, True])
def test_early_exit_keeps_both_streams(tmp_path, monkeypatch, capsys, stderr):
    code = "import sys;print('FIRST_STDOUT_DIAGNOSTIC');print('REMAINING_STDOUT_DIAGNOSTIC');"
    if stderr:
        code += "print('STDERR_DIAGNOSTIC',file=sys.stderr,flush=True);"
    code += "sys.exit(2)"

    def early(*args, _real=Popen, **kwargs):
        return _real([sys.executable, "-I", "-c", code], **kwargs)

    monkeypatch.setitem(globals(), "Popen", early)
    with pytest.raises(pytest.fail.Exception) as failure:
        test_parent_stop_reaps_worker_and_preserves_outside_sentinel(tmp_path, "SIGTERM", capsys)
    message = str(failure.value)
    assert "first stdout:" in message and "FIRST_STDOUT_DIAGNOSTIC" in message
    assert "remaining stdout:" in message and "REMAINING_STDOUT_DIAGNOSTIC" in message
    assert "stderr:" in message and (not stderr or "STDERR_DIAGNOSTIC" in message)


@pytest.mark.skipif(sys.platform != "linux", reason="Linux dir_fd path")
def test_linux_fd_pins_the_validated_tree(tmp_path, monkeypatch):
    monkeypatch.setattr(measure.tempfile, "tempdir", str(tmp_path))
    sentinel = tmp_path / "outside"
    sentinel.write_bytes(b"preserve")
    listing = os.listdir
    with pytest.raises((OSError, ValueError)):
        with measure.scratch() as (root, proof):
            expected = measure.owned_snapshot(root)
            (root / "payload").write_bytes(b"owned")

            def swap(fd):
                root.rename(tmp_path / "saved")
                root.symlink_to(tmp_path, target_is_directory=True)
                return listing(fd)

            monkeypatch.setattr(os, "listdir", swap)
            measure.remove_owned_tree(root, expected)
    assert sentinel.read_bytes() == b"preserve"
    assert (tmp_path / "saved").is_dir() and not (tmp_path / "saved/payload").exists()
