from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_gold_latest_tables"
down_revision = "0005_gold_kpi_views_null_safe"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_realtime_snapshot_provider_captured_at",
        "realtime_snapshot_index",
        ["provider_id", "captured_at_utc"],
        schema="raw",
    )

    op.create_table(
        "latest_vehicle_snapshot",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("realtime_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("snapshot_date_key", sa.Integer(), nullable=False),
        sa.Column("snapshot_local_date", sa.Date(), nullable=False),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("captured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("position_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("vehicle_id", sa.Text(), nullable=True),
        sa.Column("trip_id", sa.Text(), nullable=True),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("stop_id", sa.Text(), nullable=True),
        sa.Column("current_stop_sequence", sa.Integer(), nullable=True),
        sa.Column("current_status", sa.Integer(), nullable=True),
        sa.Column("occupancy_status", sa.Integer(), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("bearing", sa.Float(), nullable=True),
        sa.Column("speed", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_latest_vehicle_snapshot_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_gold_latest_vehicle_snapshot_snapshot_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "realtime_snapshot_id",
            "entity_index",
            name="pk_gold_latest_vehicle_snapshot",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_latest_vehicle_snapshot_provider_route",
        "latest_vehicle_snapshot",
        ["provider_id", "route_id"],
        schema="gold",
    )
    op.create_index(
        "ix_gold_latest_vehicle_snapshot_provider_date_key",
        "latest_vehicle_snapshot",
        ["provider_id", "snapshot_date_key"],
        schema="gold",
    )

    op.create_table(
        "latest_trip_delay_snapshot",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("realtime_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("snapshot_date_key", sa.Integer(), nullable=False),
        sa.Column("snapshot_local_date", sa.Date(), nullable=False),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("captured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("trip_id", sa.Text(), nullable=True),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("direction_id", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("vehicle_id", sa.Text(), nullable=True),
        sa.Column("trip_schedule_relationship", sa.Integer(), nullable=True),
        sa.Column("delay_seconds", sa.Integer(), nullable=True),
        sa.Column("stop_time_update_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_latest_trip_delay_snapshot_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_gold_latest_trip_delay_snapshot_snapshot_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "realtime_snapshot_id",
            "entity_index",
            name="pk_gold_latest_trip_delay_snapshot",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_latest_trip_delay_snapshot_provider_route",
        "latest_trip_delay_snapshot",
        ["provider_id", "route_id"],
        schema="gold",
    )
    op.create_index(
        "ix_gold_latest_trip_delay_snapshot_provider_date_key",
        "latest_trip_delay_snapshot",
        ["provider_id", "snapshot_date_key"],
        schema="gold",
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_active_vehicles_latest AS
        SELECT
            provider_id,
            realtime_snapshot_id,
            max(feed_timestamp_utc) AS feed_timestamp_utc,
            max(captured_at_utc) AS captured_at_utc,
            count(*)::bigint AS active_vehicle_count
        FROM gold.latest_vehicle_snapshot
        GROUP BY provider_id, realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_routes_with_live_vehicles_latest AS
        SELECT
            provider_id,
            realtime_snapshot_id,
            max(feed_timestamp_utc) AS feed_timestamp_utc,
            max(captured_at_utc) AS captured_at_utc,
            count(DISTINCT route_id)::bigint AS routes_with_live_vehicles
        FROM gold.latest_vehicle_snapshot
        WHERE route_id IS NOT NULL
        GROUP BY provider_id, realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_avg_trip_delay_latest AS
        SELECT
            provider_id,
            realtime_snapshot_id,
            max(feed_timestamp_utc) AS feed_timestamp_utc,
            max(captured_at_utc) AS captured_at_utc,
            round(
                avg(delay_seconds) FILTER (WHERE delay_seconds IS NOT NULL)::numeric,
                2
            ) AS avg_delay_seconds
        FROM gold.latest_trip_delay_snapshot
        GROUP BY provider_id, realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_max_trip_delay_latest AS
        SELECT
            provider_id,
            realtime_snapshot_id,
            max(feed_timestamp_utc) AS feed_timestamp_utc,
            max(captured_at_utc) AS captured_at_utc,
            max(delay_seconds) AS max_delay_seconds
        FROM gold.latest_trip_delay_snapshot
        GROUP BY provider_id, realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_delayed_trip_count_latest AS
        SELECT
            provider_id,
            realtime_snapshot_id,
            max(feed_timestamp_utc) AS feed_timestamp_utc,
            max(captured_at_utc) AS captured_at_utc,
            count(*) FILTER (WHERE delay_seconds > 0)::bigint AS delayed_trip_count
        FROM gold.latest_trip_delay_snapshot
        GROUP BY provider_id, realtime_snapshot_id
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_delayed_trip_count_latest AS
        WITH latest AS (
            SELECT
                provider_id,
                max(realtime_snapshot_id) AS realtime_snapshot_id
            FROM gold.fact_trip_delay_snapshot
            GROUP BY provider_id
        )
        SELECT
            l.provider_id,
            l.realtime_snapshot_id,
            max(f.feed_timestamp_utc) AS feed_timestamp_utc,
            max(f.captured_at_utc) AS captured_at_utc,
            count(*) FILTER (WHERE f.delay_seconds > 0)::bigint AS delayed_trip_count
        FROM latest AS l
        LEFT JOIN gold.fact_trip_delay_snapshot AS f
            ON f.provider_id = l.provider_id
           AND f.realtime_snapshot_id = l.realtime_snapshot_id
        GROUP BY l.provider_id, l.realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_max_trip_delay_latest AS
        WITH latest AS (
            SELECT
                provider_id,
                max(realtime_snapshot_id) AS realtime_snapshot_id
            FROM gold.fact_trip_delay_snapshot
            GROUP BY provider_id
        )
        SELECT
            f.provider_id,
            f.realtime_snapshot_id,
            max(f.feed_timestamp_utc) AS feed_timestamp_utc,
            max(f.captured_at_utc) AS captured_at_utc,
            max(f.delay_seconds) AS max_delay_seconds
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN latest AS l
            ON l.provider_id = f.provider_id
           AND l.realtime_snapshot_id = f.realtime_snapshot_id
        GROUP BY f.provider_id, f.realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_avg_trip_delay_latest AS
        WITH latest AS (
            SELECT
                provider_id,
                max(realtime_snapshot_id) AS realtime_snapshot_id
            FROM gold.fact_trip_delay_snapshot
            GROUP BY provider_id
        )
        SELECT
            l.provider_id,
            l.realtime_snapshot_id,
            max(f.feed_timestamp_utc) AS feed_timestamp_utc,
            max(f.captured_at_utc) AS captured_at_utc,
            round(
                avg(f.delay_seconds) FILTER (WHERE f.delay_seconds IS NOT NULL)::numeric,
                2
            ) AS avg_delay_seconds
        FROM latest AS l
        LEFT JOIN gold.fact_trip_delay_snapshot AS f
            ON f.provider_id = l.provider_id
           AND f.realtime_snapshot_id = l.realtime_snapshot_id
        GROUP BY l.provider_id, l.realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_routes_with_live_vehicles_latest AS
        WITH latest AS (
            SELECT
                provider_id,
                max(realtime_snapshot_id) AS realtime_snapshot_id
            FROM gold.fact_vehicle_snapshot
            GROUP BY provider_id
        )
        SELECT
            f.provider_id,
            f.realtime_snapshot_id,
            max(f.feed_timestamp_utc) AS feed_timestamp_utc,
            max(f.captured_at_utc) AS captured_at_utc,
            count(DISTINCT f.route_id)::bigint AS routes_with_live_vehicles
        FROM gold.fact_vehicle_snapshot AS f
        INNER JOIN latest AS l
            ON l.provider_id = f.provider_id
           AND l.realtime_snapshot_id = f.realtime_snapshot_id
        WHERE f.route_id IS NOT NULL
        GROUP BY f.provider_id, f.realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_active_vehicles_latest AS
        WITH latest AS (
            SELECT
                provider_id,
                max(realtime_snapshot_id) AS realtime_snapshot_id
            FROM gold.fact_vehicle_snapshot
            GROUP BY provider_id
        )
        SELECT
            f.provider_id,
            f.realtime_snapshot_id,
            max(f.feed_timestamp_utc) AS feed_timestamp_utc,
            max(f.captured_at_utc) AS captured_at_utc,
            count(*)::bigint AS active_vehicle_count
        FROM gold.fact_vehicle_snapshot AS f
        INNER JOIN latest AS l
            ON l.provider_id = f.provider_id
           AND l.realtime_snapshot_id = f.realtime_snapshot_id
        GROUP BY f.provider_id, f.realtime_snapshot_id
        """
    )

    op.drop_index(
        "ix_gold_latest_trip_delay_snapshot_provider_date_key",
        table_name="latest_trip_delay_snapshot",
        schema="gold",
    )
    op.drop_index(
        "ix_gold_latest_trip_delay_snapshot_provider_route",
        table_name="latest_trip_delay_snapshot",
        schema="gold",
    )
    op.drop_table("latest_trip_delay_snapshot", schema="gold")

    op.drop_index(
        "ix_gold_latest_vehicle_snapshot_provider_date_key",
        table_name="latest_vehicle_snapshot",
        schema="gold",
    )
    op.drop_index(
        "ix_gold_latest_vehicle_snapshot_provider_route",
        table_name="latest_vehicle_snapshot",
        schema="gold",
    )
    op.drop_table("latest_vehicle_snapshot", schema="gold")

    op.drop_index(
        "ix_realtime_snapshot_provider_captured_at",
        table_name="realtime_snapshot_index",
        schema="raw",
    )
