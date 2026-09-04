"""Safety policy tests for the real-database session fixture."""

from __future__ import annotations

from collections.abc import Iterator

import conftest
import pytest


class _FakeEngine:
    def __init__(self) -> None:
        self.disposed = False

    def dispose(self) -> None:
        self.disposed = True


@pytest.mark.parametrize(
    ("database_url", "confirmation"),
    [
        (
            "postgresql://transit_ci:remote-secret@db.example.invalid/transit_ci",
            "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE",
        ),
        (
            "postgresql://transit:local-secret@localhost/transit",
            "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE",
        ),
        ("postgresql://transit_ci:local-secret@localhost/transit_ci", None),
        ("postgresql://transit_ci:local-secret@localhost/transit_ci", "true"),
        (
            "not a database url containing malformed-secret",
            "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE",
        ),
        (
            "postgresql+psycopg://transit_ci@localhost/transit_ci"
            "?user=postgres&dbname=transit&hostaddr=203.0.113.10"
            "&password=query-secret",
            "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE",
        ),
    ],
)
def test_real_db_fixture_refuses_unsafe_targets_before_engine_creation(
    monkeypatch: pytest.MonkeyPatch, database_url: str, confirmation: str | None
) -> None:
    engine_calls: list[str] = []
    monkeypatch.setenv("TRANSIT_TEST_DATABASE_URL", database_url)
    if confirmation is not None:
        monkeypatch.setenv("TRANSIT_TEST_DATABASE_DISPOSABLE", confirmation)
    else:
        monkeypatch.delenv("TRANSIT_TEST_DATABASE_DISPOSABLE", raising=False)
    monkeypatch.setattr(
        conftest,
        "create_engine",
        lambda url: engine_calls.append(url) or _FakeEngine(),
    )

    fixture = conftest.real_db_engine.__wrapped__()
    with pytest.raises(RuntimeError, match="(?i)database target .*policy failed") as exc:
        next(fixture)

    message = str(exc.value)
    assert engine_calls == []
    assert "remote-secret" not in message
    assert "local-secret" not in message
    assert "malformed-secret" not in message
    assert "query-secret" not in message
    assert database_url not in message


def test_real_db_fixture_without_url_preserves_offline_skip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TRANSIT_TEST_DATABASE_URL", raising=False)
    monkeypatch.delenv("TRANSIT_TEST_DATABASE_DISPOSABLE", raising=False)
    engine_calls: list[str] = []
    monkeypatch.setattr(
        conftest,
        "create_engine",
        lambda url: engine_calls.append(url) or _FakeEngine(),
    )

    fixture = conftest.real_db_engine.__wrapped__()
    with pytest.raises(pytest.skip.Exception, match="real-DB tests skipped"):
        next(fixture)

    assert engine_calls == []


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+psycopg://transit_ci@localhost:5432/transit_ci",
        "postgresql://postgres@127.0.0.1/transit_test",
        "postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/transit-repro",
        "postgresql+psycopg://transit_ci@/transit_ci?host=localhost:5432",
        "postgresql+psycopg://ignored@localhost/ignored?user=transit_ci&dbname=transit_ci",
    ],
)
def test_real_db_fixture_yields_and_disposes_acknowledged_local_targets(
    monkeypatch: pytest.MonkeyPatch, database_url: str
) -> None:
    monkeypatch.setenv("TRANSIT_TEST_DATABASE_URL", database_url)
    monkeypatch.setenv(
        "TRANSIT_TEST_DATABASE_DISPOSABLE",
        "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE",
    )
    fake_engine = _FakeEngine()
    engine_calls: list[str] = []
    monkeypatch.setattr(
        conftest,
        "create_engine",
        lambda url: engine_calls.append(url) or fake_engine,
    )

    fixture: Iterator[object] = conftest.real_db_engine.__wrapped__()
    assert next(fixture) is fake_engine
    assert engine_calls == [database_url]
    fixture.close()
    assert fake_engine.disposed is True
