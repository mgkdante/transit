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
from transit_ops.sql_registry import query_name


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

    import datetime as _dt

    # Name-keyed dispatch (each query dispatches on its `-- q:<name>` marker).
    # Covers every query issued by build_routes_index, build_stops_index,
    # build_labels, the route_ids SELECT, build_route, and build_all_stops_data.
    dispatch = {
        # _static_stamp: loaded_at_utc of the current dataset version.
        "publish.static_stamp": [
            {"loaded_at_utc": _dt.datetime(2026, 6, 1, 0, 0, tzinfo=_dt.timezone.utc)},
        ],
        # reliability-availability set for build_routes_index; 165 has reliability history.
        "static.reliability_route_ids": [{"route_id": "165"}],
        "static.routes_index": [
            {"route_id": "165", "route_short_name": "165", "route_long_name": "Côte-Vertu",
             "route_color": "009EE0", "route_type": 3}
        ],
        "static.stops_index": [
            {"stop_id": "51234", "stop_code": "51234", "stop_name": "Côte-Vertu",
             "stop_lat": 45.49, "stop_lon": -73.66}
        ],
        "static.labels": [
            {"label_key": "network_health", "label_fr": "Santé", "label_en": "Health"}
        ],
        # route_ids for the per-route loop in _publish_static.
        "static.dim_route_ids": [{"route_id": "165"}],
        # dataset version (both build_route and build_all_stops_data use this).
        "static.dataset_version": [{"dataset_version_id": 1}],
        "static.rep_dates": [
            {"weekday_date": datetime.date(2026, 6, 3), "weekend_date": datetime.date(2026, 6, 6)}
        ],
        # active-services (returns tuples for row[0] iteration).
        "static.active_services": [("svc_wd",)],
        # route long name + route_type (self-describing mode field; 165 is a bus = type 3).
        "static.route_name_type": [{"route_long_name": "Côte-Vertu", "route_type": 3}],
        # route shapes (empty → no directions → no stop-sequence queries).
        "static.route_shapes": [],
        "static.route_schedule": [],
        # all stops (build_all_stops_data) — empty → no stop files written.
        "static.all_stops": [],
        "static.all_stop_schedules": [],
    }

    class FC:
        def execute(self, statement, params=None):
            return _FakeResult(dispatch.get(query_name(statement), []))

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
    # 165 is in the reliability-availability set -> its entry carries reliability=True
    assert ri["routes"][0]["id"] == "165"
    assert ri["routes"][0]["reliability"] is True


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

    # Name-keyed dispatch: each query dispatches on its `-- q:<name>` registry
    # marker (no ordering, no column-alias sniffing). Covers every query issued by
    # all 8 historic builders. Distinct names replace the old substring hazards:
    # weekly/monthly/weak-stop reads that once shared spine SQL now carry unique
    # names, so the hand-coded FakeConnHistoric.execute spine branch is gone.
    dispatch = {
        "receipts.network_daily": [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
             "severe": 5, "pooled_delay_sec": 5000, "inclamp_obs": 100},
        ],
        "network.trend.daily_hourly": [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
             "pooled_delay_sec": 5000, "inclamp_obs": 100},
        ],
        "network.trend.daily_p90": [
            {"local_date": datetime.date(2026, 6, 1), "p90_min": 3.5, "vehicles": 42},
        ],
        # build_network_trend: WEEK + MONTH grain re-aggregation of the daily sources.
        "network.trend.week_hourly": [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 200, "on_time": 180,
             "pooled_delay_sec": 12000, "inclamp_obs": 200},
        ],
        "network.trend.week_cancel": [
            {"local_date": datetime.date(2026, 6, 1), "canceled": 4, "total": 200},
        ],
        "network.trend.week_occupancy": [
            {"local_date": datetime.date(2026, 6, 1), "empty": 0, "many_seats": 60,
             "few_seats": 25, "standing": 10, "full": 5},
        ],
        "network.trend.month_hourly": [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 1000, "on_time": 820,
             "pooled_delay_sec": 90000, "inclamp_obs": 1000},
        ],
        "network.trend.month_cancel": [
            {"local_date": datetime.date(2026, 6, 1), "canceled": 12, "total": 600},
        ],
        "network.trend.month_occupancy": [
            {"local_date": datetime.date(2026, 6, 1), "empty": 10, "many_seats": 40,
             "few_seats": 30, "standing": 15, "full": 5},
        ],
        "hotspots.list": [
            {"entity_kind": "route", "entity_id": "165", "issue_count": 5,
             "severity_label": "high"},
        ],
        "repeat.offenders": [
            {"entity_kind": "route", "entity_id": "165", "route_id": "165",
             "recurrence_days": 7, "window_days": 30, "avg_delay_seconds": 180,
             "severity_label": "high"},
        ],
        "alerts.history": [
            {"alert_header_text": "Votre ligne", "header_text_en": None,
             "alert_id": None, "severity": "WARNING",
             "routes": ["165"], "stops": ["51234"],
             "start_utc": datetime.datetime(2026, 6, 1, 8, 0, tzinfo=datetime.timezone.utc),
             "end_utc": datetime.datetime(2026, 6, 1, 9, 0, tzinfo=datetime.timezone.utc)},
        ],
        "provenance.sources": [
            {"dataset_kind": "static_schedule", "storage_backend": "s3",
             "storage_path": "bucket/path", "source_url": None,
             "loaded_at_utc": datetime.datetime(2026, 6, 1, 0, 0, tzinfo=datetime.timezone.utc)},
        ],
        "provenance.freshness": [
            {"endpoint_key": "vehicle_positions", "status": "ok",
             "completed_age_seconds": 30},
        ],
        "static.stop_names": [
            {"stop_id": "51234", "stop_name": "Côte-Vertu"},
        ],
        "static.route_names": [
            {"route_id": "165", "route_name": "Ligne 165"},
        ],
        # build_stop_reliability: shift + day-type grains + weekday seasonality.
        "stop.reliability.by_grain": [
            {"stop_id": "51234", "grain": "am_peak", "obs": 10, "severe": 1,
             "weighted_delay_sec": 600.0},
            {"stop_id": "51234", "grain": "weekday", "obs": 14, "severe": 1,
             "weighted_delay_sec": 1080.0},
        ],
        "stop.reliability.dow": [
            {"stop_id": "51234", "day_of_week_iso": 1, "dow_obs": 20, "severe": 2,
             "weighted_delay_sec": 1200.0},
            {"stop_id": "51234", "day_of_week_iso": 7, "dow_obs": 0, "severe": 0,
             "weighted_delay_sec": None},
        ],
        # route IDs with history (per-route reliability enumerator).
        "route.spine.route_ids": [
            ("101",), ("202",),
        ],
        "route.cancellation.daily": [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "cancellation_rate_pct": 2.5, "canceled_trip_days": 3,
             "total_trip_days": 120},
        ],
        # tier-3 2D shift×day_type crosstab: the windowed spine projector only runs
        # when the route spine anchor is present (unmapped here → []), matching the
        # old dead-needle fall-through, so no crosstab rows are supplied.
        "route.delay.by_crowding": [
            {"band": "many_seats", "delay_obs": 40, "sum_delay_sec": 3600.0,
             "w_p50_sec": None, "p50_obs": 0, "day_count": 1},
        ],
        "route.occupancy.by_dow": [
            {"day_of_week_iso": 1, "empty": 0, "many_seats": 50,
             "few_seats": 30, "standing": 15, "full": 5},
            {"day_of_week_iso": 6, "empty": 40, "many_seats": 30,
             "few_seats": 20, "standing": 10, "full": 0},
        ],
        "route.occupancy.by_grain": [
            {"d": datetime.date(2026, 6, 1), "empty": 0, "many_seats": 50,
             "few_seats": 30, "standing": 15, "full": 5},
        ],
        "route.occupancy.band_window": [
            {"empty": 0, "many_seats": 50, "few_seats": 30, "standing": 15, "full": 5},
        ],
        "stop.occupancy.band_window": [
            {"stop_id": "51234", "empty": 0, "many_seats": 50,
             "few_seats": 30, "standing": 15, "full": 5},
        ],
        "route.service_span.daily": [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "first_trip_start_utc": datetime.datetime(2026, 6, 1, 10, 0,
                                                       tzinfo=datetime.timezone.utc),
             "last_trip_start_utc": datetime.datetime(2026, 6, 2, 1, 0,
                                                      tzinfo=datetime.timezone.utc),
             "service_span_min": 900, "first_trip_delay_seconds": 30,
             "last_trip_delay_seconds": 90, "trip_count": 120},
        ],
        "route.skipped_stop.daily": [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "skipped_stop_rate_pct": 3.94, "skipped_stop_count": 12,
             "stop_time_update_count": 305},
        ],
        "route.reliability.daily": [
            {"d": datetime.date(2026, 6, 1), "known_obs": 50, "on_time": 45,
             "avg_delay_sec": 90, "severe": 5},
        ],
        # route.spine.weekly / .monthly / by_shift / by_daytype are the spine
        # projectors (h1..h21 histogram shape); the old publish dispatch fed them
        # dead needles that never matched, so route periods came only from the daily
        # read. Left unmapped ([]) to preserve that exact published output.
        "route.headway.observed_by_shift": [
            {"shift": "am_peak", "observed_headway_min": 8.0, "sample_count": 20},
        ],
        # _scheduled_headway_by_shift -> dataset version / rep dates / services / schedule.
        "static.dataset_version": [{"dataset_version_id": 1}],
        "static.rep_dates": [
            {"weekday_date": datetime.date(2026, 6, 3),
             "weekend_date": datetime.date(2026, 6, 6)},
        ],
        "static.active_services": [("svc_wd",)],
        "static.route_schedule": [],
        "route.habit.score": [
            {"day_of_week_iso": 1, "hour_of_day_local": 8, "repeat_problem_score": 0.7},
        ],
        # DB-0067: stop spine anchor drives the windowed weak-stop + stop-grain reads.
        "stop.delay.anchor": [{"anchor": datetime.date(2026, 6, 30)}],
        "stop.reliability.by_route": [
            {"stop_id": "51234", "route_id": "101", "obs": 100,
             "weighted_delay_sec": 9000},
        ],
        # build_stop_reliability weekly/monthly (GROUP BY stop_id) -> surviving stop.
        "stop.reliability.weekly": [
            {"stop_id": "51234", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ],
        "stop.reliability.monthly": [
            {"stop_id": "51234", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ],
        # scalar per-route weak_stops (legacy read, weighted_delay_sec): surviving stop ranks.
        "route.weak_stops.legacy": [
            {"stop_id": "51234", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ],
        # weak_stops_by_grain (sum_delay_sec): obs<30 -> below MIN_N -> [] (not asserted).
        "route.weak_stops.by_grain": [
            {"stop_id": "51234", "obs": 10, "severe": 1, "sum_delay_sec": 900},
        ],
        "receipts.accountability": [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "affected_route_count": 3, "affected_stop_count": 12,
             "delayed_trip_count": 45, "severe_delay_count": 5,
             "alert_count": 2, "rider_impact_score": 0.35},
        ],
        "receipts.worst_route": [
            {"d": datetime.date(2026, 6, 1), "route_id": "165",
             "avg_delay_seconds": 200},
        ],
        "receipts.worst_stop": [
            {"d": datetime.date(2026, 6, 1), "stop_id": "51234",
             "avg_delay_seconds": 180, "max_delay_seconds": 600},
        ],
    }

    class FakeConnHistoric:
        def execute(self, statement, params=None):
            return _FakeResult(dispatch.get(query_name(statement), []))

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
    from transit_ops.snapshots.contract import ReceiptsIndex, RouteReliabilityIndex
    import pathlib
    index_path = next(k for k in keys if "historic/receipts/index.json" in k)
    ri = ReceiptsIndex.model_validate_json(pathlib.Path(index_path).read_bytes())
    assert ri.dates == ["2026-06-01"]

    # --- route-reliability discovery index: the EXACT set of routes published this
    # run (so the web list-badge gate never lags the published files like the static
    # routes_index flag does). The spine returns routes 101 + 202 (see the FakeConn). ---
    rr_index_path = next(k for k in keys if "historic/route_reliability/index.json" in k)
    rri = RouteReliabilityIndex.model_validate_json(pathlib.Path(rr_index_path).read_bytes())
    assert rri.route_ids == ["101", "202"]

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


def test_live_gate_checker_crash_never_aborts_cycle(monkeypatch) -> None:
    """A checker that raises during live gate.record must be logged and swallowed —
    the ~57s live cycle still uploads all 6 files."""
    from transit_ops.snapshots import gate as _gate

    def _boom(rel_key, payload):  # noqa: ANN001, ARG001
        raise RuntimeError("checker exploded")

    monkeypatch.setattr(_gate, "check_payload", _boom)

    store = FakeStore()
    res = publish_snapshot(
        "stm", tier="live", settings=FakeSettings(), engine=FakeEngine(), storage=store
    )
    # gate crashed on every file, yet the cycle completed and uploaded everything
    assert res.tier == "live"
    assert len(store.keys) == 6
    assert store.keys[-1] == "manifest.json"


def test_static_gate_blocks_sentinel_payload(monkeypatch) -> None:
    """The static tier runs the universal sentinel/NaN scan before upload: a 9999.9999
    sentinel in a built static payload raises GateError (nothing uploaded) unless force."""
    from transit_ops.snapshots import gate as _gate
    from transit_ops.snapshots import publish as _pub

    def _poison(conn, storage, *, provider_id, settings, stamp):  # noqa: ANN001, ARG001
        storage.put_json("static/routes_index.json",
                         {"generated_utc": stamp, "bad": 9999.9999}, tier="static")

    monkeypatch.setattr(_pub, "_publish_static", _poison)

    store = StatefulFakeStore()
    with pytest.raises(_gate.GateError):
        _publish_static_once(store, _RecordingConn())
    # gate ran BEFORE upload -> the poisoned payload never reached the hash-gate store
    assert "static/routes_index.json" not in store.store


def test_static_gate_force_overrides_sentinel(monkeypatch) -> None:
    """--force downgrades the static gate ERROR to a logged override and uploads."""
    from transit_ops.snapshots import publish as _pub

    def _poison(conn, storage, *, provider_id, settings, stamp):  # noqa: ANN001, ARG001
        storage.put_json("static/routes_index.json",
                         {"generated_utc": stamp, "bad": 9999.9999}, tier="static")

    monkeypatch.setattr(_pub, "_publish_static", _poison)

    store = StatefulFakeStore()
    res = publish_snapshot(
        "stm", tier="static", settings=FakeSettings(),
        engine=_RecordingEngine(_RecordingConn()), storage=store, force=True,
    )
    assert "static/routes_index.json" in res.keys_written


def test_static_gate_reports_on_success(monkeypatch) -> None:
    """A clean static publish attaches a gate_report to the result (FIX-6 consumer)."""
    store = StatefulFakeStore()
    res = _publish_static_once(store, _RecordingConn())
    assert res.gate_report is not None
    assert res.gate_report["tier"] == "static"
    assert res.gate_report["errors"] == 0


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

    The enumeration is sourced from gold.route_delay_spine (S7-B), which filters
    route_id IS NOT NULL at build, so the '__unrouted__' sentinel never appears —
    the exclusion is a build-time invariant, not a SQL-level filter.
    """
    sql = str(_DISTINCT_HISTORIC_ROUTE_IDS_SQL)
    assert "DISTINCT route_id FROM gold.route_delay_spine" in sql
    assert "__unrouted__" not in sql
    assert "route_reliability_weekly" not in sql
    assert "route_reliability_monthly" not in sql


def test_static_publish_dataset_gate_skips_unchanged_but_rebuilds_on_change(monkeypatch) -> None:
    """The static dataset-level gate (DB-perf fix) skips the whole ~9k-file rebuild ONLY
    when the dataset stamp is unchanged AND the hash-state fingerprint still matches; a new
    GTFS edition (stamp differs) or a format/cache change (fingerprint differs) forces the
    full rebuild so a real schedule change never stalls."""
    import datetime as _dt
    from contextlib import contextmanager

    from transit_ops.snapshots import publish as _pub
    from transit_ops.snapshots.storage import state_fingerprint

    _STAMP = _dt.datetime(2026, 6, 10, 19, 47, 28, tzinfo=_dt.timezone.utc)

    class _Res:
        def __init__(self, rows):
            self._rows = list(rows)

        def mappings(self):
            outer = self

            class _M:
                def fetchone(self_m):
                    return outer._rows[0] if outer._rows else None

            return _M()

        def fetchone(self):
            return self._rows[0] if self._rows else None

    class _Conn:
        def __init__(self, *, skip_row: bool) -> None:
            self._skip_row = skip_row
            self.executed: list[str] = []

        def execute(self, statement, params=None):
            s = str(statement)
            self.executed.append(s)
            if "loaded_at_utc FROM core.dataset_versions" in s:
                return _Res([{"loaded_at_utc": _STAMP}])
            # the dataset-skip probe: the ONLY query that CASTs the stamp against the state row.
            # Returns a positional Row (tuple) like real SQLAlchemy, so match[0] = files_total.
            if "core.snapshot_publish_state" in s and "CAST" in s:
                return _Res([(9222,)] if self._skip_row else [])
            return _Res([])

    class _Engine:
        def __init__(self, conn) -> None:
            self._conn = conn

        def begin(self):
            @contextmanager
            def _cm():
                yield self._conn

            return _cm()

    class _Store:
        def __init__(self, *, fp_doc) -> None:
            self._fp_doc = fp_doc

        def get_json(self, rel_key):
            return self._fp_doc

        def put_bytes(self, rel_key, body, *, tier):
            return rel_key

        def put_json(self, rel_key, payload, *, tier):
            return rel_key

        def full_key(self, rel_key):
            return rel_key

    calls: list[str] = []

    def _spy(conn, storage, *, provider_id, settings, stamp):
        calls.append(stamp)
        return []

    monkeypatch.setattr(_pub, "_publish_static", _spy)

    good_fp = {"fingerprint": state_fingerprint("static"), "hashes": {"a": "b"}}
    stale_fp = {"fingerprint": "v0|cc:stale", "hashes": {"a": "b"}}

    def _run(*, skip_row, fp_doc):
        return _pub.publish_snapshot(
            "stm", tier="static", settings=FakeSettings(),
            engine=_Engine(_Conn(skip_row=skip_row)), storage=_Store(fp_doc=fp_doc),
        )

    # 1) unchanged dataset + matching fingerprint -> SKIP (publisher never runs).
    calls.clear()
    res = _run(skip_row=True, fp_doc=good_fp)
    assert calls == [], "rebuild should be skipped when the dataset is unchanged"
    assert res.keys_written == [] and res.keys_skipped == []

    # 2) new GTFS edition (no matching state row) -> FULL REBUILD (never stalls a real change).
    calls.clear()
    _run(skip_row=False, fp_doc=good_fp)
    assert len(calls) == 1, "a new dataset edition must trigger the full rebuild"

    # 3) format/cache change (fingerprint mismatch) -> FULL REBUILD even though a state row exists.
    calls.clear()
    _run(skip_row=True, fp_doc=stale_fp)
    assert len(calls) == 1, "a fingerprint change must force a full re-stamp rebuild"
