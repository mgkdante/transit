from __future__ import annotations

from alembic import op

revision = "0005_gold_kpi_views_null_safe"
down_revision = "0004_gold_marts_and_kpi_views"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_avg_trip_delay_latest AS
        WITH latest AS (
            SELECT
                provider_id,
                max(realtime_snapshot_id) AS realtime_snapshot_id
            FROM gold.fact_trip_delay_snapshot
            GROUP BY provider_id
        )
        SELECT
            l.provider_id,
            l.realtime_snapshot_id,
            max(f.feed_timestamp_utc) AS feed_timestamp_utc,
            max(f.captured_at_utc) AS captured_at_utc,
            round(
                avg(f.delay_seconds) FILTER (WHERE f.delay_seconds IS NOT NULL)::numeric,
                2
            ) AS avg_delay_seconds
        FROM latest AS l
        LEFT JOIN gold.fact_trip_delay_snapshot AS f
            ON f.provider_id = l.provider_id
           AND f.realtime_snapshot_id = l.realtime_snapshot_id
        GROUP BY l.provider_id, l.realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_delayed_trip_count_latest AS
        WITH latest AS (
            SELECT
                provider_id,
                max(realtime_snapshot_id) AS realtime_snapshot_id
            FROM gold.fact_trip_delay_snapshot
            GROUP BY provider_id
        )
        SELECT
            l.provider_id,
            l.realtime_snapshot_id,
            max(f.feed_timestamp_utc) AS feed_timestamp_utc,
            max(f.captured_at_utc) AS captured_at_utc,
            count(*) FILTER (WHERE f.delay_seconds > 0)::bigint AS delayed_trip_count
        FROM latest AS l
        LEFT JOIN gold.fact_trip_delay_snapshot AS f
            ON f.provider_id = l.provider_id
           AND f.realtime_snapshot_id = l.realtime_snapshot_id
        GROUP BY l.provider_id, l.realtime_snapshot_id
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_avg_trip_delay_latest AS
        WITH latest AS (
            SELECT
                provider_id,
                max(realtime_snapshot_id) AS realtime_snapshot_id
            FROM gold.fact_trip_delay_snapshot
            GROUP BY provider_id
        )
        SELECT
            f.provider_id,
            f.realtime_snapshot_id,
            max(f.feed_timestamp_utc) AS feed_timestamp_utc,
            max(f.captured_at_utc) AS captured_at_utc,
            round(avg(f.delay_seconds)::numeric, 2) AS avg_delay_seconds
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN latest AS l
            ON l.provider_id = f.provider_id
           AND l.realtime_snapshot_id = f.realtime_snapshot_id
        WHERE f.delay_seconds IS NOT NULL
        GROUP BY f.provider_id, f.realtime_snapshot_id
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW gold.kpi_delayed_trip_count_latest AS
        WITH latest AS (
            SELECT
                provider_id,
                max(realtime_snapshot_id) AS realtime_snapshot_id
            FROM gold.fact_trip_delay_snapshot
            GROUP BY provider_id
        )
        SELECT
            f.provider_id,
            f.realtime_snapshot_id,
            max(f.feed_timestamp_utc) AS feed_timestamp_utc,
            max(f.captured_at_utc) AS captured_at_utc,
            count(*)::bigint AS delayed_trip_count
        FROM gold.fact_trip_delay_snapshot AS f
        INNER JOIN latest AS l
            ON l.provider_id = f.provider_id
           AND l.realtime_snapshot_id = f.realtime_snapshot_id
        WHERE f.delay_seconds > 0
        GROUP BY f.provider_id, f.realtime_snapshot_id
        """
    )
