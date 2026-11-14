import re
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import duckdb
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql.elements import TextClause

from transit_ops.batch.results import BatchResult
from transit_ops.sql_registry import query_name


class BatchEngineError(RuntimeError):
    pass


class UnnamedQueryRefused(BatchEngineError):
    pass


class InputRefused(BatchEngineError):
    pass


@dataclass(frozen=True)
class BatchInput:
    relation: str
    files: tuple[Path, ...]


class BatchSession:
    def __init__(self, connection: duckdb.DuckDBPyConnection) -> None:
        self._connection = connection

    def execute(
        self, statement: TextClause, params: Mapping[str, object] | None = None
    ) -> BatchResult:
        if not query_name(statement):
            raise UnnamedQueryRefused("batch SQL requires a query name")
        compiled = statement.compile(
            dialect=postgresql.dialect(paramstyle="numeric_dollar")  # type: ignore[no-untyped-call]
        )
        values = compiled.construct_params(dict(params or {}))
        relation = self._connection.sql(
            str(compiled), params=[values[name] for name in compiled.positiontup or ()]
        )
        if relation is None:
            return BatchResult((), [])
        columns = tuple(relation.columns)
        zoned = [str(kind) == "TIMESTAMP WITH TIME ZONE" for kind in relation.types]
        if any(zoned):
            expressions = []
            for name, is_zoned in zip(columns, zoned, strict=True):
                quoted = '"' + name.replace('"', '""') + '"'
                expressions.append(
                    f"CAST({quoted} AS TIMESTAMP) AS {quoted}" if is_zoned else quoted
                )
            relation = relation.project(", ".join(expressions))
        rows = [
            tuple(
                value.replace(tzinfo=UTC) if is_zoned and isinstance(value, datetime) else value
                for value, is_zoned in zip(row, zoned, strict=True)
            )
            for row in relation.fetchall()
        ]
        return BatchResult(columns, rows)


def _validate(inputs: Sequence[BatchInput]) -> None:
    names: set[str] = set()
    for item in inputs:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*", item.relation):
            raise InputRefused(f"invalid relation: {item.relation!r}")
        if item.relation in names or not item.files:
            raise InputRefused("duplicate relation or empty files")
        names.add(item.relation)
        if any(not path.is_absolute() or not path.is_file() for path in item.files):
            raise InputRefused("inputs must be existing absolute files")


@contextmanager
def open_batch_session(inputs: Sequence[BatchInput], *, workdir: Path) -> Iterator[BatchSession]:
    _validate(inputs)
    workdir = workdir.resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect(
        ":memory:",
        config={
            "threads": "1",
            "integer_division": "true",
            "default_null_order": "nulls_last_on_asc_first_on_desc",
            "preserve_insertion_order": "true",
            "autoinstall_known_extensions": "false",
            "autoload_known_extensions": "false",
        },
    )
    try:
        connection.execute("SET TimeZone='UTC'")
        if connection.execute("SELECT current_setting('default_collation')").fetchone() != ("",):
            raise BatchEngineError("batch requires binary collation")
        for item in inputs:
            schema, name = item.relation.split(".")
            connection.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
            files = ", ".join(
                "'" + str(path.resolve()).replace("'", "''") + "'" for path in item.files
            )
            connection.execute(
                f'CREATE VIEW "{schema}"."{name}" AS SELECT * FROM read_parquet([{files}])'
            )
        connection.execute("SET temp_directory = ?", [str(workdir / "duckdb-tmp")])
        directories = sorted(
            {str(workdir), *(str(p.resolve().parent) for i in inputs for p in i.files)}
        )
        connection.execute("SET allowed_directories = ?", [directories])
        connection.execute("SET enable_external_access=false")
        connection.execute("SET lock_configuration=true")
        yield BatchSession(connection)
    finally:
        connection.close()
