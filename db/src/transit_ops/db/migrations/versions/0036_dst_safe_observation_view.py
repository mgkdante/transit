"""Use GTFS service-day anchor for stop-time delay observation view.

Revision ID: 0036_dst_safe_observation_view
Revises: 0035_route_headway_observed_only
Create Date: 2026-06-12

The view is not a published-number source today, but it exposed the same naive
local timestamp construction fixed in the trip-delay snapshot refresh. Keep the
ad-hoc analysis surface honest before the 2026 Quebec fall-back transition.
"""

from __future__ import annotations

from alembic import op

revision = "0036_dst_safe_observation_view"
down_revision = "0035_route_headway_observed_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
                    timezone(dp.timezone,
                        rtu.start_date::timestamp + interval '12 hours'
                    )
                    - interval '12 hours'
                    + make_interval(secs => st.scheduled_arrival_seconds)
                ) AS scheduled_arrival_utc,
                (
                    timezone(dp.timezone,
                        rtu.start_date::timestamp + interval '12 hours'
                    )
                    - interval '12 hours'
                    + make_interval(secs => st.scheduled_departure_seconds)
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


def downgrade() -> None:
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
