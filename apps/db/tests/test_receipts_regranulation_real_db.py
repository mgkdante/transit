"""Real-DB fixtures for the S13 re-granulated receipt (build_receipts).

Seeds gold.citizen_accountability_daily (the receipt DRIVER), gold.route_delay_spine
(by_shift), gold.route_cancellation_daily (service_states + not-reported list) and
gold.dim_route (name resolution) directly, then runs build_receipts + the publisher's
availability derivation. Covers the three fixtures the S13 spec calls for:

  (i)   a day with silent + not-reported routes  -> service_states.not_reported_routes
        lists the scheduled-but-dark route, not_reported_route_count >= 1.
  (ii)  a schedule-only day (scheduled universe known, no telemetry, alerts-only CAD
        row) -> the receipt IS emitted, by_shift == [], has_schedule True in the index.
  (iii) an EMPTY day (alerts-only CAD row, no schedule) -> receipt emitted, has_data
        False, has_schedule False.

A fully-dark scheduled day (scheduled>0, no RT, no alerts) has NO CAD row so the receipt
is correctly ABSENT — asserted here by NOT seeding a CAD row for such a date and checking
it never appears in the output or the availability index.
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy import create_engine, text

from transit_ops.snapshots.builders import build_receipts
from transit_ops.snapshots.builders.historic.small_surfaces import (
    _RECEIPTS_WORST_ROUTE_SQL,
    _RECEIPTS_WORST_STOP_SQL,
)
from transit_ops.snapshots.contract import ReceiptAvailability

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - S13 receipts real-DB tests skipped",
)

PROVIDER = "stm_s13_receipts_test"
STATIC_ENDPOINT_ID = 994001
STATIC_RUN_ID = 994101
DVID = 994201

# Distinct provider-local dates so each fixture is independent. The retained-history
# regression deliberately spans more than 400 days; citizen_accountability_daily remains
# the sole authority for which of those dates becomes a receipt.
_ANCHOR = date.today() - timedelta(days=7)
OLD_RETAINED_DAY = _ANCHOR - timedelta(days=400)
SUPPLEMENT_ONLY_GAP_DAY = OLD_RETAINED_DAY + timedelta(days=1)
DARK_DAY = _ANCHOR  # fully-dark scheduled — NO CAD row
SILENT_DAY = _ANCHOR + timedelta(days=1)  # (i)  telemetry + silent/not-reported
SCHEDULE_ONLY_DAY = _ANCHOR + timedelta(days=2)  # (ii) scheduled known, alerts-only
EMPTY_DAY = _ANCHOR + timedelta(days=3)  # (iii) alerts-only, no schedule
BUILT = datetime.combine(_ANCHOR + timedelta(days=4), time(3, 0), tzinfo=UTC)


@pytest.fixture()
def conn():  # noqa: ANN201
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _seed(c) -> None:  # noqa: ANN001
    c.execute(
        text(
            "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)"
            " VALUES (:p, 'STM S13 receipts', 'America/Toronto', :p)"
        ),
        {"p": PROVIDER},
    )
    # A static dataset version so gold.dim_route rows have their required FK.
    c.execute(
        text(
            "INSERT INTO core.feed_endpoints (feed_endpoint_id, provider_id, endpoint_key,"
            " feed_kind, source_format) VALUES (:e, :p, 'static_schedule',"
            " 'static_schedule', 'gtfs_schedule_zip')"
        ),
        {"e": STATIC_ENDPOINT_ID, "p": PROVIDER},
    )
    c.execute(
        text(
            "INSERT INTO raw.ingestion_runs (ingestion_run_id, provider_id,"
            " feed_endpoint_id, run_kind, status) VALUES (:r, :p, :e, 'static_schedule',"
            " 'succeeded')"
        ),
        {"r": STATIC_RUN_ID, "p": PROVIDER, "e": STATIC_ENDPOINT_ID},
    )
    c.execute(
        text(
            "INSERT INTO core.dataset_versions (dataset_version_id, provider_id,"
            " feed_endpoint_id, source_ingestion_run_id, dataset_kind, content_hash,"
            " is_current) VALUES (:d, :p, :e, :r, 'static_schedule', 's13-hash', true)"
        ),
        {"d": DVID, "p": PROVIDER, "e": STATIC_ENDPOINT_ID, "r": STATIC_RUN_ID},
    )
    # dim_route names for the not-reported list resolution.
    for rid, name in (("51", "Édouard-Montpetit"), ("24", "Sherbrooke"), ("747", "YUL")):
        c.execute(
            text(
                "INSERT INTO gold.dim_route (dataset_version_id, provider_id, route_id,"
                " route_short_name, route_long_name, route_type)"
                " VALUES (:d, :p, :r, :r, :n, 3)"
            ),
            {"d": DVID, "p": PROVIDER, "r": rid, "n": name},
        )

    # --- Retained span: an accountability-backed day >400 days old stays fully
    # enriched, while an adjacent supplement-only day remains absent.
    _cad(c, OLD_RETAINED_DAY, affected_routes=2, affected_stops=4, alerts=1, score=8.5)
    _spine(c, OLD_RETAINED_DAY, "51", hour=7, obs=20, on_time=15, severe=2, sum_sec=2400)
    _cancel(c, OLD_RETAINED_DAY, "51", scheduled=10, total=8, canceled=1)
    _spine(
        c,
        SUPPLEMENT_ONLY_GAP_DAY,
        "51",
        hour=7,
        obs=12,
        on_time=10,
        severe=1,
        sum_sec=720,
    )
    _cancel(c, SUPPLEMENT_ONLY_GAP_DAY, "51", scheduled=8, total=8, canceled=0)

    # --- (i) SILENT_DAY: a rich CAD row + spine obs in two shifts + a not-reported route.
    _cad(c, SILENT_DAY, affected_routes=3, affected_stops=8, alerts=1, score=12.5)
    # am_peak (hour 7) + pm_peak (hour 17) spine cells for route 51.
    _spine(c, SILENT_DAY, "51", hour=7, obs=100, on_time=90, severe=3, sum_sec=6000)
    _spine(c, SILENT_DAY, "51", hour=17, obs=120, on_time=80, severe=20, sum_sec=14400)
    # route 51 delivered; route 24 SILENT (scheduled, zero RT observed).
    _cancel(c, SILENT_DAY, "51", scheduled=10, total=9, canceled=1)
    _cancel(c, SILENT_DAY, "24", scheduled=8, total=0, canceled=0)  # not-reported

    # --- (ii) SCHEDULE_ONLY_DAY: alerts-only CAD row (no reliability), schedule known.
    _cad(c, SCHEDULE_ONLY_DAY, affected_routes=None, affected_stops=None, alerts=4, score=None)
    _cancel(c, SCHEDULE_ONLY_DAY, "51", scheduled=12, total=0, canceled=0)

    # --- (iii) EMPTY_DAY: alerts-only CAD row, NO schedule rows at all.
    _cad(c, EMPTY_DAY, affected_routes=None, affected_stops=None, alerts=2, score=None)

    # --- DARK_DAY: scheduled + silent but NO CAD row (fully dark). Receipt must be absent.
    _cancel(c, DARK_DAY, "51", scheduled=15, total=0, canceled=0)


def _cad(c, d, *, affected_routes, affected_stops, alerts, score) -> None:  # noqa: ANN001
    c.execute(
        text(
            "INSERT INTO gold.citizen_accountability_daily (provider_id,"
            " provider_local_date, affected_route_count, affected_stop_count,"
            " delayed_trip_count, severe_delay_count, alert_count, rider_impact_score,"
            " built_at_utc) VALUES (:p, :d, :ar, :as_, 0, 0, :al, :sc, :b)"
        ),
        {
            "p": PROVIDER,
            "d": d,
            "ar": affected_routes,
            "as_": affected_stops,
            "al": alerts,
            "sc": score,
            "b": BUILT,
        },
    )


def _spine(c, d, rid, *, hour, obs, on_time, severe, sum_sec) -> None:  # noqa: ANN001
    # A single in-clamp histogram bucket carrying `obs` so the pooled-avg denominator
    # (Σ histogram) equals obs — matching the day-scalar methodology.
    c.execute(
        text(
            "INSERT INTO gold.route_delay_spine (provider_id, route_id,"
            " provider_local_date, hour_of_day_local, direction_id, observation_count,"
            " delay_observation_count, on_time_observation_count, severe_delay_count,"
            " sum_delay_seconds, delay_histogram)"
            " VALUES (:p, :r, :d, :h, 0, :o, :o, :ot, :sv, :ss, :hist)"
        ),
        {
            "p": PROVIDER,
            "r": rid,
            "d": d,
            "h": hour,
            "o": obs,
            "ot": on_time,
            "sv": severe,
            "ss": sum_sec,
            "hist": [obs],
        },
    )


def _route_candidate(c, d, rid, *, avg_delay, on_time) -> None:  # noqa: ANN001
    c.execute(
        text(
            "INSERT INTO gold.route_delay_hourly (provider_id, period_start_utc, route_id,"
            " observation_count, delay_observation_count, on_time_observation_count,"
            " avg_delay_seconds) VALUES (:p, :ts, :r, 10, 10, :ot, :avg)"
        ),
        {
            "p": PROVIDER,
            "ts": datetime.combine(d, time(12, 0), tzinfo=UTC),
            "r": rid,
            "ot": on_time,
            "avg": avg_delay,
        },
    )


def _stop_candidate(c, d, sid, *, avg_delay) -> None:  # noqa: ANN001
    c.execute(
        text(
            "INSERT INTO gold.stop_delay_hourly (provider_id, period_start_utc, stop_id,"
            " route_id, observation_count, avg_arrival_delay_seconds)"
            " VALUES (:p, :ts, :s, '51', 10, :avg)"
        ),
        {
            "p": PROVIDER,
            "ts": datetime.combine(d, time(12, 0), tzinfo=UTC),
            "s": sid,
            "avg": avg_delay,
        },
    )


def _cancel(c, d, rid, *, scheduled, total, canceled) -> None:  # noqa: ANN001
    delivered = total - canceled
    silent = max(scheduled - total, 0)
    c.execute(
        text(
            "INSERT INTO gold.route_cancellation_daily (provider_id, provider_local_date,"
            " route_id, total_trip_days, canceled_trip_days, cancellation_rate_pct,"
            " built_at_utc, scheduled_trip_days, delivered_trip_days, silent_trip_days)"
            " VALUES (:p, :d, :r, :t, :c, :rate, :b, :s, :dl, :si)"
        ),
        {
            "p": PROVIDER,
            "d": d,
            "r": rid,
            "t": total,
            "c": canceled,
            "rate": (round(100.0 * canceled / total, 2) if total else None),
            "b": BUILT,
            "s": scheduled,
            "dl": delivered,
            "si": silent,
        },
    )


def _availability(receipts) -> dict[str, ReceiptAvailability]:
    # Mirror the publisher's derivation (publish.py) so the index semantics are tested.
    out = {}
    for date_str, r in receipts.items():
        out[date_str] = ReceiptAvailability(
            date=date_str,
            has_data=bool(r.affected_routes or r.affected_stops or r.otp_pct is not None),
            has_schedule=bool(
                r.service_states is not None and r.service_states.scheduled_trip_days is not None
            ),
        )
    return out


def test_silent_day_lists_not_reported_route(conn) -> None:  # noqa: ANN001
    out = build_receipts(conn, PROVIDER, generated_utc="t")
    r = out[SILENT_DAY.isoformat()]
    ss = r.service_states
    assert ss is not None
    # route 24 was scheduled (8) with zero RT observed -> not-reported; 51 delivered.
    ids = [nr.id for nr in ss.not_reported_routes]
    assert ids == ["24"]
    assert ss.not_reported_routes[0].name == "Sherbrooke"
    assert ss.not_reported_routes[0].scheduled_trip_days == 8
    assert ss.not_reported_route_count == 1
    assert ss.silent_trip_days == 9  # 51: sched10-total9=1 ; 24: sched8-total0=8 -> 9
    assert ss.scheduled_trip_days == 18
    # by_shift carries the two seeded shifts in canonical order with pooled avgs.
    assert [c.shift for c in r.by_shift] == ["am_peak", "pm_peak"]
    assert r.by_shift[0].observation_count == 100
    assert r.by_shift[1].avg_delay_min == 2.0  # 14400 / 120 / 60


def test_schedule_only_day_emitted_with_schedule_flag(conn) -> None:  # noqa: ANN001
    out = build_receipts(conn, PROVIDER, generated_utc="t")
    key = SCHEDULE_ONLY_DAY.isoformat()
    assert key in out  # alerts-only CAD row -> receipt IS emitted
    r = out[key]
    assert r.by_shift == []  # no spine telemetry
    assert r.affected_routes is None and r.otp_pct is None
    avail = _availability(out)[key]
    assert avail.has_data is False  # alerts-only shell
    assert avail.has_schedule is True  # scheduled universe known


def test_empty_day_emitted_without_data_or_schedule(conn) -> None:  # noqa: ANN001
    out = build_receipts(conn, PROVIDER, generated_utc="t")
    key = EMPTY_DAY.isoformat()
    assert key in out
    avail = _availability(out)[key]
    assert avail.has_data is False
    assert avail.has_schedule is False


def test_fully_dark_scheduled_day_absent(conn) -> None:  # noqa: ANN001
    out = build_receipts(conn, PROVIDER, generated_utc="t")
    # DARK_DAY has scheduled+silent rows but NO CAD row -> no receipt, absent from index.
    assert DARK_DAY.isoformat() not in out
    assert DARK_DAY.isoformat() not in _availability(out)


def test_old_retained_day_is_enriched_and_supplement_only_gap_stays_absent(conn) -> None:  # noqa: ANN001
    out = build_receipts(conn, PROVIDER, generated_utc="t")

    old_key = OLD_RETAINED_DAY.isoformat()
    receipt = out[old_key]
    assert receipt.date == old_key
    assert receipt.otp_pct == 75
    assert receipt.avg_delay_min == 2.0
    assert [cut.shift for cut in receipt.by_shift] == ["am_peak"]
    assert receipt.by_shift[0].observation_count == 20
    assert receipt.service_states is not None
    assert receipt.service_states.scheduled_trip_days == 10
    assert receipt.service_states.delivered_trip_days == 7
    assert receipt.service_states.cancelled_trip_days == 1
    assert receipt.service_states.silent_trip_days == 2
    assert receipt.service_states.service_completeness_pct == 70.0
    assert SUPPLEMENT_ONLY_GAP_DAY.isoformat() not in out


def test_worst_queries_return_one_ranked_candidate_per_date(conn) -> None:  # noqa: ANN001
    _route_candidate(conn, OLD_RETAINED_DAY, "51", avg_delay=300, on_time=4)
    _route_candidate(conn, OLD_RETAINED_DAY, "24", avg_delay=300, on_time=5)
    _route_candidate(conn, OLD_RETAINED_DAY, "747", avg_delay=120, on_time=8)
    _stop_candidate(conn, OLD_RETAINED_DAY, "3001", avg_delay=420)
    _stop_candidate(conn, OLD_RETAINED_DAY, "1002", avg_delay=420)
    _stop_candidate(conn, OLD_RETAINED_DAY, "9999", avg_delay=180)

    params = {
        "provider_id": PROVIDER,
        "receipt_start": OLD_RETAINED_DAY,
        "receipt_end": OLD_RETAINED_DAY,
    }
    route_rows = list(conn.execute(_RECEIPTS_WORST_ROUTE_SQL, params).mappings())
    stop_rows = list(conn.execute(_RECEIPTS_WORST_STOP_SQL, params).mappings())

    assert len(route_rows) == len(stop_rows) == 1
    assert [(row["d"], row["route_id"]) for row in route_rows] == [(OLD_RETAINED_DAY, "24")]
    assert [(row["d"], row["stop_id"]) for row in stop_rows] == [(OLD_RETAINED_DAY, "1002")]


def test_real_db_receipt_under_byte_ceiling(conn, capsys) -> None:  # noqa: ANN001
    """Real-DB probe: the richest built receipt serializes well under RECEIPT_BYTE_CEILING.
    Reports the observed byte size."""
    from transit_ops.snapshots.contract import RECEIPT_BYTE_CEILING

    out = build_receipts(conn, PROVIDER, generated_utc=BUILT.isoformat())
    sizes = {ds: len(r.model_dump_json().encode("utf-8")) for ds, r in out.items()}
    biggest = max(sizes, key=sizes.get)
    with capsys.disabled():
        print(
            f"\n[S13 byte probe] receipt sizes={sizes} "
            f"max={sizes[biggest]}B ceiling={RECEIPT_BYTE_CEILING}B"
        )
    assert sizes[biggest] <= RECEIPT_BYTE_CEILING
