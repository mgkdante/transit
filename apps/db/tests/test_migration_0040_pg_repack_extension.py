
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
    assert module.down_revision == "0039_i3_content_hash_not_null"
    assert callable(module.upgrade)
    assert callable(module.downgrade)


def test_0040_guarded_create() -> None:
    text = _read()
    assert "pg_available_extensions" in text
    assert "CREATE EXTENSION IF NOT EXISTS pg_repack" in text
    assert "DROP EXTENSION IF EXISTS pg_repack" in text


def test_0040_is_catalog_light_no_table_scan() -> None:
    text = _read().upper()
    assert "VACUUM" not in text
    assert "AUTOCOMMIT_BLOCK" not in text
    assert not re.search(r":\w+::", _read())
