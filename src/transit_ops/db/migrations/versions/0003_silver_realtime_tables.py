from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_silver_realtime_tables"
down_revision = "0002_silver_static_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trip_updates",
        sa.Column("realtime_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("trip_id", sa.Text(), nullable=True),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("direction_id", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("vehicle_id", sa.Text(), nullable=True),
        sa.Column("trip_schedule_relationship", sa.Integer(), nullable=True),
        sa.Column("delay_seconds", sa.Integer(), nullable=True),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("captured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_silver_trip_updates_snapshot_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_trip_updates_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "realtime_snapshot_id",
            "entity_index",
            name="pk_silver_trip_updates",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_trip_updates_provider_trip",
        "trip_updates",
        ["provider_id", "trip_id"],
        schema="silver",
    )
    op.create_index(
        "ix_silver_trip_updates_provider_route",
        "trip_updates",
        ["provider_id", "route_id"],
        schema="silver",
    )

    op.create_table(
        "trip_update_stop_time_updates",
        sa.Column("realtime_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("trip_update_entity_index", sa.Integer(), nullable=False),
        sa.Column("stop_time_update_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("stop_sequence", sa.Integer(), nullable=True),
        sa.Column("stop_id", sa.Text(), nullable=True),
        sa.Column("arrival_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("arrival_time_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("departure_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("departure_time_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("schedule_relationship", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_silver_trip_update_stop_times_snapshot_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_trip_update_stop_times_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id", "trip_update_entity_index"],
            ["silver.trip_updates.realtime_snapshot_id", "silver.trip_updates.entity_index"],
            name="fk_silver_trip_update_stop_times_trip_update",
        ),
        sa.PrimaryKeyConstraint(
            "realtime_snapshot_id",
            "trip_update_entity_index",
            "stop_time_update_index",
            name="pk_silver_trip_update_stop_time_updates",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_trip_update_stop_times_provider_stop",
        "trip_update_stop_time_updates",
        ["provider_id", "stop_id"],
        schema="silver",
    )

    op.create_table(
        "vehicle_positions",
        sa.Column("realtime_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
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
        sa.Column("position_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("captured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_silver_vehicle_positions_snapshot_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_vehicle_positions_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "realtime_snapshot_id",
            "entity_index",
            name="pk_silver_vehicle_positions",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_vehicle_positions_provider_vehicle",
        "vehicle_positions",
        ["provider_id", "vehicle_id"],
        schema="silver",
    )
    op.create_index(
        "ix_silver_vehicle_positions_provider_trip",
        "vehicle_positions",
        ["provider_id", "trip_id"],
        schema="silver",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_silver_vehicle_positions_provider_trip",
        table_name="vehicle_positions",
        schema="silver",
    )
    op.drop_index(
        "ix_silver_vehicle_positions_provider_vehicle",
        table_name="vehicle_positions",
        schema="silver",
    )
    op.drop_table("vehicle_positions", schema="silver")

    op.drop_index(
        "ix_silver_trip_update_stop_times_provider_stop",
        table_name="trip_update_stop_time_updates",
        schema="silver",
    )
    op.drop_table("trip_update_stop_time_updates", schema="silver")

    op.drop_index(
        "ix_silver_trip_updates_provider_route",
        table_name="trip_updates",
        schema="silver",
    )
    op.drop_index(
        "ix_silver_trip_updates_provider_trip",
        table_name="trip_updates",
        schema="silver",
    )
    op.drop_table("trip_updates", schema="silver")
