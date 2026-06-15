from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_beta_static_schema"
down_revision = "0009_gold_dim_direction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agency",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("agency_id", sa.Text(), nullable=False),
        sa.Column("agency_name", sa.Text(), nullable=False),
        sa.Column("agency_url", sa.Text(), nullable=False),
        sa.Column("agency_timezone", sa.Text(), nullable=False),
        sa.Column("agency_lang", sa.Text(), nullable=True),
        sa.Column("agency_phone", sa.Text(), nullable=True),
        sa.Column("agency_fare_url", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_agency_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_agency_provider_id",
        ),
        sa.PrimaryKeyConstraint("dataset_version_id", "agency_id", name="pk_silver_agency"),
        schema="silver",
    )

    op.create_table(
        "feed_info",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("feed_publisher_name", sa.Text(), nullable=False),
        sa.Column("feed_publisher_url", sa.Text(), nullable=False),
        sa.Column("feed_lang", sa.Text(), nullable=False),
        sa.Column("feed_start_date", sa.Date(), nullable=False),
        sa.Column("feed_end_date", sa.Date(), nullable=False),
        sa.Column("feed_version", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_feed_info_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_feed_info_provider_id",
        ),
        sa.PrimaryKeyConstraint("dataset_version_id", name="pk_silver_feed_info"),
        schema="silver",
    )

    op.add_column(
        "routes",
        sa.Column("route_desc_detail", sa.Text(), nullable=True),
        schema="silver",
    )
    op.add_column(
        "trips",
        sa.Column("route_pattern_id", sa.Text(), nullable=True),
        schema="silver",
    )

    op.create_table(
        "directions",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_direction_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("direction_id", sa.Integer(), nullable=False),
        sa.Column("direction", sa.Text(), nullable=False),
        sa.Column("direction_legacy", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_directions_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_directions_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id", "route_id"],
            ["silver.routes.dataset_version_id", "silver.routes.route_id"],
            name="fk_silver_directions_route",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "route_direction_id",
            name="pk_silver_directions",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_directions_dataset_route_direction",
        "directions",
        ["dataset_version_id", "route_id", "direction_id"],
        schema="silver",
    )

    op.create_table(
        "route_patterns",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_pattern_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("direction_id", sa.Integer(), nullable=False),
        sa.Column("route_pattern_typicality", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_route_patterns_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_route_patterns_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id", "route_id"],
            ["silver.routes.dataset_version_id", "silver.routes.route_id"],
            name="fk_silver_route_patterns_route",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "route_pattern_id",
            name="pk_silver_route_patterns",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_route_patterns_dataset_route_direction",
        "route_patterns",
        ["dataset_version_id", "route_id", "direction_id"],
        schema="silver",
    )

    op.create_table(
        "shapes",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("shape_id", sa.Text(), nullable=False),
        sa.Column("shape_pt_sequence", sa.Integer(), nullable=False),
        sa.Column("shape_pt_lat", sa.Float(), nullable=True),
        sa.Column("shape_pt_lon", sa.Float(), nullable=True),
        sa.Column("route_pattern_id", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_shapes_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_shapes_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "shape_id",
            "shape_pt_sequence",
            name="pk_silver_shapes",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_shapes_dataset_route_pattern",
        "shapes",
        ["dataset_version_id", "route_pattern_id"],
        schema="silver",
    )

    op.create_table(
        "translations",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("translation_row_number", sa.Integer(), nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("field_name", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("record_id", sa.Text(), nullable=False),
        sa.Column("translation", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_translations_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_translations_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "translation_row_number",
            name="pk_silver_translations",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_translations_dataset_lookup",
        "translations",
        ["dataset_version_id", "table_name", "field_name", "record_id", "language"],
        schema="silver",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_silver_translations_dataset_lookup",
        table_name="translations",
        schema="silver",
    )
    op.drop_table("translations", schema="silver")

    op.drop_index(
        "ix_silver_shapes_dataset_route_pattern",
        table_name="shapes",
        schema="silver",
    )
    op.drop_table("shapes", schema="silver")

    op.drop_index(
        "ix_silver_route_patterns_dataset_route_direction",
        table_name="route_patterns",
        schema="silver",
    )
    op.drop_table("route_patterns", schema="silver")

    op.drop_index(
        "ix_silver_directions_dataset_route_direction",
        table_name="directions",
        schema="silver",
    )
    op.drop_table("directions", schema="silver")

    op.drop_column("trips", "route_pattern_id", schema="silver")
    op.drop_column("routes", "route_desc_detail", schema="silver")
    op.drop_table("feed_info", schema="silver")
    op.drop_table("agency", schema="silver")
