"""Add gold.current_vehicle_map_with_status — vehicle locations joined with delay status.

Revision ID: 0020_current_vehicle_map_with_status_view
Revises: 0019_trip_delay_summary_5m_live_view
Create Date: 2026-05-27

Why this migration exists:
    p01 Carte opérationnelle's hero map plots 610 vehicles but every
    dot looks identical — operators can see WHERE vehicles are, not
    WHO'S LATE. Color-by-delay is the killer feature for an Ops Map:
    instant heat-vision for trouble spots (red dots stand out).

    To color dots in Power BI's azureMap visual, the data source needs
    a single categorical column the Legend role can bind to. The split
    between gold.current_vehicle_map (lat/lon, no delay) and
    gold.current_trip_delay_computed (delay, no lat/lon) means each
    dot would need a DAX RELATED() lookup. Wrapping the join in a SQL
    view keeps the Power BI binding simple, the model relationships
    inactive (per the slice-8.7 contract), and the per-query cost
    bounded.

What the view does:
    LEFT JOIN current_vehicle_map ← current_trip_delay_computed on
    (provider_id, trip_id) and computes a 5-bucket categorical
    status_band column:
      - En avance / Early       (avg_delay < -60s, bus ahead)
      - À l'heure / On time     (-60s ≤ avg_delay < 60s)
      - En retard / Late        (60s ≤ avg_delay < 300s)
      - Critique / Severe       (avg_delay ≥ 300s)
      - Inconnu / Unknown       (NULL — brand-new trip, no observations yet)

    Live distribution at migration time (607 vehicles):
      Inconnu: 100 (16%) · Early: 44 (7%) · On time: 235 (39%) ·
      Late: 163 (27%) · Severe: 67 (11%)

Performance:
    Single LEFT JOIN on a fully-indexed (provider_id, trip_id) key.
    Both source tables are themselves views/marts that are sub-second
    to query. Power BI DirectQuery refreshes the visual every ~30s
    → ~2880 view executions/day, all sub-second.

Architectural choice:
    Extends the existing CurrentVehicleMap pattern (live view backing
    a live visual) rather than creating a parallel table. The same
    Power BI table reference (CurrentVehicleMap) just gets richer
    columns. Forward-pack: every future map-based visual on any page
    that wants to color by status uses the same source.

Downgrade:
    Drops the view. CurrentVehicleMap visual in Power BI must be
    rebound to gold.current_vehicle_map before downgrade ships, or
    the visual will error on refresh.
"""

from __future__ import annotations

from alembic import op

revision = "0020_current_vehicle_map_with_status_view"
down_revision = "0019_trip_delay_summary_5m_live_view"
branch_labels = None
depends_on = None


_CREATE_VIEW = """
CREATE OR REPLACE VIEW gold.current_vehicle_map_with_status AS
SELECT
    cvm.provider_id,
    cvm.realtime_snapshot_id,
    cvm.entity_index,
    cvm.vehicle_id,
    cvm.trip_id,
    cvm.route_id,
    cvm.stop_id,
    cvm.captured_at_utc,
    cvm.latitude,
    cvm.longitude,
    cvm.geom_wgs84,
    cvm.geojson,
    ctc.avg_delay_seconds AS trip_avg_delay_seconds,
    ctc.max_delay_seconds AS trip_max_delay_seconds,
    CASE
        WHEN ctc.avg_delay_seconds IS NULL THEN 'Inconnu / Unknown'
        WHEN ctc.avg_delay_seconds < -60  THEN 'En avance / Early'
        WHEN ctc.avg_delay_seconds <  60  THEN 'À l''heure / On time'
        WHEN ctc.avg_delay_seconds < 300  THEN 'En retard / Late'
        ELSE                                   'Critique / Severe'
    END AS status_band
FROM gold.current_vehicle_map AS cvm
LEFT JOIN gold.current_trip_delay_computed AS ctc
    ON ctc.provider_id = cvm.provider_id
   AND ctc.trip_id     = cvm.trip_id
"""


_DROP_VIEW = """
DROP VIEW IF EXISTS gold.current_vehicle_map_with_status
"""


def upgrade() -> None:
    op.execute(_CREATE_VIEW)


def downgrade() -> None:
    op.execute(_DROP_VIEW)
