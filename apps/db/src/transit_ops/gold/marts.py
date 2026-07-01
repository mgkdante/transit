from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings

DELETE_FACT_TRIP_DELAY_SNAPSHOT = text(
    """
    DELETE FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
    """
)

DELETE_FACT_VEHICLE_SNAPSHOT = text(
    """
    DELETE FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
    """
)

DELETE_LATEST_TRIP_DELAY_SNAPSHOT = text(
    """
    DELETE FROM gold.latest_trip_delay_snapshot
    WHERE provider_id = :provider_id
    """
)

DELETE_LATEST_VEHICLE_SNAPSHOT = text(
    """
    DELETE FROM gold.latest_vehicle_snapshot
    WHERE provider_id = :provider_id
    """
)

ANALYZE_REALTIME_SILVER_TABLES = text(
    """
    ANALYZE silver.rt_feed_snapshots,
            silver.rt_entities,
            silver.rt_trip_updates,
            silver.rt_trip_update_stop_times,
            silver.rt_vehicle_positions
    """
)

# Seconds since the most-recent ANALYZE (manual or autoanalyze) across the five
# realtime silver tables, or NULL if none has ever been analyzed. Used to
# throttle the per-cycle ANALYZE below: the full ANALYZE (incl. the ~500M-row
# rt_trip_update_stop_times) takes SHARE UPDATE EXCLUSIVE + heavy sampling I/O
# inside the advisory-locked gold-refresh TX and ran unconditionally ~1500x/day.
# We take the MIN age (the table analyzed longest ago) so a table that has gone
# stale forces a refresh even if a sibling was just analyzed.
SELECT_REALTIME_ANALYZE_AGE_SECONDS = text(
    """
    SELECT EXTRACT(
        EPOCH FROM (now() - max(greatest(last_analyze, last_autoanalyze)))
    )::double precision AS age_seconds
    FROM pg_stat_user_tables
    WHERE schemaname = 'silver'
      AND relname IN (
          'rt_feed_snapshots',
          'rt_entities',
          'rt_trip_updates',
          'rt_trip_update_stop_times',
          'rt_vehicle_positions'
      )
    HAVING max(greatest(last_analyze, last_autoanalyze)) IS NOT NULL
    """
)


def _realtime_analyze_is_due(
    connection: Connection, *, min_interval_seconds: int
) -> bool:
    """Return True when the per-cycle realtime-silver ANALYZE should run.

    The ANALYZE is throttled to at most once per ``min_interval_seconds`` so the
    heavy, advisory-locked ANALYZE of the ~500M-row realtime tables no longer
    runs on every ~57s cycle. Per-snapshot upserts filter on a constant
    rt_feed_snapshot_id, so stale stats barely move the plan between refreshes.

    Runs the ANALYZE when the throttle is disabled (interval <= 0) or when the
    realtime tables have never been analyzed (no pg_stat row / NULL age — the
    fresh-DB bootstrap case), and otherwise only once the oldest table's stats
    are at least ``min_interval_seconds`` old.
    """
    if min_interval_seconds <= 0:
        return True
    age_seconds = connection.execute(SELECT_REALTIME_ANALYZE_AGE_SECONDS).scalar()
    if age_seconds is None:
        # No recorded ANALYZE yet (fresh DB, or stats reset) — refresh now.
        return True
    return float(age_seconds) >= float(min_interval_seconds)

DELETE_DIM_DATE = text(
    """
    DELETE FROM gold.dim_date
    WHERE provider_id = :provider_id
    """
)

DELETE_DIM_STOP = text(
    """
    DELETE FROM gold.dim_stop
    WHERE provider_id = :provider_id
    """
)

DELETE_DIM_ROUTE_PATTERN = text(
    """
    DELETE FROM gold.dim_route_pattern
    WHERE provider_id = :provider_id
    """
)

DELETE_DIM_ROUTE = text(
    """
    DELETE FROM gold.dim_route
    WHERE provider_id = :provider_id
    """
)

ACQUIRE_GOLD_BUILD_LOCK = text(
    """
    SELECT pg_advisory_xact_lock(
        hashtext('gold_marts'),
        hashtext(:provider_id)
    )
    """
)

# Empty-silver guard (slice-9.1.1j): refresh_gold_static DELETEs all dims and
# re-INSERTs them from the current version's silver rows. If the current version
# has zero silver.routes rows (the wedged prod state where ingestion flipped
# is_current but the silver load rolled back), an unguarded refresh would wipe
# gold dims and INSERT nothing, then the prune would delete the old version's
# silver too — emptying the static tier. routes.txt is a REQUIRED static member
# and gold.dim_route is the FK-holder at issue, so silver.routes is the right
# sentinel.
SELECT_CURRENT_VERSION_HAS_SILVER_ROUTES = text(
    """
    SELECT EXISTS (
        SELECT 1 FROM silver.routes
        WHERE provider_id = :provider_id
          AND dataset_version_id = :dataset_version_id
    )
    """
)

LOCK_GOLD_TABLES = text(
    """
    LOCK TABLE
        gold.dim_route_pattern,
        gold.dim_route,
        gold.dim_stop,
        gold.dim_date,
        gold.fact_vehicle_snapshot,
        gold.fact_trip_delay_snapshot,
        gold.latest_vehicle_snapshot,
        gold.latest_trip_delay_snapshot
    IN ACCESS EXCLUSIVE MODE
    """
)

INSERT_DIM_ROUTE = text(
    """
    INSERT INTO gold.dim_route (
        provider_id,
        dataset_version_id,
        route_id,
        route_short_name,
        route_long_name,
        route_desc,
        route_desc_detail,
        route_type,
        route_color,
        route_text_color,
        route_sort_order
    )
    SELECT
        provider_id,
        dataset_version_id,
        route_id,
        route_short_name,
        route_long_name,
        route_desc,
        route_desc_detail,
        route_type,
        route_color,
        route_text_color,
        route_sort_order
    FROM silver.routes
    WHERE provider_id = :provider_id
      AND dataset_version_id = :dataset_version_id
    """
)

INSERT_DIM_ROUTE_PATTERN = text(
    """
    INSERT INTO gold.dim_route_pattern (
        provider_id,
        dataset_version_id,
        route_pattern_id,
        route_id,
        direction_id,
        route_pattern_typicality
    )
    SELECT
        provider_id,
        dataset_version_id,
        route_pattern_id,
        route_id,
        direction_id,
        route_pattern_typicality
    FROM silver.route_patterns
    WHERE provider_id = :provider_id
      AND dataset_version_id = :dataset_version_id
    """
)

INSERT_DIM_STOP = text(
    """
    INSERT INTO gold.dim_stop (
        provider_id,
        dataset_version_id,
        stop_id,
        stop_code,
        stop_name,
        parent_station,
        location_type,
        stop_lat,
        stop_lon,
        zone_id,
        wheelchair_boarding,
        platform_code
    )
    SELECT
        provider_id,
        dataset_version_id,
        stop_id,
        stop_code,
        stop_name,
        parent_station,
        location_type,
        stop_lat,
        stop_lon,
        zone_id,
        wheelchair_boarding,
        platform_code
    FROM silver.stops
    WHERE provider_id = :provider_id
      AND dataset_version_id = :dataset_version_id
    """
)

INSERT_DIM_DATE = text(
    """
    WITH service_bounds AS (
        SELECT
            min(start_date) AS min_service_date,
            max(end_date) AS max_service_date
        FROM silver.calendar
        WHERE provider_id = :provider_id
          AND dataset_version_id = :dataset_version_id
    ),
    exception_bounds AS (
        SELECT
            min(service_date) AS min_service_date,
            max(service_date) AS max_service_date
        FROM silver.calendar_dates
        WHERE provider_id = :provider_id
          AND dataset_version_id = :dataset_version_id
    ),
    bounds AS (
        SELECT
            COALESCE(
                LEAST(service_bounds.min_service_date, exception_bounds.min_service_date),
                service_bounds.min_service_date,
                exception_bounds.min_service_date
            ) AS min_service_date,
            COALESCE(
                GREATEST(service_bounds.max_service_date, exception_bounds.max_service_date),
                service_bounds.max_service_date,
                exception_bounds.max_service_date
            ) AS max_service_date
        FROM service_bounds
        CROSS JOIN exception_bounds
    ),
    exception_flags AS (
        SELECT
            service_date,
            true AS has_calendar_exception,
            bool_or(exception_type = 1) AS is_service_added,
            bool_or(exception_type = 2) AS is_service_removed
        FROM silver.calendar_dates
        WHERE provider_id = :provider_id
          AND dataset_version_id = :dataset_version_id
        GROUP BY service_date
    )
    INSERT INTO gold.dim_date (
        provider_id,
        dataset_version_id,
        service_date,
        date_key,
        day_of_week_iso,
        day_name,
        week_of_year,
        month_number,
        month_name,
        quarter_number,
        year_number,
        is_weekend,
        has_calendar_exception,
        is_service_added,
        is_service_removed
    )
    SELECT
        :provider_id,
        :dataset_version_id,
        gs.service_date::date AS service_date,
        to_char(gs.service_date::date, 'YYYYMMDD')::integer AS date_key,
        extract(isodow from gs.service_date)::integer AS day_of_week_iso,
        trim(to_char(gs.service_date::date, 'Day')) AS day_name,
        extract(week from gs.service_date)::integer AS week_of_year,
        extract(month from gs.service_date)::integer AS month_number,
        trim(to_char(gs.service_date::date, 'Month')) AS month_name,
        extract(quarter from gs.service_date)::integer AS quarter_number,
        extract(year from gs.service_date)::integer AS year_number,
        (extract(isodow from gs.service_date) in (6, 7)) AS is_weekend,
        COALESCE(exception_flags.has_calendar_exception, false) AS has_calendar_exception,
        COALESCE(exception_flags.is_service_added, false) AS is_service_added,
        COALESCE(exception_flags.is_service_removed, false) AS is_service_removed
    FROM bounds
    CROSS JOIN LATERAL generate_series(
        bounds.min_service_date,
        bounds.max_service_date,
        interval '1 day'
    ) AS gs(service_date)
    LEFT JOIN exception_flags
        ON exception_flags.service_date = gs.service_date::date
    WHERE bounds.min_service_date IS NOT NULL
      AND bounds.max_service_date IS NOT NULL
    """
)


# --- dim name history (slice-9.1.1u) -------------------------------------
# Append-only SCD-lite writers for gold.dim_route_history / dim_stop_history.
# Diffed against the NEW-version silver rows (never the old version: the
# per-cycle silver prune deletes the previous dataset within ~one realtime
# cycle of a GTFS edition flip). CLOSE must run before OPEN on the same
# connection; rerunning with the same dataset version is a no-op.

CLOSE_DIM_ROUTE_HISTORY = text(
    """
    UPDATE gold.dim_route_history AS h
    SET valid_to_utc = now()
    WHERE h.provider_id = :provider_id
      AND h.valid_to_utc IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM silver.routes AS r
          WHERE r.provider_id = h.provider_id
            AND r.dataset_version_id = :dataset_version_id
            AND r.route_id = h.route_id
            AND r.route_short_name IS NOT DISTINCT FROM h.route_short_name
            AND r.route_long_name IS NOT DISTINCT FROM h.route_long_name
            AND r.route_color IS NOT DISTINCT FROM h.route_color
            AND r.route_type IS NOT DISTINCT FROM h.route_type
      )
    """
)

OPEN_DIM_ROUTE_HISTORY = text(
    """
    INSERT INTO gold.dim_route_history (
        provider_id,
        route_id,
        route_short_name,
        route_long_name,
        route_color,
        route_type,
        valid_from_utc,
        valid_to_utc,
        last_seen_dataset_version_id
    )
    SELECT
        r.provider_id,
        r.route_id,
        r.route_short_name,
        r.route_long_name,
        r.route_color,
        r.route_type,
        now(),
        NULL,
        r.dataset_version_id
    FROM silver.routes AS r
    WHERE r.provider_id = :provider_id
      AND r.dataset_version_id = :dataset_version_id
      AND NOT EXISTS (
          SELECT 1
          FROM gold.dim_route_history AS h
          WHERE h.provider_id = r.provider_id
            AND h.route_id = r.route_id
            AND h.valid_to_utc IS NULL
      )
    """
)

CLOSE_DIM_STOP_HISTORY = text(
    """
    UPDATE gold.dim_stop_history AS h
    SET valid_to_utc = now()
    WHERE h.provider_id = :provider_id
      AND h.valid_to_utc IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM silver.stops AS s
          WHERE s.provider_id = h.provider_id
            AND s.dataset_version_id = :dataset_version_id
            AND s.stop_id = h.stop_id
            AND s.stop_name IS NOT DISTINCT FROM h.stop_name
            AND s.stop_lat IS NOT DISTINCT FROM h.stop_lat
            AND s.stop_lon IS NOT DISTINCT FROM h.stop_lon
      )
    """
)

OPEN_DIM_STOP_HISTORY = text(
    """
    INSERT INTO gold.dim_stop_history (
        provider_id,
        stop_id,
        stop_name,
        stop_lat,
        stop_lon,
        valid_from_utc,
        valid_to_utc,
        last_seen_dataset_version_id
    )
    SELECT
        s.provider_id,
        s.stop_id,
        s.stop_name,
        s.stop_lat,
        s.stop_lon,
        now(),
        NULL,
        s.dataset_version_id
    FROM silver.stops AS s
    WHERE s.provider_id = :provider_id
      AND s.dataset_version_id = :dataset_version_id
      AND NOT EXISTS (
          SELECT 1
          FROM gold.dim_stop_history AS h
          WHERE h.provider_id = s.provider_id
            AND h.stop_id = s.stop_id
            AND h.valid_to_utc IS NULL
      )
    """
)


# --- schedule-version service summary (migration 0069) -------------------
# Append-only, permanent per-GTFS-edition scheduled-service preservation keyed
# by (provider_id, dataset_version_id, route_id, day_type). Written INSIDE
# refresh_gold_static from the NEW version's silver.calendar/trips/stop_times
# while the OLD version's silver still exists (deferred-prune window). Idempotent:
# DELETE-by-full-dataset_version then INSERT, so re-running the same edition
# re-writes identical rows. Never pruned — permanent edition history.
DELETE_SCHEDULE_VERSION_SERVICE_SUMMARY = text(
    """
    DELETE FROM gold.schedule_version_service_summary
    WHERE provider_id = :provider_id
      AND dataset_version_id = :dataset_version_id
    """
)

INSERT_SCHEDULE_VERSION_SERVICE_SUMMARY = text(
    """
    WITH svc AS (
        -- each service_id -> its day_type memberships (weekday OR any weekday
        -- boolean; saturday; sunday). MEMBERSHIP, not partition: a 7-day service
        -- maps to all three, so its trips count under each.
        SELECT
            service_id,
            (monday OR tuesday OR wednesday OR thursday OR friday) AS is_weekday,
            saturday AS is_saturday,
            sunday AS is_sunday,
            start_date,
            end_date
        FROM silver.calendar
        WHERE provider_id = :provider_id
          AND dataset_version_id = :dataset_version_id
    ),
    svc_day AS (
        -- explode service_id x day_type membership.
        SELECT service_id, dt.day_type, start_date, end_date
        FROM svc
        CROSS JOIN LATERAL (VALUES
            ('weekday', is_weekday),
            ('saturday', is_saturday),
            ('sunday', is_sunday)
        ) AS dt(day_type, member)
        WHERE dt.member
    ),
    trip_dep AS (
        -- per trip: route, service, min/max departure in GTFS service-seconds.
        -- split_part preserves >24:00:00 overnight times as raw service-seconds
        -- (never wrapped past service-midnight); relies on the silver loader
        -- validating HH:MM:SS (_validate_gtfs_service_time). departure_time IS
        -- NOT NULL is enforced.
        SELECT
            t.route_id,
            t.service_id,
            t.trip_id,
            MIN(
                split_part(st.departure_time, ':', 1)::int * 3600
                + split_part(st.departure_time, ':', 2)::int * 60
                + split_part(st.departure_time, ':', 3)::int
            ) AS first_dep,
            MAX(
                split_part(st.departure_time, ':', 1)::int * 3600
                + split_part(st.departure_time, ':', 2)::int * 60
                + split_part(st.departure_time, ':', 3)::int
            ) AS last_dep
        FROM silver.trips AS t
        JOIN silver.stop_times AS st
            ON st.dataset_version_id = t.dataset_version_id
           AND st.trip_id = t.trip_id
        WHERE t.provider_id = :provider_id
          AND t.dataset_version_id = :dataset_version_id
          AND st.departure_time IS NOT NULL
        GROUP BY t.route_id, t.service_id, t.trip_id
    ),
    route_day_stops AS (
        -- distinct stop_id per route x day_type (NOT a SUM of per-trip counts,
        -- which would over-count shared stops).
        SELECT td.route_id, sd.day_type, COUNT(DISTINCT st.stop_id) AS stop_ct
        FROM silver.trips AS t
        JOIN silver.stop_times AS st
            ON st.dataset_version_id = t.dataset_version_id
           AND st.trip_id = t.trip_id
        JOIN trip_dep AS td ON td.trip_id = t.trip_id
        JOIN svc_day AS sd ON sd.service_id = t.service_id
        WHERE t.provider_id = :provider_id
          AND t.dataset_version_id = :dataset_version_id
        GROUP BY td.route_id, sd.day_type
    ),
    exc AS (
        -- honest calendar_dates exception counts per service_id (holiday/added
        -- service signal; NOT resolved into day_type in v1).
        SELECT
            service_id,
            COUNT(*) FILTER (WHERE exception_type = 1) AS added_ct,
            COUNT(*) FILTER (WHERE exception_type = 2) AS removed_ct
        FROM silver.calendar_dates
        WHERE provider_id = :provider_id
          AND dataset_version_id = :dataset_version_id
        GROUP BY service_id
    ),
    route_day_exceptions AS (
        -- exception counts per route x day_type: exc joined at DISTINCT
        -- (route_id, day_type, service_id) membership grain, NOT per-trip.
        -- summing on trip_dep would multiply each service's exc counts by its
        -- trip count and inflate this never-pruned permanent-history table.
        SELECT
            rds.route_id,
            rds.day_type,
            COALESCE(SUM(exc.added_ct), 0) AS added_ct,
            COALESCE(SUM(exc.removed_ct), 0) AS removed_ct
        FROM (
            SELECT DISTINCT td.route_id, sd.day_type, td.service_id
            FROM trip_dep AS td
            JOIN svc_day AS sd ON sd.service_id = td.service_id
        ) AS rds
        LEFT JOIN exc ON exc.service_id = rds.service_id
        GROUP BY rds.route_id, rds.day_type
    )
    INSERT INTO gold.schedule_version_service_summary (
        provider_id,
        dataset_version_id,
        route_id,
        day_type,
        scheduled_trip_count,
        stop_count,
        first_departure_seconds,
        last_departure_seconds,
        span_minutes,
        calendar_start_date,
        calendar_end_date,
        service_added_exception_count,
        service_removed_exception_count,
        scheduled_median_headway_min,
        scheduled_p10_headway_min,
        scheduled_p90_headway_min,
        built_at_utc
    )
    SELECT
        :provider_id,
        :dataset_version_id,
        td.route_id,
        sd.day_type,
        COUNT(DISTINCT td.trip_id),
        COALESCE(MAX(rds.stop_ct), 0),
        MIN(td.first_dep),
        MAX(td.last_dep),
        (MAX(td.last_dep) - MIN(td.first_dep)) / 60,
        MIN(sd.start_date),
        MAX(sd.end_date),
        COALESCE(MAX(rde.added_ct), 0),
        COALESCE(MAX(rde.removed_ct), 0),
        NULL,
        NULL,
        NULL,
        now()
    FROM trip_dep AS td
    JOIN svc_day AS sd ON sd.service_id = td.service_id
    LEFT JOIN route_day_stops AS rds
        ON rds.route_id = td.route_id AND rds.day_type = sd.day_type
    LEFT JOIN route_day_exceptions AS rde
        ON rde.route_id = td.route_id AND rde.day_type = sd.day_type
    GROUP BY td.route_id, sd.day_type
    """
)


def _vehicle_snapshot_statement(
    *,
    target_table: str,
    latest_only: bool,
    upsert: bool,
):
    if target_table not in {"fact_vehicle_snapshot", "latest_vehicle_snapshot"}:
        raise ValueError(f"Unsupported gold vehicle snapshot table '{target_table}'.")
    latest_snapshot_filter = (
        "AND rfs.source_realtime_snapshot_id = :realtime_snapshot_id" if latest_only else ""
    )
    on_conflict_clause = (
        """
        ON CONFLICT (provider_id, realtime_snapshot_id, entity_index) DO UPDATE SET
            snapshot_date_key = EXCLUDED.snapshot_date_key,
            snapshot_local_date = EXCLUDED.snapshot_local_date,
            feed_timestamp_utc = EXCLUDED.feed_timestamp_utc,
            captured_at_utc = EXCLUDED.captured_at_utc,
            position_timestamp_utc = EXCLUDED.position_timestamp_utc,
            entity_id = EXCLUDED.entity_id,
            vehicle_id = EXCLUDED.vehicle_id,
            trip_id = EXCLUDED.trip_id,
            route_id = EXCLUDED.route_id,
            stop_id = EXCLUDED.stop_id,
            current_stop_sequence = EXCLUDED.current_stop_sequence,
            current_status = EXCLUDED.current_status,
            occupancy_status = EXCLUDED.occupancy_status,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            bearing = EXCLUDED.bearing,
            speed = EXCLUDED.speed
        """
        if upsert
        else ""
    )
    return text(
        f"""
        INSERT INTO gold.{target_table} (
            provider_id,
            realtime_snapshot_id,
            entity_index,
            snapshot_date_key,
            snapshot_local_date,
            feed_timestamp_utc,
            captured_at_utc,
            position_timestamp_utc,
            entity_id,
            vehicle_id,
            trip_id,
            route_id,
            stop_id,
            current_stop_sequence,
            current_status,
            occupancy_status,
            latitude,
            longitude,
            bearing,
            speed
        )
        SELECT
            vp.provider_id,
            rfs.source_realtime_snapshot_id AS realtime_snapshot_id,
            vp.entity_index,
            to_char(timezone(:provider_timezone, vp.feed_timestamp_utc), 'YYYYMMDD')::integer,
            timezone(:provider_timezone, vp.feed_timestamp_utc)::date,
            vp.feed_timestamp_utc,
            vp.captured_at_utc,
            vp.vehicle_timestamp_utc,
            rte.entity_id,
            vp.vehicle_id,
            vp.trip_id,
            vp.route_id,
            vp.stop_id,
            vp.current_stop_sequence,
            vp.current_status,
            vp.occupancy_status,
            vp.latitude,
            vp.longitude,
            vp.bearing,
            vp.speed
        FROM silver.rt_vehicle_positions AS vp
        INNER JOIN silver.rt_feed_snapshots AS rfs
            ON rfs.rt_feed_snapshot_id = vp.rt_feed_snapshot_id
           AND rfs.provider_id = vp.provider_id
           AND rfs.endpoint_key = 'vehicle_positions'
        LEFT JOIN silver.rt_entities AS rte
            ON rte.rt_feed_snapshot_id = vp.rt_feed_snapshot_id
           AND rte.entity_index = vp.entity_index
        WHERE vp.provider_id = :provider_id
          AND rfs.source_realtime_snapshot_id IS NOT NULL
          {latest_snapshot_filter}
        {on_conflict_clause}
        """
    )


def _trip_delay_snapshot_statement(
    *,
    target_table: str,
    latest_only: bool,
    upsert: bool,
):
    if target_table not in {"fact_trip_delay_snapshot", "latest_trip_delay_snapshot"}:
        raise ValueError(f"Unsupported gold trip delay snapshot table '{target_table}'.")
    latest_snapshot_filter = (
        "AND rfs.source_realtime_snapshot_id = :realtime_snapshot_id" if latest_only else ""
    )
    # The per-cycle refresh must not aggregate the whole 14-day
    # rt_trip_update_stop_times table (prod: ~252M rows / 29 GB -> ~691s
    # cycles); scope the counts CTE to the snapshot being refreshed. The
    # full-rebuild path repopulates every retained snapshot, so it keeps the
    # unscoped aggregate.
    stop_time_counts_scope_join = (
        """
            INNER JOIN silver.rt_feed_snapshots AS sfs
                ON sfs.rt_feed_snapshot_id = stc.rt_feed_snapshot_id
               AND sfs.provider_id = stc.provider_id
               AND sfs.endpoint_key = 'trip_updates'
               AND sfs.source_realtime_snapshot_id = :realtime_snapshot_id
        """
        if latest_only
        else ""
    )
    on_conflict_clause = (
        """
        ON CONFLICT (provider_id, realtime_snapshot_id, entity_index) DO UPDATE SET
            snapshot_date_key = EXCLUDED.snapshot_date_key,
            snapshot_local_date = EXCLUDED.snapshot_local_date,
            feed_timestamp_utc = EXCLUDED.feed_timestamp_utc,
            captured_at_utc = EXCLUDED.captured_at_utc,
            entity_id = EXCLUDED.entity_id,
            trip_id = EXCLUDED.trip_id,
            route_id = EXCLUDED.route_id,
            direction_id = EXCLUDED.direction_id,
            start_date = EXCLUDED.start_date,
            vehicle_id = EXCLUDED.vehicle_id,
            occupancy_status = EXCLUDED.occupancy_status,
            trip_schedule_relationship = EXCLUDED.trip_schedule_relationship,
            delay_seconds = EXCLUDED.delay_seconds,
            stop_time_update_count = EXCLUDED.stop_time_update_count,
            skipped_stop_count = EXCLUDED.skipped_stop_count,
            delay_stop_id = EXCLUDED.delay_stop_id,
            delay_stop_sequence = EXCLUDED.delay_stop_sequence
        """
        if upsert
        else ""
    )
    return text(
        f"""
        WITH stop_time_counts AS (
            SELECT
                stc.rt_feed_snapshot_id,
                stc.entity_index,
                count(*)::integer AS stop_time_update_count,
                -- GTFS-RT StopTimeUpdate.ScheduleRelationship SKIPPED = 1 (stop-level,
                -- distinct from the trip-level CANCELED = 3); NULL = SCHEDULED.
                count(*) FILTER (WHERE stc.schedule_relationship = 1)::integer
                    AS skipped_stop_count
            FROM silver.rt_trip_update_stop_times AS stc
            {stop_time_counts_scope_join}
            WHERE stc.provider_id = :provider_id
            GROUP BY stc.rt_feed_snapshot_id, stc.entity_index
        ),
        stop_time_candidates AS (
            SELECT
                rfs.source_realtime_snapshot_id AS realtime_snapshot_id,
                rtu.rt_feed_snapshot_id,
                rtu.entity_index,
                COALESCE(stu.stop_id, st.stop_id) AS delay_stop_id,
                stu.stop_sequence AS delay_stop_sequence,
                EXTRACT(
                    EPOCH FROM (
                        COALESCE(stu.arrival_time_utc, stu.departure_time_utc)
                        - (
                            -- GTFS service times are elapsed offsets from the
                            -- noon-minus-12h service-day anchor; slice-9.1.1g
                            -- keeps DST gap/repeated-hour days honest.
                            timezone(
                                :provider_timezone,
                                rtu.start_date::timestamp + interval '12 hours'
                            )
                            - interval '12 hours'
                            + make_interval(
                                hours => split_part(
                                    COALESCE(st.arrival_time, st.departure_time),
                                    ':',
                                    1
                                )::integer,
                                mins => split_part(
                                    COALESCE(st.arrival_time, st.departure_time),
                                    ':',
                                    2
                                )::integer,
                                secs => split_part(
                                    COALESCE(st.arrival_time, st.departure_time),
                                    ':',
                                    3
                                )::integer
                            )
                        )
                    )
                )::integer AS derived_delay_seconds,
                row_number() OVER (
                    PARTITION BY rtu.rt_feed_snapshot_id, rtu.entity_index
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
            INNER JOIN silver.rt_trip_update_stop_times AS stu
                ON stu.provider_id = rtu.provider_id
               AND stu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
               AND stu.entity_index = rtu.entity_index
            INNER JOIN silver.stop_times AS st
                ON st.provider_id = rtu.provider_id
               AND st.dataset_version_id = :dataset_version_id
               AND st.trip_id = rtu.trip_id
               AND st.stop_sequence = stu.stop_sequence
            WHERE rtu.provider_id = :provider_id
              AND rfs.source_realtime_snapshot_id IS NOT NULL
              AND rtu.start_date IS NOT NULL
              AND COALESCE(stu.arrival_time_utc, stu.departure_time_utc) IS NOT NULL
              AND COALESCE(st.arrival_time, st.departure_time) IS NOT NULL
              {latest_snapshot_filter}
        ),
        trip_delay_fallback AS (
            SELECT
                rt_feed_snapshot_id,
                entity_index,
                derived_delay_seconds,
                delay_stop_id,
                delay_stop_sequence
            FROM stop_time_candidates
            -- delay_rank = 1 is the next upcoming stop, matching the delay_seconds source.
            WHERE delay_rank = 1
        )
        INSERT INTO gold.{target_table} (
            provider_id,
            realtime_snapshot_id,
            entity_index,
            snapshot_date_key,
            snapshot_local_date,
            feed_timestamp_utc,
            captured_at_utc,
            entity_id,
            trip_id,
            route_id,
            direction_id,
            start_date,
            vehicle_id,
            occupancy_status,
            trip_schedule_relationship,
            delay_seconds,
            stop_time_update_count,
            skipped_stop_count,
            delay_stop_id,
            delay_stop_sequence
        )
        SELECT
            rtu.provider_id,
            rfs.source_realtime_snapshot_id AS realtime_snapshot_id,
            rtu.entity_index,
            to_char(timezone(:provider_timezone, rtu.feed_timestamp_utc), 'YYYYMMDD')::integer,
            timezone(:provider_timezone, rtu.feed_timestamp_utc)::date,
            rtu.feed_timestamp_utc,
            rtu.captured_at_utc,
            rte.entity_id,
            rtu.trip_id,
            rtu.route_id,
            rtu.direction_id,
            rtu.start_date,
            vpm.vehicle_id,
            vpm.occupancy_status,
            rtu.schedule_relationship AS trip_schedule_relationship,
            tdf.derived_delay_seconds,
            COALESCE(stc.stop_time_update_count, 0),
            COALESCE(stc.skipped_stop_count, 0),
            tdf.delay_stop_id,
            tdf.delay_stop_sequence
        FROM silver.rt_trip_updates AS rtu
        INNER JOIN silver.rt_feed_snapshots AS rfs
            ON rfs.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
           AND rfs.provider_id = rtu.provider_id
           AND rfs.endpoint_key = 'trip_updates'
        LEFT JOIN silver.rt_entities AS rte
            ON rte.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
           AND rte.entity_index = rtu.entity_index
        LEFT JOIN stop_time_counts AS stc
          ON stc.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
         AND stc.entity_index = rtu.entity_index
        LEFT JOIN trip_delay_fallback AS tdf
          ON tdf.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
         AND tdf.entity_index = rtu.entity_index
        LEFT JOIN LATERAL (
            SELECT
                vp.vehicle_id,
                vp.occupancy_status
            FROM silver.rt_vehicle_positions AS vp
            INNER JOIN silver.rt_feed_snapshots AS vp_rfs
                ON vp_rfs.rt_feed_snapshot_id = vp.rt_feed_snapshot_id
               AND vp_rfs.provider_id = vp.provider_id
               AND vp_rfs.endpoint_key = 'vehicle_positions'
            WHERE vp.provider_id = rtu.provider_id
              AND vp.trip_id = rtu.trip_id
              AND vp.vehicle_id IS NOT NULL
              AND (rtu.route_id IS NULL OR vp.route_id = rtu.route_id)
              AND vp.feed_timestamp_utc BETWEEN
                    rtu.feed_timestamp_utc - interval '10 minutes'
                AND rtu.feed_timestamp_utc + interval '10 minutes'
            ORDER BY
                abs(EXTRACT(EPOCH FROM (vp.feed_timestamp_utc - rtu.feed_timestamp_utc))),
                vp_rfs.source_realtime_snapshot_id DESC NULLS LAST,
                vp.entity_index
            LIMIT 1
        ) AS vpm
          ON rtu.trip_id IS NOT NULL
        WHERE rtu.provider_id = :provider_id
          AND rfs.source_realtime_snapshot_id IS NOT NULL
          {latest_snapshot_filter}
        {on_conflict_clause}
        """
    )


INSERT_FACT_VEHICLE_SNAPSHOT = _vehicle_snapshot_statement(
    target_table="fact_vehicle_snapshot",
    latest_only=False,
    upsert=False,
)

UPSERT_FACT_VEHICLE_SNAPSHOT_LATEST = _vehicle_snapshot_statement(
    target_table="fact_vehicle_snapshot",
    latest_only=True,
    upsert=True,
)

INSERT_FACT_TRIP_DELAY_SNAPSHOT = _trip_delay_snapshot_statement(
    target_table="fact_trip_delay_snapshot",
    latest_only=False,
    upsert=False,
)

UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST = _trip_delay_snapshot_statement(
    target_table="fact_trip_delay_snapshot",
    latest_only=True,
    upsert=True,
)

INSERT_LATEST_VEHICLE_SNAPSHOT_FROM_FACT = text(
    """
    INSERT INTO gold.latest_vehicle_snapshot
    SELECT *
    FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
      AND realtime_snapshot_id = :realtime_snapshot_id
    """
)

INSERT_LATEST_TRIP_DELAY_SNAPSHOT_FROM_FACT = text(
    """
    INSERT INTO gold.latest_trip_delay_snapshot
    SELECT *
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
      AND realtime_snapshot_id = :realtime_snapshot_id
    """
)


@dataclass(frozen=True)
class GoldBuildContext:
    provider_id: str
    provider_timezone: str
    dataset_version_id: int
    latest_trip_updates_snapshot_id: int | None
    latest_vehicle_snapshot_id: int | None


@dataclass(frozen=True)
class GoldBuildResult:
    provider_id: str
    provider_timezone: str
    dataset_version_id: int
    latest_trip_updates_snapshot_id: int | None
    latest_vehicle_snapshot_id: int | None
    built_at_utc: datetime
    row_counts: dict[str, int]

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["built_at_utc"] = self.built_at_utc.isoformat()
        return payload


@dataclass(frozen=True)
class GoldRealtimeRefreshResult:
    provider_id: str
    provider_timezone: str
    dataset_version_id: int
    latest_trip_updates_snapshot_id: int | None
    latest_vehicle_snapshot_id: int | None
    refreshed_at_utc: datetime
    row_counts: dict[str, int]

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["refreshed_at_utc"] = self.refreshed_at_utc.isoformat()
        return payload


@dataclass(frozen=True)
class GoldStaticRefreshResult:
    provider_id: str
    provider_timezone: str
    dataset_version_id: int
    refreshed_at_utc: datetime
    row_counts: dict[str, int]

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["refreshed_at_utc"] = self.refreshed_at_utc.isoformat()
        return payload


def _table_name(table_name: str) -> str:
    allowed_names = {
        "dim_route",
        "dim_route_pattern",
        "dim_stop",
        "dim_date",
        "dim_route_history",
        "dim_stop_history",
        "fact_vehicle_snapshot",
        "fact_trip_delay_snapshot",
        "latest_vehicle_snapshot",
        "latest_trip_delay_snapshot",
    }
    if table_name not in allowed_names:
        raise ValueError(f"Unsupported gold table '{table_name}'.")
    return table_name


def _resolve_gold_build_context(
    connection: Connection,
    *,
    provider_id: str,
    provider_timezone: str,
) -> GoldBuildContext:
    dataset_row = connection.execute(
        text(
            """
            SELECT dataset_version_id
            FROM core.dataset_versions
            WHERE provider_id = :provider_id
              AND dataset_kind = 'static_schedule'
              AND is_current = true
            ORDER BY loaded_at_utc DESC, dataset_version_id DESC
            LIMIT 1
            """
        ),
        {"provider_id": provider_id},
    ).mappings().one_or_none()

    if dataset_row is None:
        raise ValueError(
            "No current static Silver dataset was found for this provider. "
            "Run load-static-silver before build-gold-marts."
        )

    latest_trip_updates_snapshot_id = connection.execute(
        text(
            """
            SELECT max(source_realtime_snapshot_id)
            FROM silver.rt_feed_snapshots
            WHERE provider_id = :provider_id
              AND endpoint_key = 'trip_updates'
              AND source_realtime_snapshot_id IS NOT NULL
            """
        ),
        {"provider_id": provider_id},
    ).scalar_one()
    latest_vehicle_snapshot_id = connection.execute(
        text(
            """
            SELECT max(source_realtime_snapshot_id)
            FROM silver.rt_feed_snapshots
            WHERE provider_id = :provider_id
              AND endpoint_key = 'vehicle_positions'
              AND source_realtime_snapshot_id IS NOT NULL
            """
        ),
        {"provider_id": provider_id},
    ).scalar_one()

    return GoldBuildContext(
        provider_id=provider_id,
        provider_timezone=provider_timezone,
        dataset_version_id=int(dataset_row["dataset_version_id"]),
        latest_trip_updates_snapshot_id=(
            int(latest_trip_updates_snapshot_id)
            if latest_trip_updates_snapshot_id is not None
            else None
        ),
        latest_vehicle_snapshot_id=(
            int(latest_vehicle_snapshot_id) if latest_vehicle_snapshot_id is not None else None
        ),
    )


def _delete_existing_provider_rows(connection: Connection, *, provider_id: str) -> None:
    params = {"provider_id": provider_id}
    connection.execute(DELETE_FACT_TRIP_DELAY_SNAPSHOT, params)
    connection.execute(DELETE_FACT_VEHICLE_SNAPSHOT, params)
    connection.execute(DELETE_LATEST_TRIP_DELAY_SNAPSHOT, params)
    connection.execute(DELETE_LATEST_VEHICLE_SNAPSHOT, params)
    connection.execute(DELETE_DIM_DATE, params)
    connection.execute(DELETE_DIM_STOP, params)
    connection.execute(DELETE_DIM_ROUTE_PATTERN, params)
    connection.execute(DELETE_DIM_ROUTE, params)


def _count_gold_rows(connection: Connection, *, provider_id: str, table_name: str) -> int:
    resolved_table_name = _table_name(table_name)
    result = connection.execute(
        text(
            f"""
            SELECT count(*)
            FROM gold.{resolved_table_name}
            WHERE provider_id = :provider_id
            """
        ),
        {"provider_id": provider_id},
    )
    return int(result.scalar_one())


def _safe_rowcount(result) -> int:  # noqa: ANN001
    rowcount = getattr(result, "rowcount", 0)
    return max(int(rowcount or 0), 0)


def _refresh_gold_dimensions(connection: Connection, *, context: GoldBuildContext) -> None:
    params = {
        "provider_id": context.provider_id,
        "provider_timezone": context.provider_timezone,
        "dataset_version_id": context.dataset_version_id,
    }
    connection.execute(DELETE_DIM_DATE, {"provider_id": context.provider_id})
    connection.execute(DELETE_DIM_STOP, {"provider_id": context.provider_id})
    connection.execute(DELETE_DIM_ROUTE_PATTERN, {"provider_id": context.provider_id})
    connection.execute(DELETE_DIM_ROUTE, {"provider_id": context.provider_id})
    connection.execute(INSERT_DIM_ROUTE, params)
    connection.execute(INSERT_DIM_ROUTE_PATTERN, params)
    connection.execute(INSERT_DIM_STOP, params)
    connection.execute(INSERT_DIM_DATE, params)
    _record_dim_name_history(connection, context=context)
    _record_schedule_version_service_summary(connection, context=context)


def _record_dim_name_history(connection: Connection, *, context: GoldBuildContext) -> None:
    """Maintain the append-only name-history tables from new-version silver.

    CLOSE before OPEN, per entity: a renamed/retired id gets its open row
    closed first, then (if still present in silver) a fresh open row. Both
    statement pairs are no-ops when rerun for the same dataset version.
    History rows are never deleted here or anywhere else in the refresh paths.
    """
    params = {
        "provider_id": context.provider_id,
        "dataset_version_id": context.dataset_version_id,
    }
    connection.execute(CLOSE_DIM_ROUTE_HISTORY, params)
    connection.execute(OPEN_DIM_ROUTE_HISTORY, params)
    connection.execute(CLOSE_DIM_STOP_HISTORY, params)
    connection.execute(OPEN_DIM_STOP_HISTORY, params)


def _record_schedule_version_service_summary(
    connection: Connection, *, context: GoldBuildContext
) -> None:
    """Preserve the NEW GTFS edition's scheduled service (migration 0069).

    Reads the current version's silver.calendar/trips/stop_times/calendar_dates
    while they still exist (the per-cycle silver prune defers the old version
    until dims re-point). Idempotent per edition: DELETE-by-full-dataset_version
    then INSERT, so a re-run of the same version re-writes identical rows.
    day_type is a MEMBERSHIP model — a 7-day service's trips count under weekday,
    saturday AND sunday. Never pruned (permanent edition history).
    """
    params = {
        "provider_id": context.provider_id,
        "dataset_version_id": context.dataset_version_id,
    }
    connection.execute(DELETE_SCHEDULE_VERSION_SERVICE_SUMMARY, params)
    connection.execute(INSERT_SCHEDULE_VERSION_SERVICE_SUMMARY, params)


def _refresh_latest_gold_tables(
    connection: Connection,
    *,
    context: GoldBuildContext,
) -> dict[str, int]:
    params = {"provider_id": context.provider_id}
    connection.execute(DELETE_LATEST_VEHICLE_SNAPSHOT, params)
    connection.execute(DELETE_LATEST_TRIP_DELAY_SNAPSHOT, params)

    if context.latest_vehicle_snapshot_id is not None:
        connection.execute(
            INSERT_LATEST_VEHICLE_SNAPSHOT_FROM_FACT,
            {
                **params,
                "realtime_snapshot_id": context.latest_vehicle_snapshot_id,
            },
        )
    if context.latest_trip_updates_snapshot_id is not None:
        connection.execute(
            INSERT_LATEST_TRIP_DELAY_SNAPSHOT_FROM_FACT,
            {
                **params,
                "realtime_snapshot_id": context.latest_trip_updates_snapshot_id,
            },
        )

    return {
        "latest_vehicle_snapshot": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="latest_vehicle_snapshot",
        ),
        "latest_trip_delay_snapshot": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="latest_trip_delay_snapshot",
        ),
    }


def _refresh_gold_tables(
    connection: Connection,
    *,
    context: GoldBuildContext,
) -> dict[str, int]:
    params = {
        "provider_id": context.provider_id,
        "provider_timezone": context.provider_timezone,
        "dataset_version_id": context.dataset_version_id,
    }
    connection.execute(ACQUIRE_GOLD_BUILD_LOCK, {"provider_id": context.provider_id})
    connection.execute(LOCK_GOLD_TABLES)
    _delete_existing_provider_rows(connection, provider_id=context.provider_id)
    connection.execute(INSERT_DIM_ROUTE, params)
    connection.execute(INSERT_DIM_ROUTE_PATTERN, params)
    connection.execute(INSERT_DIM_STOP, params)
    connection.execute(INSERT_DIM_DATE, params)
    _record_dim_name_history(connection, context=context)
    _record_schedule_version_service_summary(connection, context=context)
    connection.execute(INSERT_FACT_VEHICLE_SNAPSHOT, params)
    connection.execute(INSERT_FACT_TRIP_DELAY_SNAPSHOT, params)
    latest_row_counts = _refresh_latest_gold_tables(connection, context=context)

    return {
        "dim_route": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="dim_route",
        ),
        "dim_route_pattern": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="dim_route_pattern",
        ),
        "dim_stop": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="dim_stop",
        ),
        "dim_date": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="dim_date",
        ),
        "fact_vehicle_snapshot": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="fact_vehicle_snapshot",
        ),
        "fact_trip_delay_snapshot": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="fact_trip_delay_snapshot",
        ),
        "dim_route_history": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="dim_route_history",
        ),
        "dim_stop_history": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="dim_stop_history",
        ),
    } | latest_row_counts


def build_gold_marts(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> GoldBuildResult:
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(settings=settings)
    manifest = registry.get_provider(provider_id)
    provider_timezone = manifest.provider.timezone
    engine = engine or make_engine(settings)

    with engine.begin() as connection:
        context = _resolve_gold_build_context(
            connection,
            provider_id=manifest.provider.provider_id,
            provider_timezone=provider_timezone,
        )
        row_counts = _refresh_gold_tables(connection, context=context)
        built_at_utc = utc_now()

    return GoldBuildResult(
        provider_id=context.provider_id,
        provider_timezone=context.provider_timezone,
        dataset_version_id=context.dataset_version_id,
        latest_trip_updates_snapshot_id=context.latest_trip_updates_snapshot_id,
        latest_vehicle_snapshot_id=context.latest_vehicle_snapshot_id,
        built_at_utc=built_at_utc,
        row_counts=row_counts,
    )


def refresh_gold_realtime(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> GoldRealtimeRefreshResult:
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(settings=settings)
    manifest = registry.get_provider(provider_id)
    provider_timezone = manifest.provider.timezone
    engine = engine or make_engine(settings)

    with engine.begin() as connection:
        context = _resolve_gold_build_context(
            connection,
            provider_id=manifest.provider.provider_id,
            provider_timezone=provider_timezone,
        )
        connection.execute(ACQUIRE_GOLD_BUILD_LOCK, {"provider_id": context.provider_id})

        params = {
            "provider_id": context.provider_id,
            "provider_timezone": context.provider_timezone,
            "dataset_version_id": context.dataset_version_id,
        }
        fact_row_counts = {
            "fact_vehicle_snapshot_upserted": 0,
            "fact_trip_delay_snapshot_upserted": 0,
        }
        # Throttled: the heavy realtime-silver ANALYZE no longer runs every
        # ~57s cycle (the per-cycle 500M-row ANALYZE hot-path), only once its
        # stats are older than GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS.
        if _realtime_analyze_is_due(
            connection,
            min_interval_seconds=settings.GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS,
        ):
            connection.execute(ANALYZE_REALTIME_SILVER_TABLES)
        if context.latest_vehicle_snapshot_id is not None:
            fact_row_counts["fact_vehicle_snapshot_upserted"] = _safe_rowcount(
                connection.execute(
                    UPSERT_FACT_VEHICLE_SNAPSHOT_LATEST,
                    {
                        **params,
                        "realtime_snapshot_id": context.latest_vehicle_snapshot_id,
                    },
                )
            )
        if context.latest_trip_updates_snapshot_id is not None:
            fact_row_counts["fact_trip_delay_snapshot_upserted"] = _safe_rowcount(
                connection.execute(
                    UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST,
                    {
                        **params,
                        "realtime_snapshot_id": context.latest_trip_updates_snapshot_id,
                    },
                )
            )
        latest_row_counts = _refresh_latest_gold_tables(connection, context=context)
        refreshed_at_utc = utc_now()

    return GoldRealtimeRefreshResult(
        provider_id=context.provider_id,
        provider_timezone=context.provider_timezone,
        dataset_version_id=context.dataset_version_id,
        latest_trip_updates_snapshot_id=context.latest_trip_updates_snapshot_id,
        latest_vehicle_snapshot_id=context.latest_vehicle_snapshot_id,
        refreshed_at_utc=refreshed_at_utc,
        row_counts=fact_row_counts | latest_row_counts,
    )


def refresh_gold_static(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> GoldStaticRefreshResult:
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(settings=settings)
    manifest = registry.get_provider(provider_id)
    provider_timezone = manifest.provider.timezone
    engine = engine or make_engine(settings)

    with engine.begin() as connection:
        context = _resolve_gold_build_context(
            connection,
            provider_id=manifest.provider.provider_id,
            provider_timezone=provider_timezone,
        )
        has_silver_routes = connection.execute(
            SELECT_CURRENT_VERSION_HAS_SILVER_ROUTES,
            {
                "provider_id": context.provider_id,
                "dataset_version_id": context.dataset_version_id,
            },
        ).scalar_one()
        if not has_silver_routes:
            raise ValueError(
                f"Current static dataset version {context.dataset_version_id} has no "
                "Silver rows — run load-static-silver before refresh-gold-static."
            )
        connection.execute(ACQUIRE_GOLD_BUILD_LOCK, {"provider_id": context.provider_id})
        _refresh_gold_dimensions(connection, context=context)
        row_counts = {
            "dim_route": _count_gold_rows(
                connection,
                provider_id=context.provider_id,
                table_name="dim_route",
            ),
            "dim_route_pattern": _count_gold_rows(
                connection,
                provider_id=context.provider_id,
                table_name="dim_route_pattern",
            ),
            "dim_stop": _count_gold_rows(
                connection,
                provider_id=context.provider_id,
                table_name="dim_stop",
            ),
            "dim_date": _count_gold_rows(
                connection,
                provider_id=context.provider_id,
                table_name="dim_date",
            ),
            "dim_route_history": _count_gold_rows(
                connection,
                provider_id=context.provider_id,
                table_name="dim_route_history",
            ),
            "dim_stop_history": _count_gold_rows(
                connection,
                provider_id=context.provider_id,
                table_name="dim_stop_history",
            ),
        }
        refreshed_at_utc = utc_now()

    return GoldStaticRefreshResult(
        provider_id=context.provider_id,
        provider_timezone=context.provider_timezone,
        dataset_version_id=context.dataset_version_id,
        refreshed_at_utc=refreshed_at_utc,
        row_counts=row_counts,
    )
