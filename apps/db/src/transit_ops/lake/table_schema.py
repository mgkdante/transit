"""Ordered table columns and lossless storage types for table copies."""

import hashlib
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass


class InvalidSchema(ValueError):
    """A table schema cannot identify its columns and primary key."""


class UnsupportedColumnType(ValueError):
    """A column has no supported lossless storage type."""


@dataclass(frozen=True)
class Column:
    name: str
    pg_type: str
    not_null: bool


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


@dataclass(frozen=True)
class TableSchema:
    columns: tuple[Column, ...]
    primary_key: tuple[str, ...]

    @classmethod
    def from_columns(
        cls, rows: Sequence[Sequence[object]], primary_key: Sequence[str]
    ) -> "TableSchema":
        columns = []
        for row in rows:
            if isinstance(row, (str, bytes)) or len(row) != 3:
                raise InvalidSchema("Each column needs a name, PostgreSQL type and not_null")
            name, pg_type, not_null = row
            if (
                not isinstance(name, str)
                or not isinstance(pg_type, str)
                or type(not_null) is not bool
            ):
                raise InvalidSchema(
                    "Column name and type must be strings; not_null must be boolean"
                )
            columns.append(Column(name, pg_type, not_null))
        names = {column.name for column in columns}
        if not columns or len(names) != len(columns):
            raise InvalidSchema("Columns must be nonempty and have unique names")
        if not primary_key or any(name not in names for name in primary_key):
            raise InvalidSchema("Primary key must be nonempty and name existing columns")
        return cls(tuple(columns), tuple(primary_key))

    @classmethod
    def from_json(cls, data: bytes) -> "TableSchema":
        try:
            value = json.loads(data)
            if not isinstance(value, dict) or set(value) != {"columns", "format", "primary_key"}:
                raise InvalidSchema("Expected columns, format and primary_key")
            if type(value["format"]) is not int or value["format"] != 1:
                raise InvalidSchema("Unsupported schema format")
            rows, key = value["columns"], value["primary_key"]
            if not isinstance(rows, list) or not all(isinstance(row, list) for row in rows):
                raise InvalidSchema("Columns must be a list of column rows")
            if not isinstance(key, list) or not all(isinstance(name, str) for name in key):
                raise InvalidSchema("Primary key must be a list of names")
            return cls.from_columns(rows, key)
        except (UnicodeError, json.JSONDecodeError) as error:
            raise InvalidSchema("Invalid schema JSON") from error

    def to_json(self) -> bytes:
        return _canonical({"columns": self._rows(), "format": 1, "primary_key": self.primary_key})

    def columns_sha256(self) -> str:
        return hashlib.sha256(_canonical(self._rows())).hexdigest()

    def _rows(self) -> list[list[object]]:
        return [[column.name, column.pg_type, column.not_null] for column in self.columns]

    def duckdb_types(self) -> dict[str, str]:
        return {column.name: _duckdb_type(column) for column in self.columns}


_TYPES = {
    "text": "VARCHAR",
    "character varying": "VARCHAR",
    "boolean": "BOOLEAN",
    "smallint": "SMALLINT",
    "integer": "INTEGER",
    "bigint": "BIGINT",
    "real": "FLOAT",
    "double precision": "DOUBLE",
    "numeric": "VARCHAR",
    "json": "VARCHAR",
    "jsonb": "VARCHAR",
    "date": "DATE",
    "timestamp with time zone": "TIMESTAMPTZ",
    "timestamp without time zone": "TIMESTAMP",
    "uuid": "UUID",
}


def _duckdb_type(column: Column) -> str:
    pg_type = column.pg_type
    if pg_type in _TYPES:
        return _TYPES[pg_type]
    if pg_type.endswith("[]") or re.fullmatch(r"character(?: varying)?\([0-9]+\)", pg_type):
        return "VARCHAR"
    if match := re.fullmatch(r"numeric\(([0-9]+),([0-9]+)\)", pg_type):
        precision, scale = match.groups()
        return f"DECIMAL({precision},{scale})" if int(precision) <= 38 else "VARCHAR"
    raise UnsupportedColumnType(f"Column {column.name!r} has unsupported type {pg_type!r}")
