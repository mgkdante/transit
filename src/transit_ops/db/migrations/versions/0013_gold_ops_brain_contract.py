from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013_gold_ops_brain_contract"
down_revision = "0012_source_ledger_gis_rt_abundance"
branch_labels = None
depends_on = None


OLD_FEED_KIND_VALUES = (
    "static_schedule",
    "gis_static",
    "trip_updates",
    "vehicle_positions",
)
NEW_FEED_KIND_VALUES = (*OLD_FEED_KIND_VALUES, "i3_alerts")
OLD_SOURCE_FORMAT_VALUES = (
    "gtfs_schedule_zip",
    "stm_gis_zip",
    "gtfs_rt_trip_updates",
    "gtfs_rt_vehicle_positions",
)
NEW_SOURCE_FORMAT_VALUES = (*OLD_SOURCE_FORMAT_VALUES, "api_i3_json")
OLD_RUN_KIND_VALUES = OLD_FEED_KIND_VALUES
NEW_RUN_KIND_VALUES = NEW_FEED_KIND_VALUES


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    return f"{column_name} IN ({', '.join(repr(value) for value in values)})"


def _drop_contract_constraints() -> None:
    op.drop_constraint(
        "ck_feed_endpoints_feed_kind",
        "feed_endpoints",
        schema="core",
        type_="check",
    )
    op.drop_constraint(
        "ck_feed_endpoints_source_format",
        "feed_endpoints",
        schema="core",
        type_="check",
    )
    op.drop_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        schema="raw",
        type_="check",
    )


def _create_contract_constraints(
    *,
    feed_kind_values: tuple[str, ...],
    source_format_values: tuple[str, ...],
    run_kind_values: tuple[str, ...],
) -> None:
    op.create_check_constraint(
        "ck_feed_endpoints_feed_kind",
        "feed_endpoints",
        _in_constraint("feed_kind", feed_kind_values),
        schema="core",
    )
    op.create_check_constraint(
        "ck_feed_endpoints_source_format",
        "feed_endpoints",
        _in_constraint("source_format", source_format_values),
        schema="core",
    )
    op.create_check_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        _in_constraint("run_kind", run_kind_values),
        schema="raw",
    )


def _add_provider_metadata_columns() -> None:
    for column in (
        sa.Column("provider_key", sa.Text(), nullable=True),
        sa.Column("default_language", sa.Text(), nullable=True),
        sa.Column("default_currency", sa.Text(), nullable=True),
        sa.Column("min_latitude", sa.Float(), nullable=True),
        sa.Column("max_latitude", sa.Float(), nullable=True),
        sa.Column("min_longitude", sa.Float(), nullable=True),
        sa.Column("max_longitude", sa.Float(), nullable=True),
    ):
        op.add_column("providers", column, schema="core")

    op.execute("UPDATE core.providers SET provider_key = provider_id WHERE provider_key IS NULL")
    op.alter_column("providers", "provider_key", nullable=False, schema="core")
    op.create_unique_constraint(
        "uq_core_providers_provider_key",
        "providers",
        ["provider_key"],
        schema="core",
    )
    op.create_check_constraint(
        "ck_core_providers_bounds_wgs84",
        "providers",
        """
        (
            min_latitude IS NULL
            AND max_latitude IS NULL
            AND min_longitude IS NULL
            AND max_longitude IS NULL
        )
        OR (
            min_latitude BETWEEN -90 AND 90
            AND max_latitude BETWEEN -90 AND 90
            AND min_latitude <= max_latitude
            AND min_longitude BETWEEN -180 AND 180
            AND max_longitude BETWEEN -180 AND 180
            AND min_longitude <= max_longitude
        )
        """,
        schema="core",
    )


def _create_i3_source_tables() -> None:
    op.create_table(
        "i3_alert_snapshots",
        sa.Column(
            "i3_alert_snapshot_id",
            sa.BigInteger(),
            sa.Identity(always=False),
            primary_key=True,
        ),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("feed_endpoint_id", sa.BigInteger(), nullable=False),
        sa.Column("ingestion_run_id", sa.BigInteger(), nullable=False),
        sa.Column("ingestion_object_id", sa.BigInteger(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("http_status_code", sa.Integer(), nullable=True),
        sa.Column(
            "captured_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("storage_backend", sa.Text(), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("checksum_sha256", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("api_version", sa.Text(), nullable=True),
        sa.Column("alert_count", sa.Integer(), nullable=True),
        sa.Column("raw_payload_json", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_raw_i3_alert_snapshots_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["feed_endpoint_id"],
            ["core.feed_endpoints.feed_endpoint_id"],
            name="fk_raw_i3_alert_snapshots_feed_endpoint_id",
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["raw.ingestion_runs.ingestion_run_id"],
            name="fk_raw_i3_alert_snapshots_ingestion_run_id",
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_object_id"],
            ["raw.ingestion_objects.ingestion_object_id"],
            name="fk_raw_i3_alert_snapshots_ingestion_object_id",
        ),
        sa.UniqueConstraint("ingestion_run_id", name="uq_raw_i3_alert_snapshots_ingestion_run"),
        schema="raw",
    )
    op.create_index(
        "ix_raw_i3_alert_snapshots_provider_captured",
        "i3_alert_snapshots",
        ["provider_id", "captured_at_utc"],
        schema="raw",
    )

    op.create_table(
        "i3_alerts",
        sa.Column("i3_alert_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("alert_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("alert_id", sa.Text(), nullable=True),
        sa.Column("alert_header_text", sa.Text(), nullable=True),
        sa.Column("description_text", sa.Text(), nullable=True),
        sa.Column("severity", sa.Text(), nullable=True),
        sa.Column("cause", sa.Text(), nullable=True),
        sa.Column("effect", sa.Text(), nullable=True),
        sa.Column("active_period_start_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active_period_end_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("captured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("raw_alert_json", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["i3_alert_snapshot_id"],
            ["raw.i3_alert_snapshots.i3_alert_snapshot_id"],
            name="fk_silver_i3_alerts_snapshot_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_i3_alerts_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "i3_alert_snapshot_id",
            "alert_index",
            name="pk_silver_i3_alerts",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_i3_alerts_provider_alert",
        "i3_alerts",
        ["provider_id", "alert_id"],
        schema="silver",
    )
    op.create_index(
        "ix_silver_i3_alerts_provider_active",
        "i3_alerts",
        ["provider_id", "active_period_start_utc", "active_period_end_utc"],
        schema="silver",
    )

    op.create_table(
        "i3_alert_informed_entities",
        sa.Column("i3_alert_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("alert_index", sa.Integer(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("stop_id", sa.Text(), nullable=True),
        sa.Column("trip_id", sa.Text(), nullable=True),
        sa.Column("area_id", sa.Text(), nullable=True),
        sa.Column("raw_entity_json", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["i3_alert_snapshot_id", "alert_index"],
            ["silver.i3_alerts.i3_alert_snapshot_id", "silver.i3_alerts.alert_index"],
            name="fk_silver_i3_alert_informed_entities_alert",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_i3_alert_informed_entities_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "i3_alert_snapshot_id",
            "alert_index",
            "entity_index",
            name="pk_silver_i3_alert_informed_entities",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_i3_alert_entities_provider_route_stop",
        "i3_alert_informed_entities",
        ["provider_id", "route_id", "stop_id"],
        schema="silver",
    )


def _create_gold_provider_and_map_views() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.dim_provider AS
        SELECT
            provider_id,
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
        FROM core.providers
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.map_stops AS
        SELECT
            s.provider_id,
            s.dataset_version_id,
            s.stop_id,
            s.stop_code,
            s.stop_name,
            s.parent_station,
            s.location_type,
            s.stop_lat,
            s.stop_lon,
            ST_SetSRID(ST_MakePoint(s.stop_lon, s.stop_lat), 4326) AS geom_wgs84,
            ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(s.stop_lon, s.stop_lat), 4326))::jsonb AS geojson
        FROM silver.stops AS s
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = s.provider_id
        WHERE s.stop_lat BETWEEN -90 AND 90
          AND s.stop_lon BETWEEN -180 AND 180
          AND (
              dp.min_latitude IS NULL
              OR (
                  s.stop_lat BETWEEN dp.min_latitude AND dp.max_latitude
                  AND s.stop_lon BETWEEN dp.min_longitude AND dp.max_longitude
              )
          )
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.map_route_lines AS
        SELECT
            sh.provider_id,
            sh.dataset_version_id,
            sh.shape_id,
            max(sh.route_pattern_id) AS route_pattern_id,
            ST_MakeLine(
                ST_SetSRID(ST_MakePoint(sh.shape_pt_lon, sh.shape_pt_lat), 4326)
                ORDER BY sh.shape_pt_sequence
            ) AS geom_wgs84,
            ST_AsGeoJSON(
                ST_MakeLine(
                    ST_SetSRID(ST_MakePoint(sh.shape_pt_lon, sh.shape_pt_lat), 4326)
                    ORDER BY sh.shape_pt_sequence
                )
            )::jsonb AS geojson
        FROM silver.shapes AS sh
        WHERE sh.shape_pt_lat BETWEEN -90 AND 90
          AND sh.shape_pt_lon BETWEEN -180 AND 180
        GROUP BY sh.provider_id, sh.dataset_version_id, sh.shape_id
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.map_gis_line_features AS
        SELECT
            provider_id,
            dataset_version_id,
            source_feature_id,
            route_id,
            route_name,
            headsign,
            shape_id,
            CASE
                WHEN source_crs_epsg IS NULL THEN NULL
                ELSE ST_Transform(ST_GeomFromWKB(source_geometry_wkb, source_crs_epsg), 4326)
            END AS geom_wgs84,
            CASE
                WHEN source_crs_epsg IS NULL THEN NULL
                ELSE ST_AsGeoJSON(
                    ST_Transform(ST_GeomFromWKB(source_geometry_wkb, source_crs_epsg), 4326)
                )::jsonb
            END AS geojson
        FROM silver.gis_line_features
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.current_vehicle_map AS
        SELECT
            v.provider_id,
            v.realtime_snapshot_id,
            v.entity_index,
            v.vehicle_id,
            v.trip_id,
            v.route_id,
            v.stop_id,
            v.captured_at_utc,
            v.latitude,
            v.longitude,
            ST_SetSRID(ST_MakePoint(v.longitude, v.latitude), 4326) AS geom_wgs84,
            ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(v.longitude, v.latitude), 4326))::jsonb AS geojson
        FROM gold.latest_vehicle_snapshot AS v
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = v.provider_id
        WHERE v.latitude BETWEEN -90 AND 90
          AND v.longitude BETWEEN -180 AND 180
          AND (
              dp.min_latitude IS NULL
              OR (
                  v.latitude BETWEEN dp.min_latitude AND dp.max_latitude
                  AND v.longitude BETWEEN dp.min_longitude AND dp.max_longitude
              )
          )
        """
    )


def _create_gold_delay_views() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.fact_stop_time_delay_observation AS
        WITH static_stop_times AS (
            SELECT
                st.provider_id,
                st.dataset_version_id,
                st.trip_id,
                st.stop_sequence,
                st.stop_id,
                st.arrival_time,
                st.departure_time,
                (
                    split_part(st.arrival_time, ':', 1)::integer * 3600
                    + split_part(st.arrival_time, ':', 2)::integer * 60
                    + split_part(st.arrival_time, ':', 3)::integer
                ) AS scheduled_arrival_seconds,
                (
                    split_part(st.departure_time, ':', 1)::integer * 3600
                    + split_part(st.departure_time, ':', 2)::integer * 60
                    + split_part(st.departure_time, ':', 3)::integer
                ) AS scheduled_departure_seconds
            FROM silver.stop_times AS st
            WHERE st.arrival_time IS NOT NULL
              AND st.departure_time IS NOT NULL
        ),
        joined AS (
            SELECT
                rtu.provider_id,
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
                (
                    (
                        rtu.start_date::timestamp
                        + make_interval(secs => st.scheduled_arrival_seconds)
                    ) AT TIME ZONE dp.timezone
                ) AS scheduled_arrival_utc,
                (
                    (
                        rtu.start_date::timestamp
                        + make_interval(secs => st.scheduled_departure_seconds)
                    ) AT TIME ZONE dp.timezone
                ) AS scheduled_departure_utc
            FROM silver.rt_trip_updates AS rtu
            INNER JOIN silver.rt_trip_update_stop_times AS stu
                ON stu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
               AND stu.entity_index = rtu.entity_index
            INNER JOIN static_stop_times AS st
                ON st.provider_id = rtu.provider_id
               AND st.trip_id = rtu.trip_id
               AND st.stop_sequence = stu.stop_sequence
            INNER JOIN gold.dim_provider AS dp
                ON dp.provider_id = rtu.provider_id
        )
        SELECT
            provider_id,
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
            EXTRACT(EPOCH FROM (arrival_time_utc - scheduled_arrival_utc))::integer
                AS arrival_delay_seconds,
            scheduled_departure_utc,
            departure_time_utc AS predicted_departure_utc,
            EXTRACT(EPOCH FROM (departure_time_utc - scheduled_departure_utc))::integer
                AS departure_delay_seconds,
            COALESCE(arrival_time_utc, departure_time_utc, feed_timestamp_utc, captured_at_utc)
                AS observation_time_utc,
            feed_timestamp_utc,
            captured_at_utc
        FROM joined
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.current_trip_delay_computed AS
        WITH latest AS (
            SELECT provider_id, max(rt_feed_snapshot_id) AS rt_feed_snapshot_id
            FROM gold.fact_stop_time_delay_observation
            GROUP BY provider_id
        )
        SELECT
            f.provider_id,
            f.rt_feed_snapshot_id,
            f.trip_id,
            f.route_id,
            f.direction_id,
            max(f.captured_at_utc) AS captured_at_utc,
            count(*)::integer AS stop_time_observation_count,
            round(avg(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds))::numeric, 2)
                AS avg_delay_seconds,
            max(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds))
                AS max_delay_seconds
        FROM gold.fact_stop_time_delay_observation AS f
        INNER JOIN latest AS l
            ON l.provider_id = f.provider_id
           AND l.rt_feed_snapshot_id = f.rt_feed_snapshot_id
        GROUP BY f.provider_id, f.rt_feed_snapshot_id, f.trip_id, f.route_id, f.direction_id
        """
    )


def _create_gold_i3_views() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.current_i3_alerts AS
        SELECT
            a.provider_id,
            a.alert_id,
            a.alert_header_text,
            a.description_text,
            a.severity,
            a.cause,
            a.effect,
            e.route_id,
            e.stop_id,
            e.trip_id,
            e.area_id,
            a.active_period_start_utc,
            a.active_period_end_utc,
            a.captured_at_utc
        FROM silver.i3_alerts AS a
        LEFT JOIN silver.i3_alert_informed_entities AS e
            ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
           AND e.alert_index = a.alert_index
        WHERE COALESCE(a.active_period_start_utc, a.captured_at_utc) <= now()
          AND COALESCE(a.active_period_end_utc, now() + interval '100 years') >= now()
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.i3_alert_history_reporting AS
        SELECT
            a.provider_id,
            a.alert_id,
            a.alert_header_text,
            a.severity,
            a.cause,
            a.effect,
            e.route_id,
            e.stop_id,
            e.area_id,
            (a.captured_at_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
            date_trunc('hour', a.captured_at_utc AT TIME ZONE dp.timezone) AS hour_bucket_local,
            date_trunc('week', a.captured_at_utc AT TIME ZONE dp.timezone) AS week_bucket_local,
            date_trunc('month', a.captured_at_utc AT TIME ZONE dp.timezone) AS month_bucket_local,
            date_trunc('year', a.captured_at_utc AT TIME ZONE dp.timezone)
                AS rolling_year_bucket_local,
            a.active_period_start_utc,
            a.active_period_end_utc,
            a.captured_at_utc
        FROM silver.i3_alerts AS a
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = a.provider_id
        LEFT JOIN silver.i3_alert_informed_entities AS e
            ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
           AND e.alert_index = a.alert_index
        """
    )


def _create_gold_health_and_accountability_views() -> None:
    op.execute(
        """
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
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.source_lineage_reporting AS
        SELECT
            dv.provider_id,
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
        FROM core.dataset_versions AS dv
        INNER JOIN core.feed_endpoints AS fe
            ON fe.feed_endpoint_id = dv.feed_endpoint_id
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.public_route_reliability_daily AS
        SELECT
            f.provider_id,
            f.route_id,
            (f.observation_time_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
            count(*)::integer AS stop_time_observation_count,
            round(avg(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds))::numeric, 2)
                AS avg_delay_seconds,
            count(*) FILTER (
                WHERE COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds) > 300
            )::integer AS severe_delay_observation_count
        FROM gold.fact_stop_time_delay_observation AS f
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = f.provider_id
        GROUP BY f.provider_id, f.route_id, provider_local_date
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.public_stop_delay_daily AS
        SELECT
            f.provider_id,
            f.stop_id,
            (f.observation_time_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
            count(*)::integer AS stop_time_observation_count,
            round(avg(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds))::numeric, 2)
                AS avg_delay_seconds,
            max(COALESCE(f.arrival_delay_seconds, f.departure_delay_seconds))
                AS max_delay_seconds
        FROM gold.fact_stop_time_delay_observation AS f
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = f.provider_id
        GROUP BY f.provider_id, f.stop_id, provider_local_date
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.public_alert_impact_daily AS
        SELECT
            provider_id,
            route_id,
            stop_id,
            area_id,
            provider_local_date,
            count(DISTINCT alert_id)::integer AS alert_count
        FROM gold.i3_alert_history_reporting
        GROUP BY provider_id, route_id, stop_id, area_id, provider_local_date
        """
    )


def _drop_gold_views() -> None:
    for view_name in (
        "public_alert_impact_daily",
        "public_stop_delay_daily",
        "public_route_reliability_daily",
        "source_lineage_reporting",
        "feed_freshness_current",
        "i3_alert_history_reporting",
        "current_i3_alerts",
        "current_trip_delay_computed",
        "fact_stop_time_delay_observation",
        "current_vehicle_map",
        "map_gis_line_features",
        "map_route_lines",
        "map_stops",
        "dim_provider",
    ):
        op.execute(f"DROP VIEW IF EXISTS gold.{view_name}")


def _guard_downgrade_has_no_i3_contract_rows() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM core.feed_endpoints
                WHERE feed_kind = 'i3_alerts'
                   OR source_format = 'api_i3_json'
            )
            OR EXISTS (
                SELECT 1
                FROM raw.ingestion_runs
                WHERE run_kind = 'i3_alerts'
            )
            OR EXISTS (
                SELECT 1
                FROM raw.i3_alert_snapshots
            )
            THEN
                RAISE EXCEPTION USING MESSAGE =
                    'Cannot downgrade 0013_gold_ops_brain_contract while i3 contract rows exist; '
                    || 'prune 8.5 i3 data first.';
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    _drop_contract_constraints()
    _create_contract_constraints(
        feed_kind_values=NEW_FEED_KIND_VALUES,
        source_format_values=NEW_SOURCE_FORMAT_VALUES,
        run_kind_values=NEW_RUN_KIND_VALUES,
    )
    _add_provider_metadata_columns()
    _create_i3_source_tables()
    _create_gold_provider_and_map_views()
    _create_gold_delay_views()
    _create_gold_i3_views()
    _create_gold_health_and_accountability_views()


def downgrade() -> None:
    _guard_downgrade_has_no_i3_contract_rows()
    _drop_gold_views()

    op.drop_index(
        "ix_silver_i3_alert_entities_provider_route_stop",
        table_name="i3_alert_informed_entities",
        schema="silver",
    )
    op.drop_table("i3_alert_informed_entities", schema="silver")
    op.drop_index(
        "ix_silver_i3_alerts_provider_active",
        table_name="i3_alerts",
        schema="silver",
    )
    op.drop_index(
        "ix_silver_i3_alerts_provider_alert",
        table_name="i3_alerts",
        schema="silver",
    )
    op.drop_table("i3_alerts", schema="silver")
    op.drop_index(
        "ix_raw_i3_alert_snapshots_provider_captured",
        table_name="i3_alert_snapshots",
        schema="raw",
    )
    op.drop_table("i3_alert_snapshots", schema="raw")

    op.drop_constraint(
        "ck_core_providers_bounds_wgs84",
        "providers",
        schema="core",
        type_="check",
    )
    op.drop_constraint(
        "uq_core_providers_provider_key",
        "providers",
        schema="core",
        type_="unique",
    )
    for column_name in (
        "max_longitude",
        "min_longitude",
        "max_latitude",
        "min_latitude",
        "default_currency",
        "default_language",
        "provider_key",
    ):
        op.drop_column("providers", column_name, schema="core")

    _drop_contract_constraints()
    _create_contract_constraints(
        feed_kind_values=OLD_FEED_KIND_VALUES,
        source_format_values=OLD_SOURCE_FORMAT_VALUES,
        run_kind_values=OLD_RUN_KIND_VALUES,
    )
