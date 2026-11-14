"""Pure canonical COPY construction; snapshot and stream ownership stays with the caller."""

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from psycopg import sql

from transit_ops.history.datasets import (
    HistoryDataset,
    TableSource,
    UndeclaredDataset,
    get_dataset,
    window_start,
)
from transit_ops.lake.table_schema import TableSchema


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


def _declaration(spec: WindowSpec) -> tuple[HistoryDataset, TableSource]:
    try:
        dataset = get_dataset(spec.dataset_id)
    except UndeclaredDataset:
        raise ExportRefused("undeclared") from None
    if not isinstance(dataset.source, TableSource):
        raise ExportRefused("undeclared")
    source = dataset.source
    if (
        not spec.provider_id
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


def order_by(schema: TableSchema) -> sql.Composed:
    columns = {column.name: column.pg_type for column in schema.columns}
    return sql.SQL(", ").join(
        sql.SQL('{} COLLATE "C"').format(sql.Identifier(key))
        if re.fullmatch(r"(?:text|character(?: varying)?(?:\([0-9]+\))?)", columns[key])
        else sql.Identifier(key)
        for key in schema.primary_key
    )


def build_copy_statement(
    spec: WindowSpec, schema: TableSchema, *, dataset_version_id: int | None = None
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
        order_by(schema),
    ), values
