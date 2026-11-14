"""The shared interface for table-producing and publishing build families."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Protocol, runtime_checkable

from sqlalchemy.sql.elements import TextClause

from transit_ops.batch.engine import BatchSession


@dataclass(frozen=True)
class BuildRequest:
    provider_id: str
    local_dates: tuple[date, ...]
    as_of_utc: datetime
    fact_retention_days: int
    open_window_days: int

    def __post_init__(self) -> None:
        if self.fact_retention_days < 14:
            raise ValueError(
                "GOLD_FACT_RETENTION_DAYS must be at least 14 to cover the percentile lookback"
            )
        if not 0 < self.open_window_days < self.fact_retention_days:
            raise ValueError(
                "GOLD_REPORTING_OPEN_WINDOW_DAYS must be greater than 0 and less than "
                "GOLD_FACT_RETENTION_DAYS"
            )
        if self.as_of_utc.utcoffset() is None:
            raise ValueError("as_of_utc must be timezone-aware")
        if self.as_of_utc.utcoffset() != timedelta(0):
            raise ValueError("as_of_utc must be UTC")
        if not self.local_dates or any(
            left >= right
            for left, right in zip(self.local_dates, self.local_dates[1:], strict=False)
        ):
            raise ValueError("local_dates must be nonempty, ascending and unique")


@dataclass(frozen=True)
class TableRows:
    relation: str
    columns: tuple[str, ...]
    key: tuple[str, ...]
    rows: tuple[tuple[object, ...], ...]

    def __post_init__(self) -> None:
        if len(set(self.columns)) != len(self.columns) or not set(self.key) <= set(self.columns):
            raise ValueError("key must be a subset of unambiguous columns")
        if any(len(row) != len(self.columns) for row in self.rows):
            raise ValueError("rows must match columns")
        indexes = tuple(self.columns.index(name) for name in self.key)
        keys = [tuple(row[index] for index in indexes) for row in self.rows]
        try:
            ordered = all(left < right for left, right in zip(keys, keys[1:], strict=False))
        except TypeError as error:
            raise ValueError("table key values must be comparable") from error
        if not ordered:
            raise ValueError("rows must have sorted, unique keys")


@dataclass(frozen=True)
class FamilyOutput:
    tables: Mapping[str, TableRows]
    bodies: Mapping[str, bytes]


@dataclass(frozen=True)
class InputNeed:
    relation: str
    window: str

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*", self.relation):
            raise ValueError(f"invalid relation: {self.relation!r}")
        if self.window == "all":
            return
        if self.window.startswith("edition:"):
            if re.fullmatch(r"edition:[^/\\:*?\[\]{}\x00]+", self.window):
                return
        else:
            day = self.window.removeprefix("local:")
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                try:
                    date.fromisoformat(day)
                    return
                except ValueError:
                    pass
        raise ValueError(f"invalid window: {self.window!r}")


@runtime_checkable
class FamilyBuilder(Protocol):
    family_id: str
    tables: tuple[str, ...]
    published_keys: tuple[str, ...]
    variants: Mapping[str, TextClause]

    def inputs(self, request: BuildRequest) -> tuple[InputNeed, ...]: ...

    def build(self, session: BatchSession, request: BuildRequest) -> FamilyOutput: ...
