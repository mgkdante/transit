from contextlib import nullcontext
from datetime import UTC, date, datetime, timedelta
from unittest.mock import Mock

import pytest

from transit_ops.history.datasets import utc_day_closes_at
from transit_ops.history.seal_captures import WindowNotClosed, seal_capture_day


def test_utc_day_close_instant():
    assert utc_day_closes_at(date(2026, 1, 2)) == datetime(2026, 1, 3, 6, tzinfo=UTC)


@pytest.mark.parametrize("offset", [timedelta(), -timedelta(microseconds=1)])
def test_closed_at_exact_instant_only(offset):
    connection = Mock()
    connection.in_transaction.return_value = False
    connection.begin.return_value = nullcontext()
    clock = Mock()
    clock.scalar_one.return_value = utc_day_closes_at(date(2026, 1, 2)) + offset
    feed = Mock()
    feed.one_or_none.return_value = None
    copies = Mock()
    copies.mappings.return_value = []
    connection.execute.side_effect = [copies, Mock(), clock, feed]
    error = LookupError if offset == timedelta() else WindowNotClosed
    with pytest.raises(error):
        seal_capture_day(
            connection,
            Mock(),
            provider_id="network",
            endpoint_key="trip_updates",
            utc_date=date(2026, 1, 2),
            archive_backend="local",
            sealed_by="test",
        )
