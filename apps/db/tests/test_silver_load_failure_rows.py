"""Unit tests for insert_failed_ingestion_run (slice-9.1.1o).

The realtime worker's silver-load failures left zero DB trace before this
slice (the 14h alerts.json freeze was invisible to every DB query). This
helper persists a completed status='failed' row with run_kind='silver_load'
so failure history is queryable. These tests use a recording fake to pin the
SQL shape, the literal 'failed' status, the bound run_kind/error params, the
2000-char truncation, and the returned id type — without touching a database.
"""

from __future__ import annotations

from datetime import UTC, datetime

from transit_ops.ingestion.common import insert_failed_ingestion_run


class _ScalarResult:
    def __init__(self, value: int) -> None:
        self._value = value

    def scalar_one(self) -> int:
        return self._value


class _RecordingConnection:
    """Captures executed statements + params and returns a canned id."""

    def __init__(self, returned_id: int = 4242) -> None:
        self.executed: list[tuple[str, dict]] = []
        self._returned_id = returned_id

    def execute(self, statement, params=None):  # noqa: ANN001
        self.executed.append((str(statement), dict(params or {})))
        return _ScalarResult(self._returned_id)


def test_insert_failed_ingestion_run_writes_single_completed_failed_row() -> None:
    connection = _RecordingConnection(returned_id=99)
    started = datetime(2026, 6, 13, 1, 0, 0, tzinfo=UTC)
    completed = datetime(2026, 6, 13, 1, 0, 5, tzinfo=UTC)

    run_id = insert_failed_ingestion_run(
        connection,
        provider_id="stm",
        feed_endpoint_id=7,
        run_kind="silver_load",
        started_at_utc=started,
        completed_at_utc=completed,
        error_message="load-realtime-silver failed: boom",
    )

    assert run_id == 99
    assert isinstance(run_id, int)
    assert len(connection.executed) == 1
    sql, params = connection.executed[0]

    assert "INSERT INTO raw.ingestion_runs" in sql
    assert "RETURNING ingestion_run_id" in sql
    # status is a literal 'failed' (not a bound param) — mirrors the
    # 'running'/'succeeded' literals in the sibling helpers.
    assert "'failed'" in sql
    # completed row: started == requested, completed set, status failed.
    assert params["provider_id"] == "stm"
    assert params["feed_endpoint_id"] == 7
    assert params["run_kind"] == "silver_load"
    assert params["started_at_utc"] == started
    assert params["completed_at_utc"] == completed
    assert params["error_message"] == "load-realtime-silver failed: boom"
    # http_status_code defaults to None for a load failure (no HTTP call).
    assert params["http_status_code"] is None


def test_insert_failed_ingestion_run_truncates_error_message() -> None:
    connection = _RecordingConnection()
    long_message = "x" * 5000

    insert_failed_ingestion_run(
        connection,
        provider_id="stm",
        feed_endpoint_id=3,
        run_kind="silver_load",
        started_at_utc=datetime(2026, 6, 13, 1, 0, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 6, 13, 1, 0, 5, tzinfo=UTC),
        error_message=long_message,
    )

    _, params = connection.executed[0]
    assert len(params["error_message"]) == 2000
    assert params["error_message"] == "x" * 2000


def test_insert_failed_ingestion_run_passes_through_http_status_code() -> None:
    connection = _RecordingConnection()

    insert_failed_ingestion_run(
        connection,
        provider_id="stm",
        feed_endpoint_id=3,
        run_kind="silver_load",
        started_at_utc=datetime(2026, 6, 13, 1, 0, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 6, 13, 1, 0, 5, tzinfo=UTC),
        error_message="boom",
        http_status_code=503,
    )

    _, params = connection.executed[0]
    assert params["http_status_code"] == 503
