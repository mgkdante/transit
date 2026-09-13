"""Windowed alert history and versioned enrichment against disposable Postgres.

Seed through the Silver loader; every test rolls its transaction back.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from transit_ops.silver.i3 import RawI3AlertSnapshot, load_i3_snapshot_to_silver
from transit_ops.snapshots.builders import build_alert_history
from transit_ops.snapshots.contract import ALERT_HISTORY_BYTE_CEILING

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
        {
            "start": int((NOW - timedelta(days=9)).timestamp()),
            "end": int((NOW - timedelta(days=8)).timestamp()),
        },
        {
            "start": int((NOW - timedelta(days=2)).timestamp()),
            "end": int((NOW - timedelta(days=1)).timestamp()),
        },
    ],
}
# Out-of-window alert (200 days old) — must be clamped OUT.
OUT_ALERT = {"id": "OLD-A", "header": "Vieil avis", "routes": ["24"]}


@pytest.fixture()
def conn(real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        seed_provider(connection, PROVIDER, display_name="STM alert-history window test")
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection, *, provider=PROVIDER, offset=0) -> None:
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'i3_alerts', 'i3_alerts', 'api_i3_json')
            """
        ),
        {"e": ENDPOINT_ID + offset, "p": provider},
    )
    for run_id, snap_id, captured in (
        (IN_RUN + offset, IN_SNAP + offset, IN_TIME),
        (OUT_RUN + offset, OUT_SNAP + offset, OUT_TIME),
    ):
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
                VALUES (:r, :p, :e, 'i3_alerts', 'succeeded')
                """
            ),
            {"r": run_id, "p": provider, "e": ENDPOINT_ID + offset},
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
            {
                "s": snap_id,
                "p": provider,
                "e": ENDPOINT_ID + offset,
                "r": run_id,
                "captured": captured,
            },
        )


def _load(connection, snap_id: int, captured: datetime, alerts: list, *, provider=PROVIDER) -> None:
    load_i3_snapshot_to_silver(
        connection,
        snapshot=RawI3AlertSnapshot(
            i3_alert_snapshot_id=snap_id,
            provider_id=provider,
            provider_timezone="America/Toronto",
            captured_at_utc=captured,
            raw_payload_json=alerts,
        ),
    )


def test_window_clamps_and_serves_multi_period(conn, capsys) -> None:  # noqa: ANN001
    _load(conn, OUT_SNAP, OUT_TIME, [OUT_ALERT])
    _load(conn, IN_SNAP, IN_TIME, [IN_ALERT])

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
        print(
            f"\n[S15 alert_history probe] entries={len(out.alerts)} bytes={size} "
            f"ceiling={ALERT_HISTORY_BYTE_CEILING} build={elapsed * 1000:.0f}ms"
        )
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


@pytest.mark.parametrize(
    "first",
    [
        {},
        {"start": 1000},
        {"end": 2000},
        {"start": 1000, "end": 2000},
    ],
)
def test_enrichment_matches_nullable_identity_across_all_versions(conn, seed_provider, first):
    def alert(description, url, periods, *, header=None, entities=()):
        return {
            "header": header,
            "description": description,
            "severity": "warning",
            "url": url,
            "activePeriods": periods,
            "informedEntities": list(entities),
        }

    def period(start):
        return {"start": start, "end": start + 10}

    # The older capture has the larger snapshot ID. Index 1 overrides index 0
    # only for periods it carries; older indexes still supply missing positions.
    _load(
        conn,
        OUT_SNAP,
        OUT_TIME,
        [
            alert("outside-z", "https://example.com/z", [first, period(3000), period(4000)]),
            alert("outside-y", "https://example.com/a", [first, period(5000)]),
            alert(
                "other identity",
                "https://example.com/zzz",
                [first, period(9000)],
                header="Different header",
            ),
            alert("other scalar identity", "https://example.com/zzz", [period(9000), period(9100)]),
        ],
    )
    _load(
        conn,
        IN_SNAP,
        IN_TIME,
        [
            alert(
                "inside earlier",
                "https://example.com/b",
                [first, period(6000), period(7000), period(8000)],
            ),
            alert(
                "inside only",
                "https://example.com/b",
                [first, period(6000), period(7000), period(8000)],
                entities=[
                    {"routeId": "10", "stopId": "B"},
                    {"routeId": "2", "stopId": "A"},
                    {"routeId": "2", "stopId": "A"},
                ],
            ),
        ],
    )
    other = PROVIDER + "_other"
    seed_provider(conn, other, display_name="Other alert provider")
    _seed(conn, provider=other, offset=1000)
    _load(
        conn,
        IN_SNAP + 1000,
        IN_TIME,
        [
            alert("foreign", "https://example.com/zzzz", [first, period(9900)]),
        ],
        provider=other,
    )

    out = build_alert_history(conn, PROVIDER, generated_utc="t")
    assert out.total_in_window == 1
    assert len(out.alerts) == 1
    entry = out.alerts[0]
    assert entry.header_text is None
    assert entry.description == "inside only"
    assert entry.url == "https://example.com/z"
    assert entry.routes == ["2", "10"]
    assert entry.stops == ["A", "B"]

    def iso(value):
        return datetime.fromtimestamp(value, UTC).isoformat().replace("+00:00", "Z")

    assert [p.model_dump() for p in entry.active_periods] == [
        {
            "start_utc": iso(bounds["start"]) if "start" in bounds else None,
            "end_utc": iso(bounds["end"]) if "end" in bounds else None,
        }
        for bounds in (first, period(5000), period(4000), period(8000))
    ]


def test_missing_children_and_scalar_bounds_remain_unknown(conn):
    _load(conn, IN_SNAP, IN_TIME, [{"header": "No period", "description": "No window"}])
    out = build_alert_history(conn, PROVIDER, generated_utc="t")
    assert len(out.alerts) == 1
    assert out.alerts[0].active_periods == []
    assert out.alerts[0].url is None
    assert out.alerts[0].start_utc is None
    assert out.alerts[0].end_utc is None


@pytest.mark.parametrize("tied", [False, True])
def test_alert_cap_preserves_precap_count_and_start_order(conn, tied):
    start = int(IN_TIME.timestamp())
    alerts = [
        {
            "header": f"Alert {index}",
            "activePeriods": [{"start": start if tied else start + index, "end": start + 1000}],
        }
        for index in range(501)
    ]
    _load(conn, IN_SNAP, IN_TIME, alerts)
    out = build_alert_history(conn, PROVIDER, generated_utc="t")
    assert out.total_in_window == 501
    assert out.truncated
    assert len(out.alerts) == 500
    assert len({entry.id for entry in out.alerts}) == 500
    starts = [entry.start_utc for entry in out.alerts]
    assert starts == sorted(starts, reverse=True)
    if tied:
        assert {entry.header_text for entry in out.alerts} <= {alert["header"] for alert in alerts}
    else:
        assert out.alerts[0].header_text == "Alert 500"
        assert out.alerts[-1].header_text == "Alert 1"
