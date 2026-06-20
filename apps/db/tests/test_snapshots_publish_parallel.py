"""Stage-2 (slice-9.1.1r) — parallel per-entity snapshot uploads.

On a new-GTFS-edition day the hash-gate skips nothing, so the publish must
re-upload every per-route / per-stop / receipts file. These tests assert the
upload loops fan out through a bounded thread pool while preserving the
stage-1 guarantees:

  * concurrency is BOUNDED by SNAPSHOT_PUBLISH_CONCURRENCY;
  * the manifest / receipts index are uploaded LAST (after the tier files);
  * a single failed upload PROPAGATES (no silent swallow);
  * the hash-gate skip still does no PUT;
  * the storage layer is thread-safe (per-thread boto3 clients + locked state).
"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager

import pytest

from transit_ops.snapshots.publish import _parallel_put, publish_snapshot
from transit_ops.snapshots.storage import HashGatedStorage, SnapshotStorage

# ---------------------------------------------------------------------------
# _parallel_put — the bounded uploader primitive
# ---------------------------------------------------------------------------


class _ConcurrencyProbe:
    """Storage whose put_json sleeps briefly and records peak in-flight count."""

    def __init__(self, delay: float = 0.02) -> None:
        self._delay = delay
        self._lock = threading.Lock()
        self.in_flight = 0
        self.peak = 0
        self.keys: list[str] = []

    def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:
        with self._lock:
            self.in_flight += 1
            self.peak = max(self.peak, self.in_flight)
        try:
            time.sleep(self._delay)
        finally:
            with self._lock:
                self.in_flight -= 1
                self.keys.append(rel_key)
        return rel_key


def test_parallel_put_bounds_concurrency() -> None:
    """No more than `concurrency` uploads run at once."""
    probe = _ConcurrencyProbe()
    items = [(f"static/stops/{i}.json", {"i": i}, "static") for i in range(50)]
    keys = _parallel_put(probe, items, concurrency=4)
    assert len(keys) == 50
    assert probe.peak <= 4
    # genuinely concurrent (would be 1 if it ran serially)
    assert probe.peak >= 2


def test_parallel_put_preserves_submission_order() -> None:
    """Returned keys follow item order even when threads finish out of order."""
    probe = _ConcurrencyProbe(delay=0.0)
    items = [(f"static/stops/{i}.json", {"i": i}, "static") for i in range(20)]
    keys = _parallel_put(probe, items, concurrency=8)
    assert keys == [f"static/stops/{i}.json" for i in range(20)]


def test_parallel_put_sequential_when_concurrency_one() -> None:
    """concurrency<=1 runs inline (no pool) and stays peak==1."""
    probe = _ConcurrencyProbe(delay=0.0)
    items = [(f"static/stops/{i}.json", {"i": i}, "static") for i in range(10)]
    keys = _parallel_put(probe, items, concurrency=1)
    assert keys == [f"static/stops/{i}.json" for i in range(10)]
    assert probe.peak == 1


def test_parallel_put_empty_is_noop() -> None:
    probe = _ConcurrencyProbe()
    assert _parallel_put(probe, [], concurrency=8) == []
    assert probe.keys == []


def test_parallel_put_propagates_first_failure() -> None:
    """A failing upload surfaces; failures are never swallowed."""

    class _Boom:
        def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:
            if rel_key == "static/stops/13.json":
                raise RuntimeError("upload failed for 13")
            return rel_key

    items = [(f"static/stops/{i}.json", {"i": i}, "static") for i in range(40)]
    with pytest.raises(RuntimeError, match="upload failed for 13"):
        _parallel_put(_Boom(), items, concurrency=8)


# ---------------------------------------------------------------------------
# HashGatedStorage thread-safety + skip-does-no-PUT under concurrency
# ---------------------------------------------------------------------------


class _CountingInner:
    """Inner storage recording every put_bytes (i.e. real network write)."""

    def __init__(self, prior: dict[str, bytes] | None = None) -> None:
        self.store: dict[str, bytes] = dict(prior or {})
        self._lock = threading.Lock()
        self.put_bytes_calls: list[str] = []

    def full_key(self, rel_key: str) -> str:
        return rel_key

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
        with self._lock:
            self.put_bytes_calls.append(rel_key)
            self.store[rel_key] = body
        return rel_key

    def get_json(self, rel_key: str):
        import json as _json

        raw = self.store.get(rel_key)
        return _json.loads(raw) if raw is not None else None


def test_hash_gated_storage_is_thread_safe_and_consistent() -> None:
    """Concurrent puts produce a consistent written list with no lost updates."""
    inner = _CountingInner()
    gated = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint="v1")
    gated.load()
    items = [(f"static/stops/{i}.json", {"i": i}, "static") for i in range(200)]
    _parallel_put(gated, items, concurrency=16)
    # every distinct key written exactly once; no races dropped entries
    assert sorted(gated.written) == sorted(k for k, _, _ in items)
    assert len(gated.written) == 200
    assert len(gated.skipped) == 0
    assert sorted(inner.put_bytes_calls) == sorted(gated.written)


def test_hash_gated_skip_does_no_put_under_concurrency() -> None:
    """A file whose hash matches prior state is skipped — no put_bytes."""
    import json

    from transit_ops.snapshots.storage import _body

    # Seed prior state so half the keys are unchanged.
    prior_hashes = {}
    inner = _CountingInner()
    for i in range(0, 100, 2):  # even keys pre-seeded as unchanged
        key = f"static/stops/{i}.json"
        body = _body({"i": i})
        import hashlib

        prior_hashes[key] = hashlib.md5(body).hexdigest()  # noqa: S324
    inner.store["_meta/s.json"] = json.dumps(
        {"fingerprint": "v1", "hashes": prior_hashes}, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")

    gated = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint="v1")
    gated.load()
    items = [(f"static/stops/{i}.json", {"i": i}, "static") for i in range(100)]
    _parallel_put(gated, items, concurrency=16)

    assert len(gated.skipped) == 50  # even keys matched prior -> skipped
    assert len(gated.written) == 50  # odd keys changed -> written
    # skipped files did NO network write
    assert all("static/stops/" in k for k in inner.put_bytes_calls)
    assert len(inner.put_bytes_calls) == 50


# ---------------------------------------------------------------------------
# SnapshotStorage — per-thread boto3 client factory
# ---------------------------------------------------------------------------


def test_snapshot_storage_uses_per_thread_client() -> None:
    """With a client_factory, each thread gets its own client instance."""
    made: list[int] = []
    seen_ids: set[int] = set()
    seen_lock = threading.Lock()

    class _FakeClient:
        def __init__(self, cid: int) -> None:
            self.cid = cid

        def put_object(self, **kw) -> None:  # noqa: ANN003
            with seen_lock:
                seen_ids.add(self.cid)
            time.sleep(0.01)

    counter = {"n": 0}
    counter_lock = threading.Lock()

    def factory() -> _FakeClient:
        with counter_lock:
            counter["n"] += 1
            cid = counter["n"]
        made.append(cid)
        return _FakeClient(cid)

    store = SnapshotStorage(
        _FakeClient(0), bucket="b", base_prefix="v1/stm", client_factory=factory
    )
    items = [(f"static/stops/{i}.json", {"i": i}, "static") for i in range(40)]
    _parallel_put(store, items, concurrency=8)

    # the seeded client (cid 0) is never used; each worker thread built its own
    assert 0 not in seen_ids
    assert len(seen_ids) >= 2  # multiple distinct per-thread clients were used
    # a thread reuses its cached client rather than making one per put
    assert len(made) <= 8


def test_snapshot_storage_shares_client_without_factory() -> None:
    """Without a factory the single injected client is used (single-thread path)."""

    class _FakeClient:
        def __init__(self) -> None:
            self.puts = 0

        def put_object(self, **kw) -> None:  # noqa: ANN003
            self.puts += 1

    c = _FakeClient()
    store = SnapshotStorage(c, bucket="b", base_prefix="v1/stm")
    store.put_bytes("static/stops/1.json", b"{}", tier="static")
    store.put_bytes("static/stops/2.json", b"{}", tier="static")
    assert c.puts == 2


# ---------------------------------------------------------------------------
# End-to-end: static publish parallelises but keeps deterministic ordering
# ---------------------------------------------------------------------------


class _OrderTrackingStore:
    """Records put_json keys in completion order under a lock (hash-gate compat)."""

    def __init__(self) -> None:
        self.keys: list[str] = []
        self.store: dict[str, bytes] = {}
        self._lock = threading.Lock()

    def full_key(self, rel_key: str) -> str:
        return rel_key

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
        with self._lock:
            self.store[rel_key] = body
            self.keys.append(rel_key)
        return rel_key

    def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:
        from transit_ops.snapshots.storage import _body

        with self._lock:
            self.keys.append(rel_key)
            self.store[rel_key] = _body(payload)
        return rel_key

    def get_json(self, rel_key: str):
        import json as _json

        raw = self.store.get(rel_key)
        return _json.loads(raw) if raw is not None else None


def _historic_dispatch_conn():
    """A fake conn returning enough rows for several per-route/per-stop files."""
    import datetime

    class _R:
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
            out = []
            for r in self._rows:
                if isinstance(r, dict):
                    out.append(tuple(r.values()))
                elif isinstance(r, tuple):
                    out.append(r)
                else:
                    out.append((r,))
            return out

        def scalar_one(self):
            return self._rows[0] if self._rows else 0

    dispatch = [
        ("interval '31 days'", [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
             "severe": 5, "weighted_delay_sec": 5000},
            {"local_date": datetime.date(2026, 6, 2), "known_obs": 100, "on_time": 90,
             "severe": 5, "weighted_delay_sec": 5000},
        ]),
        ("interval '90 days'", [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
             "weighted_delay_sec": 5000},
        ]),
        ("fact_trip_delay_snapshot", [
            {"local_date": datetime.date(2026, 6, 1), "p90_min": 3.5, "vehicles": 42},
        ]),
        # build_network_trend: WEEK + MONTH grain re-aggregation. Unique
        # `-- trend:<grain>:<source>` markers dispatch each bucketed query to its
        # own canned row-set (no collision with the daily hourly/cancel/occupancy).
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
        ("repeated_problem_route_stop", []),
        ("repeat_offender_daily", []),
        ("i3_alert_history_reporting", []),
        ("source_lineage_reporting", []),
        ("feed_freshness_current", []),
        ("DISTINCT ON (u.stop_id)", [{"stop_id": "S1", "stop_name": "Stop 1"}]),
        ("DISTINCT ON (u.route_id)", [{"route_id": "R1", "route_name": "Route 1"}]),
        # build_stop_reliability: shift + day-type grains — unique discriminator
        # "AS banded". MUST precede the generic "UNION" needle below: _STOP_BY_GRAIN_SQL
        # contains "UNION ALL" and would otherwise fall through to the route-id
        # enumeration (tuple rows) and crash on r["stop_id"].
        ("AS banded", [
            {"stop_id": "S1", "grain": "am_peak", "obs": 10, "severe": 1,
             "weighted_delay_sec": 600.0},
            {"stop_id": "S1", "grain": "weekday", "obs": 14, "severe": 1,
             "weighted_delay_sec": 1080.0},
        ]),
        # build_stop_reliability: weekday seasonality — unique discriminator
        # "AS dow_obs". Listed before the generic "UNION" needle so the day-of-week
        # rows aren't shadowed.
        ("AS dow_obs", [
            {"stop_id": "S1", "day_of_week_iso": 1, "dow_obs": 20, "severe": 2,
             "weighted_delay_sec": 1200.0},
            {"stop_id": "S1", "day_of_week_iso": 7, "dow_obs": 0, "severe": 0,
             "weighted_delay_sec": None},
        ]),
        ("UNION", [("R1",), ("R2",), ("R3",)]),  # 3 routes with history
        # Tier-1 cancellation/occupancy reads (more-specific needles precede the
        # generic daily-view "ORDER BY provider_local_date DESC" below).
        ("cancellation_rate_pct, canceled_trip_days", []),
        ("route_occupancy_band_daily AS rob", []),
        ("first_trip_start_utc", []),
        ("skipped_stop_rate_pct", []),
        ("ORDER BY provider_local_date DESC", [
            {"d": datetime.date(2026, 6, 1), "known_obs": 50, "on_time": 45,
             "avg_delay_sec": 90, "severe": 5},
        ]),
        ("week_start_local", []),
        ("month_start_local", []),
        ("route_headway_daily", []),
        ("dataset_kind = 'static_schedule'", [{"dataset_version_id": 1}]),
        ("generate_series", [
            {"weekday_date": datetime.date(2026, 6, 3), "weekend_date": datetime.date(2026, 6, 6)},
        ]),
        ("extract(isodow FROM :repdate)", [("svc_wd",)]),
        ("st.stop_sequence     = 1", []),
        ("route_habit_score", []),
        ("stop_id, route_id", []),
        ("stop_delay_weekly", [
            {"stop_id": "S1", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ]),
        ("stop_delay_monthly", []),
        ("citizen_accountability_daily", [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "affected_route_count": 3, "affected_stop_count": 12,
             "delayed_trip_count": 45, "severe_delay_count": 5,
             "alert_count": 2, "rider_impact_score": 0.35},
            {"provider_local_date": datetime.date(2026, 6, 2),
             "affected_route_count": 2, "affected_stop_count": 8,
             "delayed_trip_count": 30, "severe_delay_count": 3,
             "alert_count": 1, "rider_impact_score": 0.25},
        ]),
        ("public_route_reliability_daily", []),
        ("public_stop_delay_daily", []),
    ]

    class _Conn:
        def execute(self, statement, params=None):
            s = str(statement)
            for needle, rows in dispatch:
                if needle in s:
                    return _R(rows)
            return _R([])

    return _Conn()


def test_historic_publish_uploads_index_after_receipts() -> None:
    """receipts/index.json is the LAST historic key, after all receipt files."""
    from transit_ops.snapshots.publish import _publish_historic

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
        SNAPSHOT_PUBLISH_CONCURRENCY = 8

    store = _OrderTrackingStore()
    conn = _historic_dispatch_conn()
    keys = _publish_historic(conn, store, provider_id="stm", settings=_Settings())

    index_key = "historic/receipts/index.json"
    assert index_key in keys
    # every receipt file appears in the upload log strictly before the index PUT
    receipt_positions = [
        i for i, k in enumerate(store.keys)
        if k.startswith("historic/receipts/") and k != index_key
    ]
    index_position = store.keys.index(index_key)
    assert receipt_positions, "expected receipt files to be uploaded"
    assert max(receipt_positions) < index_position


def test_static_publish_manifest_index_keys_present_and_complete() -> None:
    """publish_snapshot(static) returns all keys; per-route files parallelised."""
    conn = _RecordingStaticConn()

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
        SNAPSHOT_PUBLISH_CONCURRENCY = 8

    store = _OrderTrackingStore()
    res = publish_snapshot(
        "stm",
        tier="static",
        settings=_Settings(),
        engine=_FakeEngine(conn),
        storage=store,
    )
    written = set(res.keys_written)
    assert "static/routes_index.json" in written
    assert "static/stops_index.json" in written
    # several per-route files were produced and all uploaded
    route_keys = {k for k in written if k.startswith("static/routes/")}
    assert len(route_keys) >= 3


class _RecordingStaticConn:
    """Static fake conn yielding a few routes (no stops) for parallel coverage."""

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        import datetime as _dt

        s = str(statement)
        if "loaded_at_utc FROM core.dataset_versions" in s:
            loaded = _dt.datetime(2026, 6, 1, tzinfo=_dt.UTC)
            return _StaticResult([{"loaded_at_utc": loaded}])
        if "SELECT route_id FROM gold.dim_route WHERE provider_id" in s:
            return _StaticResult([{"route_id": "R1"}, {"route_id": "R2"}, {"route_id": "R3"}])
        if "route_sort_order" in s:
            return _StaticResult([
                {"route_id": "R1", "route_short_name": "1", "route_long_name": "One",
                 "route_color": "009EE0", "route_type": 3}
            ])
        if "s.location_type" in s:
            return _StaticResult([
                {"stop_id": "S1", "stop_code": "S1", "stop_name": "Stop",
                 "stop_lat": 45.0, "stop_lon": -73.0}
            ])
        if "report_labels" in s:
            return _StaticResult([{"label_key": "k", "label_fr": "f", "label_en": "e"}])
        if "dataset_kind = 'static_schedule'" in s:
            return _StaticResult([{"dataset_version_id": 1}])
        if "generate_series" in s:
            return _StaticResult([
                {"weekday_date": _dt.date(2026, 6, 3), "weekend_date": _dt.date(2026, 6, 6)}
            ])
        if "route_long_name FROM gold.dim_route" in s:
            return _StaticResult([{"route_long_name": "One"}])
        return _StaticResult([])


class _StaticResult:
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
        out = []
        for r in self._rows:
            if isinstance(r, dict):
                out.append(tuple(r.values()))
            elif isinstance(r, tuple):
                out.append(r)
            else:
                out.append((r,))
        return out

    def scalar_one(self):
        return self._rows[0] if self._rows else 0


class _FakeEngine:
    def __init__(self, conn):
        self._conn = conn

    def begin(self):
        @contextmanager
        def _cm():
            yield self._conn

        return _cm()
