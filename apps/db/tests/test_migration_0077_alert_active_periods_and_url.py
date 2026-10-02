
from __future__ import annotations

import importlib.util
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0077_alert_active_periods_and_url.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0077_alert_active_periods_and_url.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("m0077", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0077_chain() -> None:
    m = _load()
    assert m.revision == "0077_alert_active_periods_and_url"
    assert m.down_revision == "0076_drop_route_habit_score"
    assert m.branch_labels is None
    assert callable(m.upgrade)
    assert callable(m.downgrade)


def test_0077_creates_child_table_with_period_pk_and_cascade_fk() -> None:
    src = _source()
    assert '"i3_alert_active_periods"' in src
    assert "pk_silver_i3_alert_active_periods" in src
    assert "fk_silver_i3_alert_active_periods_alert" in src
    assert "ix_silver_i3_alert_active_periods_alert" in src
    for col in ("i3_alert_snapshot_id", "alert_index", "period_index"):
        assert f'"{col}"' in src, f"PK column {col} missing"
    for col in ("start_utc", "end_utc"):
        assert f'"{col}"' in src, f"column {col} missing"
    assert 'ondelete="CASCADE"' in src


def test_0077_adds_additive_nullable_url_columns() -> None:
    src = _source()
    assert 'sa.Column("url", sa.Text(), nullable=True)' in src
    assert 'sa.Column("url_en", sa.Text(), nullable=True)' in src


def test_0077_view_exposes_url_and_active_periods() -> None:
    src = _source()
    assert "CREATE OR REPLACE VIEW gold.current_i3_alerts" in src
    assert "d.url" in src and "d.url_en" in src
    assert "jsonb_agg" in src and "active_periods" in src
    assert "json_agg(" not in src.replace("jsonb_agg(", "")
    assert "DROP VIEW IF EXISTS gold.current_i3_alerts" in src
    assert "gold.current_i3_alerts CASCADE" not in src
    assert "CREATE OR REPLACE VIEW gold.current_map_objects" not in src


def test_0077_downgrade_drops_child_and_url() -> None:
    src = _source()
    assert "drop_table" in src
    assert 'op.drop_column("i3_alerts", "url"' in src
    assert 'op.drop_column("i3_alerts", "url_en"' in src
