from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.sql.elements import TextClause

from transit_ops.ingestion.common import utc_now


@dataclass(frozen=True)
class SourceFactoryValidationCheck:
    check_id: str
    category: str
    title: str
    statement: TextClause

    def display_dict(self) -> dict[str, object]:
        return {
            "check_id": self.check_id,
            "category": self.category,
            "title": self.title,
        }


@dataclass(frozen=True)
class SourceFactoryValidationCheckResult:
    check: SourceFactoryValidationCheck
    rows: list[Mapping[str, object]]

    def display_dict(self) -> dict[str, object]:
        return {
            **self.check.display_dict(),
            "rows": [
                _redacted_display_value(row)
                for row in self.rows
            ],
        }


@dataclass(frozen=True)
class SourceFactoryValidationReport:
    provider_id: str
    captured_at_utc: datetime
    checks: Mapping[str, SourceFactoryValidationCheckResult]
    health_payload: Mapping[str, object] | None = None
    reader_role_proofs: Mapping[str, object] | None = None
    retention_payload: Mapping[str, object] | None = None

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "captured_at_utc": self.captured_at_utc.isoformat(),
            "checks": {
                check_id: self.checks[check_id].display_dict()
                for check_id in sorted(self.checks)
            },
            "health_payload": _redacted_display_value(self.health_payload),
            "reader_role_proofs": _redacted_display_value(self.reader_role_proofs),
            "retention_payload": _redacted_display_value(self.retention_payload),
        }


SOURCE_FACTORY_VALIDATION_CHECKS: tuple[SourceFactoryValidationCheck, ...] = (
    SourceFactoryValidationCheck(
        check_id="silver_static_source_lineage_abundance",
        category="silver_static",
        title="Silver static source lineage abundance",
        statement=text(
            """
WITH requested_provider AS (
    SELECT :provider_id AS provider_id
),
required_members(member_path) AS (
    VALUES
        ('routes.txt'),
        ('stops.txt'),
        ('trips.txt'),
        ('stop_times.txt')
),
service_members(member_path) AS (
    VALUES
        ('calendar.txt'),
        ('calendar_dates.txt')
),
current_versions AS (
    SELECT
        rp.provider_id,
        dv.dataset_version_id,
        dv.dataset_kind,
        dv.source_url,
        dv.storage_backend,
        dv.storage_path,
        dv.loaded_at_utc,
        dv.effective_at_utc,
        dv.first_seen_at_utc,
        dv.last_seen_at_utc,
        dv.is_current
    FROM requested_provider AS rp
    LEFT JOIN core.dataset_versions AS dv
        ON dv.provider_id = rp.provider_id
       AND dv.is_current IS TRUE
       AND dv.dataset_kind = 'static_schedule'
),
member_counts AS (
    SELECT
        gsm.provider_id,
        gsm.dataset_version_id,
        count(*)::integer AS source_member_count,
        count(*) FILTER (WHERE gsm.member_path IN (SELECT member_path FROM required_members))
            ::integer AS required_member_count,
        count(*) FILTER (WHERE gsm.member_path IN (SELECT member_path FROM service_members))
            ::integer AS service_member_count,
        array_agg(gsm.member_path ORDER BY gsm.member_path) FILTER (
            WHERE gsm.member_path IN (SELECT member_path FROM service_members)
        ) AS present_service_members,
        count(*) FILTER (WHERE gsm.row_count IS NOT NULL)::integer AS row_counted_member_count,
        sum(COALESCE(gsm.row_count, 0))::bigint AS total_source_rows
    FROM silver.gtfs_source_members AS gsm
    WHERE gsm.provider_id = :provider_id
    GROUP BY gsm.provider_id, gsm.dataset_version_id
),
missing_required AS (
    SELECT
        cv.provider_id,
        cv.dataset_version_id,
        array_agg(rm.member_path ORDER BY rm.member_path) FILTER (
            WHERE gsm.member_path IS NULL
        ) AS missing_required_members
    FROM current_versions AS cv
    CROSS JOIN required_members AS rm
    LEFT JOIN silver.gtfs_source_members AS gsm
        ON gsm.provider_id = cv.provider_id
       AND gsm.dataset_version_id = cv.dataset_version_id
       AND gsm.member_path = rm.member_path
    GROUP BY cv.provider_id, cv.dataset_version_id
),
extra_rows AS (
    SELECT
        ger.provider_id,
        ger.dataset_version_id,
        count(*)::integer AS gtfs_extra_rows
    FROM silver.gtfs_extra_rows AS ger
    WHERE ger.provider_id = :provider_id
    GROUP BY ger.provider_id, ger.dataset_version_id
),
typed_row_counts AS (
    SELECT
        provider_id,
        dataset_version_id,
        max(row_count) FILTER (WHERE relation_name = 'silver.agency') AS agency_rows,
        max(row_count) FILTER (WHERE relation_name = 'silver.routes') AS routes_rows,
        max(row_count) FILTER (WHERE relation_name = 'silver.stops') AS stops_rows,
        max(row_count) FILTER (WHERE relation_name = 'silver.trips') AS trips_rows,
        max(row_count) FILTER (WHERE relation_name = 'silver.stop_times') AS stop_times_rows
    FROM (
        SELECT provider_id, dataset_version_id, 'silver.agency' AS relation_name,
               count(*)::integer AS row_count
        FROM silver.agency
        WHERE provider_id = :provider_id
        GROUP BY provider_id, dataset_version_id
        UNION ALL
        SELECT provider_id, dataset_version_id, 'silver.routes', count(*)::integer
        FROM silver.routes
        WHERE provider_id = :provider_id
        GROUP BY provider_id, dataset_version_id
        UNION ALL
        SELECT provider_id, dataset_version_id, 'silver.stops', count(*)::integer
        FROM silver.stops
        WHERE provider_id = :provider_id
        GROUP BY provider_id, dataset_version_id
        UNION ALL
        SELECT provider_id, dataset_version_id, 'silver.trips', count(*)::integer
        FROM silver.trips
        WHERE provider_id = :provider_id
        GROUP BY provider_id, dataset_version_id
        UNION ALL
        SELECT provider_id, dataset_version_id, 'silver.stop_times', count(*)::integer
        FROM silver.stop_times
        WHERE provider_id = :provider_id
        GROUP BY provider_id, dataset_version_id
    ) AS typed_counts
    GROUP BY provider_id, dataset_version_id
)
SELECT
    cv.provider_id,
    cv.dataset_version_id,
    cv.dataset_kind,
    cv.source_url,
    cv.storage_backend,
    cv.storage_path,
    cv.loaded_at_utc,
    cv.effective_at_utc,
    cv.first_seen_at_utc,
    cv.last_seen_at_utc,
    COALESCE(mc.source_member_count, 0) AS source_member_count,
    COALESCE(mc.required_member_count, 0) AS required_member_count,
    COALESCE(mc.service_member_count, 0) AS service_member_count,
    COALESCE(mc.service_member_count, 0) > 0 AS has_service_calendar_member,
    COALESCE(mc.present_service_members, ARRAY[]::text[]) AS present_service_members,
    COALESCE(mc.row_counted_member_count, 0) AS row_counted_member_count,
    COALESCE(mc.total_source_rows, 0) AS total_source_rows,
    COALESCE(er.gtfs_extra_rows, 0) AS gtfs_extra_rows,
    COALESCE(trc.agency_rows, 0) AS silver_agency_rows,
    COALESCE(trc.routes_rows, 0) AS silver_routes_rows,
    COALESCE(trc.stops_rows, 0) AS silver_stops_rows,
    COALESCE(trc.trips_rows, 0) AS silver_trips_rows,
    COALESCE(trc.stop_times_rows, 0) AS silver_stop_times_rows,
    COALESCE(mr.missing_required_members, ARRAY[]::text[]) AS missing_required_members
FROM current_versions AS cv
LEFT JOIN member_counts AS mc
    ON mc.provider_id = cv.provider_id
   AND mc.dataset_version_id = cv.dataset_version_id
LEFT JOIN extra_rows AS er
    ON er.provider_id = cv.provider_id
   AND er.dataset_version_id = cv.dataset_version_id
LEFT JOIN missing_required AS mr
    ON mr.provider_id = cv.provider_id
   AND mr.dataset_version_id = cv.dataset_version_id
LEFT JOIN typed_row_counts AS trc
    ON trc.provider_id = cv.provider_id
   AND trc.dataset_version_id = cv.dataset_version_id
ORDER BY cv.dataset_kind, cv.loaded_at_utc DESC, cv.dataset_version_id DESC
"""
        ),
    ),
    SourceFactoryValidationCheck(
        check_id="gtfs_rt_trip_updates_source_history",
        category="silver_realtime",
        title="GTFS-RT trip updates source and flattened history",
        statement=text(
            """
WITH requested_provider AS (
    SELECT :provider_id AS provider_id
),
source_counts AS (
    SELECT
        rfs.provider_id,
        count(DISTINCT rfs.rt_feed_snapshot_id)::integer AS source_snapshot_count,
        count(DISTINCT rte.rt_feed_snapshot_id || ':' || rte.entity_index)::integer
            AS rt_entities,
        count(DISTINCT rtu.rt_feed_snapshot_id || ':' || rtu.entity_index)::integer
            AS rt_trip_updates,
        count(rstu.*)::integer AS rt_trip_update_stop_times,
        min(rfs.captured_at_utc) AS oldest_captured_at_utc,
        max(rfs.captured_at_utc) AS newest_captured_at_utc,
        max(rfs.feed_timestamp_utc) AS newest_feed_timestamp_utc
    FROM silver.rt_feed_snapshots AS rfs
    LEFT JOIN silver.rt_entities AS rte
        ON rte.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
       AND rte.provider_id = rfs.provider_id
       AND rte.entity_kind = 'trip_update'
    LEFT JOIN silver.rt_trip_updates AS rtu
        ON rtu.rt_feed_snapshot_id = rte.rt_feed_snapshot_id
       AND rtu.entity_index = rte.entity_index
       AND rtu.provider_id = rte.provider_id
    LEFT JOIN silver.rt_trip_update_stop_times AS rstu
        ON rstu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
       AND rstu.entity_index = rtu.entity_index
       AND rstu.provider_id = rtu.provider_id
    WHERE rfs.provider_id = :provider_id
      AND rfs.endpoint_key = 'trip_updates'
    GROUP BY rfs.provider_id
)
SELECT
    rp.provider_id,
    'trip_updates' AS endpoint_key,
    COALESCE(sc.source_snapshot_count, 0) AS source_snapshot_count,
    COALESCE(sc.rt_entities, 0) AS rt_entities,
    COALESCE(sc.rt_trip_updates, 0) AS rt_trip_updates,
    COALESCE(sc.rt_trip_update_stop_times, 0) AS rt_trip_update_stop_times,
    sc.oldest_captured_at_utc,
    sc.newest_captured_at_utc,
    sc.newest_feed_timestamp_utc
FROM requested_provider AS rp
LEFT JOIN source_counts AS sc
    ON sc.provider_id = rp.provider_id
"""
        ),
    ),
    SourceFactoryValidationCheck(
        check_id="gtfs_rt_vehicle_positions_source_history",
        category="silver_realtime",
        title="GTFS-RT vehicle positions source and flattened history",
        statement=text(
            """
WITH requested_provider AS (
    SELECT :provider_id AS provider_id
),
source_counts AS (
    SELECT
        rfs.provider_id,
        count(DISTINCT rfs.rt_feed_snapshot_id)::integer AS source_snapshot_count,
        count(DISTINCT rte.rt_feed_snapshot_id || ':' || rte.entity_index)::integer
            AS rt_entities,
        count(DISTINCT rvp.rt_feed_snapshot_id || ':' || rvp.entity_index)::integer
            AS rt_vehicle_positions,
        min(rfs.captured_at_utc) AS oldest_captured_at_utc,
        max(rfs.captured_at_utc) AS newest_captured_at_utc,
        max(rfs.feed_timestamp_utc) AS newest_feed_timestamp_utc,
        count(*) FILTER (WHERE rvp.latitude IS NOT NULL AND rvp.longitude IS NOT NULL)::integer
            AS geocoded_vehicle_positions
    FROM silver.rt_feed_snapshots AS rfs
    LEFT JOIN silver.rt_entities AS rte
        ON rte.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
       AND rte.provider_id = rfs.provider_id
       AND rte.entity_kind = 'vehicle'
    LEFT JOIN silver.rt_vehicle_positions AS rvp
        ON rvp.rt_feed_snapshot_id = rte.rt_feed_snapshot_id
       AND rvp.entity_index = rte.entity_index
       AND rvp.provider_id = rte.provider_id
    WHERE rfs.provider_id = :provider_id
      AND rfs.endpoint_key = 'vehicle_positions'
    GROUP BY rfs.provider_id
)
SELECT
    rp.provider_id,
    'vehicle_positions' AS endpoint_key,
    COALESCE(sc.source_snapshot_count, 0) AS source_snapshot_count,
    COALESCE(sc.rt_entities, 0) AS rt_entities,
    COALESCE(sc.rt_vehicle_positions, 0) AS rt_vehicle_positions,
    sc.oldest_captured_at_utc,
    sc.newest_captured_at_utc,
    sc.newest_feed_timestamp_utc,
    COALESCE(sc.geocoded_vehicle_positions, 0) AS geocoded_vehicle_positions
FROM requested_provider AS rp
LEFT JOIN source_counts AS sc
    ON sc.provider_id = rp.provider_id
"""
        ),
    ),
    SourceFactoryValidationCheck(
        check_id="computed_delay_facts",
        category="gold_delay",
        title="Computed delay facts from predicted RT stop times joined to static stop times",
        statement=text(
            """
WITH requested_provider AS (
    SELECT :provider_id AS provider_id
),
predicted_static_join AS (
    SELECT
        rtu.provider_id,
        rtu.trip_id,
        rtu.route_id,
        rstu.stop_sequence,
        rstu.stop_id,
        rstu.arrival_time_utc AS predicted_arrival_utc,
        rstu.departure_time_utc AS predicted_departure_utc,
        st.arrival_time AS static_arrival_time,
        st.departure_time AS static_departure_time
    FROM silver.rt_trip_updates AS rtu
    INNER JOIN silver.rt_trip_update_stop_times AS rstu
        ON rstu.rt_feed_snapshot_id = rtu.rt_feed_snapshot_id
       AND rstu.entity_index = rtu.entity_index
       AND rstu.provider_id = rtu.provider_id
    INNER JOIN silver.stop_times AS st
        ON st.provider_id = rtu.provider_id
       AND st.trip_id = rtu.trip_id
       AND st.stop_sequence = rstu.stop_sequence
    WHERE rtu.provider_id = :provider_id
),
predicted_counts AS (
    SELECT
        provider_id,
        count(*)::integer AS predicted_static_join_count,
        count(predicted_arrival_utc)::integer AS predicted_arrival_count,
        count(predicted_departure_utc)::integer AS predicted_departure_count
    FROM predicted_static_join
    GROUP BY provider_id
),
fact_counts AS (
    SELECT
        f.provider_id,
        count(*)::integer AS computed_delay_observation_count,
        count(f.predicted_arrival_utc)::integer AS fact_predicted_arrival_count,
        count(f.predicted_departure_utc)::integer AS fact_predicted_departure_count,
        count(f.arrival_delay_seconds)::integer AS arrival_delay_seconds_count,
        count(f.departure_delay_seconds)::integer AS departure_delay_seconds_count,
        max(f.captured_at_utc) AS newest_fact_captured_at_utc
    FROM gold.fact_stop_time_delay_observation AS f
    WHERE f.provider_id = :provider_id
    GROUP BY f.provider_id
),
current_counts AS (
    SELECT
        c.provider_id,
        count(*)::integer AS current_trip_delay_computed_count,
        max(c.captured_at_utc) AS newest_current_captured_at_utc
    FROM gold.current_trip_delay_computed AS c
    WHERE c.provider_id = :provider_id
    GROUP BY c.provider_id
)
SELECT
    rp.provider_id,
    COALESCE(pc.predicted_static_join_count, 0) AS predicted_static_join_count,
    COALESCE(pc.predicted_arrival_count, 0) AS predicted_arrival_count,
    COALESCE(pc.predicted_departure_count, 0) AS predicted_departure_count,
    COALESCE(fc.computed_delay_observation_count, 0) AS computed_delay_observation_count,
    COALESCE(fc.fact_predicted_arrival_count, 0) AS fact_predicted_arrival_count,
    COALESCE(fc.fact_predicted_departure_count, 0) AS fact_predicted_departure_count,
    COALESCE(fc.arrival_delay_seconds_count, 0) AS arrival_delay_seconds_count,
    COALESCE(fc.departure_delay_seconds_count, 0) AS departure_delay_seconds_count,
    COALESCE(cc.current_trip_delay_computed_count, 0) AS current_trip_delay_computed_count,
    COALESCE(pc.predicted_static_join_count, 0)
        - COALESCE(fc.computed_delay_observation_count, 0)
        AS delay_observation_count_delta,
    COALESCE(pc.predicted_arrival_count, 0) - COALESCE(fc.fact_predicted_arrival_count, 0)
        AS predicted_arrival_count_delta,
    COALESCE(pc.predicted_departure_count, 0) - COALESCE(fc.fact_predicted_departure_count, 0)
        AS predicted_departure_count_delta,
    fc.newest_fact_captured_at_utc,
    cc.newest_current_captured_at_utc
FROM requested_provider AS rp
LEFT JOIN predicted_counts AS pc
    ON pc.provider_id = rp.provider_id
LEFT JOIN fact_counts AS fc
    ON fc.provider_id = rp.provider_id
LEFT JOIN current_counts AS cc
    ON cc.provider_id = rp.provider_id
"""
        ),
    ),
    SourceFactoryValidationCheck(
        check_id="sibling_rt_feed_join",
        category="silver_realtime",
        title="Sibling GTFS-RT feeds join by trip, route, provider, and time window",
        statement=text(
            """
WITH requested_provider AS (
    SELECT :provider_id AS provider_id
),
sibling_join AS (
    SELECT
        tu.provider_id,
        count(*)::integer AS sibling_join_count,
        count(DISTINCT tu.trip_id)::integer AS joined_trip_count,
        count(DISTINCT tu.route_id)::integer AS joined_route_count,
        min(tu.captured_at_utc) AS oldest_trip_update_captured_at_utc,
        max(tu.captured_at_utc) AS newest_trip_update_captured_at_utc,
        max(vp.captured_at_utc) AS newest_vehicle_position_captured_at_utc
    FROM silver.rt_trip_updates AS tu
    INNER JOIN silver.rt_vehicle_positions AS vp
        ON tu.provider_id = vp.provider_id
       AND tu.trip_id = vp.trip_id
       AND tu.route_id = vp.route_id
       AND COALESCE(vp.feed_timestamp_utc, vp.captured_at_utc)
           BETWEEN COALESCE(tu.feed_timestamp_utc, tu.captured_at_utc) - interval '10 minutes'
               AND COALESCE(tu.feed_timestamp_utc, tu.captured_at_utc) + interval '10 minutes'
    WHERE tu.provider_id = :provider_id
      AND tu.trip_id IS NOT NULL
      AND tu.route_id IS NOT NULL
    GROUP BY tu.provider_id
)
SELECT
    rp.provider_id,
    COALESCE(sj.sibling_join_count, 0) AS sibling_join_count,
    COALESCE(sj.joined_trip_count, 0) AS joined_trip_count,
    COALESCE(sj.joined_route_count, 0) AS joined_route_count,
    sj.oldest_trip_update_captured_at_utc,
    sj.newest_trip_update_captured_at_utc,
    sj.newest_vehicle_position_captured_at_utc
FROM requested_provider AS rp
LEFT JOIN sibling_join AS sj
    ON sj.provider_id = rp.provider_id
"""
        ),
    ),
    SourceFactoryValidationCheck(
        check_id="postgis_map_marts",
        category="gold_maps",
        title="PostGIS and GeoJSON map marts",
        statement=text(
            """
WITH mart_counts AS (
    SELECT 'gold.map_stops' AS relation_name,
           count(*)::integer AS row_count,
           count(*) FILTER (WHERE geom_wgs84 IS NOT NULL)::integer AS geom_non_null_count,
           count(*) FILTER (WHERE geojson IS NOT NULL)::integer AS geojson_non_null_count
    FROM gold.map_stops
    WHERE provider_id = :provider_id
    UNION ALL
    SELECT 'gold.map_route_lines',
           count(*)::integer,
           count(*) FILTER (WHERE geom_wgs84 IS NOT NULL)::integer,
           count(*) FILTER (WHERE geojson IS NOT NULL)::integer
    FROM gold.map_route_lines
    WHERE provider_id = :provider_id
    UNION ALL
    SELECT 'gold.current_vehicle_map',
           count(*)::integer,
           count(*) FILTER (WHERE geom_wgs84 IS NOT NULL)::integer,
           count(*) FILTER (WHERE geojson IS NOT NULL)::integer
    FROM gold.current_vehicle_map
    WHERE provider_id = :provider_id
    UNION ALL
    SELECT 'gold.map_gis_line_features',
           count(*)::integer,
           count(*) FILTER (WHERE geom_wgs84 IS NOT NULL)::integer,
           count(*) FILTER (WHERE geojson IS NOT NULL)::integer
    FROM gold.map_gis_line_features
    WHERE provider_id = :provider_id
)
SELECT *
FROM mart_counts
ORDER BY relation_name
"""
        ),
    ),
    SourceFactoryValidationCheck(
        check_id="provider_local_timezone_buckets",
        category="gold_local_time",
        title="Provider-local timezone buckets in facts, daily views, and I3 history",
        statement=text(
            """
WITH provider_timezone AS (
    SELECT p.provider_id, p.timezone
    FROM core.providers AS p
    WHERE p.provider_id = :provider_id
),
fact_local_dates AS (
    SELECT provider_id, count(DISTINCT snapshot_local_date)::integer AS local_date_count
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
    GROUP BY provider_id
),
route_daily AS (
    SELECT provider_id, count(DISTINCT provider_local_date)::integer AS route_daily_dates
    FROM gold.public_route_reliability_daily
    WHERE provider_id = :provider_id
    GROUP BY provider_id
),
stop_daily AS (
    SELECT provider_id, count(DISTINCT provider_local_date)::integer AS stop_daily_dates
    FROM gold.public_stop_delay_daily
    WHERE provider_id = :provider_id
    GROUP BY provider_id
),
alert_daily AS (
    SELECT provider_id, count(DISTINCT provider_local_date)::integer AS alert_daily_dates
    FROM gold.public_alert_impact_daily
    WHERE provider_id = :provider_id
    GROUP BY provider_id
),
i3_history AS (
    SELECT
        provider_id,
        count(DISTINCT provider_local_date)::integer AS i3_history_local_dates,
        count(DISTINCT hour_bucket_local)::integer AS i3_hour_buckets,
        count(DISTINCT week_bucket_local)::integer AS i3_week_buckets,
        count(DISTINCT month_bucket_local)::integer AS i3_month_buckets,
        count(DISTINCT rolling_year_bucket_local)::integer AS i3_year_buckets
    FROM gold.i3_alert_history_reporting
    WHERE provider_id = :provider_id
    GROUP BY provider_id
)
SELECT
    pt.provider_id,
    pt.timezone AS provider_timezone,
    COALESCE(fld.local_date_count, 0) AS fact_snapshot_local_date_count,
    COALESCE(rd.route_daily_dates, 0) AS route_daily_provider_local_date_count,
    COALESCE(sd.stop_daily_dates, 0) AS stop_daily_provider_local_date_count,
    COALESCE(ad.alert_daily_dates, 0) AS alert_daily_provider_local_date_count,
    COALESCE(ih.i3_history_local_dates, 0) AS i3_history_provider_local_date_count,
    COALESCE(ih.i3_hour_buckets, 0) AS i3_hour_bucket_count,
    COALESCE(ih.i3_week_buckets, 0) AS i3_week_bucket_count,
    COALESCE(ih.i3_month_buckets, 0) AS i3_month_bucket_count,
    COALESCE(ih.i3_year_buckets, 0) AS i3_year_bucket_count
FROM provider_timezone AS pt
LEFT JOIN fact_local_dates AS fld
    ON fld.provider_id = pt.provider_id
LEFT JOIN route_daily AS rd
    ON rd.provider_id = pt.provider_id
LEFT JOIN stop_daily AS sd
    ON sd.provider_id = pt.provider_id
LEFT JOIN alert_daily AS ad
    ON ad.provider_id = pt.provider_id
LEFT JOIN i3_history AS ih
    ON ih.provider_id = pt.provider_id
"""
        ),
    ),
    SourceFactoryValidationCheck(
        check_id="source_lineage_freshness_health",
        category="gold_health",
        title="Source lineage, feed freshness, and operator health payload",
        statement=text(
            """
WITH requested_provider AS (
    SELECT :provider_id AS provider_id
),
lineage AS (
    SELECT
        provider_id,
        count(*)::integer AS lineage_row_count,
        count(*) FILTER (WHERE is_current IS TRUE)::integer AS current_source_count,
        max(loaded_at_utc) AS newest_loaded_at_utc,
        max(last_seen_at_utc) AS newest_last_seen_at_utc
    FROM gold.source_lineage_reporting
    WHERE provider_id = :provider_id
    GROUP BY provider_id
),
freshness AS (
    SELECT
        provider_id,
        count(*)::integer AS freshness_endpoint_count,
        count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded_endpoint_count,
        max(completed_at_utc) AS newest_completed_at_utc,
        max(feed_timestamp_utc) AS newest_feed_timestamp_utc,
        max(completed_age_seconds) AS max_completed_age_seconds
    FROM gold.feed_freshness_current
    WHERE provider_id = :provider_id
    GROUP BY provider_id
)
SELECT
    rp.provider_id,
    COALESCE(l.lineage_row_count, 0) AS lineage_row_count,
    COALESCE(l.current_source_count, 0) AS current_source_count,
    l.newest_loaded_at_utc,
    l.newest_last_seen_at_utc,
    COALESCE(f.freshness_endpoint_count, 0) AS freshness_endpoint_count,
    COALESCE(f.succeeded_endpoint_count, 0) AS succeeded_endpoint_count,
    f.newest_completed_at_utc,
    f.newest_feed_timestamp_utc,
    f.max_completed_age_seconds
FROM requested_provider AS rp
LEFT JOIN lineage AS l
    ON l.provider_id = rp.provider_id
LEFT JOIN freshness AS f
    ON f.provider_id = rp.provider_id
"""
        ),
    ),
    SourceFactoryValidationCheck(
        check_id="retention_timestamp_bounds",
        category="retention",
        title="Raw, Silver, and Gold timestamp retention bounds",
        statement=text(
            """
WITH bounds AS (
    SELECT
        'raw.ingestion_runs' AS relation_name,
        min(completed_at_utc) AS oldest_timestamp_utc,
        max(completed_at_utc) AS newest_timestamp_utc,
        count(*)::integer AS row_count
    FROM raw.ingestion_runs
    WHERE provider_id = :provider_id
    UNION ALL
    SELECT
        'silver.rt_feed_snapshots',
        min(captured_at_utc),
        max(captured_at_utc),
        count(*)::integer
    FROM silver.rt_feed_snapshots
    WHERE provider_id = :provider_id
    UNION ALL
    SELECT
        'gold.fact_vehicle_snapshot',
        min(captured_at_utc),
        max(captured_at_utc),
        count(*)::integer
    FROM gold.fact_vehicle_snapshot
    WHERE provider_id = :provider_id
    UNION ALL
    SELECT
        'gold.fact_trip_delay_snapshot',
        min(captured_at_utc),
        max(captured_at_utc),
        count(*)::integer
    FROM gold.fact_trip_delay_snapshot
    WHERE provider_id = :provider_id
    UNION ALL
    SELECT
        'gold.fact_stop_time_delay_observation',
        min(observation_time_utc),
        max(observation_time_utc),
        count(*)::integer
    FROM gold.fact_stop_time_delay_observation
    WHERE provider_id = :provider_id
)
SELECT *
FROM bounds
ORDER BY relation_name
"""
        ),
    ),
    SourceFactoryValidationCheck(
        check_id="reader_role_privileges",
        category="reader_roles",
        title="Standard reader role privileges",
        statement=text(
            """
WITH expected_roles(role_name, expected_contract) AS (
    VALUES
        ('transit-reporting', 'gold-only read-only no temp plus PostGIS metadata'),
        ('transit-db', 'raw/core/silver/gold read temp allowed plus PostGIS metadata')
),
role_flags AS (
    SELECT
        er.role_name,
        er.expected_contract,
        r.rolname IS NOT NULL AS role_exists,
        COALESCE(r.rolcreaterole, false) AS can_create_role,
        COALESCE(r.rolcreatedb, false) AS can_create_database,
        COALESCE(r.rolsuper, false) AS is_superuser,
        COALESCE(has_database_privilege(r.rolname, current_database(), 'CONNECT'), false)
            AS can_connect_database,
        COALESCE(has_database_privilege(r.rolname, current_database(), 'TEMPORARY'), false)
            AS can_create_temp
    FROM expected_roles AS er
    LEFT JOIN pg_roles AS r
        ON r.rolname = er.role_name
),
monitored_schemas(schema_name) AS (
    VALUES
        ('raw'),
        ('core'),
        ('silver'),
        ('gold'),
        ('public')
),
schema_flags AS (
    SELECT
        rf.role_name,
        ms.schema_name,
        CASE
            WHEN rf.role_exists AND ns.oid IS NOT NULL
                THEN has_schema_privilege(rf.role_name, ns.oid, 'USAGE')
            ELSE false
        END AS has_usage,
        CASE
            WHEN rf.role_exists AND ns.oid IS NOT NULL
                THEN has_schema_privilege(rf.role_name, ns.oid, 'CREATE')
            ELSE false
        END AS has_create
    FROM role_flags AS rf
    CROSS JOIN monitored_schemas AS ms
    LEFT JOIN pg_namespace AS ns
        ON ns.nspname = ms.schema_name
),
schema_summary AS (
    SELECT
        role_name,
        COALESCE(bool_or(schema_name = 'gold' AND has_usage), false) AS can_use_gold_schema,
        COALESCE(bool_or(schema_name = 'raw' AND has_usage), false) AS can_use_raw_schema,
        COALESCE(bool_or(schema_name = 'core' AND has_usage), false) AS can_use_core_schema,
        COALESCE(bool_or(schema_name = 'silver' AND has_usage), false) AS can_use_silver_schema,
        COALESCE(bool_or(schema_name = 'public' AND has_usage), false) AS can_use_public_schema,
        count(*) FILTER (WHERE has_create)::integer AS schema_create_grant_count
    FROM schema_flags
    GROUP BY role_name
),
relation_flags AS (
    SELECT
        rf.role_name,
        ns.nspname AS table_schema,
        cls.relname AS relation_name,
        CASE
            WHEN rf.role_exists THEN has_table_privilege(rf.role_name, cls.oid, 'SELECT')
            ELSE false
        END AS has_select,
        CASE
            WHEN rf.role_exists THEN (
                has_table_privilege(rf.role_name, cls.oid, 'INSERT')
                OR has_table_privilege(rf.role_name, cls.oid, 'UPDATE')
                OR has_table_privilege(rf.role_name, cls.oid, 'DELETE')
                OR has_table_privilege(rf.role_name, cls.oid, 'TRUNCATE')
            )
            ELSE false
        END AS has_permanent_write
    FROM role_flags AS rf
    INNER JOIN pg_namespace AS ns
        ON ns.nspname IN ('raw', 'core', 'silver', 'gold', 'public')
    INNER JOIN pg_class AS cls
        ON cls.relnamespace = ns.oid
       AND cls.relkind IN ('r', 'p', 'v', 'm', 'f')
),
effective_relation_summary AS (
    SELECT
        role_name,
        count(*) FILTER (WHERE table_schema = 'gold')::integer AS gold_relation_count,
        count(*) FILTER (WHERE table_schema = 'gold' AND has_select)::integer
            AS gold_select_relation_count,
        count(*) FILTER (WHERE table_schema = 'raw')::integer AS raw_relation_count,
        count(*) FILTER (WHERE table_schema = 'raw' AND has_select)::integer
            AS raw_select_relation_count,
        count(*) FILTER (WHERE table_schema = 'core')::integer AS core_relation_count,
        count(*) FILTER (WHERE table_schema = 'core' AND has_select)::integer
            AS core_select_relation_count,
        count(*) FILTER (WHERE table_schema = 'silver')::integer AS silver_relation_count,
        count(*) FILTER (WHERE table_schema = 'silver' AND has_select)::integer
            AS silver_select_relation_count,
        count(*) FILTER (WHERE table_schema = 'public')::integer AS public_relation_count,
        count(*) FILTER (WHERE table_schema = 'public' AND has_select)::integer
            AS public_select_relation_count,
        count(*) FILTER (
            WHERE table_schema = 'public'
              AND has_select
              AND relation_name <> 'spatial_ref_sys'
        )::integer AS public_unapproved_select_relation_count,
        bool_or(
            table_schema = 'public'
            AND relation_name = 'spatial_ref_sys'
            AND has_select
        ) AS public_spatial_ref_sys_select,
        count(*) FILTER (WHERE has_permanent_write)::integer AS permanent_write_relation_count
    FROM relation_flags
    GROUP BY role_name
),
grant_summary AS (
    SELECT
        grantee AS role_name,
        table_schema,
        bool_or(privilege_type = 'SELECT') AS has_select,
        bool_or(
            privilege_type IN (
                'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            )
        ) AS has_permanent_write
    FROM information_schema.role_table_grants
    WHERE grantee IN ('transit-reporting', 'transit-db')
      AND table_schema IN ('raw', 'core', 'silver', 'gold', 'public')
    GROUP BY grantee, table_schema
),
grant_write_summary AS (
    SELECT
        role_name,
        count(*) FILTER (WHERE has_permanent_write)::integer AS permanent_write_grant_count
    FROM grant_summary
    GROUP BY role_name
)
SELECT
    rf.role_name,
    rf.expected_contract,
    rf.role_exists,
    rf.can_create_role,
    rf.can_create_database,
    rf.is_superuser,
    rf.can_connect_database,
    rf.can_create_temp,
    COALESCE(ss.can_use_gold_schema, false) AS can_use_gold_schema,
    COALESCE(ss.can_use_raw_schema, false) AS can_use_raw_schema,
    COALESCE(ss.can_use_core_schema, false) AS can_use_core_schema,
    COALESCE(ss.can_use_silver_schema, false) AS can_use_silver_schema,
    COALESCE(ss.can_use_public_schema, false) AS can_use_public_schema,
    COALESCE(ss.schema_create_grant_count, 0) AS schema_create_grant_count,
    COALESCE(ers.gold_relation_count, 0) AS gold_relation_count,
    COALESCE(ers.gold_select_relation_count, 0) AS gold_select_relation_count,
    COALESCE(ers.raw_relation_count, 0) AS raw_relation_count,
    COALESCE(ers.raw_select_relation_count, 0) AS raw_select_relation_count,
    COALESCE(ers.core_relation_count, 0) AS core_relation_count,
    COALESCE(ers.core_select_relation_count, 0) AS core_select_relation_count,
    COALESCE(ers.silver_relation_count, 0) AS silver_relation_count,
    COALESCE(ers.silver_select_relation_count, 0) AS silver_select_relation_count,
    COALESCE(ers.public_relation_count, 0) AS public_relation_count,
    COALESCE(ers.public_select_relation_count, 0) AS public_select_relation_count,
    COALESCE(ers.public_unapproved_select_relation_count, 0)
        AS public_unapproved_select_relation_count,
    COALESCE(ers.public_spatial_ref_sys_select, false) AS public_spatial_ref_sys_select,
    COALESCE(ers.permanent_write_relation_count, 0) AS permanent_write_relation_count,
    COALESCE(gws.permanent_write_grant_count, 0) AS permanent_write_grant_count,
    CASE
        WHEN rf.role_name = 'transit-reporting' THEN false
        WHEN rf.role_name = 'transit-db' THEN true
        ELSE NULL
    END AS expected_temp_allowed,
    CASE
        WHEN rf.role_name = 'transit-reporting' THEN (
            rf.role_exists
            AND rf.can_connect_database
            AND NOT rf.can_create_temp
            AND NOT rf.can_create_role
            AND NOT rf.can_create_database
            AND NOT rf.is_superuser
            AND COALESCE(ss.can_use_gold_schema, false)
            AND NOT COALESCE(ss.can_use_raw_schema, false)
            AND NOT COALESCE(ss.can_use_core_schema, false)
            AND NOT COALESCE(ss.can_use_silver_schema, false)
            AND COALESCE(ss.can_use_public_schema, false)
            AND COALESCE(ss.schema_create_grant_count, 0) = 0
            AND COALESCE(ers.gold_select_relation_count, 0)
                = COALESCE(ers.gold_relation_count, 0)
            AND COALESCE(ers.raw_select_relation_count, 0) = 0
            AND COALESCE(ers.core_select_relation_count, 0) = 0
            AND COALESCE(ers.silver_select_relation_count, 0) = 0
            AND COALESCE(ers.public_spatial_ref_sys_select, false)
            AND COALESCE(ers.public_unapproved_select_relation_count, 0) = 0
            AND COALESCE(ers.permanent_write_relation_count, 0) = 0
            AND COALESCE(gws.permanent_write_grant_count, 0) = 0
        )
        WHEN rf.role_name = 'transit-db' THEN (
            rf.role_exists
            AND rf.can_connect_database
            AND rf.can_create_temp
            AND NOT rf.can_create_role
            AND NOT rf.can_create_database
            AND NOT rf.is_superuser
            AND COALESCE(ss.can_use_gold_schema, false)
            AND COALESCE(ss.can_use_raw_schema, false)
            AND COALESCE(ss.can_use_core_schema, false)
            AND COALESCE(ss.can_use_silver_schema, false)
            AND COALESCE(ss.can_use_public_schema, false)
            AND COALESCE(ss.schema_create_grant_count, 0) = 0
            AND COALESCE(ers.gold_select_relation_count, 0)
                = COALESCE(ers.gold_relation_count, 0)
            AND COALESCE(ers.raw_select_relation_count, 0)
                = COALESCE(ers.raw_relation_count, 0)
            AND COALESCE(ers.core_select_relation_count, 0)
                = COALESCE(ers.core_relation_count, 0)
            AND COALESCE(ers.silver_select_relation_count, 0)
                = COALESCE(ers.silver_relation_count, 0)
            AND COALESCE(ers.public_spatial_ref_sys_select, false)
            AND COALESCE(ers.public_unapproved_select_relation_count, 0) = 0
            AND COALESCE(ers.permanent_write_relation_count, 0) = 0
            AND COALESCE(gws.permanent_write_grant_count, 0) = 0
        )
        ELSE false
    END AS contract_ok
FROM role_flags AS rf
LEFT JOIN schema_summary AS ss
    ON ss.role_name = rf.role_name
LEFT JOIN effective_relation_summary AS ers
    ON ers.role_name = rf.role_name
LEFT JOIN grant_write_summary AS gws
    ON gws.role_name = rf.role_name
ORDER BY rf.role_name
"""
        ),
    ),
)


def collect_source_factory_validation_evidence(
    connection,
    *,
    provider_id: str,
    captured_at_utc: datetime | None = None,
    health_payload: Mapping[str, object] | None = None,
    reader_role_proofs: Mapping[str, object] | None = None,
    retention_payload: Mapping[str, object] | None = None,
) -> SourceFactoryValidationReport:
    checks = {
        check.check_id: SourceFactoryValidationCheckResult(
            check=check,
            rows=_mapping_rows(
                connection.execute(check.statement, {"provider_id": provider_id})
            ),
        )
        for check in SOURCE_FACTORY_VALIDATION_CHECKS
    }

    return SourceFactoryValidationReport(
        provider_id=provider_id,
        captured_at_utc=captured_at_utc or utc_now(),
        checks=checks,
        health_payload=health_payload,
        reader_role_proofs=reader_role_proofs,
        retention_payload=retention_payload,
    )


def _mapping_rows(result: object) -> list[dict[str, object]]:
    mappings = result.mappings()  # type: ignore[attr-defined]
    return [dict(row) for row in mappings]


def _display_mapping(values: Mapping[str, object]) -> dict[str, object]:
    return {
        str(key): _display_value(values[key])
        for key in sorted(values, key=str)
    }


def _display_value(value: object) -> object:
    if hasattr(value, "display_dict") and callable(value.display_dict):  # type: ignore[attr-defined]
        return _display_value(value.display_dict())  # type: ignore[attr-defined]
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Mapping):
        return _display_mapping({str(key): nested for key, nested in value.items()})
    if isinstance(value, list | tuple):
        return [_display_value(item) for item in value]
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


_SECRET_KEY_PATTERN = re.compile(
    r"(password|passwd|secret|token|(?:api|access)[_-]?key|database[_-]?url|source[_-]?url|dsn)",
    re.IGNORECASE,
)
_PASSWORD_DSN_PATTERN = re.compile(
    r"\b[a-z][a-z0-9+.-]*://[^/\s:@]+:[^@\s]+@[^\s\"']*",
    re.IGNORECASE,
)


def _redacted_display_value(value: object, *, key: str | None = None) -> object:
    if value is None:
        return None
    if key is not None and _SECRET_KEY_PATTERN.search(key):
        return "<redacted>"
    if isinstance(value, str):
        return _PASSWORD_DSN_PATTERN.sub("<redacted>", value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Mapping):
        return {
            str(nested_key): _redacted_display_value(
                nested_value,
                key=str(nested_key),
            )
            for nested_key, nested_value in sorted(value.items(), key=lambda item: str(item[0]))
        }
    if isinstance(value, list | tuple):
        return [_redacted_display_value(item) for item in value]
    if isinstance(value, int | float | bool):
        return value
    return str(value)


__all__ = [
    "SOURCE_FACTORY_VALIDATION_CHECKS",
    "SourceFactoryValidationCheck",
    "SourceFactoryValidationCheckResult",
    "SourceFactoryValidationReport",
    "collect_source_factory_validation_evidence",
]
