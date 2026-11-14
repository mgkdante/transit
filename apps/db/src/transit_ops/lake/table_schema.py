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


def _text(value: object, name: object) -> str:
    if not isinstance(value, str) or not value:
        raise InvalidSchema(f"Column {name!r} needs a nonempty string name and type")
    try:
        value.encode()
    except UnicodeEncodeError as error:
        raise InvalidSchema(f"Column {name!r} contains a lone surrogate") from error
    return value


@dataclass(frozen=True)
class TableSchema:
    columns: tuple[Column, ...]
    primary_key: tuple[str, ...]

    @classmethod
    def from_columns(
        cls, rows: Sequence[Sequence[object]], primary_key: Sequence[str]
    ) -> "TableSchema":
        columns = []
        names: dict[str, bool] = {}
        for row in rows:
            if isinstance(row, (str, bytes)) or len(row) != 3:
                raise InvalidSchema("Each column needs a name, PostgreSQL type and not_null")
            name, pg_type, not_null = row
            name = _text(name, name)
            pg_type = _text(pg_type, name)
            if name in names or type(not_null) is not bool:
                raise InvalidSchema(f"Column {name!r} is duplicated or has non-boolean not_null")
            names[name] = not_null
            columns.append(Column(name, pg_type, not_null))
        if not columns or not primary_key:
            raise InvalidSchema("Columns and primary key must be nonempty")
        if isinstance(primary_key, (str, bytes)):
            raise InvalidSchema(f"Primary key {primary_key!r} must be a sequence of names")
        seen = set()
        for name in primary_key:
            name = _text(name, name)
            if name in seen or not names.get(name, False):
                raise InvalidSchema(f"Key column {name!r} is duplicated, missing or nullable")
            seen.add(name)
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
        """Constrained numeric maps to DECIMAL(p,s) for finite values only."""
        return {column.name: _storage_type(column)[0] for column in self.columns}

    @property
    def postgres_text_columns(self) -> tuple[str, ...]:
        """Column names held as PostgreSQL text, in table order."""
        return tuple(column.name for column in self.columns if _storage_type(column)[1])


_TYPES = {
    "text": "VARCHAR",
    "character varying": "VARCHAR",
    "boolean": "BOOLEAN",
    "smallint": "SMALLINT",
    "integer": "INTEGER",
    "bigint": "BIGINT",
    "real": "FLOAT",
    "double precision": "DOUBLE",
    "date": "DATE",
    "timestamp with time zone": "TIMESTAMPTZ",
    "timestamp without time zone": "TIMESTAMP",
    "uuid": "UUID",
}


def _storage_type(column: Column) -> tuple[str, bool]:
    pg_type = column.pg_type
    if pg_type in _TYPES:
        return _TYPES[pg_type], False
    if pg_type in {"numeric", "json", "jsonb"} or pg_type.endswith("[]"):
        return "VARCHAR", True
    if re.fullmatch(r"character(?: varying)?\([0-9]+\)", pg_type):
        return "VARCHAR", False
    if match := re.fullmatch(r"numeric\(([0-9]+),([0-9]+)\)", pg_type):
        precision, scale = match.groups()
        if 0 <= int(scale) <= int(precision) <= 38 and int(precision) > 0:
            return f"DECIMAL({precision},{scale})", False
    raise UnsupportedColumnType(f"Column {column.name!r} has unsupported type {pg_type!r}")
