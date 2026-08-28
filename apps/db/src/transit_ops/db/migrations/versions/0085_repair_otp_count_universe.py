"""Repair split OTP numerator and denominator universes.

Revision 0030 backfilled ``on_time_observation_count`` from the then-current
trip-delay fact while retaining the 5-minute summary's earlier
``delay_observation_count``. Late-arriving fact rows could therefore make the
on-time subset larger than its delay-known universe. The invalid 5-minute
counts were then summed into ``route_delay_hourly`` and surfaced through the
public daily reliability view.

The original fact rows may already be outside retention, so their complete
delay distribution cannot be reconstructed. The only lossless invariant repair
available is to raise the undercounted delay-known universe to its proven
on-time subset floor. Current rollup SQL computes both counts from one fact read
and cannot create this mismatch.

Revision ID: 0085_repair_otp_count_universe
Revises: 0084_alert_language_coverage
Create Date: 2026-08-28
"""

from __future__ import annotations

from alembic import op

revision = "0085_repair_otp_count_universe"
down_revision = "0084_alert_language_coverage"
branch_labels = None
depends_on = None


_REPAIR_5M_OBSERVATION_UNIVERSE = """
UPDATE gold.trip_delay_summary_5m
SET delay_observation_count = on_time_observation_count
WHERE on_time_observation_count > delay_observation_count
"""


_REPAIR_HOURLY_OBSERVATION_UNIVERSE = """
UPDATE gold.route_delay_hourly
SET delay_observation_count = on_time_observation_count
WHERE on_time_observation_count > delay_observation_count
"""


def upgrade() -> None:
    op.execute(_REPAIR_5M_OBSERVATION_UNIVERSE)
    op.execute(_REPAIR_HOURLY_OBSERVATION_UNIVERSE)


def downgrade() -> None:
    raise NotImplementedError(
        "0085 repairs undercounted delay-observation universes and is intentionally "
        "forward-only; the discarded inconsistent counts are not valid rollback data"
    )
