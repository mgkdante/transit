"""Migration-source assertions for 0071_stop_delay_shift_daily (GC1 / Step G4). Clones test_migration_0066."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0071_stop_delay_shift_daily.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0071_stop_delay_shift_daily.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("m0071", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0071_chain() -> None:
    m = _load()
    assert m.revision == "0071_stop_delay_shift_daily"
    assert m.down_revision == "0070_route_delay_spine_delayed_trip_count"
    assert m.branch_labels is None
    assert callable(m.upgrade)
    assert callable(m.downgrade)


def test_0071_creates_stop_delay_shift_daily_with_shift_pk() -> None:
    src = _source()
    assert '"stop_delay_shift_daily"' in src
    assert "pk_gold_stop_delay_shift_daily" in src
    assert "fk_gold_stop_delay_shift_daily_provider_id" in src
    assert "ix_gold_stop_delay_shift_daily_provider_stop_date" in src

    # 5-column PK (provider, stop, route, date, shift) — route_id KEEP (spine symmetry).
    for col in ("provider_id", "stop_id", "route_id", "service_local_date", "shift"):
        assert f'"{col}"' in src, f"PK column {col} missing"

    # additive count columns + the pooled-avg numerator.
    for col in ("observation_count", "severe_delay_count", "sum_delay_seconds"):
        assert f'"{col}"' in src, f"column {col} missing"


def test_0071_is_lean_no_hour_no_histogram_no_direction() -> None:
    """The lean-grain guard: a regression that re-adds hour_of_day_local, a delay_histogram
    (the ~9-18x cardinality variant that trips HARD GATE 1), or direction_id must fail here."""
    src = _source()
    assert "hour_of_day_local" not in src, "shift grain must NOT carry hour_of_day_local"
    assert "delay_histogram" not in src, "shift grain must NOT carry a delay_histogram"
    assert "direction_id" not in src, "shift grain does not key on direction"


def test_0071_downgrade_drops_index_then_table() -> None:
    src = _source()
    drop_index = src.index("drop_index")
    drop_table = src.index("drop_table")
    assert drop_index < drop_table, "downgrade must drop the index before the table"
    assert 'server_default=sa.text("now()")' in src  # built_at_utc default
