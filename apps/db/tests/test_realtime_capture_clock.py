from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from test_gold_realtime_identity_real_db import _capture_base

TORONTO = ZoneInfo("America/Toronto")


@pytest.mark.parametrize(
    "instant",
    [
        "2026-11-14T04:59:30Z",
        "2026-03-08T06:59:30Z",
        "2026-11-01T05:59:30Z",
        "2026-03-08T04:59:30Z",
        "2026-11-01T03:59:30Z",
        "2026-11-14T23:59:30Z",
    ],
)
def test_capture_offsets_share_one_local_and_utc_day(instant):
    now = datetime.fromisoformat(instant)
    base = _capture_base(now)
    # Live callers use offsets 0, 1, 2 and 6; archive callers deliberately use past days.
    captures = [base + timedelta(minutes=offset) for offset in range(7)]
    assert len({captured.astimezone(TORONTO).date() for captured in captures}) == 1
    assert len({captured.astimezone(UTC).date() for captured in captures}) == 1
    # A new serving lane accepts only captures after its initialization instant.
    assert now < base <= now + timedelta(minutes=6, seconds=10)
    assert captures == sorted(set(captures))


@pytest.mark.parametrize("day", ["2026-11-14", "2026-03-08", "2026-11-01"])
def test_capture_window_throughout_boundary_days(day):
    start = datetime.fromisoformat(day).replace(tzinfo=UTC)
    for minute in range(24 * 60):
        test_capture_offsets_share_one_local_and_utc_day(
            (start + timedelta(minutes=minute, seconds=30)).isoformat()
        )
