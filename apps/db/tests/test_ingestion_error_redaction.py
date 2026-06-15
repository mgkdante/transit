"""Unit tests for credential redaction on persisted ingestion error messages.

Audit finding ingestion#3 / x-security#1: build_request_details embeds the
credential in request_url's query string for auth_query_param feeds. When a
download fails, the generic ``except Exception as exc: error_message=str(exc)``
path persists ``str(exc)[:2000]`` into raw.ingestion_runs — and urllib/httpx
error strings frequently include the full URL. That is a latent credential leak
the moment any feed uses query-param auth.

These tests pin redact_error_message (the scrubber) directly, plus the
behaviour that both DB-truth helpers (mark_ingestion_run_failed and
insert_failed_ingestion_run) scrub before persisting. They use a recording
fake — no database required.
"""

from __future__ import annotations

from datetime import UTC, datetime

from transit_ops.ingestion.common import (
    REDACTED_PLACEHOLDER,
    insert_failed_ingestion_run,
    mark_ingestion_run_failed,
    redact_error_message,
)


class _RecordingConnection:
    """Captures executed statements + params and returns a canned id."""

    class _ScalarResult:
        def __init__(self, value: int) -> None:
            self._value = value

        def scalar_one(self) -> int:
            return self._value

    def __init__(self, returned_id: int = 4242) -> None:
        self.executed: list[tuple[str, dict]] = []
        self._returned_id = returned_id

    def execute(self, statement, params=None):  # noqa: ANN001
        self.executed.append((str(statement), dict(params or {})))
        return self._ScalarResult(self._returned_id)


def test_redacts_url_userinfo_password() -> None:
    message = (
        "Connection refused for "
        "postgresql://transit:s3cr3t-pw@db.internal:5432/transit"
    )
    redacted = redact_error_message(message)

    assert "s3cr3t-pw" not in redacted
    assert "transit:" not in redacted  # userinfo block as a whole is gone
    assert REDACTED_PLACEHOLDER in redacted
    # host/scheme survive so the error stays diagnosable
    assert "postgresql://" in redacted
    assert "db.internal" in redacted


def test_redacts_query_param_credential() -> None:
    message = (
        "<HTTPError 401: Unauthorized> for url "
        "https://feed.example.com/tripUpdates?apiKey=LIVE-STM-KEY-123&format=pb"
    )
    redacted = redact_error_message(message)

    assert "LIVE-STM-KEY-123" not in redacted
    assert "apiKey=" + REDACTED_PLACEHOLDER in redacted
    # non-sensitive params survive
    assert "format=pb" in redacted
    # host/path survive
    assert "feed.example.com/tripUpdates" in redacted


def test_redacts_multiple_known_credential_param_names() -> None:
    for param in ("api_key", "apikey", "key", "token", "access_token", "secret", "password"):
        message = f"failed: https://h/x?{param}=SUPERSECRET&keep=1"
        redacted = redact_error_message(message)
        assert "SUPERSECRET" not in redacted, param
        assert "keep=1" in redacted, param


def test_leaves_plain_message_untouched() -> None:
    message = "load-realtime-silver failed: boom (no url, no secret)"
    assert redact_error_message(message) == message


def test_redaction_is_idempotent() -> None:
    message = "https://h/x?token=abc123"
    once = redact_error_message(message)
    twice = redact_error_message(once)
    assert once == twice
    assert "abc123" not in once


def test_mark_ingestion_run_failed_redacts_before_persist() -> None:
    connection = _RecordingConnection()

    mark_ingestion_run_failed(
        connection,
        ingestion_run_id=7,
        completed_at_utc=datetime(2026, 6, 13, 1, 0, 5, tzinfo=UTC),
        http_status_code=401,
        error_message=(
            "<HTTPError 401> https://feed.example.com/x?apiKey=LIVE-STM-KEY-123"
        ),
    )

    _, params = connection.executed[0]
    assert "LIVE-STM-KEY-123" not in params["error_message"]
    assert REDACTED_PLACEHOLDER in params["error_message"]


def test_insert_failed_ingestion_run_redacts_before_persist() -> None:
    connection = _RecordingConnection()

    insert_failed_ingestion_run(
        connection,
        provider_id="stm",
        feed_endpoint_id=3,
        run_kind="silver_load",
        started_at_utc=datetime(2026, 6, 13, 1, 0, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 6, 13, 1, 0, 5, tzinfo=UTC),
        error_message="boom https://h/x?token=abc123xyz",
    )

    _, params = connection.executed[0]
    assert "abc123xyz" not in params["error_message"]
    assert REDACTED_PLACEHOLDER in params["error_message"]


def test_redaction_runs_before_truncation() -> None:
    # A credential just past the 2000-char boundary must still be scrubbed,
    # i.e. redaction happens before the [:2000] truncation, not after.
    connection = _RecordingConnection()
    prefix = "x" * 1990
    error_message = f"{prefix} https://h/p?token=LEAKEDSECRET"

    mark_ingestion_run_failed(
        connection,
        ingestion_run_id=1,
        completed_at_utc=datetime(2026, 6, 13, 1, 0, 5, tzinfo=UTC),
        http_status_code=None,
        error_message=error_message,
    )

    _, params = connection.executed[0]
    assert "LEAKEDSECRET" not in params["error_message"]
    assert len(params["error_message"]) <= 2000
