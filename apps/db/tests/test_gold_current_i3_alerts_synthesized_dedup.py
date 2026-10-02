from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0024_gold_current_i3_alerts_synthesized_dedup.py"
)


def _read() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _sql_block(constant_name: str) -> str:
    text = _read()
    match = re.search(
        rf'^{re.escape(constant_name)} = """(?P<sql>.*?)"""',
        text,
        flags=re.DOTALL | re.MULTILINE,
    )
    assert match is not None, f"could not find SQL constant {constant_name}"
    return match.group("sql")


def test_migration_revision_metadata() -> None:
    text = _read()

    assert 'revision = "0024_gold_current_i3_alerts_synthesized_dedup"' in text
    assert 'down_revision = "0023_current_map_objects_union_view"' in text


def test_upgrade_recreates_gold_current_i3_alerts() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "CREATE OR REPLACE VIEW gold.current_i3_alerts" in sql


def test_view_uses_distinct_on_to_pick_one_row_per_effective_hash() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "DISTINCT ON" in sql


def test_view_synthesizes_hash_over_alert_content_fields() -> None:
    sql = re.sub(r"\s+", " ", _sql_block("_CREATE_VIEW"))

    assert "md5(" in sql
    for col in ("description_text", "severity", "cause", "effect"):
        assert f"COALESCE(a.{col}" in sql or f"COALESCE( a.{col}" in sql, (
            f"missing NULL-safe COALESCE on {col}"
        )
    assert "COALESCE(a.content_hash" not in sql
    assert "COALESCE( a.content_hash" not in sql


def test_view_picks_latest_snapshot_per_dedup_group() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "ORDER BY" in sql
    assert "last_seen_at DESC" in sql


def test_view_still_filters_to_active_window() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "active_period_start_utc" in sql
    assert "active_period_end_utc" in sql
    assert "<= now()" in sql
    assert ">= now()" in sql


def test_view_preserves_entity_aggregation_columns() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "string_agg(DISTINCT e.route_id" in sql
    assert "string_agg(DISTINCT e.stop_id" in sql
    assert "route_ids" in sql and "stop_ids" in sql
    assert "route_count" in sql and "stop_count" in sql
    assert "entity_count" in sql


def test_view_left_joins_entities_through_silver_snapshot_id() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "silver.i3_alert_informed_entities" in sql
    assert "i3_alert_snapshot_id" in sql
    assert "alert_index" in sql


def test_view_uses_scd2_active_filter() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "valid_to IS NULL" in sql


def test_downgrade_restores_post_0022_shape() -> None:
    text = _read()
    drop_sql = _sql_block("_DROP_VIEW")

    assert "DROP VIEW IF EXISTS gold.current_i3_alerts" in drop_sql
    assert "def downgrade()" in text
    assert "_CREATE_VIEW_FROM_0022" in text
