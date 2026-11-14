"""The shared interface for table-producing and publishing build families."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Protocol, runtime_checkable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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
    timezone: str

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
        try:
            zone = ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError, TypeError) as error:
            raise ValueError(f"invalid IANA timezone: {self.timezone!r}") from error
        if any(day >= self.as_of_utc.astimezone(zone).date() for day in self.local_dates):
            raise ValueError("local_dates must be closed at as_of_utc in the provider timezone")


def utc_days(
    request: BuildRequest, *, lookback_days: int = 0, after_days: int = 0
) -> tuple[str, ...]:
    """UTC windows intersecting each local day, extended by local calendar-day offsets."""
    if any(type(n) is not int or n < 0 for n in (lookback_days, after_days)):
        raise ValueError("day offsets must be nonnegative integers")
    zone = ZoneInfo(request.timezone)
    days: set[str] = set()
    for day in request.local_dates:
        start = datetime.combine(day - timedelta(days=lookback_days), time(), zone).astimezone(UTC)
        end = datetime.combine(day + timedelta(days=after_days + 1), time(), zone).astimezone(UTC)
        current = start.date()
        while current <= (end - timedelta(microseconds=1)).date():
            days.add(current.isoformat())
            current += timedelta(days=1)
    return tuple(sorted(days))


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
