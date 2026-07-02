"""Guard against implicit remote migrations (S14, 2026-07-02).

Incident: an agent session ran a bare ``uv run alembic upgrade head`` inside apps/db and
briefly migrated PRODUCTION, because the alembic env resolves its URL from settings —
which falls back to the checked-in ``.env`` (pointing at the prod host) when the process
environment carries no ``DATABASE_URL``. The legitimate migration paths (the daily-static
workflow's ``init-db``, the throwaway-cluster test bootstrap, on-box compose) all pass
``DATABASE_URL`` explicitly in the process environment, so the guard keys on exactly that
distinction: an IMPLICIT (.env-sourced) URL may only target a local database.
"""

from __future__ import annotations

from collections.abc import Mapping
from urllib.parse import urlsplit

_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def assert_explicit_remote_url(url: str, environ: Mapping[str, str]) -> None:
    """Raise when ``url`` targets a non-local host but was resolved implicitly.

    ``environ`` is the process environment; the presence of ``DATABASE_URL`` there marks
    the URL as an explicit, deliberate choice (CI workflows, test clusters, compose) and
    the guard stands down. SQLAlchemy driver suffixes (``postgresql+psycopg``) are
    normalized away before hostname parsing.
    """
    if "DATABASE_URL" in environ:
        return
    scheme, _, rest = url.partition("://")
    host = urlsplit(f"{scheme.split('+', 1)[0]}://{rest}").hostname or ""
    if host in _LOCAL_HOSTS:
        return
    raise RuntimeError(
        f"Refusing to run migrations against remote host '{host}': the database URL was "
        "resolved implicitly from the .env file, not the process environment. If this is "
        "deliberate, export DATABASE_URL explicitly (e.g. DATABASE_URL=... uv run alembic "
        "upgrade head). Guard added S14 2026-07-02 after an accidental prod migration."
    )
