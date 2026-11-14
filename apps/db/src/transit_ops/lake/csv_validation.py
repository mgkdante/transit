"""Refuse malformed records and values that cannot survive a typed CSV read."""

import csv
import re
import struct
from pathlib import Path

import duckdb

from transit_ops.lake.table_schema import TableSchema

CSV_OPTIONS = (
    "auto_detect=false, header=true, delim=',', quote='\"', escape='\"', nullstr='', "
    "allow_quoted_nulls=false, strict_mode=true, ignore_errors=false, hive_partitioning=false"
)


class InvalidCsvValue(ValueError):
    """A CSV record or column value is malformed or unsupported."""

    def __init__(self, column: str, row: int, value: object) -> None:
        self.column, self.row, self.value = column, row, value
        super().__init__(f"Column {column!r}, row {row}, value {value!r}: invalid CSV value")


def _record_shapes(path: Path, columns: tuple[str, ...]) -> None:
    # PostgreSQL text fields can exceed the stdlib parser's default limit.
    csv.field_size_limit((1 << (8 * struct.calcsize("l") - 1)) - 1)
    with path.open(encoding="utf-8", newline="") as source:
        reader = csv.reader(source, strict=True)
        try:
            for row, record in enumerate(reader, 1):
                if row > 1 and len(record) != len(columns):
                    raise InvalidCsvValue("<record>", row, tuple(record))
                # A leading value must not be mistaken for a byte-order mark.
                if row == 2 and record[0].startswith("\ufeff"):
                    raise InvalidCsvValue(columns[0], row, record[0])
        except (csv.Error, UnicodeError) as error:
            raise InvalidCsvValue("<record>", max(2, reader.line_num), str(error)) from error


def _tokens(values: list[str | None], kind: str, column: str, start: int) -> None:
    for offset, value in enumerate(values):
        if value is None:
            continue
        invalid = (
            (kind in {"SMALLINT", "INTEGER", "BIGINT"} and not re.fullmatch(r"-?[0-9]+", value))
            or (kind.startswith(("DATE", "TIMESTAMP")) and value.upper().endswith(" BC"))
            or (
                kind.startswith("DECIMAL")
                and value.casefold().lstrip("+-") in {"nan", "infinity", "inf"}
            )
        )
        if invalid:
            raise InvalidCsvValue(column, start + offset, value)


def _batch(
    connection: duckdb.DuckDBPyConnection,
    rows: list[tuple[object, ...]],
    types: dict[str, str],
    start: int,
) -> None:
    for index, (column, kind) in enumerate(types.items()):
        if kind == "VARCHAR":
            continue
        values = [None if row[index] is None else str(row[index]) for row in rows]
        _tokens(values, kind, column, start)
        invalid = connection.execute(
            f"SELECT ordinal, value FROM unnest(?) WITH ORDINALITY AS t(value, ordinal) "
            f"WHERE value IS NOT NULL AND TRY_CAST(value AS {kind}) IS NULL "
            "ORDER BY ordinal LIMIT 1",
            [values],
        ).fetchone()
        if invalid:
            raise InvalidCsvValue(column, start + int(invalid[0]) - 1, invalid[1])


def validate_csv(connection: duckdb.DuckDBPyConnection, path: Path, schema: TableSchema) -> None:
    if any(character in str(path) for character in "*?[]{}"):
        raise ValueError(f"Glob characters in path: {path}")
    types = schema.duckdb_types()
    _record_shapes(path, tuple(types))
    try:
        with connection.cursor() as source, connection.cursor() as checker:
            source.execute(
                f"SELECT * FROM read_csv(?, columns=?, {CSV_OPTIONS})",
                [str(path), dict.fromkeys(types, "VARCHAR")],
            )
            checker.execute("SET TimeZone='UTC'")
            row = 2
            while batch := source.fetchmany(4096):
                _batch(checker, batch, types, row)
                row += len(batch)
    except duckdb.Error as error:
        message = str(error)
        line = re.search(r"(?:Line|line):? (\d+)", message)
        column = re.search(r'column "([^"]+)"', message)
        raise InvalidCsvValue(
            column[1] if column else "<record>", int(line[1]) if line else 2, message
        ) from error
