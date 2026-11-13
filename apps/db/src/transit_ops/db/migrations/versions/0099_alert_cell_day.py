"""Empty alert cells per entity and service day for additive window figures."""

from alembic import op

revision = "0099_alert_cell_day"
down_revision = "0098_network_vehicle_day"
branch_labels = None
depends_on = None

DDL = r"""
CREATE TABLE gold.alert_cell_day ( -- No row when there is nothing to count (absence, never zero).
    provider_id text NOT NULL, -- No FK: migration locks no existing table.
    revision integer NOT NULL, -- Definition version of the figures.
    scope text NOT NULL CHECK (scope IN ('network', 'line', 'stop')),
    entity_id text NOT NULL, -- Empty only for the network row.
    service_date date NOT NULL,
    cause text NOT NULL CHECK (cause <> ''), -- Feed's word, or 'not_given' when absent.
    effect text NOT NULL CHECK (effect <> ''), -- Feed's word, or 'not_given' when absent.
    alert_days_active integer NOT NULL CHECK (alert_days_active >= 0), -- Summed over days: alert-days, never distinct alerts.
    episodes_started integer NOT NULL CHECK (episodes_started >= 0),
    episodes_ended integer NOT NULL CHECK (episodes_ended >= 0),
    active_seconds bigint NOT NULL CHECK (active_seconds >= 0), -- Summed over alerts active during the day.
    episodes_open_at_day_start integer NOT NULL CHECK (episodes_open_at_day_start >= 0), -- Stock: read for one day, never summed over days.
    attribution text NOT NULL CHECK (attribution IN ('approximate', 'exact')),
    built text NOT NULL CHECK (built IN ('at_close', 'backfill')),
    PRIMARY KEY (provider_id, revision, scope, entity_id, service_date, cause, effect),
    CHECK ((scope = 'network') = (entity_id = ''))
);
CREATE INDEX alert_cell_day_service_date_idx ON gold.alert_cell_day (provider_id, revision, service_date);
REVOKE ALL ON gold.alert_cell_day FROM PUBLIC;
DO $$ BEGIN
    -- Revoke an owner's ordinary privileges too: the builder cannot truncate.
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit_app') THEN
        REVOKE ALL ON gold.alert_cell_day FROM transit_app;
        GRANT USAGE ON SCHEMA gold TO transit_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON gold.alert_cell_day TO transit_app;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit-db') THEN
        REVOKE ALL ON gold.alert_cell_day FROM "transit-db";
        GRANT USAGE ON SCHEMA gold TO "transit-db";
        GRANT SELECT ON gold.alert_cell_day TO "transit-db";
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("SET LOCAL statement_timeout = '15s'")
    op.execute(DDL)


def downgrade() -> None:
    op.execute("DROP TABLE gold.alert_cell_day")
