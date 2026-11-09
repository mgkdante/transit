"""Bounded startup counters, independent of snapshot publication and pruners."""
from alembic import op

revision = "0094_worker_starts"
down_revision = "0093_alert_publication_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This tiny additive DDL should yield quickly to production activity. These
    # settings end with this revision's transaction, leaving other revisions alone.
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("SET LOCAL statement_timeout = '15s'")
    op.execute("""
        CREATE TABLE core.worker_starts (
            provider_id text PRIMARY KEY CHECK (provider_id ~ '^[a-z][a-z0-9_]{0,63}$'),
            start_count bigint NOT NULL CHECK (start_count > 0),
            first_started_at_utc timestamptz NOT NULL DEFAULT clock_timestamp(),
            last_started_at_utc timestamptz NOT NULL DEFAULT clock_timestamp()
        );
        REVOKE ALL ON core.worker_starts FROM PUBLIC;
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit_app') THEN
                GRANT USAGE ON SCHEMA core TO transit_app;
                GRANT SELECT, INSERT, UPDATE ON core.worker_starts TO transit_app;
            END IF;
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit-db') THEN
                GRANT USAGE ON SCHEMA core TO "transit-db";
                GRANT SELECT ON core.worker_starts TO "transit-db";
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.drop_table("worker_starts", schema="core")
