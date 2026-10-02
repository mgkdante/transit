
from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Protocol

import pytest
import typer.rich_utils as _rich_utils
from sqlalchemy import Connection, Engine, create_engine, text

from transit_ops.db.target_safety import assert_disposable_test_url


class SeedProvider(Protocol):
    def __call__(
        self,
        connection: Connection,
        provider_id: str,
        *,
        display_name: str,
        timezone: str = "America/Toronto",
        ignore_existing: bool = False,
    ) -> None: ...


@pytest.fixture(scope="session")
def real_db_engine() -> Iterator[Engine]:
    database_url = os.environ.get("TRANSIT_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TRANSIT_TEST_DATABASE_URL not set — real-DB tests skipped")

    assert_disposable_test_url(database_url, os.environ)
    engine = create_engine(database_url)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture(scope="session")
def seed_provider() -> SeedProvider:
    def seed(
        connection: Connection,
        provider_id: str,
        *,
        display_name: str,
        timezone: str = "America/Toronto",
        ignore_existing: bool = False,
    ) -> None:
        conflict_clause = " ON CONFLICT (provider_id) DO NOTHING" if ignore_existing else ""
        connection.execute(
            text(
                """
                INSERT INTO core.providers
                    (provider_id, display_name, timezone, provider_key)
                VALUES (:provider_id, :display_name, :timezone, :provider_id)
                """
                + conflict_clause
            ),
            {
                "provider_id": provider_id,
                "display_name": display_name,
                "timezone": timezone,
            },
        )

    return seed


@pytest.fixture(autouse=True)
def _deterministic_cli_rendering(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_rich_utils, "COLOR_SYSTEM", None, raising=False)
    monkeypatch.setattr(_rich_utils, "FORCE_TERMINAL", False, raising=False)
    monkeypatch.setattr(_rich_utils, "MAX_WIDTH", 200, raising=False)


@pytest.fixture(autouse=True)
def _hermetic_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
