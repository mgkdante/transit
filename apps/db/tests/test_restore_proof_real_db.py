"""Real-database restore-proof contract for slice-9.1.1n off-VM backups.

These tests assert the cluster restored by scripts/restore-backup-proof.sh is
faithful: repo alembic head applied, core/gold/silver data present, the
excluded silver.rt_trip_update_stop_times restored present-but-EMPTY (the
--exclude-table-data effectiveness proof), and postgis installed.

They run ONLY when TRANSIT_RESTORE_PROOF_DATABASE_URL points at the throwaway
cluster left running by the restore drill:

    KEEP_RESTORE_WORKDIR=1 bash scripts/restore-backup-proof.sh
    export TRANSIT_RESTORE_PROOF_DATABASE_URL=\
"postgresql+psycopg://postgres@:55434/transit_restore?host=/tmp/transit-restore-proof/sock"
    uv run pytest tests/test_restore_proof_real_db.py -v

Never point this at production. This is deliberately a different env var from
TRANSIT_TEST_DATABASE_URL: that one points at a schema-only regression cluster
where these data assertions would false-fail.
"""

from __future__ import annotations

import os
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
    # alembic.ini stores script_location relative to the invocation cwd; pin
    # it to the absolute migrations dir so pytest can run from anywhere.
    config.set_main_option(
        "script_location", str(DB_ROOT / "src/transit_ops/db/migrations")
    )
    head = ScriptDirectory.from_config(config).get_current_head()
    assert head is not None, "repo migrations directory has no head revision"
    return head


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        yield connection
    engine.dispose()


def test_restored_alembic_head_matches_repo_head(conn) -> None:
    restored = conn.execute(
        text("SELECT version_num FROM alembic_version")
    ).scalar_one()

    assert restored == repo_alembic_head()


def test_restored_core_schema_has_providers(conn) -> None:
    providers = conn.execute(text("SELECT count(*) FROM core.providers")).scalar_one()

    assert providers >= 1


def test_restored_long_horizon_marts_nonempty(conn) -> None:
    rollups = conn.execute(
        text("SELECT count(*) FROM gold.vehicle_summary_5m")
    ).scalar_one()
    alerts = conn.execute(text("SELECT count(*) FROM silver.i3_alerts")).scalar_one()

    assert rollups > 0, "365d warm rollups must survive the restore"
    assert alerts > 0, "i3 SCD-2 history must survive the restore"


def test_excluded_rt_stop_times_restored_present_but_empty(conn) -> None:
    regclass = conn.execute(
        text("SELECT to_regclass('silver.rt_trip_update_stop_times')")
    ).scalar_one()
    assert regclass is not None, "excluded table must still be restored (schema, no data)"

    rows = conn.execute(
        text("SELECT count(*) FROM silver.rt_trip_update_stop_times")
    ).scalar_one()
    assert rows == 0, "exclusion regressed: excluded table restored WITH data"


def test_postgis_extension_restored(conn) -> None:
    postgis = conn.execute(
        text("SELECT count(*) FROM pg_extension WHERE extname = 'postgis'")
    ).scalar_one()

    assert postgis == 1
