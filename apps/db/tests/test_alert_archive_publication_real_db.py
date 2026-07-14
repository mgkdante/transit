"""Real-PostgreSQL proof for retained-alert publication mapping and isolation."""

from __future__ import annotations

import json
import os
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

from transit_ops.snapshots.builders import build_alert_archive

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER = "stm_archive_publish_test"
OTHER_PROVIDER = "other_archive_publish_test"


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        for provider in (PROVIDER, OTHER_PROVIDER):
            connection.execute(
                text(
                    """
                    INSERT INTO core.providers
                        (provider_id, display_name, timezone, provider_key)
                    VALUES (:provider, :provider, 'America/Toronto', :provider)
                    """
                ),
                {"provider": provider},
            )
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _insert(
    connection,
    *,
    provider: str,
    alert_id: str,
    archive_month: date,
    start: datetime,
    end: datetime | None,
    description: str,
    updated: datetime,
) -> None:
    periods = [
        {
            "start_utc": start.isoformat(),
            "end_utc": end.isoformat() if end is not None else None,
        },
        {
            "start_utc": (start + timedelta(days=2)).isoformat(),
            "end_utc": (start + timedelta(days=3)).isoformat(),
        },
    ]
    connection.execute(
        text(
            """
            INSERT INTO gold.alert_archive_entry (
                provider_id, alert_id, archive_month, header_text, header_text_en,
                description_text, description_text_en, severity, cause, effect,
                route_ids, stop_ids, start_utc, end_utc, active_periods, url,
                first_seen_utc, last_seen_utc, content_hash, updated_at_utc
            ) VALUES (
                :provider, :alert_id, :archive_month, :header_text, :header_text_en,
                :description, :description_en, 'WARNING', 'CONSTRUCTION', 'DETOUR',
                ARRAY['45','10','45'], ARRAY['7002','7001','7002'], :start, :end,
                CAST(:periods AS jsonb), :url, :first_seen, :last_seen, :content_hash, :updated
            )
            """
        ),
        {
            "provider": provider,
            "alert_id": alert_id,
            "archive_month": archive_month,
            "header_text": "🚇 Fermeture — Côte-Vertu <strong>maintenant</strong>",
            "header_text_en": "🚇 Closure — Côte-Vertu <strong>now</strong>",
            "description": description,
            "description_en": "<p>Exact English source message.</p>",
            "start": start,
            "end": end,
            "periods": json.dumps(periods),
            "url": "https://www.stm.info/fr/infos/etat-du-service",
            # 00:30Z is the prior provider-local date in Montréal.
            "first_seen": start - timedelta(minutes=30),
            "last_seen": (end or start) + timedelta(minutes=5),
            "content_hash": f"hash-{provider}-{alert_id}",
            "updated": updated,
        },
    )


def test_real_db_archive_preserves_messages_entities_periods_nulls_and_provider_scope(conn) -> None:
    july_start = datetime(2026, 7, 2, 0, 30, tzinfo=UTC)
    _insert(
        conn,
        provider=PROVIDER,
        alert_id="july-zero",
        archive_month=date(2026, 7, 1),
        start=july_start,
        end=july_start,
        description="<p>Message français exact 🚇 &amp; sans nettoyage.</p>",
        updated=july_start + timedelta(hours=2),
    )
    june_start = datetime(2026, 6, 15, 12, tzinfo=UTC)
    _insert(
        conn,
        provider=PROVIDER,
        alert_id="june-reversed",
        archive_month=date(2026, 6, 1),
        start=june_start,
        end=june_start - timedelta(minutes=1),
        description="<p>Deuxième message.</p>",
        updated=june_start + timedelta(hours=2),
    )
    _insert(
        conn,
        provider=OTHER_PROVIDER,
        alert_id="must-not-leak",
        archive_month=date(2026, 7, 1),
        start=july_start,
        end=july_start + timedelta(hours=1),
        description="OTHER PROVIDER",
        updated=july_start + timedelta(hours=3),
    )

    bundle = build_alert_archive(
        conn,
        PROVIDER,
        generated_utc="2026-07-13T00:00:00Z",
    )

    assert [month.month for month in bundle.index.months] == ["2026-07", "2026-06"]
    assert bundle.index.total_alerts == 2
    assert bundle.index.first_available_date == "2026-06-15"
    assert bundle.index.last_available_date == "2026-07-04"
    entries = [entry for _, page in bundle.page_items for entry in page.alerts]
    assert {entry.id for entry in entries} == {"july-zero", "june-reversed"}
    assert all(entry.description != "OTHER PROVIDER" for entry in entries)

    july = next(entry for entry in entries if entry.id == "july-zero")
    assert july.header_text == "🚇 Fermeture — Côte-Vertu <strong>maintenant</strong>"
    assert july.header_text_en == "🚇 Closure — Côte-Vertu <strong>now</strong>"
    assert july.description == "<p>Message français exact 🚇 &amp; sans nettoyage.</p>"
    assert july.description_en == "<p>Exact English source message.</p>"
    assert july.routes == ["10", "45"]
    assert july.stops == ["7001", "7002"]
    assert july.duration_min == 0
    assert july.url == "https://www.stm.info/fr/infos/etat-du-service"
    assert len(july.active_periods) == 2
    assert july.severity == "high"
    assert july.severity_level == "WARNING"

    reversed_entry = next(entry for entry in entries if entry.id == "june-reversed")
    assert reversed_entry.duration_min is None
