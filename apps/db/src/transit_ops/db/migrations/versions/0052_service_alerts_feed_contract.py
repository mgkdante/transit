"""Allow a generic GTFS-RT service-alerts feed in the source contract.

Multi-provider: STM publishes alerts through its proprietary i3 JSON API, but
STO / OC Transpo / STS (and most agencies) publish the standard GTFS-RT Service
Alerts protobuf. This extends ONLY the core.feed_endpoints feed_kind /
source_format CHECK constraints to accept the generic ``service_alerts`` /
``gtfs_rt_service_alerts`` contract values so a manifest can declare the feed.

raw.ingestion_runs.run_kind is intentionally left untouched: it has diverged
from feed_kind (0041 added 'silver_load', etc.) and nothing creates a
service_alerts ingestion run yet — the alerts capture/silver wiring is a later
change and can extend run_kind then if it needs to. Purely additive; no existing
rows change and STM's i3 path is untouched.

Revision ID: 0052_service_alerts_feed_contract
Revises: 0051_dow_severe_pct_denominator
"""

from __future__ import annotations

from alembic import op

revision = "0052_service_alerts_feed_contract"
down_revision = "0051_dow_severe_pct_denominator"
branch_labels = None
depends_on = None


# Current feed_endpoints contract values (last set in 0013) + the additive member.
OLD_FEED_KIND_VALUES = (
    "static_schedule",
    "gis_static",
    "trip_updates",
    "vehicle_positions",
    "i3_alerts",
)
NEW_FEED_KIND_VALUES = (*OLD_FEED_KIND_VALUES, "service_alerts")
OLD_SOURCE_FORMAT_VALUES = (
    "gtfs_schedule_zip",
    "stm_gis_zip",
    "gtfs_rt_trip_updates",
    "gtfs_rt_vehicle_positions",
    "api_i3_json",
)
NEW_SOURCE_FORMAT_VALUES = (*OLD_SOURCE_FORMAT_VALUES, "gtfs_rt_service_alerts")


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    return f"{column_name} IN ({', '.join(repr(value) for value in values)})"


def _set_feed_endpoint_constraints(
    *,
    feed_kind_values: tuple[str, ...],
    source_format_values: tuple[str, ...],
) -> None:
    op.drop_constraint(
        "ck_feed_endpoints_feed_kind", "feed_endpoints", schema="core", type_="check"
    )
    op.create_check_constraint(
        "ck_feed_endpoints_feed_kind",
        "feed_endpoints",
        _in_constraint("feed_kind", feed_kind_values),
        schema="core",
    )
    op.drop_constraint(
        "ck_feed_endpoints_source_format",
        "feed_endpoints",
        schema="core",
        type_="check",
    )
    op.create_check_constraint(
        "ck_feed_endpoints_source_format",
        "feed_endpoints",
        _in_constraint("source_format", source_format_values),
        schema="core",
    )


def upgrade() -> None:
    _set_feed_endpoint_constraints(
        feed_kind_values=NEW_FEED_KIND_VALUES,
        source_format_values=NEW_SOURCE_FORMAT_VALUES,
    )


def downgrade() -> None:
    _set_feed_endpoint_constraints(
        feed_kind_values=OLD_FEED_KIND_VALUES,
        source_format_values=OLD_SOURCE_FORMAT_VALUES,
    )
