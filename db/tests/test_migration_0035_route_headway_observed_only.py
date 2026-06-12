from __future__ import annotations

import importlib.util
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0035_route_headway_observed_only.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0035_route_headway_observed_only.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    assert path.exists(), "expected migration 0035_route_headway_observed_only.py"
    spec = importlib.util.spec_from_file_location("m0035", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0035_chain() -> None:
    migration = _load()

    assert migration.revision == "0035_route_headway_observed_only"
    assert migration.down_revision == "0034_trip_delay_stop_attribution"
    assert callable(migration.upgrade)
    assert callable(migration.downgrade)


def test_0035_drops_never_written_headway_columns_and_restores_on_downgrade() -> None:
    source = _source()

    assert "scheduled_headway_min" in source
    assert "excess_wait_min" in source
    assert 'op.drop_column("route_headway_daily", "scheduled_headway_min", schema="gold")' in source
    assert 'op.drop_column("route_headway_daily", "excess_wait_min", schema="gold")' in source
    assert source.count("op.add_column(") == 2
    assert "sa.Column(\"scheduled_headway_min\", sa.Numeric(), nullable=True)" in source
    assert "sa.Column(\"excess_wait_min\", sa.Numeric(), nullable=True)" in source
    assert "computed at publish time" in source
