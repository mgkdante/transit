"""Static contract test for migration 0040: guarded CREATE EXTENSION pg_repack.

slice-9.1.1m creates the pg_repack extension so the weekly maintenance job has a
real extension to invoke. The create is guarded on pg_available_extensions so dev
/ pg_dump-restored throwaway clusters (which lack postgresql-16-repack) skip with
a notice instead of erroring. The downgrade drops it.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0040_create_pg_repack_extension.py"
)


def _read() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _load_module():
    spec = importlib.util.spec_from_file_location("_mig_0040", MIGRATION.resolve())
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_0040_chain() -> None:
    module = _load_module()
    assert module.revision == "0040_create_pg_repack_extension"
    # down_revision must chain off the actual current head after wave-2 + the
    # prior wave-3 i3 cars (s -> l). The stale plan said 0028; reconciled to 0039.
    assert module.down_revision == "0039_i3_content_hash_not_null"
    assert callable(module.upgrade)
    assert callable(module.downgrade)


def test_0040_guarded_create() -> None:
    text = _read()
    # Guard on pg_available_extensions so throwaway clusters skip cleanly.
    assert "pg_available_extensions" in text
    assert "CREATE EXTENSION IF NOT EXISTS pg_repack" in text
    assert "DROP EXTENSION IF EXISTS pg_repack" in text


def test_0040_is_catalog_light_no_table_scan() -> None:
    # CREATE/DROP EXTENSION are catalog-only — no user-table scan, sort, rewrite,
    # VACUUM, or batching loop belongs here (STANDING LESSON 1).
    text = _read().upper()
    assert "VACUUM" not in text
    assert "AUTOCOMMIT_BLOCK" not in text
    # No bare ::cast SQL binds (STANDING LESSON 2) — none expected here, assert it.
    assert not re.search(r":\w+::", _read())
