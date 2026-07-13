"""Tests for snapshot live-tier builders (gold views -> /v1 pydantic models).

These tests use FAKE database connections that return canned ``.mappings()``
rows.  No real database is touched — the SQL strings are validated for live
execution separately against a dev DB.  Here we exercise the row -> model
mapping logic: code translation, coordinate rounding, seconds -> minutes,
trip grouping, KPI aggregation, and manifest assembly.
"""

from __future__ import annotations

from transit_ops.snapshots.builders import (
    _iso,
    build_alerts,
    build_manifest,
    build_network,
    build_stop_departures,
    build_trips,
    build_vehicles,
)
from transit_ops.snapshots.contract import (
    AlertsFile,
    Manifest,
    NetworkFile,
    StopDeparturesFile,
    TripsFile,
    VehiclesFile,
)
from transit_ops.sql_registry import query_name


class FakeResult:
    """Mimics the object returned by ``Connection.execute(...)``.

    Supports both ``.mappings()`` iteration (row dicts) and
    ``.scalar_one()`` (single value), so a single fake can stand in for
    either access pattern used by the builders.
    """

    def __init__(self, rows):  # noqa: ANN001
        self._rows = list(rows)

    def mappings(self):  # noqa: ANN201
        return self

    def __iter__(self):
        return iter(self._rows)

    def fetchone(self):  # noqa: ANN201
        # SQLAlchemy .mappings().fetchone() — first row mapping or None.
        return self._rows[0] if self._rows else None

    def scalar_one(self):  # noqa: ANN201
        # First column of the first row, mirroring SQLAlchemy semantics.
        first = self._rows[0]
        if isinstance(first, dict):
            return next(iter(first.values()))
        return first


class FakeConn:
    """Dispatches canned result sets to queries.

    ``responses`` maps a key to the rows that query returns. A key that is a
    registry query name (``a.b`` dotted, present in the statement's ``-- q:``
    marker) dispatches by EXACT name; any other key falls back to a longest-
    substring match (table-name-keyed tests). Order-independent.
    """

    def __init__(self, responses):  # noqa: ANN001
        self._responses = responses
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        sql = str(statement)
        self.executed.append(sql)
        name = query_name(statement)
        if name is not None and name in self._responses:
            return FakeResult(self._responses[name])
        # Longest-substring fallback for table-name-keyed tests.
        best_rows = None
        best_len = -1
        for needle, rows in self._responses.items():
            if needle in sql and len(needle) > best_len:
                best_rows = rows
                best_len = len(needle)
        return FakeResult(best_rows if best_rows is not None else [])


# --------------------------------------------------------------------------
# _iso helper
# --------------------------------------------------------------------------


def test_iso_converts_offset_to_utc() -> None:
    from datetime import datetime, timedelta, timezone

    dt = datetime(2026, 5, 31, 21, 42, 0, tzinfo=timezone(timedelta(hours=-4)))
    assert _iso(dt) == "2026-06-01T01:42:00Z"  # -04:00 21:42 -> 01:42Z next day


def test_iso_passes_through_strings() -> None:
    assert _iso("2026-05-31T21:42:00Z") == "2026-05-31T21:42:00Z"


# --------------------------------------------------------------------------
# 6a — build_vehicles
# --------------------------------------------------------------------------


def test_build_vehicles_maps_status_occupancy_and_rounds_coords() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {
                    "id": "STM-4001",
                    "route": "51",
                    "trip": "T-100",
                    "lat": 45.491234567,
                    "lon": -73.567894321,
                    "bearing": 182.7,
                    "speed_ms": 10.0,  # m/s -> 36 km/h via _kmh
                    "status_band": "En retard / Late",
                    "occupancy_status": 2,  # GTFS-RT FEW_SEATS_AVAILABLE
                    "next_stop": "S-900",
                    "updated_utc": "2026-05-31T12:00:00Z",
                    "reported_utc": "2026-05-31T11:59:30Z",  # own fix time, 30s pre-snapshot
                    "delay_seconds": 120,  # 2 minutes -> delay_min == 2
                }
            ]
        }
    )

    out = build_vehicles(conn, provider_id="stm", generated_utc="2026-05-31T12:00:05Z")

    assert isinstance(out, VehiclesFile)
    assert out.generated_utc == "2026-05-31T12:00:05Z"
    assert len(out.vehicles) == 1
    v = out.vehicles[0]
    assert v.id == "STM-4001"
    assert v.route == "51"
    assert v.status == "late"
    assert v.occupancy == "few_seats"
    assert v.lat == 45.49123  # rounded to 5 decimals
    assert v.lon == -73.56789
    assert v.bearing == 182  # int-coerced
    assert v.speed_kmh == 36  # 10 m/s * 3.6 = 36 km/h
    assert v.next_stop == "S-900"
    assert v.updated_utc == "2026-05-31T12:00:00Z"
    assert v.reported_utc == "2026-05-31T11:59:30Z"  # the bus's own time, not the snapshot
    assert v.delay_min == 2  # 120s -> 2 min


def test_build_vehicles_unknown_status_and_null_occupancy() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {
                    "id": 7777,  # non-string id coerced to str
                    "route": None,
                    "trip": None,
                    "lat": 45.5,
                    "lon": -73.6,
                    "bearing": None,
                    "speed_ms": None,  # NULL speed_ms -> speed_kmh None
                    "status_band": "Inconnu / Unknown",
                    "occupancy_status": None,
                    "next_stop": None,
                    "updated_utc": "2026-05-31T12:00:00Z",
                    "reported_utc": None,  # producer omitted the per-vehicle fix -> None (web falls back to updated_utc)
                    "delay_seconds": None,
                }
            ]
        }
    )

    out = build_vehicles(conn, generated_utc="2026-05-31T12:00:05Z")
    v = out.vehicles[0]
    assert v.id == "7777"
    assert v.status == "unknown"
    assert v.occupancy is None
    assert v.bearing is None
    assert v.speed_kmh is None
    assert v.reported_utc is None  # absent per-vehicle fix time -> None


def test_build_vehicles_all_status_bands_map() -> None:
    bands = {
        "En avance / Early": "early",
        "À l'heure / On time": "on_time",
        "En retard / Late": "late",
        "Critique / Severe": "severe",
        "Inconnu / Unknown": "unknown",
        "something weird": "unknown",
    }
    rows = [
        {
            "id": f"v{i}",
            "route": "1",
            "trip": "t",
            "lat": 45.5,
            "lon": -73.6,
            "bearing": None,
            "speed_ms": None,  # key is now speed_ms
            "status_band": band,
            "occupancy_status": None,
            "next_stop": None,
            "updated_utc": "2026-05-31T12:00:00Z",
            "reported_utc": "2026-05-31T11:59:00Z",
            "delay_seconds": None,
        }
        for i, band in enumerate(bands)
    ]
    conn = FakeConn({"current_vehicle_map_with_status": rows})
    out = build_vehicles(conn, generated_utc="2026-05-31T12:00:05Z")
    got = [v.status for v in out.vehicles]
    assert got == list(bands.values())


# --------------------------------------------------------------------------
# 6b — build_trips
# --------------------------------------------------------------------------


def test_build_trips_groups_stops_and_converts_delay_to_minutes() -> None:
    conn = FakeConn(
        {
            # status_band is now computed IN-QUERY by STATUS_BAND_CASE_SQL (gold's
            # 0020 CASE); build_trips reads r["status_band"] and no longer buckets
            # avg_delay_seconds in Python, so the fake rows must emit the label the
            # query would (slice-9.1.1-theta). delay_min still derives from seconds.
            "current_trip_delay_computed": [
                {
                    "trip_id": "T-1",
                    "route_id": "51",
                    "avg_delay_seconds": 130.0,  # 130s -> 2 min; band 60<=s<300 -> Late
                    "status_band": "En retard / Late",
                },
                {
                    "trip_id": "T-2",
                    "route_id": "97",
                    "avg_delay_seconds": -200.0,  # -200s -> -3 min; band s<-60 -> Early
                    "status_band": "En avance / Early",
                },
            ],
            "current_stop_next_departures": [
                {
                    "trip_id": "T-1",
                    "route_id": "51",  # departures view now carries route_id
                    "stop_id": "S-1",
                    "predicted_departure_utc": "2026-05-31T12:05:00Z",
                    "stop_sequence": 1,
                },
                {
                    "trip_id": "T-1",
                    "route_id": "51",
                    "stop_id": "S-2",
                    "predicted_departure_utc": "2026-05-31T12:09:00Z",
                    "stop_sequence": 2,
                },
                {
                    "trip_id": "T-3-orphan",  # no delay row -> fallback Trip uses route from row
                    "route_id": "80",
                    "stop_id": "S-9",
                    "predicted_departure_utc": "2026-05-31T12:20:00Z",
                    "stop_sequence": 1,
                },
            ],
        }
    )

    out = build_trips(conn, provider_id="stm", generated_utc="2026-05-31T12:00:05Z")

    assert isinstance(out, TripsFile)
    assert out.generated_utc == "2026-05-31T12:00:05Z"
    # T-1 has delay + 2 stops, ordered by ETA/stop_sequence
    t1 = out.trips["T-1"]
    assert t1.route == "51"
    assert t1.status == "late"
    assert t1.delay_min == 2
    assert [s.stop for s in t1.stops] == ["S-1", "S-2"]
    assert t1.stops[0].eta_utc == "2026-05-31T12:05:00Z"
    # T-2 has delay, no stops
    t2 = out.trips["T-2"]
    assert t2.status == "early"
    assert t2.delay_min == -3
    assert t2.stops == []
    # T-3-orphan: no delay row, route comes from the departures row
    t3 = out.trips["T-3-orphan"]
    assert t3.route == "80"  # route_id preserved from fallback Trip(route=r["route_id"])
    assert t3.status == "unknown"
    assert t3.delay_min is None
    assert [s.stop for s in t3.stops] == ["S-9"]


def test_trip_departures_sql_contract_60min_horizon() -> None:
    """slice-9.1.1q: the trips departures query caps the ETA horizon at 60 min."""
    from transit_ops.snapshots import builders

    sql = str(builders._TRIP_DEPARTURES_SQL)
    assert "interval '60 minutes'" in sql
    assert "predicted_departure_utc <" in sql


def test_status_band_case_sql_drift_guard_vs_0020() -> None:
    """DB-free drift guard: STATUS_BAND_CASE_SQL must keep the migration-0020
    thresholds and all five bilingual labels (slice-9.1.1-theta). If a future
    edit moves a boundary or relabels a band, this fails before the real-DB
    equivalence lock can (so it catches drift even offline)."""
    from transit_ops.snapshots.builders._helpers import STATUS_BAND_CASE_SQL

    sql = STATUS_BAND_CASE_SQL.format(col="avg_delay_seconds")
    # the three numeric thresholds from the 0020 CASE
    assert "-60" in sql
    assert "60" in sql
    assert "300" in sql
    # all five bilingual labels (note the doubled '' SQL apostrophe escape)
    for label in (
        "Inconnu / Unknown",
        "En avance / Early",
        "À l''heure / On time",
        "En retard / Late",
        "Critique / Severe",
    ):
        assert label in sql


def test_build_trips_status_band_computed_in_query_not_python() -> None:
    """slice-9.1.1-theta: _TRIP_DELAY_SQL emits the status_band IN-QUERY (so the
    Python recompute is gone) while keeping the SAME FROM/WHERE — the trip set
    is unchanged, only a derived label column is added."""
    from transit_ops.snapshots.builders.live import _TRIP_DELAY_SQL

    sql = str(_TRIP_DELAY_SQL)
    assert "AS status_band" in sql
    assert "FROM gold.current_trip_delay_computed" in sql
    assert "WHERE provider_id = :provider_id" in sql
    # the band is derived in-query from avg_delay_seconds, never re-bucketed in Python
    assert "CASE" in sql


# --------------------------------------------------------------------------
# 6b2 — build_stop_departures (slice-9.1.1q)
# --------------------------------------------------------------------------


def test_build_stop_departures_groups_by_stop_in_eta_order_and_maps_delay() -> None:
    # The view + window are evaluated in SQL; the FakeConn returns the rows the
    # query WOULD return (already ranked/ordered), so this exercises the
    # row -> model mapping: dict keying, list order, delay seconds -> minutes,
    # NULL delay -> None, generated_utc passthrough.
    conn = FakeConn(
        {
            "current_stop_next_departures": [
                {
                    "stop_id": "S-1",
                    "route_id": "165",
                    "trip_id": "t1",
                    "predicted_departure_utc": "2026-06-10T12:05:00Z",
                    "avg_delay_seconds": 130.0,  # -> 2 min
                },
                {
                    "stop_id": "S-1",
                    "route_id": "171",
                    "trip_id": "t2",
                    "predicted_departure_utc": "2026-06-10T12:08:00Z",
                    "avg_delay_seconds": None,  # -> None
                },
                {
                    "stop_id": "S-2",
                    "route_id": "24",
                    "trip_id": "t3",
                    "predicted_departure_utc": "2026-06-10T12:10:00Z",
                    "avg_delay_seconds": -200.0,  # early -> -3 min
                },
            ]
        }
    )

    out = build_stop_departures(conn, provider_id="stm", generated_utc="2026-06-10T12:00:05Z")

    assert isinstance(out, StopDeparturesFile)
    assert out.generated_utc == "2026-06-10T12:00:05Z"
    assert set(out.stops) == {"S-1", "S-2"}
    s1 = out.stops["S-1"]
    assert [d.route for d in s1] == ["165", "171"]
    assert [d.eta_utc for d in s1] == ["2026-06-10T12:05:00Z", "2026-06-10T12:08:00Z"]
    assert s1[0].trip == "t1"
    assert s1[0].delay_min == 2
    assert s1[1].delay_min is None
    assert out.stops["S-2"][0].delay_min == -3


def test_build_stop_departures_sql_contract() -> None:
    from transit_ops.snapshots import builders

    sql = str(builders._STOP_DEPARTURES_SQL)
    assert "PARTITION BY d.stop_id, d.route_id" in sql
    assert ":per_route_cap" in sql
    assert "d.stop_id IS NOT NULL" in sql
    assert "current_trip_delay_computed" in sql
    assert "GROUP BY provider_id, trip_id" in sql
    assert builders._STOP_DEPARTURES_PER_ROUTE_CAP == 2


# --------------------------------------------------------------------------
# 6c — build_alerts
# --------------------------------------------------------------------------


def test_build_alerts_maps_severity_and_splits_routes_stops() -> None:
    import hashlib

    conn = FakeConn(
        {
            "current_i3_alerts": [
                {
                    "alert_id": "A-1",
                    "alert_header_text": "Service disruption line 1",
                    "description_text": "Delays on line 1",
                    "alert_header_text_en": "Service disruption line 1 (EN)",
                    "description_text_en": "Delays on line 1 (EN)",
                    "severity": "warning",
                    "cause": "ACCIDENT",
                    "effect": "DETOUR",
                    "route_ids": "1, 4, 51",
                    "stop_ids": "S-1, S-2",
                    "active_period_start_utc": "2026-05-31T08:00:00Z",
                    "active_period_end_utc": "2026-05-31T20:00:00Z",
                    # S15: url + multi-window active_periods thread through.
                    "url": "https://stm.info/alerts/A-1",
                    "url_en": "https://stm.info/en/alerts/A-1",
                    "active_periods": [
                        {"start_utc": "2026-05-31T08:00:00+00:00",
                         "end_utc": "2026-05-31T20:00:00+00:00"},
                        {"start_utc": "2026-06-07T08:00:00+00:00",
                         "end_utc": "2026-06-07T20:00:00+00:00"},
                    ],
                },
                {
                    "alert_id": None,  # no id -> synthesize a CONTENT hash
                    "alert_header_text": "Major closure",
                    "description_text": "Major closure desc",
                    "alert_header_text_en": None,  # STM published no English
                    "description_text_en": None,
                    "severity": "severe",
                    "cause": "CONSTRUCTION",
                    "effect": "NO_SERVICE",
                    "route_ids": None,
                    "stop_ids": None,
                    "active_period_start_utc": None,
                    "active_period_end_utc": None,
                    # S15: no url; no child periods -> honest-null / empty list.
                    "url": None,
                    "url_en": None,
                    "active_periods": None,
                },
            ]
        }
    )

    out = build_alerts(conn, provider_id="stm", generated_utc="2026-05-31T12:00:05Z")

    assert isinstance(out, AlertsFile)
    assert len(out.alerts) == 2
    a1 = out.alerts[0]
    assert a1.id == "A-1"
    assert a1.severity == "high"  # warning -> high
    assert a1.header_key == "Service disruption line 1"
    # slice-9.1.1s: header_text aliases today's header value; description + EN
    # fields pass through.
    assert a1.header_text == "Service disruption line 1"
    assert a1.header_text == a1.header_key
    assert a1.description == "Delays on line 1"
    assert a1.header_text_en == "Service disruption line 1 (EN)"
    assert a1.description_en == "Delays on line 1 (EN)"
    assert a1.routes == ["1", "4", "51"]
    assert a1.stops == ["S-1", "S-2"]
    assert a1.start_utc == "2026-05-31T08:00:00Z"
    assert a1.end_utc == "2026-05-31T20:00:00Z"
    # raw GTFS-RT/i3 passthroughs; severity_level is the raw value, distinct from
    # the bucketed severity ("warning" -> "high").
    assert a1.cause == "ACCIDENT"
    assert a1.effect == "DETOUR"
    assert a1.severity_level == "warning"
    # S15: url + multi-window active_periods (normalized to 'Z' rendering).
    assert a1.url == "https://stm.info/alerts/A-1"
    assert a1.url_en == "https://stm.info/en/alerts/A-1"
    assert len(a1.active_periods) == 2
    assert a1.active_periods[0].start_utc == "2026-05-31T08:00:00Z"
    assert a1.active_periods[1].end_utc == "2026-06-07T20:00:00Z"
    a2 = out.alerts[1]
    assert a2.severity == "critical"  # severe -> critical
    assert a2.routes == []
    assert a2.stops == []
    # en-less row is honest-NULL.
    assert a2.header_text == "Major closure"
    assert a2.description == "Major closure desc"
    assert a2.header_text_en is None
    assert a2.description_en is None
    # id is a content hash: "stm-alert-<sha1[:12]>" of "desc|sev|cause|effect".
    # CRITICAL: EN must NOT shift the content-stable id basis.
    basis = "Major closure desc|severe|CONSTRUCTION|NO_SERVICE"
    expected_id = "stm-alert-" + hashlib.sha1(basis.encode()).hexdigest()[:12]
    assert a2.id == expected_id
    # same input -> same id (stable across calls)
    out2 = build_alerts(conn, provider_id="stm", generated_utc="2026-05-31T12:00:05Z")
    assert out2.alerts[1].id == expected_id
    assert a2.start_utc is None
    assert a2.cause == "CONSTRUCTION"
    assert a2.effect == "NO_SERVICE"
    assert a2.severity_level == "severe"
    # S15: no url, no child periods, no scalar window -> honest empty.
    assert a2.url is None
    assert a2.url_en is None
    assert a2.active_periods == []


def test_build_alerts_unknown_severity_falls_back_to_watch() -> None:
    conn = FakeConn(
        {
            "current_i3_alerts": [
                {
                    "alert_id": "A-info",
                    "alert_header_text": "FYI",
                    "description_text": None,
                    "alert_header_text_en": None,
                    "description_text_en": None,
                    "severity": "info",
                    "cause": None,
                    "effect": None,
                    "route_ids": "",
                    "stop_ids": "",
                    "active_period_start_utc": None,
                    "active_period_end_utc": None,
                }
            ]
        }
    )
    out = build_alerts(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.alerts[0].severity == "watch"
    assert out.alerts[0].routes == []


def test_build_alerts_sanitizes_legacy_python_repr_en_text() -> None:
    conn = FakeConn(
        {
            "current_i3_alerts": [
                {
                    "alert_id": "A-garbage",
                    "alert_header_text": "Votre arrêt",
                    "description_text": "Service interrompu",
                    "alert_header_text_en": "{'text': None, 'language': 'en'}",
                    "description_text_en": "{'text': None, 'language': 'en'}",
                    "severity": "warning",
                    "cause": None,
                    "effect": None,
                    "route_ids": "161",
                    "stop_ids": "51234",
                    "active_period_start_utc": None,
                    "active_period_end_utc": None,
                }
            ]
        }
    )

    out = build_alerts(conn, generated_utc="2026-05-31T12:00:05Z")

    assert out.alerts[0].header_text_en is None
    assert out.alerts[0].description_en is None


# --------------------------------------------------------------------------
# 6d — build_network
# --------------------------------------------------------------------------


def test_build_network_aggregates_kpis() -> None:
    # 5 vehicles: 2 on_time, 1 late, 1 severe, 1 unknown
    # known = 5 - 1 unknown = 4
    # on_time_pct = round(100 * (2+1) / 4) = 75
    # coverage_pct = round(100 * 4 / 5) = 80
    vehicle_rows = [
        {"status_band": "À l'heure / On time", "occupancy_status": 1},   # many_seats
        {"status_band": "À l'heure / On time", "occupancy_status": 1},   # many_seats
        {"status_band": "En retard / Late", "occupancy_status": 3},       # standing
        {"status_band": "Critique / Severe", "occupancy_status": 5},      # full
        {"status_band": "Inconnu / Unknown", "occupancy_status": None},   # no occ
    ]
    trip_rows = [
        {"avg_delay_seconds": 60.0},  # 1 min
        {"avg_delay_seconds": 120.0},  # 2 min
        {"avg_delay_seconds": 600.0},  # 10 min
    ]
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": vehicle_rows,
            "current_trip_delay_computed": trip_rows,
            "0) AS non_responding": [{"non_responding": 7}],
            # per-route breakdown (dispatched by registry name) — sums to 7
            "network.live.non_responding_by_route": [
                {"route_id": "51", "nr_count": 4},
                {"route_id": "165", "nr_count": 3},
            ],
            "feed_freshness_current": [{"feed_freshness_s": 12}],
        }
    )

    out = build_network(conn, provider_id="stm", generated_utc="2026-05-31T12:00:05Z")

    assert isinstance(out, NetworkFile)
    assert out.vehicles_in_service == 5
    assert out.status_dist.on_time == 2
    assert out.status_dist.late == 1
    assert out.status_dist.severe == 1
    assert out.status_dist.unknown == 1
    # on_time_pct: round(100 * (on_time+late) / known) where known = 4
    assert out.on_time_pct == 75
    # coverage_pct: round(100 * known / vehicles_in_service) = round(100 * 4/5) = 80
    assert out.coverage_pct == 80
    # occupancy_mix fractions over occ_total (vehicles that reported occ):
    # codes (1,1,3,5) -> occ_total=4: many_seats=2/4=0.5, standing=1/4=0.25, full=1/4=0.25
    assert round(out.occupancy_mix.many_seats, 3) == 0.5
    assert round(out.occupancy_mix.standing, 3) == 0.25
    assert round(out.occupancy_mix.full, 3) == 0.25
    assert out.non_responding == 7
    assert out.feed_freshness_s == 12
    # percentiles of [1, 2, 10] minutes
    assert out.delay_p50_min == 2
    assert out.delay_p90_min >= 8  # near the top of the range
    # per-route non_responding breakdown: ordered count DESC, sums to scalar
    assert out.non_responding_by_route is not None
    assert [(r.route_id, r.count) for r in out.non_responding_by_route] == [
        ("51", 4),
        ("165", 3),
    ]
    assert sum(r.count for r in out.non_responding_by_route) == out.non_responding
    # delay_histogram: all 8 buckets present, sums to len(delays), values land
    # in the right bins. delays = [1, 2, 10] -> [0,2)=1 [2,5)=1 [5,10)... 10 -> [10,15)=1
    assert out.delay_histogram is not None
    assert len(out.delay_histogram) == 8
    assert sum(b.count for b in out.delay_histogram) == 3
    by_edges = {(b.lo_min, b.hi_min): b.count for b in out.delay_histogram}
    assert by_edges[(0, 2)] == 1  # 1 min
    assert by_edges[(2, 5)] == 1  # 2 min
    assert by_edges[(10, 15)] == 1  # 10 min
    # fixed edges + zero buckets present
    assert by_edges[(None, -5)] == 0
    assert by_edges[(15, None)] == 0


def test_build_network_on_time_pct_counts_late_band_as_on_time() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {"status_band": "À l'heure / On time", "occupancy_status": None},
                {"status_band": "En retard / Late", "occupancy_status": None},
                {"status_band": "Critique / Severe", "occupancy_status": None},
            ],
            "current_trip_delay_computed": [],
            "0) AS non_responding": [{"non_responding": 0}],
            "feed_freshness_current": [{"feed_freshness_s": 0}],
        }
    )

    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")

    assert out.on_time_pct == 67
    assert out.status_dist.on_time == 1
    assert out.status_dist.late == 1
    assert out.status_dist.severe == 1


def test_build_network_zero_vehicles_emits_honest_none_not_zero() -> None:
    # Honesty-Gate: during a feed blackout (no vehicles, no observations, no
    # completed run) the rate/percentile/freshness KPIs are UNKNOWN, so they
    # must surface as None — a fabricated "0% on time" / "0s fresh" on a
    # citizen-accountability dashboard is materially misleading.
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [],
            "current_trip_delay_computed": [],
            # SUM(...) COALESCE-d to 0 still returns one row; MAX(...) over an
            # empty set returns a single NULL — model both faithfully.
            "0) AS non_responding": [{"non_responding": 0}],
            "feed_freshness_current": [{"feed_freshness_s": None}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.vehicles_in_service == 0
    assert out.on_time_pct is None
    assert out.delay_p50_min is None
    assert out.delay_p90_min is None
    assert out.coverage_pct is None
    # no occupancy telemetry -> None, not an all-zero distribution (slice-9.1.1y)
    assert out.occupancy_mix is None
    # non_responding is a genuine count (honest 0 when nothing is failing).
    assert out.non_responding == 0
    # freshness is genuinely unknown with no completed run -> None, not 0.
    assert out.feed_freshness_s is None


def test_build_network_unknown_only_fleet_emits_none_on_time_pct() -> None:
    # A live fleet exists but every vehicle has an UNKNOWN status: punctuality
    # is unmeasured (known == 0). on_time_pct must be None, but coverage_pct is
    # an honest 0 (0% of the fleet has a known status) and vehicles_in_service
    # is a real count.
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {"status_band": "Inconnu / Unknown", "occupancy_status": None},
                {"status_band": "Inconnu / Unknown", "occupancy_status": None},
            ],
            "current_trip_delay_computed": [],
            "0) AS non_responding": [{"non_responding": 0}],
            "feed_freshness_current": [{"feed_freshness_s": 4}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.vehicles_in_service == 2
    assert out.on_time_pct is None  # known == 0 -> unmeasured, not 0%
    assert out.coverage_pct == 0  # honest: 0% of the fleet has a known status
    assert out.feed_freshness_s == 4  # a completed run exists -> real value


def test_build_network_no_occupancy_telemetry_emits_none_not_all_zero() -> None:
    """A live fleet that reports no occupancy must publish occupancy_mix=None
    (no data), not an all-zero distribution indistinguishable from a real
    all-empty fleet (slice-9.1.1y honesty — mirrors on_time_pct/coverage_pct)."""
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {"status_band": "À l'heure / On time", "occupancy_status": None},
                {"status_band": "En retard / Late", "occupancy_status": None},
            ],
            "current_trip_delay_computed": [],
            "0) AS non_responding": [{"non_responding": 0}],
            "feed_freshness_current": [{"feed_freshness_s": 5}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.vehicles_in_service == 2
    assert out.occupancy_mix is None  # no telemetry -> null, not all-zero


def test_build_network_delay_histogram_none_when_no_delay_observations() -> None:
    """delay_histogram is honest-None (not 8 zero buckets) iff there are zero
    delay observations — the same guard that nulls delay_p50_min/delay_p90_min."""
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {"status_band": "À l'heure / On time", "occupancy_status": None},
            ],
            "current_trip_delay_computed": [],  # zero delay observations
            "0) AS non_responding": [{"non_responding": 0}],
            "feed_freshness_current": [{"feed_freshness_s": 5}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.delay_p50_min is None
    assert out.delay_p90_min is None
    assert out.delay_histogram is None  # no observations -> None, not zero buckets


def test_build_network_delay_histogram_signed_bucket_edges() -> None:
    """Signed-minute classification: lo inclusive, hi exclusive, unbounded ends.
    Covers every one of the 8 fixed buckets and the boundary semantics."""
    # one observation squarely inside each of the 8 buckets (seconds -> minutes):
    #  -7 -> (-inf,-5) | -3 -> [-5,-2) | -1 -> [-2,0) | 1 -> [0,2)
    #   3 -> [2,5)     |  7 -> [5,10)  | 12 -> [10,15) | 20 -> [15,+inf)
    # plus boundary cases: -5 lands in [-5,-2) (lo inclusive); 0 lands in [0,2)
    # (lo inclusive, NOT [-2,0) which is hi-exclusive); 15 lands in [15,+inf).
    minutes = [-7, -3, -1, 1, 3, 7, 12, 20, -5, 0, 15]
    trip_rows = [{"avg_delay_seconds": m * 60.0} for m in minutes]
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [],
            "current_trip_delay_computed": trip_rows,
            "0) AS non_responding": [{"non_responding": 0}],
            "feed_freshness_current": [{"feed_freshness_s": 5}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.delay_histogram is not None
    assert len(out.delay_histogram) == 8  # all 8 always emitted
    assert sum(b.count for b in out.delay_histogram) == len(minutes)
    by_edges = {(b.lo_min, b.hi_min): b.count for b in out.delay_histogram}
    assert by_edges[(None, -5)] == 1  # -7
    assert by_edges[(-5, -2)] == 2  # -3 and boundary -5 (lo inclusive)
    assert by_edges[(-2, 0)] == 1  # -1  (0 is excluded: hi exclusive)
    assert by_edges[(0, 2)] == 2  # 1 and boundary 0 (lo inclusive)
    assert by_edges[(2, 5)] == 1  # 3
    assert by_edges[(5, 10)] == 1  # 7
    assert by_edges[(10, 15)] == 1  # 12
    assert by_edges[(15, None)] == 2  # 20 and boundary 15 (lo inclusive)


def test_build_network_non_responding_by_route_none_when_no_routes() -> None:
    """non_responding_by_route is None (UI stands down) when no route is silent —
    never an empty-but-present list. The scalar non_responding stays an honest 0."""
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [],
            "current_trip_delay_computed": [],
            "0) AS non_responding": [{"non_responding": 0}],
            # no "nr_by_route" fixture -> per-route query yields no rows
            "feed_freshness_current": [{"feed_freshness_s": 5}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.non_responding == 0
    assert out.non_responding_by_route is None  # empty -> None, not []


# --------------------------------------------------------------------------
# 6e — build_manifest
# --------------------------------------------------------------------------


class _FakeSettings:
    SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"


def test_build_manifest_assembles_from_provider_and_version() -> None:
    conn = FakeConn(
        {
            "core.providers": [
                {
                    "provider_id": "stm",
                    "display_name": "Société de transport de Montréal",
                    "short_name": "STM",
                    "city": "Montréal",
                    "timezone": "America/Toronto",
                    "default_language": "fr",
                    "attribution_text": "Contains STM data made available under CC BY 4.0.",
                    "min_latitude": 45.25,
                    "max_latitude": 45.75,
                    "min_longitude": -74.1,
                    "max_longitude": -73.2,
                }
            ],
            "core.dataset_versions": [{"dataset_version": "2026-05-29-stm"}],
            # GC2 H4: STM's enabled feed set → all delivered surfaces 'enabled'.
            "manifest.capability_endpoints": [
                {"endpoint_key": "static_schedule"},
                {"endpoint_key": "trip_updates"},
                {"endpoint_key": "vehicle_positions"},
                {"endpoint_key": "i3_alerts"},
            ],
        }
    )

    out = build_manifest(
        conn,
        provider_id="stm",
        generated_utc="2026-05-31T12:00:05Z",
        settings=_FakeSettings(),
    )

    assert isinstance(out, Manifest)
    assert out.provider == "stm"
    assert out.display_name == "Société de transport de Montréal"
    assert out.short_name == "STM"
    assert out.city == "Montréal"
    assert out.tz == "America/Toronto"
    assert out.default_lang == "fr"
    assert out.attribution == "Contains STM data made available under CC BY 4.0."
    assert out.bbox == [-74.1, 45.25, -73.2, 45.75]  # [minLon, minLat, maxLon, maxLat]
    assert out.dataset_version == "2026-05-29-stm"
    # basemap is null without SNAPSHOT_BASEMAP_PMTILES_URL (slice-9.1.1r)
    assert out.basemap is None
    assert out.files.static.basemap is None
    assert out.files.live.generated_utc == "2026-05-31T12:00:05Z"
    # tier inventories present with null stamps (state table empty in this fake)
    assert out.files.static.routes_index == "static/routes_index.json"
    assert out.files.static.generated_utc is None
    assert out.files.historic.receipts_index == "historic/receipts/index.json"
    assert out.files.historic.generated_utc is None
    assert out.labels == {"fr": "labels/fr.json", "en": "labels/en.json"}
    assert "live_map" in out.surfaces
    assert "data_trust" in out.surfaces
    # GC2 H4: honest per-surface capabilities from the enabled feed set.
    assert out.capabilities is not None
    assert out.capabilities.live_map.value == "enabled"
    assert out.capabilities.network_health.value == "enabled"
    assert out.capabilities.lookups.value == "enabled"
    assert out.capabilities.reliability.value == "enabled"
    assert out.capabilities.accountability.value == "enabled"
    assert out.capabilities.data_trust.value == "enabled"


def test_build_manifest_capabilities_honest_absence_without_feeds() -> None:
    # A provider with ONLY a static schedule (STS-like): live_map / reliability /
    # accountability are honestly 'unavailable', lookups + data_trust stay 'enabled'.
    from transit_ops.snapshots.builders.live import _derive_capabilities

    caps = _derive_capabilities({"static_schedule"})
    assert caps.lookups.value == "enabled"
    assert caps.data_trust.value == "enabled"
    assert caps.live_map.value == "unavailable"
    assert caps.network_health.value == "unavailable"
    assert caps.reliability.value == "unavailable"
    assert caps.accountability.value == "unavailable"


def test_build_manifest_defaults_when_version_missing() -> None:
    conn = FakeConn(
        {
            "core.providers": [
                {
                    "provider_id": "stm",
                    "display_name": "STM",
                    "timezone": "America/Toronto",
                    "default_language": "fr",
                    "attribution_text": "attr",
                    "min_latitude": 45.25,
                    "max_latitude": 45.75,
                    "min_longitude": -74.1,
                    "max_longitude": -73.2,
                }
            ],
            "core.dataset_versions": [],  # no current version row
        }
    )
    out = build_manifest(
        conn,
        provider_id="stm",
        generated_utc="2026-05-31T12:00:05Z",
        settings=_FakeSettings(),
    )
    assert out.dataset_version  # non-empty fallback
    # Copy identity is optional: a provider row without short_name/city yields
    # null in the manifest (the UI falls back to display_name).
    assert out.short_name is None
    assert out.city is None


class _FakeSettingsWithBasemap:
    SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
    SNAPSHOT_BASEMAP_PMTILES_URL = "https://data.example.com/basemap/quebec.pmtiles"


_MANIFEST_PROVIDER_ROW = {
    "core.providers": [
        {
            "provider_id": "stm",
            "display_name": "STM",
            "timezone": "America/Toronto",
            "default_language": "fr",
            "attribution_text": "attr",
            "min_latitude": 45.25,
            "max_latitude": 45.75,
            "min_longitude": -74.1,
            "max_longitude": -73.2,
        }
    ],
    "core.dataset_versions": [{"dataset_version": "2026-05-29-stm"}],
}


def test_build_manifest_tier_inventories_from_state_table() -> None:
    import datetime

    conn = FakeConn(
        {
            **_MANIFEST_PROVIDER_ROW,
            "snapshot_publish_state": [
                {"tier": "static", "generated_utc": datetime.datetime(2026, 6, 1, 0, 0, tzinfo=datetime.timezone.utc)},
                {"tier": "historic", "generated_utc": datetime.datetime(2026, 6, 13, 0, 0, tzinfo=datetime.timezone.utc)},
            ],
        }
    )
    out = build_manifest(conn, provider_id="stm", generated_utc="t", settings=_FakeSettings())
    assert out.files.static.generated_utc == "2026-06-01T00:00:00Z"
    assert out.files.historic.generated_utc == "2026-06-13T00:00:00Z"
    assert out.files.static.routes_prefix == "static/routes/"
    assert out.files.historic.receipts_index == "historic/receipts/index.json"


def test_build_manifest_tier_inventories_null_when_never_published() -> None:
    conn = FakeConn(_MANIFEST_PROVIDER_ROW)  # no snapshot_publish_state rows
    out = build_manifest(conn, provider_id="stm", generated_utc="t", settings=_FakeSettings())
    assert out.files.static.generated_utc is None
    assert out.files.historic.generated_utc is None


def test_build_manifest_basemap_null_without_setting() -> None:
    conn = FakeConn(_MANIFEST_PROVIDER_ROW)
    out = build_manifest(conn, provider_id="stm", generated_utc="t", settings=_FakeSettings())
    assert out.basemap is None
    assert out.files.static.basemap is None


def test_build_manifest_basemap_set_with_setting() -> None:
    conn = FakeConn(_MANIFEST_PROVIDER_ROW)
    out = build_manifest(
        conn, provider_id="stm", generated_utc="t", settings=_FakeSettingsWithBasemap()
    )
    assert out.basemap == "https://data.example.com/v1/stm/static/basemap.json"
    assert out.files.static.basemap == "static/basemap.json"


def test_manifest_live_files_list_stop_departures() -> None:
    """slice-9.1.1q: the live inventory advertises live/stop_departures.json."""
    conn = FakeConn(_MANIFEST_PROVIDER_ROW)
    out = build_manifest(conn, provider_id="stm", generated_utc="t", settings=_FakeSettings())
    assert out.files.live.stop_departures == "live/stop_departures.json"


# --------------------------------------------------------------------------
# 6f — build_labels
# --------------------------------------------------------------------------


def test_build_labels_fr_includes_static_and_metric():
    from transit_ops.snapshots.builders import build_labels

    class FakeResult:
        def __init__(self, rows): self._rows = rows
        def mappings(self): return self
        def __iter__(self): return iter(self._rows)

    class FakeConn:
        def execute(self, *a, **k):
            return FakeResult([
                {"label_key": "network_health", "label_fr": "Santé du réseau", "label_en": "Network Health"},
            ])

    lf = build_labels(FakeConn(), lang="fr", generated_utc="t")
    assert lf.labels["status.on_time"] == "À l'heure"
    assert lf.labels["status.late"] == "En retard"
    assert lf.labels["metric.network_health"] == "Santé du réseau"

def test_build_labels_en():
    from transit_ops.snapshots.builders import build_labels

    class FakeResult:
        def __init__(self, rows): self._rows = rows
        def mappings(self): return self
        def __iter__(self): return iter(self._rows)

    class FakeConn:
        def execute(self, *a, **k):
            return FakeResult([])

    lf = build_labels(FakeConn(), lang="en", generated_utc="t")
    assert lf.labels["status.on_time"] == "On time"
    assert lf.labels["occupancy.few_seats"] == "Few seats available"


_METHODOLOGY_GAP_ATTR_KEYS = {
    "methodology.otp_definition",
    "methodology.delay_unit",
    "methodology.percentiles",
    "methodology.retention",
    "gap.metro_realtime",
    "gap.metro_realtime.short",
    "attribution.data_source",
    "attribution.disclaimer",
}


def test_build_labels_includes_methodology_gap_attribution():
    """The 8 citizen-facing methodology/gap/attribution keys ship in BOTH languages,
    with accents intact and the early-band caveat locked in EN (slice-9.1.1t)."""
    from transit_ops.snapshots.builders import build_labels

    class FakeResult:
        def __init__(self, rows): self._rows = rows
        def mappings(self): return self
        def __iter__(self): return iter(self._rows)

    class FakeConn:
        def execute(self, *a, **k):
            return FakeResult([])  # empty report_labels

    for lang in ("fr", "en"):
        lf = build_labels(FakeConn(), lang=lang, generated_utc="t")
        for key in _METHODOLOGY_GAP_ATTR_KEYS:
            assert key in lf.labels, f"{key} missing in {lang}"
        # accent survives in the short métro-gap copy in BOTH languages
        assert "étro" in lf.labels["gap.metro_realtime.short"]
        # CC BY 4.0 named in the attribution source line
        assert "CC BY 4.0" in lf.labels["attribution.data_source"]

    # EN otp_definition keeps the early-band caveat (early vehicles are NOT on time)
    en = build_labels(FakeConn(), lang="en", generated_utc="t")
    assert "early" in en.labels["methodology.otp_definition"]
    # The published live on-time band is [-60s, +300s): build_network counts
    # on_time + late, migration 0030's FILTER is delay >= -60 AND delay < 300.
    # The copy must state the +300s / 5-minute upper bound — NOT understate it to
    # "one minute late" (the slice-9.1.1t honesty fix). Lock both languages so the
    # citizen-facing band can never silently drift below what is actually published.
    fr = build_labels(FakeConn(), lang="fr", generated_utc="t")
    assert "five minutes" in en.labels["methodology.otp_definition"]
    assert "one minute late" not in en.labels["methodology.otp_definition"]
    assert "cinq minutes" in fr.labels["methodology.otp_definition"]
    assert "une minute de retard" not in fr.labels["methodology.otp_definition"]
    # methodology.percentiles must NOT misattribute the 90-day OTP/avg window to
    # p90: live network p90 is the current snapshot, the trend p90 is the 14-day
    # fact window (builders.py build_network/build_network_trend; provenance says
    # only "network p90 from fact"). Lock against the "90 days" mis-statement.
    assert "90 days" not in en.labels["methodology.percentiles"]
    assert "14 days" in en.labels["methodology.percentiles"]
    assert "90 derniers jours" not in fr.labels["methodology.percentiles"]
    assert "14 derniers jours" in fr.labels["methodology.percentiles"]


def test_build_labels_non_stm_derives_attribution_from_core_providers():
    """A provider without curated copy gets a licensing-correct attribution from
    core.providers (manifest display_name + attribution_text) and no metro gap."""
    from transit_ops.snapshots.builders import build_labels

    class FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def mappings(self):
            return self

        def __iter__(self):
            return iter(self._rows)

        def one_or_none(self):
            return self._rows[0] if self._rows else None

    class FakeConn:
        def execute(self, statement, *a, **k):
            if "core.providers" in str(statement):
                return FakeResult(
                    [
                        {
                            "display_name": "Société de transport de l'Outaouais",
                            "attribution_text": "Contains STO open data.",
                        }
                    ]
                )
            return FakeResult([])  # gold.report_labels

    fr = build_labels(FakeConn(), provider_id="sto", lang="fr", generated_utc="t")
    assert fr.labels["attribution.data_source"] == "Contains STO open data."
    assert "Outaouais" in fr.labels["attribution.disclaimer"]
    # STM's metro-realtime gap is not carried for a non-metro provider
    assert "gap.metro_realtime" not in fr.labels


def test_static_label_key_sets_identical_fr_en():
    """Parity invariant: the two static dicts must always carry the same key set,
    so fr.json and en.json never drift apart (slice-9.1.1t)."""
    from transit_ops.snapshots.builders import _STATIC_LABELS_EN, _STATIC_LABELS_FR

    assert set(_STATIC_LABELS_FR) == set(_STATIC_LABELS_EN)


def test_build_routes_index():
    from transit_ops.snapshots.builders import build_routes_index

    class _Result:
        def __init__(self, rows): self._rows = rows
        def mappings(self): return self
        def __iter__(self): return iter(self._rows)

    class FC:
        # build_routes_index issues TWO queries: the reliability-availability set
        # (DISTINCT route_id FROM the delay spine) then the routes index. Dispatch by
        # needle so the flag is set deterministically: 165 has history, 999 does not.
        def execute(self, statement, params=None):  # noqa: ANN001, ARG002
            s = str(statement)
            if "DISTINCT route_id FROM gold.route_delay_spine" in s:
                return _Result([{"route_id": "165"}])
            return _Result([
                {"route_id": "165", "route_short_name": "165", "route_long_name": "Côte-Vertu",
                 "route_color": "009EE0", "route_type": 3},
                {"route_id": "999", "route_short_name": "999", "route_long_name": "No History",
                 "route_color": None, "route_type": 1},
            ])

    idx = build_routes_index(FC(), generated_utc="t")
    by_id = {r.id: r for r in idx.routes}
    assert by_id["165"].type == 3
    assert by_id["165"].reliability is True
    assert by_id["999"].reliability is False

def _stops_index_first(routes_served_by_stop=None, route_type_by_id=None):  # noqa: ANN001
    """build_stops_index over a single fixture stop '51234' with optional maps."""
    from transit_ops.snapshots.builders import build_stops_index

    class FR:
        def mappings(self): return self
        def __iter__(self): return iter([
            {"stop_id": "51234", "stop_code": "51234", "stop_name": "Côte-Vertu / Décarie",
             "stop_lat": 45.4912345, "stop_lon": -73.6612345},
        ])
    class FC:
        def execute(self, *a, **k): return FR()

    return build_stops_index(
        FC(),
        generated_utc="t",
        routes_served_by_stop=routes_served_by_stop,
        route_type_by_id=route_type_by_id,
    ).stops[0]


def test_build_stops_index():
    # Backward-compatible default path: no maps -> mode null, routes empty.
    e = _stops_index_first()
    assert e.id == "51234"
    assert e.lat == 45.49123  # rounded 5dp
    assert e.mode is None
    assert e.routes == []


def test_build_stops_index_mode_metro_wins_over_bus():
    # metro+bus interchange: route_type 1 present -> mode 'metro'.
    e = _stops_index_first(
        routes_served_by_stop={"51234": ["1", "165"]},
        route_type_by_id={"1": 1, "165": 3},
    )
    assert e.routes == ["1", "165"]
    assert e.mode == "metro"


def test_build_stops_index_bus_only():
    e = _stops_index_first(
        routes_served_by_stop={"51234": ["165", "747"]},
        route_type_by_id={"165": 3, "747": 3},
    )
    assert e.mode == "bus"
    assert e.routes == ["165", "747"]


def test_build_stops_index_routes_capped_mode_from_full_set():
    # 6 served routes: routes list capped at 5, but mode sees the full set so the
    # capped-out metro route (sorts last here) still wins the discriminator.
    served = ["100", "101", "102", "103", "104", "1"]
    e = _stops_index_first(
        routes_served_by_stop={"51234": served},
        route_type_by_id={r: 3 for r in served} | {"1": 1},
    )
    assert e.routes == ["100", "101", "102", "103", "104"]
    assert e.mode == "metro"


def test_build_stops_index_stop_absent_from_maps():
    # Stop missing from the routes map (no weekday service) -> mode null, routes [].
    e = _stops_index_first(
        routes_served_by_stop={"99999": ["1"]},
        route_type_by_id={"1": 1},
    )
    assert e.mode is None
    assert e.routes == []


def test_mode_from_route_types():
    from transit_ops.snapshots.builders.static import _mode_from_route_types

    assert _mode_from_route_types([]) is None
    assert _mode_from_route_types([3]) == "bus"
    assert _mode_from_route_types([1]) == "metro"
    assert _mode_from_route_types([3, 1, 3]) == "metro"   # metro > bus
    assert _mode_from_route_types([0, 3]) == "tram"       # tram > bus
    assert _mode_from_route_types([2, 3]) == "rail"       # rail > bus
    assert _mode_from_route_types([4]) == "ferry"
    assert _mode_from_route_types([None, 3]) == "bus"     # NULL folds to bus
    assert _mode_from_route_types([99]) == "bus"          # unknown folds to bus


def test_build_route():
    import datetime

    from transit_ops.snapshots.builders import build_route

    class _FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def mappings(self):
            outer = self

            class M:
                def fetchone(self):
                    return outer._rows[0] if outer._rows else None

                def __iter__(self):
                    return iter(outer._rows)

            return M()

        def __iter__(self):
            # for row[0]-style iteration (active-services query)
            return iter(self._rows)

        def fetchone(self):
            return self._rows[0] if self._rows else None

        def scalar_one(self):
            return self._rows[0] if self._rows else 0

    # Dispatch table: (substring, rows) — first match wins
    dispatch = [
        # dataset version
        ("dataset_kind = 'static_schedule'", [{"dataset_version_id": 1}]),
        # rep-dates
        ("generate_series", [{"weekday_date": datetime.date(2026, 6, 3), "weekend_date": datetime.date(2026, 6, 6)}]),
        # active-services (returns tuples for row[0] iteration)
        ("extract(isodow FROM :repdate)", [("svc_wd",)]),
        # route long name + route_type (the build_route name query now also selects
        # route_type for the self-describing mode field; route 165 is a bus = type 3)
        ("route_long_name, route_type FROM gold.dim_route", [{"route_long_name": "Côte-Vertu", "route_type": 3}]),
        # route shapes
        ("map_route_lines", [
            {"shape_id": "s1", "geojson": {"type": "LineString", "coordinates": []},
             "direction_id": 0, "trip_headsign": "Nord", "trip_count": 10}
        ]),
        # route stops
        ("DISTINCT ON (st.stop_sequence)", [
            {"stop_sequence": 1, "stop_id": "51234", "stop_name": "X"}
        ]),
        # route schedule
        ("st.stop_sequence     = 1", [
            {"direction_id": 0, "is_weekday": True, "departure_time": "07:00:00"},
            {"direction_id": 0, "is_weekday": True, "departure_time": "07:08:00"},
            {"direction_id": 0, "is_weekday": True, "departure_time": "14:00:00"},
        ]),
    ]

    class FC:
        def execute(self, statement, params=None):
            s = str(statement)
            for needle, rows in dispatch:
                if needle in s:
                    return _FakeResult(rows)
            return _FakeResult([])

    rf = build_route(FC(), route_id="165", generated_utc="t")
    assert rf.id == "165"
    assert rf.long == "Côte-Vertu"
    assert rf.type == 3  # GTFS route_type emitted on the self-describing route file
    assert len(rf.directions) >= 1
    assert rf.directions[0].dir == 0
    assert rf.directions[0].stops[0].id == "51234"
    assert rf.first_departure == "07:00"  # wall-clock of earliest weekday departure
    assert any(sp.shift == "am_peak" for sp in rf.service_periods)


def test_build_all_stops_data():
    import datetime

    from transit_ops.snapshots.builders import build_all_stops_data

    class _FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def mappings(self):
            outer = self

            class M:
                def fetchone(self):
                    return outer._rows[0] if outer._rows else None

                def __iter__(self):
                    return iter(outer._rows)

            return M()

        def __iter__(self):
            return iter(self._rows)

        def fetchone(self):
            return self._rows[0] if self._rows else None

        def scalar_one(self):
            return self._rows[0] if self._rows else 0

    dispatch = [
        # dataset version (matched before rep-dates because it's more specific)
        ("dataset_kind = 'static_schedule'", [{"dataset_version_id": 1}]),
        # rep-dates
        ("generate_series", [{"weekday_date": datetime.date(2026, 6, 3), "weekend_date": datetime.date(2026, 6, 6)}]),
        # active-services
        ("extract(isodow FROM :repdate)", [("svc_wd",)]),
        # all stops
        ("FROM gold.dim_stop", [
            {"stop_id": "51234", "stop_code": "51234", "stop_name": "X",
             "stop_lat": 45.49, "stop_lon": -73.66, "wheelchair_boarding": 1}
        ]),
        # all stop schedules
        ("ANY(:weekday_services)", [
            {"stop_id": "51234", "route_id": "165", "trip_headsign": "Nord", "departure_time": "17:46:00"},
            {"stop_id": "51234", "route_id": "165", "trip_headsign": "Nord", "departure_time": "17:54:00"},
        ]),
    ]

    class FC:
        def execute(self, statement, params=None):
            s = str(statement)
            for needle, rows in dispatch:
                if needle in s:
                    return _FakeResult(rows)
            return _FakeResult([])

    result = build_all_stops_data(FC(), generated_utc="t")
    assert "51234" in result
    sf = result["51234"]
    assert sf.wheelchair is True
    assert "165" in sf.routes_served
    # times are wall-clock "HH:MM" and de-duplicated
    assert sf.scheduled[0].times == ["17:46", "17:54"]


# --------------------------------------------------------------------------
# generated_utc stamping per builder family (slice-9.1.1r)
# --------------------------------------------------------------------------


def test_build_trips_stamps_generated_utc() -> None:
    conn = FakeConn({})
    out = build_trips(conn, provider_id="stm", generated_utc="2026-06-13T00:00:00Z")
    assert out.generated_utc == "2026-06-13T00:00:00Z"


def test_build_alerts_stamps_generated_utc() -> None:
    conn = FakeConn({})
    out = build_alerts(conn, provider_id="stm", generated_utc="2026-06-13T00:00:00Z")
    assert out.generated_utc == "2026-06-13T00:00:00Z"


def test_build_network_stamps_generated_utc() -> None:
    conn = FakeConn(
        {
            "0) AS non_responding": [{"non_responding": 0}],
            "feed_freshness_current": [{"feed_freshness_s": 0}],
        }
    )
    out = build_network(conn, provider_id="stm", generated_utc="2026-06-13T00:00:00Z")
    assert out.generated_utc == "2026-06-13T00:00:00Z"


def test_static_builders_stamp_generated_utc() -> None:
    from transit_ops.snapshots.builders import (
        build_labels,
        build_routes_index,
        build_stops_index,
    )

    conn = FakeConn({})
    assert build_routes_index(conn, generated_utc="S").generated_utc == "S"
    assert build_stops_index(conn, generated_utc="S").generated_utc == "S"
    assert build_labels(conn, lang="fr", generated_utc="S").generated_utc == "S"


def test_historic_flat_builders_stamp_generated_utc() -> None:
    from transit_ops.snapshots.builders import (
        build_alert_history,
        build_hotspots,
        build_network_trend,
        build_provenance,
        build_repeat_offenders,
    )

    conn = FakeConn({})
    assert build_network_trend(conn, generated_utc="H").generated_utc == "H"
    assert build_hotspots(conn, "stm", generated_utc="H").generated_utc == "H"
    assert build_repeat_offenders(conn, "stm", generated_utc="H").generated_utc == "H"
    assert build_alert_history(conn, "stm", generated_utc="H").generated_utc == "H"
    assert build_provenance(conn, "stm", generated_utc="H").generated_utc == "H"


def test_build_provenance_surfaces_out_of_norm_conformance() -> None:
    from transit_ops.snapshots.builders import build_provenance

    conn = FakeConn(
        {
            "gtfs_extra_rows": [
                {
                    "extra_row_count": 12,
                    "unknown_members": ["pathways.txt", "levels.txt"],
                }
            ],
        }
    )

    prov = build_provenance(conn, "sto", generated_utc="H")

    assert prov.conformance is not None
    assert prov.conformance.status == "out_of_norm"
    assert prov.conformance.unknown_members == ["levels.txt", "pathways.txt"]
    assert prov.conformance.extra_row_count == 12


def test_build_provenance_conformant_when_static_load_matched_shape() -> None:
    from transit_ops.snapshots.builders import build_provenance

    conn = FakeConn(
        {"gtfs_extra_rows": [{"extra_row_count": 0, "unknown_members": None}]}
    )

    prov = build_provenance(conn, "stm", generated_utc="H")

    assert prov.conformance is not None
    assert prov.conformance.status == "conformant"
    assert prov.conformance.unknown_members == []
    assert prov.conformance.extra_row_count == 0


def test_build_provenance_conformance_none_without_current_static_dataset() -> None:
    from transit_ops.snapshots.builders import build_provenance

    # No row from the conformance query => provider has no current static dataset.
    prov = build_provenance(FakeConn({}), "stm", generated_utc="H")

    assert prov.conformance is None


def test_build_alert_history_sanitizes_legacy_python_repr_en_text() -> None:
    import datetime

    from transit_ops.snapshots.builders import build_alert_history

    conn = FakeConn(
        {
            # Exact-name dispatch for the pre-cap count query (the substring
            # fallback would otherwise hand the alert row to it — no 'total' key).
            "alerts.history.count": [{"total": 1}],
            "i3_alert_history_reporting": [
                {
                    "alert_header_text": "Votre ligne",
                    "header_text_en": "{'text': None, 'language': 'en'}",
                    "description": "<p>Arrêts annulés.</p>",
                    "description_en": "{'text': None, 'language': 'en'}",
                    "severity": "WARNING",
                    "routes": ["161"],
                    "stops": ["51234"],
                    "start_utc": datetime.datetime(2026, 6, 1, 8, 0, tzinfo=datetime.UTC),
                    "end_utc": datetime.datetime(2026, 6, 1, 9, 0, tzinfo=datetime.UTC),
                }
            ],
        }
    )

    out = build_alert_history(conn, "stm", generated_utc="H")

    assert out.alerts[0].header_text_en is None
    assert out.alerts[0].description == "<p>Arrêts annulés.</p>"
    assert out.alerts[0].description_en is None


def test_build_alert_history_passes_bilingual_source_messages_without_rekeying() -> None:
    import datetime

    from transit_ops.snapshots.builders import build_alert_history
    from transit_ops.snapshots.builders.historic.small_surfaces import _ALERT_HISTORY_SQL

    start = datetime.datetime(2026, 6, 1, 8, 0, tzinfo=datetime.UTC)

    def _build(description: str, description_en: str):
        return build_alert_history(
            FakeConn(
                {
                    "alerts.history.anchor": [{"anchor": datetime.date(2026, 6, 1)}],
                    "alerts.history.count": [{"total": 1}],
                    "alerts.history": [
                        {
                            "alert_header_text": "Votre ligne",
                            "header_text_en": "Your line",
                            "description": description,
                            "description_en": description_en,
                            "severity": "WARNING",
                            "routes": ["161"],
                            "stops": ["51234"],
                            "start_utc": start,
                            "end_utc": start + datetime.timedelta(hours=1),
                        }
                    ],
                }
            ),
            "stm",
            generated_utc="H",
        )

    first = _build("<p>Arrêts annulés.</p>", "<p>Stops cancelled.</p>").alerts[0]
    changed_copy = _build("Message source modifié", "Changed source copy").alerts[0]

    assert first.description == "<p>Arrêts annulés.</p>"
    assert first.description_en == "<p>Stops cancelled.</p>"
    assert changed_copy.description == "Message source modifié"
    assert first.id == changed_copy.id

    sql = " ".join(str(_ALERT_HISTORY_SQL).split())
    assert "MAX(grp.description) AS description" in sql
    assert "MAX(grp.description_en) AS description_en" in sql
    group_by = sql.split("GROUP BY", 1)[1].split("ORDER BY", 1)[0]
    assert "description" not in group_by


# --------------------------------------------------------------------------
# build_basemap (settings-driven pointer)
# --------------------------------------------------------------------------


def test_build_basemap_none_without_url() -> None:
    from transit_ops.snapshots.builders import build_basemap

    class _S:
        SNAPSHOT_BASEMAP_PMTILES_URL = None

    assert build_basemap(_S(), generated_utc="t") is None
    # also None when the attribute is entirely absent
    assert build_basemap(object(), generated_utc="t") is None


def test_build_basemap_pointer_carries_url_style_attribution() -> None:
    from transit_ops.snapshots.builders import build_basemap

    class _S:
        SNAPSHOT_BASEMAP_PMTILES_URL = "https://x/quebec.pmtiles"
        SNAPSHOT_BASEMAP_STYLE_URL = "https://x/style.json"
        SNAPSHOT_BASEMAP_ATTRIBUTION = "© OSM, © Protomaps"

    bm = build_basemap(_S(), generated_utc="2026-06-13T00:00:00Z")
    assert bm is not None
    assert bm.format == "pmtiles"
    assert bm.url == "https://x/quebec.pmtiles"
    assert bm.style_url == "https://x/style.json"
    assert bm.attribution == "© OSM, © Protomaps"
    assert bm.generated_utc == "2026-06-13T00:00:00Z"


# --------------------------------------------------------------------------
# build_stop_reliability — shift + day-type granularity grains (folded data depth)
# --------------------------------------------------------------------------


def test_build_stop_reliability_emits_shift_and_daytype_grains() -> None:
    """Stop reliability publishes additive shift + weekday/weekend grains.

    The hour->shift band CASE and the ISODOW weekday/weekend split run in Postgres,
    so the FakeConn returns grain-resolved rows (the bucketing is exercised against
    a real DB separately) — mirroring how the route grain tests are structured.
    avg delay is observation-weighted; honest None (never 0) when obs is 0/missing.
    """
    from transit_ops.snapshots.builders.historic import build_stop_reliability

    # _STOP_BY_GRAIN_SQL returns (stop_id, grain, obs, severe, weighted_delay_sec)
    # for the union of shift buckets (peak hour + off-peak hour) and day-type
    # (weekday + weekend). 60s weighted per obs -> avg 1.0 min for the populated
    # rows; the weekend row has obs=0 to assert the honest-None path.
    grain_rows = [
        # am_peak: 10 obs, 1 severe, 600s weighted -> avg 1.0 min, otp 90, severe 10.0
        {"stop_id": "51234", "grain": "am_peak", "obs": 10, "severe": 1,
         "weighted_delay_sec": 600.0},
        # night (off-peak): 4 obs, 0 severe, 480s weighted -> avg 2.0 min, otp 100
        {"stop_id": "51234", "grain": "night", "obs": 4, "severe": 0,
         "weighted_delay_sec": 480.0},
        # weekday: 14 obs, 1 severe, 1080s weighted -> avg ~1.3 min
        {"stop_id": "51234", "grain": "weekday", "obs": 14, "severe": 1,
         "weighted_delay_sec": 1080.0},
        # weekend: 0 obs -> honest None across otp/avg/severe
        {"stop_id": "51234", "grain": "weekend", "obs": 0, "severe": 0,
         "weighted_delay_sec": None},
    ]

    # _STOP_DOW_SQL returns (stop_id, day_of_week_iso, dow_obs, severe, weighted_delay_sec)
    # per weekday. The ISODOW resolution runs in Postgres, so the FakeConn returns
    # already-resolved iso days. The fixture is pre-sorted (iso 1, 3, 7) and FakeConn
    # returns rows verbatim, so the ORDER BY (stop_id, isodow) is enforced by Postgres,
    # not asserted by this offline test; the emitted day_of_week list mirrors this order.
    # Sun (iso 7) carries obs=0 to assert the honest-None path.
    dow_rows = [
        # Mon (1): 20 obs, 2 severe, 1200s weighted -> avg 1.0 min, severe 10.0
        {"stop_id": "51234", "day_of_week_iso": 1, "dow_obs": 20, "severe": 2,
         "weighted_delay_sec": 1200.0},
        # Wed (3): 10 obs, 0 severe, 1200s weighted -> avg 2.0 min, severe 0.0
        {"stop_id": "51234", "day_of_week_iso": 3, "dow_obs": 10, "severe": 0,
         "weighted_delay_sec": 1200.0},
        # Sun (7): 0 obs -> honest None across avg/severe; obs None
        {"stop_id": "51234", "day_of_week_iso": 7, "dow_obs": 0, "severe": 0,
         "weighted_delay_sec": None},
    ]

    import datetime as _dt
    _anchor = _dt.date(2026, 6, 30)
    # DB-0067 Phase 1: weekly/monthly/by_route read gold.stop_delay_spine. by_route
    # keeps the '__unrouted__' filter; weekly+monthly share identical SQL, told apart
    # by win_start (anchor-6 vs anchor-29). The anchor query is answered first.
    dispatch = [
        # by-route breakdown — unique sentinel-filter clause, matched first so it
        # doesn't shadow the weekly/monthly spine period query.
        ("'__unrouted__'", []),
        # grain SQL (shift + day-type union) — unique discriminator "AS banded".
        ("AS banded", grain_rows),
        # day-of-week seasonality — unique discriminator "AS dow_obs" (must match
        # before the bare stop_delay_hourly habits needle below).
        ("AS dow_obs", dow_rows),
        ("FROM gold.stop_delay_hourly", []),  # habits matrix: empty
        ("stop_delay_percentile_daily", []),  # day p50/p90: none
        # Trailing-30d crowding band counts for the stop — unique discriminator
        # "stop_occupancy_band_daily AS sob". 50 many_seats + 25 standing + 25 full
        # over 100 band-bearing pings -> shares 0.5 / 0.25 / 0.25.
        ("stop_occupancy_band_daily AS sob", [
            {"stop_id": "51234", "empty": 0, "many_seats": 50,
             "few_seats": 0, "standing": 25, "full": 25},
        ]),
        ("stop_name", [{"stop_id": "51234", "stop_name": "Berri-UQAM"}]),
    ]
    # weekly period rows (one stop) so the stop survives into output; month empty.
    _weekly = [{"stop_id": "51234", "obs": 50, "weighted_delay_sec": 3000.0, "severe": 2}]

    class FC:
        def execute(self, statement, params=None):  # noqa: ANN001, ANN201
            s = str(statement)
            params = params or {}
            if "MAX(provider_local_date)" in s and "stop_delay_spine" in s:
                return FakeResult([{"anchor": _anchor}])
            for needle, rows in dispatch:
                if needle in s:
                    return FakeResult(rows)
            if "FROM gold.stop_delay_spine" in s:
                if params.get("win_start") == _anchor - _dt.timedelta(days=6):
                    return FakeResult(_weekly)
                return FakeResult([])  # month (anchor-29) + any other window: empty
            return FakeResult([])

    out = build_stop_reliability(FC(), provider_id="stm", generated_utc="t")
    assert "51234" in out
    by_grain = {p.grain: p for p in out["51234"].periods}

    # week stays present; the four granularity grains are additive alongside it.
    assert "week" in by_grain
    assert {"am_peak", "night", "weekday", "weekend"} <= set(by_grain)

    am = by_grain["am_peak"]
    assert am.avg_delay_min == 1.0          # 600s weighted / 10 obs / 60
    assert am.severe_pct == 10.0            # 1 / 10
    assert am.otp_pct == 90                 # severe proxy: (10-1)/10

    night = by_grain["night"]
    assert night.avg_delay_min == 2.0       # 480s / 4 obs / 60
    assert night.otp_pct == 100             # no severe
    assert night.severe_pct == 0.0

    weekday = by_grain["weekday"]
    assert weekday.avg_delay_min == 1.3     # round(1080/14/60, 1)

    # Honest NULLs (never 0) when obs is 0.
    weekend = by_grain["weekend"]
    assert weekend.otp_pct is None
    assert weekend.avg_delay_min is None
    assert weekend.severe_pct is None

    # --- per-stop weekday seasonality (day_of_week, ISO 1..7), route parity ---
    dow = {d.day_of_week_iso: d for d in out["51234"].day_of_week}
    # Emission stays sorted by ISODOW (SQL ORDER BY); the populated iso days surface.
    assert [d.day_of_week_iso for d in out["51234"].day_of_week] == [1, 3, 7]

    mon = dow[1]
    assert mon.avg_delay_min == 1.0          # 1200s weighted / 20 obs / 60
    assert mon.severe_pct == 10.0            # 2 / 20
    assert mon.observation_count == 20

    wed = dow[3]
    assert wed.avg_delay_min == 2.0          # 1200s / 10 obs / 60
    assert wed.severe_pct == 0.0
    assert wed.observation_count == 10

    # Honest None (never 0) on a zero-observation weekday.
    sun = dow[7]
    assert sun.avg_delay_min is None
    assert sun.severe_pct is None
    assert sun.observation_count is None

    # --- per-stop crowding band shares (occupancy_mix), honest-None on zero ---
    mix = out["51234"].occupancy_mix
    assert mix is not None
    assert mix.empty == 0.0
    assert mix.many_seats == 0.5            # 50 / 100 band-bearing pings
    assert mix.standing == 0.25             # 25 / 100
    assert mix.full == 0.25                 # 25 / 100
    assert mix.few_seats == 0.0


def test_build_stop_reliability_occupancy_mix_none_when_no_telemetry() -> None:
    """A stop with delay history but NO occupancy telemetry attributed to it must
    publish occupancy_mix=None (honest-None), never a fabricated all-zero mix — an
    all-zero distribution is indistinguishable from a real all-empty fleet. Mirrors
    the route occupancy honesty path."""
    from transit_ops.snapshots.builders.historic import build_stop_reliability

    import datetime as _dt
    _anchor = _dt.date(2026, 6, 30)
    dispatch = [
        ("'__unrouted__'", []),
        ("AS banded", []),
        ("AS dow_obs", []),
        ("FROM gold.stop_delay_hourly", []),
        ("stop_delay_percentile_daily", []),
        # No occupancy rows attributed to this stop -> honest-None occupancy_mix.
        ("stop_occupancy_band_daily AS sob", []),
        ("stop_name", [{"stop_id": "51234", "stop_name": "Berri-UQAM"}]),
    ]
    # The stop survives into output purely on its weekly spine period row (DB-0067).
    _weekly = [{"stop_id": "51234", "obs": 50, "weighted_delay_sec": 3000.0, "severe": 2}]

    class FC:
        def execute(self, statement, params=None):  # noqa: ANN001, ANN201
            s = str(statement)
            params = params or {}
            if "MAX(provider_local_date)" in s and "stop_delay_spine" in s:
                return FakeResult([{"anchor": _anchor}])
            for needle, rows in dispatch:
                if needle in s:
                    return FakeResult(rows)
            if "FROM gold.stop_delay_spine" in s:
                if params.get("win_start") == _anchor - _dt.timedelta(days=6):
                    return FakeResult(_weekly)
                return FakeResult([])
            return FakeResult([])

    out = build_stop_reliability(FC(), provider_id="stm", generated_utc="t")
    assert "51234" in out
    assert out["51234"].occupancy_mix is None  # no telemetry -> null, not all-zero


# --------------------------------------------------------------------------
# build_network_trend — network-wide shift + day-type reliability (folded depth)
# --------------------------------------------------------------------------


def test_build_network_trend_emits_week_and_month_grain_series() -> None:
    """Weekly + monthly TrendPoint lists re-aggregate the SAME daily sources.

    The date_trunc('week'/'month', ...) GROUP BY runs in Postgres; the FakeConn
    returns already-bucketed rows keyed by the bucket-start local date. OTP +
    weighted-avg + cancellation_rate + occupancy_mix are observation-weighted
    exactly like the daily series; p90_min/vehicles stay None on every week/month
    point (no fact_sql is dispatched for those grains). Lists sort ascending by
    bucket date. Dispatch keys are the `-- q:network.trend.*` registry names.
    """
    import datetime

    from transit_ops.snapshots.builders.historic import build_network_trend

    # Two ISO-week buckets (Mon 2026-06-01, Mon 2026-06-08), out of order to
    # assert ascending sort. otp = on_time/known, avg = weighted/known/60.
    # GC1 spine re-point: avg = pooled_delay_sec / inclamp_obs (ghost-excluded mean).
    week_hourly = [
        {"local_date": datetime.date(2026, 6, 8), "known_obs": 200, "on_time": 150,
         "pooled_delay_sec": 24000.0, "inclamp_obs": 200},  # otp 75, avg 2.0
        {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
         "pooled_delay_sec": 6000.0, "inclamp_obs": 100},   # otp 90, avg 1.0
    ]
    week_cancel = [
        # 2.5% RT-cancel rate; delivered 117 / scheduled 130 -> 90.0% completeness (GC2 H1).
        {"local_date": datetime.date(2026, 6, 1), "canceled": 3, "total": 120,
         "delivered": 117, "scheduled": 130},
    ]
    week_occupancy = [
        {"local_date": datetime.date(2026, 6, 1), "empty": 0, "many_seats": 50,
         "few_seats": 30, "standing": 15, "full": 5},  # total 100
    ]
    # One calendar-month bucket (2026-06-01).
    month_hourly = [
        {"local_date": datetime.date(2026, 6, 1), "known_obs": 1000, "on_time": 820,
         "pooled_delay_sec": 90000.0, "inclamp_obs": 1000},  # otp 82, avg 1.5
    ]
    month_cancel = [
        # 2.0% RT-cancel rate; delivered 588 / scheduled 600 -> 98.0% completeness (GC2 H1).
        {"local_date": datetime.date(2026, 6, 1), "canceled": 12, "total": 600,
         "delivered": 588, "scheduled": 600},
    ]
    month_occupancy = [
        {"local_date": datetime.date(2026, 6, 1), "empty": 10, "many_seats": 40,
         "few_seats": 30, "standing": 15, "full": 5},  # total 100
    ]

    dispatch = {
        "network.trend.week_hourly": week_hourly,
        "network.trend.week_cancel": week_cancel,
        "network.trend.week_occupancy": week_occupancy,
        "network.trend.month_hourly": month_hourly,
        "network.trend.month_cancel": month_cancel,
        "network.trend.month_occupancy": month_occupancy,
        # daily series + network grains left empty for this test.
    }

    class FC:
        def execute(self, statement, params=None):  # noqa: ANN001, ANN201, ARG002
            return FakeResult(dispatch.get(query_name(statement), []))

    out = build_network_trend(FC(), provider_id="stm", generated_utc="t")

    # --- weekly: ascending by bucket date, weighted OTP/avg, honest fields ---
    assert [p.date for p in out.weekly] == ["2026-06-01", "2026-06-08"]
    w0, w1 = out.weekly
    assert w0.otp_pct == 90                  # 90 / 100
    assert w0.avg_delay_min == 1.0           # 6000 / 100 / 60
    assert w0.cancellation_rate == 2.5       # 100 * 3 / 120 (RT-observed, unchanged)
    assert w0.service_completeness_rate == 90.0  # 100 * 117 / 130 (GC2 H1)
    assert w0.occupancy_mix is not None
    assert w0.occupancy_mix.many_seats == 0.5  # 50 / 100
    # p90/vehicles NEVER aggregated to week (no fact_sql dispatched).
    assert w0.p90_min is None
    assert w0.vehicles is None
    # Second week bucket has only hourly data → cancel/occupancy honest-None.
    assert w1.otp_pct == 75                  # 150 / 200
    assert w1.avg_delay_min == 2.0           # 24000 / 200 / 60
    assert w1.cancellation_rate is None
    assert w1.service_completeness_rate is None
    assert w1.occupancy_mix is None
    assert w1.p90_min is None
    assert w1.vehicles is None

    # --- monthly: one bucket, same weighted math, null p90/vehicles ---
    assert [p.date for p in out.monthly] == ["2026-06-01"]
    m0 = out.monthly[0]
    assert m0.otp_pct == 82                  # 820 / 1000
    assert m0.avg_delay_min == 1.5           # 90000 / 1000 / 60
    assert m0.cancellation_rate == 2.0       # 100 * 12 / 600 (RT-observed, unchanged)
    assert m0.service_completeness_rate == 98.0  # 100 * 588 / 600 (GC2 H1)
    assert m0.occupancy_mix is not None
    assert m0.occupancy_mix.empty == 0.1     # 10 / 100
    assert m0.p90_min is None
    assert m0.vehicles is None
