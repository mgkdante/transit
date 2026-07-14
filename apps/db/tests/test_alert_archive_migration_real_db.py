"""Transactional PostgreSQL proof for migration 0080.

Set TRANSIT_TEST_DATABASE_URL to a disposable database already migrated through
0079 or later. Every DDL change runs in one transaction and is rolled back.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0080_alert_archive.py"
    )
    spec = importlib.util.spec_from_file_location("m0080_real_db", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0080_upgrade_and_downgrade_are_transactional_on_postgres() -> None:
    database_url = os.getenv("TRANSIT_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("set TRANSIT_TEST_DATABASE_URL for the PostgreSQL migration proof")

    engine = create_engine(database_url)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("DROP TABLE IF EXISTS gold.alert_archive_entry"))
            assert connection.execute(
                text("SELECT to_regclass('gold.i3_alert_history_reporting') IS NOT NULL")
            ).scalar_one()

            migration = _load_migration()
            migration.op = Operations(MigrationContext.configure(connection))
            migration.upgrade()

            columns = {
                column["name"]: column
                for column in inspect(connection).get_columns("alert_archive_entry", schema="gold")
            }
            assert columns["description_text"]["nullable"] is True
            assert columns["description_text_en"]["nullable"] is True
            assert columns["route_ids"]["nullable"] is False
            assert columns["active_periods"]["nullable"] is False
            assert inspect(connection).get_pk_constraint("alert_archive_entry", schema="gold")[
                "constrained_columns"
            ] == ["provider_id", "alert_id"]

            migration.downgrade()
            assert connection.execute(
                text("SELECT to_regclass('gold.alert_archive_entry') IS NULL")
            ).scalar_one()
            assert connection.execute(
                text("SELECT to_regclass('gold.i3_alert_history_reporting') IS NOT NULL")
            ).scalar_one()
        finally:
            transaction.rollback()
