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
    build_trips,
    build_vehicles,
)
from transit_ops.snapshots.contract import (
    AlertsFile,
    Manifest,
    NetworkFile,
    TripsFile,
    VehiclesFile,
)


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

    def scalar_one(self):  # noqa: ANN201
        # First column of the first row, mirroring SQLAlchemy semantics.
        first = self._rows[0]
        if isinstance(first, dict):
            return next(iter(first.values()))
        return first


class FakeConn:
    """Dispatches canned result sets by matching substrings in the SQL.

    ``responses`` maps a substring that uniquely identifies a query to the
    list of rows that query should return.  Order-independent, which keeps
    multi-query builders (network, manifest) readable.
    """

    def __init__(self, responses):  # noqa: ANN001
        self._responses = responses
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        sql = str(statement)
        self.executed.append(sql)
        for needle, rows in self._responses.items():
            if needle in sql:
                return FakeResult(rows)
        return FakeResult([])


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
            "current_trip_delay_computed": [
                {
                    "trip_id": "T-1",
                    "route_id": "51",
                    "avg_delay_seconds": 130.0,  # -> 2 min
                },
                {
                    "trip_id": "T-2",
                    "route_id": "97",
                    "avg_delay_seconds": -200.0,  # early -> -3 min
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

    out = build_trips(conn, provider_id="stm")

    assert isinstance(out, TripsFile)
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
                    "severity": "warning",
                    "cause": "ACCIDENT",
                    "effect": "DETOUR",
                    "route_ids": "1, 4, 51",
                    "stop_ids": "S-1, S-2",
                    "active_period_start_utc": "2026-05-31T08:00:00Z",
                    "active_period_end_utc": "2026-05-31T20:00:00Z",
                },
                {
                    "alert_id": None,  # no id -> synthesize a CONTENT hash
                    "alert_header_text": "Major closure",
                    "description_text": "Major closure desc",
                    "severity": "severe",
                    "cause": "CONSTRUCTION",
                    "effect": "NO_SERVICE",
                    "route_ids": None,
                    "stop_ids": None,
                    "active_period_start_utc": None,
                    "active_period_end_utc": None,
                },
            ]
        }
    )

    out = build_alerts(conn, provider_id="stm")

    assert isinstance(out, AlertsFile)
    assert len(out.alerts) == 2
    a1 = out.alerts[0]
    assert a1.id == "A-1"
    assert a1.severity == "high"  # warning -> high
    assert a1.header_key == "Service disruption line 1"
    assert a1.routes == ["1", "4", "51"]
    assert a1.stops == ["S-1", "S-2"]
    assert a1.start_utc == "2026-05-31T08:00:00Z"
    assert a1.end_utc == "2026-05-31T20:00:00Z"
    a2 = out.alerts[1]
    assert a2.severity == "critical"  # severe -> critical
    assert a2.routes == []
    assert a2.stops == []
    # id is a content hash: "stm-alert-<sha1[:12]>" of "desc|sev|cause|effect"
    basis = "Major closure desc|severe|CONSTRUCTION|NO_SERVICE"
    expected_id = "stm-alert-" + hashlib.sha1(basis.encode()).hexdigest()[:12]
    assert a2.id == expected_id
    # same input -> same id (stable across calls)
    out2 = build_alerts(conn, provider_id="stm")
    assert out2.alerts[1].id == expected_id
    assert a2.start_utc is None


def test_build_alerts_unknown_severity_falls_back_to_watch() -> None:
    conn = FakeConn(
        {
            "current_i3_alerts": [
                {
                    "alert_id": "A-info",
                    "alert_header_text": "FYI",
                    "description_text": None,
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
    out = build_alerts(conn)
    assert out.alerts[0].severity == "watch"
    assert out.alerts[0].routes == []


# --------------------------------------------------------------------------
# 6d — build_network
# --------------------------------------------------------------------------


def test_build_network_aggregates_kpis() -> None:
    # 5 vehicles: 2 on_time, 1 late, 1 severe, 1 unknown
    # known = 5 - 1 unknown = 4
    # on_time_pct = round(100 * 2 / 4) = 50
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
            "non_responding_current": [{"non_responding": 7}],
            "feed_freshness_current": [{"feed_freshness_s": 12}],
        }
    )

    out = build_network(conn, provider_id="stm")

    assert isinstance(out, NetworkFile)
    assert out.vehicles_in_service == 5
    assert out.status_dist.on_time == 2
    assert out.status_dist.late == 1
    assert out.status_dist.severe == 1
    assert out.status_dist.unknown == 1
    # on_time_pct: round(100 * on_time / known) where known = 5 - 1 unknown = 4
    assert out.on_time_pct == 50  # round(100 * 2 / 4)
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


def test_build_network_guards_zero_vehicles() -> None:
    conn = FakeConn(
        {
            "current_vehicle_map_with_status": [],
            "current_trip_delay_computed": [],
            # COALESCE(SUM/MAX, 0) aggregates always return one row, even on
            # empty source tables — model that faithfully.
            "non_responding_current": [{"non_responding": 0}],
            "feed_freshness_current": [{"feed_freshness_s": 0}],
        }
    )
    out = build_network(conn)
    assert out.vehicles_in_service == 0
    assert out.on_time_pct == 0
    assert out.delay_p50_min == 0
    assert out.delay_p90_min == 0
    assert out.coverage_pct == 0
    assert out.non_responding == 0
    assert out.feed_freshness_s == 0


# --------------------------------------------------------------------------
# 6e — build_manifest
# --------------------------------------------------------------------------


class _FakeSettings:
    SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"


def test_build_manifest_assembles_from_provider_and_version() -> None:
    conn = FakeConn(
        {
            "gold.dim_provider": [
                {
                    "provider_id": "stm",
                    "display_name": "Societe de transport de Montreal",
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
    assert out.display_name == "Societe de transport de Montreal"
    assert out.tz == "America/Toronto"
    assert out.default_lang == "fr"
    assert out.attribution == "Contains STM data made available under CC BY 4.0."
    assert out.bbox == [-74.1, 45.25, -73.2, 45.75]  # [minLon, minLat, maxLon, maxLat]
    assert out.dataset_version == "2026-05-29-stm"
    assert out.basemap.startswith("https://data.example.com")
    assert out.files.live.generated_utc == "2026-05-31T12:00:05Z"
    assert out.labels == {"fr": "labels/fr.json", "en": "labels/en.json"}
    assert "live_map" in out.surfaces
    assert "data_trust" in out.surfaces


def test_build_manifest_defaults_when_version_missing() -> None:
    conn = FakeConn(
        {
            "gold.dim_provider": [
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

    lf = build_labels(FakeConn(), lang="fr")
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

    lf = build_labels(FakeConn(), lang="en")
    assert lf.labels["status.on_time"] == "On time"
    assert lf.labels["occupancy.few_seats"] == "Few seats available"


def test_build_routes_index():
    from transit_ops.snapshots.builders import build_routes_index

    class FR:
        def mappings(self): return self
        def __iter__(self): return iter([
            {"route_id": "165", "route_short_name": "165", "route_long_name": "Côte-Vertu",
             "route_color": "009EE0", "route_type": 3},
        ])
    class FC:
        def execute(self, *a, **k): return FR()

    idx = build_routes_index(FC())
    assert idx.routes[0].id == "165"
    assert idx.routes[0].type == 3

def test_build_stops_index():
    from transit_ops.snapshots.builders import build_stops_index

    class FR:
        def mappings(self): return self
        def __iter__(self): return iter([
            {"stop_id": "51234", "stop_code": "51234", "stop_name": "Côte-Vertu / Décarie",
             "stop_lat": 45.4912345, "stop_lon": -73.6612345},
        ])
    class FC:
        def execute(self, *a, **k): return FR()

    idx = build_stops_index(FC())
    assert idx.stops[0].id == "51234"
    assert idx.stops[0].lat == 45.49123  # rounded 5dp


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
        # route long name
        ("route_long_name FROM gold.dim_route", [{"route_long_name": "Côte-Vertu"}]),
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

    rf = build_route(FC(), route_id="165")
    assert rf.id == "165"
    assert rf.long == "Côte-Vertu"
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

    result = build_all_stops_data(FC())
    assert "51234" in result
    sf = result["51234"]
    assert sf.wheelchair is True
    assert "165" in sf.routes_served
    # times are wall-clock "HH:MM" and de-duplicated
    assert sf.scheduled[0].times == ["17:46", "17:54"]
