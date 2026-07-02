"""S14 — the implicit-remote-migration guard (transit_ops.db.migration_guard).

The alembic env falls back to the checked-in .env when the process environment has no
DATABASE_URL; that fallback must never silently reach a remote host (the 2026-07-02
accidental-prod-migration incident). Explicit process-env URLs stay allowed so the
daily-static init-db, the throwaway-cluster bootstrap, and compose are unaffected.
"""

from __future__ import annotations

import pytest

from transit_ops.db.migration_guard import assert_explicit_remote_url

_REMOTE = "postgresql+psycopg://transit:pw@db.transit.example.com:5432/transit?sslmode=require"


def test_implicit_remote_url_is_refused() -> None:
    with pytest.raises(RuntimeError, match="db.transit.example.com"):
        assert_explicit_remote_url(_REMOTE, {})


def test_explicit_remote_url_is_allowed() -> None:
    assert_explicit_remote_url(_REMOTE, {"DATABASE_URL": _REMOTE})


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://postgres@127.0.0.1:55437/transit_test",
        "postgresql+psycopg://postgres@localhost:5432/transit",
        "postgresql://postgres@[::1]:5432/transit",
    ],
)
def test_implicit_local_urls_are_allowed(url: str) -> None:
    assert_explicit_remote_url(url, {})


def test_driver_suffix_does_not_hide_the_host() -> None:
    # The +psycopg suffix must be normalized away, not break hostname parsing.
    with pytest.raises(RuntimeError):
        assert_explicit_remote_url(
            "postgresql+psycopg://u:p@some.remote.host/db", {}
        )
