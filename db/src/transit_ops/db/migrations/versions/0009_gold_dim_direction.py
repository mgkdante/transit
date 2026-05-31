from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_gold_dim_direction"
down_revision = "0008_warm_rollup_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dim_direction",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("direction_id", sa.Integer(), nullable=False),
        sa.Column("direction_label", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_dim_direction_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id", "route_id", "direction_id",
            name="pk_gold_dim_direction",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_dim_direction_provider_direction",
        "dim_direction",
        ["provider_id", "direction_id"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_dim_direction_provider_direction",
        table_name="dim_direction",
        schema="gold",
    )
    op.drop_table("dim_direction", schema="gold")
