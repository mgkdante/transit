"""Static contract test for migration 0037: bilingual EN text on i3 alerts.

slice-9.1.1s adds nullable EN columns to silver.i3_alerts, backfills them over
ALL hashed rows (active AND superseded — gold.i3_alert_history_reporting has no
valid_to filter and the ON CONFLICT self-heal can never reach valid_to-closed
rows, so superseded hashed rows must be backfilled to feed the 30-day history
window), and CREATE OR REPLACEs both gold views appending the EN columns at the
end. The wave-2 slice-d effective_content_hash column on the history view (0032)
is preserved.
"""

from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0037_i3_alert_text_en.py"
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
    assert 'revision = "0037_i3_alert_text_en"' in text
    assert 'down_revision = "0036_dst_safe_observation_view"' in text


def test_add_columns_catalog_only_nullable() -> None:
    sql = re.sub(r"\s+", " ", _sql_block("_ADD_COLUMNS"))
    assert "ALTER TABLE silver.i3_alerts" in sql
    assert "ADD COLUMN IF NOT EXISTS alert_header_text_en TEXT" in sql
    assert "ADD COLUMN IF NOT EXISTS description_text_en TEXT" in sql
    # Catalog-only on the 2.8GB table: nullable, no DEFAULT (no table rewrite).
    assert "DEFAULT" not in sql.upper()


def test_backfill_scopes_to_hashed_rows_only_active_and_superseded() -> None:
    sql = re.sub(r"\s+", " ", _sql_block("_BACKFILL_EN"))
    # Scope guard: never the 2.7M legacy NULL-hash rows (slice-9.1.1l territory).
    assert "content_hash IS NOT NULL" in sql
    # REVIEW FIX: superseded hashed rows MUST be covered — the backfill is the
    # only EN source for valid_to-closed rows in the 30-day history window.
    assert "valid_to IS NULL" not in sql
    # parses EN from the raw payload with a jsonb_typeof array guard
    assert "raw_alert_json" in sql
    assert "jsonb_typeof" in sql
    assert "header_texts" in sql
    assert "description_texts" in sql
    assert "'en'" in sql and "'eng'" in sql


def test_backfill_is_inline_not_batched() -> None:
    # T1 sized the work-set at low-thousands (hashed rows only exist since the
    # 2026-06-09 redeploy), so the backfill is a single inline UPDATE — no
    # autocommit_block batching invoked, no table reclaim run (deliberate
    # deviation from 0017/0021, documented in the migration docstring).
    text = _read()
    assert ".autocommit_block(" not in text
    assert "op.execute(_BACKFILL_EN)" in text
    # No VACUUM is actually executed (the SQL bodies carry none).
    assert "VACUUM" not in _sql_block("_BACKFILL_EN").upper()
    assert "VACUUM" not in _sql_block("_ADD_COLUMNS").upper()


def test_replace_current_view_appends_en_after_captured_at() -> None:
    sql = _sql_block("_REPLACE_CURRENT_VIEW")
    assert "CREATE OR REPLACE VIEW gold.current_i3_alerts" in sql
    assert "alert_header_text_en" in sql
    assert "description_text_en" in sql
    flat = re.sub(r"\s+", " ", sql)
    # Scope to the outer SELECT (everything before FROM deduped AS d). The EN
    # columns must be appended AFTER the outer captured_at_utc there.
    outer = flat[: flat.find("FROM deduped AS d")]
    cap = outer.rfind("d.captured_at_utc")
    en = outer.find("d.alert_header_text_en")
    assert cap != -1 and en != -1 and en > cap
    # The DISTINCT ON md5 block (before the outer SELECT body) carries no _en —
    # dedup identity is unchanged.
    distinct_block = flat[: flat.find("a.provider_id, a.alert_id")]
    assert "_en" not in distinct_block


def test_replace_history_view_preserves_effective_content_hash_and_adds_en() -> None:
    sql = _sql_block("_REPLACE_HISTORY_VIEW")
    assert "CREATE OR REPLACE VIEW gold.i3_alert_history_reporting" in sql
    # wave-2 slice-d (0032) column MUST survive.
    assert "effective_content_hash" in sql
    assert "alert_header_text_en" in sql
    flat = re.sub(r"\s+", " ", sql)
    # EN appended after a.captured_at_utc (and before/around effective_content_hash
    # — both come after captured_at_utc).
    cap = flat.find("a.captured_at_utc")
    en = flat.find("a.alert_header_text_en")
    assert cap != -1 and en != -1 and en > cap


def test_downgrade_rebuilds_dependents_and_drops_columns() -> None:
    text = _read()
    assert "def downgrade()" in text
    # Both views dropped CASCADE and recreated, dependents rebuilt.
    assert "DROP VIEW IF EXISTS gold.current_i3_alerts" in text
    assert "DROP VIEW IF EXISTS gold.i3_alert_history_reporting" in text
    assert "gold.current_map_objects" in text
    assert "gold.public_alert_impact_daily" in text
    # downgrade history view restores the 0032 effective_content_hash shape
    assert text.count("effective_content_hash") >= 2
    # columns dropped last
    assert "DROP COLUMN IF EXISTS alert_header_text_en" in text
    assert "DROP COLUMN IF EXISTS description_text_en" in text
