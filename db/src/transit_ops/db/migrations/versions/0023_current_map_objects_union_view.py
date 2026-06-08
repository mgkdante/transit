"""Add gold.current_map_objects — UNION of vehicles + alert-stops for the p01 hero map.

Revision ID: 0023_current_map_objects_union_view
Revises: 0022_gold_current_i3_alerts_scd2_aggregated
Create Date: 2026-05-27

Why this migration exists:
    p01 Carte opérationnelle's azureMap visual currently plots vehicles
    only (gold.current_vehicle_map_with_status). slice-8.7.2 Phase 2 needs
    a second class of dot on the same map: alert-stops — the stops listed
    in active i3 alerts — clickable so the alerts table cross-filters to
    that stop's alerts.

    Power BI's azureMap binds a single Entity per visual. To plot two
    object kinds on one map, we need a single SQL source whose rows are
    pre-unioned and discriminated by an object_type column. DAX RELATED()
    across two tables would force a relationship and lose cross-filter
    independence; a UNION view keeps the map source flat.

What the view does:
    Vehicles leg: passthrough from gold.current_vehicle_map_with_status
    (lat/lon + status_band already computed in migration 0020). All 5
    vehicle status bands keep working — color-by-delay is unchanged.

    Alert-stops leg: explodes each alert's stop_ids string into individual
    rows joined to gold.dim_stop for the stop's lat/lon. Each (alert,
    affected stop) pair becomes one row. Alerts with no stop entities
    (route-level notices) drop out — they can't be plotted.

    Status band 'Alerte' is a new 6th category specifically for alert-pin
    dots. Power BI's Legend role + dataPoint selectors pin it to a bright
    red distinct from 'Critique / Severe' (vehicles in deep delay).

    Tooltip-facing columns:
      - object_type   : 'vehicle' | 'alerte' (Series discriminator)
      - object_id     : vehicle_id for vehicles, stop_id for alert-stops
                        — single column the map keys on for cross-filter
      - alert_description : present on alert-stops, NULL on vehicles
      - trip_avg_delay_seconds / trip_max_delay_seconds : present on
                        vehicles, NULL on alert-stops

Live shape at migration time:
    ~610 vehicle rows + ~1126 alert-stop rows ≈ ~1736 total rows. Within
    the per-query budget for DirectQuery (~30s refresh cadence).

Power BI rebind path (separate commit):
    p01_vehicle_map/visual.json: Entity 'CurrentVehicleMap' → 'CurrentMapObjects'.
    Same Y/X projections (latitude/longitude), Legend + Series both bound
    to status_band, new Tooltip field alert_description.

Downgrade:
    Drops the view. p01 hero map must be rebound to
    gold.current_vehicle_map_with_status before downgrade ships, or the
    visual will error on refresh.
"""

from __future__ import annotations

from alembic import op

revision = "0023_current_map_objects_union_view"
down_revision = "0022_gold_current_i3_alerts_scd2_aggregated"
branch_labels = None
depends_on = None


_CREATE_VIEW = """
CREATE OR REPLACE VIEW gold.current_map_objects AS
SELECT
    'vehicle'::text AS object_type,
    cvm.vehicle_id AS object_id,
    cvm.latitude,
    cvm.longitude,
    cvm.status_band,
    cvm.route_id,
    cvm.trip_id,
    cvm.stop_id,
    cvm.trip_avg_delay_seconds,
    cvm.trip_max_delay_seconds,
    cvm.captured_at_utc,
    NULL::text AS alert_description
FROM gold.current_vehicle_map_with_status AS cvm
UNION ALL
SELECT
    'alerte'::text AS object_type,
    s.stop_id AS object_id,
    s.stop_lat AS latitude,
    s.stop_lon AS longitude,
    'Alerte'::text AS status_band,
    NULL::text AS route_id,
    NULL::text AS trip_id,
    s.stop_id,
    NULL::numeric(12, 2) AS trip_avg_delay_seconds,
    NULL::integer AS trip_max_delay_seconds,
    a.captured_at_utc,
    a.description_text AS alert_description
FROM gold.current_i3_alerts AS a
JOIN gold.dim_stop AS s
    ON s.provider_id = a.provider_id
   AND s.stop_id = ANY(string_to_array(a.stop_ids, ', '))
WHERE a.stop_ids IS NOT NULL
"""


_DROP_VIEW = """
DROP VIEW IF EXISTS gold.current_map_objects
"""


def upgrade() -> None:
    op.execute(_CREATE_VIEW)


def downgrade() -> None:
    op.execute(_DROP_VIEW)
