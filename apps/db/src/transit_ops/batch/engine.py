import re
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType

import duckdb
from sqlalchemy.dialects.postgresql import JSONB, psycopg
from sqlalchemy.sql.elements import TextClause

from transit_ops.batch.results import BatchResult
from transit_ops.sql_registry import query_name

_IDENTIFIER_CASE = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


class BatchEngineError(RuntimeError):
    pass


class UnnamedQueryRefused(BatchEngineError):
    pass


class InputRefused(BatchEngineError):
    pass


class VariantRefused(BatchEngineError):
    pass


@dataclass(frozen=True)
class BatchInput:
    relation: str
    files: tuple[Path, ...]


class BatchSession:
    def __init__(
        self,
        connection: duckdb.DuckDBPyConnection,
        variants: Mapping[str, TextClause] = MappingProxyType({}),
    ) -> None:
        self._connection = connection
        self._variants = dict(variants)

    def _select(
        self, statement: TextClause, params: Mapping[str, object] | None
    ) -> tuple[TextClause, dict[str, object]]:
        name = query_name(statement)
        if not name:
            raise UnnamedQueryRefused("batch SQL requires a query name")
        original = statement.compile()
        selected = self._variants.get(name, statement)
        if set(original.params) != set(selected.compile().params):
            raise VariantRefused(f"variant bind names differ: {name}")
        return selected, dict(original.construct_params(dict(params or {})))

    def execute(
        self, statement: TextClause, params: Mapping[str, object] | None = None
    ) -> BatchResult:
        from transit_ops.batch.clock_guard import refuse_clock_reads

        statement, values = self._select(statement, params)
        compiled = statement.compile(
            dialect=psycopg.dialect(paramstyle="numeric_dollar")  # type: ignore[no-untyped-call]
        )
        for bind in compiled.binds.values():
            if isinstance(bind.type, JSONB):
                raise BatchEngineError(f"JSONB bind refused: {bind.key}")
        expanded = compiled.construct_expanded_state(values)
        refuse_clock_reads(expanded.statement)
        relation = self._connection.sql(
            expanded.statement,
            params=[expanded.parameters[name] for name in expanded.positiontup or ()],
        )
        if relation is None:
            return BatchResult((), [])
        columns = tuple(relation.columns)
        if len({name.translate(_IDENTIFIER_CASE) for name in columns}) != len(columns):
            raise BatchEngineError(f"duplicate result column names: {columns}")
        for name, kind in zip(columns, relation.types, strict=True):
            if "TIMESTAMP WITH TIME ZONE" in str(kind) and str(kind) != "TIMESTAMP WITH TIME ZONE":
                raise BatchEngineError(f"nested TIMESTAMPTZ refused: {name}")
        zoned = [str(kind) == "TIMESTAMP WITH TIME ZONE" for kind in relation.types]
        if any(zoned):
            relation = relation.project(
                ", ".join(
                    f"CAST(#{index} AS TIMESTAMP)" if is_zoned else f"#{index}"
                    for index, is_zoned in enumerate(zoned, 1)
                )
            )
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
        if item.relation.split(".")[0] in {"pg_catalog", "information_schema", "temp"}:
            raise InputRefused(f"reserved relation: {item.relation}")
        names.add(item.relation)
        for path in item.files:
            if any(char in str(path) + str(path.resolve()) for char in "*?[]{}"):
                raise InputRefused(f"glob path refused: {path}")
        if len(set(path.resolve() for path in item.files)) != len(item.files):
            raise InputRefused(f"duplicate files: {item.files}")
        if any(not path.is_absolute() or not path.is_file() for path in item.files):
            raise InputRefused("inputs must be existing absolute files")


@contextmanager
def open_batch_session(
    inputs: Sequence[BatchInput],
    *,
    workdir: Path,
    variants: Mapping[str, TextClause] = MappingProxyType({}),
) -> Iterator[BatchSession]:
    variants = dict(variants)
    if any(not key or query_name(value) != key for key, value in variants.items()):
        raise VariantRefused("variant query names must match their keys")
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
            expected = None
            for path in item.files:
                scan = connection.read_parquet(str(path.resolve()), hive_partitioning=False)
                actual = list(zip(scan.columns, map(str, scan.types), strict=True))
                if expected is not None and actual != expected:
                    raise InputRefused(f"{path}: schema {actual!r} differs from {expected!r}")
                expected = actual
            files = ", ".join(
                "'" + str(path.resolve()).replace("'", "''") + "'" for path in item.files
            )
            connection.execute(
                f'CREATE VIEW "{schema}"."{name}" AS SELECT * FROM '
                f"read_parquet([{files}], hive_partitioning=false, union_by_name=false)"
            )
        connection.execute("SET temp_directory = ?", [str(workdir / "duckdb-tmp")])
        paths = sorted({str(p.resolve()) for item in inputs for p in item.files})
        connection.execute("SET allowed_paths = ?", [paths])
        connection.execute("SET allowed_directories = ?", [[str(workdir)]])
        connection.execute("SET enable_external_access=false")
        connection.execute("SET lock_configuration=true")
        yield BatchSession(connection, variants)
    finally:
        connection.close()
