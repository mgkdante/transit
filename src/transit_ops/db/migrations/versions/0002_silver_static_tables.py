from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_silver_static_tables"
down_revision = "0001_initial_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_dataset_versions_hash",
        "dataset_versions",
        schema="core",
        type_="unique",
    )

    op.create_table(
        "routes",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("agency_id", sa.Text(), nullable=True),
        sa.Column("route_short_name", sa.Text(), nullable=True),
        sa.Column("route_long_name", sa.Text(), nullable=True),
        sa.Column("route_desc", sa.Text(), nullable=True),
        sa.Column("route_type", sa.Integer(), nullable=False),
        sa.Column("route_url", sa.Text(), nullable=True),
        sa.Column("route_color", sa.Text(), nullable=True),
        sa.Column("route_text_color", sa.Text(), nullable=True),
        sa.Column("route_sort_order", sa.Integer(), nullable=True),
        sa.Column("continuous_pickup", sa.Integer(), nullable=True),
        sa.Column("continuous_drop_off", sa.Integer(), nullable=True),
        sa.Column("network_id", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_routes_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_routes_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "route_id",
            name="pk_silver_routes",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_routes_provider_route",
        "routes",
        ["provider_id", "route_id"],
        schema="silver",
    )

    op.create_table(
        "stops",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        sa.Column("stop_code", sa.Text(), nullable=True),
        sa.Column("stop_name", sa.Text(), nullable=False),
        sa.Column("stop_desc", sa.Text(), nullable=True),
        sa.Column("stop_lat", sa.Float(), nullable=True),
        sa.Column("stop_lon", sa.Float(), nullable=True),
        sa.Column("zone_id", sa.Text(), nullable=True),
        sa.Column("stop_url", sa.Text(), nullable=True),
        sa.Column("location_type", sa.Integer(), nullable=True),
        sa.Column("parent_station", sa.Text(), nullable=True),
        sa.Column("stop_timezone", sa.Text(), nullable=True),
        sa.Column("wheelchair_boarding", sa.Integer(), nullable=True),
        sa.Column("platform_code", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_stops_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_stops_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "stop_id",
            name="pk_silver_stops",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_stops_provider_stop",
        "stops",
        ["provider_id", "stop_id"],
        schema="silver",
    )

    op.create_table(
        "trips",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("trip_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("service_id", sa.Text(), nullable=False),
        sa.Column("trip_headsign", sa.Text(), nullable=True),
        sa.Column("trip_short_name", sa.Text(), nullable=True),
        sa.Column("direction_id", sa.Integer(), nullable=True),
        sa.Column("block_id", sa.Text(), nullable=True),
        sa.Column("shape_id", sa.Text(), nullable=True),
        sa.Column("wheelchair_accessible", sa.Integer(), nullable=True),
        sa.Column("bikes_allowed", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_trips_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_trips_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id", "route_id"],
            ["silver.routes.dataset_version_id", "silver.routes.route_id"],
            name="fk_silver_trips_route",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "trip_id",
            name="pk_silver_trips",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_trips_provider_trip",
        "trips",
        ["provider_id", "trip_id"],
        schema="silver",
    )
    op.create_index(
        "ix_silver_trips_dataset_route",
        "trips",
        ["dataset_version_id", "route_id"],
        schema="silver",
    )

    op.create_table(
        "stop_times",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("trip_id", sa.Text(), nullable=False),
        sa.Column("stop_sequence", sa.Integer(), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        sa.Column("arrival_time", sa.Text(), nullable=True),
        sa.Column("departure_time", sa.Text(), nullable=True),
        sa.Column("stop_headsign", sa.Text(), nullable=True),
        sa.Column("pickup_type", sa.Integer(), nullable=True),
        sa.Column("drop_off_type", sa.Integer(), nullable=True),
        sa.Column("continuous_pickup", sa.Integer(), nullable=True),
        sa.Column("continuous_drop_off", sa.Integer(), nullable=True),
        sa.Column("shape_dist_traveled", sa.Float(), nullable=True),
        sa.Column("timepoint", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_stop_times_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_stop_times_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id", "trip_id"],
            ["silver.trips.dataset_version_id", "silver.trips.trip_id"],
            name="fk_silver_stop_times_trip",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id", "stop_id"],
            ["silver.stops.dataset_version_id", "silver.stops.stop_id"],
            name="fk_silver_stop_times_stop",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "trip_id",
            "stop_sequence",
            name="pk_silver_stop_times",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_stop_times_dataset_stop_sequence",
        "stop_times",
        ["dataset_version_id", "stop_id", "stop_sequence"],
        schema="silver",
    )

    op.create_table(
        "calendar",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("service_id", sa.Text(), nullable=False),
        sa.Column("monday", sa.Boolean(), nullable=False),
        sa.Column("tuesday", sa.Boolean(), nullable=False),
        sa.Column("wednesday", sa.Boolean(), nullable=False),
        sa.Column("thursday", sa.Boolean(), nullable=False),
        sa.Column("friday", sa.Boolean(), nullable=False),
        sa.Column("saturday", sa.Boolean(), nullable=False),
        sa.Column("sunday", sa.Boolean(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_calendar_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_calendar_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "service_id",
            name="pk_silver_calendar",
        ),
        schema="silver",
    )

    op.create_table(
        "calendar_dates",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("service_id", sa.Text(), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("exception_type", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_calendar_dates_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_calendar_dates_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "service_id",
            "service_date",
            name="pk_silver_calendar_dates",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_calendar_dates_dataset_service_date",
        "calendar_dates",
        ["dataset_version_id", "service_date"],
        schema="silver",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_silver_calendar_dates_dataset_service_date",
        table_name="calendar_dates",
        schema="silver",
    )
    op.drop_table("calendar_dates", schema="silver")
    op.drop_table("calendar", schema="silver")

    op.drop_index(
        "ix_silver_stop_times_dataset_stop_sequence",
        table_name="stop_times",
        schema="silver",
    )
    op.drop_table("stop_times", schema="silver")

    op.drop_index(
        "ix_silver_trips_dataset_route",
        table_name="trips",
        schema="silver",
    )
    op.drop_index(
        "ix_silver_trips_provider_trip",
        table_name="trips",
        schema="silver",
    )
    op.drop_table("trips", schema="silver")

    op.drop_index(
        "ix_silver_stops_provider_stop",
        table_name="stops",
        schema="silver",
    )
    op.drop_table("stops", schema="silver")

    op.drop_index(
        "ix_silver_routes_provider_route",
        table_name="routes",
        schema="silver",
    )
    op.drop_table("routes", schema="silver")

    op.create_unique_constraint(
        "uq_dataset_versions_hash",
        "dataset_versions",
        ["provider_id", "feed_endpoint_id", "content_hash"],
        schema="core",
    )
