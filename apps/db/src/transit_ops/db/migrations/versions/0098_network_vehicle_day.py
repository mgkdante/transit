"""Empty vehicles per service day table for counts from archived captures."""

from alembic import op

revision = "0098_network_vehicle_day"
down_revision = "0097_history_ledger"
branch_labels = None
depends_on = None

DDL = r"""
CREATE TABLE gold.network_vehicle_day (
    provider_id text NOT NULL, -- No FK: migration locks no existing table.
    revision integer NOT NULL, -- Definition version of the count.
    service_date date NOT NULL,
    vehicles_reporting integer NOT NULL CHECK (vehicles_reporting >= 0),
    vehicles_on_trip integer NOT NULL CHECK (vehicles_on_trip >= 0),
    captures_read integer NOT NULL CHECK (captures_read >= 0),
    source_fingerprint text NOT NULL,
    PRIMARY KEY (provider_id, revision, service_date),
    CHECK (vehicles_on_trip <= vehicles_reporting)
);
REVOKE ALL ON gold.network_vehicle_day FROM PUBLIC;
DO $$ BEGIN
    -- Revoke an owner's ordinary privileges too: the builder cannot truncate.
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit_app') THEN
        REVOKE ALL ON gold.network_vehicle_day FROM transit_app;
        GRANT USAGE ON SCHEMA gold TO transit_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON gold.network_vehicle_day TO transit_app;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit-db') THEN
        REVOKE ALL ON gold.network_vehicle_day FROM "transit-db";
        GRANT USAGE ON SCHEMA gold TO "transit-db";
        GRANT SELECT ON gold.network_vehicle_day TO "transit-db";
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("SET LOCAL statement_timeout = '15s'")
    op.execute(DDL)


def downgrade() -> None:
    op.execute("DROP TABLE gold.network_vehicle_day")
