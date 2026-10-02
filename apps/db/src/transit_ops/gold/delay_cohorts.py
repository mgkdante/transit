from datetime import datetime, timedelta

from sqlalchemy import Connection

from transit_ops.sql_registry import named_query

_COHORT_SQL = """
    WITH captures AS MATERIALIZED (
        SELECT r.*, o.checksum_sha256, o.byte_size, run.provider_id AS run_provider,
               endpoint.provider_id AS endpoint_provider, o.provider_id AS object_provider,
               run.feed_endpoint_id AS run_endpoint, o.ingestion_run_id AS object_run
        FROM raw.realtime_snapshot_index AS r
        JOIN raw.ingestion_runs AS run USING (ingestion_run_id)
        JOIN core.feed_endpoints AS endpoint ON endpoint.feed_endpoint_id = r.feed_endpoint_id
        LEFT JOIN raw.ingestion_objects AS o USING (ingestion_object_id)
        WHERE r.provider_id = :provider_id AND endpoint.endpoint_key = 'trip_updates'
          AND run.status = 'succeeded'
          AND r.captured_at_utc >= :from_utc
          AND r.captured_at_utc < :until_utc
    ), frames AS MATERIALIZED (
        SELECT s.* FROM silver.rt_feed_snapshots AS s
        JOIN captures AS c ON c.realtime_snapshot_id = s.source_realtime_snapshot_id
        WHERE s.provider_id = :provider_id
    ), entities AS MATERIALIZED (
        SELECT s.source_realtime_snapshot_id AS snapshot_id, e.entity_index, e.entity_kind
        FROM frames AS s JOIN silver.rt_entities AS e USING (rt_feed_snapshot_id)
        WHERE e.provider_id = :provider_id
    ), entity_counts AS MATERIALIZED (
        SELECT snapshot_id, count(*) AS rows FROM entities GROUP BY snapshot_id
    ), trips AS MATERIALIZED (
        SELECT s.source_realtime_snapshot_id AS snapshot_id, t.entity_index
        FROM frames AS s JOIN silver.rt_trip_updates AS t USING (rt_feed_snapshot_id)
        WHERE t.provider_id = :provider_id
    ), facts AS MATERIALIZED (
        SELECT realtime_snapshot_id AS snapshot_id, entity_index
        FROM gold.fact_trip_delay_snapshot
        WHERE provider_id = :provider_id
          AND captured_at_utc >= :from_utc
          AND captured_at_utc < :until_utc
    )
    SELECT EXISTS (SELECT 1 FROM captures)
      AND NOT EXISTS (
        SELECT 1 FROM captures AS c
        LEFT JOIN frames AS s ON s.source_realtime_snapshot_id = c.realtime_snapshot_id
        LEFT JOIN entity_counts AS ec ON ec.snapshot_id = c.realtime_snapshot_id
        WHERE s.rt_feed_snapshot_id IS NULL
           OR c.entity_count IS NULL OR c.entity_count < 0
           OR c.checksum_sha256 IS NULL
           OR c.checksum_sha256 !~ '^[0-9A-Fa-f]{64}$'
           OR c.byte_size IS NULL OR c.byte_size < 0
           OR c.run_provider IS DISTINCT FROM c.provider_id
           OR c.endpoint_provider IS DISTINCT FROM c.provider_id
           OR c.object_provider IS DISTINCT FROM c.provider_id
           OR c.run_endpoint IS DISTINCT FROM c.feed_endpoint_id
           OR c.object_run IS DISTINCT FROM c.ingestion_run_id
           OR s.checksum_sha256 IS DISTINCT FROM c.checksum_sha256
           OR s.byte_size IS DISTINCT FROM c.byte_size
           OR s.feed_endpoint_id IS DISTINCT FROM c.feed_endpoint_id
           OR s.ingestion_run_id IS DISTINCT FROM c.ingestion_run_id
           OR s.ingestion_object_id IS DISTINCT FROM c.ingestion_object_id
           OR s.captured_at_utc IS DISTINCT FROM c.captured_at_utc
           OR s.feed_timestamp_utc IS DISTINCT FROM c.feed_timestamp_utc
           OR s.endpoint_key <> 'trip_updates'
           OR (s.manifest_json @> jsonb_build_object('entity_count', c.entity_count)) IS NOT TRUE
           OR COALESCE(ec.rows, 0) <> c.entity_count
      )
      AND NOT EXISTS (
        SELECT 1 FROM entities AS e JOIN captures AS c ON c.realtime_snapshot_id = e.snapshot_id
        WHERE e.entity_index < 0 OR e.entity_index >= c.entity_count
      )
      AND NOT EXISTS (
        (SELECT snapshot_id, entity_index FROM entities WHERE entity_kind = 'trip_update'
         EXCEPT SELECT * FROM trips)
        UNION ALL
        (SELECT * FROM trips EXCEPT
         SELECT snapshot_id, entity_index FROM entities WHERE entity_kind = 'trip_update')
        UNION ALL
        (SELECT * FROM trips EXCEPT SELECT * FROM facts)
        UNION ALL
        (SELECT * FROM facts EXCEPT SELECT * FROM trips)
      )
    """
_COMPLETE_PERIOD = named_query("rollup.trip_delay.complete_cohort", _COHORT_SQL)
_COMPLETE_WINDOW = named_query("rollup.trip_delay.complete_window", _COHORT_SQL)


def delay_window_is_complete(
    conn: Connection, provider_id: str, from_utc: datetime, until_utc: datetime
) -> bool:
    return bool(
        conn.execute(
            _COMPLETE_WINDOW,
            {
                "provider_id": provider_id,
                "from_utc": from_utc,
                "until_utc": until_utc,
            },
        ).scalar_one()
    )


def delay_period_is_complete(conn: Connection, provider_id: str, period: datetime) -> bool:
    return bool(
        conn.execute(
            _COMPLETE_PERIOD,
            {
                "provider_id": provider_id,
                "from_utc": period,
                "until_utc": period + timedelta(minutes=5),
            },
        ).scalar_one()
    )
