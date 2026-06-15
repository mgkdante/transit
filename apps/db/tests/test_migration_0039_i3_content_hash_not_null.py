"""Static contract test for migration 0039: content_hash SET NOT NULL.

slice-9.1.1l enables the deferred 0021 SET NOT NULL on silver.i3_alerts
.content_hash after 0038 collapses the legacy NULL-hash backlog. A DO-block
guard RAISEs if any NULL-hash row survives; the constraint scopes to
content_hash only.
"""

from __future__ import annotations

import importlib.util
import inspect
import pathlib
import re

_VERSIONS = (
    pathlib.Path(__file__).resolve().parents[1]
    / "src/transit_ops/db/migrations/versions"
)


def _load_0039():
    spec = importlib.util.spec_from_file_location(
        "m0039", _VERSIONS / "0039_i3_content_hash_not_null.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _normalize(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def test_migration_revision_metadata() -> None:
    m = _load_0039()
    assert m.revision == "0039_i3_content_hash_not_null"
    assert m.down_revision == "0038_i3_legacy_nullhash_collapse"
    assert callable(m.upgrade) and callable(m.downgrade)


def test_upgrade_guards_against_remaining_null_rows() -> None:
    m = _load_0039()
    guard = _normalize(m._GUARD_NO_NULL_HASH)
    assert "RAISE EXCEPTION" in guard
    assert "content_hash IS NULL" in guard
    # the guard runs before the constraint change in upgrade()
    src = inspect.getsource(m.upgrade)
    assert src.index("_GUARD_NO_NULL_HASH") < src.index("_SET_NOT_NULL")


def test_upgrade_sets_not_null_on_content_hash_only() -> None:
    m = _load_0039()
    sql = _normalize(m._SET_NOT_NULL)
    assert sql.count("SET NOT NULL") == 1
    assert "ALTER COLUMN content_hash SET NOT NULL" in sql
    # scope is content_hash ONLY — not first_seen_at / last_seen_at
    assert "first_seen_at" not in sql
    assert "last_seen_at" not in sql


def test_downgrade_drops_not_null() -> None:
    m = _load_0039()
    sql = _normalize(m._DROP_NOT_NULL)
    assert "ALTER COLUMN content_hash DROP NOT NULL" in sql
