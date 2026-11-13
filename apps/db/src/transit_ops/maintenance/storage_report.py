"""Read-only storage and capture measurements."""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import Connection, text

_QUERIES = {
    "static_editions": """
SELECT 'stop_times' AS t,provider_id,dataset_version_id,count(*) FROM silver.stop_times GROUP BY 2,3
UNION ALL SELECT 'shapes',provider_id,dataset_version_id,count(*) FROM silver.shapes GROUP BY 2,3
UNION ALL SELECT 'trips', provider_id, dataset_version_id, count(*) FROM silver.trips GROUP BY 2, 3
ORDER BY 1, 2, 3
""",
    "table_health": """
SELECT schemaname, relname, n_live_tup, n_dead_tup, last_autovacuum, last_analyze
FROM pg_stat_user_tables
WHERE (schemaname, relname) IN (('silver','stop_times'), ('silver','shapes'), ('silver','trips'),
      ('silver','i3_alert_informed_entities'), ('gold','stop_delay_hourly'),
      ('raw','ingestion_objects'), ('raw','ingestion_runs'), ('raw','realtime_snapshot_index'),
      ('raw','i3_alert_snapshots'))
""",
    "secondary_indexes": """
SELECT s.schemaname, s.relname, s.indexrelname, s.idx_scan,
       pg_relation_size(s.indexrelid) AS bytes
FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.schemaname IN ('raw', 'silver', 'gold') AND NOT i.indisprimary AND NOT i.indisunique
ORDER BY bytes DESC LIMIT 40
""",
    "polls_by_feed_hour": """
SELECT r.provider_id, e.endpoint_key, date_trunc('hour', r.started_at_utc) AS hour,
       count(*) AS attempted, count(*) FILTER (WHERE r.status = 'succeeded') AS stored,
       avg(extract(epoch FROM r.completed_at_utc - r.started_at_utc)) AS mean_capture_seconds
FROM raw.ingestion_runs r JOIN core.feed_endpoints e ON e.feed_endpoint_id = r.feed_endpoint_id
WHERE r.started_at_utc >= now() - interval '2 days' AND r.run_kind <> 'silver_load'
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
""",
    "feeds": """
SELECT e.provider_id, e.endpoint_key, e.created_at_utc, e.refresh_interval_seconds,
       min(r.started_at_utc) AS first_attempt, max(r.started_at_utc) AS last_attempt,
       count(r.*) AS attempts
FROM core.feed_endpoints e LEFT JOIN raw.ingestion_runs r
  ON r.feed_endpoint_id = e.feed_endpoint_id AND r.run_kind <> 'silver_load'
GROUP BY 1, 2, 3, 4 ORDER BY 1, 2
""",
    "raw_tables": """
SELECT c.relname, pg_relation_size(c.oid) AS heap, pg_indexes_size(c.oid) AS indexes,
       pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid) AS toast,
       c.reltuples::bigint AS rows_estimate
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'raw' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC
""",
}


def _json_value(value: object) -> object:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, Decimal):
        return float(round(value, 3))
    return value


def build_storage_report(
    connection: Connection, *, limit: int, editions: bool = False
) -> dict[str, object]:
    """Return catalog sizes and measurements; full edition scans are opt-in."""
    report: dict[str, object] = {}
    table_sql = text("""
        SELECT n.nspname AS schema, c.relname AS table,
               pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
               pg_total_relation_size(c.oid) AS total_bytes
        FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = :schema
        ORDER BY pg_total_relation_size(c.oid) DESC LIMIT :limit
    """)
    for schema in ("silver", "gold"):
        rows = connection.execute(table_sql, {"schema": schema, "limit": limit}).mappings()
        report[schema] = [
            {
                "table": f"{r['schema']}.{r['table']}",
                "total_size": r["total_size"],
                "total_bytes": int(r["total_bytes"]),
            }
            for r in rows
        ]
    report["database_total"] = connection.execute(
        text("SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty")
    ).scalar_one()
    for key, sql in _QUERIES.items():
        if key == "static_editions" and not editions:
            continue
        report[key] = [
            {name: _json_value(value) for name, value in row.items()}
            for row in connection.execute(text(sql)).mappings()
        ]
    report["stats_reset_utc"] = _json_value(
        connection.execute(
            text("SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()")
        ).scalar_one()
    )
    return report
