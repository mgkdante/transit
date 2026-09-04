"""Production-path tests for configured Alembic database target intent."""

from __future__ import annotations

import runpy
from pathlib import Path

import pytest
import sqlalchemy
from alembic import context
from alembic.config import Config

MIGRATION_ENV = Path(__file__).parents[1] / "src" / "transit_ops" / "db" / "migrations" / "env.py"


class _EngineBoundaryReached(Exception):
    pass


def _run_configured_migration_env(
    monkeypatch: pytest.MonkeyPatch,
    configured_url: str,
    create_calls: list[str],
) -> None:
    config = Config()
    config.set_main_option("sqlalchemy.url", configured_url)
    monkeypatch.setattr(context, "config", config, raising=False)
    monkeypatch.setattr(context, "is_offline_mode", lambda: False)

    def stop_at_engine_boundary(url: str, **_kwargs: object) -> None:
        create_calls.append(url)
        raise _EngineBoundaryReached

    monkeypatch.setattr(sqlalchemy, "create_engine", stop_at_engine_boundary)
    runpy.run_path(str(MIGRATION_ENV), run_name="__migration_env_target_guard__")


def test_configured_remote_url_is_refused_before_alembic_engine_creation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured_url = "postgresql://operator:configured-secret@db.example.invalid/transit"
    monkeypatch.delenv("DATABASE_URL", raising=False)
    create_calls: list[str] = []

    with pytest.raises(RuntimeError, match="Migration database target policy failed") as exc:
        _run_configured_migration_env(monkeypatch, configured_url, create_calls)

    assert create_calls == []
    assert "configured-secret" not in str(exc.value)


def test_configured_remote_url_reaches_engine_when_process_target_matches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured_url = (
        "postgresql+psycopg://operator:configured-secret@DB.EXAMPLE.INVALID/transit?sslmode=require"
    )
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://operator:process-secret@db.example.invalid:5432/transit?sslmode=require",
    )
    create_calls: list[str] = []

    with pytest.raises(_EngineBoundaryReached):
        _run_configured_migration_env(monkeypatch, configured_url, create_calls)

    assert create_calls == [configured_url]
