import csv
from datetime import timedelta
from functools import partial

import psycopg
import pytest
from test_rescue_fact_day import fact_source as fact_source
from test_rescue_fact_day import rescue

from transit_ops.lake.table_export import (
    ExportRefused,
    SchemaDrift,
    WindowSpec,
    export_window,
    recheck_window,
)


@pytest.fixture
def source(real_db_engine):
    with psycopg.connect(
        **real_db_engine.url.translate_connect_args(username="user", database="dbname"),
        autocommit=True,
    ) as connection:
        yield connection


export = partial(export_window, statement_timeout_s=60)
recheck = partial(recheck_window, statement_timeout_s=60)


@pytest.mark.parametrize("table", list(rescue.SCHEMAS))
def test_fact_day_export_is_byte_identical_to_the_rescue_export(
    source, fact_source, tmp_path, table
):
    provider, start, end = fact_source
    source.execute(
        f"UPDATE gold.{table} SET entity_index=10-entity_index, "
        "trip_id=CASE WHEN entity_index=2 THEN '南' ELSE trip_id END WHERE provider_id=%s",
        (provider,),
    )
    spec = WindowSpec("gold." + table, provider, start.date().isoformat())
    result = export(source, spec, tmp_path / "export.csv")
    with source.transaction():
        source.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        source.execute("SET LOCAL TimeZone='UTC'")
        source.execute("SET LOCAL DateStyle='ISO, YMD'")
        source.execute("SET LOCAL IntervalStyle='iso_8601'")
        source.execute("SET LOCAL extra_float_digits=1")
        source.execute("SET LOCAL bytea_output='hex'")
        source.execute("SET LOCAL client_encoding='UTF8'")
        expected = rescue.copy_fact_table(
            source,
            table=table,
            provider_id=provider,
            start_utc=start,
            end_utc=end,
            destination=tmp_path / "rescue.csv",
        )
    assert result.csv_path.read_bytes() == (tmp_path / "rescue.csv").read_bytes()
    assert result.content_sha256 == expected["csv_sha256"]
    assert result.content_bytes == expected["csv_bytes"]
    assert result.rows == expected["copy_rows"]
    with result.csv_path.open(newline="", encoding="utf8") as stream:
        assert [row["entity_index"] for row in csv.DictReader(stream)] == ["7", "8", "9"]
    assert recheck(source, spec) == (result.content_sha256, result.content_bytes, 3)
    source.execute(f"UPDATE gold.{table} SET trip_id='changed' WHERE provider_id=%s", (provider,))
    assert recheck(source, spec)[0] != result.content_sha256
    with pytest.raises(FileExistsError):
        export(source, spec, result.csv_path)


def test_month_shared_drift_and_transaction_refusals(source, fact_source, tmp_path):
    provider, start, _ = fact_source
    spec = WindowSpec("gold.network_vehicle_day", provider, "2026-11", 2)
    try:
        for day in [start.date() - timedelta(days=1), start.date(), start.date().replace(month=12)]:
            source.execute(
                "INSERT INTO gold.network_vehicle_day VALUES (%s,2,%s,1,1,1,'x')", (provider, day)
            )
        result = export(source, spec, tmp_path / "month.csv")
        with result.csv_path.open(newline="", encoding="utf8") as stream:
            assert [row["service_date"] for row in csv.DictReader(stream)] == ["2026-11-01"]
        with source.transaction(), pytest.raises(ExportRefused, match="not_read_only"):
            export(source, spec, tmp_path / "refused.csv")
        assert not (tmp_path / "refused.csv").exists()
        shared = export(
            source, WindowSpec("gold.report_labels", "_shared", "2026-11"), tmp_path / "shared.csv"
        )
        assert (
            shared.rows == source.execute("SELECT count(*) FROM gold.report_labels").fetchone()[0]
        )
        source.execute("ALTER TABLE gold.network_vehicle_day ADD COLUMN export_test text")
        try:
            with pytest.raises(SchemaDrift):
                export(source, spec, tmp_path / "drift.csv", expected_schema=result.schema)
        finally:
            source.execute("ALTER TABLE gold.network_vehicle_day DROP COLUMN export_test")
        alter = "ALTER TABLE gold.network_vehicle_day DROP CONSTRAINT network_vehicle_day_pkey, "
        source.execute(alter + "ADD PRIMARY KEY (provider_id, service_date, revision)")
        try:
            with pytest.raises(SchemaDrift):
                export(source, spec, tmp_path / "key.csv")
            with pytest.raises(SchemaDrift):
                recheck(source, spec)
        finally:
            source.execute(alter + "ADD PRIMARY KEY (provider_id, revision, service_date)")
    finally:
        source.execute("DELETE FROM gold.network_vehicle_day WHERE provider_id=%s", (provider,))


def test_edition_resolution_is_provider_scoped_and_unique(source, fact_source, tmp_path):
    provider, _, _ = fact_source
    spec = WindowSpec("silver.routes", provider, "a" * 64)
    ids = []
    try:
        for index in range(2):
            row = source.execute(
                "INSERT INTO core.dataset_versions "
                "(provider_id,feed_endpoint_id,source_ingestion_run_id,"
                "content_hash,checksum_sha256) "
                "SELECT provider_id,feed_endpoint_id,ingestion_run_id,%s,%s "
                "FROM raw.realtime_snapshot_index WHERE provider_id=%s "
                "RETURNING dataset_version_id",
                ("a" * 64, "a" * 64, provider),
            ).fetchone()
            ids.append(row[0])
            source.execute(
                "INSERT INTO silver.routes (provider_id,dataset_version_id,route_id,route_type) "
                "VALUES (%s,%s,'南',3)",
                (provider, ids[-1]),
            )
            if index == 0:
                assert export(source, spec, tmp_path / "edition.csv").rows == 1
                with pytest.raises(ExportRefused, match="window"):
                    recheck(
                        source, WindowSpec(spec.dataset_id, provider + "-other", spec.window_key)
                    )
        with pytest.raises(ExportRefused, match="window"):
            recheck(source, spec)
    finally:
        source.execute("DELETE FROM silver.routes WHERE dataset_version_id=ANY(%s)", (ids,))
        source.execute("DELETE FROM core.dataset_versions WHERE dataset_version_id=ANY(%s)", (ids,))
