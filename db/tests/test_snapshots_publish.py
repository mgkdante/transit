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
    """Static tier writes indexes, labels, per-route and per-stop files."""
    from contextlib import contextmanager

    class FakeResult:
        def __init__(self, rows=None):
            self._rows = rows or []

        def mappings(self):
            class M:
                def __init__(self, rows):
                    self._rows = rows

                def fetchone(self):
                    return self._rows[0] if self._rows else None

                def __iter__(self):
                    return iter(self._rows)

            return M(self._rows)

        def fetchall(self):
            return [(r,) if isinstance(r, str) else tuple(r.values()) for r in self._rows]

        def scalar_one(self):
            return self._rows[0] if self._rows else 0

    call_idx = [0]
    # Responses for _publish_static calls in order:
    # 1. build_routes_index: routes_index query
    # 2. build_stops_index: stops_index query
    # 3. build_labels(fr): labels query
    # 4. build_labels(en): labels query
    # 5. route_ids query (per-route loop)
    # 6. build_route("165"): dv query
    # 7. build_route("165"): route_long_name query
    # 8. build_route("165"): shapes query (empty → no directions → no stop queries)
    # 9. build_route("165"): schedule query
    # 10. build_all_stops_data: dv query
    # 11. build_all_stops_data: stops query (empty → no stop files)
    responses = [
        # build_routes_index
        [{"route_id": "165", "route_short_name": "165", "route_long_name": "Côte-Vertu", "route_color": "009EE0", "route_type": 3}],
        # build_stops_index
        [{"stop_id": "51234", "stop_code": "51234", "stop_name": "Côte-Vertu", "stop_lat": 45.49, "stop_lon": -73.66}],
        # build_labels fr
        [{"label_key": "network_health", "label_fr": "Santé", "label_en": "Health"}],
        # build_labels en
        [{"label_key": "network_health", "label_fr": "Santé", "label_en": "Health"}],
        # route_ids for per-route loop
        [{"route_id": "165"}],
        # build_route("165"): dv
        [{"dataset_version_id": 1}],
        # build_route("165"): route_long_name
        [{"route_long_name": "Côte-Vertu"}],
        # build_route("165"): shapes (empty → no directions)
        [],
        # build_route("165"): schedule
        [{"departure_time": "06:10:00"}],
        # build_all_stops_data: dv
        [{"dataset_version_id": 1}],
        # build_all_stops_data: stops (empty → no stop files)
        [],
    ]

    class FC:
        def execute(self, *a, **k):
            idx = call_idx[0]
            call_idx[0] += 1
            return FakeResult(responses[idx] if idx < len(responses) else [])

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
