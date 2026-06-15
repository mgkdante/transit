"""Make reporting views safe for BI preview and VM-sized rollups.

Revision ID: 0015_reporting_view_performance
Revises: 0014_clean_reporting_foundation
Create Date: 2026-05-26
"""

from __future__ import annotations

from alembic import op

revision = "0015_reporting_view_performance"
down_revision = "0014_clean_reporting_foundation"
branch_labels = None
depends_on = None


def _create_fast_reporting_views() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.fact_stop_time_delay_observation AS
        WITH current_static_dataset AS (
            SELECT provider_id, dataset_version_id
            FROM core.dataset_versions AS dv
            WHERE dv.dataset_kind = 'static_schedule'
              AND dv.is_current
        ),
        static_stop_times AS (
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
            INNER JOIN current_static_dataset AS cs
                ON cs.provider_id = st.provider_id
               AND st.dataset_version_id = cs.dataset_version_id
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
                ON stu.provider_id = rtu.provider_id
               AND stu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
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
        SELECT
            provider_id,
            realtime_snapshot_id AS rt_feed_snapshot_id,
            trip_id,
            route_id,
            direction_id,
            max(captured_at_utc) AS captured_at_utc,
            COALESCE(SUM(stop_time_update_count), COUNT(*))::integer
                AS stop_time_observation_count,
            round(avg(delay_seconds::numeric), 2) AS avg_delay_seconds,
            max(delay_seconds) AS max_delay_seconds
        FROM gold.latest_trip_delay_snapshot
        GROUP BY provider_id, realtime_snapshot_id, trip_id, route_id, direction_id
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.public_route_reliability_daily AS
        SELECT
            rd.provider_id,
            rd.route_id,
            (rd.period_start_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
            SUM(rd.observation_count)::integer AS stop_time_observation_count,
            ROUND(
                SUM(rd.avg_delay_seconds * NULLIF(rd.observation_count, 0))
                / NULLIF(SUM(rd.observation_count), 0),
                2
            ) AS avg_delay_seconds,
            SUM(rd.severe_delay_count)::integer AS severe_delay_observation_count
        FROM gold.route_delay_hourly AS rd
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = rd.provider_id
        GROUP BY rd.provider_id, rd.route_id, provider_local_date
        """
    )
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.public_stop_delay_daily AS
        SELECT
            sd.provider_id,
            sd.stop_id,
            (sd.period_start_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
            SUM(sd.observation_count)::integer AS stop_time_observation_count,
            ROUND(
                SUM(COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
                    * NULLIF(sd.observation_count, 0))
                / NULLIF(SUM(sd.observation_count), 0),
                2
            ) AS avg_delay_seconds,
            ROUND(
                MAX(COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds))
            )::integer AS max_delay_seconds
        FROM gold.stop_delay_hourly AS sd
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = sd.provider_id
        GROUP BY sd.provider_id, sd.stop_id, provider_local_date
        """
    )


def _restore_0014_reporting_views() -> None:
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


def upgrade() -> None:
    _create_fast_reporting_views()


def downgrade() -> None:
    _restore_0014_reporting_views()
