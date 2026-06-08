"""Filter stale trips out of gold.current_trip_delay_computed.

Revision ID: 0018_current_trip_delay_exclude_stale
Revises: 0017_wipe_i3_alert_snapshot_bloat
Create Date: 2026-05-27

Bug:
    Power BI's `CurrentI3Alerts`-equivalent for trips
    (gold.current_trip_delay_computed) showed implausible delays — 7-hour
    delays on routes 86, 138, 354, 362 etc.

Investigation:
    Distribution of gold.latest_trip_delay_snapshot by start_date:
        2026-05-26 (yesterday EDT): 362 trips, max abs delay 25,622 sec
        2026-05-27 (today EDT):     124 trips, delays NULL (not yet observed)

    The 362 yesterday-trips are STM-emitted "ghost" trips: GTFS-RT keeps
    publishing trip_updates for trips long after they should have ended.
    Their predicted_arrival_utc (set when the vehicle was last seen) is
    compared against scheduled_arrival_utc (yesterday's schedule), so the
    delta blows up to many hours.

    Today's 124 trips have NULL delay because STM hasn't populated
    predicted_arrival_utc yet (vehicles haven't started moving / passed
    enough stops).

Fix:
    Replace `gold.current_trip_delay_computed` to filter the source
    `gold.latest_trip_delay_snapshot` rows to only operationally-
    meaningful ones:
      - delay_seconds IS NOT NULL  (excludes trips without computed delta)
      - abs(delay_seconds) <= 3600 (1-hour sanity bound — real transit
        delays virtually never exceed this; anything bigger is a stale
        trip leak from STM)
      - start_date >= today_local - 1 day (cuts trips older than yesterday)

    The downstream aggregations (avg, max, count) then operate on a
    clean source.

    Note: the underlying `gold.latest_trip_delay_snapshot` table still
    holds the unfiltered rows for history/debug. Only the view that
    Power BI reads is filtered.

Effect on the Power BI Network Health page:
    - p00_route_delay (Routes les plus lentes maintenant): top routes by
      realistic delays (typically <5 min), not 3-hour ghost trips
    - p00_delay_table (Trajets problématiques): genuine problem trips,
      not stale-trip noise
    - Severe Delay KPI (max > 300s): operationally meaningful count
    - p00_delay_trend continues to use TripDelaySummary5m which already
      averages across thousands of trips and dilutes outliers, so it
      remains unaffected

Downgrade restores the pre-filter view shape for parity.
"""

from __future__ import annotations

from alembic import op

revision = "0018_current_trip_delay_exclude_stale"
down_revision = "0017_wipe_i3_alert_snapshot_bloat"
branch_labels = None
depends_on = None


_FILTERED_VIEW = """
CREATE OR REPLACE VIEW gold.current_trip_delay_computed AS
WITH provider_now AS (
    SELECT dp.provider_id,
           (now() AT TIME ZONE dp.timezone)::date AS today_local
    FROM gold.dim_provider dp
)
SELECT lts.provider_id,
       lts.realtime_snapshot_id AS rt_feed_snapshot_id,
       lts.trip_id,
       lts.route_id,
       lts.direction_id,
       max(lts.captured_at_utc) AS captured_at_utc,
       COALESCE(sum(lts.stop_time_update_count), count(*))::integer
           AS stop_time_observation_count,
       round(avg(lts.delay_seconds::numeric), 2) AS avg_delay_seconds,
       max(lts.delay_seconds) AS max_delay_seconds
FROM gold.latest_trip_delay_snapshot AS lts
JOIN provider_now AS pn
    ON pn.provider_id = lts.provider_id
WHERE lts.delay_seconds IS NOT NULL
  AND abs(lts.delay_seconds) <= 3600
  AND lts.start_date >= pn.today_local - INTERVAL '1 day'
GROUP BY lts.provider_id, lts.realtime_snapshot_id, lts.trip_id,
         lts.route_id, lts.direction_id
"""


_LEGACY_VIEW = """
CREATE OR REPLACE VIEW gold.current_trip_delay_computed AS
SELECT provider_id,
       realtime_snapshot_id AS rt_feed_snapshot_id,
       trip_id,
       route_id,
       direction_id,
       max(captured_at_utc) AS captured_at_utc,
       COALESCE(sum(stop_time_update_count), count(*))::integer
           AS stop_time_observation_count,
       round(avg(delay_seconds::numeric), 2) AS avg_delay_seconds,
       max(delay_seconds) AS max_delay_seconds
FROM gold.latest_trip_delay_snapshot
GROUP BY provider_id, realtime_snapshot_id, trip_id, route_id, direction_id
"""


def upgrade() -> None:
    op.execute(_FILTERED_VIEW)


def downgrade() -> None:
    op.execute(_LEGACY_VIEW)
