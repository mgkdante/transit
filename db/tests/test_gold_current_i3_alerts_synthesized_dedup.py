"""Static contract test for migration 0024: synthesized-hash dedup in gold.current_i3_alerts.

slice-8.7.2 Phase 2 discovered that 22,739 of 23,459 silver.i3_alerts rows
have content_hash=NULL (old-ingestion-code path, pre worker redeploy).
SCD2 dedup in migration 0021 keys on content_hash, so those rows never
collapse. gold.current_i3_alerts swelled to 15K+ rows where 704 unique
alerts exist.

Migration 0024 rewrites the gold view to synthesize a content hash when
the silver row has none, using md5 over the alert's stable content
fields. Dedup then works retroactively for old-path rows without
requiring the worker redeploy. After redeploy, content_hash arrives
populated and COALESCE prefers it (forward-compatible).
"""
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
    """DISTINCT ON (provider_id, effective_hash) collapses near-duplicate
    silver rows that the SCD2 layer couldn't dedupe due to NULL
    content_hash from old-ingestion-code path."""
    sql = _sql_block("_CREATE_VIEW")

    assert "DISTINCT ON" in sql


def test_view_synthesizes_hash_over_alert_content_fields() -> None:
    """The dedup key is always md5 over the alert's stable content fields,
    never the upstream content_hash. First implementation tried
    COALESCE(content_hash, md5(...)) but that produced 1,347 hash groups
    instead of ~706 because the same operational alert appears in BOTH
    new-path (with real content_hash) and old-path (NULL content_hash)
    silver rows — the two hashes differ even when content matches.
    Always synthesizing unifies both paths under one key.

    NULL-safe via COALESCE on each component (md5(NULL || 'x') = NULL
    would break DISTINCT ON, putting all NULL-component rows into the
    same group)."""
    # Whitespace-tolerant: SQL formatting allows md5( … a.description_text
    # across multiple lines, so collapse runs of whitespace to a single space.
    sql = re.sub(r"\s+", " ", _sql_block("_CREATE_VIEW"))

    assert "md5(" in sql
    # NULL-safe component coalescing on each input to the md5
    for col in ("description_text", "severity", "cause", "effect"):
        assert f"COALESCE(a.{col}" in sql or f"COALESCE( a.{col}" in sql, (
            f"missing NULL-safe COALESCE on {col}"
        )
    # Explicit: NO COALESCE over content_hash — the dedup key is always
    # synthesized, content_hash is left in silver for provenance only.
    assert "COALESCE(a.content_hash" not in sql
    assert "COALESCE( a.content_hash" not in sql


def test_view_picks_latest_snapshot_per_dedup_group() -> None:
    """When multiple silver rows hash to the same effective_hash, keep the
    most-recently-observed one (last_seen_at DESC). Tiebreak by snapshot
    id so the choice is deterministic."""
    sql = _sql_block("_CREATE_VIEW")

    assert "ORDER BY" in sql
    assert "last_seen_at DESC" in sql


def test_view_still_filters_to_active_window() -> None:
    """Active-period filter from migration 0022 preserved: alert is only
    surfaced when now() falls between start and end."""
    sql = _sql_block("_CREATE_VIEW")

    assert "active_period_start_utc" in sql
    assert "active_period_end_utc" in sql
    assert "<= now()" in sql
    assert ">= now()" in sql


def test_view_preserves_entity_aggregation_columns() -> None:
    """The 0022 contract — route_ids, stop_ids, route_count, stop_count,
    entity_count — must keep working so p01_alerts and the new
    current_map_objects view don't need to be rebound."""
    sql = _sql_block("_CREATE_VIEW")

    assert "string_agg(DISTINCT e.route_id" in sql
    assert "string_agg(DISTINCT e.stop_id" in sql
    assert "route_ids" in sql and "stop_ids" in sql
    assert "route_count" in sql and "stop_count" in sql
    assert "entity_count" in sql


def test_view_left_joins_entities_through_silver_snapshot_id() -> None:
    """Entities still join on (i3_alert_snapshot_id, alert_index) — those
    are silver's natural keys for the entities sub-table."""
    sql = _sql_block("_CREATE_VIEW")

    assert "silver.i3_alert_informed_entities" in sql
    assert "i3_alert_snapshot_id" in sql
    assert "alert_index" in sql


def test_view_uses_scd2_active_filter() -> None:
    """valid_to IS NULL is still the SCD2 active filter — keeps the door
    open for the future worker-redeploy + content_hash NOT NULL fix."""
    sql = _sql_block("_CREATE_VIEW")

    assert "valid_to IS NULL" in sql


def test_downgrade_restores_post_0022_shape() -> None:
    """Downgrading to migration 0022 must restore that view exactly (not
    rolling back further to 0021's broken-after-SCD2 shape)."""
    text = _read()
    drop_sql = _sql_block("_DROP_VIEW")

    assert "DROP VIEW IF EXISTS gold.current_i3_alerts" in drop_sql
    assert "def downgrade()" in text
    # downgrade re-runs the migration-0022 view body so callers keep working
    assert "_CREATE_VIEW_FROM_0022" in text
