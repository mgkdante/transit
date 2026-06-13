"""Persist trip-delay stop attribution and repair stop-delay history.

Revision ID: 0034_trip_delay_stop_attribution
Revises: 0033_trip_delay_summary_severe_counts
Create Date: 2026-06-12

The old stop_delay_hourly mart relabeled route-hour delay as stop delay and
turned any route-hour severe delay into severe counts for every active stop.
Runtime builds now preserve closed hours, so this migration is the explicit
history-repair instrument: stop_delay_hourly is rebuilt from attributed fact
truth, derived stop aggregates are rebuilt, and unrecoverable frozen receipt
stop counts are nulled rather than left with smear semantics.

WAVE-2 PROD HARDENING -- PRE-DEPLOY FACT BACKFILL DEFERRED. The original
upgrade() also attributed delay_stop_id onto pre-deploy fact rows by scanning
silver.rt_trip_update_stop_times (~500M rows) with a large row_number() window
sort; on prod that overflowed the small containerized /dev/shm and ran 2h40m
without finishing. upgrade() now reverts to the car-5 reviewer-approved
ramp-in design: pre-deploy fact rows keep NULL delay_stop_id, the old smeared
stop_delay_hourly is still deleted, the rebuild is honest-empty for pre-deploy
history (never wrong data), and gold/marts.py attributes every new fact row at
insert from deploy forward (ON CONFLICT delay_stop_id = EXCLUDED.delay_stop_id).
Real per-stop history refills within the 10-day GOLD_REPORTING_OPEN_WINDOW_DAYS
reporting window and the full GOLD_FACT_RETENTION_DAYS (14d) window within 14
days. Zero consumers exist at deploy time (web app unbuilt; stop pages are
slice 9.6).

RECOVERY -- attribute the pre-deploy fact tail later (e.g. before a stop-history
consumer ships, while it is still inside GOLD_FACT_RETENTION_DAYS). The exact
SQL is preserved verbatim in this module as the constants
_BACKFILL_FACT_TRIP_DELAY_STOP_ATTRIBUTION and
_BACKFILL_LATEST_TRIP_DELAY_STOP_ATTRIBUTION (defined but not executed). Run
once, off-peak, in a single transaction with the /dev/shm-safe guards:
    SET LOCAL max_parallel_workers_per_gather = 0;  -- no per-worker /dev/shm sort
    SET LOCAL work_mem = '256MB';                    -- spill to on-disk pgsql_tmp
    <execute _BACKFILL_FACT_TRIP_DELAY_STOP_ATTRIBUTION>;
    <execute _BACKFILL_LATEST_TRIP_DELAY_STOP_ATTRIBUTION>;
then re-run _DELETE_STOP_DELAY_HOURLY + _REBUILD_STOP_DELAY_HOURLY_FROM_FACT and
the weekly/monthly/repeated-problem/citizen rebuilds below to propagate. For a
bounded, faster catch-up that touches only the reporting window, add
`AND captured_at_utc >= date_trunc('hour', now()) - interval '10 days'` to the
work_set CTE's WHERE clause before running.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034_trip_delay_stop_attribution"
down_revision = "0033_trip_delay_summary_severe_counts"
branch_labels = None
depends_on = None


_BACKFILL_FACT_TRIP_DELAY_STOP_ATTRIBUTION = """
WITH work_set AS (
    -- Scope the 500M-row rt_trip_update_stop_times scan to only the snapshots
    -- that actually have fact rows needing attribution (the 14-day fact window).
    -- The row_number() window below partitions by source_realtime_snapshot_id,
    -- so restricting to whole snapshots leaves every surviving partition's
    -- delay_rank=1 winner bit-identical to the unscoped result. (slice-9.1.1i
    -- snapshot-scoping pattern; prod fix after attempt-1 unbounded-scan hang.)
    SELECT DISTINCT realtime_snapshot_id
    FROM gold.fact_trip_delay_snapshot
    WHERE delay_stop_id IS NULL
),
stop_time_candidates AS (
    SELECT
        rtu.provider_id,
        rfs.source_realtime_snapshot_id AS realtime_snapshot_id,
        rtu.entity_index,
        COALESCE(stu.stop_id, st.stop_id) AS delay_stop_id,
        stu.stop_sequence AS delay_stop_sequence,
        row_number() OVER (
            PARTITION BY rtu.provider_id, rfs.source_realtime_snapshot_id, rtu.entity_index
            ORDER BY
                CASE
                    WHEN COALESCE(stu.arrival_time_utc, stu.departure_time_utc)
                        >= rtu.feed_timestamp_utc
                    THEN 0
                    ELSE 1
                END,
                abs(
                    EXTRACT(
                        EPOCH FROM (
                            COALESCE(stu.arrival_time_utc, stu.departure_time_utc)
                            - rtu.feed_timestamp_utc
                        )
                    )
                ),
                stu.stop_sequence NULLS LAST,
                stu.stop_time_update_index
        ) AS delay_rank
    FROM silver.rt_trip_updates AS rtu
    INNER JOIN silver.rt_feed_snapshots AS rfs
        ON rfs.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
       AND rfs.provider_id = rtu.provider_id
       AND rfs.endpoint_key = 'trip_updates'
       AND rfs.source_realtime_snapshot_id IN (SELECT realtime_snapshot_id FROM work_set)
    INNER JOIN silver.rt_trip_update_stop_times AS stu
        ON stu.provider_id = rtu.provider_id
       AND stu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
       AND stu.entity_index = rtu.entity_index
    LEFT JOIN LATERAL (
        SELECT dv.dataset_version_id
        FROM core.dataset_versions AS dv
        WHERE dv.provider_id = rtu.provider_id
          AND dv.dataset_kind = 'static_schedule'
          AND dv.is_current = true
        ORDER BY dv.loaded_at_utc DESC, dv.dataset_version_id DESC
        LIMIT 1
    ) AS current_static ON true
    LEFT JOIN silver.stop_times AS st
        ON st.provider_id = rtu.provider_id
       AND st.dataset_version_id = current_static.dataset_version_id
       AND st.trip_id = rtu.trip_id
       AND st.stop_sequence = stu.stop_sequence
    WHERE rfs.source_realtime_snapshot_id IS NOT NULL
      AND rtu.feed_timestamp_utc IS NOT NULL
      AND COALESCE(stu.arrival_time_utc, stu.departure_time_utc) IS NOT NULL
      AND COALESCE(stu.stop_id, st.stop_id) IS NOT NULL
)
UPDATE gold.fact_trip_delay_snapshot AS f
SET delay_stop_id = c.delay_stop_id,
    delay_stop_sequence = c.delay_stop_sequence
FROM stop_time_candidates AS c
WHERE c.delay_rank = 1
  AND f.provider_id = c.provider_id
  AND f.realtime_snapshot_id = c.realtime_snapshot_id
  AND f.entity_index = c.entity_index
  AND f.delay_stop_id IS NULL
"""


_BACKFILL_LATEST_TRIP_DELAY_STOP_ATTRIBUTION = """
UPDATE gold.latest_trip_delay_snapshot AS l
SET delay_stop_id = f.delay_stop_id,
    delay_stop_sequence = f.delay_stop_sequence
FROM gold.fact_trip_delay_snapshot AS f
WHERE l.provider_id = f.provider_id
  AND l.realtime_snapshot_id = f.realtime_snapshot_id
  AND l.entity_index = f.entity_index
  AND f.delay_stop_id IS NOT NULL
"""


_DELETE_STOP_DELAY_HOURLY = """
DELETE FROM gold.stop_delay_hourly
"""


_REBUILD_STOP_DELAY_HOURLY_FROM_FACT = """
WITH repaired AS (
    SELECT
        provider_id,
        date_trunc('hour', captured_at_utc) AS period_start_utc,
        delay_stop_id AS stop_id,
        COALESCE(route_id, '__unrouted__') AS route_id,
        delay_seconds
    FROM gold.fact_trip_delay_snapshot
    WHERE delay_stop_id IS NOT NULL
      AND delay_seconds IS NOT NULL
      AND ABS(delay_seconds) <= 3600
)
INSERT INTO gold.stop_delay_hourly (
    provider_id,
    period_start_utc,
    stop_id,
    route_id,
    observation_count,
    avg_arrival_delay_seconds,
    avg_departure_delay_seconds,
    severe_delay_count,
    built_at_utc
)
SELECT
    provider_id,
    period_start_utc,
    stop_id,
    route_id,
    COUNT(*)::integer AS observation_count,
    ROUND(AVG(delay_seconds::numeric), 2) AS avg_arrival_delay_seconds,
    ROUND(AVG(delay_seconds::numeric), 2) AS avg_departure_delay_seconds,
    COUNT(*) FILTER (WHERE delay_seconds > 300 AND ABS(delay_seconds) <= 3600)::integer,
    now()
FROM repaired
GROUP BY 1, 2, 3, 4
"""


_DELETE_STOP_DELAY_WEEKLY = """
DELETE FROM gold.stop_delay_weekly
"""


_INSERT_STOP_DELAY_WEEKLY = """
INSERT INTO gold.stop_delay_weekly (
    provider_id,
    week_start_local,
    stop_id,
    route_id,
    observation_count,
    avg_delay_seconds,
    severe_delay_count,
    built_at_utc
)
SELECT
    sd.provider_id,
    date_trunc('week', timezone(dp.timezone, sd.period_start_utc))::date,
    sd.stop_id,
    sd.route_id,
    SUM(sd.observation_count)::integer,
    ROUND(
        SUM(COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
            * NULLIF(sd.observation_count, 0))
        / NULLIF(SUM(sd.observation_count), 0),
        2
    ),
    SUM(sd.severe_delay_count)::integer,
    now()
FROM gold.stop_delay_hourly AS sd
INNER JOIN gold.dim_provider AS dp
    ON dp.provider_id = sd.provider_id
GROUP BY 1, 2, 3, 4
"""


_DELETE_STOP_DELAY_MONTHLY = """
DELETE FROM gold.stop_delay_monthly
"""


_INSERT_STOP_DELAY_MONTHLY = """
INSERT INTO gold.stop_delay_monthly (
    provider_id,
    month_start_local,
    stop_id,
    route_id,
    observation_count,
    avg_delay_seconds,
    severe_delay_count,
    built_at_utc
)
SELECT
    sd.provider_id,
    date_trunc('month', timezone(dp.timezone, sd.period_start_utc))::date,
    sd.stop_id,
    sd.route_id,
    SUM(sd.observation_count)::integer,
    ROUND(
        SUM(COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds)
            * NULLIF(sd.observation_count, 0))
        / NULLIF(SUM(sd.observation_count), 0),
        2
    ),
    SUM(sd.severe_delay_count)::integer,
    now()
FROM gold.stop_delay_hourly AS sd
INNER JOIN gold.dim_provider AS dp
    ON dp.provider_id = sd.provider_id
GROUP BY 1, 2, 3, 4
"""


_DELETE_REPEATED_PROBLEM_ROUTE_STOP = """
DELETE FROM gold.repeated_problem_route_stop
"""


_INSERT_REPEATED_PROBLEM_ROUTE_STOP = """
WITH route_week AS (
    SELECT
        r.provider_id,
        'route'::text AS entity_kind,
        COALESCE(r.route_id, '__unrouted__') AS entity_id,
        COALESCE(r.route_id, '__unrouted__') AS route_id,
        'week'::text AS period_grain,
        r.week_start_local AS period_start_local,
        SUM(r.severe_delay_count)::integer AS issue_count,
        ROUND(AVG(r.avg_delay_seconds)::numeric, 2) AS avg_delay_seconds
    FROM gold.route_reliability_weekly AS r
    GROUP BY 1, 2, 3, 4, 5, 6
),
stop_week AS (
    SELECT
        s.provider_id,
        'stop'::text AS entity_kind,
        COALESCE(s.stop_id, '__unknown_stop__') AS entity_id,
        COALESCE(s.route_id, '__unrouted__') AS route_id,
        'week'::text AS period_grain,
        s.week_start_local AS period_start_local,
        SUM(s.severe_delay_count)::integer AS issue_count,
        ROUND(AVG(s.avg_delay_seconds)::numeric, 2) AS avg_delay_seconds
    FROM gold.stop_delay_weekly AS s
    GROUP BY 1, 2, 3, 4, 5, 6
),
problems AS (
    SELECT * FROM route_week
    UNION ALL
    SELECT * FROM stop_week
)
INSERT INTO gold.repeated_problem_route_stop (
    provider_id,
    entity_kind,
    entity_id,
    route_id,
    period_grain,
    period_start_local,
    issue_count,
    avg_delay_seconds,
    severity_label,
    built_at_utc
)
SELECT
    provider_id,
    entity_kind,
    entity_id,
    route_id,
    period_grain,
    period_start_local,
    issue_count,
    avg_delay_seconds,
    CASE
        WHEN issue_count >= 10 OR avg_delay_seconds > 600 THEN 'critical'
        WHEN issue_count > 0 OR avg_delay_seconds > 300 THEN 'high'
        ELSE 'watch'
    END,
    now()
FROM problems
WHERE issue_count > 0 OR avg_delay_seconds > 300
"""


_UPDATE_CITIZEN_STOP_COUNTS_FROM_REPAIRED_STOPS = """
WITH stop_daily AS (
    SELECT
        sd.provider_id,
        timezone(dp.timezone, sd.period_start_utc)::date AS provider_local_date,
        COUNT(DISTINCT sd.stop_id) FILTER (
            WHERE COALESCE(sd.avg_arrival_delay_seconds, sd.avg_departure_delay_seconds) > 300
               OR sd.severe_delay_count > 0
        )::integer AS affected_stop_count
    FROM gold.stop_delay_hourly AS sd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = sd.provider_id
    GROUP BY 1, 2
)
UPDATE gold.citizen_accountability_daily AS cad
SET affected_stop_count = sd.affected_stop_count,
    rider_impact_score = LEAST(
        ROUND(
            (
                cad.affected_route_count::numeric * 2
                + sd.affected_stop_count::numeric
                + cad.delayed_trip_count::numeric
                + cad.severe_delay_count::numeric * 3
                + cad.alert_count::numeric * 2
            ),
            4
        ),
        9999.9999
    ),
    built_at_utc = now()
FROM stop_daily AS sd
WHERE cad.provider_id = sd.provider_id
  AND cad.provider_local_date = sd.provider_local_date
"""


_NULL_UNRECOVERABLE_CITIZEN_STOP_COUNTS = """
WITH stop_daily AS (
    SELECT DISTINCT
        sd.provider_id,
        timezone(dp.timezone, sd.period_start_utc)::date AS provider_local_date
    FROM gold.stop_delay_hourly AS sd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = sd.provider_id
)
UPDATE gold.citizen_accountability_daily AS cad
SET affected_stop_count = NULL,
    rider_impact_score = NULL,
    built_at_utc = now()
WHERE cad.affected_stop_count IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM stop_daily AS sd
      WHERE sd.provider_id = cad.provider_id
        AND sd.provider_local_date = cad.provider_local_date
  )
"""


def upgrade() -> None:
    for table_name in ("fact_trip_delay_snapshot", "latest_trip_delay_snapshot"):
        op.add_column(
            table_name,
            sa.Column("delay_stop_id", sa.Text(), nullable=True),
            schema="gold",
        )
        op.add_column(
            table_name,
            sa.Column("delay_stop_sequence", sa.Integer(), nullable=True),
            schema="gold",
        )

    # DEFERRED (wave-2 prod hardening): the two pre-deploy fact backfills are
    # NOT executed here. _BACKFILL_FACT_TRIP_DELAY_STOP_ATTRIBUTION scans
    # silver.rt_trip_update_stop_times (~500M rows) plus a large row_number()
    # window sort that overflows prod's small containerized /dev/shm; attempt-1
    # ran 2h40m without finishing. This migration therefore reverts to the
    # car-5 reviewer-approved RAMP-IN design (05-b.md Approach: "No backfill ...
    # correct data ramps in over <=14 days"): pre-deploy fact rows keep a NULL
    # delay_stop_id, so the rebuild below is honest-empty for pre-deploy stop
    # history (the old smear is still deleted), and gold/marts.py's per-cycle
    # ON CONFLICT (delay_stop_id = EXCLUDED.delay_stop_id) attributes every new
    # fact row from deploy forward. Both backfill constants are preserved
    # verbatim above; run them later via the RECOVERY recipe in this module's
    # docstring if the pre-deploy tail is ever needed before it rolls off
    # GOLD_FACT_RETENTION_DAYS.
    # op.execute(_BACKFILL_FACT_TRIP_DELAY_STOP_ATTRIBUTION)
    # op.execute(_BACKFILL_LATEST_TRIP_DELAY_STOP_ATTRIBUTION)
    op.execute(_DELETE_STOP_DELAY_HOURLY)
    op.execute(_REBUILD_STOP_DELAY_HOURLY_FROM_FACT)
    op.execute(_DELETE_STOP_DELAY_WEEKLY)
    op.execute(_INSERT_STOP_DELAY_WEEKLY)
    op.execute(_DELETE_STOP_DELAY_MONTHLY)
    op.execute(_INSERT_STOP_DELAY_MONTHLY)
    op.execute(_DELETE_REPEATED_PROBLEM_ROUTE_STOP)
    op.execute(_INSERT_REPEATED_PROBLEM_ROUTE_STOP)
    op.alter_column(
        "citizen_accountability_daily",
        "affected_stop_count",
        existing_type=sa.Integer(),
        nullable=True,
        schema="gold",
    )
    op.execute(_UPDATE_CITIZEN_STOP_COUNTS_FROM_REPAIRED_STOPS)
    op.execute(_NULL_UNRECOVERABLE_CITIZEN_STOP_COUNTS)


def downgrade() -> None:
    op.execute(
        """
        UPDATE gold.citizen_accountability_daily
        SET affected_stop_count = 0
        WHERE affected_stop_count IS NULL
        """
    )
    op.alter_column(
        "citizen_accountability_daily",
        "affected_stop_count",
        existing_type=sa.Integer(),
        nullable=False,
        schema="gold",
    )
    for table_name in ("latest_trip_delay_snapshot", "fact_trip_delay_snapshot"):
        op.drop_column(table_name, "delay_stop_sequence", schema="gold")
        op.drop_column(table_name, "delay_stop_id", schema="gold")
