from datetime import UTC, datetime
from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

MIGRATION = import_module("transit_ops.db.migrations.versions.0088_warm_period_invalidation")
PROVIDER = "warm_invalidation_migration"


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        seed_provider(connection, PROVIDER, display_name="Warm invalidation migration")
        connection.execute(
            text("""
            INSERT INTO gold.warm_rollup_periods
                (provider_id, rollup_kind, period_start_utc, built_at_utc)
            VALUES (:p, 'trip_delay_summary_5m', :period, :built)
        """),
            {
                "p": PROVIDER,
                "period": datetime(2026, 9, 4, 12, tzinfo=UTC),
                "built": datetime(2026, 9, 4, 13, tzinfo=UTC),
            },
        )
        try:
            yield connection
        finally:
            transaction.rollback()


def test_nullable_invalidation_migration_preserves_existing_watermarks(conn):
    query = text(
        "SELECT to_jsonb(w) - 'invalidated_at_utc' FROM gold.warm_rollup_periods w "
        "WHERE provider_id=:p"
    )
    before = conn.execute(query, {"p": PROVIDER}).scalar_one()
    with Operations.context(MigrationContext.configure(conn)):
        MIGRATION.downgrade()
        MIGRATION.upgrade()
    assert conn.execute(query, {"p": PROVIDER}).scalar_one() == before
    assert (
        conn.execute(
            text("SELECT invalidated_at_utc FROM gold.warm_rollup_periods WHERE provider_id=:p"),
            {"p": PROVIDER},
        ).scalar_one()
        is None
    )


def test_downgrade_cannot_discard_pending_periods(conn):
    conn.execute(
        text("UPDATE gold.warm_rollup_periods SET invalidated_at_utc=now() WHERE provider_id=:p"),
        {"p": PROVIDER},
    )
    with pytest.raises(DBAPIError, match="Complete pending warm periods"):
        with conn.begin_nested(), Operations.context(MigrationContext.configure(conn)):
            MIGRATION.downgrade()
    assert conn.execute(
        text(
            "SELECT invalidated_at_utc IS NOT NULL FROM gold.warm_rollup_periods "
            "WHERE provider_id=:p"
        ),
        {"p": PROVIDER},
    ).scalar_one()
