from alembic import op
from sqlalchemy import Column, DateTime

revision = "0088_warm_period_invalidation"
down_revision = "0087_exact_daily_delay_means"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "warm_rollup_periods",
        Column("invalidated_at_utc", DateTime(timezone=True), nullable=True),
        schema="gold",
    )


def downgrade() -> None:
    op.execute("LOCK TABLE gold.warm_rollup_periods IN ACCESS EXCLUSIVE MODE")
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM gold.warm_rollup_periods WHERE invalidated_at_utc IS NOT NULL)
            THEN RAISE EXCEPTION 'Complete pending warm periods before downgrading';
            END IF;
        END $$
    """)
    op.drop_column("warm_rollup_periods", "invalidated_at_utc", schema="gold")
