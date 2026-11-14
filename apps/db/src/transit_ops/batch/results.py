from collections import deque
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from types import MappingProxyType

from sqlalchemy.exc import MultipleResultsFound, NoResultFound


@dataclass(frozen=True)
class BatchRow:
    _values: tuple[object, ...]
    _mapping: Mapping[str, object]

    def __getitem__(self, index: int) -> object:
        return self._values[index]

    def __getattr__(self, name: str) -> object:
        try:
            return self._mapping[name]
        except KeyError as error:
            raise AttributeError(name) from error

    def __iter__(self) -> Iterator[object]:
        return iter(self._values)


class BatchResult:
    def __init__(self, columns: tuple[str, ...], rows: list[tuple[object, ...]]) -> None:
        self.columns = columns
        self._rows = deque(
            BatchRow(row, MappingProxyType(dict(zip(columns, row, strict=True)))) for row in rows
        )

    def fetchall(self) -> list[BatchRow]:
        rows = list(self._rows)
        self._rows.clear()
        return rows

    def __iter__(self) -> Iterator[BatchRow]:
        while (row := self.fetchone()) is not None:
            yield row

    def fetchone(self) -> BatchRow | None:
        return self._rows.popleft() if self._rows else None

    def first(self) -> BatchRow | None:
        rows = self.fetchall()
        return rows[0] if rows else None

    def one_or_none(self) -> BatchRow | None:
        rows = self.fetchall()
        if len(rows) > 1:
            raise MultipleResultsFound("expected at most one row")
        return rows[0] if rows else None

    def one(self) -> BatchRow:
        row = self.one_or_none()
        if row is None:
            raise NoResultFound("expected one row")
        return row

    def scalar_one(self) -> object:
        return self.one()[0]

    def scalar_one_or_none(self) -> object:
        row = self.one_or_none()
        return row[0] if row is not None else None

    def scalars(self) -> "_Values[object]":
        return _Values(self, lambda row: row[0])

    def mappings(self) -> "_Values[Mapping[str, object]]":
        return _Values(self, lambda row: row._mapping)


class _Values[T]:
    def __init__(self, result: BatchResult, convert: Callable[[BatchRow], T]) -> None:
        self._result, self._convert = result, convert

    def fetchone(self) -> T | None:
        row = self._result.fetchone()
        return self._convert(row) if row is not None else None

    def first(self) -> T | None:
        row = self._result.first()
        return self._convert(row) if row is not None else None

    def __iter__(self) -> Iterator[T]:
        return map(self._convert, self._result)

    def fetchall(self) -> list[T]:
        return [self._convert(row) for row in self._result.fetchall()]

    all = fetchall
