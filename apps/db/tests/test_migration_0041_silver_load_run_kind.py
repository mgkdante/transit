
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0041_silver_load_run_kind.py"
)


def _read() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_migration_revision_metadata() -> None:
    text = _read()
    assert 'revision = "0041_silver_load_run_kind"' in text
    assert 'down_revision = "0040_create_pg_repack_extension"' in text


def test_upgrade_extends_run_kind_with_silver_load() -> None:
    text = _read()
    assert "ck_ingestion_runs_run_kind" in text
    assert "drop_constraint" in text
    for value in (
        "static_schedule",
        "gis_static",
        "trip_updates",
        "vehicle_positions",
        "i3_alerts",
        "silver_load",
    ):
        assert f'"{value}"' in text


def test_upgrade_does_not_touch_feed_kind_or_source_format_constraints() -> None:
    text = _read()
    assert "ck_feed_endpoints_feed_kind" not in text
    assert "ck_feed_endpoints_source_format" not in text


def test_upgrade_filters_silver_load_from_feed_freshness_view() -> None:
    text = _read()
    assert "CREATE OR REPLACE VIEW gold.feed_freshness_current" in text
    flat = re.sub(r"\s+", " ", text)
    assert "ir.run_kind <> 'silver_load'" in flat
    assert "DISTINCT ON (ir.provider_id, fe.endpoint_key)" in text
    assert "completed_age_seconds" in text


def test_migration_does_no_big_table_scan_or_batching() -> None:
    text = _read()
    assert ".autocommit_block(" not in text
    assert "VACUUM" not in text.upper()
    assert "UPDATE silver." not in text
    assert "UPDATE raw.rt_trip_update_stop_times" not in text


def test_downgrade_drops_silver_load_rows_and_restores_five_value_constraint() -> None:
    text = _read()
    assert "def downgrade()" in text
    assert "DELETE FROM raw.ingestion_runs" in text
    assert "run_kind = 'silver_load'" in text
    assert text.count("CREATE OR REPLACE VIEW gold.feed_freshness_current") >= 2
