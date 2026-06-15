"""Add run_kind='silver_load' + filter it out of gold.feed_freshness_current.

Revision ID: 0041_silver_load_run_kind
Revises: 0040_create_pg_repack_extension
Create Date: 2026-06-13

slice-9.1.1o — make realtime silver-load failures externally observable. The
worker now persists a completed status='failed' row with a NEW
run_kind='silver_load' whenever a realtime silver load raises
(orchestration._persist_silver_load_failure). Before this slice the failure
left zero DB trace — a multi-hour alerts.json freeze was invisible to every DB
query because captures and publishes kept succeeding.

What this migration does (catalog-light, NO big-table scan):
  1. Drop + recreate ONLY ck_ingestion_runs_run_kind, adding 'silver_load' to
     the existing 5-value set. raw.ingestion_runs holds ~30 days of capture
     rows, so the post-create validation scan is fast and bounded. The sibling
     feed_kind / source_format constraints are deliberately untouched —
     'silver_load' is a run kind, not a feed or a wire format.
  2. CREATE OR REPLACE gold.feed_freshness_current with the verbatim 0013 body
     plus `ir.run_kind <> 'silver_load'`. That view feeds the public /v1
     provenance.json (snapshots/builders.py) and network.json feed_freshness_s,
     and takes the latest run per endpoint with no run_kind filter today. A
     silver_load failure row (no objects, recent started_at) would otherwise
     win the DISTINCT ON and silently flip a feed to status='failed' /
     completed_age reset in the public contract. The filter keeps capture
     semantics byte-identical for every pre-existing run_kind — only the brand
     new silver_load rows (which cannot exist before this deploy) are excluded.

downgrade drops the telemetry rows (run_kind='silver_load' — droppable failure
telemetry, no lineage depends on them), restores the 5-value constraint, and
restores the 0013 view. Catalog-only on upgrade plus a tiny telemetry delete on
downgrade — no chunked-loop reclaim and no table-reclaim command anywhere.
"""

from __future__ import annotations

from alembic import op

revision = "0041_silver_load_run_kind"
down_revision = "0040_create_pg_repack_extension"
branch_labels = None
depends_on = None


# ck_ingestion_runs_run_kind value sets. The OLD set is the 0013 5-value set
# (run_kind reused feed_kind's values); the NEW set appends 'silver_load'.
OLD_RUN_KIND_VALUES = (
    "static_schedule",
    "gis_static",
    "trip_updates",
    "vehicle_positions",
    "i3_alerts",
)
NEW_RUN_KIND_VALUES = (*OLD_RUN_KIND_VALUES, "silver_load")


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    return f"{column_name} IN ({', '.join(repr(value) for value in values)})"


# gold.feed_freshness_current — verbatim 0013 body with the silver_load filter
# added to the latest_runs CTE so failure-telemetry rows never reach the public
# /v1 freshness contract.
_VIEW_WITH_SILVER_LOAD_FILTER = """
CREATE OR REPLACE VIEW gold.feed_freshness_current AS
WITH latest_runs AS (
    SELECT DISTINCT ON (ir.provider_id, fe.endpoint_key)
        ir.provider_id,
        fe.endpoint_key,
        ir.status,
        ir.requested_at_utc,
        ir.started_at_utc,
        ir.completed_at_utc,
        ir.feed_timestamp_utc,
        EXTRACT(EPOCH FROM (now() - ir.completed_at_utc))::integer AS completed_age_seconds
    FROM raw.ingestion_runs AS ir
    INNER JOIN core.feed_endpoints AS fe
        ON fe.feed_endpoint_id = ir.feed_endpoint_id
    WHERE ir.run_kind <> 'silver_load'
    ORDER BY ir.provider_id, fe.endpoint_key, ir.started_at_utc DESC
)
SELECT *
FROM latest_runs
"""

# The verbatim 0013 view body (no silver_load filter) for downgrade.
_VIEW_ORIGINAL_0013 = """
CREATE OR REPLACE VIEW gold.feed_freshness_current AS
WITH latest_runs AS (
    SELECT DISTINCT ON (ir.provider_id, fe.endpoint_key)
        ir.provider_id,
        fe.endpoint_key,
        ir.status,
        ir.requested_at_utc,
        ir.started_at_utc,
        ir.completed_at_utc,
        ir.feed_timestamp_utc,
        EXTRACT(EPOCH FROM (now() - ir.completed_at_utc))::integer AS completed_age_seconds
    FROM raw.ingestion_runs AS ir
    INNER JOIN core.feed_endpoints AS fe
        ON fe.feed_endpoint_id = ir.feed_endpoint_id
    ORDER BY ir.provider_id, fe.endpoint_key, ir.started_at_utc DESC
)
SELECT *
FROM latest_runs
"""


def upgrade() -> None:
    op.drop_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        schema="raw",
        type_="check",
    )
    op.create_check_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        _in_constraint("run_kind", NEW_RUN_KIND_VALUES),
        schema="raw",
    )
    op.execute(_VIEW_WITH_SILVER_LOAD_FILTER)


def downgrade() -> None:
    # Restore the 0013 view first (it has no silver_load dependency), then drop
    # the telemetry rows so the restored 5-value CHECK validates cleanly.
    op.execute(_VIEW_ORIGINAL_0013)
    op.execute("DELETE FROM raw.ingestion_runs WHERE run_kind = 'silver_load'")
    op.drop_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        schema="raw",
        type_="check",
    )
    op.create_check_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        _in_constraint("run_kind", OLD_RUN_KIND_VALUES),
        schema="raw",
    )
