"""Identify the source observation of refreshed alert messages."""

from alembic import op

revision = "0092_alert_message_observation"
down_revision = "0091_running_service_clock"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Legacy text may already combine captures, so its provenance stays unknown.
    op.execute("""
        ALTER TABLE silver.i3_alerts
        ADD COLUMN message_snapshot_id bigint,
        ADD COLUMN message_alert_index integer
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE silver.i3_alerts
        DROP COLUMN message_snapshot_id,
        DROP COLUMN message_alert_index
    """)
