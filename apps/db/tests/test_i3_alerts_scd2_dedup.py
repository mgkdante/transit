
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path("src/transit_ops/db/migrations/versions/0021_i3_alerts_scd2_dedup.py")
INGESTION = Path("src/transit_ops/silver/i3.py")


def _read_migration() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _read_ingestion() -> str:
    return INGESTION.read_text(encoding="utf-8")


def _sql_block(constant_name: str) -> str:
    text = _read_migration()
    match = re.search(
        rf'^{re.escape(constant_name)} = r?"""(?P<sql>.*?)"""',
        text,
        flags=re.DOTALL | re.MULTILINE,
    )
    assert match is not None, f"could not find SQL constant {constant_name}"
    return match.group("sql")


def test_migration_revision_metadata() -> None:
    text = _read_migration()

    assert 'revision = "0021_i3_alerts_scd2_dedup"' in text
    assert 'down_revision = "0020_current_vehicle_map_with_status_view"' in text


def test_adds_four_scd2_columns() -> None:
    sql = _sql_block("_ADD_COLUMNS")

    assert "ALTER TABLE silver.i3_alerts" in sql
    for col in (
        "content_hash   TEXT",
        "first_seen_at  TIMESTAMPTZ",
        "last_seen_at   TIMESTAMPTZ",
        "valid_to       TIMESTAMPTZ",
    ):
        assert col in sql, f"missing column declaration: {col}"


def test_backfill_uses_md5_of_canonical_concatenation() -> None:
    sql = _sql_block("_BACKFILL_HASH")

    assert "md5(" in sql
    for col in (
        "alert_id",
        "alert_header_text",
        "description_text",
        "severity",
        "cause",
        "effect",
        "active_period_start_utc",
        "active_period_end_utc",
        "published_at_utc",
        "updated_at_utc",
    ):
        assert col in sql, f"hash missing field: {col}"
    assert "E'\\x1F'" in sql
    assert "extract(epoch from active_period_start_utc)::bigint::text" in sql
    assert "first_seen_at = captured_at_utc" in sql
    assert "last_seen_at  = captured_at_utc" in sql


def test_promote_survivors_keeps_one_per_content_hash() -> None:
    sql = _sql_block("_PROMOTE_SURVIVORS")

    assert "GROUP BY provider_id, content_hash" in sql
    assert "min(captured_at_utc) AS first_seen" in sql
    assert "max(captured_at_utc) AS last_seen" in sql


def test_batched_deletes_use_autocommit_pattern() -> None:
    text = _read_migration()

    assert "_BATCH_SIZE = 100_000" in text
    assert "_delete_in_batches" in text
    assert "autocommit_block()" in text
    assert "DELETE FROM silver.i3_alerts" in text
    assert "DELETE FROM silver.i3_alert_informed_entities" in text


def test_unique_index_only_on_active_non_null_rows() -> None:
    sql = _sql_block("_ADD_UNIQUE_INDEX")

    assert "CREATE UNIQUE INDEX" in sql
    assert "silver.i3_alerts (provider_id, content_hash)" in sql
    assert "content_hash IS NOT NULL" in sql
    assert "valid_to IS NULL" in sql


def test_gold_view_filters_active_rows() -> None:
    sql = _sql_block("_REFRESH_GOLD_VIEW")

    assert "CREATE OR REPLACE VIEW gold.current_i3_alerts" in sql
    assert "WHERE valid_to IS NULL" in sql
    assert "COALESCE(a.active_period_start_utc, a.captured_at_utc) <= now()" in sql


def test_vacuum_uses_parallel_zero() -> None:
    text = _read_migration()

    assert "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alerts" in text
    assert "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alert_informed_entities" in text


def test_downgrade_restores_legacy_view_and_drops_columns() -> None:
    text = _read_migration()
    legacy_view = _sql_block("_LEGACY_GOLD_VIEW_FROM_0017")

    assert "valid_to" not in legacy_view
    assert "CREATE OR REPLACE VIEW gold.current_i3_alerts" in legacy_view

    downgrade_body = text[text.index("def downgrade") :]
    assert "_LEGACY_GOLD_VIEW_FROM_0017" in downgrade_body
    assert "DROP COLUMN IF EXISTS content_hash" in downgrade_body
    assert "DROP INDEX IF EXISTS" in downgrade_body


def test_redundancy_pct_guards_against_empty_table() -> None:
    text = _read_migration()

    assert "(1 - n_unique/n_total)*100:.1f" not in text, (
        "unguarded n_unique/n_total division still present — ZeroDivisionError on empty DB"
    )
    assert "if n_total else 0.0" in text, "redundancy pct must guard against n_total == 0"


def test_ingestion_code_computes_content_hash_and_uses_on_conflict() -> None:
    text = _read_ingestion()

    assert "def compute_alert_content_hash(" in text
    for kw in (
        "alert_id",
        "alert_header_text",
        "description_text",
        "severity",
        "cause",
        "effect",
        "active_period_start_utc",
        "active_period_end_utc",
        "published_at_utc",
        "updated_at_utc",
    ):
        assert kw in text, f"compute_alert_content_hash signature missing {kw}"

    from transit_ops.silver.i3 import _HASH_FIELD_SEP

    assert _HASH_FIELD_SEP == chr(31)
    assert 'hashlib.md5(canonical.encode("utf-8")).hexdigest()' in text

    assert (
        "ON CONFLICT (provider_id, content_hash) "
        "WHERE content_hash IS NOT NULL AND valid_to IS NULL"
    ) in text
    assert "DO UPDATE SET last_seen_at = excluded.last_seen_at" in text

    assert '"content_hash": content_hash,' in text
