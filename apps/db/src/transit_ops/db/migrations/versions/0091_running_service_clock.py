"""Resolve scheduled running trips against their dated GTFS service clock."""

from alembic import op

revision = "0091_running_service_clock"
down_revision = "0090_departure_capture_order"
branch_labels = None
depends_on = None

_CREATE_SCHEDULED_RUNNING_TRIPS = """
CREATE OR REPLACE FUNCTION gold.scheduled_running_trips_at(
    provider_id text, as_of timestamptz
) RETURNS TABLE (route_id text, trip_id text)
LANGUAGE sql STABLE
AS $function$
WITH current_schedule AS (
    SELECT dv.provider_id, dv.dataset_version_id, dp.timezone
    FROM core.dataset_versions dv
    JOIN gold.dim_provider dp ON dp.provider_id = dv.provider_id
    WHERE dv.provider_id = $1
      AND dv.dataset_kind = 'static_schedule' AND dv.is_current
),
trip_span AS (
    SELECT t.provider_id, t.dataset_version_id, cs.timezone,
           t.route_id, t.trip_id, t.service_id,
           min(split_part(COALESCE(st.departure_time, st.arrival_time), ':', 1)::bigint * 3600
               + split_part(COALESCE(st.departure_time, st.arrival_time), ':', 2)::int * 60
               + split_part(COALESCE(st.departure_time, st.arrival_time), ':', 3)::int
           ) AS first_seconds,
           max(split_part(COALESCE(st.arrival_time, st.departure_time), ':', 1)::bigint * 3600
               + split_part(COALESCE(st.arrival_time, st.departure_time), ':', 2)::int * 60
               + split_part(COALESCE(st.arrival_time, st.departure_time), ':', 3)::int
           ) AS last_seconds
    FROM current_schedule cs
    JOIN silver.trips t
      ON t.provider_id = cs.provider_id AND t.dataset_version_id = cs.dataset_version_id
    JOIN gold.dim_route dr ON dr.provider_id = t.provider_id AND dr.route_id = t.route_id
    JOIN silver.stop_times st
      ON st.provider_id = t.provider_id AND st.dataset_version_id = t.dataset_version_id
     AND st.trip_id = t.trip_id
    WHERE COALESCE(dr.route_type, 3) <> 1
      AND COALESCE(st.departure_time, st.arrival_time) IS NOT NULL
    GROUP BY t.dataset_version_id, t.trip_id, cs.timezone
),
candidate_days AS (
    SELECT ts.*, bounds.first_date + offsets.day_offset AS service_date
    FROM trip_span ts
    CROSS JOIN LATERAL (
        -- Padding covers civil-clock transitions. The exact elapsed test below
        -- selects the service date, including tomorrow or offsets beyond 48h.
        SELECT (($2 + interval '12 hours' - ts.last_seconds * interval '1 second')
                    AT TIME ZONE ts.timezone)::date - 1 AS first_date,
               (($2 + interval '12 hours' - ts.first_seconds * interval '1 second')
                    AT TIME ZONE ts.timezone)::date + 1 AS last_date
    ) bounds
    CROSS JOIN LATERAL generate_series(0, bounds.last_date - bounds.first_date)
        AS offsets(day_offset)
),
running AS (
    SELECT cd.*
    FROM candidate_days cd
    CROSS JOIN LATERAL (
        SELECT ((cd.service_date::timestamp + interval '12 hours')
                    AT TIME ZONE cd.timezone) - interval '12 hours' AS service_start
    ) clock
    WHERE $2 BETWEEN clock.service_start + cd.first_seconds * interval '1 second'
                 AND clock.service_start + cd.last_seconds * interval '1 second'
)
SELECT DISTINCT r.route_id, r.trip_id
FROM running r
LEFT JOIN silver.calendar c
  ON c.provider_id = r.provider_id AND c.dataset_version_id = r.dataset_version_id
 AND c.service_id = r.service_id
LEFT JOIN silver.calendar_dates exception
  ON exception.provider_id = r.provider_id
 AND exception.dataset_version_id = r.dataset_version_id
 AND exception.service_id = r.service_id AND exception.service_date = r.service_date
WHERE CASE
    WHEN exception.exception_type = 1 THEN true
    WHEN exception.exception_type = 2 THEN false
    ELSE r.service_date BETWEEN c.start_date AND c.end_date
         AND CASE extract(isodow FROM r.service_date)
             WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
             WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
             ELSE c.sunday END
END;
$function$;
"""

_CREATE_NON_RESPONDING = """
CREATE OR REPLACE VIEW gold.non_responding_current AS
WITH running AS (
    SELECT dv.provider_id, scheduled.route_id, scheduled.trip_id
    FROM core.dataset_versions dv
    CROSS JOIN LATERAL gold.scheduled_running_trips_at(dv.provider_id, now()) scheduled
    WHERE dv.dataset_kind = 'static_schedule' AND dv.is_current
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

# Frozen 0027 view: downgrade restores the previous contract without importing code.
_PREVIOUS_NON_RESPONDING = """
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

_DROP_SCHEDULED_RUNNING_TRIPS = "DROP FUNCTION gold.scheduled_running_trips_at(text, timestamptz)"


def upgrade() -> None:
    op.execute(_CREATE_SCHEDULED_RUNNING_TRIPS)
    op.execute(_CREATE_NON_RESPONDING)


def downgrade() -> None:
    op.execute(_PREVIOUS_NON_RESPONDING)
    op.execute(_DROP_SCHEDULED_RUNNING_TRIPS)
