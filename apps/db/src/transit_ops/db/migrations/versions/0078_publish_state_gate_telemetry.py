"""publish-state gate telemetry — last gate outcome per lane (S11 / data-health).

WHY THIS MIGRATION EXISTS
    core.snapshot_publish_state (migration 0042) records, per (provider_id, tier),
    the DATA-time stamp + written/skipped/total file counts of the last publish.
    It does NOT record the outcome of the VALUE GATE that ran over those payloads
    (snapshots/gate.py) — that report is written only as a CI artifact
    (cli.py --report-dir, daily-warm-rollups.yml) and is never queryable at
    runtime. The S11 citizen data-health payload (status/data_health.json) needs
    the LAST gate summary per lane so a reader can see, for each publish lane, how
    many checks ran and whether any errored/warned — without scraping CI. This
    migration persists that summary alongside the existing per-tier bookkeeping so
    the live publish cycle can serve the full picture in one query.

WHAT THIS MIGRATION DOES (additive-only)
    Five additive NULLABLE columns on core.snapshot_publish_state, mirroring the
    GateReport.to_dict() counts (gate.py:106-116):
        gate_checks_run    int          — GateReport.checks_run
        gate_errors        int          — len(GateReport.errors)
        gate_warnings      int          — len(GateReport.warnings)
        gate_verdict       text         — 'pass' | 'warn' | 'fail' (derived by the
                                          publisher: fail if errors>0, else warn if
                                          warnings>0, else pass)
        gate_generated_utc timestamptz  — GateReport.generated_utc (the stamp the
                                          gate ran against; may differ from the row's
                                          generated_utc only in principle — same run)

    All nullable with NO server_default: a row predating 0078, or a tier published
    with the gate disabled (--no-gate), or a static dataset-level SKIP that never
    ran the gate, honestly carries NULL gate telemetry (never a fabricated 0/pass).

HONEST BOUNDARY
    Pre-0078 rows keep NULL gate_* columns until their tier is next published; the
    data-health builder emits an honest-NULL gate block for such a lane (the gate
    outcome is UNKNOWN, never assumed pass). The gate self-check (check_data_health)
    treats NULL gate telemetry as legitimately absent, not a violation.

NO ENFORCEMENT CHANGE
    This migration touches only bookkeeping columns. Gate enforcement is unchanged:
    historic still aborts on errors, live stays WARN-only (publish.py:704-719). The
    CI report artifact path (cli.py --report-dir) is untouched. At most 3 rows per
    provider (live/static/historic) — plain transactional DDL, no scan, no reclaim.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0078_publish_state_gate_telemetry"
down_revision = "0077_alert_active_periods_and_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Additive NULLABLE gate-summary columns (honest-NULL for rows predating 0078
    # or tiers published without the gate). No server_default — absence is honest.
    op.add_column(
        "snapshot_publish_state",
        sa.Column("gate_checks_run", sa.Integer(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("gate_errors", sa.Integer(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("gate_warnings", sa.Integer(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("gate_verdict", sa.Text(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("gate_generated_utc", sa.DateTime(timezone=True), nullable=True),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("snapshot_publish_state", "gate_generated_utc", schema="core")
    op.drop_column("snapshot_publish_state", "gate_verdict", schema="core")
    op.drop_column("snapshot_publish_state", "gate_warnings", schema="core")
    op.drop_column("snapshot_publish_state", "gate_errors", schema="core")
    op.drop_column("snapshot_publish_state", "gate_checks_run", schema="core")
