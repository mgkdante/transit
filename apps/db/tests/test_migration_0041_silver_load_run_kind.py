"""Static contract test for migration 0041: silver_load run_kind + view filter.

slice-9.1.1o extends ck_ingestion_runs_run_kind to accept a new
run_kind='silver_load' (so the worker can persist realtime silver-load
failures to raw.ingestion_runs) and re-creates gold.feed_freshness_current
with an `ir.run_kind <> 'silver_load'` filter so those failure-telemetry rows
never leak into the public /v1 provenance.json / network.json freshness, which
read this view.

The constraint swap touches ONLY ck_ingestion_runs_run_kind — the sibling
feed_kind / source_format constraints (also drop/recreated in 0012/0013) stay
at their 5-value sets. raw.ingestion_runs holds ~30 days of capture rows, so
the validation scan is fast and bounded (no big-table scan).
"""

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
    # Drops then recreates only the run_kind constraint.
    assert "ck_ingestion_runs_run_kind" in text
    assert "drop_constraint" in text
    # New 6-value set must include silver_load alongside the existing 5
    # (value tuples are double-quoted in source; _in_constraint repr()s them
    # to single quotes at migration runtime).
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
    # The silver_load value belongs to run_kind ONLY. feed_kind /
    # source_format constraints must be left intact (a silver_load there would
    # be wrong — it is not a feed or a wire format).
    assert "ck_feed_endpoints_feed_kind" not in text
    assert "ck_feed_endpoints_source_format" not in text


def test_upgrade_filters_silver_load_from_feed_freshness_view() -> None:
    text = _read()
    assert "CREATE OR REPLACE VIEW gold.feed_freshness_current" in text
    # The view body is the 0013 definition plus the silver_load filter.
    flat = re.sub(r"\s+", " ", text)
    assert "ir.run_kind <> 'silver_load'" in flat
    # Column set unchanged: DISTINCT ON + completed_age_seconds preserved.
    assert "DISTINCT ON (ir.provider_id, fe.endpoint_key)" in text
    assert "completed_age_seconds" in text


def test_migration_does_no_big_table_scan_or_batching() -> None:
    text = _read()
    # Catalog-only constraint swap + CREATE OR REPLACE VIEW. The only row
    # touch is a tiny downgrade DELETE of telemetry rows. No batching loop,
    # no VACUUM, no large window-sort.
    assert ".autocommit_block(" not in text
    assert "VACUUM" not in text.upper()
    # No backfill UPDATE over a big table.
    assert "UPDATE silver." not in text
    assert "UPDATE raw.rt_trip_update_stop_times" not in text


def test_downgrade_drops_silver_load_rows_and_restores_five_value_constraint() -> None:
    text = _read()
    assert "def downgrade()" in text
    # Telemetry rows are droppable (documented): clear them so the restored
    # 5-value CHECK can re-validate cleanly.
    assert "DELETE FROM raw.ingestion_runs" in text
    assert "run_kind = 'silver_load'" in text
    # Restores the 0013 view (no silver_load filter) — guarded by the same
    # CREATE OR REPLACE so dependents and grants survive.
    assert text.count("CREATE OR REPLACE VIEW gold.feed_freshness_current") >= 2
