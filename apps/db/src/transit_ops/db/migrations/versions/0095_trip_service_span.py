"""Precompute static trip spans for the live silent-trip query."""

from alembic import op

revision = "0095_trip_service_span"
down_revision = "0094_worker_starts"
branch_labels = None
depends_on = None

ORIGINAL_FUNCTION = r"""
CREATE OR REPLACE FUNCTION gold.scheduled_running_trips_at(
    provider_id text, as_of timestamp with time zone)
    RETURNS TABLE(route_id text, trip_id text)
    LANGUAGE sql STABLE
    AS $_$
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
$_$;
"""

SPAN_FUNCTION = r"""
CREATE OR REPLACE FUNCTION gold.scheduled_running_trips_at(
    provider_id text, as_of timestamp with time zone)
    RETURNS TABLE(route_id text, trip_id text)
    LANGUAGE sql STABLE
    AS $_$
WITH current_schedule AS (
    SELECT dv.provider_id, dv.dataset_version_id, dp.timezone
    FROM core.dataset_versions dv
    JOIN gold.dim_provider dp ON dp.provider_id = dv.provider_id
    WHERE dv.provider_id = $1
      AND dv.dataset_kind = 'static_schedule' AND dv.is_current
),
trip_span AS (
    SELECT ts.*, cs.timezone
    FROM current_schedule cs
    JOIN gold.trip_service_span ts
      ON ts.provider_id = cs.provider_id AND ts.dataset_version_id = cs.dataset_version_id
    JOIN gold.dim_route dr ON dr.provider_id = ts.provider_id AND dr.route_id = ts.route_id
    WHERE COALESCE(dr.route_type, 3) <> 1
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
$_$;
"""

BACKFILL = r"""
INSERT INTO gold.trip_service_span
    (provider_id, dataset_version_id, route_id, trip_id, service_id, first_seconds, last_seconds)
SELECT t.provider_id, t.dataset_version_id, t.route_id, t.trip_id, t.service_id,
           min(split_part(COALESCE(st.departure_time, st.arrival_time), ':', 1)::bigint * 3600
               + split_part(COALESCE(st.departure_time, st.arrival_time), ':', 2)::int * 60
               + split_part(COALESCE(st.departure_time, st.arrival_time), ':', 3)::int
           ) AS first_seconds,
           max(split_part(COALESCE(st.arrival_time, st.departure_time), ':', 1)::bigint * 3600
               + split_part(COALESCE(st.arrival_time, st.departure_time), ':', 2)::int * 60
               + split_part(COALESCE(st.arrival_time, st.departure_time), ':', 3)::int
           ) AS last_seconds
    FROM silver.trips t
    JOIN silver.stop_times st
      ON st.provider_id = t.provider_id AND st.dataset_version_id = t.dataset_version_id
     AND st.trip_id = t.trip_id
    WHERE COALESCE(st.departure_time, st.arrival_time) IS NOT NULL
      AND EXISTS (SELECT 1 FROM core.dataset_versions dv
                  WHERE dv.dataset_version_id = t.dataset_version_id
                    AND dv.dataset_kind = 'static_schedule' AND dv.is_current)
    GROUP BY t.dataset_version_id, t.trip_id;
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    # Unlike 0094's tiny DDL, this revision scans current static stop times once.
    op.execute("SET LOCAL statement_timeout = '10min'")
    op.execute("""
        CREATE TABLE gold.trip_service_span (
            provider_id text NOT NULL,
            dataset_version_id bigint NOT NULL
                REFERENCES core.dataset_versions(dataset_version_id) ON DELETE CASCADE,
            trip_id text NOT NULL,
            route_id text NOT NULL,
            service_id text NOT NULL,
            first_seconds bigint NOT NULL,
            last_seconds bigint NOT NULL,
            PRIMARY KEY (provider_id, dataset_version_id, trip_id)
        );
        CREATE INDEX ix_trip_service_span_dataset ON gold.trip_service_span(dataset_version_id);
        REVOKE ALL ON gold.trip_service_span FROM PUBLIC;
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit_app') THEN
                GRANT USAGE ON SCHEMA gold TO transit_app;
                GRANT SELECT, INSERT, DELETE ON gold.trip_service_span TO transit_app;
            END IF;
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit-db') THEN
                GRANT USAGE ON SCHEMA gold TO "transit-db";
                GRANT SELECT ON gold.trip_service_span TO "transit-db";
            END IF;
        END $$;
    """)
    op.execute(BACKFILL)
    op.execute("ANALYZE gold.trip_service_span")
    op.execute(SPAN_FUNCTION)


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute(ORIGINAL_FUNCTION)
    op.execute("DROP TABLE gold.trip_service_span")
