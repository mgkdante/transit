
from __future__ import annotations

import pytest

from transit_ops.core.models import ProviderPublicConfig
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.snapshots.builders import (
    build_alerts,
    build_manifest,
    build_network,
    build_stop_departures,
    build_trips,
    build_vehicles,
)
from transit_ops.snapshots.builders._helpers import _iso
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

    def __init__(self, rows):  # noqa: ANN001
        self._rows = list(rows)

    def mappings(self):  # noqa: ANN201
        return self

    def __iter__(self):
        return iter(self._rows)

    def fetchone(self):  # noqa: ANN201
        return self._rows[0] if self._rows else None

    def scalar_one(self):  # noqa: ANN201
        first = self._rows[0]
        if isinstance(first, dict):
            return next(iter(first.values()))
        return first


class FakeConn:

    def __init__(self, responses):  # noqa: ANN001
        self._responses = responses
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        sql = str(statement)
        self.executed.append(sql)
        name = query_name(statement)
        if name is not None and name in self._responses:
            return FakeResult(self._responses[name])
        best_rows = None
        best_len = -1
        for needle, rows in self._responses.items():
            if needle in sql and len(needle) > best_len:
                best_rows = rows
                best_len = len(needle)
        return FakeResult(best_rows if best_rows is not None else [])


def test_iso_converts_offset_to_utc() -> None:
    from datetime import datetime, timedelta, timezone

    dt = datetime(2026, 5, 31, 21, 42, 0, tzinfo=timezone(timedelta(hours=-4)))
    assert _iso(dt) == "2026-06-01T01:42:00Z"


def test_iso_passes_through_strings() -> None:
    assert _iso("2026-05-31T21:42:00Z") == "2026-05-31T21:42:00Z"


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
                    "speed_ms": 10.0,
                    "status_band": "En retard / Late",
                    "occupancy_status": 2,
                    "next_stop": "S-900",
                    "updated_utc": "2026-05-31T12:00:00Z",
                    "reported_utc": "2026-05-31T11:59:30Z",
                    "delay_seconds": 120,
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
    assert v.lat == 45.49123
    assert v.lon == -73.56789
    assert v.bearing == 182
    assert v.speed_kmh == 36
    assert v.next_stop == "S-900"
    assert v.updated_utc == "2026-05-31T12:00:00Z"
    assert v.reported_utc == "2026-05-31T11:59:30Z"
    assert v.delay_min == 2


def test_build_vehicles_unknown_status_and_null_occupancy() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {
                    "id": 7777,
                    "route": None,
                    "trip": None,
                    "lat": 45.5,
                    "lon": -73.6,
                    "bearing": None,
                    "speed_ms": None,
                    "status_band": "Inconnu / Unknown",
                    "occupancy_status": None,
                    "next_stop": None,
                    "updated_utc": "2026-05-31T12:00:00Z",
                    "reported_utc": None,
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
    assert v.reported_utc is None


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
            "speed_ms": None,
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


def test_build_trips_groups_stops_and_converts_delay_to_minutes() -> None:
    conn = FakeConn(
        {
            "current_trip_delay_computed": [
                {
                    "trip_id": "T-1",
                    "route_id": "51",
                    "avg_delay_seconds": 130.0,
                    "status_band": "En retard / Late",
                },
                {
                    "trip_id": "T-2",
                    "route_id": "97",
                    "avg_delay_seconds": -200.0,
                    "status_band": "En avance / Early",
                },
            ],
            "current_stop_next_departures": [
                {
                    "trip_id": "T-1",
                    "route_id": "51",
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
                    "trip_id": "T-3-orphan",
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
    t1 = out.trips["T-1"]
    assert t1.route == "51"
    assert t1.status == "late"
    assert t1.delay_min == 2
    assert [s.stop for s in t1.stops] == ["S-1", "S-2"]
    assert t1.stops[0].eta_utc == "2026-05-31T12:05:00Z"
    t2 = out.trips["T-2"]
    assert t2.status == "early"
    assert t2.delay_min == -3
    assert t2.stops == []
    t3 = out.trips["T-3-orphan"]
    assert t3.route == "80"
    assert t3.status == "unknown"
    assert t3.delay_min is None
    assert [s.stop for s in t3.stops] == ["S-9"]


def test_trip_departures_sql_contract_60min_horizon() -> None:
    from transit_ops.snapshots.builders.live import _TRIP_DEPARTURES_SQL

    sql = str(_TRIP_DEPARTURES_SQL)
    assert "interval '60 minutes'" in sql
    assert "predicted_departure_utc <" in sql


def test_status_band_case_sql_drift_guard_vs_0020() -> None:
    from transit_ops.snapshots.builders._helpers import STATUS_BAND_CASE_SQL

    sql = STATUS_BAND_CASE_SQL.format(col="avg_delay_seconds")
    assert "-60" in sql
    assert "60" in sql
    assert "300" in sql
    for label in (
        "Inconnu / Unknown",
        "En avance / Early",
        "À l''heure / On time",
        "En retard / Late",
        "Critique / Severe",
    ):
        assert label in sql


def test_build_trips_status_band_computed_in_query_not_python() -> None:
    from transit_ops.snapshots.builders.live import _TRIP_DELAY_SQL

    sql = str(_TRIP_DELAY_SQL)
    assert "AS status_band" in sql
    assert "FROM gold.current_trip_delay_computed" in sql
    assert "WHERE provider_id = :provider_id" in sql
    assert "CASE" in sql


def test_build_stop_departures_groups_by_stop_in_eta_order_and_maps_delay() -> None:
    conn = FakeConn(
        {
            "current_stop_next_departures": [
                {
                    "stop_id": "S-1",
                    "route_id": "165",
                    "trip_id": "t1",
                    "predicted_departure_utc": "2026-06-10T12:05:00Z",
                    "avg_delay_seconds": 130.0,
                },
                {
                    "stop_id": "S-1",
                    "route_id": "171",
                    "trip_id": "t2",
                    "predicted_departure_utc": "2026-06-10T12:08:00Z",
                    "avg_delay_seconds": None,
                },
                {
                    "stop_id": "S-2",
                    "route_id": "24",
                    "trip_id": "t3",
                    "predicted_departure_utc": "2026-06-10T12:10:00Z",
                    "avg_delay_seconds": -200.0,
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
    from transit_ops.snapshots.builders.live import (
        _STOP_DEPARTURES_PER_ROUTE_CAP,
        _STOP_DEPARTURES_SQL,
    )

    sql = str(_STOP_DEPARTURES_SQL)
    assert "PARTITION BY d.stop_id, d.route_id" in sql
    assert ":per_route_cap" in sql
    assert "d.stop_id IS NOT NULL" in sql
    assert "current_trip_delay_computed" in sql
    assert "GROUP BY provider_id, trip_id" in sql
    assert _STOP_DEPARTURES_PER_ROUTE_CAP == 2


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
                    "alert_id": None,
                    "alert_header_text": "Major closure",
                    "description_text": "Major closure desc",
                    "alert_header_text_en": None,
                    "description_text_en": None,
                    "severity": "severe",
                    "cause": "CONSTRUCTION",
                    "effect": "NO_SERVICE",
                    "route_ids": None,
                    "stop_ids": None,
                    "active_period_start_utc": None,
                    "active_period_end_utc": None,
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
    assert a1.severity == "high"
    assert a1.header_key == "Service disruption line 1"
    assert a1.header_text == "Service disruption line 1"
    assert a1.header_text == a1.header_key
    assert a1.description == "Delays on line 1"
    assert a1.header_text_en == "Service disruption line 1 (EN)"
    assert a1.description_en == "Delays on line 1 (EN)"
    assert a1.routes == ["1", "4", "51"]
    assert a1.stops == ["S-1", "S-2"]
    assert a1.start_utc == "2026-05-31T08:00:00Z"
    assert a1.end_utc == "2026-05-31T20:00:00Z"
    assert a1.cause == "ACCIDENT"
    assert a1.effect == "DETOUR"
    assert a1.severity_level == "warning"
    assert a1.url == "https://stm.info/alerts/A-1"
    assert a1.url_en == "https://stm.info/en/alerts/A-1"
    assert len(a1.active_periods) == 2
    assert a1.active_periods[0].start_utc == "2026-05-31T08:00:00Z"
    assert a1.active_periods[1].end_utc == "2026-06-07T20:00:00Z"
    a2 = out.alerts[1]
    assert a2.severity == "critical"
    assert a2.routes == []
    assert a2.stops == []
    assert a2.header_text == "Major closure"
    assert a2.description == "Major closure desc"
    assert a2.header_text_en is None
    assert a2.description_en is None
    basis = "Major closure desc|severe|CONSTRUCTION|NO_SERVICE"
    expected_id = "stm-alert-" + hashlib.sha1(basis.encode()).hexdigest()[:12]
    assert a2.id == expected_id
    out2 = build_alerts(conn, provider_id="stm", generated_utc="2026-05-31T12:00:05Z")
    assert out2.alerts[1].id == expected_id
    assert a2.start_utc is None
    assert a2.cause == "CONSTRUCTION"
    assert a2.effect == "NO_SERVICE"
    assert a2.severity_level == "severe"
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


def test_build_network_aggregates_kpis() -> None:
    vehicle_rows = [
        {"status_band": "À l'heure / On time", "occupancy_status": 1},
        {"status_band": "À l'heure / On time", "occupancy_status": 1},
        {"status_band": "En retard / Late", "occupancy_status": 3},
        {"status_band": "Critique / Severe", "occupancy_status": 5},
        {"status_band": "Inconnu / Unknown", "occupancy_status": None},
    ]
    trip_rows = [
        {"avg_delay_seconds": 60.0},
        {"avg_delay_seconds": 120.0},
        {"avg_delay_seconds": 600.0},
    ]
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": vehicle_rows,
            "current_trip_delay_computed": trip_rows,
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
    assert out.on_time_pct == 75
    assert out.coverage_pct == 80
    assert round(out.occupancy_mix.many_seats, 3) == 0.5
    assert round(out.occupancy_mix.standing, 3) == 0.25
    assert round(out.occupancy_mix.full, 3) == 0.25
    assert out.non_responding == 7
    assert out.feed_freshness_s == 12
    assert out.delay_p50_min == 2
    assert out.delay_p90_min >= 8
    assert out.non_responding_by_route is not None
    assert [(r.route_id, r.count) for r in out.non_responding_by_route] == [
        ("51", 4),
        ("165", 3),
    ]
    assert sum(r.count for r in out.non_responding_by_route) == out.non_responding
    assert sum("FROM gold.non_responding_current" in sql for sql in conn.executed) == 1
    assert out.delay_histogram is not None
    assert len(out.delay_histogram) == 8
    assert sum(b.count for b in out.delay_histogram) == 3
    by_edges = {(b.lo_min, b.hi_min): b.count for b in out.delay_histogram}
    assert by_edges[(0, 2)] == 1
    assert by_edges[(2, 5)] == 1
    assert by_edges[(10, 15)] == 1
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
            "feed_freshness_current": [{"feed_freshness_s": 0}],
        }
    )

    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")

    assert out.on_time_pct == 67
    assert out.status_dist.on_time == 1
    assert out.status_dist.late == 1
    assert out.status_dist.severe == 1


def test_build_network_zero_vehicles_emits_honest_none_not_zero() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [],
            "current_trip_delay_computed": [],
            "feed_freshness_current": [{"feed_freshness_s": None}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.vehicles_in_service == 0
    assert out.on_time_pct is None
    assert out.delay_p50_min is None
    assert out.delay_p90_min is None
    assert out.coverage_pct is None
    assert out.occupancy_mix is None
    assert out.non_responding == 0
    assert out.feed_freshness_s is None


def test_build_network_unknown_only_fleet_emits_none_on_time_pct() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {"status_band": "Inconnu / Unknown", "occupancy_status": None},
                {"status_band": "Inconnu / Unknown", "occupancy_status": None},
            ],
            "current_trip_delay_computed": [],
            "feed_freshness_current": [{"feed_freshness_s": 4}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.vehicles_in_service == 2
    assert out.on_time_pct is None
    assert out.coverage_pct == 0
    assert out.feed_freshness_s == 4


def test_build_network_no_occupancy_telemetry_emits_none_not_all_zero() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {"status_band": "À l'heure / On time", "occupancy_status": None},
                {"status_band": "En retard / Late", "occupancy_status": None},
            ],
            "current_trip_delay_computed": [],
            "feed_freshness_current": [{"feed_freshness_s": 5}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.vehicles_in_service == 2
    assert out.occupancy_mix is None


def test_build_network_delay_histogram_none_when_no_delay_observations() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [
                {"status_band": "À l'heure / On time", "occupancy_status": None},
            ],
            "current_trip_delay_computed": [],
            "feed_freshness_current": [{"feed_freshness_s": 5}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.delay_p50_min is None
    assert out.delay_p90_min is None
    assert out.delay_histogram is None


def test_build_network_delay_histogram_signed_bucket_edges() -> None:
    minutes = [-7, -3, -1, 1, 3, 7, 12, 20, -5, 0, 15]
    trip_rows = [{"avg_delay_seconds": m * 60.0} for m in minutes]
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [],
            "current_trip_delay_computed": trip_rows,
            "feed_freshness_current": [{"feed_freshness_s": 5}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.delay_histogram is not None
    assert len(out.delay_histogram) == 8
    assert sum(b.count for b in out.delay_histogram) == len(minutes)
    by_edges = {(b.lo_min, b.hi_min): b.count for b in out.delay_histogram}
    assert by_edges[(None, -5)] == 1
    assert by_edges[(-5, -2)] == 2
    assert by_edges[(-2, 0)] == 1
    assert by_edges[(0, 2)] == 2
    assert by_edges[(2, 5)] == 1
    assert by_edges[(5, 10)] == 1
    assert by_edges[(10, 15)] == 1
    assert by_edges[(15, None)] == 2


def test_build_network_non_responding_by_route_none_when_no_routes() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [],
            "current_trip_delay_computed": [],
            "network.live.non_responding_by_route": [],
            "feed_freshness_current": [{"feed_freshness_s": 5}],
        }
    )
    out = build_network(conn, generated_utc="2026-05-31T12:00:05Z")
    assert out.non_responding == 0
    assert out.non_responding_by_route is None


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
    assert out.bbox == [-74.1, 45.25, -73.2, 45.75]
    assert out.dataset_version == "2026-05-29-stm"
    assert out.basemap == "https://data.example.com/v1/stm/static/basemap.json"
    assert out.files.static.basemap == "static/basemap.json"
    assert out.files.live.generated_utc == "2026-05-31T12:00:05Z"
    assert out.files.static.routes_index == "static/routes_index.json"
    assert out.files.static.generated_utc is None
    assert out.files.historic.receipts_index == "historic/receipts/index.json"
    assert out.files.historic.generated_utc is None
    assert out.labels == {"fr": "labels/fr.json", "en": "labels/en.json"}
    assert "live_map" in out.surfaces
    assert "data_trust" in out.surfaces
    assert out.capabilities is not None
    assert out.capabilities.live_map.value == "enabled"
    assert out.capabilities.network_health.value == "enabled"
    assert out.capabilities.lookups.value == "enabled"
    assert out.capabilities.reliability.value == "enabled"
    assert out.capabilities.accountability.value == "enabled"
    assert out.capabilities.data_trust.value == "enabled"


def test_build_manifest_capabilities_honest_absence_without_feeds() -> None:
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
            "core.dataset_versions": [],
        }
    )
    out = build_manifest(
        conn,
        provider_id="stm",
        generated_utc="2026-05-31T12:00:05Z",
        settings=_FakeSettings(),
    )
    assert out.dataset_version
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
                {
                    "tier": "static",
                    "generated_utc": datetime.datetime(2026, 6, 1, tzinfo=datetime.UTC),
                },
                {
                    "tier": "historic",
                    "generated_utc": datetime.datetime(2026, 6, 13, tzinfo=datetime.UTC),
                },
            ],
        }
    )
    out = build_manifest(conn, provider_id="stm", generated_utc="t", settings=_FakeSettings())
    assert out.files.static.generated_utc == "2026-06-01T00:00:00Z"
    assert out.files.historic.generated_utc == "2026-06-13T00:00:00Z"
    assert out.files.static.routes_prefix == "static/routes/"
    assert out.files.historic.receipts_index == "historic/receipts/index.json"


def test_build_manifest_tier_inventories_null_when_never_published() -> None:
    conn = FakeConn(_MANIFEST_PROVIDER_ROW)
    out = build_manifest(conn, provider_id="stm", generated_utc="t", settings=_FakeSettings())
    assert out.files.static.generated_utc is None
    assert out.files.historic.generated_utc is None


def test_build_manifest_basemap_null_without_provider_asset(monkeypatch) -> None:
    registry = ProviderRegistry.from_project_root()
    registry.get_provider("stm").public.basemap_url = None
    monkeypatch.setattr(ProviderRegistry, "from_project_root", lambda **kwargs: registry)
    conn = FakeConn(_MANIFEST_PROVIDER_ROW)
    out = build_manifest(
        conn, provider_id="stm", generated_utc="t", settings=_FakeSettingsWithBasemap()
    )
    assert out.basemap is None
    assert out.files.static.basemap is None


@pytest.mark.parametrize("provider_id", ["stm", "octranspo"])
def test_build_manifest_basemap_is_provider_owned(provider_id) -> None:
    conn = FakeConn(_MANIFEST_PROVIDER_ROW)
    out = build_manifest(
        conn, provider_id=provider_id, generated_utc="t", settings=_FakeSettingsWithBasemap()
    )
    assert out.basemap == f"https://data.example.com/v1/{provider_id}/static/basemap.json"
    assert out.files.static.basemap == "static/basemap.json"


def test_manifest_live_files_list_stop_departures() -> None:
    conn = FakeConn(_MANIFEST_PROVIDER_ROW)
    out = build_manifest(conn, provider_id="stm", generated_utc="t", settings=_FakeSettings())
    assert out.files.live.stop_departures == "live/stop_departures.json"


def test_build_labels_fr_includes_static_and_metric():
    from transit_ops.snapshots.builders import build_labels

    class FakeResult:
        def __init__(self, rows): self._rows = rows
        def mappings(self): return self
        def __iter__(self): return iter(self._rows)

    class FakeConn:
        def execute(self, *a, **k):
            return FakeResult(
                [
                    {
                        "label_key": "network_health",
                        "label_fr": "Santé du réseau",
                        "label_en": "Network Health",
                    },
                ]
            )

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
    from transit_ops.snapshots.builders import build_labels

    class FakeResult:
        def __init__(self, rows): self._rows = rows
        def mappings(self): return self
        def __iter__(self): return iter(self._rows)

    class FakeConn:
        def execute(self, *a, **k):
            return FakeResult([])

    for lang in ("fr", "en"):
        lf = build_labels(FakeConn(), lang=lang, generated_utc="t")
        for key in _METHODOLOGY_GAP_ATTR_KEYS:
            assert key in lf.labels, f"{key} missing in {lang}"
        assert "étro" in lf.labels["gap.metro_realtime.short"]
        assert "CC BY 4.0" in lf.labels["attribution.data_source"]

    en = build_labels(FakeConn(), lang="en", generated_utc="t")
    assert "early" in en.labels["methodology.otp_definition"]
    fr = build_labels(FakeConn(), lang="fr", generated_utc="t")
    assert "five minutes" in en.labels["methodology.otp_definition"]
    assert "one minute late" not in en.labels["methodology.otp_definition"]
    assert "cinq minutes" in fr.labels["methodology.otp_definition"]
    assert "une minute de retard" not in fr.labels["methodology.otp_definition"]
    assert "90 days" not in en.labels["methodology.percentiles"]
    assert "14 days" in en.labels["methodology.percentiles"]
    assert "90 derniers jours" not in fr.labels["methodology.percentiles"]
    assert "14 derniers jours" in fr.labels["methodology.percentiles"]
    assert "known-delay observations" in en.labels["methodology.otp_definition"]
    assert "observations au retard connu" in fr.labels["methodology.otp_definition"]
    assert "no delay was recorded" not in en.labels["methodology.otp_definition"]
    assert "trip-average" in en.labels["methodology.percentiles"]
    assert "moyens par trajet" in fr.labels["methodology.percentiles"]
    assert "STM" not in en.labels["methodology.delay_unit"]
    assert "STM" not in fr.labels["methodology.delay_unit"]


def test_build_labels_non_stm_derives_attribution_from_core_providers():
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
            return FakeResult([])

    fr = build_labels(FakeConn(), provider_id="sto", lang="fr", generated_utc="t")
    assert fr.labels["attribution.data_source"] == "Contains STO open data."
    assert "Outaouais" in fr.labels["attribution.disclaimer"]
    assert "gap.metro_realtime" not in fr.labels


def test_static_label_key_sets_identical_fr_en():
    from transit_ops.snapshots.builders.static import _STATIC_LABELS_EN, _STATIC_LABELS_FR

    assert set(_STATIC_LABELS_FR) == set(_STATIC_LABELS_EN)


def test_build_routes_index():
    from transit_ops.snapshots.builders import build_routes_index

    class _Result:
        def __init__(self, rows): self._rows = rows
        def mappings(self): return self
        def __iter__(self): return iter(self._rows)

    class FC:
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
    e = _stops_index_first()
    assert e.id == "51234"
    assert e.lat == 45.49123
    assert e.mode is None
    assert e.routes == []


def test_build_stops_index_mode_metro_wins_over_bus():
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
    served = ["100", "101", "102", "103", "104", "1"]
    e = _stops_index_first(
        routes_served_by_stop={"51234": served},
        route_type_by_id={r: 3 for r in served} | {"1": 1},
    )
    assert e.routes == ["100", "101", "102", "103", "104"]
    assert e.mode == "metro"


def test_build_stops_index_stop_absent_from_maps():
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
    assert _mode_from_route_types([3, 1, 3]) == "metro"
    assert _mode_from_route_types([0, 3]) == "tram"
    assert _mode_from_route_types([2, 3]) == "rail"
    assert _mode_from_route_types([4]) == "ferry"
    assert _mode_from_route_types([None, 3]) == "bus"
    assert _mode_from_route_types([99]) == "bus"


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
            return iter(self._rows)

        def fetchone(self):
            return self._rows[0] if self._rows else None

        def scalar_one(self):
            return self._rows[0] if self._rows else 0

    dispatch = [
        ("dataset_kind = 'static_schedule'", [{"dataset_version_id": 1}]),
        (
            "generate_series",
            [
                {
                    "weekday_date": datetime.date(2026, 6, 3),
                    "weekend_date": datetime.date(2026, 6, 6),
                }
            ],
        ),
        ("extract(isodow FROM :repdate)", [("svc_wd",)]),
        (
            "route_long_name, route_type FROM gold.dim_route",
            [{"route_long_name": "Côte-Vertu", "route_type": 3}],
        ),
        ("map_route_lines", [
            {"shape_id": "s1", "geojson": {"type": "LineString", "coordinates": []},
             "direction_id": 0, "trip_headsign": "Nord", "trip_count": 10}
        ]),
        ("DISTINCT ON (st.stop_sequence)", [
            {"stop_sequence": 1, "stop_id": "51234", "stop_name": "X"}
        ]),
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
    assert rf.type == 3
    assert len(rf.directions) >= 1
    assert rf.directions[0].dir == 0
    assert rf.directions[0].stops[0].id == "51234"
    assert rf.first_departure == "07:00"
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
        ("dataset_kind = 'static_schedule'", [{"dataset_version_id": 1}]),
        (
            "generate_series",
            [
                {
                    "weekday_date": datetime.date(2026, 6, 3),
                    "weekend_date": datetime.date(2026, 6, 6),
                }
            ],
        ),
        ("extract(isodow FROM :repdate)", [("svc_wd",)]),
        ("FROM gold.dim_stop", [
            {"stop_id": "51234", "stop_code": "51234", "stop_name": "X",
             "stop_lat": 45.49, "stop_lon": -73.66, "wheelchair_boarding": 1}
        ]),
        ("ANY(:weekday_services)", [
            {
                "stop_id": "51234",
                "route_id": "165",
                "trip_headsign": "Nord",
                "departure_time": "17:46:00",
            },
            {
                "stop_id": "51234",
                "route_id": "165",
                "trip_headsign": "Nord",
                "departure_time": "17:54:00",
            },
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
    assert sf.scheduled[0].times == ["17:46", "17:54"]


def test_static_builders_injected_context_matches_two_route_fallback_bytes() -> None:
    import datetime

    from transit_ops.snapshots.builders import build_all_stops_data, build_route
    from transit_ops.snapshots.builders._helpers import StaticScheduleContext
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    responses = {
        "static.dataset_version": [{"dataset_version_id": 1}],
        "static.rep_dates": [
            {
                "weekday_date": datetime.date(2026, 6, 3),
                "weekend_date": datetime.date(2026, 6, 6),
            }
        ],
        "static.active_services": [("svc",)],
        "static.route_name_type": [{"route_long_name": "Cote-Vertu", "route_type": 3}],
        "static.route_shapes": [
            {
                "shape_id": "shape-1",
                "geojson": {"type": "LineString", "coordinates": []},
                "direction_id": 0,
                "trip_headsign": "Nord",
                "trip_count": 2,
            }
        ],
        "static.route_stops": [
            {"stop_sequence": 1, "stop_id": "51234", "stop_name": "Cote-Vertu"}
        ],
        "static.route_schedule": [
            {"direction_id": 0, "is_weekday": True, "departure_time": "07:00:00"},
            {"direction_id": 0, "is_weekday": True, "departure_time": "07:08:00"},
            {"direction_id": 0, "is_weekday": False, "departure_time": "09:00:00"},
            {"direction_id": 0, "is_weekday": False, "departure_time": "09:12:00"},
        ],
        "static.all_stops": [
            {
                "stop_id": "51234",
                "stop_code": "51234",
                "stop_name": "Cote-Vertu",
                "stop_lat": 45.49,
                "stop_lon": -73.66,
                "wheelchair_boarding": 1,
            }
        ],
        "static.all_stop_schedules": [
            {
                "stop_id": "51234",
                "route_id": "165",
                "trip_headsign": "Nord",
                "departure_time": "17:46:00",
            },
            {
                "stop_id": "51234",
                "route_id": "165",
                "trip_headsign": "Nord",
                "departure_time": "17:54:00",
            },
        ],
    }
    context = StaticScheduleContext(
        dataset_version_id=1,
        weekday_services=("svc",),
        weekend_services=("svc",),
    )

    route_ids = ("165", "51")
    fallback_route_conn = FakeConn(responses)
    fallback_routes = {
        route_id: build_route(fallback_route_conn, route_id=route_id, generated_utc="t")
        for route_id in route_ids
    }
    injected_route_conn = FakeConn(responses)
    injected_routes = {
        route_id: build_route(
            injected_route_conn,
            route_id=route_id,
            generated_utc="t",
            static_context=context,
        )
        for route_id in route_ids
    }

    fallback_stops = build_all_stops_data(FakeConn(responses), generated_utc="t")
    injected_stops_conn = FakeConn(responses)
    injected_stops = build_all_stops_data(
        injected_stops_conn,
        generated_utc="t",
        static_context=context,
    )

    assert all(
        snapshot_json_bytes(injected_routes[route_id])
        == snapshot_json_bytes(fallback_routes[route_id])
        for route_id in route_ids
    )
    assert set(injected_stops) == set(fallback_stops)
    assert all(
        snapshot_json_bytes(injected_stops[stop_id])
        == snapshot_json_bytes(fallback_stops[stop_id])
        for stop_id in fallback_stops
    )
    context_queries = {
        "static.dataset_version",
        "static.rep_dates",
        "static.active_services",
    }
    assert context_queries.isdisjoint(map(query_name, injected_route_conn.executed))
    assert context_queries.isdisjoint(map(query_name, injected_stops_conn.executed))


class _StaticRouteRowsConn:

    def __init__(self, responses):  # noqa: ANN001
        self.responses = responses
        self.executed: list[object] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        self.executed.append(statement)
        name = query_name(statement)
        rows = list(self.responses.get(name, []))
        params = params or {}
        route_id = params.get("route_id")
        if route_id is not None and name in {
            "static.route_name_type",
            "static.route_shapes",
            "static.route_stops",
            "static.route_schedule",
        }:
            rows = [row for row in rows if str(row.get("route_id", route_id)) == str(route_id)]
        if name == "static.route_stops" and params.get("shape_id") is not None:
            rows = [row for row in rows if row.get("shape_id") == params["shape_id"]]
        return FakeResult(rows)


def _static_route_batch_fixture():  # noqa: ANN201
    from transit_ops.snapshots.builders._helpers import StaticScheduleContext

    metadata = [
        {"route_id": "R1", "route_long_name": "Alpha", "route_type": 3},
        {"route_id": "R2", "route_long_name": "Beta", "route_type": 0},
    ]
    shapes = [
        {
            "route_id": "R1",
            "shape_id": "r1-n",
            "geojson": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
            "direction_id": 0,
            "trip_headsign": "North",
            "trip_count": 9,
        },
        {
            "route_id": "R1",
            "shape_id": "r1-s",
            "geojson": {"type": "LineString", "coordinates": [[1, 1], [0, 0]]},
            "direction_id": 1,
            "trip_headsign": "South",
            "trip_count": 8,
        },
        {
            "route_id": "R1",
            "shape_id": "r1-n-less-used",
            "geojson": {"type": "LineString", "coordinates": [[9, 9], [10, 10]]},
            "direction_id": 0,
            "trip_headsign": "North",
            "trip_count": 1,
        },
        {
            "route_id": "R2",
            "shape_id": "r2",
            "geojson": {"type": "LineString", "coordinates": [[2, 2], [3, 3]]},
            "direction_id": 0,
            "trip_headsign": None,
            "trip_count": 3,
        },
    ]
    stops = [
        {
            "route_id": "R1",
            "shape_id": "r1-n",
            "stop_sequence": 1,
            "stop_id": "A",
            "stop_name": "A Stop",
        },
        {
            "route_id": "R1",
            "shape_id": "r1-n",
            "stop_sequence": 2,
            "stop_id": "B",
            "stop_name": "B Stop",
        },
        {
            "route_id": "R1",
            "shape_id": "r1-s",
            "stop_sequence": 1,
            "stop_id": "B",
            "stop_name": "B Stop",
        },
        {
            "route_id": "R1",
            "shape_id": "r1-s",
            "stop_sequence": 2,
            "stop_id": "A",
            "stop_name": "A Stop",
        },
        {"route_id": "R2", "shape_id": "r2", "stop_sequence": 1, "stop_id": "C", "stop_name": None},
    ]
    schedules = [
        {"route_id": "R1", "direction_id": 0, "is_weekday": True, "departure_time": "07:00:00"},
        {"route_id": "R1", "direction_id": 0, "is_weekday": True, "departure_time": "07:08:00"},
        {"route_id": "R1", "direction_id": 1, "is_weekday": True, "departure_time": "25:15:00"},
        {"route_id": "R1", "direction_id": 0, "is_weekday": False, "departure_time": "10:00:00"},
        {"route_id": "R1", "direction_id": 0, "is_weekday": False, "departure_time": "10:12:00"},
    ]
    return (
        StaticScheduleContext(
            dataset_version_id=42,
            weekday_services=("weekday",),
            weekend_services=("weekend",),
        ),
        metadata,
        shapes,
        stops,
        schedules,
    )


def _require_all_routes_builder():  # noqa: ANN201
    import transit_ops.snapshots.builders as builders

    candidate = getattr(builders, "build_all_routes_data", None)
    assert callable(candidate), (
        "build_all_routes_data must be exported before static batching can pass"
    )
    return candidate


def test_build_all_routes_data_matches_standalone_bytes_and_hashes() -> None:
    from transit_ops.snapshots.builders import build_route
    from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256

    build_all_routes_data = _require_all_routes_builder()
    context, metadata, shapes, stops, schedules = _static_route_batch_fixture()
    legacy_responses = {
        "static.route_name_type": metadata,
        "static.route_shapes": shapes,
        "static.route_stops": stops,
        "static.route_schedule": schedules,
    }
    legacy = {
        route_id: build_route(
            _StaticRouteRowsConn(legacy_responses),
            route_id=route_id,
            generated_utc="2026-07-21T00:00:00Z",
            static_context=context,
        )
        for route_id in ("R1", "R2")
    }
    batch_conn = _StaticRouteRowsConn(
        {
            "static.all_route_metadata": metadata,
            "static.all_route_shapes": shapes,
            "static.all_route_stops": stops,
            "static.all_route_schedules": schedules,
        }
    )

    batched = build_all_routes_data(
        batch_conn,
        generated_utc="2026-07-21T00:00:00Z",
        static_context=context,
    )

    assert list(batched) == ["R1", "R2"]
    assert {route_id: snapshot_sha256(route) for route_id, route in batched.items()} == {
        "R1": "64706af2758ddcec60e443a4c43d4df5ed8063530d7a3222ddec39dcb6cfd606",
        "R2": "bd9a76fd51d406683fb9e9581b2e66824d9ccbc476dbf358619378f6bc20a5f1",
    }
    for route_id in legacy:
        assert snapshot_json_bytes(batched[route_id]) == snapshot_json_bytes(legacy[route_id])
        assert snapshot_sha256(batched[route_id]) == snapshot_sha256(legacy[route_id])


@pytest.mark.parametrize("route_count", [2, 200])
def test_build_all_routes_data_uses_four_queries_independent_of_route_count(route_count) -> None:
    from transit_ops.snapshots.builders._helpers import StaticScheduleContext

    build_all_routes_data = _require_all_routes_builder()
    route_ids = [f"R{i:03d}" for i in range(route_count)]
    conn = _StaticRouteRowsConn(
        {
            "static.all_route_metadata": [
                {"route_id": route_id, "route_long_name": route_id, "route_type": 3}
                for route_id in route_ids
            ],
            "static.all_route_shapes": [
                {
                    "route_id": route_id,
                    "shape_id": f"shape-{route_id}",
                    "geojson": {"type": "LineString", "coordinates": []},
                    "direction_id": 0,
                    "trip_headsign": "Outbound",
                    "trip_count": 1,
                }
                for route_id in route_ids
            ],
            "static.all_route_stops": [
                {
                    "route_id": route_id,
                    "shape_id": f"shape-{route_id}",
                    "stop_sequence": 1,
                    "stop_id": f"stop-{route_id}",
                    "stop_name": route_id,
                }
                for route_id in route_ids
            ],
            "static.all_route_schedules": [],
        }
    )

    routes = build_all_routes_data(
        conn,
        generated_utc="t",
        static_context=StaticScheduleContext(dataset_version_id=42),
    )

    names = [query_name(statement) for statement in conn.executed]
    assert names == [
        "static.all_route_metadata",
        "static.all_route_shapes",
        "static.all_route_stops",
        "static.all_route_schedules",
    ]
    assert len(routes) == route_count
    assert {
        "static.route_name_type",
        "static.route_shapes",
        "static.route_stops",
        "static.route_schedule",
    }.isdisjoint(names)


def test_build_all_routes_data_groups_stop_rows_once_by_route() -> None:
    import inspect

    from transit_ops.snapshots.builders import build_all_routes_data

    source = inspect.getsource(build_all_routes_data)
    assert "stops_by_route_shape.items()" not in source
    assert 'stops_by_route[str(row["route_id"])]' in source


def test_route_stop_queries_share_one_deterministic_set_based_contract() -> None:
    from transit_ops.snapshots.builders.static import _ALL_ROUTE_STOPS_SQL, _ROUTE_STOPS_SQL

    standalone = " ".join(str(_ROUTE_STOPS_SQL).split())
    batched = " ".join(str(_ALL_ROUTE_STOPS_SQL).split())

    assert "ORDER BY st.stop_sequence, t.trip_id, st.stop_id" in standalone
    assert "LATERAL" not in batched
    assert (
        "PARTITION BY selected.route_id, selected.shape_id, st.stop_sequence" in batched
    )
    assert "ORDER BY t.trip_id, st.stop_id" in batched
    assert "WHERE duplicate_rank = 1" in batched
    assert "PARTITION BY route_id, shape_id ORDER BY stop_sequence" in batched
    assert "WHERE stop_rank <= 400" in batched


def test_build_all_routes_data_schedule_tie_is_input_order_invariant() -> None:
    from transit_ops.snapshots.builders._helpers import StaticScheduleContext
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    build_all_routes_data = _require_all_routes_builder()
    schedules = [
        {"route_id": "R1", "direction_id": 0, "is_weekday": True, "departure_time": "07:00:00"},
        {"route_id": "R1", "direction_id": 0, "is_weekday": True, "departure_time": "07:10:00"},
        {"route_id": "R1", "direction_id": 1, "is_weekday": True, "departure_time": "16:00:00"},
        {"route_id": "R1", "direction_id": 1, "is_weekday": True, "departure_time": "16:20:00"},
    ]

    def build(rows):  # noqa: ANN001, ANN202
        conn = _StaticRouteRowsConn(
            {
                "static.all_route_metadata": [
                    {"route_id": "R1", "route_long_name": "Route 1", "route_type": 3}
                ],
                "static.all_route_shapes": [],
                "static.all_route_stops": [],
                "static.all_route_schedules": rows,
            }
        )
        return build_all_routes_data(
            conn,
            generated_utc="t",
            static_context=StaticScheduleContext(dataset_version_id=42),
        )["R1"]

    forward = build(schedules)
    reverse = build(list(reversed(schedules)))

    assert snapshot_json_bytes(forward) == snapshot_json_bytes(reverse)
    assert [period.shift for period in forward.service_periods] == ["am_peak"]


@pytest.mark.parametrize(
    "dataset_version_id, metadata",
    [(42, []), (None, [{"route_id": "R1", "route_long_name": "ignored", "route_type": 3}])],
)
def test_build_all_routes_data_empty_or_unavailable_uses_one_query(
    dataset_version_id, metadata
) -> None:
    from transit_ops.snapshots.builders import build_route
    from transit_ops.snapshots.builders._helpers import StaticScheduleContext
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    build_all_routes_data = _require_all_routes_builder()
    context = StaticScheduleContext(dataset_version_id=dataset_version_id)
    conn = _StaticRouteRowsConn({"static.all_route_metadata": metadata})

    routes = build_all_routes_data(conn, generated_utc="t", static_context=context)

    assert [query_name(statement) for statement in conn.executed] == ["static.all_route_metadata"]
    if dataset_version_id is None:
        expected = build_route(
            _StaticRouteRowsConn({}), route_id="R1", generated_utc="t", static_context=context
        )
        assert list(routes) == ["R1"]
        assert snapshot_json_bytes(routes["R1"]) == snapshot_json_bytes(expected)
    else:
        assert routes == {}


def test_build_all_routes_data_keeps_the_400_stop_branch_cap() -> None:
    from transit_ops.snapshots.builders._helpers import StaticScheduleContext

    build_all_routes_data = _require_all_routes_builder()
    conn = _StaticRouteRowsConn(
        {
            "static.all_route_metadata": [
                {"route_id": "R1", "route_long_name": "Route 1", "route_type": 3}
            ],
            "static.all_route_shapes": [
                {
                    "route_id": "R1",
                    "shape_id": "shape-1",
                    "geojson": {"type": "LineString", "coordinates": []},
                    "direction_id": 0,
                    "trip_headsign": None,
                    "trip_count": 1,
                }
            ],
            "static.all_route_stops": [
                {
                    "route_id": "R1",
                    "shape_id": "shape-1",
                    "stop_sequence": sequence,
                    "stop_id": f"S{sequence}",
                    "stop_name": None,
                }
                for sequence in range(1, 406)
            ],
            "static.all_route_schedules": [],
        }
    )

    routes = build_all_routes_data(
        conn,
        generated_utc="t",
        static_context=StaticScheduleContext(dataset_version_id=42),
    )

    assert len(routes["R1"].directions[0].stops) == 400
    assert routes["R1"].directions[0].stops[-1].seq == 400


def test_build_route_public_signature_is_unchanged() -> None:
    import inspect

    from transit_ops.snapshots.builders import build_route

    assert str(inspect.signature(build_route)) == (
        "(conn: 'Connection', *, provider_id: 'str' = 'stm', route_id: 'str', "
        "generated_utc: 'str', static_context: 'StaticScheduleContext | None' = None) "
        "-> \"'RouteFile'\""
    )


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

    prov = build_provenance(FakeConn({}), "stm", generated_utc="H")

    assert prov.conformance is None


def test_build_alert_history_sanitizes_legacy_python_repr_en_text() -> None:
    import datetime

    from transit_ops.snapshots.builders import build_alert_history

    conn = FakeConn(
        {
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


def test_build_basemap_none_without_url() -> None:
    from transit_ops.snapshots.builders import build_basemap

    assert build_basemap(
        _FakeSettingsWithBasemap(), public=ProviderPublicConfig(), generated_utc="t"
    ) is None


@pytest.mark.parametrize("provider_id,city", [("stm", "montreal"), ("octranspo", "ottawa")])
def test_build_basemap_pointer_carries_provider_url_style_attribution(provider_id, city) -> None:
    from transit_ops.snapshots.builders import build_basemap

    class _S:
        SNAPSHOT_BASEMAP_PMTILES_URL = "https://x/quebec.pmtiles"
        SNAPSHOT_BASEMAP_STYLE_URL = "https://x/style.json"
        SNAPSHOT_BASEMAP_ATTRIBUTION = "© OSM, © Protomaps"

    public = ProviderRegistry.from_project_root().get_provider(provider_id).public
    bm = build_basemap(_S(), public=public, generated_utc="2026-06-13T00:00:00Z")
    assert bm is not None
    assert bm.format == "pmtiles"
    assert bm.url == f"/data/v1/{provider_id}/static/basemap/{city}.pmtiles"
    assert bm.style_url == "https://x/style.json"
    assert bm.attribution == "© OSM, © Protomaps"
    assert bm.generated_utc == "2026-06-13T00:00:00Z"


def test_build_stop_reliability_emits_shift_and_daytype_grains() -> None:
    from transit_ops.snapshots.builders.historic import build_stop_reliability

    grain_rows = [
        {"stop_id": "51234", "grain": "am_peak", "obs": 10, "severe": 1,
         "weighted_delay_sec": 600.0},
        {"stop_id": "51234", "grain": "night", "obs": 4, "severe": 0,
         "weighted_delay_sec": 480.0},
        {"stop_id": "51234", "grain": "weekday", "obs": 14, "severe": 1,
         "weighted_delay_sec": 1080.0},
        {"stop_id": "51234", "grain": "weekend", "obs": 0, "severe": 0,
         "weighted_delay_sec": None},
    ]

    dow_rows = [
        {"stop_id": "51234", "day_of_week_iso": 1, "dow_obs": 20, "severe": 2,
         "weighted_delay_sec": 1200.0},
        {"stop_id": "51234", "day_of_week_iso": 3, "dow_obs": 10, "severe": 0,
         "weighted_delay_sec": 1200.0},
        {"stop_id": "51234", "day_of_week_iso": 7, "dow_obs": 0, "severe": 0,
         "weighted_delay_sec": None},
    ]

    import datetime as _dt
    _anchor = _dt.date(2026, 6, 30)
    dispatch = [
        ("'__unrouted__'", []),
        ("AS banded", grain_rows),
        ("AS dow_obs", dow_rows),
        ("FROM gold.stop_delay_hourly", []),
        ("stop_delay_percentile_daily", []),
        ("stop_occupancy_band_daily AS sob", [
            {"stop_id": "51234", "empty": 0, "many_seats": 50,
             "few_seats": 0, "standing": 25, "full": 25},
        ]),
        ("stop_name", [{"stop_id": "51234", "stop_name": "Berri-UQAM"}]),
    ]
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
    by_grain = {p.grain: p for p in out["51234"].periods}

    assert "week" in by_grain
    assert {"am_peak", "night", "weekday", "weekend"} <= set(by_grain)

    am = by_grain["am_peak"]
    assert am.avg_delay_min == 1.0
    assert am.severe_pct == 10.0
    assert am.otp_pct == 90

    night = by_grain["night"]
    assert night.avg_delay_min == 2.0
    assert night.otp_pct == 100
    assert night.severe_pct == 0.0

    weekday = by_grain["weekday"]
    assert weekday.avg_delay_min == 1.3

    weekend = by_grain["weekend"]
    assert weekend.otp_pct is None
    assert weekend.avg_delay_min is None
    assert weekend.severe_pct is None

    dow = {d.day_of_week_iso: d for d in out["51234"].day_of_week}
    assert [d.day_of_week_iso for d in out["51234"].day_of_week] == [1, 3, 7]

    mon = dow[1]
    assert mon.avg_delay_min == 1.0
    assert mon.severe_pct == 10.0
    assert mon.observation_count == 20

    wed = dow[3]
    assert wed.avg_delay_min == 2.0
    assert wed.severe_pct == 0.0
    assert wed.observation_count == 10

    sun = dow[7]
    assert sun.avg_delay_min is None
    assert sun.severe_pct is None
    assert sun.observation_count is None

    mix = out["51234"].occupancy_mix
    assert mix is not None
    assert mix.empty == 0.0
    assert mix.many_seats == 0.5
    assert mix.standing == 0.25
    assert mix.full == 0.25
    assert mix.few_seats == 0.0


def test_build_stop_reliability_occupancy_mix_none_when_no_telemetry() -> None:
    import datetime as _dt

    from transit_ops.snapshots.builders.historic import build_stop_reliability

    _anchor = _dt.date(2026, 6, 30)
    dispatch = [
        ("'__unrouted__'", []),
        ("AS banded", []),
        ("AS dow_obs", []),
        ("FROM gold.stop_delay_hourly", []),
        ("stop_delay_percentile_daily", []),
        ("stop_occupancy_band_daily AS sob", []),
        ("stop_name", [{"stop_id": "51234", "stop_name": "Berri-UQAM"}]),
    ]
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
    assert out["51234"].occupancy_mix is None


def test_build_network_trend_emits_week_and_month_grain_series() -> None:
    import datetime

    from transit_ops.snapshots.builders.historic import build_network_trend

    week_hourly = [
        {"local_date": datetime.date(2026, 6, 8), "known_obs": 200, "on_time": 150,
         "pooled_delay_sec": 24000.0, "inclamp_obs": 200},
        {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
         "pooled_delay_sec": 6000.0, "inclamp_obs": 100},
    ]
    week_cancel = [
        {"local_date": datetime.date(2026, 6, 1), "canceled": 3, "total": 120,
         "delivered": 117, "scheduled": 130},
    ]
    week_occupancy = [
        {"local_date": datetime.date(2026, 6, 1), "empty": 0, "many_seats": 50,
         "few_seats": 30, "standing": 15, "full": 5},
    ]
    month_hourly = [
        {"local_date": datetime.date(2026, 6, 1), "known_obs": 1000, "on_time": 820,
         "pooled_delay_sec": 90000.0, "inclamp_obs": 1000},
    ]
    month_cancel = [
        {"local_date": datetime.date(2026, 6, 1), "canceled": 12, "total": 600,
         "delivered": 588, "scheduled": 600},
    ]
    month_occupancy = [
        {"local_date": datetime.date(2026, 6, 1), "empty": 10, "many_seats": 40,
         "few_seats": 30, "standing": 15, "full": 5},
    ]

    dispatch = {
        "network.trend.week_hourly": week_hourly,
        "network.trend.week_cancel": week_cancel,
        "network.trend.week_occupancy": week_occupancy,
        "network.trend.month_hourly": month_hourly,
        "network.trend.month_cancel": month_cancel,
        "network.trend.month_occupancy": month_occupancy,
    }

    class FC:
        def execute(self, statement, params=None):  # noqa: ANN001, ANN201, ARG002
            return FakeResult(dispatch.get(query_name(statement), []))

    out = build_network_trend(FC(), provider_id="stm", generated_utc="t")

    assert [p.date for p in out.weekly] == ["2026-06-01", "2026-06-08"]
    w0, w1 = out.weekly
    assert w0.otp_pct == 90
    assert w0.avg_delay_min == 1.0
    assert w0.cancellation_rate == 2.5
    assert w0.service_completeness_rate == 90.0
    assert w0.occupancy_mix is not None
    assert w0.occupancy_mix.many_seats == 0.5
    assert w0.p90_min is None
    assert w0.vehicles is None
    assert w1.otp_pct == 75
    assert w1.avg_delay_min == 2.0
    assert w1.cancellation_rate is None
    assert w1.service_completeness_rate is None
    assert w1.occupancy_mix is None
    assert w1.p90_min is None
    assert w1.vehicles is None

    assert [p.date for p in out.monthly] == ["2026-06-01"]
    m0 = out.monthly[0]
    assert m0.otp_pct == 82
    assert m0.avg_delay_min == 1.5
    assert m0.cancellation_rate == 2.0
    assert m0.service_completeness_rate == 98.0
    assert m0.occupancy_mix is not None
    assert m0.occupancy_mix.empty == 0.1
    assert m0.p90_min is None
    assert m0.vehicles is None
