import importlib.util
import json
from itertools import product
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts/measure_fact_day.py"
spec = importlib.util.spec_from_file_location("measure", SCRIPT)
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)


def fixture_csv(folder, table):
    schema = measure.rescue.SCHEMAS[table]
    path = folder / (table + ".csv")
    values = dict(
        provider_id="sample",
        realtime_snapshot_id=42,
        entity_index=1,
        snapshot_date_key=20261101,
        snapshot_local_date="2026-11-01",
        captured_at_utc="2026-11-01 05:00:00.123456+00",
        feed_timestamp_utc="2026-11-01 05:00:00+00",
        trip_id="",
        stop_time_update_count=0,
        skipped_stop_count=0,
        latitude=1.23456789012345,
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
    probe = """import runpy,sys,time
from pathlib import Path
from types import SimpleNamespace as NS
r=runpy.run_path(sys.argv[1])['rescue']
Path(sys.argv[2],'fact.csv.partial').write_bytes(b'private')
def fail(*a,**kw): raise OSError('unreachable')
class Monitor:
 def execute(self,q,*a): self.identity='SELECT backend_start' in q; return self
 def fetchone(self): return (None,'transit-ls04-rescue-'+'a'*32) if self.identity else (False,)
 def close(self): pass
terminator=NS(execute=lambda q,*a: None if q.startswith('SET') else fail(),close=lambda:None)
channels=iter([Monitor(),terminator])
def connect():
 try: return next(channels)
 except StopIteration: raise OSError('recovery unavailable')
r.connect=connect
source=NS(info=NS(backend_pid=42),cancel_safe=fail)
with r.guarded(source,NS(db_phase_s=0.05)): time.sleep(10)
"""
    assert measure.supervise([], worker=probe) == 75
    assert not list(tmp_path.glob("transit-measure-*"))
    output = capsys.readouterr()
    assert json.loads(output.out)["reason"] == "measurement_failed" and not output.err
