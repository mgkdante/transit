"""Real-DB: GTFS-RT service alerts reuse the i3 SCD-2 silver + gold path.

Proves the reuse end to end against the real schema: a converted GTFS-RT alerts
payload stored in raw.i3_alert_snapshots behind a ``run_kind='service_alerts'``
ingestion run (exercises migration 0053) merges through load_i3_snapshot_to_silver
into silver.i3_alerts / silver.i3_alert_informed_entities and surfaces in the
gold.current_i3_alerts view — with zero new silver/gold code.

Runs ONLY with TRANSIT_TEST_DATABASE_URL on a disposable Postgres at head;
CI/local-only. One transaction, rolled back.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from google.transit import gtfs_realtime_pb2
from sqlalchemy import Connection, bindparam, create_engine, text
from sqlalchemy.dialects.postgresql import JSONB

from transit_ops.ingestion.service_alerts import convert_gtfs_rt_alerts_to_i3_payload
from transit_ops.silver.i3 import RawI3AlertSnapshot, load_i3_snapshot_to_silver

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER = "sto_alerts_test"


def _service_alerts_payload() -> dict[str, object]:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    entity = message.entity.add()
    entity.id = "alert-A1"
    alert = entity.alert
    period = alert.active_period.add()
    period.start = 1_700_000_000  # past
    period.end = 4_000_000_000  # far future, so the alert is current
    alert.cause = gtfs_realtime_pb2.Alert.CONSTRUCTION
    alert.effect = gtfs_realtime_pb2.Alert.DETOUR
    header = alert.header_text.translation.add()
    header.language = "fr"
    header.text = "Détour ligne 33"
    selector = alert.informed_entity.add()
    selector.route_id = "33"
    return convert_gtfs_rt_alerts_to_i3_payload(message.SerializeToString())


@pytest.fixture()
def seeded() -> Iterator[tuple[Connection, int]]:
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(
            text(
                "INSERT INTO core.providers "
                "(provider_id, provider_key, display_name, timezone) "
                "VALUES (:p, :p, 'STO alerts test', 'America/Toronto')"
            ),
            {"p": PROVIDER},
        )
        feed_endpoint_id = connection.execute(
            text(
                "INSERT INTO core.feed_endpoints "
                "(provider_id, endpoint_key, feed_kind, source_format) "
                "VALUES (:p, 'service_alerts', 'service_alerts', 'gtfs_rt_service_alerts') "
                "RETURNING feed_endpoint_id"
            ),
            {"p": PROVIDER},
        ).scalar_one()
        ingestion_run_id = connection.execute(
            text(
                "INSERT INTO raw.ingestion_runs "
                "(provider_id, feed_endpoint_id, run_kind, status) "
                "VALUES (:p, :fe, 'service_alerts', 'succeeded') "
                "RETURNING ingestion_run_id"
            ),
            {"p": PROVIDER, "fe": feed_endpoint_id},
        ).scalar_one()
        snapshot_id = connection.execute(
            text(
                "INSERT INTO raw.i3_alert_snapshots "
                "(provider_id, feed_endpoint_id, ingestion_run_id, captured_at_utc, "
                " raw_payload_json) "
                "VALUES (:p, :fe, :run, now(), :payload) "
                "RETURNING i3_alert_snapshot_id"
            ).bindparams(bindparam("payload", type_=JSONB)),
            {
                "p": PROVIDER,
                "fe": feed_endpoint_id,
                "run": ingestion_run_id,
                "payload": _service_alerts_payload(),
            },
        ).scalar_one()
        try:
            yield connection, snapshot_id
        finally:
            transaction.rollback()
            engine.dispose()


def test_service_alerts_merge_into_silver_and_gold(
    seeded: tuple[Connection, int],
) -> None:
    connection, snapshot_id = seeded
    snapshot = RawI3AlertSnapshot(
        i3_alert_snapshot_id=snapshot_id,
        provider_id=PROVIDER,
        captured_at_utc=datetime.now(UTC),
        raw_payload_json=_service_alerts_payload(),
    )

    result = load_i3_snapshot_to_silver(connection, snapshot=snapshot)
    assert result.alert_rows_inserted == 1

    silver = (
        connection.execute(
            text(
                "SELECT alert_id, alert_header_text, alert_header_text_en, cause, effect "
                "FROM silver.i3_alerts WHERE provider_id = :p AND valid_to IS NULL"
            ),
            {"p": PROVIDER},
        )
        .mappings()
        .all()
    )
    assert len(silver) == 1
    assert silver[0]["alert_id"] == "alert-A1"
    assert silver[0]["alert_header_text"] == "Détour ligne 33"
    assert silver[0]["cause"] == "CONSTRUCTION"
    assert silver[0]["effect"] == "DETOUR"

    entities = (
        connection.execute(
            text(
                "SELECT route_id FROM silver.i3_alert_informed_entities "
                "WHERE provider_id = :p"
            ),
            {"p": PROVIDER},
        )
        .scalars()
        .all()
    )
    assert "33" in entities

    gold_count = connection.execute(
        text("SELECT count(*) FROM gold.current_i3_alerts WHERE provider_id = :p"),
        {"p": PROVIDER},
    ).scalar_one()
    assert gold_count >= 1
