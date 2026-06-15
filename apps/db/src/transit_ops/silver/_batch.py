from __future__ import annotations

from collections.abc import Iterable, Iterator
from itertools import islice

from sqlalchemy.engine import Connection


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
