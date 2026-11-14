import importlib.util
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
    with path.open("w", encoding="utf-8", newline="") as stream:
        stream.write(",".join(row[0] for row in schema) + "\n")
        # COPY quotes empty strings, leaving unquoted empty fields for SQL NULL.
        stream.write(
            ",".join('""' if values.get(n) == "" else str(values.get(n, "")) for n, _, _ in schema)
            + "\n"
        )
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
        } == {
            (level, o, g)
            for level in (3, 9, 19)
            for o in ("primary", "analytical")
            for g in (122880, 1048576)
        }
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
