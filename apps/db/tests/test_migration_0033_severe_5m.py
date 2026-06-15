from __future__ import annotations

import importlib.util
from pathlib import Path

from transit_ops.gold import rollups


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0033_trip_delay_summary_severe_counts.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0033_trip_delay_summary_severe_counts.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    assert path.exists(), "expected migration 0033_trip_delay_summary_severe_counts.py"
    spec = importlib.util.spec_from_file_location("m0033", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0033_chain() -> None:
    migration = _load()

    assert migration.revision == "0033_trip_delay_summary_severe_counts"
    assert migration.down_revision == "0032_alert_counts_by_content_hash"
    assert callable(migration.upgrade)
    assert callable(migration.downgrade)


def test_0033_adds_severe_column_and_backfills_capped_fact_counts() -> None:
    source = _source()
    severe_threshold = getattr(rollups, "SEVERE_DELAY_SECONDS", 300)

    assert "severe_delay_observation_count" in source
    assert "op.add_column(" in source
    assert "DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')" in source
    assert (
        f"delay_seconds > {severe_threshold} AND ABS(delay_seconds) <= 3600"
        in source
    )
    assert "op.drop_column" in source


def test_0033_extends_live_view_parity_and_restores_0031_on_downgrade() -> None:
    source = _source()

    assert "CREATE OR REPLACE VIEW gold.trip_delay_summary_5m_live" in source
    assert "on_time_observation_count" in source
    assert "max_delay_seconds_capped" in source
    assert "severe_delay_observation_count" in source
    assert "DROP VIEW IF EXISTS gold.trip_delay_summary_5m_live" in source
    assert "_RESTORE_0031_TRIP_DELAY_SUMMARY_5M_LIVE" in source
