"""Bounded, idempotent Gold alert-archive sync tests."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pytest

from transit_ops.gold.alert_archive import (
    _ALERT_ARCHIVE_EXISTING_SQL,
    _ALERT_ARCHIVE_SOURCE_SQL,
    _ALERT_ARCHIVE_UPSERT_SQL,
    _stable_alert_id,
    sync_alert_archive_on_connection,
)
from transit_ops.sql_registry import query_name


class _Rows:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def mappings(self):
        return self

    def __iter__(self):
        return iter(self.rows)


class FakeConnection:
    def __init__(self, *, source: list[dict], existing: list[dict] | None = None) -> None:
        self.source = source
        self.existing = existing or []
        self.calls: list[tuple[str | None, object]] = []
        self.writes: list[dict] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        name = query_name(statement)
        self.calls.append((name, params))
        if name == "alerts.archive.source":
            return _Rows(self.source)
        if name == "alerts.archive.existing":
            return _Rows(self.existing)
        if name == "alerts.archive.upsert":
            assert isinstance(params, list)
            self.writes.extend(params)
            return _Rows([])
        raise AssertionError(f"unexpected query: {name}\n{statement}")


START = datetime(2026, 7, 8, 13, 0, tzinfo=UTC)
END = datetime(2026, 7, 10, 19, 0, tzinfo=UTC)


def source_row(**overrides) -> dict:
    row = {
        "alert_id": "stm-source-a",
        "archive_month": date(2026, 7, 1),
        "header_text": "Votre ligne",
        "header_text_en": "Your line",
        "description_text": "Terminus temporaire.",
        "description_text_en": "Temporary terminus.",
        "severity": "WARNING",
        "cause": "CONSTRUCTION",
        "effect": "DETOUR",
        "route_ids": ["45", "10", "45"],
        "stop_ids": ["7002", "7001", "7002"],
        "start_utc": START,
        "end_utc": END,
        "active_periods": [
            {"start_utc": START.isoformat(), "end_utc": END.isoformat()},
            {"start_utc": START.isoformat(), "end_utc": END.isoformat()},
        ],
        "url": "https://www.stm.info/fr/infos/etat-du-service",
        "first_seen_utc": datetime(2026, 7, 8, 12, 55, tzinfo=UTC),
        "last_seen_utc": datetime(2026, 7, 10, 19, 5, tzinfo=UTC),
        "source_from": date(2026, 7, 8),
        "source_to": date(2026, 7, 10),
    }
    row.update(overrides)
    return row


def run_sync(connection: FakeConnection, *, dry_run: bool = False):
    return sync_alert_archive_on_connection(
        connection,
        provider_id="stm",
        from_date=date(2026, 6, 1),
        to_date=date(2026, 7, 31),
        dry_run=dry_run,
        synced_at_utc=datetime(2026, 7, 13, 4, 0, tzinfo=UTC),
    )


def test_source_queries_are_named_bounded_and_uncapped() -> None:
    assert query_name(_ALERT_ARCHIVE_SOURCE_SQL) == "alerts.archive.source"
    assert query_name(_ALERT_ARCHIVE_EXISTING_SQL) == "alerts.archive.existing"
    assert query_name(_ALERT_ARCHIVE_UPSERT_SQL) == "alerts.archive.upsert"

    source = str(_ALERT_ARCHIVE_SOURCE_SQL)
    assert "a.provider_id = :provider_id" in source
    assert ":from_date" in source and ":to_date" in source
    assert "gold.dim_provider" in source
    assert "silver.i3_alert_active_periods" in source
    assert "LIMIT 500" not in source.upper()
    assert "LIMIT " not in source.upper()
    latest_values = source.split("latest_values AS (", 1)[1].split("), seen AS (", 1)[0]
    assert "i3_alert_snapshot_id DESC" in latest_values
    assert "alert_index DESC" in latest_values


def test_stable_alert_id_keeps_upstream_or_synthesizes_deterministically() -> None:
    assert _stable_alert_id("stm", " A-10 ", "H", START, END) == "A-10"
    synthesized = _stable_alert_id("stm", None, "H", START, END)
    assert synthesized == _stable_alert_id("stm", "", "H", START, END)
    assert synthesized == _stable_alert_id("stm", None, "H", START, END)
    assert synthesized.startswith("stm-alert-")
    assert synthesized != _stable_alert_id("stm", None, "Other", START, END)


def test_inverted_range_fails_before_any_query() -> None:
    connection = FakeConnection(source=[])
    with pytest.raises(ValueError, match="from_date"):
        sync_alert_archive_on_connection(
            connection,
            provider_id="stm",
            from_date=date(2026, 7, 2),
            to_date=date(2026, 7, 1),
        )
    assert connection.calls == []


def test_first_sync_inserts_complete_normalized_source() -> None:
    connection = FakeConnection(source=[source_row()])
    result = run_sync(connection)

    assert result.source_from == date(2026, 7, 8)
    assert result.source_to == date(2026, 7, 10)
    assert (result.source_count, result.inserted_count, result.updated_count) == (1, 1, 0)
    assert result.unchanged_count == 0
    assert len(connection.writes) == 1
    written = connection.writes[0]
    assert written["archive_month"] == date(2026, 7, 1)
    assert written["description_text"] == "Terminus temporaire."
    assert written["description_text_en"] == "Temporary terminus."
    assert written["url"].startswith("https://")
    assert written["route_ids"] == ["10", "45"]
    assert written["stop_ids"] == ["7001", "7002"]
    assert json.loads(written["active_periods"]) == [
        {"start_utc": "2026-07-08T13:00:00Z", "end_utc": "2026-07-10T19:00:00Z"}
    ]
    assert len(written["content_hash"]) == 64


def test_source_messages_are_not_truncated_and_scalar_period_is_an_honest_fallback() -> None:
    long_message = "Travaux majeurs. " * 2000
    connection = FakeConnection(
        source=[
            source_row(
                description_text=long_message,
                active_periods=None,
            )
        ]
    )

    run_sync(connection)

    written = connection.writes[0]
    assert written["description_text"] == long_message
    assert json.loads(written["active_periods"]) == [
        {"start_utc": "2026-07-08T13:00:00Z", "end_utc": "2026-07-10T19:00:00Z"}
    ]


def test_changed_sync_preserves_first_partition_and_unions_known_reach() -> None:
    initial = FakeConnection(source=[source_row()])
    run_sync(initial)
    stored = initial.writes[0]

    changed = source_row(
        archive_month=date(2026, 8, 1),
        first_seen_utc=datetime(2026, 7, 9, tzinfo=UTC),
        last_seen_utc=datetime(2026, 7, 11, tzinfo=UTC),
        description_text="Terminus déplacé.",
        route_ids=["45", "747"],
        stop_ids=["7002", "7003"],
    )
    connection = FakeConnection(source=[changed], existing=[stored])
    result = run_sync(connection)

    assert (result.inserted_count, result.updated_count, result.unchanged_count) == (0, 1, 0)
    written = connection.writes[0]
    assert written["archive_month"] == date(2026, 7, 1)
    assert written["first_seen_utc"] == stored["first_seen_utc"]
    assert written["last_seen_utc"] == datetime(2026, 7, 11, tzinfo=UTC)
    assert written["route_ids"] == ["10", "45", "747"]
    assert written["stop_ids"] == ["7001", "7002", "7003"]
    assert written["description_text"] == "Terminus déplacé."


def test_null_later_text_cannot_erase_a_real_message() -> None:
    initial = FakeConnection(source=[source_row()])
    run_sync(initial)
    stored = initial.writes[0]

    connection = FakeConnection(
        source=[source_row(description_text=None, description_text_en=None)],
        existing=[stored],
    )
    result = run_sync(connection)

    assert result.unchanged_count == 1
    assert connection.writes == []


def test_identical_rerun_is_unchanged_and_performs_no_write() -> None:
    initial = FakeConnection(source=[source_row()])
    run_sync(initial)
    stored = initial.writes[0]
    rerun = FakeConnection(source=[source_row()], existing=[stored])

    result = run_sync(rerun)

    assert (result.inserted_count, result.updated_count, result.unchanged_count) == (0, 0, 1)
    assert rerun.writes == []


def test_dry_run_classifies_change_but_performs_no_write() -> None:
    initial = FakeConnection(source=[source_row()])
    run_sync(initial)
    stored = initial.writes[0]
    connection = FakeConnection(
        source=[source_row(description_text="Nouveau terminus")], existing=[stored]
    )

    result = run_sync(connection, dry_run=True)

    assert result.dry_run is True
    assert result.updated_count == 1
    assert connection.writes == []


def test_empty_source_reports_honest_null_bounds_and_zero_counts() -> None:
    connection = FakeConnection(source=[])
    result = run_sync(connection)

    assert result.source_from is None and result.source_to is None
    assert result.source_count == 0
    assert result.inserted_count == result.updated_count == result.unchanged_count == 0
    assert [name for name, _ in connection.calls] == ["alerts.archive.source"]
