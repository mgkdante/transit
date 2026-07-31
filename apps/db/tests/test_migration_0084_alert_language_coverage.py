"""Migration contract for pre-coalescing alert-language observations."""

from __future__ import annotations

import importlib
from unittest.mock import patch

import sqlalchemy as sa


def _migration():
    return importlib.import_module(
        "transit_ops.db.migrations.versions.0084_alert_language_coverage"
    )


def _run_upgrade(migration):
    with (
        patch.object(migration.op, "create_table") as create_table,
        patch.object(migration.op, "create_index") as create_index,
    ):
        migration.upgrade()
    return create_table, create_index


def _table_call(create_table, name: str):
    return next(call for call in create_table.call_args_list if call.args[0] == name)


def _columns(call) -> dict[str, sa.Column]:
    return {
        item.name: item
        for item in call.args[1:]
        if isinstance(item, sa.Column)
    }


def _constraints(call) -> dict[str, sa.Constraint]:
    return {
        item.name: item
        for item in call.args[1:]
        if isinstance(item, sa.Constraint)
    }


def test_migration_0084_chain_is_linear() -> None:
    migration = _migration()

    assert migration.revision == "0084_alert_language_coverage"
    assert len(migration.revision) <= 32
    assert migration.down_revision == "0083_snapshot_historic_receipts"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_migration_0084_creates_exact_alert_observation_grain() -> None:
    migration = _migration()
    create_table, create_index = _run_upgrade(migration)
    call = _table_call(create_table, "alert_language_observations")

    assert call.kwargs == {"schema": "raw"}
    columns = _columns(call)
    assert set(columns) == {
        "provider_id",
        "alert_logical_id",
        "observation_date",
        "has_explicit_fr",
        "has_explicit_en",
        "undetermined",
        "observed_at_utc",
    }
    assert all(column.nullable is False for column in columns.values())
    assert isinstance(columns["provider_id"].type, sa.Text)
    assert isinstance(columns["alert_logical_id"].type, sa.Text)
    assert isinstance(columns["observation_date"].type, sa.Date)
    assert isinstance(columns["has_explicit_fr"].type, sa.Boolean)
    assert isinstance(columns["has_explicit_en"].type, sa.Boolean)
    assert isinstance(columns["undetermined"].type, sa.Boolean)
    assert isinstance(columns["observed_at_utc"].type, sa.DateTime)
    assert columns["observed_at_utc"].type.timezone is True

    constraints = _constraints(call)
    primary_key = constraints["pk_raw_alert_language_observations"]
    assert tuple(primary_key._pending_colargs) == (
        "provider_id",
        "alert_logical_id",
        "observation_date",
    )
    foreign_key = constraints["fk_raw_alert_language_observations_provider_id"]
    assert {element.target_fullname for element in foreign_key.elements} == {
        "core.providers.provider_id"
    }
    bucket_check = constraints["ck_raw_alert_language_observations_bucket"]
    assert str(bucket_check.sqltext) == (
        "undetermined = NOT (has_explicit_fr OR has_explicit_en)"
    )

    assert any(
        call.args[:3]
        == (
            "ix_raw_alert_language_observations_window",
            "alert_language_observations",
            ["provider_id", "observation_date"],
        )
        and call.kwargs == {"schema": "raw"}
        for call in create_index.call_args_list
    )


def test_migration_0084_records_empty_feed_days_separately() -> None:
    migration = _migration()
    create_table, _ = _run_upgrade(migration)
    call = _table_call(create_table, "alert_feed_observations")

    assert call.kwargs == {"schema": "raw"}
    columns = _columns(call)
    assert set(columns) == {
        "provider_id",
        "observation_date",
        "alert_count",
        "observed_at_utc",
    }
    assert all(column.nullable is False for column in columns.values())
    assert isinstance(columns["alert_count"].type, sa.Integer)

    constraints = _constraints(call)
    primary_key = constraints["pk_raw_alert_feed_observations"]
    assert tuple(primary_key._pending_colargs) == (
        "provider_id",
        "observation_date",
    )
    assert (
        str(constraints["ck_raw_alert_feed_observations_count"].sqltext)
        == "alert_count >= 0"
    )


def test_migration_0084_creates_retained_daily_measurement_rows() -> None:
    migration = _migration()
    create_table, create_index = _run_upgrade(migration)
    call = _table_call(create_table, "alert_language_coverage_samples")

    assert call.kwargs == {"schema": "core"}
    columns = _columns(call)
    assert set(columns) == {
        "provider_id",
        "measurement_date",
        "window_days",
        "window_start",
        "window_end",
        "state",
        "explicit_en_pct",
        "explicit_fr_pct",
        "undetermined_pct",
        "denominator",
        "alert_observation_count",
        "feed_observation_days",
        "measured_at_utc",
    }
    required = {
        "provider_id",
        "measurement_date",
        "window_days",
        "window_start",
        "window_end",
        "state",
        "denominator",
        "alert_observation_count",
        "feed_observation_days",
        "measured_at_utc",
    }
    assert all(columns[name].nullable is False for name in required)
    assert all(
        columns[name].nullable is True
        for name in ("explicit_en_pct", "explicit_fr_pct", "undetermined_pct")
    )

    constraints = _constraints(call)
    primary_key = constraints["pk_core_alert_language_coverage_samples"]
    assert tuple(primary_key._pending_colargs) == (
        "provider_id",
        "measurement_date",
        "window_days",
    )
    checks = {
        name: str(constraint.sqltext)
        for name, constraint in constraints.items()
        if isinstance(constraint, sa.CheckConstraint)
    }
    assert checks["ck_core_alert_language_coverage_samples_window"] == (
        "window_days IN (7, 30)"
    )
    assert checks["ck_core_alert_language_coverage_samples_state"] == (
        "state IN ('available', 'no-alerts', 'unavailable', 'unsupported')"
    )
    assert checks["ck_core_alert_language_coverage_samples_dates"] == (
        "window_start <= window_end AND measurement_date = window_end"
    )
    assert any(
        index_call.args[:3]
        == (
            "ix_core_alert_language_coverage_samples_measured",
            "alert_language_coverage_samples",
            ["measurement_date", "provider_id"],
        )
        and index_call.kwargs == {"schema": "core"}
        for index_call in create_index.call_args_list
    )


def test_migration_0084_downgrade_is_symmetric() -> None:
    migration = _migration()

    with (
        patch.object(migration.op, "drop_index") as drop_index,
        patch.object(migration.op, "drop_table") as drop_table,
    ):
        migration.downgrade()

    assert [call.args[0] for call in drop_index.call_args_list] == [
        "ix_core_alert_language_coverage_samples_measured",
        "ix_raw_alert_language_observations_window",
    ]
    assert [
        (call.args[0], call.kwargs["schema"])
        for call in drop_table.call_args_list
    ] == [
        ("alert_language_coverage_samples", "core"),
        ("alert_feed_observations", "raw"),
        ("alert_language_observations", "raw"),
    ]
