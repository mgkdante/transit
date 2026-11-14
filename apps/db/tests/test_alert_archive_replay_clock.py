import json
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta

import pytest
from _sqlfakes import NamedQueryConn
from test_alert_archive import FakeConnection, source_row

from transit_ops.gold import alert_archive
from transit_ops.settings import Settings
from transit_ops.snapshots.builders import build_alert_archive
from transit_ops.snapshots.serialization import snapshot_json_bytes

STAMP = datetime(2026, 8, 1, tzinfo=UTC)


class _Engine:
    def __init__(self, connection):
        self.connection = connection

    @contextmanager
    def begin(self):
        yield self.connection


def _reconstruct(monkeypatch, wall, explicit):
    class Meta(type):
        def __instancecheck__(cls, value):
            return isinstance(value, datetime)

    class Clock(datetime, metaclass=Meta):
        @classmethod
        def now(cls, tz=None):
            return wall.astimezone(tz)

    monkeypatch.setattr(alert_archive, "datetime", Clock)
    bounds = alert_archive.alert_archive_default_bounds(
        provider_timezone="America/Toronto", retention_days=365, now_utc=STAMP
    )
    assert bounds == (date(2025, 7, 1), date(2026, 7, 31))
    connection = FakeConnection(source=[source_row()])
    kwargs = {"synced_at_utc": STAMP} if explicit else {}
    result = alert_archive.sync_alert_archive(
        "stm",
        from_date=bounds[0],
        to_date=bounds[1],
        engine=_Engine(connection),
        settings=Settings(_env_file=None),
        **kwargs,
    )
    assert result.synced_at_utc == (STAMP if explicit else wall)
    row = dict(connection.writes[0])
    assert row["updated_at_utc"] == result.synced_at_utc
    # Decode JSON binds as the database does; retain the sync's timestamps.
    row["active_periods"] = json.loads(row["active_periods"])
    row["message"] = json.loads(row["message"]) if row["message"] else None
    row.update(
        provider_timezone="UTC", first_available_date="2026-07-08", last_available_date="2026-07-10"
    )
    archive = build_alert_archive(
        NamedQueryConn({"alerts.archive.publish": [row]}, strict=True),
        "stm",
        generated_utc="2026-08-01T00:00:00Z",
    )
    return {"historic/alerts/index.json": snapshot_json_bytes(archive.index)} | {
        key: snapshot_json_bytes(payload) for key, payload in archive.page_items
    }


@pytest.mark.parametrize("explicit", [False, True])
def test_independent_archive_reconstruction_keys_and_bytes(monkeypatch, explicit):
    wall = datetime(2026, 11, 14, 7, tzinfo=UTC)
    first = _reconstruct(monkeypatch, wall, explicit)
    second = _reconstruct(monkeypatch, wall + timedelta(days=2), explicit)
    assert len(first) > 1
    if explicit:
        assert first == second
    else:
        assert first.keys() != second.keys()
        assert first["historic/alerts/index.json"] != second["historic/alerts/index.json"]
