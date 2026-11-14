"""Server and fault-boundary proofs for the canonical COPY exporter."""

import csv
import io
import os
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace

import psycopg
import pytest
from test_lake_table_export_real_db import export, recheck
from test_lake_table_export_real_db import owned as owned
from test_lake_table_export_real_db import source as source
from test_rescue_fact_day import fact_source as fact_source

from transit_ops.history import datasets
from transit_ops.lake import table_export as engine

CANONICAL = dict(
    TimeZone="UTC",
    DateStyle="ISO, YMD",
    IntervalStyle="iso_8601",
    extra_float_digits="1",
    bytea_output="hex",
    client_encoding="UTF8",
    lock_timeout="1s",
    idle_in_transaction_session_timeout="15s",
    work_mem="16MB",
    max_parallel_workers_per_gather="0",
    statement_timeout="1min",
    transaction_isolation="repeatable read",
    transaction_read_only="on",
)
HOSTILE = dict(
    TimeZone="Pacific/Honolulu",
    DateStyle="SQL, DMY",
    IntervalStyle="postgres_verbose",
    extra_float_digits="-3",
    bytea_output="escape",
    client_encoding="LATIN1",
    lock_timeout="9s",
    idle_in_transaction_session_timeout="23s",
    work_mem="8MB",
    max_parallel_workers_per_gather="2",
    statement_timeout="17s",
)


def settings(connection):
    return dict(
        zip(
            CANONICAL,
            (
                row[0]
                for row in connection.execute(
                    "SELECT current_setting(name) FROM unnest(%s::text[]) AS name",
                    (list(CANONICAL),),
                ).fetchall()
            ),
            strict=True,
        )
    )


@pytest.fixture
def observe(source, monkeypatch):
    observations = []

    class Cursor(psycopg.Cursor):
        def copy(self, statement, params=None, **kwargs):
            observations.append((settings(self.connection), statement.as_string(self.connection)))
            return super().copy(statement, params, **kwargs)

    monkeypatch.setattr(source, "cursor_factory", Cursor)
    return observations


@pytest.fixture
def typed(source, owned):
    domain = owned.dataset_id + "_key"
    source.execute(f"CREATE DOMAIN {domain} AS text")
    try:
        source.execute(
            f"ALTER TABLE {owned.dataset_id} ALTER COLUMN provider_id TYPE {domain}, "
            "ADD amount numeric, ADD bins smallint[], ADD metadata jsonb, "
            "ADD ratio double precision, ADD at timestamptz, ADD data bytea, ADD span interval"
        )
        source.execute(
            f"UPDATE {owned.dataset_id} SET value='南', "
            "amount=123456789012345678901234567890.2300, bins=ARRAY[1,NULL,-2]::smallint[], "
            'metadata=\'{"b":2,"a":1}\'::jsonb, ratio=1.0000000000000002, '
            "at='2026-11-01 12:34:56.123456+00', data='\\x00ff', span='1 day 2:03:04'"
        )
        yield owned
    finally:
        source.execute(f"ALTER TABLE {owned.dataset_id} ALTER COLUMN provider_id TYPE text")
        source.execute(f"DROP DOMAIN {domain}")


def expected_bytes(result):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow([column.name for column in result.schema.columns])
    writer.writerow(
        [
            "p",
            "2",
            "2026-11-01",
            "南",
            "123456789012345678901234567890.2300",
            "{1,NULL,-2}",
            '{"a": 1, "b": 2}',
            "1.0000000000000002",
            "2026-11-01 12:34:56.123456+00",
            "\\x00ff",
            "P1DT2H3M4S",
        ]
    )
    return stream.getvalue().encode("utf8")


def test_hostile_session_actual_settings_restore_and_server_bytes(source, typed, observe, tmp_path):
    for key, value in HOSTILE.items():
        source.execute("SELECT set_config(%s,%s,false)", (key, value))
    before = settings(source)
    result = export(source, typed, tmp_path / "types.csv")
    assert result.csv_path.read_bytes() == expected_bytes(result)
    assert settings(source) == before
    assert recheck(source, typed, expected_schema=result.schema) == (
        result.content_sha256,
        result.content_bytes,
        result.rows,
    )
    assert settings(source) == before
    assert [state for state, _ in observe] == [CANONICAL, CANONICAL]
    assert all("ENCODING 'UTF8'" in statement for _, statement in observe)
    assert result.schema.columns[0].pg_type.endswith("_key")
    assert all('"provider_id" COLLATE "C"' in statement for _, statement in observe)


@pytest.fixture
def edition(source, owned, fact_source, monkeypatch):
    provider = fact_source[0]
    row = source.execute(
        "INSERT INTO core.dataset_versions "
        "(provider_id,feed_endpoint_id,source_ingestion_run_id,content_hash,checksum_sha256) "
        "SELECT provider_id,feed_endpoint_id,ingestion_run_id,%s,%s "
        "FROM raw.realtime_snapshot_index "
        "WHERE provider_id=%s RETURNING dataset_version_id",
        ("b" * 64, "b" * 64, provider),
    ).fetchone()
    version = row[0]
    try:
        source.execute(f"ALTER TABLE {owned.dataset_id} ADD dataset_version_id bigint")
        source.execute(
            f"UPDATE {owned.dataset_id} SET provider_id=%s,dataset_version_id=%s",
            (provider, version),
        )
        declared = datasets.get_dataset(owned.dataset_id)
        declared = replace(
            declared,
            archive_grain="edition",
            source=replace(declared.source, window_column="dataset_version_id"),
        )
        monkeypatch.setattr(
            datasets, "HISTORY_DATASETS", {**datasets.HISTORY_DATASETS, owned.dataset_id: declared}
        )
        yield replace(owned, provider_id=provider, window_key="b" * 64)
    finally:
        source.execute("DELETE FROM core.dataset_versions WHERE dataset_version_id=%s", (version,))


def test_writer_commits_between_edition_resolution_and_copy(
    source, edition, monkeypatch, tmp_path, real_db_engine
):
    commits = []
    arguments = real_db_engine.url.translate_connect_args(username="user", database="dbname")

    class Cursor(psycopg.Cursor):
        def copy(self, statement, params=None, **kwargs):
            if not commits:
                with psycopg.connect(**arguments, autocommit=True) as writer:
                    writer.execute(f"UPDATE {edition.dataset_id} SET value='new'")
                commits.append(True)
            return super().copy(statement, params, **kwargs)

    monkeypatch.setattr(source, "cursor_factory", Cursor)
    result = export(source, edition, tmp_path / "snapshot.csv")
    with result.csv_path.open(newline="", encoding="utf8") as stream:
        assert [row["value"] for row in csv.DictReader(stream)] == ["old"]
    assert recheck(source, edition, expected_schema=result.schema)[0] != result.content_sha256


class ProtocolSource:
    """DB boundary double: real file operations, controllable COPY stream failure."""

    autocommit = True
    info = SimpleNamespace(transaction_status=psycopg.pq.TransactionStatus.IDLE)
    rowcount = 1
    column_type = "text"

    def __init__(self, failure=None):
        self.failure = failure

    @contextmanager
    def transaction(self):
        yield

    def execute(self, statement, params=None):
        rows = []
        if "pg_attribute WHERE" in statement:
            rows = [
                ("provider_id", self.column_type, True, True),
                ("revision", "integer", True, False),
                ("service_date", "date", True, False),
            ]
        elif "pg_index" in statement:
            rows = [("provider_id",), ("revision",), ("service_date",)]
        elif "clock_timestamp" in statement:
            rows = [(datetime(2026, 11, 1, tzinfo=UTC), "test-server")]
        return SimpleNamespace(fetchall=lambda: rows)

    @contextmanager
    def cursor(self):
        yield self

    @contextmanager
    def copy(self, statement, params):
        yield self.blocks()

    def blocks(self):
        yield b"wrong\n" if self.failure == "header" else b"provider_id,revision,service_date\n"
        yield b"p,2,2026-11-01\n"
        if isinstance(self.failure, BaseException):
            raise self.failure


@pytest.mark.parametrize(
    "failure",
    [
        KeyboardInterrupt(),
        psycopg.errors.LockNotAvailable(),
        psycopg.errors.QueryCanceled(),
        "header",
    ],
)
def test_failed_stream_or_header_never_publishes_and_can_retry(tmp_path, failure):
    spec = engine.WindowSpec("gold.network_vehicle_day", "p", "2026-11", 2)
    error = engine.SchemaDrift if failure == "header" else type(failure)
    with pytest.raises(error):
        export(ProtocolSource(failure), spec, tmp_path / "export.csv")
    assert not list(tmp_path.iterdir())
    result = export(ProtocolSource(), spec, tmp_path / "export.csv")
    assert result.csv_path.read_bytes() == b"provider_id,revision,service_date\np,2,2026-11-01\n"


def test_recheck_compares_fresh_schema_at_the_protocol_boundary(tmp_path):
    connection = ProtocolSource()
    spec = engine.WindowSpec("gold.network_vehicle_day", "p", "2026-11", 2)
    result = export(connection, spec, tmp_path / "old.csv")
    connection.column_type = "character varying(1000)"
    assert recheck(connection, spec)[0] == result.content_sha256
    with pytest.raises(engine.SchemaDrift):
        recheck(connection, spec, expected_schema=result.schema)


def test_fsync_precedes_exclusive_publication_and_collision_preserves_bytes(tmp_path, monkeypatch):
    events = []
    sync, link = os.fsync, os.link

    def synced(fd):
        sync(fd)
        events.append("synced")

    def publish(temporary, destination):
        assert events[-1] == "synced"
        assert temporary.read_bytes().startswith(b"provider_id,revision,service_date\n")
        link(temporary, destination)
        events.append("published")

    monkeypatch.setattr(os, "fsync", synced)
    monkeypatch.setattr(os, "link", publish)
    spec = engine.WindowSpec("gold.network_vehicle_day", "p", "2026-11", 2)
    path = tmp_path / "complete.csv"
    export(ProtocolSource(), spec, path)
    assert events == ["synced", "published"]
    original = path.read_bytes()
    with pytest.raises(FileExistsError):
        export(ProtocolSource(), spec, path)
    assert path.read_bytes() == original
    assert list(tmp_path.iterdir()) == [path]


def test_edition_resolution_is_provider_scoped_and_unique(source, fact_source, tmp_path):
    provider, _, _ = fact_source
    spec = engine.WindowSpec("silver.routes", provider, "a" * 64)
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
                with pytest.raises(engine.ExportRefused, match="window"):
                    recheck(
                        source,
                        engine.WindowSpec(spec.dataset_id, provider + "-other", spec.window_key),
                    )
        with pytest.raises(engine.ExportRefused, match="window"):
            recheck(source, spec)
    finally:
        source.execute("DELETE FROM silver.routes WHERE dataset_version_id=ANY(%s)", (ids,))
        source.execute("DELETE FROM core.dataset_versions WHERE dataset_version_id=ANY(%s)", (ids,))
