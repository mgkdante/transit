"""Retain live capture identity independently of empty caches and source retention."""

from alembic import op

revision = "0089_realtime_serving_state"
down_revision = "0088_warm_period_invalidation"
branch_labels = None
depends_on = None

_CACHES = """
    SELECT provider_id, 'trip_updates'::text AS endpoint_key,
           realtime_snapshot_id, captured_at_utc FROM gold.latest_trip_delay_snapshot
    UNION ALL
    SELECT provider_id, 'vehicle_positions'::text,
           realtime_snapshot_id, captured_at_utc FROM gold.latest_vehicle_snapshot
"""


def upgrade() -> None:
    op.execute("""
        CREATE TABLE gold.realtime_serving_state (
            provider_id text NOT NULL REFERENCES core.providers(provider_id) ON DELETE CASCADE,
            endpoint_key text NOT NULL CHECK (endpoint_key IN ('trip_updates', 'vehicle_positions')),
            realtime_snapshot_id bigint CHECK (realtime_snapshot_id > 0),
            captured_at_utc timestamptz,
            initialized_at_utc timestamptz NOT NULL DEFAULT clock_timestamp(),
            PRIMARY KEY (provider_id, endpoint_key),
            CHECK ((realtime_snapshot_id IS NULL) = (captured_at_utc IS NULL))
        )
    """)
    # The copied identity survives raw/Silver retention; a source FK would pin archives.
    op.execute("""
        COMMENT ON TABLE gold.realtime_serving_state IS
        'Accepted live identity survives empty caches and raw retention. NULL identity is unknown;
         initialized_at_utc is its fixed promotion cutoff, not a claim of prior serving.'
    """)
    op.execute(
        "LOCK TABLE gold.latest_trip_delay_snapshot, gold.latest_vehicle_snapshot IN SHARE MODE"
    )
    op.execute(f"""
        DO $$ BEGIN
            IF EXISTS (
                WITH cached AS ({_CACHES})
                SELECT 1 FROM cached AS c
                LEFT JOIN raw.realtime_snapshot_index AS r USING (realtime_snapshot_id)
                LEFT JOIN core.feed_endpoints AS e ON e.feed_endpoint_id = r.feed_endpoint_id
                GROUP BY c.provider_id, c.endpoint_key
                HAVING count(DISTINCT c.realtime_snapshot_id) <> 1
                    OR count(DISTINCT c.captured_at_utc) <> 1
                    OR NOT bool_and(COALESCE(
                        r.provider_id = c.provider_id AND e.provider_id = c.provider_id
                        AND e.endpoint_key = c.endpoint_key
                        AND r.captured_at_utc = c.captured_at_utc, false))
            ) THEN
                RAISE EXCEPTION 'Cannot initialize inconsistent Gold serving caches';
            END IF;
        END $$
    """)
    op.execute(f"""
        WITH cached AS ({_CACHES}), identities AS (
            SELECT provider_id, endpoint_key, min(realtime_snapshot_id) AS realtime_snapshot_id,
                   min(captured_at_utc) AS captured_at_utc
            FROM cached GROUP BY provider_id, endpoint_key
        )
        INSERT INTO gold.realtime_serving_state
            (provider_id, endpoint_key, realtime_snapshot_id, captured_at_utc)
        SELECT e.provider_id, e.endpoint_key, c.realtime_snapshot_id, c.captured_at_utc
        FROM core.feed_endpoints AS e
        LEFT JOIN identities AS c USING (provider_id, endpoint_key)
        WHERE e.endpoint_key IN ('trip_updates', 'vehicle_positions')
    """)


def downgrade() -> None:
    op.drop_table("realtime_serving_state", schema="gold")
