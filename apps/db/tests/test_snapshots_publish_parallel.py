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
from transit_ops.sql_registry import query_name

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

    def put_immutable_json(self, rel_key: str, payload: object) -> str:
        from transit_ops.snapshots.storage import _body

        with self._lock:
            self.keys.append(rel_key)
            self.store[rel_key] = _body(payload)
        return rel_key

    def get_json(self, rel_key: str):
        import json as _json

        raw = self.store.get(rel_key)
        return _json.loads(raw) if raw is not None else None


def _historic_dispatch_conn(*, archive_rows=None):  # noqa: ANN001
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

    # Name-keyed dispatch on each query's `-- q:<name>` registry marker. Distinct
    # names replace the old substring hazards; spine-projector reads (weekly/monthly/
    # crosstab/by_shift/by_daytype) are left unmapped ([]) to preserve the exact
    # published output the old dead needles gave, so the hand-coded spine branch is gone.
    dispatch = {
        "receipts.network_daily": [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
             "severe": 5, "pooled_delay_sec": 5000, "inclamp_obs": 100},
            {"local_date": datetime.date(2026, 6, 2), "known_obs": 100, "on_time": 90,
             "severe": 5, "pooled_delay_sec": 5000, "inclamp_obs": 100},
        ],
        "network.trend.daily_hourly": [
            {"local_date": datetime.date(2026, 6, 1), "known_obs": 100, "on_time": 90,
             "pooled_delay_sec": 5000, "inclamp_obs": 100},
        ],
        "network.trend.daily_p90": [
            {"local_date": datetime.date(2026, 6, 1), "p90_min": 3.5, "vehicles": 42},
        ],
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
        "hotspots.list": [],
        "repeat.offenders": [],
        "alerts.history": [],
        "alerts.archive.publish": list(archive_rows or []),
        "provenance.sources": [],
        "provenance.freshness": [],
        "static.stop_names": [{"stop_id": "S1", "stop_name": "Stop 1"}],
        "static.route_names": [{"route_id": "R1", "route_name": "Route 1"}],
        "stop.reliability.by_grain": [
            {"stop_id": "S1", "grain": "am_peak", "obs": 10, "severe": 1,
             "weighted_delay_sec": 600.0},
            {"stop_id": "S1", "grain": "weekday", "obs": 14, "severe": 1,
             "weighted_delay_sec": 1080.0},
        ],
        "stop.reliability.dow": [
            {"stop_id": "S1", "day_of_week_iso": 1, "dow_obs": 20, "severe": 2,
             "weighted_delay_sec": 1200.0},
            {"stop_id": "S1", "day_of_week_iso": 7, "dow_obs": 0, "severe": 0,
             "weighted_delay_sec": None},
        ],
        # per-route reliability enumeration.
        "route.spine.route_ids": [("R1",), ("R2",), ("R3",)],
        "route.cancellation.daily": [],
        "route.delay.by_crowding": [],
        "route.occupancy.band_window": [],
        "stop.occupancy.band_window": [],
        "route.service_span.daily": [],
        "route.skipped_stop.daily": [],
        "route.reliability.daily": [
            {"d": datetime.date(2026, 6, 1), "known_obs": 50, "on_time": 45,
             "avg_delay_sec": 90, "severe": 5},
        ],
        "route.headway.observed_by_shift": [],
        "static.dataset_version": [{"dataset_version_id": 1}],
        "static.rep_dates": [
            {"weekday_date": datetime.date(2026, 6, 3), "weekend_date": datetime.date(2026, 6, 6)},
        ],
        "static.active_services": [("svc_wd",)],
        "static.route_schedule": [],
        # S14: scalar habits reads route.habit.spine over an all-time window (route_habit_score
        # mart dropped). Empty here → all-null matrix; route.spine.anchor left unmapped so the
        # windowed §1 by-grain reads stay empty (matching the old fall-through).
        "route.habit.spine": [],
        # DB-0067: stop spine anchor + the distinct-named spine reads.
        "stop.delay.anchor": [{"anchor": datetime.date(2026, 6, 30)}],
        "stop.reliability.by_route": [],
        "stop.reliability.weekly": [
            {"stop_id": "S1", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ],
        "stop.reliability.monthly": [
            {"stop_id": "S1", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ],
        "route.weak_stops.legacy": [
            {"stop_id": "S1", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ],
        "route.weak_stops.by_grain": [
            {"stop_id": "S1", "obs": 10, "severe": 1, "sum_delay_sec": 900},
        ],
        "receipts.accountability": [
            {"provider_local_date": datetime.date(2026, 6, 1),
             "affected_route_count": 3, "affected_stop_count": 12,
             "delayed_trip_count": 45, "severe_delay_count": 5,
             "alert_count": 2, "rider_impact_score": 0.35},
            {"provider_local_date": datetime.date(2026, 6, 2),
             "affected_route_count": 2, "affected_stop_count": 8,
             "delayed_trip_count": 30, "severe_delay_count": 3,
             "alert_count": 1, "rider_impact_score": 0.25},
        ],
        "receipts.worst_route": [],
        "receipts.worst_stop": [],
    }

    class _Conn:
        def __init__(self) -> None:
            self.state_writes: list[dict[str, object]] = []

        def execute(self, statement, params=None):
            name = query_name(statement)
            if name == "publish.state.upsert":
                self.state_writes.append(dict(params))
            return _R(dispatch.get(name, []))

    return _Conn()


def _archive_publish_row() -> dict[str, object]:
    import datetime

    start = datetime.datetime(2026, 7, 8, 12, tzinfo=datetime.UTC)
    return {
        "provider_id": "stm",
        "alert_id": "stm-retained-a",
        "archive_month": datetime.date(2026, 7, 1),
        "header_text": "Métro interrompu",
        "header_text_en": "Metro interrupted",
        "description_text": "Service interrompu.",
        "description_text_en": "Service interrupted.",
        "severity": "WARNING",
        "cause": "TECHNICAL_PROBLEM",
        "effect": "NO_SERVICE",
        "route_ids": ["1"],
        "stop_ids": ["10"],
        "start_utc": start,
        "end_utc": start + datetime.timedelta(hours=1),
        "active_periods": [
            {
                "start_utc": start.isoformat(),
                "end_utc": (start + datetime.timedelta(hours=1)).isoformat(),
            }
        ],
        "url": "https://www.stm.info/alert",
        "first_seen_utc": start,
        "last_seen_utc": start + datetime.timedelta(hours=1),
        "updated_at_utc": start + datetime.timedelta(hours=2),
        "first_available_date": datetime.date(2026, 7, 8),
        "last_available_date": datetime.date(2026, 7, 8),
    }


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


def test_historic_publish_uploads_route_index_after_route_files() -> None:
    """route_reliability/index.json is PUT strictly after every per-route file (staged
    upload: the per-route batch completes before the index stage begins)."""
    from transit_ops.snapshots.publish import _publish_historic

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
        SNAPSHOT_PUBLISH_CONCURRENCY = 8

    store = _OrderTrackingStore()
    conn = _historic_dispatch_conn()
    _publish_historic(conn, store, provider_id="stm", settings=_Settings())

    index_key = "historic/route_reliability/index.json"
    assert index_key in store.keys
    route_positions = [
        i for i, k in enumerate(store.keys)
        if k.startswith("historic/route_reliability/") and k != index_key
    ]
    index_position = store.keys.index(index_key)
    assert route_positions, "expected per-route files to be uploaded"
    assert max(route_positions) < index_position


def test_historic_publish_completes_all_archive_pages_before_stable_index() -> None:
    from transit_ops.snapshots.publish import _publish_historic

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
        SNAPSHOT_PUBLISH_CONCURRENCY = 8

    store = _OrderTrackingStore()
    conn = _historic_dispatch_conn(archive_rows=[_archive_publish_row()])
    _publish_historic(conn, store, provider_id="stm", settings=_Settings())

    page_positions = [
        index
        for index, key in enumerate(store.keys)
        if key.startswith("historic/alerts/generations/")
    ]
    index_position = store.keys.index("historic/alerts/index.json")
    assert page_positions
    assert max(page_positions) < index_position


def test_delayed_concurrent_archive_pages_all_finish_before_index() -> None:
    import datetime

    from transit_ops.snapshots.publish import _publish_historic

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
        SNAPSHOT_PUBLISH_CONCURRENCY = 3

    class _DelayedPages(_OrderTrackingStore):
        def put_immutable_json(self, rel_key: str, payload: object) -> str:
            page_number = int(rel_key.rsplit("page-", 1)[1][:4])
            time.sleep(0.004 * (4 - page_number))
            return super().put_immutable_json(rel_key, payload)

    base = _archive_publish_row()
    archive_rows = []
    for number in range(501):
        row = dict(base)
        row["alert_id"] = f"stm-retained-{number:04d}"
        row["start_utc"] = base["start_utc"] + datetime.timedelta(minutes=number)
        row["end_utc"] = base["end_utc"] + datetime.timedelta(minutes=number)
        row["first_seen_utc"] = row["start_utc"]
        row["last_seen_utc"] = row["end_utc"]
        row["updated_at_utc"] = row["end_utc"]
        row["active_periods"] = [
            {
                "start_utc": row["start_utc"].isoformat(),
                "end_utc": row["end_utc"].isoformat(),
            }
        ]
        archive_rows.append(row)

    store = _DelayedPages()
    _publish_historic(
        _historic_dispatch_conn(archive_rows=archive_rows),
        store,
        provider_id="stm",
        settings=_Settings(),
    )

    pages = [
        index
        for index, key in enumerate(store.keys)
        if key.startswith("historic/alerts/generations/")
    ]
    assert len(pages) == 3
    assert max(pages) < store.keys.index("historic/alerts/index.json")


def test_historic_archive_page_failure_never_replaces_stable_index() -> None:
    from transit_ops.snapshots.publish import _publish_historic

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
        SNAPSHOT_PUBLISH_CONCURRENCY = 8

    class _FailingPageStore(_OrderTrackingStore):
        def put_immutable_json(self, rel_key: str, payload: object) -> str:
            raise RuntimeError("archive page upload failed")

    store = _FailingPageStore()
    store.store["historic/alerts/index.json"] = b'{"old":true}'
    conn = _historic_dispatch_conn(archive_rows=[_archive_publish_row()])

    with pytest.raises(RuntimeError, match="archive page upload failed"):
        _publish_historic(conn, store, provider_id="stm", settings=_Settings())

    assert store.store["historic/alerts/index.json"] == b'{"old":true}'
    assert "historic/alerts/index.json" not in store.keys


def test_historic_publish_counts_archive_pages_physically_but_not_in_stable_baseline() -> None:
    from transit_ops.snapshots.publish import publish_snapshot

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
        SNAPSHOT_PUBLISH_CONCURRENCY = 8

    store = _OrderTrackingStore()
    conn = _historic_dispatch_conn(archive_rows=[_archive_publish_row()])
    result = publish_snapshot(
        "stm",
        tier="historic",
        settings=_Settings(),
        engine=_FakeEngine(conn),
        storage=store,
    )

    page_keys = [
        key for key in result.keys_written if key.startswith("historic/alerts/generations/")
    ]
    assert len(page_keys) == 1
    assert len(conn.state_writes) == 1
    state = conn.state_writes[0]
    assert state["written"] == len(result.keys_written)
    assert state["total"] == len(result.keys_written)
    assert state["stable_total"] == state["total"] - len(page_keys)
    hash_state = store.get_json("_meta/publish_state_historic.json")
    assert all(key not in hash_state["hashes"] for key in page_keys)


@pytest.mark.parametrize("failure", ["page", "index"])
def test_archive_page_or_index_failure_does_not_flush_hash_or_db_state(failure: str) -> None:
    from transit_ops.snapshots.publish import publish_snapshot

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
        SNAPSHOT_PUBLISH_CONCURRENCY = 8

    class _FailingInner(_OrderTrackingStore):
        def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
            is_page = rel_key.startswith("historic/alerts/generations/")
            is_index = rel_key == "historic/alerts/index.json"
            if (failure == "page" and is_page) or (failure == "index" and is_index):
                raise RuntimeError(f"archive {failure} upload failed")
            return super().put_bytes(rel_key, body, tier=tier)

    store = _FailingInner()
    old_index = b'{"old":true}'
    store.store["historic/alerts/index.json"] = old_index
    conn = _historic_dispatch_conn(archive_rows=[_archive_publish_row()])

    with pytest.raises(RuntimeError, match=f"archive {failure} upload failed"):
        publish_snapshot(
            "stm",
            tier="historic",
            settings=_Settings(),
            engine=_FakeEngine(conn),
            storage=store,
        )

    assert store.store["historic/alerts/index.json"] == old_index
    assert "_meta/publish_state_historic.json" not in store.store
    assert conn.state_writes == []


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
    """Static fake conn yielding a few routes (no stops) for parallel coverage.

    Dispatches on the `-- q:<name>` registry marker; unmapped names fall through
    to []. Only R1 has spine history, so its routes_index entry gets
    reliability=True.
    """

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        import datetime as _dt

        from transit_ops.sql_registry import query_name

        route_row = [
            {"route_id": "R1", "route_short_name": "1", "route_long_name": "One",
             "route_color": "009EE0", "route_type": 3}
        ]
        stop_row = [
            {"stop_id": "S1", "stop_code": "S1", "stop_name": "Stop",
             "stop_lat": 45.0, "stop_lon": -73.0}
        ]
        rows = {
            "publish.static_stamp": [
                {"loaded_at_utc": _dt.datetime(2026, 6, 1, tzinfo=_dt.UTC)}
            ],
            "static.reliability_route_ids": [{"route_id": "R1"}],
            "route.spine.route_ids": [{"route_id": "R1"}],
            "static.dim_route_ids": [
                {"route_id": "R1"}, {"route_id": "R2"}, {"route_id": "R3"}
            ],
            "static.routes_index": route_row,
            "static.stops_index": stop_row,
            # static.all_stops stays unmapped -> [] (the pre-migration needle
            # never matched it; its consumer requires wheelchair_boarding).
            "static.labels": [{"label_key": "k", "label_fr": "f", "label_en": "e"}],
            "static.dataset_version": [{"dataset_version_id": 1}],
            "manifest.version": [{"dataset_version_id": 1}],
            "static.rep_dates": [
                {"weekday_date": _dt.date(2026, 6, 3), "weekend_date": _dt.date(2026, 6, 6)}
            ],
            "static.route_name_type": [{"route_long_name": "One", "route_type": 3}],
        }
        return _StaticResult(rows.get(query_name(statement), []))


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
