"""Add the logical stable-file baseline to snapshot publish state.

Revision ID: 0081_publish_stable_files
Revises: 0080_alert_archive
Create Date: 2026-07-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0081_publish_stable_files"
down_revision = "0080_alert_archive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "snapshot_publish_state",
        sa.Column("stable_files_total", sa.Integer(), nullable=True),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column(
        "snapshot_publish_state",
        "stable_files_total",
        schema="core",
    )
