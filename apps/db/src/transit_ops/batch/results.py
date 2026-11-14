from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from types import MappingProxyType


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
        self._rows = [
            BatchRow(row, MappingProxyType(dict(zip(columns, row, strict=True)))) for row in rows
        ]

    def fetchall(self) -> list[BatchRow]:
        rows, self._rows = self._rows, []
        return rows

    def __iter__(self) -> Iterator[BatchRow]:
        return iter(self.fetchall())
