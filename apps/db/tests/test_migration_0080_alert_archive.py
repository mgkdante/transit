"""Migration contract for the retained Gold alert archive."""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0080_alert_archive.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0080_alert_archive.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("m0080", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0080_chain() -> None:
    migration = _load()
    assert migration.revision == "0080_alert_archive"
    assert migration.down_revision == "0079_alert_history_messages"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_0080_creates_the_message_complete_archive_contract() -> None:
    source = _source()
    assert 'op.create_table(\n        "alert_archive_entry"' in source
    assert 'schema="gold"' in source

    required_columns = {
        "provider_id",
        "alert_id",
        "archive_month",
        "header_text",
        "header_text_en",
        "description_text",
        "description_text_en",
        "severity",
        "cause",
        "effect",
        "route_ids",
        "stop_ids",
        "start_utc",
        "end_utc",
        "active_periods",
        "url",
        "first_seen_utc",
        "last_seen_utc",
        "content_hash",
        "updated_at_utc",
    }
    for column in required_columns:
        assert f'"{column}"' in source

    assert "pk_gold_alert_archive_entry" in source
    assert re.search(r'sa\.PrimaryKeyConstraint\(\s*"provider_id",\s*"alert_id"', source)
    assert "ck_gold_alert_archive_entry_month_start" in source
    assert "date_trunc('month', archive_month)::date" in source
    assert "ix_gold_alert_archive_entry_provider_month_start" in source
    assert re.search(r'\[\s*"provider_id",\s*sa\.text\("archive_month DESC"\)', source)
    assert 'sa.text("start_utc DESC")' in source


def test_0080_uses_honest_collection_defaults_without_backfill() -> None:
    source = _source()
    assert "ARRAY(sa.Text())" in source
    assert "server_default=sa.text(\"'{}'::text[]\")" in source
    assert "JSONB" in source
    assert "server_default=sa.text(\"'[]'::jsonb\")" in source
    assert 'server_default=sa.text("now()")' in source

    upgrade_source = source.split("def upgrade() -> None:", 1)[1].split(
        "def downgrade() -> None:", 1
    )[0]
    for mutation in ("INSERT ", "UPDATE ", "DELETE ", "SELECT "):
        assert mutation not in upgrade_source.upper()


def test_0080_downgrade_removes_only_the_archive_table() -> None:
    source = _source()
    downgrade_source = source.split("def downgrade() -> None:", 1)[1]
    assert (
        'op.drop_index(\n        "ix_gold_alert_archive_entry_provider_month_start"'
        in downgrade_source
    )
    assert 'op.drop_table("alert_archive_entry", schema="gold")' in downgrade_source
    assert "i3_alert_history_reporting" not in downgrade_source
