
from __future__ import annotations

import importlib.util
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0066_stop_delay_spine.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0066_stop_delay_spine.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("m0066", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0066_chain() -> None:
    m = _load()
    assert m.revision == "0066_stop_delay_spine"
    assert m.down_revision == "0065_route_headway_shift_daily"
    assert m.branch_labels is None
    assert callable(m.upgrade)
    assert callable(m.downgrade)


def test_0066_creates_stop_delay_spine_with_lean_pk() -> None:
    src = _source()
    assert '"stop_delay_spine"' in src
    assert "pk_gold_stop_delay_spine" in src
    assert "fk_gold_stop_delay_spine_provider_id" in src
    assert "ix_gold_stop_delay_spine_provider_route_date" in src

    for col in ("provider_id", "stop_id", "route_id", "service_local_date"):
        assert f'"{col}"' in src, f"PK column {col} missing"

    for col in ("observation_count", "severe_delay_count", "sum_delay_seconds"):
        assert f'"{col}"' in src, f"column {col} missing"


def test_0066_is_lean_no_hour_no_histogram() -> None:
    src = _source()
    assert "hour_of_day_local" not in src, (
        "stop_delay_spine must NOT carry hour_of_day_local (lean grain)"
    )
    assert "delay_histogram" not in src, (
        "stop_delay_spine must NOT carry a delay_histogram (lean grain)"
    )
    assert "direction_id" not in src, "stop_delay_spine does not key on direction"


def test_0066_downgrade_drops_index_then_table() -> None:
    src = _source()
    drop_index = src.index("drop_index")
    drop_table = src.index("drop_table")
    assert drop_index < drop_table, "downgrade must drop the index before the table"
    assert 'server_default=sa.text("now()")' in src
