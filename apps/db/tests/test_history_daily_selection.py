from datetime import UTC, date, datetime
from unittest.mock import Mock
from zoneinfo import ZoneInfo

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


@pytest.mark.parametrize("use_utc", [False, True])
def test_later_processing_during_fall_back_is_changed(monkeypatch, use_utc):
    from transit_ops.history import daily_selection as selection
    from transit_ops.history import ledger

    zone = ZoneInfo("America/Toronto")
    verified = datetime(2026, 11, 1, 1, 50, tzinfo=zone, fold=0)
    changed = datetime(2026, 11, 1, 1, 10, tzinfo=zone, fold=1)
    if use_utc:
        verified, changed = verified.astimezone(UTC), changed.astimezone(UTC)
    day = CaptureDay("network", "capture.trip_updates", date(2026, 10, 30))
    window = ledger.WindowState(
        day.dataset_id,
        day.provider_id,
        0,
        day.utc_date.isoformat(),
        day.utc_date,
        "present",
        changed,
        2,
        1,
        None,
        None,
        None,
        None,
    )
    current = Mock(
        content_version=1,
        state="verified",
        verified_at_utc=verified,
        sealed_at_utc=verified,
        details={"rows_fingerprint": "same"},
    )
    monkeypatch.setattr(ledger, "window_state", lambda *a, **k: window)
    monkeypatch.setattr(ledger, "find_copies", lambda *a, **k: [current])
    monkeypatch.setattr(selection, "rows_fingerprint", lambda *a, **k: "same")
    conn = Mock()
    conn.execute.return_value.one_or_none.return_value = (verified, True)
    result = selection.capture_day_status(conn, day, now=changed)
    assert (result.state, result.reason) == ("needs_work", "working_changed")


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


@pytest.mark.parametrize("hour,expected", [(0, 2), (1, 3)])
def test_empty_floor_is_separate_from_older_evidence(hour, expected):
    conn = Mock()
    conn.execute.side_effect = [Mock(scalars=lambda: ["network"]), []]
    capture_days(conn, datasets=["capture.trip_updates"], start=date.min,
                 end=date(2026, 1, 5), empty_since=datetime(2026, 1, 2, hour, tzinfo=UTC))
    params = conn.execute.call_args.args[1]
    assert params["empty_start_day"] == date(2026, 1, expected)
    assert params["start_day"] == date.min
