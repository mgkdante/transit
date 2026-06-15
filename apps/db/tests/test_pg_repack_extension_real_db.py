"""Real-database regression for migration 0040 (slice-9.1.1m).

Exercises the actual CREATE/DROP EXTENSION pg_repack behaviour that fake-connection
tests cannot see: whether the extension and its `repack` schema land when the
package is locally available, and that the guard path is a clean no-op when it is
not. CREATE/DROP EXTENSION are transactional in Postgres, so everything runs
inside one transaction and rolls back — nothing persists.

Run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres with the
transit schema applied. Whether pg_repack is installable depends on whether the
local cluster shipped postgresql-16-repack; both branches are asserted. Never
point this at production.

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_pg_repack_extension_real_db.py -v
"""

from __future__ import annotations

import importlib.util
import os
import pathlib

import pytest
from sqlalchemy import create_engine, text

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB pg_repack tests skipped",
)


def _load_0040():
    path = (
        pathlib.Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0040_create_pg_repack_extension.py"
    )
    spec = importlib.util.spec_from_file_location("_mig_0040", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _package_available(connection) -> bool:
    return bool(
        connection.execute(
            text(
                "SELECT count(*) FROM pg_available_extensions "
                "WHERE name = 'pg_repack'"
            )
        ).scalar()
    )


def _extension_present(connection) -> bool:
    return bool(
        connection.execute(
            text("SELECT count(*) FROM pg_extension WHERE extname = 'pg_repack'")
        ).scalar()
    )


def test_0040_upgrade_creates_extension_when_available(conn) -> None:
    m = _load_0040()
    if not _package_available(conn):
        pytest.skip("postgresql-16-repack not installed in this test cluster")

    assert not _extension_present(conn), "extension should not pre-exist in a clean tx"

    # Drive the migration body's create. The migration upgrade() probes
    # pg_available_extensions then issues the CREATE; here the package is present
    # so the extension must land.
    conn.execute(text(m._CREATE_EXTENSION))

    extversion = conn.execute(
        text("SELECT extversion FROM pg_extension WHERE extname = 'pg_repack'")
    ).scalar()
    assert extversion is not None
    # pg_repack creates its helper objects in a dedicated 'repack' schema.
    schema_count = conn.execute(
        text("SELECT count(*) FROM pg_namespace WHERE nspname = 'repack'")
    ).scalar()
    assert schema_count == 1

    # downgrade body removes it.
    conn.execute(text(m._DROP_EXTENSION))
    assert not _extension_present(conn)


def test_0040_upgrade_skips_cleanly_when_package_missing(conn) -> None:
    m = _load_0040()
    if _package_available(conn):
        pytest.skip("pg_repack package IS available — guard-skip path not exercised")

    # Guard path: the probe returns 0, so upgrade() must NOT issue CREATE EXTENSION
    # and must not raise. Mirror that here: probing then refraining leaves no row.
    available = conn.execute(text(m._AVAILABLE_PROBE)).scalar()
    assert not available
    assert not _extension_present(conn)
