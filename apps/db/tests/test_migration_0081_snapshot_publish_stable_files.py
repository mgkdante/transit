"""Migration 0081 adds a nullable logical-surface publish baseline."""

from __future__ import annotations

import importlib
from unittest.mock import patch


def test_migration_0081_adds_and_drops_nullable_stable_total() -> None:
    migration = importlib.import_module(
        "transit_ops.db.migrations.versions.0081_snapshot_publish_stable_files"
    )

    with patch.object(migration.op, "add_column") as add_column:
        migration.upgrade()
    table, column = add_column.call_args.args
    assert table == "snapshot_publish_state"
    assert add_column.call_args.kwargs == {"schema": "core"}
    assert column.name == "stable_files_total"
    assert column.nullable is True

    with patch.object(migration.op, "drop_column") as drop_column:
        migration.downgrade()
    drop_column.assert_called_once_with(
        "snapshot_publish_state",
        "stable_files_total",
        schema="core",
    )


def test_migration_0081_chain_is_linear() -> None:
    migration = importlib.import_module(
        "transit_ops.db.migrations.versions.0081_snapshot_publish_stable_files"
    )
    assert migration.revision == "0081_publish_stable_files"
    assert len(migration.revision) <= 32
    assert migration.down_revision == "0080_alert_archive"
