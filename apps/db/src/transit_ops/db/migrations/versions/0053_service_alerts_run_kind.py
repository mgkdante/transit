"""Allow run_kind='service_alerts' for the GTFS-RT service-alerts capture.

The service-alerts capture stores normalized alerts in raw.i3_alert_snapshots
behind an ingestion run whose run_kind mirrors the feed_kind ('service_alerts').
0052 extended the feed_endpoints contract but deliberately left run_kind alone
(it has diverged from feed_kind — 0041 added 'silver_load'). Now that the
capture actually creates such runs, extend ck_ingestion_runs_run_kind too.
Purely additive.

Revision ID: 0053_service_alerts_run_kind
Revises: 0052_service_alerts_feed_contract
"""

from __future__ import annotations

from alembic import op

revision = "0053_service_alerts_run_kind"
down_revision = "0052_service_alerts_feed_contract"
branch_labels = None
depends_on = None


OLD_RUN_KIND_VALUES = (
    "static_schedule",
    "gis_static",
    "trip_updates",
    "vehicle_positions",
    "i3_alerts",
    "silver_load",
)
NEW_RUN_KIND_VALUES = (*OLD_RUN_KIND_VALUES, "service_alerts")


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    return f"{column_name} IN ({', '.join(repr(value) for value in values)})"


def _set_run_kind_constraint(values: tuple[str, ...]) -> None:
    op.drop_constraint(
        "ck_ingestion_runs_run_kind", "ingestion_runs", schema="raw", type_="check"
    )
    op.create_check_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        _in_constraint("run_kind", values),
        schema="raw",
    )


def upgrade() -> None:
    _set_run_kind_constraint(NEW_RUN_KIND_VALUES)


def downgrade() -> None:
    _set_run_kind_constraint(OLD_RUN_KIND_VALUES)
