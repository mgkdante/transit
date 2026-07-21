from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from itertools import chain, islice

from psycopg import sql
from sqlalchemy.engine import Connection


@dataclass(frozen=True, slots=True)
class CopyTarget:
    schema: str
    table: str
    columns: tuple[str, ...]

    def statement(self) -> sql.Composed:
        return sql.SQL("COPY {} ({}) FROM STDIN").format(
            sql.Identifier(self.schema, self.table),
            sql.SQL(", ").join(map(sql.Identifier, self.columns)),
        )


def chunked(
    rows: Iterable[dict[str, object]], chunk_size: int
) -> Iterator[list[dict[str, object]]]:
    iterator = iter(rows)
    while chunk := list(islice(iterator, chunk_size)):
        yield chunk


def execute_batched_insert(
    connection: Connection,
    *,
    statement,
    rows: Iterable[dict[str, object]],
    chunk_size: int,
) -> int:
    row_count = 0
    for chunk in chunked(rows, chunk_size):
        connection.execute(statement, chunk)
        row_count += len(chunk)
    return row_count


def execute_copy_insert(
    connection: Connection,
    *,
    target: CopyTarget,
    rows: Iterable[Mapping[str, object]],
) -> int:
    iterator = iter(rows)
    try:
        first_row = next(iterator)
    except StopIteration:
        return 0

    row_count = 0
    driver_connection = connection.connection.driver_connection
    with driver_connection.cursor() as cursor, cursor.copy(target.statement()) as copy:
        for row in chain((first_row,), iterator):
            copy.write_row(tuple(row[column] for column in target.columns))
            row_count += 1
    return row_count
