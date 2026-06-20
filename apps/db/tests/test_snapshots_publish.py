"""Tests for the publish_snapshot orchestrator (live tier).

Uses a fake engine/connection that returns empty results for every builder
query so each builder produces a valid empty/default model without touching
a real database.

Key coverage:
  - All 5 files are uploaded in the correct order (manifest last).
  - PublishResult carries provider_id, tier, and keys_written.
  - Unimplemented tiers raise ValueError.
"""

from __future__ import annotations

from contextlib import contextmanager

import pytest

from transit_ops.snapshots.publish import (
    _DISTINCT_HISTORIC_ROUTE_IDS_SQL,
    PublishResult,
    publish_snapshot,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeResult:
    """Mimics SQLAlchemy's result object.

    Supports:
    - ``.mappings()`` — returns self (iterable, yields zero rows)
    - ``__iter__``     — yields nothing (empty result set)
    - ``.scalar_one()``— returns 0  (scalar aggregates, e.g. non_responding)
    - ``.scalar()``    — returns 0  (alternate scalar accessor)

    build_network uses scalar_one() for non_responding and freshness queries;
    all other builders iterate .mappings().  build_manifest iterates .mappings()
    via next(iter(...)) which safely returns None on an empty result.
    """

    def mappings(self) -> "FakeResult":
        return self

    def __iter__(self):
        return iter([])  # no rows -> builders produce empty/default models

    def scalar_one(self) -> int:
        return 0

    def scalar(self) -> int:
        return 0


class FakeConn:
    """Connection that returns FakeResult for every execute() call."""

    def execute(self, *args, **kwargs) -> FakeResult:  # noqa: ANN002, ANN003
        return FakeResult()


class FakeEngine:
    """Engine whose begin() context-manager yields a FakeConn."""

    def begin(self):  # noqa: ANN201
        @contextmanager
        def _cm():
            yield FakeConn()

        return _cm()


class FakeStore:
    """Live-tier storage backend: records rel_keys and returns them.

    Used for the live tier only, which is NOT hash-gated; this fake deliberately
    omits get_json so any accidental gating of the live path fails loudly.
    """

    def __init__(self) -> None:
        self.keys: list[str] = []
        self.tiers: list[str] = []

    def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:
        self.keys.append(rel_key)
        self.tiers.append(tier)
        return rel_key


class StatefulFakeStore:
    """Hash-gate-compatible in-memory store (get_json / put_bytes / full_key).

    ``keys`` records put_json keys (compat with old assertions); ``store`` keeps
    the raw bytes so a HashGatedStorage second pass can read prior state.
    """

    def __init__(self) -> None:
        self.keys: list[str] = []
        self.store: dict[str, bytes] = {}
        self.get_json_calls: list[str] = []

    def full_key(self, rel_key: str) -> str:
        return rel_key

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
        self.store[rel_key] = body
        return rel_key

    def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:
        from transit_ops.snapshots.storage import _body

        self.keys.append(rel_key)
        self.store[rel_key] = _body(payload)
        return rel_key

    def get_json(self, rel_key: str):
        import json as _json

        self.get_json_calls.append(rel_key)
        raw = self.store.get(rel_key)
        return _json.loads(raw) if raw is not None else None


class FakeSettings:
    """Minimal settings stub exposing what builders and storage need."""

    SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_publish_live_uploads_all_files_manifest_last() -> None:
    """All 6 live files are written, manifest.json is LAST, and every PUT is
    tier='live' (slice-9.1.1q added live/stop_departures.json before manifest)."""
    store = FakeStore()
    res = publish_snapshot(
        "stm",
        tier="live",
        settings=FakeSettings(),
        engine=FakeEngine(),
        storage=store,
    )

    expected_keys = [
        "live/vehicles.json",
        "live/trips.json",
        "live/alerts.json",
        "live/network.json",
        "live/stop_departures.json",
        "manifest.json",
    ]
    assert store.keys == expected_keys, f"got {store.keys}"
    assert store.keys[-1] == "manifest.json"
    # stop_departures is uploaded before the manifest (manifest-last invariant)
    assert store.keys.index("live/stop_departures.json") < store.keys.index("manifest.json")
    # every live PUT (manifest included) carries tier='live'
    assert store.tiers == ["live"] * len(expected_keys)

    # PublishResult fields
    assert isinstance(res, PublishResult)
    assert res.provider_id == "stm"
    assert res.tier == "live"
    assert res.keys_written == expected_keys


def test_publish_result_display_dict() -> None:
    """display_dict() exposes all three fields."""
    store = FakeStore()
    res = publish_snapshot(
        "stm",
        tier="live",
        settings=FakeSettings(),
        engine=FakeEngine(),
        storage=store,
    )
    d = res.display_dict()
    assert d["provider_id"] == "stm"
    assert d["tier"] == "live"
    assert isinstance(d["keys_written"], list)
    assert len(d["keys_written"]) == 6


def test_publish_rejects_unimplemented_tier() -> None:
    """Unknown tiers raise ValueError."""
    with pytest.raises(ValueError, match="unknown tier"):
        publish_snapshot(
            "stm",
            tier="unknown_tier",
            settings=FakeSettings(),
            engine=FakeEngine(),
            storage=FakeStore(),
        )


def test_publish_accepts_registry_kwarg() -> None:
    """registry= is accepted without error (signature-compat with callers)."""
    store = FakeStore()
    res = publish_snapshot(
        "stm",
        tier="live",
        settings=FakeSettings(),
        engine=FakeEngine(),
        storage=store,
        registry=object(),  # should be silently ignored
    )
    assert res.tier == "live"
    assert len(store.keys) == 6


def test_publish_static_writes_expected_keys() -> None:
    """Static tier writes indexes, labels, per-route and per-stop files.

    Uses a SQL-text-dispatching fake connection so it is robust to changes
    in query ordering within build_route / build_all_stops_data.
    """
    import datetime
    from contextlib import contextmanager

    class _FakeResult:
        def __init__(self, rows):
            self._rows = list(rows)

        def mappings(self):
            outer = self

            class M:
                def fetchone(self):
                    return outer._rows[0] if outer._rows else None

                def __iter__(self):
                    return iter(outer._rows)

            return M()

        def __iter__(self):
            # active-services query iterates row[0]
            return iter(self._rows)

        def fetchone(self):
            return self._rows[0] if self._rows else None

        def fetchall(self):
            # used by _publish_static for the route_ids loop: returns list of tuples
            result = []
            for r in self._rows:
                if isinstance(r, dict):
                    result.append(tuple(r.values()))
                elif isinstance(r, tuple):
                    result.append(r)
                else:
                    result.append((r,))
            return result

        def scalar_one(self):
            return self._rows[0] if self._rows else 0

    # Dispatch table: (substring, rows) — first match wins.
    # Covers every query issued by build_routes_index, build_stops_index,
    # build_labels, the route_ids SELECT, build_route, and build_all_stops_data.
    dispatch = [
        # routes index
        ("route_sort_order", [
            {"route_id": "165", "route_short_name": "165", "route_long_name": "Côte-Vertu",
             "route_color": "009EE0", "route_type": 3}
        ]),
        # stops index (uses aliased "s.location_type" — unique discriminator)
        ("s.location_type", [
            {"stop_id": "51234", "stop_code": "51234", "stop_name": "Côte-Vertu",
             "stop_lat": 45.49, "stop_lon": -73.66}
        ]),
        # labels
        ("report_labels", [
            {"label_key": "network_health", "label_fr": "Santé", "label_en": "Health"}
        ]),
        # route_ids for per-route loop in _publish_static
        ("SELECT route_id FROM gold.dim_route WHERE provider_id", [
            {"route_id": "165"}
        ]),
        # dataset version (both build_route and build_all_stops_data use this)
        ("dataset_kind = 'static_schedule'", [{"dataset_version_id": 1}]),
        # rep-dates
        ("generate_series", [
            {"weekday_date": datetime.date(2026, 6, 3), "weekend_date": datetime.date(2026, 6, 6)}
        ]),
        # active-services (returns tuples for row[0] iteration)
        ("extract(isodow FROM :repdate)", [("svc_wd",)]),
        # route long name
        ("route_long_name FROM gold.dim_route", [{"route_long_name": "Côte-Vertu"}]),
        # route shapes (empty → no directions → no stop-sequence queries)
        ("map_route_lines", []),
        # route schedule
        ("st.stop_sequence     = 1", []),
        # all stops (build_all_stops_data) — "wheelchair_boarding" is unique discriminator
        # empty → no stop files written
        ("wheelchair_boarding", []),
        # all stop schedules
        ("ANY(:weekday_services)", []),
    ]

    # _static_stamp SELECTs loaded_at_utc from the same table — give it a row
    # (more specific needle must precede the generic dataset_kind entry).
    import datetime as _dt
    dispatch.insert(0, (
        "loaded_at_utc FROM core.dataset_versions",
        [{"loaded_at_utc": _dt.datetime(2026, 6, 1, 0, 0, tzinfo=_dt.timezone.utc)}],
    ))

    class FC:
        def execute(self, statement, params=None):
            s = str(statement)
            for needle, rows in dispatch:
                if needle in s:
                    return _FakeResult(rows)
            return _FakeResult([])

    class FakeEngine2:
        def begin(self):
            @contextmanager
            def _cm():
                yield FC()

            return _cm()

    store = StatefulFakeStore()
    res = publish_snapshot(
        "stm",
        tier="static",
        settings=FakeSettings(),
        engine=FakeEngine2(),
        storage=store,
    )

    assert isinstance(res, PublishResult)
    assert res.tier == "static"
    assert res.provider_id == "stm"
    written = set(res.keys_written)
    assert "static/routes_index.json" in written
    assert "static/stops_index.json" in written
    assert "labels/fr.json" in written
    assert "labels/en.json" in written
    assert "static/routes/165.json" in written
    # no stop files since build_all_stops_data got empty stops
    assert not any(k.startswith("static/stops/") for k in written)
    # no basemap without SNAPSHOT_BASEMAP_PMTILES_URL on FakeSettings
    assert "static/basemap.json" not in written
    # the hash-state object lands under _meta/ (internal tier), not in keys_written
    assert "_meta/publish_state_static.json" in store.store
    # all data files carry the dataset loaded_at stamp, not upload time
    import json as _json
    ri = _json.loads(store.store["static/routes_index.json"])
    assert ri["generated_utc"] == "2026-06-01T00:00:00Z"


def test_publish_historic_writes_expected_keys(tmp_path) -> None:
    """Historic tier writes network_trend, hotspots, repeat_offenders, alert_history,
    provenance (top-level), per-route reliability, per-stop reliability and receipts.

    Uses a SQL-text-dispatching fake connection and LocalSnapshotStorage into
    tmp_path so all files are written to disk.  At least one file is parsed back
    through its contract model for round-trip validation.
    """
    import datetime
    from contextlib import contextmanager

    from transit_ops.snapshots.publish import _publish_historic
    from transit_ops.snapshots.storage import LocalSnapshotStorage
    from transit_ops.snapshots.contract import NetworkTrend

    class _FakeResult:
        def __init__(self, rows):
            self._rows = list(rows)

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

        def fetchall(self):
            result = []
            for r in self._rows:
                if isinstance(r, dict):
                    result.append(tuple(r.values()))
                elif isinstance(r, tuple):
                    result.append(r)
                else:
                    result.append((r,))
            return result

        def scalar_one(self):
            return self._rows[0] if self._rows else 0

    # Dispatch table: (substring, rows) — first match wins.
    # Covers every query issued by all 8 historic builders.
    # Ordering matters when two queries share a common substring; the more
    # specific discriminator must appear first in the list.
    dispatch = [
        # build_receipts: network daily — unique discriminator "interval '31 days'"
        # (must precede the generic 'route_delay_hourly' entry)
        ("interval '31 days'", [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
             "severe": 5, "weighted_delay_sec": 5000},
        ]),
        # build_network_trend: daily OTP from hourly rollup — "interval '90 days'"
        ("interval '90 days'", [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
             "weighted_delay_sec": 5000},
        ]),
        # build_network_trend: p90 from fact table
        ("fact_trip_delay_snapshot", [
            {"local_date": datetime.date(2026, 6, 1), "p90_min": 3.5, "vehicles": 42},
        ]),
        # build_network_trend: WEEK + MONTH grain re-aggregation of the daily
        # sources. Unique `-- trend:<grain>:<source>` marker comments keep each of
        # the 6 bucketed queries dispatched to its own canned row-set (no collision
        # with the daily hourly/cancel/occupancy queries, which lack the marker).
        ("trend:week:hourly", [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 200, "on_time": 180,
             "weighted_delay_sec": 12000},
        ]),
        ("trend:week:cancel", [
            {"local_date": datetime.date(2026, 6, 1), "canceled": 4, "total": 200},
        ]),
        ("trend:week:occupancy", [
            {"local_date": datetime.date(2026, 6, 1), "empty": 0, "many_seats": 60,
             "few_seats": 25, "standing": 10, "full": 5},
        ]),
        ("trend:month:hourly", [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 1000, "on_time": 820,
             "weighted_delay_sec": 90000},
        ]),
        ("trend:month:cancel", [
            {"local_date": datetime.date(2026, 6, 1), "canceled": 12, "total": 600},
        ]),
        ("trend:month:occupancy", [
            {"local_date": datetime.date(2026, 6, 1), "empty": 10, "many_seats": 40,
             "few_seats": 30, "standing": 15, "full": 5},
        ]),
        # build_hotspots
        ("repeated_problem_route_stop", [
            {"entity_kind": "route", "entity_id": "165", "issue_count": 5,
             "severity_label": "high"},
        ]),
        # build_repeat_offenders
        ("repeat_offender_daily", [
            {"entity_kind": "route", "entity_id": "165", "route_id": "165",
             "recurrence_days": 7, "window_days": 30, "avg_delay_seconds": 180,
             "severity_label": "high"},
        ]),
        # build_alert_history
        ("i3_alert_history_reporting", [
            {"alert_header_text": "Votre ligne", "header_text_en": None,
             "alert_id": None, "severity": "WARNING",
             "routes": ["165"], "stops": ["51234"],
             "start_utc": datetime.datetime(2026, 6, 1, 8, 0, tzinfo=datetime.timezone.utc),
             "end_utc": datetime.datetime(2026, 6, 1, 9, 0, tzinfo=datetime.timezone.utc)},
        ]),
        # build_provenance: source lineage
        ("source_lineage_reporting", [
            {"dataset_kind": "static_schedule", "storage_backend": "s3",
             "storage_path": "bucket/path", "source_url": None,
             "loaded_at_utc": datetime.datetime(2026, 6, 1, 0, 0, tzinfo=datetime.timezone.utc)},
        ]),
        # build_provenance: feed freshness
        ("feed_freshness_current", [
            {"endpoint_key": "vehicle_positions", "status": "ok",
             "completed_age_seconds": 30},
        ]),
        # name lookups (current dim UNION ALL history) — must precede the
        # generic "UNION" needle for the route-id enumeration below
        ("DISTINCT ON (u.stop_id)", [
            {"stop_id": "51234", "stop_name": "Côte-Vertu"},
        ]),
        ("DISTINCT ON (u.route_id)", [
            {"route_id": "165", "route_name": "Ligne 165"},
        ]),
        # build_stop_reliability: shift + day-type grains — unique discriminator
        # "AS banded". MUST precede the generic "UNION" needle below, because
        # _STOP_BY_GRAIN_SQL contains "UNION ALL" and would otherwise fall through
        # to the route-id enumeration (tuple rows) and crash on r["stop_id"].
        ("AS banded", [
            {"stop_id": "51234", "grain": "am_peak", "obs": 10, "severe": 1,
             "weighted_delay_sec": 600.0},
            {"stop_id": "51234", "grain": "weekday", "obs": 14, "severe": 1,
             "weighted_delay_sec": 1080.0},
        ]),
        # build_stop_reliability: weekday seasonality — unique discriminator
        # "AS dow_obs". Listed before the generic "UNION" / stop_delay_hourly needles
        # so the day-of-week rows aren't shadowed.
        ("AS dow_obs", [
            {"stop_id": "51234", "day_of_week_iso": 1, "dow_obs": 20, "severe": 2,
             "weighted_delay_sec": 1200.0},
            {"stop_id": "51234", "day_of_week_iso": 7, "dow_obs": 0, "severe": 0,
             "weighted_delay_sec": None},
        ]),
        # route IDs with history: UNION query
        ("UNION", [
            ("101",), ("202",),
        ]),
        # build_route_reliability: cancellation history — unique discriminator
        # "cancellation_rate_pct, canceled_trip_days" (its SELECT column list).
        # MUST precede the generic "ORDER BY provider_local_date DESC" daily-view
        # needle below, which the cancellation SQL also ends with.
        ("cancellation_rate_pct, canceled_trip_days", [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "cancellation_rate_pct": 2.5, "canceled_trip_days": 3,
             "total_trip_days": 120},
        ]),
        # build_route_reliability: trailing-window occupancy band shares —
        # unique discriminator "route_occupancy_band_daily AS rob".
        ("route_occupancy_band_daily AS rob", [
            {"empty": 0, "many_seats": 50, "few_seats": 30, "standing": 15, "full": 5},
        ]),
        # build_stop_reliability: per-stop trailing-window occupancy band shares —
        # unique discriminator "stop_occupancy_band_daily AS sob" (batched: one
        # summed row per stop_id, keyed by stop_id, no sentinel).
        ("stop_occupancy_band_daily AS sob", [
            {"stop_id": "51234", "empty": 0, "many_seats": 50,
             "few_seats": 30, "standing": 15, "full": 5},
        ]),
        # build_route_reliability: service-span history — unique discriminator
        # "first_trip_start_utc". MUST precede the generic daily-view needle below
        # (its SQL also ends with ORDER BY provider_local_date DESC).
        ("first_trip_start_utc", [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "first_trip_start_utc": datetime.datetime(2026, 6, 1, 10, 0,
                                                       tzinfo=datetime.timezone.utc),
             "last_trip_start_utc": datetime.datetime(2026, 6, 2, 1, 0,
                                                      tzinfo=datetime.timezone.utc),
             "service_span_min": 900, "first_trip_delay_seconds": 30,
             "last_trip_delay_seconds": 90, "trip_count": 120},
        ]),
        # build_route_reliability: skipped-stop history — unique discriminator
        # "skipped_stop_rate_pct" (also ends with ORDER BY provider_local_date DESC).
        ("skipped_stop_rate_pct", [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "skipped_stop_rate_pct": 3.94, "skipped_stop_count": 12,
             "stop_time_update_count": 305},
        ]),
        # build_route_reliability: daily view
        ("ORDER BY provider_local_date DESC", [
            {"d": datetime.date(2026, 6, 1), "known_obs": 50, "on_time": 45,
             "avg_delay_sec": 90, "severe": 5},
        ]),
        # build_route_reliability: weekly — unique discriminator "week_start_local"
        ("week_start_local", [
            {"d": datetime.date(2026, 5, 26), "known_obs": 300, "on_time": 270,
             "avg_delay_sec": 95, "severe": 15},
        ]),
        # build_route_reliability: monthly — unique discriminator "month_start_local"
        ("month_start_local", [
            {"d": datetime.date(2026, 5, 1), "known_obs": 1200, "on_time": 1080,
             "avg_delay_sec": 100, "severe": 60},
        ]),
        # build_route_reliability: observed headway
        ("route_headway_daily", [
            {"shift": "am_peak", "observed_headway_min": 8.0, "sample_count": 20},
        ]),
        # _scheduled_headway_by_shift -> dataset version
        ("dataset_kind = 'static_schedule'", [{"dataset_version_id": 1}]),
        # _scheduled_headway_by_shift -> rep dates
        ("generate_series", [
            {"weekday_date": datetime.date(2026, 6, 3),
             "weekend_date": datetime.date(2026, 6, 6)},
        ]),
        # active services
        ("extract(isodow FROM :repdate)", [("svc_wd",)]),
        # route schedule (for _scheduled_headway_by_shift)
        ("st.stop_sequence     = 1", []),
        # build_route_reliability: habit score
        ("route_habit_score", [
            {"day_of_week_iso": 1, "hour_of_day_local": 8, "repeat_problem_score": 0.7},
        ]),
        # (stop names are served by the "DISTINCT ON (u.stop_id)" entry above)
        # build_stop_reliability: by_route — "stop_id, route_id" in SELECT
        # (must precede the generic stop_delay_weekly entry)
        ("stop_id, route_id", [
            {"stop_id": "51234", "route_id": "101", "obs": 100,
             "weighted_delay_sec": 9000},
        ]),
        # weak stops for route_reliability AND stop_reliability weekly share stop_delay_weekly
        # Both queries want (stop_id, obs, weighted_delay_sec, severe) rows
        ("stop_delay_weekly", [
            {"stop_id": "51234", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ]),
        # build_stop_reliability: monthly
        ("stop_delay_monthly", [
            {"stop_id": "51234", "obs": 400, "weighted_delay_sec": 36000, "severe": 40},
        ]),
        # build_receipts: accountability
        ("citizen_accountability_daily", [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "affected_route_count": 3, "affected_stop_count": 12,
             "delayed_trip_count": 45, "severe_delay_count": 5,
             "alert_count": 2, "rider_impact_score": 0.35},
        ]),
        # build_receipts: worst route — matches public_route_reliability_daily
        # (stop_time_observation_count entry above already consumed the route_rel daily query)
        ("public_route_reliability_daily", [
            {"d": datetime.date(2026, 6, 1), "route_id": "165",
             "avg_delay_seconds": 200},
        ]),
        # build_receipts: worst stop
        ("public_stop_delay_daily", [
            {"d": datetime.date(2026, 6, 1), "stop_id": "51234",
             "avg_delay_seconds": 180, "max_delay_seconds": 600},
        ]),
    ]

    class FakeConnHistoric:
        def execute(self, statement, params=None):
            s = str(statement)
            for needle, rows in dispatch:
                if needle in s:
                    return _FakeResult(rows)
            return _FakeResult([])

    class FakeEngineHistoric:
        def begin(self):
            @contextmanager
            def _cm():
                yield FakeConnHistoric()

            return _cm()

    storage = LocalSnapshotStorage(str(tmp_path), "v1/stm")

    conn = FakeConnHistoric()
    keys = _publish_historic(
        conn,
        storage,
        provider_id="stm",
        settings=FakeSettings(),
    )

    # --- flat keys ---
    key_set = set(keys)
    assert any("historic/network_trend.json" in k for k in key_set)
    assert any("historic/hotspots.json" in k for k in key_set)
    assert any("historic/repeat_offenders.json" in k for k in key_set)
    assert any("historic/alert_history.json" in k for k in key_set)
    assert any("provenance.json" in k for k in key_set)
    # provenance is top-level (not under historic/)
    assert not any(k.endswith("historic/provenance.json") for k in key_set)

    # --- per-route files for routes 101 and 202 ---
    assert any("historic/route_reliability/101.json" in k for k in key_set)
    assert any("historic/route_reliability/202.json" in k for k in key_set)

    # --- per-stop file for stop 51234 ---
    assert any("historic/stop_reliability/51234.json" in k for k in key_set)

    # --- receipt for 2026-06-01 ---
    assert any("historic/receipts/2026-06-01.json" in k for k in key_set)

    # --- receipts discovery index (T7): exact set of receipt dates written ---
    from transit_ops.snapshots.contract import ReceiptsIndex
    import pathlib
    index_path = next(k for k in keys if "historic/receipts/index.json" in k)
    ri = ReceiptsIndex.model_validate_json(pathlib.Path(index_path).read_bytes())
    assert ri.dates == ["2026-06-01"]

    # --- round-trip parse: network_trend.json through its contract model ---
    network_trend_path = next(k for k in keys if "historic/network_trend.json" in k)
    raw = pathlib.Path(network_trend_path).read_bytes()
    parsed = NetworkTrend.model_validate_json(raw)
    assert isinstance(parsed.series, list)
    # WEEK + MONTH grains landed: the canned trend:week:* / trend:month:* rows
    # dispatched above must produce non-empty weekly/monthly series, and the
    # None-on-coarse-grain contract must hold — p90_min and vehicles come from the
    # ~14d raw fact window only, so they are ALWAYS None on every coarse point.
    assert isinstance(parsed.weekly, list) and len(parsed.weekly) > 0
    assert isinstance(parsed.monthly, list) and len(parsed.monthly) > 0
    assert all(p.p90_min is None and p.vehicles is None for p in parsed.weekly)
    assert all(p.p90_min is None and p.vehicles is None for p in parsed.monthly)

    # --- PublishResult via publish_snapshot ---
    res = publish_snapshot(
        "stm",
        tier="historic",
        settings=FakeSettings(),
        engine=FakeEngineHistoric(),
        storage=LocalSnapshotStorage(str(tmp_path / "r2"), "v1/stm"),
    )
    assert isinstance(res, PublishResult)
    assert res.tier == "historic"
    assert res.provider_id == "stm"
    assert len(res.keys_written) >= 5  # flat files + provenance at minimum


# ---------------------------------------------------------------------------
# T3 / T6 / T8 — state upsert, basemap, hash-gating semantics
# ---------------------------------------------------------------------------


class _RecordingConn:
    """Records executed SQL text (pattern: test_snapshots_builders FakeConn).

    Routes the static-stamp SELECT to a fixed loaded_at_utc; every other query
    returns an empty result so the static publisher writes only the two indexes
    + labels (no routes/stops/basemap).
    """

    def __init__(self):
        self.sql: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        s = str(statement)
        self.sql.append(s)
        import datetime as _dt

        if "loaded_at_utc FROM core.dataset_versions" in s:
            return _StampResult(_dt.datetime(2026, 6, 1, 0, 0, tzinfo=_dt.timezone.utc))
        return _EmptyResult()


class _EmptyResult:
    def mappings(self):
        return self

    def __iter__(self):
        return iter([])

    def fetchone(self):
        return None

    def fetchall(self):
        return []

    def scalar_one(self):
        return 0


class _StampResult:
    def __init__(self, value):
        self._value = value

    def mappings(self):
        return self

    def fetchone(self):
        return {"loaded_at_utc": self._value}


class _RecordingEngine:
    def __init__(self, conn):
        self._conn = conn

    def begin(self):
        @contextmanager
        def _cm():
            yield self._conn

        return _cm()


def _publish_static_once(store, conn, settings=None):
    return publish_snapshot(
        "stm",
        tier="static",
        settings=settings or FakeSettings(),
        engine=_RecordingEngine(conn),
        storage=store,
    )


def test_publish_records_state_row_per_tier() -> None:
    conn = _RecordingConn()
    _publish_static_once(StatefulFakeStore(), conn)
    inserts = [s for s in conn.sql if "INSERT INTO core.snapshot_publish_state" in s]
    assert len(inserts) == 1
    assert "ON CONFLICT (provider_id, tier)" in inserts[0]


def test_publish_result_reports_skip_counts() -> None:
    conn = _RecordingConn()
    res = _publish_static_once(StatefulFakeStore(), conn)
    d = res.display_dict()
    assert d["files_written"] == len(res.keys_written)
    assert d["files_skipped"] == 0  # first run: nothing skipped
    assert d["files_written"] > 0


def test_static_stamp_uses_dataset_loaded_at() -> None:
    import json

    store = StatefulFakeStore()
    _publish_static_once(store, _RecordingConn())
    # every static payload carries the dataset loaded_at, not upload time
    for key in ("static/routes_index.json", "static/stops_index.json", "labels/fr.json"):
        assert json.loads(store.store[key])["generated_utc"] == "2026-06-01T00:00:00Z"


def test_publish_static_second_run_skips_unchanged() -> None:
    store = StatefulFakeStore()
    # Run 1 writes everything + the state object.
    res1 = _publish_static_once(store, _RecordingConn())
    assert res1.keys_skipped == []
    run1_written = set(res1.keys_written)

    # Run 2 through the SAME stateful bucket: identical bytes -> all skipped.
    store.get_json_calls.clear()
    res2 = _publish_static_once(store, _RecordingConn())
    assert set(res2.keys_skipped) == run1_written
    assert res2.keys_written == []
    # exactly one state GET per run (the load())
    assert store.get_json_calls.count("_meta/publish_state_static.json") == 1


def test_publish_static_rewrites_when_fingerprint_changes() -> None:
    import json

    from transit_ops.snapshots.storage import _body

    store = StatefulFakeStore()
    res1 = _publish_static_once(store, _RecordingConn())
    run1_written = set(res1.keys_written)

    # Corrupt the stored state fingerprint -> next run must rewrite everything.
    state = json.loads(store.store["_meta/publish_state_static.json"])
    state["fingerprint"] = "v1|cc:STALE-HEADER"
    store.store["_meta/publish_state_static.json"] = _body(state)

    res2 = _publish_static_once(store, _RecordingConn())
    assert set(res2.keys_written) == run1_written
    assert res2.keys_skipped == []


def test_publish_live_is_not_hash_gated() -> None:
    """The live path must never call get_json (no per-cycle state read)."""

    class GuardStore(FakeStore):
        def get_json(self, rel_key):  # pragma: no cover - must not be reached
            raise AssertionError("live tier must not be hash-gated")

    store = GuardStore()
    res = publish_snapshot(
        "stm", tier="live", settings=FakeSettings(), engine=FakeEngine(), storage=store
    )
    assert res.tier == "live"
    assert len(store.keys) == 6
    assert res.keys_skipped == []


def test_publish_static_writes_basemap_when_configured() -> None:
    class BasemapSettings(FakeSettings):
        SNAPSHOT_BASEMAP_PMTILES_URL = "https://data.example.com/basemap/quebec.pmtiles"

    store = StatefulFakeStore()
    res = _publish_static_once(store, _RecordingConn(), settings=BasemapSettings())
    assert "static/basemap.json" in res.keys_written
    import json
    bm = json.loads(store.store["static/basemap.json"])
    assert bm["url"] == "https://data.example.com/basemap/quebec.pmtiles"
    assert bm["format"] == "pmtiles"


def test_historic_route_enumeration_excludes_unrouted_sentinel() -> None:
    """Per-route reliability files must not be emitted for '__unrouted__'.

    route_id is COALESCE'd to '__unrouted__' in the hourly spine, so it exists
    in route_reliability_weekly/monthly; the enumeration that decides which
    routes get a historic/route_reliability/{id}.json must exclude it so the
    internal sentinel is never published as if it were a real route.
    """
    sql = _DISTINCT_HISTORIC_ROUTE_IDS_SQL
    assert sql.count("route_id <> '__unrouted__'") == 2  # both UNION halves
    assert "route_reliability_weekly" in sql
    assert "route_reliability_monthly" in sql
