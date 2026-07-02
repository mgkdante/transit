"""Real-DB test for the S15 windowed alert_history builder + multi-period capture.

Exercises the ACTUAL Postgres path fake tests cannot: the 0077 child table + the
gold.i3_alert_history_reporting join, the correlated active_periods json_agg, the
:win_start/:win_end window clamp, and the byte-ceiling probe. Seeds silver SCD-2
rows across a >90-day span via the real loader (which now writes child periods),
then builds historic/alert_history.json.

Runs ONLY with TRANSIT_TEST_DATABASE_URL on a disposable Postgres at head
(0077). CI has no Postgres; this file is local-only. Never point at production.
Each test runs inside one transaction and rolls back.

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55437/transit_repro?host=/tmp/pg" \
        uv run pytest tests/test_alert_history_window_realdb.py -v
"""

from __future__ import annotations

import os
import time
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

from transit_ops.silver.i3 import RawI3AlertSnapshot, load_i3_snapshot_to_silver
from transit_ops.snapshots.builders import build_alert_history
from transit_ops.snapshots.contract import ALERT_HISTORY_BYTE_CEILING

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB tests skipped",
)

PROVIDER = "stm_alerthistwin_test"
ENDPOINT_ID = 994014
NOW = datetime.now(UTC)
# One capture well INSIDE the 90d window (a multi-window alert), one WELL OUTSIDE.
IN_SNAP, IN_RUN = 994001, 994101
OUT_SNAP, OUT_RUN = 994002, 994102
IN_TIME = NOW - timedelta(days=10)
OUT_TIME = NOW - timedelta(days=200)

# In-window alert with TWO active windows (multi-period capture).
IN_ALERT = {
    "id": "WIN-A",
    "header": "Fermeture de fin de semaine",
    "description": "Travaux",
    "severity": "warning",
    "cause": "CONSTRUCTION",
    "effect": "DETOUR",
    "routes": ["51"],
    "url": [
        {"language": "fr", "text": "https://stm.info/avis/win-a"},
        {"language": "en", "text": "https://stm.info/en/alert/win-a"},
    ],
    "activePeriods": [
        {"start": int((NOW - timedelta(days=9)).timestamp()),
         "end": int((NOW - timedelta(days=8)).timestamp())},
        {"start": int((NOW - timedelta(days=2)).timestamp()),
         "end": int((NOW - timedelta(days=1)).timestamp())},
    ],
}
# Out-of-window alert (200 days old) — must be clamped OUT.
OUT_ALERT = {"id": "OLD-A", "header": "Vieil avis", "routes": ["24"]}


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _seed(connection) -> None:
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM alert-history window test', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'i3_alerts', 'i3_alerts', 'api_i3_json')
            """
        ),
        {"e": ENDPOINT_ID, "p": PROVIDER},
    )
    for run_id, snap_id, captured in (
        (IN_RUN, IN_SNAP, IN_TIME),
        (OUT_RUN, OUT_SNAP, OUT_TIME),
    ):
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
                VALUES (:r, :p, :e, 'i3_alerts', 'succeeded')
                """
            ),
            {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID},
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.i3_alert_snapshots
                    (i3_alert_snapshot_id, provider_id, feed_endpoint_id,
                     ingestion_run_id, captured_at_utc, raw_payload_json)
                VALUES (:s, :p, :e, :r, :captured, '{}')
                """
            ),
            {"s": snap_id, "p": PROVIDER, "e": ENDPOINT_ID, "r": run_id, "captured": captured},
        )


def _load(connection, snap_id: int, captured: datetime, alerts: list) -> None:
    load_i3_snapshot_to_silver(
        connection,
        snapshot=RawI3AlertSnapshot(
            i3_alert_snapshot_id=snap_id,
            provider_id=PROVIDER,
            captured_at_utc=captured,
            raw_payload_json=alerts,
        ),
    )


def test_window_clamps_and_serves_multi_period(conn, capsys) -> None:  # noqa: ANN001
    _load(conn, IN_SNAP, IN_TIME, [IN_ALERT])
    _load(conn, OUT_SNAP, OUT_TIME, [OUT_ALERT])

    t0 = time.perf_counter()
    out = build_alert_history(conn, PROVIDER, generated_utc="t")
    elapsed = time.perf_counter() - t0

    # Window bounds: end = provider-local today, start = end - retention.
    assert out.window_start is not None and out.window_end is not None
    assert out.window_start < out.window_end
    # The 200-day-old alert is clamped OUT; the in-window one survives.
    headers = {e.header_text for e in out.alerts}
    assert "Fermeture de fin de semaine" in headers
    assert "Vieil avis" not in headers
    # The in-window entry serves BOTH active windows + url + raw passthroughs.
    entry = next(e for e in out.alerts if e.header_text == "Fermeture de fin de semaine")
    assert entry.url == "https://stm.info/avis/win-a"
    assert len(entry.active_periods) == 2
    assert all(p.start_utc is not None and p.end_utc is not None for p in entry.active_periods)
    assert entry.cause == "CONSTRUCTION"
    assert entry.effect == "DETOUR"
    # Byte-ceiling probe + a timing sanity note on the 90d scan.
    size = len(out.model_dump_json().encode("utf-8"))
    with capsys.disabled():
        print(f"\n[S15 alert_history probe] entries={len(out.alerts)} bytes={size} "
              f"ceiling={ALERT_HISTORY_BYTE_CEILING} build={elapsed*1000:.0f}ms")
    assert size <= ALERT_HISTORY_BYTE_CEILING


def test_pre_0077_row_falls_back_to_scalar_period(conn) -> None:  # noqa: ANN001
    """A row with NO child periods (simulating pre-0077 history) still surfaces a
    1-element active_periods list from the scalar pair."""
    _load(conn, IN_SNAP, IN_TIME, [IN_ALERT])
    # Delete the child periods for the in-window alert to simulate legacy history.
    conn.execute(
        text(
            """
            DELETE FROM silver.i3_alert_active_periods p
            USING silver.i3_alerts a
            WHERE a.i3_alert_snapshot_id = p.i3_alert_snapshot_id
              AND a.alert_index = p.alert_index
              AND a.provider_id = :p
            """
        ),
        {"p": PROVIDER},
    )
    out = build_alert_history(conn, PROVIDER, generated_utc="t")
    entry = next(e for e in out.alerts if e.header_text == "Fermeture de fin de semaine")
    # scalar period[0] survives on the alert row -> exactly 1 fallback window.
    assert len(entry.active_periods) == 1
    assert entry.url is None or isinstance(entry.url, str)
