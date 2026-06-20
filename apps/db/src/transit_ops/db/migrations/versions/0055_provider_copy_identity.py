"""Add per-provider copy identity (short_name, city) to core.providers.

Two additive, optional, nullable columns that carry a provider's *copy* identity
for the citizen UI:

- short_name -- a snappy brand for chips / SEO ("STM", "OC Transpo", "STO").
- city      -- the primary place name for SEO + copy ("Montréal", "Ottawa").

Both are nullable: a provider config may omit them, in which case the manifest
ships them as null and the UI falls back to display_name. They are UI copy, not
analytics dimensions, so they stay in core.providers (the config source of
truth) -- the manifest builder reads them straight from there, the same way the
static builder reads attribution. The gold.dim_provider view is intentionally
left untouched, which keeps this migration trivially reversible (no view
depends on the new columns).

Purely additive -- no data rewrite. STM's values are seeded from its provider
config (config/providers/stm.yaml) on the next `seed-providers` run.

Revision ID: 0055_provider_copy_identity
Revises: 0054_gtfs_optional_columns_nullable
Create Date: 2026-06-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0055_provider_copy_identity"
down_revision = "0054_gtfs_optional_columns_nullable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "providers",
        sa.Column("short_name", sa.Text(), nullable=True),
        schema="core",
    )
    op.add_column(
        "providers",
        sa.Column("city", sa.Text(), nullable=True),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("providers", "city", schema="core")
    op.drop_column("providers", "short_name", schema="core")
