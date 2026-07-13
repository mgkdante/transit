"""Transactional PostgreSQL proof for the bounded alert archive sync."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold.alert_archive import sync_alert_archive_on_connection


def test_alert_archive_insert_update_and_unchanged_rerun() -> None:
    database_url = os.getenv("TRANSIT_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("set TRANSIT_TEST_DATABASE_URL for the PostgreSQL archive proof")

    provider_id = f"archive-test-{uuid.uuid4().hex[:10]}"
    engine = create_engine(database_url)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            if not connection.execute(
                text("SELECT to_regclass('gold.alert_archive_entry') IS NOT NULL")
            ).scalar_one():
                pytest.skip("database is not migrated through 0080_alert_archive")

            connection.execute(
                text(
                    """
                    INSERT INTO core.providers (
                        provider_id, provider_key, display_name, timezone
                    ) VALUES (:provider_id, :provider_id, 'Archive test', 'America/Toronto')
                    """
                ),
                {"provider_id": provider_id},
            )
            endpoint_id = connection.execute(
                text(
                    """
                    INSERT INTO core.feed_endpoints (
                        provider_id, endpoint_key, feed_kind, source_format
                    ) VALUES (:provider_id, 'alerts', 'i3_alerts', 'api_i3_json')
                    RETURNING feed_endpoint_id
                    """
                ),
                {"provider_id": provider_id},
            ).scalar_one()
            run_id = connection.execute(
                text(
                    """
                    INSERT INTO raw.ingestion_runs (
                        provider_id, feed_endpoint_id, run_kind, status
                    ) VALUES (:provider_id, :endpoint_id, 'i3_alerts', 'succeeded')
                    RETURNING ingestion_run_id
                    """
                ),
                {"provider_id": provider_id, "endpoint_id": endpoint_id},
            ).scalar_one()
            snapshot_id = connection.execute(
                text(
                    """
                    INSERT INTO raw.i3_alert_snapshots (
                        provider_id,
                        feed_endpoint_id,
                        ingestion_run_id,
                        captured_at_utc,
                        raw_payload_json
                    ) VALUES (
                        :provider_id,
                        :endpoint_id,
                        :run_id,
                        '2026-07-08T13:00:00Z',
                        '{}'::jsonb
                    ) RETURNING i3_alert_snapshot_id
                    """
                ),
                {
                    "provider_id": provider_id,
                    "endpoint_id": endpoint_id,
                    "run_id": run_id,
                },
            ).scalar_one()
            connection.execute(
                text(
                    """
                    INSERT INTO silver.i3_alerts (
                        i3_alert_snapshot_id,
                        alert_index,
                        provider_id,
                        alert_id,
                        alert_header_text,
                        description_text,
                        alert_header_text_en,
                        description_text_en,
                        severity,
                        cause,
                        effect,
                        active_period_start_utc,
                        active_period_end_utc,
                        captured_at_utc,
                        raw_alert_json,
                        content_hash,
                        first_seen_at,
                        last_seen_at,
                        url
                    ) VALUES (
                        :snapshot_id,
                        0,
                        :provider_id,
                        'A-1',
                        'Votre ligne',
                        'Terminus temporaire.',
                        'Your line',
                        'Temporary terminus.',
                        'WARNING',
                        'CONSTRUCTION',
                        'DETOUR',
                        '2026-07-08T13:00:00Z',
                        '2026-07-10T19:00:00Z',
                        '2026-07-08T13:00:00Z',
                        '{}'::jsonb,
                        'archive-real-db-v1',
                        '2026-07-08T12:55:00Z',
                        '2026-07-10T19:05:00Z',
                        'https://www.stm.info/fr/infos/etat-du-service'
                    )
                    """
                ),
                {"snapshot_id": snapshot_id, "provider_id": provider_id},
            )
            connection.execute(
                text(
                    """
                    INSERT INTO silver.i3_alert_informed_entities (
                        i3_alert_snapshot_id,
                        alert_index,
                        entity_index,
                        provider_id,
                        route_id,
                        raw_entity_json
                    ) VALUES (:snapshot_id, 0, 0, :provider_id, '45', '{}'::jsonb)
                    """
                ),
                {"snapshot_id": snapshot_id, "provider_id": provider_id},
            )
            connection.execute(
                text(
                    """
                    INSERT INTO silver.i3_alert_active_periods (
                        i3_alert_snapshot_id, alert_index, period_index, start_utc, end_utc
                    ) VALUES (
                        :snapshot_id, 0, 0, '2026-07-08T13:00:00Z', '2026-07-10T19:00:00Z'
                    )
                    """
                ),
                {"snapshot_id": snapshot_id},
            )

            first = sync_alert_archive_on_connection(
                connection,
                provider_id=provider_id,
                from_date=date(2026, 7, 1),
                to_date=date(2026, 7, 31),
                synced_at_utc=datetime(2026, 7, 13, 4, 0, tzinfo=UTC),
            )
            assert (first.inserted_count, first.updated_count, first.unchanged_count) == (1, 0, 0)
            initial = (
                connection.execute(
                    text(
                        "SELECT * FROM gold.alert_archive_entry "
                        "WHERE provider_id = :provider_id AND alert_id = 'A-1'"
                    ),
                    {"provider_id": provider_id},
                )
                .mappings()
                .one()
            )
            assert initial["description_text"] == "Terminus temporaire."
            assert initial["description_text_en"] == "Temporary terminus."
            assert initial["route_ids"] == ["45"]
            assert len(initial["active_periods"]) == 1

            connection.execute(
                text(
                    """
                    UPDATE silver.i3_alerts
                    SET description_text = 'Terminus déplacé.',
                        description_text_en = NULL,
                        last_seen_at = '2026-07-11T20:00:00Z'
                    WHERE i3_alert_snapshot_id = :snapshot_id AND alert_index = 0
                    """
                ),
                {"snapshot_id": snapshot_id},
            )
            connection.execute(
                text(
                    """
                    INSERT INTO silver.i3_alert_informed_entities (
                        i3_alert_snapshot_id,
                        alert_index,
                        entity_index,
                        provider_id,
                        route_id,
                        raw_entity_json
                    ) VALUES (:snapshot_id, 0, 1, :provider_id, '747', '{}'::jsonb)
                    """
                ),
                {"snapshot_id": snapshot_id, "provider_id": provider_id},
            )

            second = sync_alert_archive_on_connection(
                connection,
                provider_id=provider_id,
                from_date=date(2026, 7, 1),
                to_date=date(2026, 7, 31),
                synced_at_utc=datetime(2026, 7, 13, 5, 0, tzinfo=UTC),
            )
            assert (second.inserted_count, second.updated_count, second.unchanged_count) == (
                0,
                1,
                0,
            )
            changed = (
                connection.execute(
                    text(
                        "SELECT * FROM gold.alert_archive_entry "
                        "WHERE provider_id = :provider_id AND alert_id = 'A-1'"
                    ),
                    {"provider_id": provider_id},
                )
                .mappings()
                .one()
            )
            assert changed["archive_month"] == initial["archive_month"]
            assert changed["first_seen_utc"] == initial["first_seen_utc"]
            assert changed["description_text"] == "Terminus déplacé."
            assert changed["description_text_en"] == "Temporary terminus."
            assert changed["route_ids"] == ["45", "747"]

            third = sync_alert_archive_on_connection(
                connection,
                provider_id=provider_id,
                from_date=date(2026, 7, 1),
                to_date=date(2026, 7, 31),
                synced_at_utc=datetime(2026, 7, 13, 6, 0, tzinfo=UTC),
            )
            assert (third.inserted_count, third.updated_count, third.unchanged_count) == (0, 0, 1)
            unchanged_updated_at = connection.execute(
                text(
                    "SELECT updated_at_utc FROM gold.alert_archive_entry "
                    "WHERE provider_id = :provider_id AND alert_id = 'A-1'"
                ),
                {"provider_id": provider_id},
            ).scalar_one()
            assert unchanged_updated_at == changed["updated_at_utc"]
        finally:
            transaction.rollback()
