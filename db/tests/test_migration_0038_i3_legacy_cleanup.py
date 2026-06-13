"""Static contract test for migration 0038: legacy NULL-hash collapse.

slice-9.1.1l collapses ~2.7M legacy content_hash IS NULL silver.i3_alerts rows:
one closed survivor per content version (latest-captured), batched DELETE of the
rest (entities cascade), autocommit_block + PARALLEL 0 VACUUM, irreversible
downgrade. The legacy hash expression must stay md5-identical to 0021's backfill
so survivors carry a real content_hash (which is what makes 0039's SET NOT NULL
legal).
"""

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
    # The 0038 legacy hash md5 body must appear verbatim inside 0021's backfill
    # md5 expression — same 10 fields, separators, epoch casts, NULL handling.
    expr_0038 = _normalize(m0038._LEGACY_HASH_EXPR)
    backfill_0021 = _normalize(m0021._BACKFILL_HASH)
    assert expr_0038 in backfill_0021
    # sanity: it really is the 10-field md5 body
    assert expr_0038.startswith("md5(")
    assert "coalesce(alert_id," in expr_0038
    assert "extract(epoch from updated_at_utc)" in expr_0038
    assert expr_0038.count("E'\\x1F'") == 9


def test_promote_sets_hash_span_and_valid_to_and_is_resume_idempotent() -> None:
    m = _load_0038()
    sql = _normalize(m._PROMOTE_LEGACY_SURVIVORS)
    # The first-time-promote pass sets content_hash AND valid_to together =>
    # survivor never enters the active partial-index domain (no collision with an
    # active twin), and stamps the full span.
    assert "content_hash" in sql
    assert "valid_to" in sql
    assert "first_seen_at" in sql
    assert "last_seen_at" in sql
    # Idempotency on resume (the BLOCKER fix): the first-time-promote pass is
    # guarded by `content_hash IS NULL`, so an already-promoted survivor from a
    # prior partial run can never be re-promoted into a SECOND closed row with a
    # narrower span. A separate re-stamp pass updates the EXISTING survivor in
    # place (keyed on existing_survivor_ctid) — exactly one survivor per group.
    assert "a.content_hash IS NULL" in sql
    assert "existing_survivor_ctid IS NULL" in sql
    assert "existing_survivor_ctid IS NOT NULL" in sql


def test_keeper_selection_prefers_latest_captured() -> None:
    m = _load_0038()
    sql = _normalize(m._BUILD_LEGACY_KEEPERS)
    assert "DISTINCT ON (provider_id, legacy_hash)" in sql
    assert "captured_at_utc DESC" in sql
    # keepers come ONLY from the NULL-hash work-set
    assert "WHERE content_hash IS NULL" in sql


def test_spans_cover_full_group_including_prior_survivor() -> None:
    m = _load_0038()
    sql = _normalize(m._BUILD_LEGACY_SPANS)
    # Span aggregates MIN/MAX bounds per content group.
    assert "min(first_at) AS first_seen" in sql
    assert "max(last_at) AS last_seen" in sql
    # The base set is the remaining NULL-hash rows ...
    assert "WHERE content_hash IS NULL" in sql
    # ... UNIONed with any already-promoted survivor's PRE-COMPUTED span
    # (first_seen_at/last_seen_at), so a resumed run re-stamps the FULL group
    # span and never narrows first_seen to whatever NULL dups survived the
    # interrupt. Folding only its captured_at_utc would re-narrow — guard against
    # a regression to that by requiring the survivor's own span columns.
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
    # batched delete loop, not a single unbounded DELETE
    assert "_delete_in_batches" in src


def test_upgrade_is_dev_shm_safe() -> None:
    # /dev/shm safety: the 2.7M-row keeper/span sort/group must not spawn a
    # parallel hash/sort that resizes the small containerized shared-memory
    # segment, and work_mem is bounded so a big sort spills to disk.
    src = inspect.getsource(_load_0038().upgrade)
    assert "SET max_parallel_workers_per_gather = 0" in src
    assert "work_mem" in src


def test_delete_loop_is_batched_and_bounded() -> None:
    src = inspect.getsource(_load_0038()._delete_in_batches)
    # the loop breaks when a batch deletes nothing — bounded, resumable
    assert "rowcount" in src
    assert "break" in src


def test_downgrade_refuses() -> None:
    m = _load_0038()
    with pytest.raises(NotImplementedError):
        m.downgrade()
