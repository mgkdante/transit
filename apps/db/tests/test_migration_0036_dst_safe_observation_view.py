from __future__ import annotations

import importlib.util
from pathlib import Path

MIGRATION_PATH = Path("src/transit_ops/db/migrations/versions/0036_dst_safe_observation_view.py")


def _migration_text() -> str:
    assert MIGRATION_PATH.exists(), "expected migration 0036_dst_safe_observation_view.py"
    return MIGRATION_PATH.read_text(encoding="utf-8")


def _load_migration() -> object:
    assert MIGRATION_PATH.exists(), "expected migration 0036_dst_safe_observation_view.py"
    spec = importlib.util.spec_from_file_location("migration_0036", MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _view_block(migration: str, view_name: str) -> str:
    marker = f"CREATE OR REPLACE VIEW gold.{view_name} AS"
    start = migration.index(marker)
    next_view = migration.find("CREATE OR REPLACE VIEW gold.", start + len(marker))
    end = next_view if next_view != -1 else migration.index('"""', start)
    return migration[start:end]


def test_0036_revision_chain_is_correct() -> None:
    migration = _load_migration()

    assert migration.revision == "0036_dst_safe_observation_view"
    assert migration.down_revision == "0035_route_headway_observed_only"
    assert callable(migration.upgrade)
    assert callable(migration.downgrade)


def test_0036_observation_view_uses_noon_minus_12h_anchor() -> None:
    migration = _migration_text()
    block = _view_block(migration, "fact_stop_time_delay_observation")
    compact_block = " ".join(block.split())

    assert (
        compact_block.count(
            "timezone(dp.timezone, rtu.start_date::timestamp + interval '12 hours'"
        )
        >= 2
    )
    assert compact_block.count("- interval '12 hours'") >= 2
    assert "AT TIME ZONE dp.timezone" not in block
    assert "current_static_dataset" in block
    assert "st.dataset_version_id = cs.dataset_version_id" in block
