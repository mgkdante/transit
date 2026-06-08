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
    SELECT provider_id, max(source_realtime_snapshot_id) AS sid
    FROM silver.rt_feed_snapshots
    WHERE endpoint_key = 'trip_updates' AND source_realtime_snapshot_id IS NOT NULL
    GROUP BY provider_id
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
JOIN latest ON latest.provider_id = rfs.provider_id AND latest.sid = rfs.source_realtime_snapshot_id
JOIN silver.rt_trip_update_stop_times AS stu
    ON stu.provider_id = rtu.provider_id
   AND stu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
   AND stu.entity_index = rtu.entity_index
WHERE COALESCE(stu.departure_time_utc, stu.arrival_time_utc) >= now();
"""

# P (non_responding): bus trips SCHEDULED TO BE RUNNING NOW (in provider-local
# time) that have no live vehicle. Excludes metro (route_type 1 — STM metro
# publishes no realtime, so it is structurally always "silent" and would
# otherwise dominate the count). Handles GTFS extended times (>=24:00) and
# trips spanning midnight by also checking yesterday's service day.
_CREATE_NON_RESPONDING = """
CREATE OR REPLACE VIEW gold.non_responding_current AS
WITH cur AS (
    SELECT provider_id, dataset_version_id
    FROM core.dataset_versions
    WHERE dataset_kind = 'static_schedule' AND is_current = true
),
nowinfo AS (
    SELECT cur.provider_id, cur.dataset_version_id,
           (now() AT TIME ZONE dp.timezone)::date AS d_today,
           ((now() AT TIME ZONE dp.timezone) - interval '1 day')::date AS d_yday,
           (extract(hour FROM (now() AT TIME ZONE dp.timezone)) * 60
            + extract(minute FROM (now() AT TIME ZONE dp.timezone)))::int AS now_min
    FROM cur
    JOIN gold.dim_provider dp ON dp.provider_id = cur.provider_id
),
active AS (
    SELECT a.provider_id, a.service_id, a.daytag
    FROM (
        SELECT c.provider_id, c.service_id, 'today'::text AS daytag
        FROM silver.calendar c
        JOIN nowinfo n ON n.provider_id = c.provider_id AND n.dataset_version_id = c.dataset_version_id
        WHERE n.d_today BETWEEN c.start_date AND c.end_date
          AND CASE extract(isodow FROM n.d_today)
                WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
                WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday ELSE c.sunday END
        UNION
        SELECT cd.provider_id, cd.service_id, 'today'
        FROM silver.calendar_dates cd
        JOIN nowinfo n ON n.provider_id = cd.provider_id AND n.dataset_version_id = cd.dataset_version_id
        WHERE cd.service_date = n.d_today AND cd.exception_type = 1
        UNION ALL
        SELECT c.provider_id, c.service_id, 'yday'
        FROM silver.calendar c
        JOIN nowinfo n ON n.provider_id = c.provider_id AND n.dataset_version_id = c.dataset_version_id
        WHERE n.d_yday BETWEEN c.start_date AND c.end_date
          AND CASE extract(isodow FROM n.d_yday)
                WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
                WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday ELSE c.sunday END
        UNION
        SELECT cd.provider_id, cd.service_id, 'yday'
        FROM silver.calendar_dates cd
        JOIN nowinfo n ON n.provider_id = cd.provider_id AND n.dataset_version_id = cd.dataset_version_id
        WHERE cd.service_date = n.d_yday AND cd.exception_type = 1
    ) a
    WHERE NOT EXISTS (
        SELECT 1 FROM silver.calendar_dates rm
        JOIN nowinfo n2 ON n2.provider_id = rm.provider_id
        WHERE rm.provider_id = a.provider_id AND rm.service_id = a.service_id
          AND rm.exception_type = 2
          AND rm.service_date = CASE a.daytag WHEN 'today' THEN n2.d_today ELSE n2.d_yday END
    )
),
trip_span AS (
    SELECT t.provider_id, t.route_id, t.trip_id, a.daytag,
           min(split_part(st.departure_time, ':', 1)::int * 60
               + split_part(st.departure_time, ':', 2)::int) AS first_min,
           max(split_part(COALESCE(st.arrival_time, st.departure_time), ':', 1)::int * 60
               + split_part(COALESCE(st.arrival_time, st.departure_time), ':', 2)::int) AS last_min
    FROM silver.trips t
    JOIN cur ON cur.provider_id = t.provider_id AND cur.dataset_version_id = t.dataset_version_id
    JOIN active a ON a.provider_id = t.provider_id AND a.service_id = t.service_id
    JOIN silver.stop_times st
        ON st.provider_id = t.provider_id AND st.dataset_version_id = t.dataset_version_id
       AND st.trip_id = t.trip_id AND st.departure_time IS NOT NULL
    GROUP BY t.provider_id, t.route_id, t.trip_id, a.daytag
),
running AS (
    SELECT ts.provider_id, ts.route_id, ts.trip_id
    FROM trip_span ts
    JOIN nowinfo n ON n.provider_id = ts.provider_id
    JOIN gold.dim_route dr ON dr.provider_id = ts.provider_id AND dr.route_id = ts.route_id
    WHERE COALESCE(dr.route_type, 3) <> 1   -- exclude metro (no realtime feed)
      AND (
           (ts.daytag = 'today' AND n.now_min         BETWEEN ts.first_min AND ts.last_min)
        OR (ts.daytag = 'yday'  AND (n.now_min + 1440) BETWEEN ts.first_min AND ts.last_min)
      )
),
live AS (
    SELECT DISTINCT provider_id, trip_id
    FROM gold.latest_vehicle_snapshot WHERE trip_id IS NOT NULL
)
SELECT r.provider_id, r.route_id,
       count(DISTINCT r.trip_id)::integer AS non_responding_count,
       array_agg(DISTINCT r.trip_id) AS trip_ids
FROM running r
LEFT JOIN live l ON l.provider_id = r.provider_id AND l.trip_id = r.trip_id
WHERE l.trip_id IS NULL
GROUP BY r.provider_id, r.route_id;
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
