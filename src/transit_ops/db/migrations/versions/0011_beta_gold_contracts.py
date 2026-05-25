from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011_beta_gold_contracts"
down_revision = "0010_beta_static_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dim_route",
        sa.Column("route_desc_detail", sa.Text(), nullable=True),
        schema="gold",
    )

    op.create_table(
        "dim_route_pattern",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("route_pattern_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("direction_id", sa.Integer(), nullable=False),
        sa.Column("route_pattern_typicality", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_dim_route_pattern_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_gold_dim_route_pattern_dataset_version_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_pattern_id",
            name="pk_gold_dim_route_pattern",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_dim_route_pattern_provider_route_direction",
        "dim_route_pattern",
        ["provider_id", "route_id", "direction_id"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_dim_route_pattern_provider_route_direction",
        table_name="dim_route_pattern",
        schema="gold",
    )
    op.drop_table("dim_route_pattern", schema="gold")
    op.drop_column("dim_route", "route_desc_detail", schema="gold")
