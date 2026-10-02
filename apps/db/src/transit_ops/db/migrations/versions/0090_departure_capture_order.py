"""Select live departures by Silver capture order, independently of raw insertion order."""

from alembic import op

revision = "0090_departure_capture_order"
down_revision = "0089_realtime_serving_state"
branch_labels = None
depends_on = None

_LATEST_BY_CAPTURE = """
    SELECT DISTINCT ON (provider_id)
        provider_id, source_realtime_snapshot_id AS sid
    FROM silver.rt_feed_snapshots
    WHERE endpoint_key = 'trip_updates' AND source_realtime_snapshot_id IS NOT NULL
    ORDER BY provider_id, captured_at_utc DESC, source_realtime_snapshot_id DESC
"""

_LATEST_BY_ID = """
    SELECT provider_id, max(source_realtime_snapshot_id) AS sid
    FROM silver.rt_feed_snapshots
    WHERE endpoint_key = 'trip_updates' AND source_realtime_snapshot_id IS NOT NULL
    GROUP BY provider_id
"""

# Select the parent before child/ETA filtering: an empty newest report suppresses older predictions.
_VIEW = """
CREATE OR REPLACE VIEW gold.current_stop_next_departures AS
WITH latest AS ({latest}
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


def upgrade() -> None:
    op.execute(_VIEW.format(latest=_LATEST_BY_CAPTURE))


def downgrade() -> None:
    op.execute(_VIEW.format(latest=_LATEST_BY_ID))
