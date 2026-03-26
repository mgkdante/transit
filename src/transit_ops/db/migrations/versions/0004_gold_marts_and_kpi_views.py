from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_gold_marts_and_kpi_views"
down_revision = "0003_silver_realtime_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dim_route",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("route_short_name", sa.Text(), nullable=True),
        sa.Column("route_long_name", sa.Text(), nullable=True),
        sa.Column("route_desc", sa.Text(), nullable=True),
        sa.Column("route_type", sa.Integer(), nullable=False),
        sa.Column("route_color", sa.Text(), nullable=True),
        sa.Column("route_text_color", sa.Text(), nullable=True),
        sa.Column("route_sort_order", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_dim_route_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_gold_dim_route_dataset_version_id",
        ),
        sa.PrimaryKeyConstraint("provider_id", "route_id", name="pk_gold_dim_route"),
        schema="gold",
    )
    op.create_index(
        "ix_gold_dim_route_provider_short_name",
        "dim_route",
        ["provider_id", "route_short_name"],
        schema="gold",
    )

    op.create_table(
        "dim_stop",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        sa.Column("stop_code", sa.Text(), nullable=True),
        sa.Column("stop_name", sa.Text(), nullable=False),
        sa.Column("parent_station", sa.Text(), nullable=True),
        sa.Column("location_type", sa.Integer(), nullable=True),
        sa.Column("stop_lat", sa.Float(), nullable=True),
        sa.Column("stop_lon", sa.Float(), nullable=True),
        sa.Column("zone_id", sa.Text(), nullable=True),
        sa.Column("wheelchair_boarding", sa.Integer(), nullable=True),
        sa.Column("platform_code", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_dim_stop_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_gold_dim_stop_dataset_version_id",
        ),
        sa.PrimaryKeyConstraint("provider_id", "stop_id", name="pk_gold_dim_stop"),
        schema="gold",
    )
    op.create_index(
        "ix_gold_dim_stop_provider_name",
        "dim_stop",
        ["provider_id", "stop_name"],
        schema="gold",
    )

    op.create_table(
        "dim_date",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("date_key", sa.Integer(), nullable=False),
        sa.Column("day_of_week_iso", sa.Integer(), nullable=False),
        sa.Column("day_name", sa.Text(), nullable=False),
        sa.Column("week_of_year", sa.Integer(), nullable=False),
        sa.Column("month_number", sa.Integer(), nullable=False),
        sa.Column("month_name", sa.Text(), nullable=False),
        sa.Column("quarter_number", sa.Integer(), nullable=False),
        sa.Column("year_number", sa.Integer(), nullable=False),
        sa.Column("is_weekend", sa.Boolean(), nullable=False),
        sa.Column("has_calendar_exception", sa.Boolean(), nullable=False),
        sa.Column("is_service_added", sa.Boolean(), nullable=False),
        sa.Column("is_service_removed", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_dim_date_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_gold_dim_date_dataset_version_id",
        ),
        sa.PrimaryKeyConstraint("provider_id", "service_date", name="pk_gold_dim_date"),
        schema="gold",
    )
    op.create_index(
        "ix_gold_dim_date_provider_date_key",
        "dim_date",
        ["provider_id", "date_key"],
        schema="gold",
    )

    op.create_table(
        "fact_vehicle_snapshot",
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
            name="fk_gold_fact_vehicle_snapshot_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_gold_fact_vehicle_snapshot_snapshot_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "realtime_snapshot_id",
            "entity_index",
            name="pk_gold_fact_vehicle_snapshot",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_fact_vehicle_snapshot_provider_route",
        "fact_vehicle_snapshot",
        ["provider_id", "route_id"],
        schema="gold",
    )
    op.create_index(
        "ix_gold_fact_vehicle_snapshot_provider_date_key",
        "fact_vehicle_snapshot",
        ["provider_id", "snapshot_date_key"],
        schema="gold",
    )

    op.create_table(
        "fact_trip_delay_snapshot",
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
            name="fk_gold_fact_trip_delay_snapshot_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_gold_fact_trip_delay_snapshot_snapshot_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "realtime_snapshot_id",
            "entity_index",
            name="pk_gold_fact_trip_delay_snapshot",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_fact_trip_delay_snapshot_provider_route",
        "fact_trip_delay_snapshot",
        ["provider_id", "route_id"],
        schema="gold",
    )
    op.create_index(
        "ix_gold_fact_trip_delay_snapshot_provider_date_key",
        "fact_trip_delay_snapshot",
        ["provider_id", "snapshot_date_key"],
        schema="gold",
    )

    op.execute(
        """
        CREATE VIEW gold.kpi_active_vehicles_latest AS
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

    op.execute(
        """
        CREATE VIEW gold.kpi_routes_with_live_vehicles_latest AS
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
        CREATE VIEW gold.kpi_avg_trip_delay_latest AS
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
            round(avg(f.delay_seconds)::numeric, 2) AS avg_delay_seconds
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN latest AS l
            ON l.provider_id = f.provider_id
           AND l.realtime_snapshot_id = f.realtime_snapshot_id
        WHERE f.delay_seconds IS NOT NULL
        GROUP BY f.provider_id, f.realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE VIEW gold.kpi_max_trip_delay_latest AS
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
        CREATE VIEW gold.kpi_delayed_trip_count_latest AS
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
            count(*)::bigint AS delayed_trip_count
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN latest AS l
            ON l.provider_id = f.provider_id
           AND l.realtime_snapshot_id = f.realtime_snapshot_id
        WHERE f.delay_seconds > 0
        GROUP BY f.provider_id, f.realtime_snapshot_id
        """
    )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS gold.kpi_delayed_trip_count_latest")
    op.execute("DROP VIEW IF EXISTS gold.kpi_max_trip_delay_latest")
    op.execute("DROP VIEW IF EXISTS gold.kpi_avg_trip_delay_latest")
    op.execute("DROP VIEW IF EXISTS gold.kpi_routes_with_live_vehicles_latest")
    op.execute("DROP VIEW IF EXISTS gold.kpi_active_vehicles_latest")

    op.drop_index(
        "ix_gold_fact_trip_delay_snapshot_provider_date_key",
        table_name="fact_trip_delay_snapshot",
        schema="gold",
    )
    op.drop_index(
        "ix_gold_fact_trip_delay_snapshot_provider_route",
        table_name="fact_trip_delay_snapshot",
        schema="gold",
    )
    op.drop_table("fact_trip_delay_snapshot", schema="gold")

    op.drop_index(
        "ix_gold_fact_vehicle_snapshot_provider_date_key",
        table_name="fact_vehicle_snapshot",
        schema="gold",
    )
    op.drop_index(
        "ix_gold_fact_vehicle_snapshot_provider_route",
        table_name="fact_vehicle_snapshot",
        schema="gold",
    )
    op.drop_table("fact_vehicle_snapshot", schema="gold")

    op.drop_index(
        "ix_gold_dim_date_provider_date_key",
        table_name="dim_date",
        schema="gold",
    )
    op.drop_table("dim_date", schema="gold")

    op.drop_index(
        "ix_gold_dim_stop_provider_name",
        table_name="dim_stop",
        schema="gold",
    )
    op.drop_table("dim_stop", schema="gold")

    op.drop_index(
        "ix_gold_dim_route_provider_short_name",
        table_name="dim_route",
        schema="gold",
    )
    op.drop_table("dim_route", schema="gold")
