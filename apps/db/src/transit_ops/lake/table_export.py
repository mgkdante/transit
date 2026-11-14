"""Canonical CSV export and recheck in independently owned read-only snapshots."""

import csv
import hashlib
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any, BinaryIO, Literal

from psycopg import Connection, sql
from psycopg.pq import TransactionStatus

from transit_ops.history.datasets import (
    HistoryDataset,
    TableSource,
    UndeclaredDataset,
    get_dataset,
    window_start,
)
from transit_ops.lake.table_schema import InvalidSchema, TableSchema, UnsupportedColumnType

Row = tuple[Any, ...]


class ExportRefused(ValueError):
    def __init__(
        self, reason: Literal["not_read_only", "undeclared", "window", "timeout_bounds"]
    ) -> None:
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True)
class WindowSpec:
    dataset_id: str
    provider_id: str
    window_key: str
    revision: int = 0


class SchemaDrift(ValueError):
    """Catalog columns or primary key disagree with the expected or declared schema."""


@dataclass(frozen=True)
class ExportedWindow:
    spec: WindowSpec
    csv_path: Path
    content_sha256: str
    content_bytes: int
    rows: int
    schema: TableSchema
    snapshot_at_utc: datetime
    server_version: str


def _declaration(spec: WindowSpec) -> tuple[HistoryDataset, TableSource]:
    if not isinstance(spec.dataset_id, str):
        raise ExportRefused("undeclared")
    try:
        dataset = get_dataset(spec.dataset_id)
    except UndeclaredDataset:
        raise ExportRefused("undeclared") from None
    if not isinstance(dataset.source, TableSource):
        raise ExportRefused("undeclared")
    source = dataset.source
    if (
        dataset.archive_grain not in {"utc_day", "month", "edition"}
        or not isinstance(spec.window_key, str)
        or not isinstance(spec.provider_id, str)
        or not spec.provider_id
        or type(spec.revision) is not int
        or spec.revision < 0
        or (source.revision_column is None and spec.revision != source.fixed_revision)
    ):
        raise ExportRefused("window")
    return dataset, source


def validate_timeout(statement_timeout_s: int) -> None:
    if type(statement_timeout_s) is not int or not 1 <= statement_timeout_s <= 900:
        raise ExportRefused("timeout_bounds")


def window_predicate(
    spec: WindowSpec,
    schema: TableSchema | None = None,
    *,
    dataset_version_id: int | None = None,
) -> tuple[sql.Composed, tuple[object, ...]]:
    """Build row bounds; edition IDs must be resolved uniquely in the caller's snapshot.

    A month with a window column needs the catalog schema to distinguish dates
    from UTC timestamps. Whole-state months are labels, without row bounds.
    """
    dataset, source = _declaration(spec)
    if dataset_version_id is not None and dataset.archive_grain != "edition":
        raise ExportRefused("window")
    try:
        start = window_start(dataset, spec.window_key)
        if source.window_column is None:
            return sql.Composed([]), ()
        column = sql.Identifier(source.window_column)
        if dataset.archive_grain == "edition":
            if type(dataset_version_id) is not int or dataset_version_id <= 0:
                raise ExportRefused("window")
            return sql.SQL("{} = %s").format(column), (dataset_version_id,)
        assert start is not None
        end = start + timedelta(days=1)
        timestamp = dataset.archive_grain == "utc_day"
        if dataset.archive_grain == "month":
            end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
            pg_type = (
                next((c.pg_type for c in schema.columns if c.name == source.window_column), None)
                if schema is not None
                else None
            )
            if pg_type not in {"date", "timestamp with time zone"}:
                raise ExportRefused("window")
            timestamp = pg_type == "timestamp with time zone"
        bounds = (
            (datetime.combine(start, time(), UTC), datetime.combine(end, time(), UTC))
            if timestamp
            else (start, end)
        )
        return sql.SQL("{} >= %s AND {} < %s").format(column, column), bounds
    except (ValueError, OverflowError):
        raise ExportRefused("window") from None


def _text_key(pg_type: str, key: str, text_keys: frozenset[str]) -> bool:
    if key in text_keys or re.fullmatch(
        r'(?:text|citext|name|"char"|bpchar|character(?: varying)?(?:\([0-9]+\))?)(?:\[\])*',
        pg_type,
    ):
        return True
    if re.fullmatch(
        r"boolean|smallint|integer|bigint|real|double precision|date|uuid|bytea|"
        r"timestamp (?:with|without) time zone|numeric(?:\([0-9]+,[0-9]+\))?",
        pg_type,
    ):
        return False
    raise UnsupportedColumnType(f"Key column {key!r} has unsupported type {pg_type!r}")


def order_by(schema: TableSchema, *, text_keys: frozenset[str] = frozenset()) -> sql.Composed:
    columns = {column.name: column.pg_type for column in schema.columns}
    return sql.SQL(", ").join(
        sql.SQL('{} COLLATE "C"').format(sql.Identifier(key))
        if _text_key(columns[key], key, text_keys)
        else sql.Identifier(key)
        for key in schema.primary_key
    )


def build_copy_statement(
    spec: WindowSpec,
    schema: TableSchema,
    *,
    dataset_version_id: int | None = None,
    text_keys: frozenset[str] = frozenset(),
) -> tuple[sql.Composed, tuple[object, ...]]:
    """Select every catalog column unchanged, ordered by the full primary key.

    The caller validates catalog/declaration agreement before using this statement.
    No cast changes PostgreSQL's text for numeric, arrays or JSON.
    """
    _, source = _declaration(spec)
    has_provider = any(column.name == "provider_id" for column in schema.columns)
    if has_provider == (spec.provider_id == "_shared"):
        raise ExportRefused("window")
    predicate, values = window_predicate(spec, schema, dataset_version_id=dataset_version_id)
    predicates = []
    if has_provider:
        predicates.append(sql.SQL("{} = %s").format(sql.Identifier("provider_id")))
        values = (spec.provider_id, *values)
    if predicate.as_string():
        predicates.append(predicate)
    if source.revision_column:
        predicates.append(sql.SQL("{} = %s").format(sql.Identifier(source.revision_column)))
        values = (*values, spec.revision)
    where = (
        sql.SQL(" WHERE {}").format(sql.SQL(" AND ").join(predicates))
        if predicates
        else sql.SQL("")
    )
    return sql.SQL(
        "COPY (SELECT {} FROM {}{} ORDER BY {}) "
        "TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
    ).format(
        sql.SQL(", ").join(sql.Identifier(column.name) for column in schema.columns),
        sql.Identifier(*source.table.split(".")),
        where,
        order_by(schema, text_keys=text_keys),
    ), values


def _catalog(
    connection: Connection[Row], source: TableSource, expected: TableSchema | None
) -> tuple[TableSchema, frozenset[str]]:
    columns = connection.execute(
        "SELECT attname, format_type(atttypid, atttypmod), attnotnull, attcollation <> 0 "
        "FROM pg_attribute WHERE attrelid = %s::regclass AND attnum > 0 "
        "AND NOT attisdropped ORDER BY attnum",
        (source.table,),
    ).fetchall()
    keys = connection.execute(
        "SELECT a.attname FROM pg_index i "
        "CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,n) "
        "JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum "
        "WHERE i.indrelid=%s::regclass AND i.indisprimary "
        "AND k.n <= i.indnkeyatts ORDER BY k.n",
        (source.table,),
    ).fetchall()
    try:
        schema = TableSchema.from_columns([row[:3] for row in columns], [row[0] for row in keys])
    except InvalidSchema as error:
        raise SchemaDrift(str(error)) from error
    if schema.primary_key != source.key_columns or (expected is not None and schema != expected):
        raise SchemaDrift(f"Catalog differs for {source.table}")
    return schema, frozenset(row[0] for row in columns if row[3])


@contextmanager
def _snapshot(
    connection: Connection[Row], spec: WindowSpec, timeout: int, expected: TableSchema | None = None
) -> Iterator[tuple[TableSchema, sql.Composed, tuple[object, ...], datetime, str]]:
    validate_timeout(timeout)
    dataset, source = _declaration(spec)
    if not connection.autocommit or connection.info.transaction_status != TransactionStatus.IDLE:
        raise ExportRefused("not_read_only")
    with connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        settings = dict(
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
            statement_timeout=str(timeout * 1000),
        )
        for key, value in settings.items():
            connection.execute("SELECT set_config(%s, %s, true)", (key, value))
        schema, text_keys = _catalog(connection, source, expected)
        edition = None
        if dataset.archive_grain == "edition":
            matches = connection.execute(
                "SELECT dataset_version_id FROM core.dataset_versions WHERE provider_id=%s "
                "AND COALESCE(checksum_sha256, content_hash)=%s",
                (spec.provider_id, spec.window_key),
            ).fetchall()
            if len(matches) != 1:
                raise ExportRefused("window")
            edition = matches[0][0]
        statement, values = build_copy_statement(
            spec, schema, dataset_version_id=edition, text_keys=text_keys
        )
        row = connection.execute(
            "SELECT clock_timestamp(), current_setting('server_version')"
        ).fetchall()[0]
        yield schema, statement, values, row[0], row[1]


def _copy(
    connection: Connection[Row],
    statement: sql.Composed,
    values: tuple[object, ...],
    output: BinaryIO | None = None,
) -> tuple[str, int, int]:
    hasher, size = hashlib.sha256(), 0
    with connection.cursor() as cursor:
        with cursor.copy(statement, values) as copy:
            for block in copy:
                hasher.update(block)
                size += len(block)
                if output is not None:
                    output.write(block)
        return hasher.hexdigest(), size, cursor.rowcount


def export_window(
    connection: Connection[Row],
    spec: WindowSpec,
    destination: Path,
    *,
    statement_timeout_s: int,
    expected_schema: TableSchema | None = None,
) -> ExportedWindow:
    with _snapshot(connection, spec, statement_timeout_s, expected_schema) as snapshot:
        schema, statement, values, at, version = snapshot
        with destination.open("xb") as output:
            digest, size, rows = _copy(connection, statement, values, output)
    with destination.open(encoding="utf8", newline="") as stream:
        if next(csv.reader(stream), None) != [column.name for column in schema.columns]:
            raise SchemaDrift("CSV header differs from catalog")
    return ExportedWindow(spec, destination, digest, size, rows, schema, at, version)


def recheck_window(
    connection: Connection[Row], spec: WindowSpec, *, statement_timeout_s: int
) -> tuple[str, int, int]:
    with _snapshot(connection, spec, statement_timeout_s) as (_, statement, values, _, _):
        return _copy(connection, statement, values)
