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

from transit_ops.snapshots.publish import PublishResult, publish_snapshot


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
    """Storage backend that records rel_keys and returns them."""

    def __init__(self) -> None:
        self.keys: list[str] = []

    def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:
        self.keys.append(rel_key)
        return rel_key


class FakeSettings:
    """Minimal settings stub exposing what builders and storage need."""

    SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_publish_live_uploads_all_files_manifest_last() -> None:
    """All 5 files are written and manifest.json is the last key."""
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
        "manifest.json",
    ]
    assert store.keys == expected_keys, f"got {store.keys}"
    assert store.keys[-1] == "manifest.json"

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
    assert len(d["keys_written"]) == 5


def test_publish_rejects_unimplemented_tier() -> None:
    """Non-'live' tiers raise ValueError (Phase 1 only implements live)."""
    with pytest.raises(ValueError, match="not implemented"):
        publish_snapshot(
            "stm",
            tier="historic",
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
    assert len(store.keys) == 5


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

    class FakeStore2:
        def __init__(self):
            self.keys = []

        def put_json(self, rel_key, payload, *, tier):
            self.keys.append(rel_key)
            return rel_key

    store = FakeStore2()
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
    assert "static/routes_index.json" in store.keys
    assert "static/stops_index.json" in store.keys
    assert "labels/fr.json" in store.keys
    assert "labels/en.json" in store.keys
    assert "static/routes/165.json" in store.keys
    # no stop files since build_all_stops_data got empty stops
    assert not any(k.startswith("static/stops/") for k in store.keys)
