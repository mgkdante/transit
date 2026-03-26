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

LOCK_GOLD_TABLES = text(
    """
    LOCK TABLE
        gold.dim_route,
        gold.dim_stop,
        gold.dim_date,
        gold.fact_vehicle_snapshot,
        gold.fact_trip_delay_snapshot
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
        route_type,
        route_color,
        route_text_color,
        route_sort_order
    FROM silver.routes
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

INSERT_FACT_VEHICLE_SNAPSHOT = text(
    """
    INSERT INTO gold.fact_vehicle_snapshot (
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
        provider_id,
        realtime_snapshot_id,
        entity_index,
        to_char(timezone(:provider_timezone, feed_timestamp_utc), 'YYYYMMDD')::integer,
        timezone(:provider_timezone, feed_timestamp_utc)::date,
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
    FROM silver.vehicle_positions
    WHERE provider_id = :provider_id
    """
)

INSERT_FACT_TRIP_DELAY_SNAPSHOT = text(
    """
    WITH stop_time_counts AS (
        SELECT
            realtime_snapshot_id,
            trip_update_entity_index AS entity_index,
            count(*)::integer AS stop_time_update_count
        FROM silver.trip_update_stop_time_updates
        WHERE provider_id = :provider_id
        GROUP BY realtime_snapshot_id, trip_update_entity_index
    ),
    stop_time_candidates AS (
        SELECT
            tu.realtime_snapshot_id,
            tu.entity_index,
            stu.stop_id,
            stu.stop_sequence,
            EXTRACT(
                EPOCH FROM (
                    COALESCE(stu.arrival_time_utc, stu.departure_time_utc)
                    - (
                        tu.start_date::timestamp
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
                    ) AT TIME ZONE :provider_timezone
                )
            )::integer AS derived_delay_seconds,
            row_number() OVER (
                PARTITION BY tu.realtime_snapshot_id, tu.entity_index
                ORDER BY
                    CASE
                        WHEN COALESCE(stu.arrival_time_utc, stu.departure_time_utc)
                            >= tu.feed_timestamp_utc
                        THEN 0
                        ELSE 1
                    END,
                    abs(
                        EXTRACT(
                            EPOCH FROM (
                                COALESCE(stu.arrival_time_utc, stu.departure_time_utc)
                                - tu.feed_timestamp_utc
                            )
                        )
                    ),
                    stu.stop_sequence NULLS LAST,
                    stu.stop_time_update_index
            ) AS delay_rank
        FROM silver.trip_updates AS tu
        INNER JOIN silver.trip_update_stop_time_updates AS stu
            ON stu.provider_id = tu.provider_id
           AND stu.realtime_snapshot_id = tu.realtime_snapshot_id
           AND stu.trip_update_entity_index = tu.entity_index
        INNER JOIN silver.stop_times AS st
            ON st.provider_id = tu.provider_id
           AND st.dataset_version_id = :dataset_version_id
           AND st.trip_id = tu.trip_id
           AND st.stop_sequence = stu.stop_sequence
        WHERE tu.provider_id = :provider_id
          AND tu.start_date IS NOT NULL
          AND COALESCE(stu.arrival_time_utc, stu.departure_time_utc) IS NOT NULL
          AND COALESCE(st.arrival_time, st.departure_time) IS NOT NULL
    ),
    trip_delay_fallback AS (
        SELECT
            realtime_snapshot_id,
            entity_index,
            derived_delay_seconds
        FROM stop_time_candidates
        WHERE delay_rank = 1
    )
    INSERT INTO gold.fact_trip_delay_snapshot (
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
        trip_schedule_relationship,
        delay_seconds,
        stop_time_update_count
    )
    SELECT
        tu.provider_id,
        tu.realtime_snapshot_id,
        tu.entity_index,
        to_char(timezone(:provider_timezone, tu.feed_timestamp_utc), 'YYYYMMDD')::integer,
        timezone(:provider_timezone, tu.feed_timestamp_utc)::date,
        tu.feed_timestamp_utc,
        tu.captured_at_utc,
        tu.entity_id,
        tu.trip_id,
        tu.route_id,
        tu.direction_id,
        tu.start_date,
        COALESCE(tu.vehicle_id, vpm.vehicle_id),
        tu.trip_schedule_relationship,
        COALESCE(tu.delay_seconds, tdf.derived_delay_seconds),
        COALESCE(stc.stop_time_update_count, 0)
    FROM silver.trip_updates AS tu
    LEFT JOIN stop_time_counts AS stc
      ON stc.realtime_snapshot_id = tu.realtime_snapshot_id
     AND stc.entity_index = tu.entity_index
    LEFT JOIN trip_delay_fallback AS tdf
      ON tdf.realtime_snapshot_id = tu.realtime_snapshot_id
     AND tdf.entity_index = tu.entity_index
    LEFT JOIN LATERAL (
        SELECT
            vp.vehicle_id
        FROM silver.vehicle_positions AS vp
        WHERE vp.provider_id = tu.provider_id
          AND vp.trip_id = tu.trip_id
          AND vp.vehicle_id IS NOT NULL
          AND (tu.route_id IS NULL OR vp.route_id = tu.route_id)
          AND vp.feed_timestamp_utc BETWEEN
                tu.feed_timestamp_utc - interval '10 minutes'
            AND tu.feed_timestamp_utc + interval '10 minutes'
        ORDER BY
            abs(EXTRACT(EPOCH FROM (vp.feed_timestamp_utc - tu.feed_timestamp_utc))),
            vp.realtime_snapshot_id DESC,
            vp.entity_index
        LIMIT 1
    ) AS vpm
      ON tu.vehicle_id IS NULL
     AND tu.trip_id IS NOT NULL
    WHERE tu.provider_id = :provider_id
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


def _table_name(table_name: str) -> str:
    allowed_names = {
        "dim_route",
        "dim_stop",
        "dim_date",
        "fact_vehicle_snapshot",
        "fact_trip_delay_snapshot",
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
            SELECT max(realtime_snapshot_id)
            FROM silver.trip_updates
            WHERE provider_id = :provider_id
            """
        ),
        {"provider_id": provider_id},
    ).scalar_one()
    latest_vehicle_snapshot_id = connection.execute(
        text(
            """
            SELECT max(realtime_snapshot_id)
            FROM silver.vehicle_positions
            WHERE provider_id = :provider_id
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
            int(latest_vehicle_snapshot_id)
            if latest_vehicle_snapshot_id is not None
            else None
        ),
    )


def _delete_existing_provider_rows(connection: Connection, *, provider_id: str) -> None:
    params = {"provider_id": provider_id}
    connection.execute(DELETE_FACT_TRIP_DELAY_SNAPSHOT, params)
    connection.execute(DELETE_FACT_VEHICLE_SNAPSHOT, params)
    connection.execute(DELETE_DIM_DATE, params)
    connection.execute(DELETE_DIM_STOP, params)
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
    connection.execute(INSERT_DIM_STOP, params)
    connection.execute(INSERT_DIM_DATE, params)
    connection.execute(INSERT_FACT_VEHICLE_SNAPSHOT, params)
    connection.execute(INSERT_FACT_TRIP_DELAY_SNAPSHOT, params)

    return {
        "dim_route": _count_gold_rows(
            connection,
            provider_id=context.provider_id,
            table_name="dim_route",
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
    }


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
