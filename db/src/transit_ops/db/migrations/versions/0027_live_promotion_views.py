"""Add live promotion views: current_stop_next_departures (P1) and non_responding_current (P).

Revision ID: 0027_live_promotion_views
Revises: 0026_map_route_lines_route_id
Create Date: 2026-05-31

Why this migration exists:
    slice-9.1 snapshot publisher needs two gold views to build its live
    JSON snapshots:

    gold.current_stop_next_departures (P1 — next departures per stop)
        Joins the most-recent trip_updates RT snapshot against
        silver.rt_trip_update_stop_times to surface predicted departures
        that are still in the future. Used by the /v1/next-departures
        snapshot endpoint.

    gold.non_responding_current (P — non-responding trips)
        Cross-references today's GTFS-static scheduled trips (from the
        current dataset version) against live vehicle positions.  Any
        scheduled trip that has no live vehicle is flagged non-responding.
        Used by the /v1/non-responding snapshot endpoint.

Column verification notes (confirmed against DDL migrations):
    silver.rt_feed_snapshots
        - rt_feed_snapshot_id (0012), source_realtime_snapshot_id (0014 add),
          endpoint_key (0012), provider_id (0012)
    silver.rt_trip_updates
        - rt_feed_snapshot_id, entity_index, provider_id, trip_id, route_id
          (all 0012)
    silver.rt_trip_update_stop_times
        - rt_feed_snapshot_id, entity_index, provider_id, stop_id,
          stop_sequence, arrival_time_utc, departure_time_utc (all 0012)
    core.dataset_versions
        - dataset_version_id, provider_id, dataset_kind, is_current (0001)
    silver.trips
        - dataset_version_id, provider_id, trip_id, route_id, service_id
          (0002)
    silver.calendar
        - dataset_version_id, provider_id, service_id, start_date, end_date,
          monday..sunday (0002)
    silver.calendar_dates
        - dataset_version_id, provider_id, service_id, service_date,
          exception_type (0002)
    gold.latest_vehicle_snapshot
        - provider_id, trip_id (0006)
"""

from alembic import op

revision = "0027_live_promotion_views"
down_revision = "0026_map_route_lines_route_id"
branch_labels = None
depends_on = None


_CREATE_STOP_NEXT_DEPARTURES = """
CREATE OR REPLACE VIEW gold.current_stop_next_departures AS
WITH latest AS (
    SELECT max(source_realtime_snapshot_id) AS sid
    FROM silver.rt_feed_snapshots
    WHERE endpoint_key = 'trip_updates' AND source_realtime_snapshot_id IS NOT NULL
)
SELECT
    rtu.provider_id,
    stu.stop_id,
    rtu.route_id,
    rtu.trip_id,
    stu.stop_sequence,
    COALESCE(stu.departure_time_utc, stu.arrival_time_utc) AS predicted_departure_utc,
    row_number() OVER (
        PARTITION BY rtu.provider_id, stu.stop_id
        ORDER BY COALESCE(stu.departure_time_utc, stu.arrival_time_utc)
    ) AS departure_rank
FROM silver.rt_trip_updates AS rtu
JOIN silver.rt_feed_snapshots AS rfs
    ON rfs.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
   AND rfs.endpoint_key = 'trip_updates'
JOIN latest ON latest.sid = rfs.source_realtime_snapshot_id
JOIN silver.rt_trip_update_stop_times AS stu
    ON stu.provider_id = rtu.provider_id
   AND stu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
   AND stu.entity_index = rtu.entity_index
WHERE COALESCE(stu.departure_time_utc, stu.arrival_time_utc) >= now();
"""

# P (non_responding): scheduled-active-today trips NOT present live.
_CREATE_NON_RESPONDING = """
CREATE OR REPLACE VIEW gold.non_responding_current AS
WITH cur AS (
    SELECT provider_id, dataset_version_id
    FROM core.dataset_versions
    WHERE dataset_kind = 'static_schedule' AND is_current = true
),
active_service AS (
    SELECT c.provider_id, c.service_id
    FROM silver.calendar AS c
    JOIN cur ON cur.dataset_version_id = c.dataset_version_id AND cur.provider_id = c.provider_id
    WHERE CURRENT_DATE BETWEEN c.start_date AND c.end_date
      AND CASE extract(isodow FROM CURRENT_DATE)
            WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
            WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
            ELSE c.sunday END
    UNION
    SELECT cd.provider_id, cd.service_id
    FROM silver.calendar_dates AS cd
    JOIN cur ON cur.dataset_version_id = cd.dataset_version_id AND cur.provider_id = cd.provider_id
    WHERE cd.service_date = CURRENT_DATE AND cd.exception_type = 1
),
scheduled AS (
    SELECT DISTINCT t.provider_id, t.route_id, t.trip_id
    FROM silver.trips AS t
    JOIN cur ON cur.dataset_version_id = t.dataset_version_id AND cur.provider_id = t.provider_id
    JOIN active_service AS s ON s.provider_id = t.provider_id AND s.service_id = t.service_id
),
live AS (
    SELECT DISTINCT provider_id, trip_id
    FROM gold.latest_vehicle_snapshot WHERE trip_id IS NOT NULL
)
SELECT s.provider_id, s.route_id,
       count(*)::integer AS non_responding_count,
       array_agg(s.trip_id ORDER BY s.trip_id) AS trip_ids
FROM scheduled AS s
LEFT JOIN live AS l ON l.provider_id = s.provider_id AND l.trip_id = s.trip_id
WHERE l.trip_id IS NULL
GROUP BY s.provider_id, s.route_id;
"""

_DROP = """
DROP VIEW IF EXISTS gold.non_responding_current;
DROP VIEW IF EXISTS gold.current_stop_next_departures;
"""


def upgrade() -> None:
    op.execute(_CREATE_STOP_NEXT_DEPARTURES)
    op.execute(_CREATE_NON_RESPONDING)


def downgrade() -> None:
    op.execute(_DROP)
