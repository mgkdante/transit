from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy.engine import Connection

from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import ItemsView, Iterator
    from datetime import date

SPINE_WINDOW_CLAUSE = " AND provider_local_date >= :win_start AND provider_local_date <= :win_end"

_GRAIN_TRAILING_DAYS = {"day": 0, "week": 6, "month": 29}


class GrainWindows:
    """Trailing-N-day [start, end] windows anchored on the newest closed day."""

    def __init__(self, anchor: date) -> None:
        self._windows: dict[str, tuple[date, date]] = {
            grain: (anchor - timedelta(days=back), anchor)
            for grain, back in _GRAIN_TRAILING_DAYS.items()
        }

    def __getitem__(self, grain: str) -> tuple[date, date]:
        return self._windows[grain]

    def __contains__(self, grain: object) -> bool:
        return grain in self._windows

    def __iter__(self) -> Iterator[str]:
        return iter(self._windows)

    def items(self) -> ItemsView[str, tuple[date, date]]:
        return self._windows.items()

    def prior(self, grain: str) -> tuple[date, date]:
        win_start, win_end = self._windows[grain]
        win_len = (win_end - win_start).days + 1
        return (win_start - timedelta(days=win_len), win_start - timedelta(days=1))


def current_date_trailing_clause(col: str, *, days: int = 30, tz_alias: str = "dp") -> str:
    return (
        f"{col} >= (CAST(:as_of_utc AS timestamptz) "
        f"AT TIME ZONE {tz_alias}.timezone)::date - {days}"
    )


_AS_OF_SQL = named_query("history.build.as_of", "SELECT now()")


def resolve_as_of(conn: Connection, as_of_utc: datetime | None) -> datetime:
    if as_of_utc is None:
        as_of_utc = conn.execute(_AS_OF_SQL).scalar_one()
    if as_of_utc.tzinfo is None or as_of_utc.utcoffset() is None:
        raise ValueError("as_of_utc must be timezone-aware")
    return as_of_utc
