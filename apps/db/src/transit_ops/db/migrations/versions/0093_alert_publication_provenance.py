"""Squashed baseline of revisions 0001-0093; pre-squash chain: commit 5c998b09."""

import sqlalchemy as sa
from alembic import op

revision = "0093_alert_publication_provenance"
down_revision = None
branch_labels = None
depends_on = None

BASELINE_SQL = r"""
CREATE SCHEMA core;
CREATE SCHEMA gold;
CREATE SCHEMA ops;
CREATE SCHEMA raw;
CREATE SCHEMA silver;
CREATE FUNCTION gold.scheduled_running_trips_at(provider_id text, as_of timestamp with time zone)
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
CREATE TABLE core.alert_language_coverage_samples (
    provider_id text NOT NULL,
    measurement_date date NOT NULL,
    window_days smallint NOT NULL,
    window_start date NOT NULL,
    window_end date NOT NULL,
    state text NOT NULL,
    explicit_en_pct numeric(5,2),
    explicit_fr_pct numeric(5,2),
    undetermined_pct numeric(5,2),
    denominator integer NOT NULL,
    alert_observation_count integer NOT NULL,
    feed_observation_days integer NOT NULL,
    measured_at_utc timestamp with time zone NOT NULL,
    CONSTRAINT ck_core_alert_language_coverage_samples_counts CHECK (((denominator >= 0) AND
    (alert_observation_count >= 0) AND (feed_observation_days >= 0))),
    CONSTRAINT ck_core_alert_language_coverage_samples_dates CHECK (((window_start <= window_end)
    AND (measurement_date = window_end))),
    CONSTRAINT ck_core_alert_language_coverage_samples_percentages CHECK ((((explicit_en_pct IS
    NULL) OR ((explicit_en_pct >= (0)::numeric) AND (explicit_en_pct <= (100)::numeric))) AND
    ((explicit_fr_pct IS NULL) OR ((explicit_fr_pct >= (0)::numeric) AND (explicit_fr_pct <=
    (100)::numeric))) AND ((undetermined_pct IS NULL) OR ((undetermined_pct >= (0)::numeric) AND
    (undetermined_pct <= (100)::numeric))))),
    CONSTRAINT ck_core_alert_language_coverage_samples_state CHECK ((state = ANY
    (ARRAY['available'::text, 'no-alerts'::text, 'unavailable'::text, 'unsupported'::text]))),
    CONSTRAINT ck_core_alert_language_coverage_samples_window CHECK ((window_days = ANY (ARRAY[7,
    30])))
);
CREATE TABLE core.dataset_versions (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    feed_endpoint_id bigint NOT NULL,
    source_ingestion_run_id bigint NOT NULL,
    source_ingestion_object_id bigint,
    dataset_kind text DEFAULT 'static_schedule'::text NOT NULL,
    source_version text,
    content_hash text NOT NULL,
    loaded_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    effective_at_utc timestamp with time zone,
    is_current boolean DEFAULT true NOT NULL,
    source_url text,
    storage_backend text,
    storage_path text,
    checksum_sha256 text,
    byte_size bigint,
    first_seen_at_utc timestamp with time zone,
    last_seen_at_utc timestamp with time zone,
    observed_from_utc timestamp with time zone,
    observed_until_utc timestamp with time zone,
    parser_version text,
    manifest_json jsonb,
    CONSTRAINT ck_dataset_versions_dataset_kind CHECK ((dataset_kind = ANY
    (ARRAY['static_schedule'::text, 'gis_static'::text])))
);
ALTER TABLE core.dataset_versions ALTER COLUMN dataset_version_id ADD GENERATED BY DEFAULT AS
    IDENTITY (
    SEQUENCE NAME core.dataset_versions_dataset_version_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE core.feed_endpoints (
    feed_endpoint_id bigint NOT NULL,
    provider_id text NOT NULL,
    endpoint_key text NOT NULL,
    feed_kind text NOT NULL,
    source_format text NOT NULL,
    source_url text,
    auth_type text DEFAULT 'api_key'::text NOT NULL,
    refresh_interval_seconds integer,
    is_enabled boolean DEFAULT true NOT NULL,
    created_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    updated_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_feed_endpoints_feed_kind CHECK ((feed_kind = ANY (ARRAY['static_schedule'::text,
    'gis_static'::text, 'trip_updates'::text, 'vehicle_positions'::text, 'i3_alerts'::text,
    'service_alerts'::text]))),
    CONSTRAINT ck_feed_endpoints_source_format CHECK ((source_format = ANY
    (ARRAY['gtfs_schedule_zip'::text, 'stm_gis_zip'::text, 'gtfs_rt_trip_updates'::text,
    'gtfs_rt_vehicle_positions'::text, 'api_i3_json'::text, 'gtfs_rt_service_alerts'::text])))
);
ALTER TABLE core.feed_endpoints ALTER COLUMN feed_endpoint_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.feed_endpoints_feed_endpoint_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE core.providers (
    provider_id text NOT NULL,
    display_name text NOT NULL,
    timezone text NOT NULL,
    attribution_text text,
    website_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    updated_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    provider_key text NOT NULL,
    default_language text,
    default_currency text,
    min_latitude double precision,
    max_latitude double precision,
    min_longitude double precision,
    max_longitude double precision,
    short_name text,
    city text,
    CONSTRAINT ck_core_providers_bounds_wgs84 CHECK ((((min_latitude IS NULL) AND (max_latitude IS
    NULL) AND (min_longitude IS NULL) AND (max_longitude IS NULL)) OR ((min_latitude BETWEEN -90
    AND 90) AND ((max_latitude >= ('-90'::integer)::double precision) AND (max_latitude <= (90)::double
    precision)) AND (min_latitude <= max_latitude) AND ((min_longitude >= ('-180'::integer)::double
    precision) AND (min_longitude <= (180)::double precision)) AND ((max_longitude >=
    ('-180'::integer)::double precision) AND (max_longitude <= (180)::double precision)) AND
    (min_longitude <= max_longitude))))
);
CREATE TABLE core.snapshot_historic_gc_marks (
    provider_id text NOT NULL,
    object_key text NOT NULL,
    etag text NOT NULL,
    content_length bigint NOT NULL,
    object_last_modified_utc timestamp with time zone NOT NULL,
    first_unreachable_utc timestamp with time zone NOT NULL,
    last_confirmed_unreachable_utc timestamp with time zone NOT NULL,
    last_scan_id uuid NOT NULL,
    CONSTRAINT ck_core_snapshot_historic_gc_marks_generation_key CHECK ((object_key ~
    '^historic/.+/generations/'::text)),
    CONSTRAINT ck_core_snapshot_historic_gc_marks_ordered_time CHECK
    ((last_confirmed_unreachable_utc >= first_unreachable_utc)),
    CONSTRAINT ck_core_snapshot_historic_gc_marks_size CHECK ((content_length >= 0))
);
CREATE TABLE core.snapshot_historic_receipts (
    provider_id text NOT NULL,
    family text NOT NULL,
    entity_key text NOT NULL,
    receipt_schema_version smallint NOT NULL,
    common_envelope jsonb NOT NULL,
    common_envelope_sha256 text NOT NULL,
    month_receipts jsonb NOT NULL,
    scope_count integer NOT NULL,
    first_scope_start date NOT NULL,
    last_scope_end date NOT NULL,
    entity_receipt_sha256 text NOT NULL,
    origin_publish_generation_id text NOT NULL,
    activated_root_generation_id text NOT NULL,
    created_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    updated_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_core_snapshot_historic_receipts_coverage CHECK ((first_scope_start <=
    last_scope_end)),
    CONSTRAINT ck_core_snapshot_historic_receipts_entity CHECK ((((family = 'network'::text) AND
    (entity_key = ''::text)) OR ((family = ANY (ARRAY['lines'::text, 'stops'::text])) AND
    (entity_key <> ''::text)))),
    CONSTRAINT ck_core_snapshot_historic_receipts_entity_sha CHECK ((entity_receipt_sha256 ~
    '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_core_snapshot_historic_receipts_envelope_json CHECK
    ((jsonb_typeof(common_envelope) = 'object'::text)),
    CONSTRAINT ck_core_snapshot_historic_receipts_envelope_sha CHECK ((common_envelope_sha256 ~
    '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_core_snapshot_historic_receipts_family CHECK ((family = ANY
    (ARRAY['network'::text, 'lines'::text, 'stops'::text]))),
    CONSTRAINT ck_core_snapshot_historic_receipts_months_json CHECK ((jsonb_typeof(month_receipts) =
    'object'::text)),
    CONSTRAINT ck_core_snapshot_historic_receipts_schema_version CHECK ((receipt_schema_version >
    0)),
    CONSTRAINT ck_core_snapshot_historic_receipts_scope_count CHECK ((scope_count > 0))
);
CREATE TABLE core.snapshot_publish_state (
    provider_id text NOT NULL,
    tier text NOT NULL,
    generated_utc timestamp with time zone NOT NULL,
    files_written integer DEFAULT 0 NOT NULL,
    files_skipped integer DEFAULT 0 NOT NULL,
    files_total integer DEFAULT 0 NOT NULL,
    updated_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    gate_checks_run integer,
    gate_errors integer,
    gate_warnings integer,
    gate_verdict text,
    gate_generated_utc timestamp with time zone,
    stable_files_total integer,
    historic_files_reused integer,
    historic_scopes_reused integer,
    historic_scopes_rebuilt integer,
    historic_source_digest_ms double precision,
    historic_build_ms double precision,
    historic_gate_ms double precision,
    historic_upload_ms double precision,
    historic_parent_compose_ms double precision,
    historic_compatibility_ms double precision,
    historic_receipt_persist_ms double precision,
    historic_receipt_rows_attempted integer,
    historic_receipt_rows_changed integer,
    historic_phase_detail jsonb,
    CONSTRAINT ck_core_snapshot_publish_state_files_arithmetic CHECK ((files_total = ((files_written
    + files_skipped) + COALESCE(historic_files_reused, 0)))),
    CONSTRAINT ck_core_snapshot_publish_state_tier CHECK ((tier = ANY (ARRAY['live'::text,
    'static'::text, 'historic'::text])))
);
CREATE TABLE gold.alert_archive_entry (
    provider_id text NOT NULL,
    alert_id text NOT NULL,
    archive_month date NOT NULL,
    header_text text,
    header_text_en text,
    description_text text,
    description_text_en text,
    severity text,
    cause text,
    effect text,
    route_ids text[] DEFAULT '{}'::text[] NOT NULL,
    stop_ids text[] DEFAULT '{}'::text[] NOT NULL,
    start_utc timestamp with time zone,
    end_utc timestamp with time zone,
    active_periods jsonb DEFAULT '[]'::jsonb NOT NULL,
    url text,
    first_seen_utc timestamp with time zone NOT NULL,
    last_seen_utc timestamp with time zone NOT NULL,
    content_hash text NOT NULL,
    updated_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    url_en text,
    message jsonb,
    CONSTRAINT ck_gold_alert_archive_entry_month_start CHECK ((archive_month =
    (date_trunc('month'::text, (archive_month)::timestamp with time zone))::date))
);
CREATE TABLE gold.citizen_accountability_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    affected_route_count integer DEFAULT 0,
    affected_stop_count integer DEFAULT 0,
    delayed_trip_count integer DEFAULT 0 NOT NULL,
    severe_delay_count integer DEFAULT 0 NOT NULL,
    alert_count integer DEFAULT 0 NOT NULL,
    rider_impact_score numeric(8,4),
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE silver.i3_alert_active_periods (
    i3_alert_snapshot_id bigint NOT NULL,
    alert_index integer NOT NULL,
    period_index integer NOT NULL,
    start_utc timestamp with time zone,
    end_utc timestamp with time zone
);
CREATE TABLE silver.i3_alert_informed_entities (
    i3_alert_snapshot_id bigint NOT NULL,
    alert_index integer NOT NULL,
    entity_index integer NOT NULL,
    provider_id text NOT NULL,
    route_id text,
    stop_id text,
    trip_id text,
    area_id text,
    raw_entity_json jsonb NOT NULL
);
CREATE TABLE silver.i3_alerts (
    i3_alert_snapshot_id bigint NOT NULL,
    alert_index integer NOT NULL,
    provider_id text NOT NULL,
    alert_id text,
    alert_header_text text,
    description_text text,
    severity text,
    cause text,
    effect text,
    active_period_start_utc timestamp with time zone,
    active_period_end_utc timestamp with time zone,
    published_at_utc timestamp with time zone,
    updated_at_utc timestamp with time zone,
    captured_at_utc timestamp with time zone NOT NULL,
    raw_alert_json jsonb NOT NULL,
    content_hash text NOT NULL,
    first_seen_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    valid_to timestamp with time zone,
    alert_header_text_en text,
    description_text_en text,
    url text,
    url_en text,
    message_snapshot_id bigint,
    message_alert_index integer
);
CREATE VIEW gold.current_i3_alerts AS
 WITH keyed AS (
         SELECT a.i3_alert_snapshot_id,
            a.alert_index,
            a.provider_id,
            a.alert_id,
            a.alert_header_text,
            a.description_text,
            a.severity,
            a.cause,
            a.effect,
            a.active_period_start_utc,
            a.active_period_end_utc,
            a.published_at_utc,
            a.updated_at_utc,
            a.captured_at_utc,
            a.raw_alert_json,
            a.content_hash,
            a.first_seen_at,
            a.last_seen_at,
            a.valid_to,
            a.alert_header_text_en,
            a.description_text_en,
            a.url,
            a.url_en,
            a.message_snapshot_id,
            a.message_alert_index,
            COALESCE(('upstream:'::text || NULLIF(btrim(a.alert_id), ''::text)), ('synthetic:'::text
    || md5((jsonb_build_array(COALESCE(a.alert_header_text, ''::text), COALESCE(a.description_text,
    ''::text), EXTRACT(epoch FROM a.active_period_start_utc), EXTRACT(epoch FROM
    a.active_period_end_utc)))::text))) AS message_key
           FROM silver.i3_alerts a
          WHERE (a.valid_to IS NULL)
        ), latest AS (
         SELECT DISTINCT ON (keyed.provider_id, keyed.message_key) keyed.i3_alert_snapshot_id,
            keyed.alert_index,
            keyed.provider_id,
            keyed.alert_id,
            keyed.alert_header_text,
            keyed.description_text,
            keyed.severity,
            keyed.cause,
            keyed.effect,
            keyed.active_period_start_utc,
            keyed.active_period_end_utc,
            keyed.published_at_utc,
            keyed.updated_at_utc,
            keyed.captured_at_utc,
            keyed.raw_alert_json,
            keyed.content_hash,
            keyed.first_seen_at,
            keyed.last_seen_at,
            keyed.valid_to,
            keyed.alert_header_text_en,
            keyed.description_text_en,
            keyed.url,
            keyed.url_en,
            keyed.message_snapshot_id,
            keyed.message_alert_index,
            keyed.message_key
           FROM keyed
          ORDER BY keyed.provider_id, keyed.message_key, COALESCE(keyed.last_seen_at,
    keyed.captured_at_utc) DESC, COALESCE(keyed.message_snapshot_id, keyed.i3_alert_snapshot_id)
    DESC, COALESCE(keyed.message_alert_index, keyed.alert_index) DESC, keyed.i3_alert_snapshot_id
    DESC, keyed.alert_index DESC
        )
 SELECT d.provider_id,
    d.alert_id,
    d.alert_header_text,
    d.description_text,
    d.severity,
    d.cause,
    d.effect,
    e.route_ids,
    e.stop_ids,
    e.route_count,
    e.stop_count,
    e.entity_count,
    d.active_period_start_utc,
    d.active_period_end_utc,
    d.first_seen_at,
    d.last_seen_at,
    d.captured_at_utc,
    d.alert_header_text_en,
    d.description_text_en,
    d.url,
    d.url_en,
    p.active_periods,
    d.raw_alert_json,
    d.message_snapshot_id,
    d.message_alert_index,
    COALESCE(NULLIF(btrim(d.alert_id), ''::text), ((d.provider_id || '-alert-'::text) ||
    SUBSTRING(d.message_key FROM 11 FOR 12))) AS resolved_alert_id
   FROM ((latest d
     LEFT JOIN LATERAL ( SELECT string_agg(DISTINCT i3_alert_informed_entities.route_id, ', '::text
    ORDER BY i3_alert_informed_entities.route_id) AS route_ids,
            string_agg(DISTINCT i3_alert_informed_entities.stop_id, ', '::text ORDER BY
    i3_alert_informed_entities.stop_id) AS stop_ids,
            count(DISTINCT i3_alert_informed_entities.route_id) AS route_count,
            count(DISTINCT i3_alert_informed_entities.stop_id) AS stop_count,
            count(*) AS entity_count
           FROM silver.i3_alert_informed_entities
          WHERE ((i3_alert_informed_entities.i3_alert_snapshot_id = d.i3_alert_snapshot_id) AND
    (i3_alert_informed_entities.alert_index = d.alert_index))) e ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('start_utc',
    i3_alert_active_periods.start_utc, 'end_utc', i3_alert_active_periods.end_utc) ORDER BY
    i3_alert_active_periods.period_index) AS active_periods
           FROM silver.i3_alert_active_periods
          WHERE ((i3_alert_active_periods.i3_alert_snapshot_id = d.i3_alert_snapshot_id) AND
    (i3_alert_active_periods.alert_index = d.alert_index))) p ON (true))
  WHERE ((COALESCE(d.active_period_start_utc, d.captured_at_utc) <= now()) AND
    (COALESCE(d.active_period_end_utc, (now() + '100 years'::interval)) >= now()));
CREATE TABLE silver.rt_feed_snapshots (
    rt_feed_snapshot_id bigint NOT NULL,
    provider_id text NOT NULL,
    feed_endpoint_id bigint NOT NULL,
    ingestion_run_id bigint NOT NULL,
    ingestion_object_id bigint,
    endpoint_key text NOT NULL,
    gtfs_realtime_version text,
    incrementality text,
    feed_timestamp_utc timestamp with time zone,
    captured_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    loaded_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    source_url text,
    storage_backend text,
    storage_path text,
    checksum_sha256 text,
    byte_size bigint,
    parser_version text,
    manifest_json jsonb,
    source_realtime_snapshot_id bigint
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_vacuum_threshold='1000',
    autovacuum_analyze_scale_factor='0.05', autovacuum_analyze_threshold='1000');
CREATE TABLE silver.rt_trip_update_stop_times (
    rt_feed_snapshot_id bigint NOT NULL,
    entity_index integer NOT NULL,
    stop_time_update_index integer NOT NULL,
    provider_id text NOT NULL,
    stop_sequence integer,
    stop_id text,
    arrival_time_utc timestamp with time zone,
    departure_time_utc timestamp with time zone,
    schedule_relationship integer
)
WITH (autovacuum_vacuum_scale_factor='0.005', autovacuum_vacuum_threshold='50000',
    autovacuum_analyze_scale_factor='0.01', autovacuum_analyze_threshold='50000');
CREATE TABLE silver.rt_trip_updates (
    rt_feed_snapshot_id bigint NOT NULL,
    entity_index integer NOT NULL,
    provider_id text NOT NULL,
    trip_id text,
    route_id text,
    direction_id integer,
    start_date date,
    schedule_relationship integer,
    trip_update_timestamp_utc timestamp with time zone,
    feed_timestamp_utc timestamp with time zone,
    captured_at_utc timestamp with time zone NOT NULL
)
WITH (autovacuum_vacuum_scale_factor='0.01', autovacuum_vacuum_threshold='50000',
    autovacuum_analyze_scale_factor='0.02', autovacuum_analyze_threshold='50000');
CREATE VIEW gold.current_stop_next_departures AS
 WITH latest AS (
         SELECT DISTINCT ON (rt_feed_snapshots.provider_id) rt_feed_snapshots.provider_id,
            rt_feed_snapshots.source_realtime_snapshot_id AS sid
           FROM silver.rt_feed_snapshots
          WHERE ((rt_feed_snapshots.endpoint_key = 'trip_updates'::text) AND
    (rt_feed_snapshots.source_realtime_snapshot_id IS NOT NULL))
          ORDER BY rt_feed_snapshots.provider_id, rt_feed_snapshots.captured_at_utc DESC,
    rt_feed_snapshots.source_realtime_snapshot_id DESC
        )
 SELECT rtu.provider_id,
    stu.stop_id,
    rtu.route_id,
    rtu.trip_id,
    stu.stop_sequence,
    COALESCE(stu.departure_time_utc, stu.arrival_time_utc) AS predicted_departure_utc,
    row_number() OVER (PARTITION BY rtu.provider_id, stu.stop_id ORDER BY
    COALESCE(stu.departure_time_utc, stu.arrival_time_utc)) AS departure_rank
   FROM (((silver.rt_trip_updates rtu
     JOIN silver.rt_feed_snapshots rfs ON (((rfs.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id) AND
    (rfs.endpoint_key = 'trip_updates'::text))))
     JOIN latest ON (((latest.provider_id = rfs.provider_id) AND (latest.sid =
    rfs.source_realtime_snapshot_id))))
     JOIN silver.rt_trip_update_stop_times stu ON (((stu.provider_id = rtu.provider_id) AND
    (stu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id) AND (stu.entity_index = rtu.entity_index))))
  WHERE (COALESCE(stu.departure_time_utc, stu.arrival_time_utc) >= now());
CREATE VIEW gold.dim_provider AS
 SELECT provider_id,
    provider_key,
    display_name,
    timezone,
    default_language,
    default_currency,
    min_latitude,
    max_latitude,
    min_longitude,
    max_longitude,
    attribution_text,
    website_url,
    is_active
   FROM core.providers;
CREATE TABLE gold.latest_trip_delay_snapshot (
    provider_id text NOT NULL,
    realtime_snapshot_id bigint NOT NULL,
    entity_index integer NOT NULL,
    snapshot_date_key integer NOT NULL,
    snapshot_local_date date NOT NULL,
    feed_timestamp_utc timestamp with time zone NOT NULL,
    captured_at_utc timestamp with time zone NOT NULL,
    entity_id text,
    trip_id text,
    route_id text,
    direction_id integer,
    start_date date,
    vehicle_id text,
    trip_schedule_relationship integer,
    delay_seconds integer,
    stop_time_update_count integer NOT NULL,
    delay_stop_id text,
    delay_stop_sequence integer,
    skipped_stop_count integer DEFAULT 0 NOT NULL,
    occupancy_status integer
);
CREATE VIEW gold.current_trip_delay_computed AS
 WITH provider_now AS (
         SELECT dp.provider_id,
            ((now() AT TIME ZONE dp.timezone))::date AS today_local
           FROM gold.dim_provider dp
        )
 SELECT lts.provider_id,
    lts.realtime_snapshot_id AS rt_feed_snapshot_id,
    lts.trip_id,
    lts.route_id,
    lts.direction_id,
    max(lts.captured_at_utc) AS captured_at_utc,
    (COALESCE(sum(lts.stop_time_update_count), count(*)))::integer AS stop_time_observation_count,
    round(avg((lts.delay_seconds)::numeric), 2) AS avg_delay_seconds,
    max(lts.delay_seconds) AS max_delay_seconds
   FROM (gold.latest_trip_delay_snapshot lts
     JOIN provider_now pn ON ((pn.provider_id = lts.provider_id)))
  WHERE ((lts.delay_seconds IS NOT NULL) AND (abs(lts.delay_seconds) <= 3600) AND (lts.start_date >=
    (pn.today_local - '1 day'::interval)))
  GROUP BY lts.provider_id, lts.realtime_snapshot_id, lts.trip_id, lts.route_id, lts.direction_id;
CREATE TABLE gold.latest_vehicle_snapshot (
    provider_id text NOT NULL,
    realtime_snapshot_id bigint NOT NULL,
    entity_index integer NOT NULL,
    snapshot_date_key integer NOT NULL,
    snapshot_local_date date NOT NULL,
    feed_timestamp_utc timestamp with time zone NOT NULL,
    captured_at_utc timestamp with time zone NOT NULL,
    position_timestamp_utc timestamp with time zone,
    entity_id text,
    vehicle_id text,
    trip_id text,
    route_id text,
    stop_id text,
    current_stop_sequence integer,
    current_status integer,
    occupancy_status integer,
    latitude double precision,
    longitude double precision,
    bearing double precision,
    speed double precision
);
CREATE VIEW gold.current_vehicle_map AS
 SELECT v.provider_id,
    v.realtime_snapshot_id,
    v.entity_index,
    v.vehicle_id,
    v.trip_id,
    v.route_id,
    v.stop_id,
    v.captured_at_utc,
    v.latitude,
    v.longitude,
    public.st_setsrid(public.st_makepoint(v.longitude, v.latitude), 4326) AS geom_wgs84,
    (public.st_asgeojson(public.st_setsrid(public.st_makepoint(v.longitude, v.latitude),
    4326)))::jsonb AS geojson
   FROM (gold.latest_vehicle_snapshot v
     JOIN gold.dim_provider dp ON ((dp.provider_id = v.provider_id)))
  WHERE ((v.latitude BETWEEN -90 AND 90) AND ((v.longitude >= ('-180'::integer)::double
    precision) AND (v.longitude <= (180)::double precision)) AND ((dp.min_latitude IS NULL) OR
    ((v.latitude BETWEEN dp.min_latitude AND dp.max_latitude) AND ((v.longitude >=
    dp.min_longitude) AND (v.longitude <= dp.max_longitude)))));
CREATE VIEW gold.current_vehicle_map_with_status AS
 SELECT cvm.provider_id,
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
            WHEN (ctc.avg_delay_seconds IS NULL) THEN 'Inconnu / Unknown'::text
            WHEN (ctc.avg_delay_seconds < ('-60'::integer)::numeric) THEN 'En avance / Early'::text
            WHEN (ctc.avg_delay_seconds < (60)::numeric) THEN 'À l''heure / On time'::text
            WHEN (ctc.avg_delay_seconds < (300)::numeric) THEN 'En retard / Late'::text
            ELSE 'Critique / Severe'::text
        END AS status_band
   FROM (gold.current_vehicle_map cvm
     LEFT JOIN gold.current_trip_delay_computed ctc ON (((ctc.provider_id = cvm.provider_id) AND
    (ctc.trip_id = cvm.trip_id))));
CREATE TABLE gold.dim_date (
    provider_id text NOT NULL,
    dataset_version_id bigint NOT NULL,
    service_date date NOT NULL,
    date_key integer NOT NULL,
    day_of_week_iso integer NOT NULL,
    day_name text NOT NULL,
    week_of_year integer NOT NULL,
    month_number integer NOT NULL,
    month_name text NOT NULL,
    quarter_number integer NOT NULL,
    year_number integer NOT NULL,
    is_weekend boolean NOT NULL,
    has_calendar_exception boolean NOT NULL,
    is_service_added boolean NOT NULL,
    is_service_removed boolean NOT NULL
);
CREATE TABLE gold.dim_route (
    provider_id text NOT NULL,
    dataset_version_id bigint NOT NULL,
    route_id text NOT NULL,
    route_short_name text,
    route_long_name text,
    route_desc text,
    route_type integer NOT NULL,
    route_color text,
    route_text_color text,
    route_sort_order integer,
    route_desc_detail text
);
CREATE TABLE gold.dim_route_history (
    provider_id text NOT NULL,
    route_id text NOT NULL,
    route_short_name text,
    route_long_name text,
    route_color text,
    route_type integer,
    valid_from_utc timestamp with time zone NOT NULL,
    valid_to_utc timestamp with time zone,
    last_seen_dataset_version_id bigint
);
CREATE TABLE gold.dim_route_pattern (
    provider_id text NOT NULL,
    dataset_version_id bigint NOT NULL,
    route_pattern_id text NOT NULL,
    route_id text NOT NULL,
    direction_id integer NOT NULL,
    route_pattern_typicality integer NOT NULL
);
CREATE TABLE gold.dim_stop (
    provider_id text NOT NULL,
    dataset_version_id bigint NOT NULL,
    stop_id text NOT NULL,
    stop_code text,
    stop_name text NOT NULL,
    parent_station text,
    location_type integer,
    stop_lat double precision,
    stop_lon double precision,
    zone_id text,
    wheelchair_boarding integer,
    platform_code text
);
CREATE TABLE gold.dim_stop_history (
    provider_id text NOT NULL,
    stop_id text NOT NULL,
    stop_name text NOT NULL,
    stop_lat double precision,
    stop_lon double precision,
    valid_from_utc timestamp with time zone NOT NULL,
    valid_to_utc timestamp with time zone,
    last_seen_dataset_version_id bigint
);
CREATE TABLE silver.stop_times (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    trip_id text NOT NULL,
    stop_sequence integer NOT NULL,
    stop_id text NOT NULL,
    arrival_time text,
    departure_time text,
    stop_headsign text,
    pickup_type integer,
    drop_off_type integer,
    continuous_pickup integer,
    continuous_drop_off integer,
    shape_dist_traveled double precision,
    timepoint integer
);
CREATE VIEW gold.fact_stop_time_delay_observation AS
 WITH current_static_dataset AS (
         SELECT dv.provider_id,
            dv.dataset_version_id
           FROM core.dataset_versions dv
          WHERE ((dv.dataset_kind = 'static_schedule'::text) AND dv.is_current)
        ), static_stop_times AS (
         SELECT st.provider_id,
            st.dataset_version_id,
            st.trip_id,
            st.stop_sequence,
            st.stop_id,
            st.arrival_time,
            st.departure_time,
            ((((split_part(st.arrival_time, ':'::text, 1))::integer * 3600) +
    ((split_part(st.arrival_time, ':'::text, 2))::integer * 60)) + (split_part(st.arrival_time,
    ':'::text, 3))::integer) AS scheduled_arrival_seconds,
            ((((split_part(st.departure_time, ':'::text, 1))::integer * 3600) +
    ((split_part(st.departure_time, ':'::text, 2))::integer * 60)) + (split_part(st.departure_time,
    ':'::text, 3))::integer) AS scheduled_departure_seconds
           FROM (silver.stop_times st
             JOIN current_static_dataset cs ON (((cs.provider_id = st.provider_id) AND
    (st.dataset_version_id = cs.dataset_version_id))))
          WHERE ((st.arrival_time IS NOT NULL) AND (st.departure_time IS NOT NULL))
        ), joined AS (
         SELECT rtu.provider_id,
            rtu.rt_feed_snapshot_id,
            rtu.entity_index,
            rtu.trip_id,
            rtu.route_id,
            rtu.direction_id,
            rtu.start_date,
            stu.stop_time_update_index,
            stu.stop_sequence,
            COALESCE(stu.stop_id, st.stop_id) AS stop_id,
            stu.arrival_time_utc,
            stu.departure_time_utc,
            rtu.feed_timestamp_utc,
            rtu.captured_at_utc,
            st.dataset_version_id,
            ((timezone(dp.timezone, ((rtu.start_date)::timestamp without time zone +
    '12:00:00'::interval)) - '12:00:00'::interval) + make_interval(secs =>
    (st.scheduled_arrival_seconds)::double precision)) AS scheduled_arrival_utc,
            ((timezone(dp.timezone, ((rtu.start_date)::timestamp without time zone +
    '12:00:00'::interval)) - '12:00:00'::interval) + make_interval(secs =>
    (st.scheduled_departure_seconds)::double precision)) AS scheduled_departure_utc
           FROM (((silver.rt_trip_updates rtu
             JOIN silver.rt_trip_update_stop_times stu ON (((stu.provider_id = rtu.provider_id) AND
    (stu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id) AND (stu.entity_index = rtu.entity_index))))
             JOIN static_stop_times st ON (((st.provider_id = rtu.provider_id) AND (st.trip_id =
    rtu.trip_id) AND (st.stop_sequence = stu.stop_sequence))))
             JOIN gold.dim_provider dp ON ((dp.provider_id = rtu.provider_id)))
        )
 SELECT provider_id,
    rt_feed_snapshot_id,
    entity_index,
    trip_id,
    route_id,
    direction_id,
    start_date,
    stop_time_update_index,
    stop_sequence,
    stop_id,
    dataset_version_id,
    scheduled_arrival_utc,
    arrival_time_utc AS predicted_arrival_utc,
    (EXTRACT(epoch FROM (arrival_time_utc - scheduled_arrival_utc)))::integer AS
    arrival_delay_seconds,
    scheduled_departure_utc,
    departure_time_utc AS predicted_departure_utc,
    (EXTRACT(epoch FROM (departure_time_utc - scheduled_departure_utc)))::integer AS
    departure_delay_seconds,
    COALESCE(arrival_time_utc, departure_time_utc, feed_timestamp_utc, captured_at_utc) AS
    observation_time_utc,
    feed_timestamp_utc,
    captured_at_utc
   FROM joined;
CREATE TABLE gold.fact_trip_delay_snapshot (
    provider_id text NOT NULL,
    realtime_snapshot_id bigint NOT NULL,
    entity_index integer NOT NULL,
    snapshot_date_key integer NOT NULL,
    snapshot_local_date date NOT NULL,
    feed_timestamp_utc timestamp with time zone NOT NULL,
    captured_at_utc timestamp with time zone NOT NULL,
    entity_id text,
    trip_id text,
    route_id text,
    direction_id integer,
    start_date date,
    vehicle_id text,
    trip_schedule_relationship integer,
    delay_seconds integer,
    stop_time_update_count integer NOT NULL,
    delay_stop_id text,
    delay_stop_sequence integer,
    skipped_stop_count integer DEFAULT 0 NOT NULL,
    occupancy_status integer
)
WITH (autovacuum_vacuum_scale_factor='0.01', autovacuum_vacuum_threshold='50000',
    autovacuum_analyze_scale_factor='0.02', autovacuum_analyze_threshold='50000');
CREATE TABLE gold.fact_vehicle_snapshot (
    provider_id text NOT NULL,
    realtime_snapshot_id bigint NOT NULL,
    entity_index integer NOT NULL,
    snapshot_date_key integer NOT NULL,
    snapshot_local_date date NOT NULL,
    feed_timestamp_utc timestamp with time zone NOT NULL,
    captured_at_utc timestamp with time zone NOT NULL,
    position_timestamp_utc timestamp with time zone,
    entity_id text,
    vehicle_id text,
    trip_id text,
    route_id text,
    stop_id text,
    current_stop_sequence integer,
    current_status integer,
    occupancy_status integer,
    latitude double precision,
    longitude double precision,
    bearing double precision,
    speed double precision
)
WITH (autovacuum_vacuum_scale_factor='0.01', autovacuum_vacuum_threshold='50000',
    autovacuum_analyze_scale_factor='0.02', autovacuum_analyze_threshold='50000');
CREATE TABLE raw.ingestion_runs (
    ingestion_run_id bigint NOT NULL,
    provider_id text NOT NULL,
    feed_endpoint_id bigint NOT NULL,
    run_kind text NOT NULL,
    status text NOT NULL,
    requested_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    started_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    completed_at_utc timestamp with time zone,
    feed_timestamp_utc timestamp with time zone,
    http_status_code integer,
    entity_count integer,
    error_message text,
    CONSTRAINT ck_ingestion_runs_run_kind CHECK ((run_kind = ANY (ARRAY['static_schedule'::text,
    'gis_static'::text, 'trip_updates'::text, 'vehicle_positions'::text, 'i3_alerts'::text,
    'silver_load'::text, 'service_alerts'::text]))),
    CONSTRAINT ck_ingestion_runs_status CHECK ((status = ANY (ARRAY['pending'::text,
    'running'::text, 'succeeded'::text, 'failed'::text])))
);
CREATE VIEW gold.feed_freshness_current AS
 WITH latest_runs AS (
         SELECT DISTINCT ON (ir.provider_id, fe.endpoint_key) ir.provider_id,
            fe.endpoint_key,
            ir.status,
            ir.requested_at_utc,
            ir.started_at_utc,
            ir.completed_at_utc,
            ir.feed_timestamp_utc,
            (EXTRACT(epoch FROM (now() - ir.completed_at_utc)))::integer AS completed_age_seconds
           FROM (raw.ingestion_runs ir
             JOIN core.feed_endpoints fe ON ((fe.feed_endpoint_id = ir.feed_endpoint_id)))
          WHERE (ir.run_kind <> 'silver_load'::text)
          ORDER BY ir.provider_id, fe.endpoint_key, ir.started_at_utc DESC
        )
 SELECT provider_id,
    endpoint_key,
    status,
    requested_at_utc,
    started_at_utc,
    completed_at_utc,
    feed_timestamp_utc,
    completed_age_seconds
   FROM latest_runs;
CREATE VIEW gold.i3_alert_history_reporting AS
 SELECT a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.severity,
    a.cause,
    a.effect,
    e.route_id,
    e.stop_id,
    e.area_id,
    ((a.captured_at_utc AT TIME ZONE dp.timezone))::date AS provider_local_date,
    date_trunc('hour'::text, (a.captured_at_utc AT TIME ZONE dp.timezone)) AS hour_bucket_local,
    date_trunc('week'::text, (a.captured_at_utc AT TIME ZONE dp.timezone)) AS week_bucket_local,
    date_trunc('month'::text, (a.captured_at_utc AT TIME ZONE dp.timezone)) AS month_bucket_local,
    date_trunc('year'::text, (a.captured_at_utc AT TIME ZONE dp.timezone)) AS
    rolling_year_bucket_local,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.captured_at_utc,
    md5((((COALESCE(a.description_text, ''::text) || COALESCE(a.severity, ''::text)) ||
    COALESCE(a.cause, ''::text)) || COALESCE(a.effect, ''::text))) AS effective_content_hash,
    a.alert_header_text_en,
    a.description_text,
    a.description_text_en
   FROM ((silver.i3_alerts a
     JOIN gold.dim_provider dp ON ((dp.provider_id = a.provider_id)))
     LEFT JOIN silver.i3_alert_informed_entities e ON (((e.i3_alert_snapshot_id =
    a.i3_alert_snapshot_id) AND (e.alert_index = a.alert_index))));
CREATE TABLE silver.shapes (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    shape_id text NOT NULL,
    shape_pt_sequence integer NOT NULL,
    shape_pt_lat double precision,
    shape_pt_lon double precision,
    route_pattern_id text
);
CREATE TABLE silver.trips (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    trip_id text NOT NULL,
    route_id text NOT NULL,
    service_id text NOT NULL,
    trip_headsign text,
    trip_short_name text,
    direction_id integer,
    block_id text,
    shape_id text,
    wheelchair_accessible integer,
    bikes_allowed integer,
    route_pattern_id text,
    note_fr text,
    note_en text
);
CREATE VIEW gold.map_route_lines AS
 SELECT sh.provider_id,
    sh.dataset_version_id,
    sh.shape_id,
    max(sh.route_pattern_id) AS route_pattern_id,
    public.st_makeline(public.st_setsrid(public.st_makepoint(sh.shape_pt_lon, sh.shape_pt_lat),
    4326) ORDER BY sh.shape_pt_sequence) AS geom_wgs84,
    (public.st_asgeojson(public.st_makeline(public.st_setsrid(public.st_makepoint(sh.shape_pt_lon,
    sh.shape_pt_lat), 4326) ORDER BY sh.shape_pt_sequence)))::jsonb AS geojson,
    max(sr.route_id) AS route_id
   FROM (silver.shapes sh
     LEFT JOIN ( SELECT trips.provider_id,
            trips.dataset_version_id,
            trips.shape_id,
            min(trips.route_id) AS route_id
           FROM silver.trips
          WHERE (trips.shape_id IS NOT NULL)
          GROUP BY trips.provider_id, trips.dataset_version_id, trips.shape_id) sr ON
    (((sr.provider_id = sh.provider_id) AND (sr.dataset_version_id = sh.dataset_version_id) AND
    (sr.shape_id = sh.shape_id))))
  WHERE ((sh.shape_pt_lat BETWEEN -90 AND 90) AND ((sh.shape_pt_lon >=
    ('-180'::integer)::double precision) AND
    (sh.shape_pt_lon <= (180)::double precision)))
  GROUP BY sh.provider_id, sh.dataset_version_id, sh.shape_id;
CREATE VIEW gold.non_responding_current AS
 WITH running AS (
         SELECT dv.provider_id,
            scheduled.route_id,
            scheduled.trip_id
           FROM (core.dataset_versions dv
             CROSS JOIN LATERAL gold.scheduled_running_trips_at(dv.provider_id, now())
    scheduled(route_id, trip_id))
          WHERE ((dv.dataset_kind = 'static_schedule'::text) AND dv.is_current)
        ), live AS (
         SELECT DISTINCT latest_vehicle_snapshot.provider_id,
            latest_vehicle_snapshot.trip_id
           FROM gold.latest_vehicle_snapshot
          WHERE (latest_vehicle_snapshot.trip_id IS NOT NULL)
        )
 SELECT r.provider_id,
    r.route_id,
    (count(DISTINCT r.trip_id))::integer AS non_responding_count,
    array_agg(DISTINCT r.trip_id) AS trip_ids
   FROM (running r
     LEFT JOIN live l ON (((l.provider_id = r.provider_id) AND (l.trip_id = r.trip_id))))
  WHERE (l.trip_id IS NULL)
  GROUP BY r.provider_id, r.route_id;
CREATE TABLE gold.route_delay_hourly (
    provider_id text NOT NULL,
    period_start_utc timestamp with time zone NOT NULL,
    route_id text NOT NULL,
    trip_count integer DEFAULT 0 NOT NULL,
    observation_count integer DEFAULT 0 NOT NULL,
    avg_delay_seconds numeric(12,2),
    max_delay_seconds integer,
    delayed_trip_count integer DEFAULT 0 NOT NULL,
    severe_delay_count integer DEFAULT 0 NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    delay_observation_count integer DEFAULT 0 NOT NULL,
    on_time_observation_count integer,
    usable_delay_observation_count bigint,
    usable_delay_sum_seconds bigint
);
CREATE VIEW gold.public_route_reliability_daily AS
 SELECT rd.provider_id,
    rd.route_id,
    ((rd.period_start_utc AT TIME ZONE dp.timezone))::date AS provider_local_date,
    (sum(rd.observation_count))::integer AS stop_time_observation_count,
        CASE
            WHEN bool_and(((rd.usable_delay_observation_count IS NOT NULL) AND
    ((rd.usable_delay_observation_count = 0) OR (rd.usable_delay_sum_seconds IS NOT NULL)))) THEN
    (sum(rd.usable_delay_sum_seconds) / NULLIF(sum(rd.usable_delay_observation_count),
    (0)::numeric))
            ELSE NULL::numeric
        END AS avg_delay_seconds,
    (sum(rd.severe_delay_count))::integer AS severe_delay_observation_count,
    (sum(rd.delay_observation_count))::integer AS delay_observation_count,
        CASE
            WHEN (count(*) = count(rd.on_time_observation_count)) THEN
    (sum(rd.on_time_observation_count))::integer
            ELSE NULL::integer
        END AS on_time_observation_count
   FROM (gold.route_delay_hourly rd
     JOIN gold.dim_provider dp ON ((dp.provider_id = rd.provider_id)))
  GROUP BY rd.provider_id, rd.route_id, (((rd.period_start_utc AT TIME ZONE dp.timezone))::date);
CREATE TABLE gold.stop_delay_hourly (
    provider_id text NOT NULL,
    period_start_utc timestamp with time zone NOT NULL,
    stop_id text NOT NULL,
    route_id text NOT NULL,
    observation_count integer DEFAULT 0 NOT NULL,
    avg_arrival_delay_seconds numeric(12,2),
    avg_departure_delay_seconds numeric(12,2),
    severe_delay_count integer DEFAULT 0 NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE VIEW gold.public_stop_delay_daily AS
 SELECT sd.provider_id,
    sd.stop_id,
    ((sd.period_start_utc AT TIME ZONE dp.timezone))::date AS provider_local_date,
    (sum(sd.observation_count))::integer AS stop_time_observation_count,
    round((sum((COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds) *
    (NULLIF(sd.observation_count, 0))::numeric)) / (NULLIF(sum(sd.observation_count), 0))::numeric),
    2) AS avg_delay_seconds,
    (round(max(COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds))))::integer AS
    max_delay_seconds
   FROM (gold.stop_delay_hourly sd
     JOIN gold.dim_provider dp ON ((dp.provider_id = sd.provider_id)))
  GROUP BY sd.provider_id, sd.stop_id, (((sd.period_start_utc AT TIME ZONE dp.timezone))::date);
CREATE TABLE gold.realtime_serving_state (
    provider_id text NOT NULL,
    endpoint_key text NOT NULL,
    realtime_snapshot_id bigint,
    captured_at_utc timestamp with time zone,
    initialized_at_utc timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT realtime_serving_state_check CHECK (((realtime_snapshot_id IS NULL) =
    (captured_at_utc IS NULL))),
    CONSTRAINT realtime_serving_state_endpoint_key_check CHECK ((endpoint_key = ANY
    (ARRAY['trip_updates'::text, 'vehicle_positions'::text]))),
    CONSTRAINT realtime_serving_state_realtime_snapshot_id_check CHECK ((realtime_snapshot_id > 0))
);
COMMENT ON TABLE gold.realtime_serving_state IS
    'Accepted live identity survives empty caches and raw retention. NULL identity is unknown;
         initialized_at_utc is its fixed promotion cutoff, not a claim of prior serving.';
CREATE TABLE gold.repeat_offender (
    provider_id text NOT NULL,
    entity_kind text NOT NULL,
    entity_id text NOT NULL,
    route_id text NOT NULL,
    recurrence_days integer,
    window_days integer,
    avg_delay_seconds numeric,
    severity_label text,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.repeat_offender_daily_spine (
    provider_id text NOT NULL,
    entity_kind text NOT NULL,
    entity_id text NOT NULL,
    route_id text NOT NULL,
    provider_local_date date NOT NULL,
    observation_count integer DEFAULT 0 NOT NULL,
    severe_delay_count integer DEFAULT 0 NOT NULL,
    sum_delay_seconds bigint DEFAULT '0'::bigint NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.repeated_problem_route_stop (
    provider_id text NOT NULL,
    entity_kind text NOT NULL,
    entity_id text NOT NULL,
    route_id text NOT NULL,
    period_grain text NOT NULL,
    period_start_local date NOT NULL,
    issue_count integer DEFAULT 0 NOT NULL,
    avg_delay_seconds numeric(12,2),
    severity_label text,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.report_labels (
    label_key text NOT NULL,
    label_fr text NOT NULL,
    label_en text NOT NULL,
    label_combined text NOT NULL,
    sort_order integer NOT NULL
);
CREATE TABLE gold.route_cancellation_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    route_id text NOT NULL,
    total_trip_days integer NOT NULL,
    canceled_trip_days integer NOT NULL,
    cancellation_rate_pct numeric(5,2),
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    scheduled_trip_days integer,
    delivered_trip_days integer,
    silent_trip_days integer
);
CREATE TABLE gold.route_delay_by_crowding_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    route_id text NOT NULL,
    band text NOT NULL,
    delay_observation_count integer DEFAULT 0 NOT NULL,
    sum_delay_seconds numeric DEFAULT '0'::numeric NOT NULL,
    p50_delay_seconds numeric,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.route_delay_percentile_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    route_id text NOT NULL,
    delay_observation_count integer NOT NULL,
    p50_delay_seconds numeric(12,2),
    p90_delay_seconds numeric(12,2),
    built_at_utc timestamp with time zone NOT NULL
);
CREATE TABLE gold.route_delay_spine (
    provider_id text NOT NULL,
    route_id text NOT NULL,
    provider_local_date date NOT NULL,
    hour_of_day_local smallint NOT NULL,
    direction_id integer NOT NULL,
    observation_count integer DEFAULT 0 NOT NULL,
    delay_observation_count integer DEFAULT 0 NOT NULL,
    on_time_observation_count integer,
    severe_delay_count integer DEFAULT 0 NOT NULL,
    sum_delay_seconds bigint DEFAULT '0'::bigint NOT NULL,
    delay_histogram smallint[],
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    delayed_trip_count integer DEFAULT 0 NOT NULL
);
CREATE TABLE gold.route_headway_by_direction_shift (
    provider_id text NOT NULL,
    route_id text NOT NULL,
    direction_id integer NOT NULL,
    shift text NOT NULL,
    service_day_kind text NOT NULL,
    observed_headway_min numeric,
    sample_count integer DEFAULT 0 NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.route_headway_by_shift (
    provider_id text NOT NULL,
    route_id text NOT NULL,
    shift text NOT NULL,
    observed_headway_min numeric,
    sample_count integer,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    headway_cov numeric(6,4),
    bunched_count integer DEFAULT 0 NOT NULL
);
CREATE TABLE gold.route_headway_shift_daily (
    provider_id text NOT NULL,
    route_id text NOT NULL,
    provider_local_date date NOT NULL,
    shift text NOT NULL,
    direction_id integer NOT NULL,
    gap_count integer DEFAULT 0 NOT NULL,
    sum_gap_min numeric DEFAULT '0'::numeric NOT NULL,
    sum_gap_sq_min numeric DEFAULT '0'::numeric NOT NULL,
    bunched_gap_count integer DEFAULT 0 NOT NULL,
    trip_count integer DEFAULT 0 NOT NULL,
    gap_histogram smallint[],
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.route_occupancy_band_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    route_id text NOT NULL,
    observation_count integer DEFAULT 0 NOT NULL,
    empty_count integer DEFAULT 0 NOT NULL,
    many_seats_count integer DEFAULT 0 NOT NULL,
    few_seats_count integer DEFAULT 0 NOT NULL,
    standing_count integer DEFAULT 0 NOT NULL,
    full_count integer DEFAULT 0 NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.route_occupancy_band_hourly (
    provider_id text NOT NULL,
    route_id text NOT NULL,
    provider_local_date date NOT NULL,
    hour_of_day_local smallint NOT NULL,
    observation_count integer DEFAULT 0 NOT NULL,
    empty_count integer DEFAULT 0 NOT NULL,
    many_seats_count integer DEFAULT 0 NOT NULL,
    few_seats_count integer DEFAULT 0 NOT NULL,
    standing_count integer DEFAULT 0 NOT NULL,
    full_count integer DEFAULT 0 NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.route_scheduled_trips_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    route_id text NOT NULL,
    scheduled_trip_count integer DEFAULT 0 NOT NULL,
    dataset_version_id bigint NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.route_service_span_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    route_id text NOT NULL,
    first_trip_start_utc timestamp with time zone,
    last_trip_start_utc timestamp with time zone,
    service_span_min integer,
    first_trip_delay_seconds integer,
    last_trip_delay_seconds integer,
    trip_count integer DEFAULT 0 NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.route_skipped_stop_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    route_id text NOT NULL,
    stop_time_update_count bigint DEFAULT '0'::bigint NOT NULL,
    skipped_stop_count bigint DEFAULT '0'::bigint NOT NULL,
    skipped_stop_rate_pct numeric(5,2),
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.schedule_version_service_summary (
    provider_id text NOT NULL,
    dataset_version_id bigint NOT NULL,
    route_id text NOT NULL,
    day_type text NOT NULL,
    scheduled_trip_count integer DEFAULT 0 NOT NULL,
    stop_count integer DEFAULT 0 NOT NULL,
    first_departure_seconds integer,
    last_departure_seconds integer,
    span_minutes integer,
    calendar_start_date date,
    calendar_end_date date,
    service_added_exception_count integer DEFAULT 0 NOT NULL,
    service_removed_exception_count integer DEFAULT 0 NOT NULL,
    scheduled_median_headway_min integer,
    scheduled_p10_headway_min integer,
    scheduled_p90_headway_min integer,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_gold_schedule_version_service_summary_day_type CHECK ((day_type = ANY
    (ARRAY['weekday'::text, 'saturday'::text, 'sunday'::text])))
);
CREATE VIEW gold.source_lineage_reporting AS
 SELECT dv.provider_id,
    dv.dataset_kind,
    dv.dataset_version_id,
    fe.endpoint_key,
    dv.source_url,
    dv.storage_backend,
    dv.storage_path,
    dv.checksum_sha256,
    dv.byte_size,
    dv.loaded_at_utc,
    dv.effective_at_utc,
    dv.first_seen_at_utc,
    dv.last_seen_at_utc,
    dv.is_current
   FROM (core.dataset_versions dv
     JOIN core.feed_endpoints fe ON ((fe.feed_endpoint_id = dv.feed_endpoint_id)));
CREATE TABLE gold.stop_delay_percentile_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    stop_id text NOT NULL,
    delay_observation_count integer NOT NULL,
    p50_delay_seconds numeric(12,2),
    p90_delay_seconds numeric(12,2),
    built_at_utc timestamp with time zone NOT NULL
);
CREATE TABLE gold.stop_delay_shift_daily (
    provider_id text NOT NULL,
    stop_id text NOT NULL,
    route_id text NOT NULL,
    provider_local_date date NOT NULL,
    shift text NOT NULL,
    observation_count integer DEFAULT 0 NOT NULL,
    severe_delay_count integer DEFAULT 0 NOT NULL,
    sum_delay_seconds bigint DEFAULT '0'::bigint NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.stop_delay_spine (
    provider_id text NOT NULL,
    stop_id text NOT NULL,
    route_id text NOT NULL,
    provider_local_date date NOT NULL,
    observation_count integer DEFAULT 0 NOT NULL,
    severe_delay_count integer DEFAULT 0 NOT NULL,
    sum_delay_seconds bigint DEFAULT '0'::bigint NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.stop_occupancy_band_daily (
    provider_id text NOT NULL,
    provider_local_date date NOT NULL,
    stop_id text NOT NULL,
    observation_count integer DEFAULT 0 NOT NULL,
    empty_count integer DEFAULT 0 NOT NULL,
    many_seats_count integer DEFAULT 0 NOT NULL,
    few_seats_count integer DEFAULT 0 NOT NULL,
    standing_count integer DEFAULT 0 NOT NULL,
    full_count integer DEFAULT 0 NOT NULL,
    built_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE gold.trip_delay_summary_5m (
    provider_id text NOT NULL,
    period_start_utc timestamp with time zone NOT NULL,
    route_id text NOT NULL,
    trip_count integer NOT NULL,
    observation_count integer NOT NULL,
    delay_observation_count integer NOT NULL,
    avg_delay_seconds numeric(10,2),
    avg_delay_seconds_capped numeric(10,2),
    max_delay_seconds integer,
    min_delay_seconds integer,
    delayed_trip_count integer NOT NULL,
    outlier_count integer NOT NULL,
    built_at_utc timestamp with time zone NOT NULL,
    on_time_observation_count integer,
    max_delay_seconds_capped integer,
    severe_delay_observation_count integer DEFAULT 0 NOT NULL,
    usable_delay_sum_seconds bigint
);
CREATE TABLE gold.warm_rollup_periods (
    provider_id text NOT NULL,
    rollup_kind text NOT NULL,
    period_start_utc timestamp with time zone NOT NULL,
    built_at_utc timestamp with time zone NOT NULL,
    invalidated_at_utc timestamp with time zone
);
CREATE TABLE raw.alert_feed_observations (
    provider_id text NOT NULL,
    observation_date date NOT NULL,
    alert_count integer NOT NULL,
    observed_at_utc timestamp with time zone NOT NULL,
    CONSTRAINT ck_raw_alert_feed_observations_count CHECK ((alert_count >= 0))
);
CREATE TABLE raw.alert_language_observations (
    provider_id text NOT NULL,
    alert_logical_id text NOT NULL,
    observation_date date NOT NULL,
    has_explicit_fr boolean NOT NULL,
    has_explicit_en boolean NOT NULL,
    undetermined boolean NOT NULL,
    observed_at_utc timestamp with time zone NOT NULL,
    CONSTRAINT ck_raw_alert_language_observations_bucket CHECK ((undetermined = (NOT
    (has_explicit_fr OR has_explicit_en))))
);
CREATE TABLE raw.i3_alert_snapshots (
    i3_alert_snapshot_id bigint NOT NULL,
    provider_id text NOT NULL,
    feed_endpoint_id bigint NOT NULL,
    ingestion_run_id bigint NOT NULL,
    ingestion_object_id bigint,
    source_url text,
    http_status_code integer,
    captured_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    storage_backend text,
    storage_path text,
    checksum_sha256 text,
    byte_size bigint,
    api_version text,
    alert_count integer,
    raw_payload_json jsonb NOT NULL
);
ALTER TABLE raw.i3_alert_snapshots ALTER COLUMN i3_alert_snapshot_id ADD GENERATED BY DEFAULT AS
    IDENTITY (
    SEQUENCE NAME raw.i3_alert_snapshots_i3_alert_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE raw.ingestion_objects (
    ingestion_object_id bigint NOT NULL,
    ingestion_run_id bigint NOT NULL,
    provider_id text NOT NULL,
    object_kind text NOT NULL,
    storage_backend text NOT NULL,
    storage_path text NOT NULL,
    source_url text,
    checksum_sha256 text,
    byte_size bigint,
    created_at_utc timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_ingestion_objects_storage_backend CHECK ((storage_backend = ANY
    (ARRAY['local'::text, 's3'::text])))
);
ALTER TABLE raw.ingestion_objects ALTER COLUMN ingestion_object_id ADD GENERATED BY DEFAULT AS
    IDENTITY (
    SEQUENCE NAME raw.ingestion_objects_ingestion_object_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
ALTER TABLE raw.ingestion_runs ALTER COLUMN ingestion_run_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME raw.ingestion_runs_ingestion_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE raw.realtime_snapshot_index (
    realtime_snapshot_id bigint NOT NULL,
    ingestion_run_id bigint NOT NULL,
    ingestion_object_id bigint,
    provider_id text NOT NULL,
    feed_endpoint_id bigint NOT NULL,
    feed_timestamp_utc timestamp with time zone NOT NULL,
    entity_count integer,
    captured_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE raw.realtime_snapshot_index ALTER COLUMN realtime_snapshot_id ADD GENERATED BY DEFAULT
    AS IDENTITY (
    SEQUENCE NAME raw.realtime_snapshot_index_realtime_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE silver.agency (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    agency_id text NOT NULL,
    agency_name text NOT NULL,
    agency_url text NOT NULL,
    agency_timezone text NOT NULL,
    agency_lang text,
    agency_phone text,
    agency_fare_url text
);
CREATE TABLE silver.calendar (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    service_id text NOT NULL,
    monday boolean NOT NULL,
    tuesday boolean NOT NULL,
    wednesday boolean NOT NULL,
    thursday boolean NOT NULL,
    friday boolean NOT NULL,
    saturday boolean NOT NULL,
    sunday boolean NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL
);
CREATE TABLE silver.calendar_dates (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    service_id text NOT NULL,
    service_date date NOT NULL,
    exception_type integer NOT NULL
);
CREATE TABLE silver.directions (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    route_direction_id text NOT NULL,
    route_id text NOT NULL,
    direction_id integer NOT NULL,
    direction text NOT NULL,
    direction_legacy text NOT NULL
);
CREATE TABLE silver.feed_info (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    feed_publisher_name text NOT NULL,
    feed_publisher_url text NOT NULL,
    feed_lang text NOT NULL,
    feed_start_date date,
    feed_end_date date,
    feed_version text
);
CREATE TABLE silver.gis_datasets (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    source_url text,
    storage_backend text,
    storage_path text,
    checksum_sha256 text,
    byte_size bigint,
    source_crs_name text,
    source_crs_epsg integer,
    source_crs_wkt text,
    parser_version text,
    manifest_json jsonb,
    parsed_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE silver.gis_gtfs_matches (
    gis_dataset_version_id bigint NOT NULL,
    static_dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    feature_kind text NOT NULL,
    source_feature_id text NOT NULL,
    gtfs_id text NOT NULL,
    match_key text NOT NULL,
    match_status text NOT NULL,
    match_notes text,
    matched_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE silver.gis_line_features (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    source_feature_id text NOT NULL,
    route_id text,
    route_name text,
    headsign text,
    shape_id text,
    ct text,
    service_id text,
    source_attributes_json jsonb,
    source_geometry_wkb bytea NOT NULL,
    source_geometry_type text,
    source_crs_name text,
    source_crs_epsg integer,
    source_crs_wkt text,
    parsed_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE silver.gis_stop_features (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    source_feature_id text NOT NULL,
    stop_code text,
    stop_id text,
    stop_name text,
    stop_url text,
    wheelchair text,
    route_id text,
    loc_type text,
    shelter text,
    service_id text,
    source_attributes_json jsonb,
    source_geometry_wkb bytea NOT NULL,
    source_geometry_type text,
    source_crs_name text,
    source_crs_epsg integer,
    source_crs_wkt text,
    parsed_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE silver.gtfs_extra_rows (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    source_file_name text NOT NULL,
    source_row_number bigint NOT NULL,
    row_json jsonb NOT NULL,
    captured_at_utc timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE silver.gtfs_source_members (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    source_file_name text NOT NULL,
    member_path text NOT NULL,
    row_count bigint,
    checksum_sha256 text,
    byte_size bigint,
    first_seen_at_utc timestamp with time zone,
    last_seen_at_utc timestamp with time zone,
    manifest_json jsonb
);
CREATE TABLE silver.route_patterns (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    route_pattern_id text NOT NULL,
    route_id text NOT NULL,
    direction_id integer NOT NULL,
    route_pattern_typicality integer NOT NULL
);
CREATE TABLE silver.routes (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    route_id text NOT NULL,
    agency_id text,
    route_short_name text,
    route_long_name text,
    route_desc text,
    route_type integer NOT NULL,
    route_url text,
    route_color text,
    route_text_color text,
    route_sort_order integer,
    continuous_pickup integer,
    continuous_drop_off integer,
    network_id text,
    route_desc_detail text
);
CREATE TABLE silver.rt_entities (
    rt_feed_snapshot_id bigint NOT NULL,
    entity_index integer NOT NULL,
    provider_id text NOT NULL,
    entity_id text,
    entity_kind text NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    raw_entity_json jsonb
)
WITH (autovacuum_vacuum_scale_factor='0.01', autovacuum_vacuum_threshold='50000',
    autovacuum_analyze_scale_factor='0.02', autovacuum_analyze_threshold='50000');
ALTER TABLE silver.rt_feed_snapshots ALTER COLUMN rt_feed_snapshot_id ADD GENERATED BY DEFAULT AS
    IDENTITY (
    SEQUENCE NAME silver.rt_feed_snapshots_rt_feed_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE silver.rt_vehicle_positions (
    rt_feed_snapshot_id bigint NOT NULL,
    entity_index integer NOT NULL,
    provider_id text NOT NULL,
    vehicle_id text,
    trip_id text,
    route_id text,
    direction_id integer,
    start_time text,
    start_date date,
    latitude double precision,
    longitude double precision,
    bearing double precision,
    speed double precision,
    stop_id text,
    current_stop_sequence integer,
    current_status integer,
    occupancy_status integer,
    congestion_level integer,
    vehicle_timestamp_utc timestamp with time zone,
    position_quality text,
    feed_timestamp_utc timestamp with time zone,
    captured_at_utc timestamp with time zone NOT NULL
)
WITH (autovacuum_vacuum_scale_factor='0.01', autovacuum_vacuum_threshold='50000',
    autovacuum_analyze_scale_factor='0.02', autovacuum_analyze_threshold='50000');
CREATE TABLE silver.stops (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    stop_id text NOT NULL,
    stop_code text,
    stop_name text,
    stop_desc text,
    stop_lat double precision,
    stop_lon double precision,
    zone_id text,
    stop_url text,
    location_type integer,
    parent_station text,
    stop_timezone text,
    wheelchair_boarding integer,
    platform_code text
);
CREATE TABLE silver.translations (
    dataset_version_id bigint NOT NULL,
    provider_id text NOT NULL,
    translation_row_number integer NOT NULL,
    table_name text NOT NULL,
    field_name text NOT NULL,
    language text NOT NULL,
    record_id text NOT NULL,
    translation text NOT NULL
);
ALTER TABLE ONLY core.dataset_versions
    ADD CONSTRAINT dataset_versions_pkey PRIMARY KEY (dataset_version_id);
ALTER TABLE ONLY core.feed_endpoints
    ADD CONSTRAINT feed_endpoints_pkey PRIMARY KEY (feed_endpoint_id);
ALTER TABLE ONLY core.alert_language_coverage_samples
    ADD CONSTRAINT pk_core_alert_language_coverage_samples PRIMARY KEY (provider_id,
    measurement_date, window_days);
ALTER TABLE ONLY core.snapshot_historic_gc_marks
    ADD CONSTRAINT pk_core_snapshot_historic_gc_marks PRIMARY KEY (provider_id, object_key);
ALTER TABLE ONLY core.snapshot_historic_receipts
    ADD CONSTRAINT pk_core_snapshot_historic_receipts PRIMARY KEY (provider_id, family, entity_key);
ALTER TABLE ONLY core.snapshot_publish_state
    ADD CONSTRAINT pk_core_snapshot_publish_state PRIMARY KEY (provider_id, tier);
ALTER TABLE ONLY core.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (provider_id);
ALTER TABLE ONLY core.providers
    ADD CONSTRAINT uq_core_providers_provider_key UNIQUE (provider_key);
ALTER TABLE ONLY core.feed_endpoints
    ADD CONSTRAINT uq_feed_endpoints_provider_endpoint_key UNIQUE (provider_id, endpoint_key);
ALTER TABLE gold.route_delay_hourly
    ADD CONSTRAINT ck_route_delay_hourly_usable_count CHECK (((usable_delay_observation_count IS
    NULL) OR ((usable_delay_observation_count >= 0) AND (usable_delay_observation_count <=
    delay_observation_count)))) NOT VALID;
ALTER TABLE gold.route_delay_hourly
    ADD CONSTRAINT ck_route_delay_hourly_usable_sum CHECK (((usable_delay_sum_seconds IS NULL) OR
    ((usable_delay_observation_count IS NOT NULL) AND (((usable_delay_sum_seconds)::numeric >= ((-
    (3600)::numeric) * (usable_delay_observation_count)::numeric)) AND
    ((usable_delay_sum_seconds)::numeric <= ((3600)::numeric *
    (usable_delay_observation_count)::numeric)))))) NOT VALID;
ALTER TABLE gold.trip_delay_summary_5m
    ADD CONSTRAINT ck_trip_delay_5m_usable_sum CHECK (((usable_delay_sum_seconds IS NULL) OR
    ((delay_observation_count >= outlier_count) AND (((usable_delay_sum_seconds)::numeric >= ((-
    (3600)::numeric) * ((delay_observation_count - outlier_count))::numeric)) AND
    ((usable_delay_sum_seconds)::numeric <= ((3600)::numeric * ((delay_observation_count -
    outlier_count))::numeric)))))) NOT VALID;
ALTER TABLE ONLY gold.alert_archive_entry
    ADD CONSTRAINT pk_gold_alert_archive_entry PRIMARY KEY (provider_id, alert_id);
ALTER TABLE ONLY gold.citizen_accountability_daily
    ADD CONSTRAINT pk_gold_citizen_accountability_daily PRIMARY KEY (provider_id,
    provider_local_date);
ALTER TABLE ONLY gold.dim_date
    ADD CONSTRAINT pk_gold_dim_date PRIMARY KEY (provider_id, service_date);
ALTER TABLE ONLY gold.dim_route
    ADD CONSTRAINT pk_gold_dim_route PRIMARY KEY (provider_id, route_id);
ALTER TABLE ONLY gold.dim_route_history
    ADD CONSTRAINT pk_gold_dim_route_history PRIMARY KEY (provider_id, route_id, valid_from_utc);
ALTER TABLE ONLY gold.dim_route_pattern
    ADD CONSTRAINT pk_gold_dim_route_pattern PRIMARY KEY (provider_id, route_pattern_id);
ALTER TABLE ONLY gold.dim_stop
    ADD CONSTRAINT pk_gold_dim_stop PRIMARY KEY (provider_id, stop_id);
ALTER TABLE ONLY gold.dim_stop_history
    ADD CONSTRAINT pk_gold_dim_stop_history PRIMARY KEY (provider_id, stop_id, valid_from_utc);
ALTER TABLE ONLY gold.fact_trip_delay_snapshot
    ADD CONSTRAINT pk_gold_fact_trip_delay_snapshot PRIMARY KEY (provider_id, realtime_snapshot_id,
    entity_index);
ALTER TABLE ONLY gold.fact_vehicle_snapshot
    ADD CONSTRAINT pk_gold_fact_vehicle_snapshot PRIMARY KEY (provider_id, realtime_snapshot_id,
    entity_index);
ALTER TABLE ONLY gold.latest_trip_delay_snapshot
    ADD CONSTRAINT pk_gold_latest_trip_delay_snapshot PRIMARY KEY (provider_id,
    realtime_snapshot_id, entity_index);
ALTER TABLE ONLY gold.latest_vehicle_snapshot
    ADD CONSTRAINT pk_gold_latest_vehicle_snapshot PRIMARY KEY (provider_id, realtime_snapshot_id,
    entity_index);
ALTER TABLE ONLY gold.repeat_offender
    ADD CONSTRAINT pk_gold_repeat_offender PRIMARY KEY (provider_id, entity_kind, entity_id,
    route_id);
ALTER TABLE ONLY gold.repeat_offender_daily_spine
    ADD CONSTRAINT pk_gold_repeat_offender_daily_spine PRIMARY KEY (provider_id, entity_kind,
    entity_id, route_id, provider_local_date);
ALTER TABLE ONLY gold.repeated_problem_route_stop
    ADD CONSTRAINT pk_gold_repeated_problem_route_stop PRIMARY KEY (provider_id, entity_kind,
    entity_id, route_id, period_grain, period_start_local);
ALTER TABLE ONLY gold.report_labels
    ADD CONSTRAINT pk_gold_report_labels PRIMARY KEY (label_key);
ALTER TABLE ONLY gold.route_cancellation_daily
    ADD CONSTRAINT pk_gold_route_cancellation_daily PRIMARY KEY (provider_id, provider_local_date,
    route_id);
ALTER TABLE ONLY gold.route_delay_by_crowding_daily
    ADD CONSTRAINT pk_gold_route_delay_by_crowding_daily PRIMARY KEY (provider_id,
    provider_local_date, route_id, band);
ALTER TABLE ONLY gold.route_delay_hourly
    ADD CONSTRAINT pk_gold_route_delay_hourly PRIMARY KEY (provider_id, period_start_utc, route_id);
ALTER TABLE ONLY gold.route_delay_percentile_daily
    ADD CONSTRAINT pk_gold_route_delay_percentile_daily PRIMARY KEY (provider_id,
    provider_local_date, route_id);
ALTER TABLE ONLY gold.route_delay_spine
    ADD CONSTRAINT pk_gold_route_delay_spine PRIMARY KEY (provider_id, route_id,
    provider_local_date, hour_of_day_local, direction_id);
ALTER TABLE ONLY gold.route_headway_by_direction_shift
    ADD CONSTRAINT pk_gold_route_headway_by_direction_shift PRIMARY KEY (provider_id, route_id,
    direction_id, shift, service_day_kind);
ALTER TABLE ONLY gold.route_headway_by_shift
    ADD CONSTRAINT pk_gold_route_headway_by_shift PRIMARY KEY (provider_id, route_id, shift);
ALTER TABLE ONLY gold.route_headway_shift_daily
    ADD CONSTRAINT pk_gold_route_headway_shift_daily PRIMARY KEY (provider_id, route_id,
    provider_local_date, shift, direction_id);
ALTER TABLE ONLY gold.route_occupancy_band_daily
    ADD CONSTRAINT pk_gold_route_occupancy_band_daily PRIMARY KEY (provider_id, provider_local_date,
    route_id);
ALTER TABLE ONLY gold.route_occupancy_band_hourly
    ADD CONSTRAINT pk_gold_route_occupancy_band_hourly PRIMARY KEY (provider_id, route_id,
    provider_local_date, hour_of_day_local);
ALTER TABLE ONLY gold.route_scheduled_trips_daily
    ADD CONSTRAINT pk_gold_route_scheduled_trips_daily PRIMARY KEY (provider_id,
    provider_local_date, route_id);
ALTER TABLE ONLY gold.route_service_span_daily
    ADD CONSTRAINT pk_gold_route_service_span_daily PRIMARY KEY (provider_id, provider_local_date,
    route_id);
ALTER TABLE ONLY gold.route_skipped_stop_daily
    ADD CONSTRAINT pk_gold_route_skipped_stop_daily PRIMARY KEY (provider_id, provider_local_date,
    route_id);
ALTER TABLE ONLY gold.schedule_version_service_summary
    ADD CONSTRAINT pk_gold_schedule_version_service_summary PRIMARY KEY (provider_id,
    dataset_version_id, route_id, day_type);
ALTER TABLE ONLY gold.stop_delay_hourly
    ADD CONSTRAINT pk_gold_stop_delay_hourly PRIMARY KEY (provider_id, period_start_utc, stop_id,
    route_id);
ALTER TABLE ONLY gold.stop_delay_percentile_daily
    ADD CONSTRAINT pk_gold_stop_delay_percentile_daily PRIMARY KEY (provider_id,
    provider_local_date, stop_id);
ALTER TABLE ONLY gold.stop_delay_shift_daily
    ADD CONSTRAINT pk_gold_stop_delay_shift_daily PRIMARY KEY (provider_id, stop_id, route_id,
    provider_local_date, shift);
ALTER TABLE ONLY gold.stop_delay_spine
    ADD CONSTRAINT pk_gold_stop_delay_spine PRIMARY KEY (provider_id, stop_id, route_id,
    provider_local_date);
ALTER TABLE ONLY gold.stop_occupancy_band_daily
    ADD CONSTRAINT pk_gold_stop_occupancy_band_daily PRIMARY KEY (provider_id, provider_local_date,
    stop_id);
ALTER TABLE ONLY gold.trip_delay_summary_5m
    ADD CONSTRAINT pk_gold_trip_delay_summary_5m PRIMARY KEY (provider_id, period_start_utc,
    route_id);
ALTER TABLE ONLY gold.warm_rollup_periods
    ADD CONSTRAINT pk_gold_warm_rollup_periods PRIMARY KEY (provider_id, rollup_kind,
    period_start_utc);
ALTER TABLE ONLY gold.realtime_serving_state
    ADD CONSTRAINT realtime_serving_state_pkey PRIMARY KEY (provider_id, endpoint_key);
ALTER TABLE ONLY raw.i3_alert_snapshots
    ADD CONSTRAINT i3_alert_snapshots_pkey PRIMARY KEY (i3_alert_snapshot_id);
ALTER TABLE ONLY raw.ingestion_objects
    ADD CONSTRAINT ingestion_objects_pkey PRIMARY KEY (ingestion_object_id);
ALTER TABLE ONLY raw.ingestion_runs
    ADD CONSTRAINT ingestion_runs_pkey PRIMARY KEY (ingestion_run_id);
ALTER TABLE ONLY raw.alert_feed_observations
    ADD CONSTRAINT pk_raw_alert_feed_observations PRIMARY KEY (provider_id, observation_date);
ALTER TABLE ONLY raw.alert_language_observations
    ADD CONSTRAINT pk_raw_alert_language_observations PRIMARY KEY (provider_id, alert_logical_id,
    observation_date);
ALTER TABLE ONLY raw.realtime_snapshot_index
    ADD CONSTRAINT realtime_snapshot_index_pkey PRIMARY KEY (realtime_snapshot_id);
ALTER TABLE ONLY raw.ingestion_objects
    ADD CONSTRAINT uq_ingestion_objects_storage UNIQUE (storage_backend, storage_path);
ALTER TABLE ONLY raw.i3_alert_snapshots
    ADD CONSTRAINT uq_raw_i3_alert_snapshots_ingestion_run UNIQUE (ingestion_run_id);
ALTER TABLE ONLY raw.realtime_snapshot_index
    ADD CONSTRAINT uq_realtime_snapshot_index_ingestion_run_id UNIQUE (ingestion_run_id);
ALTER TABLE ONLY silver.agency
    ADD CONSTRAINT pk_silver_agency PRIMARY KEY (dataset_version_id, agency_id);
ALTER TABLE ONLY silver.calendar
    ADD CONSTRAINT pk_silver_calendar PRIMARY KEY (dataset_version_id, service_id);
ALTER TABLE ONLY silver.calendar_dates
    ADD CONSTRAINT pk_silver_calendar_dates PRIMARY KEY (dataset_version_id, service_id,
    service_date);
ALTER TABLE ONLY silver.directions
    ADD CONSTRAINT pk_silver_directions PRIMARY KEY (dataset_version_id, route_direction_id);
ALTER TABLE ONLY silver.feed_info
    ADD CONSTRAINT pk_silver_feed_info PRIMARY KEY (dataset_version_id);
ALTER TABLE ONLY silver.gis_datasets
    ADD CONSTRAINT pk_silver_gis_datasets PRIMARY KEY (dataset_version_id);
ALTER TABLE ONLY silver.gis_gtfs_matches
    ADD CONSTRAINT pk_silver_gis_gtfs_matches PRIMARY KEY (gis_dataset_version_id,
    static_dataset_version_id, feature_kind, source_feature_id, gtfs_id);
ALTER TABLE ONLY silver.gis_line_features
    ADD CONSTRAINT pk_silver_gis_line_features PRIMARY KEY (dataset_version_id, source_feature_id);
ALTER TABLE ONLY silver.gis_stop_features
    ADD CONSTRAINT pk_silver_gis_stop_features PRIMARY KEY (dataset_version_id, source_feature_id);
ALTER TABLE ONLY silver.gtfs_extra_rows
    ADD CONSTRAINT pk_silver_gtfs_extra_rows PRIMARY KEY (dataset_version_id, source_file_name,
    source_row_number);
ALTER TABLE ONLY silver.gtfs_source_members
    ADD CONSTRAINT pk_silver_gtfs_source_members PRIMARY KEY (dataset_version_id, source_file_name,
    member_path);
ALTER TABLE ONLY silver.i3_alert_active_periods
    ADD CONSTRAINT pk_silver_i3_alert_active_periods PRIMARY KEY (i3_alert_snapshot_id, alert_index,
    period_index);
ALTER TABLE ONLY silver.i3_alert_informed_entities
    ADD CONSTRAINT pk_silver_i3_alert_informed_entities PRIMARY KEY (i3_alert_snapshot_id,
    alert_index, entity_index);
ALTER TABLE ONLY silver.i3_alerts
    ADD CONSTRAINT pk_silver_i3_alerts PRIMARY KEY (i3_alert_snapshot_id, alert_index);
ALTER TABLE ONLY silver.route_patterns
    ADD CONSTRAINT pk_silver_route_patterns PRIMARY KEY (dataset_version_id, route_pattern_id);
ALTER TABLE ONLY silver.routes
    ADD CONSTRAINT pk_silver_routes PRIMARY KEY (dataset_version_id, route_id);
ALTER TABLE ONLY silver.rt_entities
    ADD CONSTRAINT pk_silver_rt_entities PRIMARY KEY (rt_feed_snapshot_id, entity_index);
ALTER TABLE ONLY silver.rt_trip_update_stop_times
    ADD CONSTRAINT pk_silver_rt_trip_update_stop_times PRIMARY KEY (rt_feed_snapshot_id,
    entity_index, stop_time_update_index);
ALTER TABLE ONLY silver.rt_trip_updates
    ADD CONSTRAINT pk_silver_rt_trip_updates PRIMARY KEY (rt_feed_snapshot_id, entity_index);
ALTER TABLE ONLY silver.rt_vehicle_positions
    ADD CONSTRAINT pk_silver_rt_vehicle_positions PRIMARY KEY (rt_feed_snapshot_id, entity_index);
ALTER TABLE ONLY silver.shapes
    ADD CONSTRAINT pk_silver_shapes PRIMARY KEY (dataset_version_id, shape_id, shape_pt_sequence);
ALTER TABLE ONLY silver.stop_times
    ADD CONSTRAINT pk_silver_stop_times PRIMARY KEY (dataset_version_id, trip_id, stop_sequence);
ALTER TABLE ONLY silver.stops
    ADD CONSTRAINT pk_silver_stops PRIMARY KEY (dataset_version_id, stop_id);
ALTER TABLE ONLY silver.translations
    ADD CONSTRAINT pk_silver_translations PRIMARY KEY (dataset_version_id, translation_row_number);
ALTER TABLE ONLY silver.trips
    ADD CONSTRAINT pk_silver_trips PRIMARY KEY (dataset_version_id, trip_id);
ALTER TABLE ONLY silver.rt_feed_snapshots
    ADD CONSTRAINT rt_feed_snapshots_pkey PRIMARY KEY (rt_feed_snapshot_id);
ALTER TABLE ONLY silver.rt_feed_snapshots
    ADD CONSTRAINT uq_silver_rt_feed_snapshots_ingestion_run UNIQUE (ingestion_run_id);
CREATE INDEX ix_core_alert_language_coverage_samples_measured ON
    core.alert_language_coverage_samples USING btree (measurement_date, provider_id);
CREATE INDEX ix_dataset_versions_provider_endpoint_loaded ON core.dataset_versions USING btree
    (provider_id, feed_endpoint_id, loaded_at_utc);
CREATE INDEX ix_snapshot_historic_receipts_retention ON core.snapshot_historic_receipts USING btree
    (provider_id, family, last_scope_end);
CREATE INDEX ix_gold_alert_archive_entry_provider_month_start ON gold.alert_archive_entry USING
    btree (provider_id, archive_month DESC, start_utc DESC, alert_id);
CREATE INDEX ix_gold_dim_date_provider_date_key ON gold.dim_date USING btree (provider_id,
    date_key);
CREATE INDEX ix_gold_dim_route_pattern_provider_route_direction ON gold.dim_route_pattern USING
    btree (provider_id, route_id, direction_id);
CREATE INDEX ix_gold_dim_route_provider_short_name ON gold.dim_route USING btree (provider_id,
    route_short_name);
CREATE INDEX ix_gold_dim_stop_provider_name ON gold.dim_stop USING btree (provider_id, stop_name);
CREATE INDEX ix_gold_fact_trip_delay_snapshot_provider_captured_at ON gold.fact_trip_delay_snapshot
    USING btree (provider_id, captured_at_utc);
CREATE INDEX ix_gold_fact_trip_delay_snapshot_provider_date_key ON gold.fact_trip_delay_snapshot
    USING btree (provider_id, snapshot_date_key);
CREATE INDEX ix_gold_fact_trip_delay_snapshot_provider_route ON gold.fact_trip_delay_snapshot USING
    btree (provider_id, route_id);
CREATE INDEX ix_gold_fact_vehicle_snapshot_provider_captured_at ON gold.fact_vehicle_snapshot USING
    btree (provider_id, captured_at_utc);
CREATE INDEX ix_gold_fact_vehicle_snapshot_provider_date_key ON gold.fact_vehicle_snapshot USING
    btree (provider_id, snapshot_date_key);
CREATE INDEX ix_gold_fact_vehicle_snapshot_provider_route ON gold.fact_vehicle_snapshot USING btree
    (provider_id, route_id);
CREATE INDEX ix_gold_ftds_realtime_snapshot_id ON gold.fact_trip_delay_snapshot USING btree
    (realtime_snapshot_id);
CREATE INDEX ix_gold_fvs_realtime_snapshot_id ON gold.fact_vehicle_snapshot USING btree
    (realtime_snapshot_id);
CREATE INDEX ix_gold_latest_trip_delay_snapshot_provider_date_key ON gold.latest_trip_delay_snapshot
    USING btree (provider_id, snapshot_date_key);
CREATE INDEX ix_gold_latest_trip_delay_snapshot_provider_route ON gold.latest_trip_delay_snapshot
    USING btree (provider_id, route_id);
CREATE INDEX ix_gold_latest_vehicle_snapshot_provider_date_key ON gold.latest_vehicle_snapshot USING
    btree (provider_id, snapshot_date_key);
CREATE INDEX ix_gold_latest_vehicle_snapshot_provider_route ON gold.latest_vehicle_snapshot USING
    btree (provider_id, route_id);
CREATE INDEX ix_gold_repeat_offender_daily_spine_provider_date ON gold.repeat_offender_daily_spine
    USING btree (provider_id, provider_local_date);
CREATE INDEX ix_gold_repeat_offender_route ON gold.repeat_offender USING btree (provider_id,
    route_id);
CREATE INDEX ix_gold_route_cancellation_daily_provider_route_date ON gold.route_cancellation_daily
    USING btree (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_route_delay_by_crowding_daily_provider_route_date ON
    gold.route_delay_by_crowding_daily USING btree (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_route_delay_percentile_daily_provider_entity_date ON
    gold.route_delay_percentile_daily USING btree (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_route_delay_spine_provider_route_date ON gold.route_delay_spine USING btree
    (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_route_headway_by_direction_shift_provider_route ON
    gold.route_headway_by_direction_shift USING btree (provider_id, route_id);
CREATE INDEX ix_gold_route_headway_shift_daily_provider_route_date ON gold.route_headway_shift_daily
    USING btree (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_route_occupancy_band_daily_provider_entity_date ON
    gold.route_occupancy_band_daily USING btree (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_route_occupancy_band_hourly_provider_route_date ON
    gold.route_occupancy_band_hourly USING btree (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_route_service_span_daily_provider_route_date ON gold.route_service_span_daily
    USING btree (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_route_skipped_stop_daily_provider_route_date ON gold.route_skipped_stop_daily
    USING btree (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_schedule_version_service_summary_provider_route ON
    gold.schedule_version_service_summary USING btree (provider_id, route_id, dataset_version_id);
CREATE INDEX ix_gold_stop_delay_percentile_daily_provider_entity_date ON
    gold.stop_delay_percentile_daily USING btree (provider_id, stop_id, provider_local_date);
CREATE INDEX ix_gold_stop_delay_shift_daily_provider_stop_date ON gold.stop_delay_shift_daily USING
    btree (provider_id, stop_id, provider_local_date);
CREATE INDEX ix_gold_stop_delay_spine_provider_route_date ON gold.stop_delay_spine USING btree
    (provider_id, route_id, provider_local_date);
CREATE INDEX ix_gold_trip_delay_summary_5m_provider_period ON gold.trip_delay_summary_5m USING btree
    (provider_id, period_start_utc);
CREATE INDEX ix_gold_trip_delay_summary_5m_provider_route_period ON gold.trip_delay_summary_5m USING
    btree (provider_id, route_id, period_start_utc);
CREATE UNIQUE INDEX uq_gold_dim_route_history_open ON gold.dim_route_history USING btree
    (provider_id, route_id) WHERE (valid_to_utc IS NULL);
CREATE UNIQUE INDEX uq_gold_dim_stop_history_open ON gold.dim_stop_history USING btree (provider_id,
    stop_id) WHERE (valid_to_utc IS NULL);
CREATE INDEX ix_ingestion_objects_ingestion_run_id ON raw.ingestion_objects USING btree
    (ingestion_run_id);
CREATE INDEX ix_ingestion_runs_provider_endpoint_started ON raw.ingestion_runs USING btree
    (provider_id, feed_endpoint_id, started_at_utc);
CREATE INDEX ix_raw_alert_language_observations_window ON raw.alert_language_observations USING
    btree (provider_id, observation_date);
CREATE INDEX ix_raw_i3_alert_snapshots_provider_captured ON raw.i3_alert_snapshots USING btree
    (provider_id, captured_at_utc);
CREATE INDEX ix_raw_rsi_ingestion_object_id ON raw.realtime_snapshot_index USING btree
    (ingestion_object_id);
CREATE INDEX ix_realtime_snapshot_provider_captured_at ON raw.realtime_snapshot_index USING btree
    (provider_id, captured_at_utc);
CREATE INDEX ix_realtime_snapshot_provider_endpoint_feed_ts ON raw.realtime_snapshot_index USING
    btree (provider_id, feed_endpoint_id, feed_timestamp_utc);
CREATE INDEX ix_silver_calendar_dates_dataset_service_date ON silver.calendar_dates USING btree
    (dataset_version_id, service_date);
CREATE INDEX ix_silver_directions_dataset_route_direction ON silver.directions USING btree
    (dataset_version_id, route_id, direction_id);
CREATE INDEX ix_silver_gis_datasets_provider ON silver.gis_datasets USING btree (provider_id,
    dataset_version_id);
CREATE INDEX ix_silver_gis_gtfs_matches_provider_gtfs ON silver.gis_gtfs_matches USING btree
    (provider_id, feature_kind, gtfs_id);
CREATE INDEX ix_silver_gis_line_features_provider_route ON silver.gis_line_features USING btree
    (provider_id, route_id);
CREATE INDEX ix_silver_gis_stop_features_provider_stop ON silver.gis_stop_features USING btree
    (provider_id, stop_id);
CREATE INDEX ix_silver_gtfs_extra_rows_provider_file ON silver.gtfs_extra_rows USING btree
    (provider_id, source_file_name);
CREATE INDEX ix_silver_gtfs_source_members_provider_file ON silver.gtfs_source_members USING btree
    (provider_id, source_file_name);
CREATE INDEX ix_silver_i3_alert_active_periods_alert ON silver.i3_alert_active_periods USING btree
    (i3_alert_snapshot_id, alert_index);
CREATE INDEX ix_silver_i3_alert_entities_provider_route_stop ON silver.i3_alert_informed_entities
    USING btree (provider_id, route_id, stop_id);
CREATE INDEX ix_silver_i3_alerts_provider_active ON silver.i3_alerts USING btree (provider_id,
    active_period_start_utc, active_period_end_utc);
CREATE INDEX ix_silver_i3_alerts_provider_alert ON silver.i3_alerts USING btree (provider_id,
    alert_id);
CREATE INDEX ix_silver_route_patterns_dataset_route_direction ON silver.route_patterns USING btree
    (dataset_version_id, route_id, direction_id);
CREATE INDEX ix_silver_routes_provider_route ON silver.routes USING btree (provider_id, route_id);
CREATE INDEX ix_silver_rt_entities_provider_entity ON silver.rt_entities USING btree (provider_id,
    entity_id);
CREATE INDEX ix_silver_rt_feed_snapshots_provider_endpoint_captured ON silver.rt_feed_snapshots
    USING btree (provider_id, feed_endpoint_id, captured_at_utc);
CREATE INDEX ix_silver_rt_feed_snapshots_source_realtime_snapshot_id ON silver.rt_feed_snapshots
    USING btree (source_realtime_snapshot_id);
CREATE INDEX ix_silver_rt_trip_update_stop_times_provider_stop ON silver.rt_trip_update_stop_times
    USING btree (provider_id, stop_id);
CREATE INDEX ix_silver_rt_trip_updates_provider_route ON silver.rt_trip_updates USING btree
    (provider_id, route_id);
CREATE INDEX ix_silver_rt_trip_updates_provider_trip ON silver.rt_trip_updates USING btree
    (provider_id, trip_id);
CREATE INDEX ix_silver_rt_vehicle_positions_provider_trip ON silver.rt_vehicle_positions USING btree
    (provider_id, trip_id);
CREATE INDEX ix_silver_rt_vehicle_positions_provider_vehicle ON silver.rt_vehicle_positions USING
    btree (provider_id, vehicle_id);
CREATE INDEX ix_silver_shapes_dataset_route_pattern ON silver.shapes USING btree
    (dataset_version_id, route_pattern_id);
CREATE INDEX ix_silver_stop_times_dataset_stop_sequence ON silver.stop_times USING btree
    (dataset_version_id, stop_id, stop_sequence);
CREATE INDEX ix_silver_stops_provider_stop ON silver.stops USING btree (provider_id, stop_id);
CREATE INDEX ix_silver_translations_dataset_lookup ON silver.translations USING btree
    (dataset_version_id, table_name, field_name, record_id, language);
CREATE INDEX ix_silver_trips_dataset_route ON silver.trips USING btree (dataset_version_id,
    route_id);
CREATE INDEX ix_silver_trips_provider_trip ON silver.trips USING btree (provider_id, trip_id);
CREATE UNIQUE INDEX ux_silver_i3_alerts_active_content_hash ON silver.i3_alerts USING btree
    (provider_id, content_hash) WHERE ((content_hash IS NOT NULL) AND (valid_to IS NULL));
ALTER TABLE ONLY core.dataset_versions
    ADD CONSTRAINT dataset_versions_feed_endpoint_id_fkey FOREIGN KEY (feed_endpoint_id) REFERENCES
    core.feed_endpoints(feed_endpoint_id);
ALTER TABLE ONLY core.dataset_versions
    ADD CONSTRAINT dataset_versions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY core.dataset_versions
    ADD CONSTRAINT dataset_versions_source_ingestion_object_id_fkey FOREIGN KEY
    (source_ingestion_object_id) REFERENCES raw.ingestion_objects(ingestion_object_id);
ALTER TABLE ONLY core.dataset_versions
    ADD CONSTRAINT dataset_versions_source_ingestion_run_id_fkey FOREIGN KEY
    (source_ingestion_run_id) REFERENCES raw.ingestion_runs(ingestion_run_id);
ALTER TABLE ONLY core.feed_endpoints
    ADD CONSTRAINT feed_endpoints_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY core.alert_language_coverage_samples
    ADD CONSTRAINT fk_core_alert_language_coverage_samples_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY core.snapshot_historic_gc_marks
    ADD CONSTRAINT fk_core_snapshot_historic_gc_marks_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY core.snapshot_historic_receipts
    ADD CONSTRAINT fk_core_snapshot_historic_receipts_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY core.snapshot_publish_state
    ADD CONSTRAINT fk_core_snapshot_publish_state_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.alert_archive_entry
    ADD CONSTRAINT fk_gold_alert_archive_entry_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.citizen_accountability_daily
    ADD CONSTRAINT fk_gold_citizen_accountability_daily_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.dim_date
    ADD CONSTRAINT fk_gold_dim_date_dataset_version_id FOREIGN KEY (dataset_version_id) REFERENCES
    core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY gold.dim_date
    ADD CONSTRAINT fk_gold_dim_date_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.dim_route
    ADD CONSTRAINT fk_gold_dim_route_dataset_version_id FOREIGN KEY (dataset_version_id) REFERENCES
    core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY gold.dim_route_history
    ADD CONSTRAINT fk_gold_dim_route_history_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.dim_route_pattern
    ADD CONSTRAINT fk_gold_dim_route_pattern_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY gold.dim_route_pattern
    ADD CONSTRAINT fk_gold_dim_route_pattern_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.dim_route
    ADD CONSTRAINT fk_gold_dim_route_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.dim_stop
    ADD CONSTRAINT fk_gold_dim_stop_dataset_version_id FOREIGN KEY (dataset_version_id) REFERENCES
    core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY gold.dim_stop_history
    ADD CONSTRAINT fk_gold_dim_stop_history_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.dim_stop
    ADD CONSTRAINT fk_gold_dim_stop_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.fact_trip_delay_snapshot
    ADD CONSTRAINT fk_gold_fact_trip_delay_snapshot_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.fact_trip_delay_snapshot
    ADD CONSTRAINT fk_gold_fact_trip_delay_snapshot_snapshot_id FOREIGN KEY (realtime_snapshot_id)
    REFERENCES raw.realtime_snapshot_index(realtime_snapshot_id);
ALTER TABLE ONLY gold.fact_vehicle_snapshot
    ADD CONSTRAINT fk_gold_fact_vehicle_snapshot_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.fact_vehicle_snapshot
    ADD CONSTRAINT fk_gold_fact_vehicle_snapshot_snapshot_id FOREIGN KEY (realtime_snapshot_id)
    REFERENCES raw.realtime_snapshot_index(realtime_snapshot_id);
ALTER TABLE ONLY gold.latest_trip_delay_snapshot
    ADD CONSTRAINT fk_gold_latest_trip_delay_snapshot_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.latest_trip_delay_snapshot
    ADD CONSTRAINT fk_gold_latest_trip_delay_snapshot_snapshot_id FOREIGN KEY (realtime_snapshot_id)
    REFERENCES raw.realtime_snapshot_index(realtime_snapshot_id);
ALTER TABLE ONLY gold.latest_vehicle_snapshot
    ADD CONSTRAINT fk_gold_latest_vehicle_snapshot_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.latest_vehicle_snapshot
    ADD CONSTRAINT fk_gold_latest_vehicle_snapshot_snapshot_id FOREIGN KEY (realtime_snapshot_id)
    REFERENCES raw.realtime_snapshot_index(realtime_snapshot_id);
ALTER TABLE ONLY gold.repeat_offender_daily_spine
    ADD CONSTRAINT fk_gold_repeat_offender_daily_spine_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.repeat_offender
    ADD CONSTRAINT fk_gold_repeat_offender_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.repeated_problem_route_stop
    ADD CONSTRAINT fk_gold_repeated_problem_route_stop_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.route_cancellation_daily
    ADD CONSTRAINT fk_gold_route_cancellation_daily_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.route_delay_by_crowding_daily
    ADD CONSTRAINT fk_gold_route_delay_by_crowding_daily_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.route_delay_hourly
    ADD CONSTRAINT fk_gold_route_delay_hourly_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.route_delay_percentile_daily
    ADD CONSTRAINT fk_gold_route_delay_percentile_daily_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.route_delay_spine
    ADD CONSTRAINT fk_gold_route_delay_spine_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.route_headway_by_direction_shift
    ADD CONSTRAINT fk_gold_route_headway_by_direction_shift_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.route_headway_by_shift
    ADD CONSTRAINT fk_gold_route_headway_by_shift_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.route_headway_shift_daily
    ADD CONSTRAINT fk_gold_route_headway_shift_daily_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.route_occupancy_band_daily
    ADD CONSTRAINT fk_gold_route_occupancy_band_daily_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.route_occupancy_band_hourly
    ADD CONSTRAINT fk_gold_route_occupancy_band_hourly_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.route_scheduled_trips_daily
    ADD CONSTRAINT fk_gold_route_scheduled_trips_daily_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.route_service_span_daily
    ADD CONSTRAINT fk_gold_route_service_span_daily_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.route_skipped_stop_daily
    ADD CONSTRAINT fk_gold_route_skipped_stop_daily_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.schedule_version_service_summary
    ADD CONSTRAINT fk_gold_schedule_version_service_summary_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.stop_delay_hourly
    ADD CONSTRAINT fk_gold_stop_delay_hourly_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.stop_delay_percentile_daily
    ADD CONSTRAINT fk_gold_stop_delay_percentile_daily_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.stop_delay_shift_daily
    ADD CONSTRAINT fk_gold_stop_delay_shift_daily_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.stop_delay_spine
    ADD CONSTRAINT fk_gold_stop_delay_spine_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.stop_occupancy_band_daily
    ADD CONSTRAINT fk_gold_stop_occupancy_band_daily_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY gold.trip_delay_summary_5m
    ADD CONSTRAINT fk_gold_trip_delay_summary_5m_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.warm_rollup_periods
    ADD CONSTRAINT fk_gold_warm_rollup_periods_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY gold.realtime_serving_state
    ADD CONSTRAINT realtime_serving_state_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id) ON DELETE CASCADE;
ALTER TABLE ONLY raw.alert_feed_observations
    ADD CONSTRAINT fk_raw_alert_feed_observations_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY raw.alert_language_observations
    ADD CONSTRAINT fk_raw_alert_language_observations_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY raw.i3_alert_snapshots
    ADD CONSTRAINT fk_raw_i3_alert_snapshots_feed_endpoint_id FOREIGN KEY (feed_endpoint_id)
    REFERENCES core.feed_endpoints(feed_endpoint_id);
ALTER TABLE ONLY raw.i3_alert_snapshots
    ADD CONSTRAINT fk_raw_i3_alert_snapshots_ingestion_object_id FOREIGN KEY (ingestion_object_id)
    REFERENCES raw.ingestion_objects(ingestion_object_id);
ALTER TABLE ONLY raw.i3_alert_snapshots
    ADD CONSTRAINT fk_raw_i3_alert_snapshots_ingestion_run_id FOREIGN KEY (ingestion_run_id)
    REFERENCES raw.ingestion_runs(ingestion_run_id);
ALTER TABLE ONLY raw.i3_alert_snapshots
    ADD CONSTRAINT fk_raw_i3_alert_snapshots_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY raw.ingestion_objects
    ADD CONSTRAINT ingestion_objects_ingestion_run_id_fkey FOREIGN KEY (ingestion_run_id) REFERENCES
    raw.ingestion_runs(ingestion_run_id);
ALTER TABLE ONLY raw.ingestion_objects
    ADD CONSTRAINT ingestion_objects_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY raw.ingestion_runs
    ADD CONSTRAINT ingestion_runs_feed_endpoint_id_fkey FOREIGN KEY (feed_endpoint_id) REFERENCES
    core.feed_endpoints(feed_endpoint_id);
ALTER TABLE ONLY raw.ingestion_runs
    ADD CONSTRAINT ingestion_runs_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY raw.realtime_snapshot_index
    ADD CONSTRAINT realtime_snapshot_index_feed_endpoint_id_fkey FOREIGN KEY (feed_endpoint_id)
    REFERENCES core.feed_endpoints(feed_endpoint_id);
ALTER TABLE ONLY raw.realtime_snapshot_index
    ADD CONSTRAINT realtime_snapshot_index_ingestion_object_id_fkey FOREIGN KEY
    (ingestion_object_id) REFERENCES raw.ingestion_objects(ingestion_object_id);
ALTER TABLE ONLY raw.realtime_snapshot_index
    ADD CONSTRAINT realtime_snapshot_index_ingestion_run_id_fkey FOREIGN KEY (ingestion_run_id)
    REFERENCES raw.ingestion_runs(ingestion_run_id);
ALTER TABLE ONLY raw.realtime_snapshot_index
    ADD CONSTRAINT realtime_snapshot_index_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.agency
    ADD CONSTRAINT fk_silver_agency_dataset_version_id FOREIGN KEY (dataset_version_id) REFERENCES
    core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.agency
    ADD CONSTRAINT fk_silver_agency_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.calendar
    ADD CONSTRAINT fk_silver_calendar_dataset_version_id FOREIGN KEY (dataset_version_id) REFERENCES
    core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.calendar_dates
    ADD CONSTRAINT fk_silver_calendar_dates_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.calendar_dates
    ADD CONSTRAINT fk_silver_calendar_dates_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.calendar
    ADD CONSTRAINT fk_silver_calendar_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.directions
    ADD CONSTRAINT fk_silver_directions_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.directions
    ADD CONSTRAINT fk_silver_directions_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.directions
    ADD CONSTRAINT fk_silver_directions_route FOREIGN KEY (dataset_version_id, route_id) REFERENCES
    silver.routes(dataset_version_id, route_id);
ALTER TABLE ONLY silver.feed_info
    ADD CONSTRAINT fk_silver_feed_info_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.feed_info
    ADD CONSTRAINT fk_silver_feed_info_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.gis_datasets
    ADD CONSTRAINT fk_silver_gis_datasets_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.gis_datasets
    ADD CONSTRAINT fk_silver_gis_datasets_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.gis_gtfs_matches
    ADD CONSTRAINT fk_silver_gis_gtfs_matches_gis_dataset_version_id FOREIGN KEY
    (gis_dataset_version_id) REFERENCES silver.gis_datasets(dataset_version_id);
ALTER TABLE ONLY silver.gis_gtfs_matches
    ADD CONSTRAINT fk_silver_gis_gtfs_matches_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.gis_gtfs_matches
    ADD CONSTRAINT fk_silver_gis_gtfs_matches_static_dataset_version_id FOREIGN KEY
    (static_dataset_version_id) REFERENCES core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.gis_line_features
    ADD CONSTRAINT fk_silver_gis_line_features_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES silver.gis_datasets(dataset_version_id);
ALTER TABLE ONLY silver.gis_line_features
    ADD CONSTRAINT fk_silver_gis_line_features_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.gis_stop_features
    ADD CONSTRAINT fk_silver_gis_stop_features_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES silver.gis_datasets(dataset_version_id);
ALTER TABLE ONLY silver.gis_stop_features
    ADD CONSTRAINT fk_silver_gis_stop_features_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.gtfs_extra_rows
    ADD CONSTRAINT fk_silver_gtfs_extra_rows_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id) ON DELETE CASCADE;
ALTER TABLE ONLY silver.gtfs_extra_rows
    ADD CONSTRAINT fk_silver_gtfs_extra_rows_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.gtfs_source_members
    ADD CONSTRAINT fk_silver_gtfs_source_members_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id) ON DELETE CASCADE;
ALTER TABLE ONLY silver.gtfs_source_members
    ADD CONSTRAINT fk_silver_gtfs_source_members_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.i3_alert_active_periods
    ADD CONSTRAINT fk_silver_i3_alert_active_periods_alert FOREIGN KEY (i3_alert_snapshot_id,
    alert_index) REFERENCES silver.i3_alerts(i3_alert_snapshot_id, alert_index) ON DELETE CASCADE;
ALTER TABLE ONLY silver.i3_alert_informed_entities
    ADD CONSTRAINT fk_silver_i3_alert_informed_entities_alert FOREIGN KEY (i3_alert_snapshot_id,
    alert_index) REFERENCES silver.i3_alerts(i3_alert_snapshot_id, alert_index) ON DELETE CASCADE;
ALTER TABLE ONLY silver.i3_alert_informed_entities
    ADD CONSTRAINT fk_silver_i3_alert_informed_entities_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY silver.i3_alerts
    ADD CONSTRAINT fk_silver_i3_alerts_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.i3_alerts
    ADD CONSTRAINT fk_silver_i3_alerts_snapshot_id FOREIGN KEY (i3_alert_snapshot_id) REFERENCES
    raw.i3_alert_snapshots(i3_alert_snapshot_id) ON DELETE CASCADE;
ALTER TABLE ONLY silver.route_patterns
    ADD CONSTRAINT fk_silver_route_patterns_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.route_patterns
    ADD CONSTRAINT fk_silver_route_patterns_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.route_patterns
    ADD CONSTRAINT fk_silver_route_patterns_route FOREIGN KEY (dataset_version_id, route_id)
    REFERENCES silver.routes(dataset_version_id, route_id);
ALTER TABLE ONLY silver.routes
    ADD CONSTRAINT fk_silver_routes_dataset_version_id FOREIGN KEY (dataset_version_id) REFERENCES
    core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.routes
    ADD CONSTRAINT fk_silver_routes_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.rt_entities
    ADD CONSTRAINT fk_silver_rt_entities_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.rt_entities
    ADD CONSTRAINT fk_silver_rt_entities_snapshot_id FOREIGN KEY (rt_feed_snapshot_id) REFERENCES
    silver.rt_feed_snapshots(rt_feed_snapshot_id);
ALTER TABLE ONLY silver.rt_feed_snapshots
    ADD CONSTRAINT fk_silver_rt_feed_snapshots_feed_endpoint_id FOREIGN KEY (feed_endpoint_id)
    REFERENCES core.feed_endpoints(feed_endpoint_id);
ALTER TABLE ONLY silver.rt_feed_snapshots
    ADD CONSTRAINT fk_silver_rt_feed_snapshots_ingestion_object_id FOREIGN KEY (ingestion_object_id)
    REFERENCES raw.ingestion_objects(ingestion_object_id);
ALTER TABLE ONLY silver.rt_feed_snapshots
    ADD CONSTRAINT fk_silver_rt_feed_snapshots_ingestion_run_id FOREIGN KEY (ingestion_run_id)
    REFERENCES raw.ingestion_runs(ingestion_run_id);
ALTER TABLE ONLY silver.rt_feed_snapshots
    ADD CONSTRAINT fk_silver_rt_feed_snapshots_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.rt_feed_snapshots
    ADD CONSTRAINT fk_silver_rt_feed_snapshots_source_realtime_snapshot_id FOREIGN KEY
    (source_realtime_snapshot_id) REFERENCES raw.realtime_snapshot_index(realtime_snapshot_id);
ALTER TABLE ONLY silver.rt_trip_update_stop_times
    ADD CONSTRAINT fk_silver_rt_trip_update_stop_times_provider_id FOREIGN KEY (provider_id)
    REFERENCES core.providers(provider_id);
ALTER TABLE ONLY silver.rt_trip_update_stop_times
    ADD CONSTRAINT fk_silver_rt_trip_update_stop_times_trip_update FOREIGN KEY (rt_feed_snapshot_id,
    entity_index) REFERENCES silver.rt_trip_updates(rt_feed_snapshot_id, entity_index);
ALTER TABLE ONLY silver.rt_trip_updates
    ADD CONSTRAINT fk_silver_rt_trip_updates_entity FOREIGN KEY (rt_feed_snapshot_id, entity_index)
    REFERENCES silver.rt_entities(rt_feed_snapshot_id, entity_index);
ALTER TABLE ONLY silver.rt_trip_updates
    ADD CONSTRAINT fk_silver_rt_trip_updates_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.rt_vehicle_positions
    ADD CONSTRAINT fk_silver_rt_vehicle_positions_entity FOREIGN KEY (rt_feed_snapshot_id,
    entity_index) REFERENCES silver.rt_entities(rt_feed_snapshot_id, entity_index);
ALTER TABLE ONLY silver.rt_vehicle_positions
    ADD CONSTRAINT fk_silver_rt_vehicle_positions_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.shapes
    ADD CONSTRAINT fk_silver_shapes_dataset_version_id FOREIGN KEY (dataset_version_id) REFERENCES
    core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.shapes
    ADD CONSTRAINT fk_silver_shapes_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.stop_times
    ADD CONSTRAINT fk_silver_stop_times_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.stop_times
    ADD CONSTRAINT fk_silver_stop_times_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.stop_times
    ADD CONSTRAINT fk_silver_stop_times_stop FOREIGN KEY (dataset_version_id, stop_id) REFERENCES
    silver.stops(dataset_version_id, stop_id);
ALTER TABLE ONLY silver.stop_times
    ADD CONSTRAINT fk_silver_stop_times_trip FOREIGN KEY (dataset_version_id, trip_id) REFERENCES
    silver.trips(dataset_version_id, trip_id);
ALTER TABLE ONLY silver.stops
    ADD CONSTRAINT fk_silver_stops_dataset_version_id FOREIGN KEY (dataset_version_id) REFERENCES
    core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.stops
    ADD CONSTRAINT fk_silver_stops_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.translations
    ADD CONSTRAINT fk_silver_translations_dataset_version_id FOREIGN KEY (dataset_version_id)
    REFERENCES core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.translations
    ADD CONSTRAINT fk_silver_translations_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.trips
    ADD CONSTRAINT fk_silver_trips_dataset_version_id FOREIGN KEY (dataset_version_id) REFERENCES
    core.dataset_versions(dataset_version_id);
ALTER TABLE ONLY silver.trips
    ADD CONSTRAINT fk_silver_trips_provider_id FOREIGN KEY (provider_id) REFERENCES
    core.providers(provider_id);
ALTER TABLE ONLY silver.trips
    ADD CONSTRAINT fk_silver_trips_route FOREIGN KEY (dataset_version_id, route_id) REFERENCES
    silver.routes(dataset_version_id, route_id);
"""

REPORT_LABELS_SQL = """
INSERT INTO gold.report_labels VALUES
    ('network_health', 'Santé du réseau', 'Network Health', 'Santé du réseau / Network Health', 10);
INSERT INTO gold.report_labels VALUES
    ('operations_map', 'Carte opérationnelle', 'Operations Map',
     'Carte opérationnelle / Operations Map', 20);
INSERT INTO gold.report_labels VALUES
    ('hotspots', 'Points chauds', 'Hotspots', 'Points chauds / Hotspots', 30);
INSERT INTO gold.report_labels VALUES
    ('network_habits', 'Habitudes du réseau', 'Network Habits',
     'Habitudes du réseau / Network Habits', 40);
INSERT INTO gold.report_labels VALUES
    ('history', 'Historique', 'History', 'Historique / History', 50);
INSERT INTO gold.report_labels VALUES
    ('data_trust', 'Confiance des données', 'Data Trust', 'Confiance des données / Data Trust', 60);
INSERT INTO gold.report_labels VALUES
    ('citizen_accountability', 'Responsabilité citoyenne', 'Citizen Accountability',
     'Responsabilité citoyenne / Citizen Accountability', 70);
"""


def upgrade() -> None:
    bind = op.get_bind()
    # Alembic creates version_num as varchar(32); this revision id is longer.
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=32),
        type_=sa.String(length=128),
    )
    bind.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public")
    available = bind.exec_driver_sql(
        "SELECT count(*) FROM pg_available_extensions WHERE name = 'pg_repack'"
    ).scalar()
    if available:
        bind.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS pg_repack")
    else:
        print(
            "pg_repack package not available in this cluster "
            "(pg_available_extensions has no 'pg_repack' row); skipping "
            "CREATE EXTENSION. This is expected on dev / throwaway test "
            "clusters that lack postgresql-16-repack. Prod ships it via "
            "Dockerfile.postgis."
        )
    # pg_dump orders SQL functions before the relations their bodies reference.
    bind.exec_driver_sql("SET LOCAL check_function_bodies = off")
    bind.exec_driver_sql(BASELINE_SQL)
    bind.exec_driver_sql(REPORT_LABELS_SQL)


def downgrade() -> None:
    raise NotImplementedError(
        "The squashed 0093 baseline cannot be downgraded. Restore pre-0093 databases "
        "from backups using the pre-squash migration chain at commit 5c998b09."
    )
