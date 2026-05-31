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
