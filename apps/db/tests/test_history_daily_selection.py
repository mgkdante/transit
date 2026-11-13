from datetime import UTC, date, datetime
from unittest.mock import Mock

import pytest

from transit_ops.history.daily_selection import CaptureDay, capture_days
from transit_ops.history.datasets import UndeclaredDataset


@pytest.mark.parametrize("datasets", [("unknown",), ("capture.trip_updates", "unknown")])
def test_invalid_dataset_fails_before_reads(datasets):
    conn = Mock()
    with pytest.raises(UndeclaredDataset):
        capture_days(
            conn, datasets=datasets, start=date.today(), end=date.today(), empty_since=None
        )
    conn.execute.assert_not_called()


@pytest.mark.parametrize("start,end", [(date(2026, 2, 2), date(2026, 2, 1)), ("bad", "bad")])
def test_invalid_dates_fail_before_reads(start, end):
    conn = Mock()
    with pytest.raises(ValueError):
        capture_days(conn, datasets=(), start=start, end=end, empty_since=None)
    conn.execute.assert_not_called()


def test_days_order_newest_then_provider_and_dataset():
    old, new = date(2026, 1, 1), date(2026, 1, 2)
    days = [
        CaptureDay("b", "capture.trip_updates", old),
        CaptureDay("b", "capture.trip_updates", new),
        CaptureDay("a", "capture.vehicle_positions", new),
        CaptureDay("a", "capture.trip_updates", new),
    ]
    assert sorted(days) == [days[3], days[2], days[1], days[0]]
    assert CaptureDay("a", "capture.trip_updates", new, empty_since=datetime.now(UTC)) == days[3]


def test_noncapture_dataset_fails_before_reads(monkeypatch):
    from transit_ops.history import datasets

    declaration = datasets.HistoryDataset(
        "table", datasets.TableSource("example", None, ("id",), None, 0), "month", None, (), 1
    )
    monkeypatch.setattr(datasets, "HISTORY_DATASETS", {"table": declaration})
    conn = Mock()
    with pytest.raises(ValueError, match="not a capture"):
        capture_days(
            conn, datasets=("table",), start=date.today(), end=date.today(), empty_since=None
        )
    conn.execute.assert_not_called()
