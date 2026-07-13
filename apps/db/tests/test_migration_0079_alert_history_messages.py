"""Migration-source assertions for 0079_alert_history_messages."""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0079_alert_history_messages.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0079_alert_history_messages.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("m0079", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _sql_block(constant_name: str) -> str:
    match = re.search(
        rf'^{re.escape(constant_name)} = """(?P<sql>.*?)"""',
        _source(),
        flags=re.DOTALL | re.MULTILINE,
    )
    assert match is not None, f"could not find SQL constant {constant_name}"
    return match.group("sql")


def test_0079_chain() -> None:
    m = _load()
    assert m.revision == "0079_alert_history_messages"
    assert m.down_revision == "0078_publish_state_gate_telemetry"
    assert m.branch_labels is None
    assert callable(m.upgrade)
    assert callable(m.downgrade)


def test_0079_upgrade_appends_both_source_descriptions() -> None:
    sql = re.sub(r"\s+", " ", _sql_block("_REPLACE_HISTORY_VIEW"))
    assert "CREATE OR REPLACE VIEW gold.i3_alert_history_reporting" in sql
    assert "a.alert_header_text_en, a.description_text, a.description_text_en" in sql

    # Display text is non-identity payload. Preserve the existing hash verbatim.
    hash_expr = re.search(
        r"md5\((?P<body>.*?)\) AS effective_content_hash",
        sql,
        flags=re.DOTALL,
    )
    assert hash_expr is not None
    assert "description_text_en" not in hash_expr.group("body")


def test_0079_downgrade_restores_exact_prior_view_and_dependent() -> None:
    prior_sql = re.sub(r"\s+", " ", _sql_block("_HISTORY_VIEW_FROM_0037"))
    assert "CREATE OR REPLACE VIEW gold.i3_alert_history_reporting" in prior_sql
    assert prior_sql.rstrip().endswith("AND e.alert_index = a.alert_index")
    assert "AS effective_content_hash, a.alert_header_text_en FROM" in prior_sql
    assert "a.alert_header_text_en," not in prior_sql
    assert "a.description_text_en" not in prior_sql

    source = _source()
    assert "DROP VIEW IF EXISTS gold.i3_alert_history_reporting CASCADE" in source
    assert "CREATE OR REPLACE VIEW gold.public_alert_impact_daily" in source
    assert "op.execute(_DROP_HISTORY_VIEW)" in source
    assert "op.execute(_HISTORY_VIEW_FROM_0037)" in source
    assert "op.execute(_IMPACT_VIEW_FROM_0032)" in source
