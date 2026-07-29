from __future__ import annotations

import importlib
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


def _migration():
    return importlib.import_module(
        "transit_ops.db.migrations.versions.0083_snapshot_historic_receipts"
    )


def _run_upgrade(migration):
    patches = (
        patch.object(migration.op, "create_table"),
        patch.object(migration.op, "create_index"),
        patch.object(migration.op, "add_column"),
        patch.object(migration.op, "create_check_constraint"),
    )
    mocks = tuple(item.start() for item in patches)
    try:
        migration.upgrade()
    finally:
        for item in reversed(patches):
            item.stop()
    return mocks


def test_migration_0083_chain_is_linear() -> None:
    migration = _migration()

    assert migration.revision == "0083_snapshot_historic_receipts"
    assert len(migration.revision) <= 32
    assert migration.down_revision == "0082_snapshot_historic_gc"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_migration_0083_creates_entity_grain_receipt_contract() -> None:
    migration = _migration()
    create_table, create_index, _, _ = _run_upgrade(migration)

    table_name, *items = create_table.call_args.args
    assert table_name == "snapshot_historic_receipts"
    assert create_table.call_args.kwargs == {"schema": "core"}

    columns = {item.name: item for item in items if isinstance(item, sa.Column)}
    assert set(columns) == {
        "provider_id",
        "family",
        "entity_key",
        "receipt_schema_version",
        "common_envelope",
        "common_envelope_sha256",
        "month_receipts",
        "scope_count",
        "first_scope_start",
        "last_scope_end",
        "entity_receipt_sha256",
        "origin_publish_generation_id",
        "activated_root_generation_id",
        "created_at_utc",
        "updated_at_utc",
    }
    assert all(column.nullable is False for column in columns.values())
    assert isinstance(columns["common_envelope"].type, postgresql.JSONB)
    assert isinstance(columns["month_receipts"].type, postgresql.JSONB)
    assert isinstance(columns["first_scope_start"].type, sa.Date)
    assert isinstance(columns["last_scope_end"].type, sa.Date)
    assert columns["created_at_utc"].server_default is not None
    assert columns["updated_at_utc"].server_default is not None

    constraints = {
        item.name: item for item in items if isinstance(item, sa.Constraint)
    }
    assert {
        "pk_core_snapshot_historic_receipts",
        "fk_core_snapshot_historic_receipts_provider_id",
        "ck_core_snapshot_historic_receipts_family",
        "ck_core_snapshot_historic_receipts_entity",
        "ck_core_snapshot_historic_receipts_schema_version",
        "ck_core_snapshot_historic_receipts_envelope_json",
        "ck_core_snapshot_historic_receipts_months_json",
        "ck_core_snapshot_historic_receipts_scope_count",
        "ck_core_snapshot_historic_receipts_coverage",
        "ck_core_snapshot_historic_receipts_envelope_sha",
        "ck_core_snapshot_historic_receipts_entity_sha",
    } <= set(constraints)
    primary_key = constraints["pk_core_snapshot_historic_receipts"]
    assert tuple(primary_key._pending_colargs) == (
        "provider_id",
        "family",
        "entity_key",
    )
    foreign_key = constraints["fk_core_snapshot_historic_receipts_provider_id"]
    assert {element.target_fullname for element in foreign_key.elements} == {
        "core.providers.provider_id"
    }

    checks = "\n".join(
        str(item.sqltext)
        for item in constraints.values()
        if isinstance(item, sa.CheckConstraint)
    )
    assert "family IN ('network', 'lines', 'stops')" in checks
    assert "family = 'network' AND entity_key = ''" in checks
    assert "jsonb_typeof(common_envelope) = 'object'" in checks
    assert "jsonb_typeof(month_receipts) = 'object'" in checks
    assert "scope_count > 0" in checks
    assert "first_scope_start <= last_scope_end" in checks
    assert checks.count("^[0-9a-f]{64}$") == 2
    assert "jsonb_object_length" not in checks

    create_index.assert_called_once_with(
        "ix_snapshot_historic_receipts_retention",
        "snapshot_historic_receipts",
        ["provider_id", "family", "last_scope_end"],
        schema="core",
    )


def test_migration_0083_adds_nullable_telemetry_and_downgrades_symmetrically() -> None:
    migration = _migration()
    _, _, add_column, create_check_constraint = _run_upgrade(migration)

    state_columns = {
        call.args[1].name: call.args[1] for call in add_column.call_args_list
    }
    assert set(state_columns) == {
        "historic_files_reused",
        "historic_scopes_reused",
        "historic_scopes_rebuilt",
        "historic_source_digest_ms",
        "historic_build_ms",
        "historic_gate_ms",
        "historic_upload_ms",
        "historic_parent_compose_ms",
        "historic_compatibility_ms",
        "historic_receipt_persist_ms",
        "historic_receipt_rows_attempted",
        "historic_receipt_rows_changed",
        "historic_phase_detail",
    }
    assert all(
        call.args[0] == "snapshot_publish_state"
        and call.kwargs == {"schema": "core"}
        for call in add_column.call_args_list
    )
    assert all(column.nullable is True for column in state_columns.values())
    assert all(column.server_default is None for column in state_columns.values())

    count_columns = {
        "historic_files_reused",
        "historic_scopes_reused",
        "historic_scopes_rebuilt",
        "historic_receipt_rows_attempted",
        "historic_receipt_rows_changed",
    }
    timing_columns = {
        "historic_source_digest_ms",
        "historic_build_ms",
        "historic_gate_ms",
        "historic_upload_ms",
        "historic_parent_compose_ms",
        "historic_compatibility_ms",
        "historic_receipt_persist_ms",
    }
    assert all(
        isinstance(state_columns[name].type, sa.Integer) for name in count_columns
    )
    assert all(isinstance(state_columns[name].type, sa.Float) for name in timing_columns)
    assert isinstance(state_columns["historic_phase_detail"].type, postgresql.JSONB)

    create_check_constraint.assert_called_once_with(
        "ck_core_snapshot_publish_state_files_arithmetic",
        "snapshot_publish_state",
        "files_total = files_written + files_skipped "
        "+ COALESCE(historic_files_reused, 0)",
        schema="core",
    )

    with (
        patch.object(migration.op, "drop_constraint") as drop_constraint,
        patch.object(migration.op, "drop_column") as drop_column,
        patch.object(migration.op, "drop_index") as drop_index,
        patch.object(migration.op, "drop_table") as drop_table,
    ):
        migration.downgrade()

    drop_constraint.assert_called_once_with(
        "ck_core_snapshot_publish_state_files_arithmetic",
        "snapshot_publish_state",
        schema="core",
        type_="check",
    )
    dropped_columns = {
        call.args[1]
        for call in drop_column.call_args_list
        if call.args[0] == "snapshot_publish_state"
        and call.kwargs == {"schema": "core"}
    }
    assert dropped_columns == set(state_columns)
    drop_index.assert_called_once_with(
        "ix_snapshot_historic_receipts_retention",
        table_name="snapshot_historic_receipts",
        schema="core",
    )
    drop_table.assert_called_once_with("snapshot_historic_receipts", schema="core")
