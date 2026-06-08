from __future__ import annotations

import importlib.util
from pathlib import Path

MIGRATION_PATH = Path(
    "src/transit_ops/db/migrations/versions/0015_reporting_view_performance.py"
)


def _migration_text() -> str:
    return MIGRATION_PATH.read_text(encoding="utf-8")


def _load_migration() -> object:
    spec = importlib.util.spec_from_file_location("migration_0015", MIGRATION_PATH)
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


def test_reporting_view_performance_migration_revision_chain_is_correct() -> None:
    migration = _load_migration()

    assert migration.revision == "0015_reporting_view_performance"
    assert migration.down_revision == "0014_clean_reporting_foundation"


def test_current_trip_delay_computed_uses_latest_gold_snapshot() -> None:
    migration = _migration_text()
    block = _view_block(migration, "current_trip_delay_computed")

    assert "FROM gold.latest_trip_delay_snapshot" in block
    assert "gold.fact_stop_time_delay_observation" not in block
    assert "stop_time_update_count" in block


def test_public_daily_views_use_fast_gold_reporting_tables() -> None:
    migration = _migration_text()
    route_block = _view_block(migration, "public_route_reliability_daily")
    stop_block = _view_block(migration, "public_stop_delay_daily")

    assert "FROM gold.route_delay_hourly" in route_block
    assert "FROM gold.stop_delay_hourly" in stop_block
    assert "gold.fact_stop_time_delay_observation" not in route_block
    assert "gold.fact_stop_time_delay_observation" not in stop_block


def test_stop_time_delay_observation_is_bounded_to_current_static_dataset() -> None:
    migration = _migration_text()
    block = _view_block(migration, "fact_stop_time_delay_observation")

    assert "current_static_dataset" in block
    assert "dv.is_current" in block
    assert "st.dataset_version_id = cs.dataset_version_id" in block
