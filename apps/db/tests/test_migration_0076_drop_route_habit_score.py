"""Migration-source assertions for 0076_drop_route_habit_score (S14). Clones test_migration_0075."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0076_drop_route_habit_score.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0076_drop_route_habit_score.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("m0076", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0076_chain() -> None:
    m = _load()
    assert m.revision == "0076_drop_route_habit_score"
    assert m.down_revision == "0075_repeat_offender_daily_spine"
    assert m.branch_labels is None
    assert callable(m.upgrade)
    assert callable(m.downgrade)


def test_0076_upgrade_drops_the_mart() -> None:
    src = _source()
    assert 'op.drop_table("route_habit_score", schema="gold")' in src


def test_0076_downgrade_recreates_empty_shell_from_0014_shape() -> None:
    """Downgrade recreates the empty shell with the original 0014 columns + PK/FK (structure
    only — the producer + registry wiring are gone, so it stays empty)."""
    src = _source()
    assert 'op.create_table(\n        "route_habit_score"' in src
    assert "pk_gold_route_habit_score" in src
    assert "fk_gold_route_habit_score_provider_id" in src
    # the original 0014 column set (incl. the Numeric(8,4) score + Numeric(12,2) avg).
    for col in (
        "provider_id",
        "route_id",
        "day_of_week_iso",
        "hour_of_day_local",
        "observation_count",
        "avg_delay_seconds",
        "severe_delay_count",
        "repeat_problem_score",
        "built_at_utc",
    ):
        assert f'"{col}"' in src, f"downgrade column {col} missing"
    assert "sa.Numeric(8, 4)" in src, "repeat_problem_score must keep Numeric(8,4)"
    assert "sa.Numeric(12, 2)" in src, "avg_delay_seconds must keep Numeric(12,2)"


def test_0076_docstring_cites_parity_and_repoint() -> None:
    src = _source()
    assert "test_habit_score_reconciliation_realdb" in src
    assert "loss-free" in src.lower() or "LOSS-FREE" in src
