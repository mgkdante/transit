"""The shared interface for table-producing and publishing build families."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Protocol, runtime_checkable

from sqlalchemy.sql.elements import TextClause

from transit_ops.batch.engine import BatchSession
from transit_ops.gold.rollups import PERCENTILE_LOOKBACK_DAYS


@dataclass(frozen=True)
class BuildRequest:
    provider_id: str
    local_dates: tuple[date, ...]
    as_of_utc: datetime
    fact_retention_days: int
    open_window_days: int

    def __post_init__(self) -> None:
        if not isinstance(self.provider_id, str) or not self.provider_id.strip():
            raise ValueError("provider_id must be a nonempty string")
        if not isinstance(self.local_dates, tuple) or any(
            type(d) is not date for d in self.local_dates
        ):
            raise ValueError("local_dates must be a tuple of dates")
        if self.fact_retention_days < PERCENTILE_LOOKBACK_DAYS + 1:
            raise ValueError(
                f"GOLD_FACT_RETENTION_DAYS must be at least {PERCENTILE_LOOKBACK_DAYS + 1} "
                "to cover the percentile lookback"
            )
        if not 0 < self.open_window_days < self.fact_retention_days:
            raise ValueError(
                "GOLD_REPORTING_OPEN_WINDOW_DAYS must be greater than 0 and less than "
                "GOLD_FACT_RETENTION_DAYS"
            )
        if not isinstance(self.as_of_utc, datetime) or self.as_of_utc.utcoffset() is None:
            raise ValueError("as_of_utc must be timezone-aware")
        object.__setattr__(self, "as_of_utc", self.as_of_utc.astimezone(UTC))
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
        if not self.key:
            raise ValueError("key must be nonempty")
        if len(set(self.columns)) != len(self.columns) or not set(self.key) <= set(self.columns):
            raise ValueError("key must be a subset of unambiguous columns")
        if any(len(row) != len(self.columns) for row in self.rows):
            raise ValueError("rows must match columns")
        indexes = tuple(self.columns.index(name) for name in self.key)
        keys = [tuple(row[index] for index in indexes) for row in self.rows]
        if any(value is None for key in keys for value in key):
            raise ValueError("NULL key values refused")
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

    def __post_init__(self) -> None:
        if any(name != table.relation for name, table in self.tables.items()):
            raise ValueError("table relation must match its mapping key")
        if any(not isinstance(body, bytes) for body in self.bodies.values()):
            raise ValueError("bodies must be bytes")


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
            if re.fullmatch(r"edition:[0-9]+", self.window):
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
