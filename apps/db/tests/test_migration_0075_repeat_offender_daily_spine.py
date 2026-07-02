"""Migration-source assertions for 0075_repeat_offender_daily_spine (S14). Clones test_migration_0071."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0075_repeat_offender_daily_spine.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0075_repeat_offender_daily_spine.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("m0075", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0075_chain() -> None:
    m = _load()
    assert m.revision == "0075_repeat_offender_daily_spine"
    assert m.down_revision == "0074_route_occupancy_band_hourly"
    assert m.branch_labels is None
    assert callable(m.upgrade)
    assert callable(m.downgrade)


def test_0075_creates_offender_spine_with_entity_pk() -> None:
    src = _source()
    assert '"repeat_offender_daily_spine"' in src
    assert "pk_gold_repeat_offender_daily_spine" in src
    assert "fk_gold_repeat_offender_daily_spine_provider_id" in src
    assert "ix_gold_repeat_offender_daily_spine_provider_date" in src

    # 5-column PK (provider, entity_kind, entity_id, route_id, date).
    for col in ("provider_id", "entity_kind", "entity_id", "route_id", "provider_local_date"):
        assert f'"{col}"' in src, f"PK column {col} missing"

    # additive count columns + the pooled-avg numerator.
    for col in ("observation_count", "severe_delay_count", "sum_delay_seconds"):
        assert f'"{col}"' in src, f"column {col} missing"


def test_0075_sum_delay_is_bigint() -> None:
    """sum_delay_seconds must be BigInteger: a windowed SUM of in-clamp magnitude overflows int4."""
    src = _source()
    assert "sum_delay_seconds" in src
    assert "BigInteger" in src, "sum_delay_seconds must be BigInteger"


def test_0075_index_leads_provider_date_for_windowed_read() -> None:
    """The by_grain reads SUM across a trailing (provider, date) window with no entity filter,
    so the index must lead (provider_id, provider_local_date)."""
    src = _source()
    idx = src.index("ix_gold_repeat_offender_daily_spine_provider_date")
    # the index columns list follows the name; assert both cols appear after it, entity omitted.
    tail = src[idx:idx + 400]
    assert '"provider_id"' in tail
    assert '"provider_local_date"' in tail
    assert '"entity_id"' not in tail, "the windowed-read index must omit entity_id"


def test_0075_downgrade_drops_index_then_table() -> None:
    src = _source()
    drop_index = src.index("drop_index")
    drop_table = src.index("drop_table")
    assert drop_index < drop_table, "downgrade must drop the index before the table"
    assert 'server_default=sa.text("now()")' in src  # built_at_utc default


def test_0075_documents_parity_and_boundary() -> None:
    """The docstring must record the recurrence-parity invariant + the 14d backfill boundary."""
    src = _source()
    assert "PARITY INVARIANT" in src
    assert "recurrence_days" in src
    assert "14d" in src or "14 closed days" in src
