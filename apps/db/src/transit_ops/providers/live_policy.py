"""Persist provider policy and compact, timestamped route reporting evidence."""

import json

from sqlalchemy import Connection, text

from transit_ops.core.models import ProviderManifest


def sync_live_policy(connection: Connection, manifest: ProviderManifest) -> None:
    connection.execute(
        text("""
        UPDATE core.providers SET lines_without_live_data = CAST(:policy AS jsonb)
        WHERE provider_id = :provider_id
    """),
        {
            "provider_id": manifest.provider.provider_id,
            "policy": json.dumps(
                [g.model_dump() for g in manifest.realtime.lines_without_live_data]
            ),
        },
    )


def record_route_live_observations(
    connection: Connection, *, provider_id: str, snapshot_id: int, endpoint_key: str
) -> None:
    # Table names come exclusively from this closed mapping. Never from a manifest.
    table, timestamp = {
        "vehicle_positions": ("rt_vehicle_positions", "vehicle_timestamp_utc"),
        "trip_updates": ("rt_trip_updates", "trip_update_timestamp_utc"),
    }[endpoint_key]
    connection.execute(
        text(f"""
        INSERT INTO core.route_live_observations (provider_id, route_id, last_seen_at)
        SELECT r.provider_id, COALESCE(NULLIF(r.route_id, ''), t.route_id),
               max(COALESCE(r.{timestamp}, r.feed_timestamp_utc, r.captured_at_utc))
        FROM silver.{table} r
        LEFT JOIN core.dataset_versions d ON d.provider_id = r.provider_id
            AND d.dataset_kind = 'static_schedule' AND d.is_current
        LEFT JOIN silver.trips t ON NULLIF(r.route_id, '') IS NULL
            AND t.provider_id = r.provider_id
            AND t.dataset_version_id = d.dataset_version_id AND t.trip_id = r.trip_id
        WHERE r.provider_id = :provider_id AND r.rt_feed_snapshot_id = :snapshot_id
          AND COALESCE(NULLIF(r.route_id, ''), t.route_id) IS NOT NULL
          AND COALESCE(r.{timestamp}, r.feed_timestamp_utc, r.captured_at_utc)
              <= r.captured_at_utc
        GROUP BY r.provider_id, COALESCE(NULLIF(r.route_id, ''), t.route_id)
        ORDER BY 1, 2
        ON CONFLICT (provider_id, route_id) DO UPDATE
        SET last_seen_at = greatest(core.route_live_observations.last_seen_at,
                                   EXCLUDED.last_seen_at)
    """),
        {"provider_id": provider_id, "snapshot_id": snapshot_id},
    )
