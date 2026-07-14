from __future__ import annotations

import importlib
from unittest.mock import patch


def test_migration_0082_creates_fail_closed_generation_mark_table() -> None:
    migration = importlib.import_module(
        "transit_ops.db.migrations.versions.0082_snapshot_historic_gc"
    )

    with patch.object(migration.op, "create_table") as create_table:
        migration.upgrade()

    table_name, *items = create_table.call_args.args
    assert table_name == "snapshot_historic_gc_marks"
    assert create_table.call_args.kwargs == {"schema": "core"}
    columns = {item.name: item for item in items if hasattr(item, "nullable")}
    assert set(columns) == {
        "provider_id",
        "object_key",
        "etag",
        "content_length",
        "object_last_modified_utc",
        "first_unreachable_utc",
        "last_confirmed_unreachable_utc",
        "last_scan_id",
    }
    assert all(column.nullable is False for column in columns.values())
    rendered = "\n".join(str(getattr(item, "sqltext", item)) for item in items)
    assert "provider_id" in rendered and "object_key" in rendered
    assert "generations" in rendered
    assert "content_length >= 0" in rendered
    assert "last_confirmed_unreachable_utc >= first_unreachable_utc" in rendered
    foreign_targets = {
        element.target_fullname
        for item in items
        for element in getattr(item, "elements", ())
        if hasattr(element, "target_fullname")
    }
    assert "core.providers.provider_id" in foreign_targets

    with patch.object(migration.op, "drop_table") as drop_table:
        migration.downgrade()
    drop_table.assert_called_once_with("snapshot_historic_gc_marks", schema="core")


def test_migration_0082_chain_is_linear() -> None:
    migration = importlib.import_module(
        "transit_ops.db.migrations.versions.0082_snapshot_historic_gc"
    )
    assert migration.revision == "0082_snapshot_historic_gc"
    assert len(migration.revision) <= 32
    assert migration.down_revision == "0081_publish_stable_files"
