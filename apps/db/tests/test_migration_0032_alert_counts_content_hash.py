"""Static contract tests for migration 0032: alert counts by content hash."""

from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0032_alert_counts_by_content_hash.py"
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


def _compact(sql: str) -> str:
    return re.sub(r"\s+", " ", sql)


def test_migration_revision_metadata() -> None:
    text = _read()

    assert 'revision = "0032_alert_counts_by_content_hash"' in text
    assert 'down_revision = "0031_capped_max_delay_5m"' in text


def test_history_view_appends_effective_content_hash_last() -> None:
    sql = _sql_block("_HISTORY_VIEW")

    assert "CREATE OR REPLACE VIEW gold.i3_alert_history_reporting" in sql
    assert "AS effective_content_hash" in sql
    assert sql.index("a.captured_at_utc") < sql.index("AS effective_content_hash")
    assert sql.index("AS effective_content_hash") < sql.index("FROM silver.i3_alerts AS a")


def test_effective_hash_is_always_synthesized_0024_expression() -> None:
    sql = _compact(_sql_block("_HISTORY_VIEW"))

    assert "md5(" in sql
    for col in ("description_text", "severity", "cause", "effect"):
        assert f"COALESCE(a.{col}" in sql
    assert "COALESCE(a.content_hash" not in sql
    assert "COALESCE( a.content_hash" not in sql
    assert "\\x1F" not in sql
    assert "E'\\\\x1F'" not in sql


def test_history_view_keeps_0013_shape() -> None:
    sql = _sql_block("_HISTORY_VIEW")

    for field in (
        "provider_local_date",
        "hour_bucket_local",
        "week_bucket_local",
        "month_bucket_local",
        "rolling_year_bucket_local",
        "a.active_period_start_utc",
        "a.active_period_end_utc",
        "a.captured_at_utc",
        "INNER JOIN gold.dim_provider AS dp",
        "LEFT JOIN silver.i3_alert_informed_entities AS e",
    ):
        assert field in sql
    assert "valid_to" not in sql


def test_impact_view_counts_distinct_effective_content_hash() -> None:
    sql = _compact(_sql_block("_IMPACT_VIEW"))

    assert "CREATE OR REPLACE VIEW gold.public_alert_impact_daily" in sql
    assert "count(DISTINCT effective_content_hash)::integer AS alert_count" in sql
    assert "DISTINCT alert_id" not in sql
    assert (
        "GROUP BY provider_id, route_id, stop_id, area_id, provider_local_date"
        in sql
    )


def test_backfill_recomputes_persisted_citizen_daily_counts() -> None:
    sql = _compact(_sql_block("_BACKFILL_CITIZEN_ACCOUNTABILITY_DAILY"))

    assert "UPDATE gold.citizen_accountability_daily AS cad" in sql
    assert "COUNT(DISTINCT effective_content_hash)::integer AS alert_count" in sql
    assert "FROM gold.i3_alert_history_reporting" in sql
    assert "alert_count = COALESCE(a.alert_count, 0)" in sql
    assert "+ COALESCE(a.alert_count, 0)::numeric * 2" in sql
    assert "LEAST(" in sql


def test_upgrade_replaces_views_before_backfilling_daily_rows() -> None:
    text = _read()

    history_pos = text.index("op.execute(_HISTORY_VIEW)")
    impact_pos = text.index("op.execute(_IMPACT_VIEW)")
    backfill_pos = text.index("op.execute(_BACKFILL_CITIZEN_ACCOUNTABILITY_DAILY)")

    assert history_pos < impact_pos < backfill_pos


def test_downgrade_restores_0013_bodies_in_dependency_order() -> None:
    text = _read()
    downgrade_body = text[text.index("def downgrade()") :]
    impact_drop = _sql_block("_DROP_IMPACT_VIEW")
    history_drop = _sql_block("_DROP_HISTORY_VIEW")

    assert "_HISTORY_VIEW_FROM_0013" in text
    assert "_IMPACT_VIEW_FROM_0013" in text
    assert "DROP VIEW IF EXISTS gold.public_alert_impact_daily" in impact_drop
    assert "DROP VIEW IF EXISTS gold.i3_alert_history_reporting" in history_drop
    assert downgrade_body.index("op.execute(_DROP_IMPACT_VIEW)") < (
        downgrade_body.index("op.execute(_DROP_HISTORY_VIEW)")
    )
    assert downgrade_body.index("op.execute(_HISTORY_VIEW_FROM_0013)") < (
        downgrade_body.index("op.execute(_IMPACT_VIEW_FROM_0013)")
    )
