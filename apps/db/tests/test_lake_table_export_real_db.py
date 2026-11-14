import csv
from dataclasses import replace
from functools import partial
from uuid import uuid4

import psycopg
import pytest
from test_rescue_fact_day import fact_source as fact_source
from test_rescue_fact_day import rescue

from transit_ops.history import datasets
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


@pytest.fixture
def owned(source, monkeypatch):
    table = "public.export_" + uuid4().hex
    original = datasets.get_dataset("gold.network_vehicle_day")
    declared = replace(original, dataset_id=table, source=replace(original.source, table=table))
    monkeypatch.setattr(
        datasets, "HISTORY_DATASETS", {**datasets.HISTORY_DATASETS, table: declared}
    )
    source.execute(
        f"CREATE TABLE {table} (provider_id text, revision int, service_date date, "
        "value text NOT NULL, PRIMARY KEY(provider_id,revision,service_date))"
    )
    try:
        source.execute(f"INSERT INTO {table} VALUES ('p',2,'2026-11-01','old')")
        yield WindowSpec(table, "p", "2026-11", 2)
    finally:
        source.execute(f"DROP TABLE {table}")


def test_month_window_of_a_rollup_contains_exactly_its_month(source, owned, tmp_path):
    source.execute(
        f"INSERT INTO {owned.dataset_id} VALUES "
        "('p',2,'2026-10-31','before'),('p',2,'2026-12-01','after')"
    )
    result = export(source, owned, tmp_path / "month.csv")
    with result.csv_path.open(newline="", encoding="utf8") as stream:
        assert [row["service_date"] for row in csv.DictReader(stream)] == ["2026-11-01"]


def test_whole_table_export_of_a_shared_table(source, tmp_path):
    result = export(
        source, WindowSpec("gold.report_labels", "_shared", "2026-11"), tmp_path / "all.csv"
    )
    assert result.rows == source.execute("SELECT count(*) FROM gold.report_labels").fetchone()[0]


@pytest.mark.parametrize("active", [True, False])
def test_export_refuses_a_writable_transaction_and_writes_nothing(source, owned, tmp_path, active):
    source.autocommit = False
    if active:
        source.execute("SELECT 1")
    try:
        with pytest.raises(ExportRefused, match="not_read_only"):
            export(source, owned, tmp_path / "refused.csv")
        assert not list(tmp_path.iterdir())
    finally:
        source.rollback()
        source.autocommit = True


@pytest.mark.parametrize("change", ["value TYPE varchar(1000)", "value DROP NOT NULL"])
def test_recheck_refuses_same_byte_schema_drift(source, owned, tmp_path, change):
    result = export(source, owned, tmp_path / "old.csv")
    source.execute(f"ALTER TABLE {owned.dataset_id} ALTER COLUMN {change}")
    assert recheck(source, owned)[0] == result.content_sha256
    with pytest.raises(SchemaDrift):
        recheck(source, owned, expected_schema=result.schema)


def test_changed_primary_key_is_refused(source, owned, tmp_path):
    source.execute(
        f"ALTER TABLE {owned.dataset_id} DROP CONSTRAINT "
        f"{owned.dataset_id.split('.')[1]}_pkey, ADD PRIMARY KEY(provider_id,service_date,revision)"
    )
    with pytest.raises(SchemaDrift):
        export(source, owned, tmp_path / "key.csv")
    with pytest.raises(SchemaDrift):
        recheck(source, owned)


def test_lock_failure_leaves_no_file_and_same_destination_can_retry(source, owned, tmp_path):
    with psycopg.connect(source.info.dsn) as blocker, blocker.transaction():
        blocker.execute(f"LOCK TABLE {owned.dataset_id} IN ACCESS EXCLUSIVE MODE")
        with pytest.raises(psycopg.errors.LockNotAvailable):
            export(source, owned, tmp_path / "retry.csv")
        assert not list(tmp_path.iterdir())
    assert export(source, owned, tmp_path / "retry.csv").rows == 1
