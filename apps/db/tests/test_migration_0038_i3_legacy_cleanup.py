
from __future__ import annotations

import importlib.util
import inspect
import pathlib
import re

import pytest

_VERSIONS = (
    pathlib.Path(__file__).resolve().parents[1]
    / "src/transit_ops/db/migrations/versions"
)


def _load(filename: str, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, _VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_0038():
    return _load("0038_i3_legacy_nullhash_collapse.py", "m0038")


def _load_0021():
    return _load("0021_i3_alerts_scd2_dedup.py", "m0021_for_0038")


def _normalize(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def test_migration_revision_metadata() -> None:
    m = _load_0038()
    assert m.revision == "0038_i3_legacy_nullhash_collapse"
    assert m.down_revision == "0037_i3_alert_text_en"
    assert callable(m.upgrade) and callable(m.downgrade)


def test_legacy_hash_expr_matches_0021_backfill() -> None:
    m0038 = _load_0038()
    m0021 = _load_0021()
    expr_0038 = _normalize(m0038._LEGACY_HASH_EXPR)
    backfill_0021 = _normalize(m0021._BACKFILL_HASH)
    assert expr_0038 in backfill_0021
    assert expr_0038.startswith("md5(")
    assert "coalesce(alert_id," in expr_0038
    assert "extract(epoch from updated_at_utc)" in expr_0038
    assert expr_0038.count("E'\\x1F'") == 9


def test_promote_sets_hash_span_and_valid_to_and_is_resume_idempotent() -> None:
    m = _load_0038()
    sql = _normalize(m._PROMOTE_LEGACY_SURVIVORS)
    assert "content_hash" in sql
    assert "valid_to" in sql
    assert "first_seen_at" in sql
    assert "last_seen_at" in sql
    assert "a.content_hash IS NULL" in sql
    assert "existing_survivor_ctid IS NULL" in sql
    assert "existing_survivor_ctid IS NOT NULL" in sql


def test_keeper_selection_prefers_latest_captured() -> None:
    m = _load_0038()
    sql = _normalize(m._BUILD_LEGACY_KEEPERS)
    assert "DISTINCT ON (provider_id, legacy_hash)" in sql
    assert "captured_at_utc DESC" in sql
    assert "WHERE content_hash IS NULL" in sql


def test_spans_cover_full_group_including_prior_survivor() -> None:
    m = _load_0038()
    sql = _normalize(m._BUILD_LEGACY_SPANS)
    assert "min(first_at) AS first_seen" in sql
    assert "max(last_at) AS last_seen" in sql
    assert "WHERE content_hash IS NULL" in sql
    assert "UNION ALL" in sql
    assert "p.valid_to IS NOT NULL" in sql
    assert "p.first_seen_at" in sql
    assert "p.last_seen_at" in sql


def test_batched_delete_targets_only_null_hash_rows() -> None:
    m = _load_0038()
    assert m._BATCH_SIZE == 100_000
    sql = _normalize(m._DELETE_LEGACY_BATCH)
    assert "DELETE FROM silver.i3_alerts" in sql
    assert "content_hash IS NULL" in sql
    assert "LIMIT 100000" in sql


def test_upgrade_uses_autocommit_block_and_parallel_zero_vacuum() -> None:
    src = inspect.getsource(_load_0038().upgrade)
    assert "autocommit_block" in src
    assert "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alerts" in src
    assert "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alert_informed_entities" in src
    assert "_delete_in_batches" in src


def test_upgrade_is_dev_shm_safe() -> None:
    src = inspect.getsource(_load_0038().upgrade)
    assert "SET max_parallel_workers_per_gather = 0" in src
    assert "work_mem" in src


def test_delete_loop_is_batched_and_bounded() -> None:
    src = inspect.getsource(_load_0038()._delete_in_batches)
    assert "rowcount" in src
    assert "break" in src


def test_downgrade_refuses() -> None:
    m = _load_0038()
    with pytest.raises(NotImplementedError):
        m.downgrade()
