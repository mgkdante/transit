"""Rollback-only fixtures shared by history ledger packets."""

from contextlib import contextmanager
from importlib import import_module

import pytest
from sqlalchemy import text


@pytest.fixture
def conn(real_db_engine):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        yield connection
        transaction.rollback()


@contextmanager
def pipeline_role(conn, monkeypatch):
    migration = import_module("transit_ops.db.migrations.versions.0097_history_ledger")
    with monkeypatch.context() as patch, conn.begin_nested() as checkpoint:
        patch.setattr(migration.op, "execute", conn.exec_driver_sql)
        migration.downgrade()
        for role in ("transit_app", "transit-db"):
            if not conn.execute(
                text("SELECT 1 FROM pg_roles WHERE rolname=:role"), {"role": role}
            ).scalar():
                conn.exec_driver_sql(f'CREATE ROLE "{role}"')
        migration.upgrade()
        conn.exec_driver_sql("SET LOCAL ROLE transit_app")
        try:
            yield conn
        finally:
            checkpoint.rollback()
