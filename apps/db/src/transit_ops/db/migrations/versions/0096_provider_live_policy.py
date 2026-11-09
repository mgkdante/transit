"""Provider-declared live-data gaps with automatic route promotion."""

from alembic import op

revision = "0096_provider_live_policy"
down_revision = "0095_trip_service_span"
branch_labels = None
depends_on = None

PREVIOUS_FUNCTION = r"""
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

RUNNING_FUNCTION = r"""
CREATE OR REPLACE FUNCTION gold.scheduled_running_trips_at(
    provider_id text, as_of timestamp with time zone)
    RETURNS TABLE(route_id text, trip_id text)
    LANGUAGE sql STABLE
    AS $_$
WITH excluded_routes AS MATERIALIZED (
    SELECT declared.route_id
    FROM gold.routes_without_live_data($1) declared
    LEFT JOIN core.route_live_observations live
      ON live.provider_id = $1 AND live.route_id = declared.route_id
     AND live.last_seen_at BETWEEN $2 - interval '15 minutes' AND $2
    WHERE live.route_id IS NULL
), current_schedule AS (
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
    WHERE NOT EXISTS (SELECT 1 FROM excluded_routes e WHERE e.route_id = ts.route_id)
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


POLICY_DDL = r"""
ALTER TABLE core.providers ADD COLUMN lines_without_live_data jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(lines_without_live_data) = 'array');
CREATE TABLE core.route_live_observations (
    provider_id text NOT NULL REFERENCES core.providers(provider_id) ON DELETE CASCADE,
    route_id text NOT NULL,
    last_seen_at timestamptz NOT NULL,
    PRIMARY KEY (provider_id, route_id)
);
REVOKE ALL ON core.route_live_observations FROM PUBLIC;
CREATE FUNCTION gold.routes_without_live_data(provider_id text)
RETURNS TABLE(route_id text) LANGUAGE sql STABLE AS $$
    SELECT DISTINCT r.route_id FROM gold.dim_route r
    JOIN core.providers p ON p.provider_id = r.provider_id
    CROSS JOIN LATERAL jsonb_array_elements(p.lines_without_live_data) policy
    WHERE r.provider_id = $1 AND (
        COALESCE(policy->'route_ids', '[]') ? r.route_id
        OR COALESCE(policy->'route_types', '[]') @> to_jsonb(ARRAY[r.route_type]))
$$;
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit_app') THEN
        GRANT SELECT, INSERT, UPDATE ON core.route_live_observations TO transit_app;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit-db') THEN
        GRANT SELECT ON core.route_live_observations TO "transit-db";
    END IF;
END $$;
UPDATE core.providers SET lines_without_live_data =
 '[{"gap_id":"metro_realtime","route_types":[1],"route_ids":[]}]' WHERE provider_id = 'stm';
UPDATE core.providers SET lines_without_live_data =
 '[{"gap_id":"otrain_realtime","route_types":[0],"route_ids":[]}]'
 WHERE provider_id = 'octranspo';
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute(POLICY_DDL)
    op.execute(RUNNING_FUNCTION)


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute(PREVIOUS_FUNCTION)
    op.execute("DROP FUNCTION gold.routes_without_live_data(text)")
    op.execute("DROP TABLE core.route_live_observations")
    op.execute("ALTER TABLE core.providers DROP COLUMN lines_without_live_data")
