"""Window policy for the spine readers — TWO distinct window families.

1. Anchor-based trailing grains (`GrainWindows`): [start, end] date windows
   anchored on an entity's newest CLOSED day, with a same-length `prior`
   window for period-over-period deltas. Bounded in SQL by
   SPINE_WINDOW_CLAUSE (:win_start/:win_end binds).
2. Current-date trailing clauses (`current_date_trailing_clause`): the
   now()-anchored provider-local trailing-N-day predicate the receipts /
   occupancy / alert-history reads use.

Never conflate the two: an anchor window is reproducible per closed data,
a now() window moves with the wall clock.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import ItemsView, Iterator
    from datetime import date

# Bounded windowed-read fragment for the spine projectors (both spines store
# provider_local_date).
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
        """The immediately-preceding same-length window (ends the day before start)."""
        win_start, win_end = self._windows[grain]
        win_len = (win_end - win_start).days + 1
        return (win_start - timedelta(days=win_len), win_start - timedelta(days=1))


def current_date_trailing_clause(col: str, *, days: int = 30, tz_alias: str = "dp") -> str:
    """`{col} >= (now() AT TIME ZONE {tz_alias}.timezone)::date - {days}` — the
    provider-local current-date trailing window predicate (P0 trailing-30 sites)."""
    return f"{col} >= (now() AT TIME ZONE {tz_alias}.timezone)::date - {days}"
