"""Data and durability checks for a retained local restore drill."""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

DB_ROOT = Path(__file__).resolve().parents[1]
DB_URL = os.environ.get("TRANSIT_RESTORE_PROOF_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_RESTORE_PROOF_DATABASE_URL not set — restore-proof tests skipped",
)


def repo_alembic_head() -> str:
    config = Config(str(DB_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(DB_ROOT / "src/transit_ops/db/migrations"))
    head = ScriptDirectory.from_config(config).get_current_head()
    assert head is not None, "repo migrations directory has no head revision"
    return head


def expected_restore_revision() -> str:
    revision = os.environ.get("RESTORE_EXPECTED_REVISION") or repo_alembic_head()
    if not re.fullmatch(r"[A-Za-z0-9_]+", revision):
        raise ValueError("expected restore revision must be one safe revision ID")
    return revision


@pytest.fixture()
def conn():
    expected_restore_revision()
    engine = create_engine(DB_URL)
    try:
        with engine.connect() as connection:
            yield connection
    finally:
        engine.dispose()


def test_restored_alembic_head_matches_expected_source(conn) -> None:
    restored = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()

    assert restored == expected_restore_revision()


def test_restored_core_schema_has_providers(conn) -> None:
    providers = conn.execute(text("SELECT count(*) FROM core.providers")).scalar_one()

    assert providers >= 1


def test_restored_long_horizon_marts_nonempty(conn) -> None:
    rollups = conn.execute(text("SELECT count(*) FROM gold.trip_delay_summary_5m")).scalar_one()
    alerts = conn.execute(text("SELECT count(*) FROM silver.i3_alerts")).scalar_one()

    assert rollups > 0, "warm rollups must survive the restore"
    assert alerts > 0, "i3 SCD-2 history must survive the restore"


def test_excluded_rt_stop_times_restored_present_but_empty(conn) -> None:
    regclass = conn.execute(
        text("SELECT to_regclass('silver.rt_trip_update_stop_times')")
    ).scalar_one()
    assert regclass is not None, "excluded table must still be restored (schema, no data)"

    rows = conn.execute(text("SELECT count(*) FROM silver.rt_trip_update_stop_times")).scalar_one()
    assert rows == 0, "exclusion regressed: excluded table restored WITH data"


def test_postgis_extension_restored(conn) -> None:
    postgis = conn.execute(
        text("SELECT count(*) FROM pg_extension WHERE extname = 'postgis'")
    ).scalar_one()

    assert postgis == 1


def test_restore_preserves_utf8_and_durability(conn) -> None:
    settings = conn.execute(
        text(
            "SELECT current_setting('fsync'), current_setting('full_page_writes'), "
            "current_setting('server_encoding')"
        )
    ).one()
    assert settings == ("on", "on", "UTF8")
