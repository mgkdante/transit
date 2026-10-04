
from __future__ import annotations

from contextlib import contextmanager

import pytest
from snapshot_storage_fixtures import MemorySnapshotStore

from transit_ops.snapshots import envelope, historic_compatibility, historic_receipts, historic_tier
from transit_ops.snapshots.builders.historic.route_reliability_batch import (
    _ROUTE_INVENTORY_SQL,
)
from transit_ops.snapshots.publish import PublishResult, publish_snapshot
from transit_ops.sql_registry import query_name


class FakeResult:

    def mappings(self) -> FakeResult:
        return self

    def all(self):
        return []

    def __iter__(self):
        return iter([])

    def scalar_one(self) -> int:
        return 0

    def scalar(self) -> int:
        return 0


class FakeConn:

    def execute(self, statement, params=None):  # noqa: ANN001
        if query_name(statement) == "publish.lock.try_acquire":
            return NamedRowsResult([True])
        return FakeResult()


class FakeEngine:

    def begin(self):  # noqa: ANN201
        @contextmanager
        def _cm():
            yield FakeConn()

        return _cm()


class NamedRowsResult:
    def __init__(self, rows):  # noqa: ANN001
        self._rows = list(rows)

    def mappings(self):  # noqa: ANN201
        return self

    def __iter__(self):
        return iter(self._rows)

    def fetchone(self):  # noqa: ANN201
        return self._rows[0] if self._rows else None

    def fetchall(self):  # noqa: ANN201
        return list(self._rows)

    def scalar_one(self):  # noqa: ANN201
        return self._rows[0] if self._rows else 0


class RecordingNamedConn:
    def __init__(self, responses):  # noqa: ANN001
        self.responses = responses
        self.queries: list[str | None] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        name = query_name(statement)
        self.queries.append(name)
        return NamedRowsResult(self.responses.get(name, []))


class FakeStore:

    def __init__(self) -> None:
        self.keys: list[str] = []
        self.tiers: list[str] = []
        self.payloads: list[object] = []

    def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:
        self.keys.append(rel_key)
        self.tiers.append(tier)
        self.payloads.append(payload)
        return rel_key


class CloseTrackingStore(FakeStore):
    def __init__(self, *, fail_on_write: bool = False) -> None:
        super().__init__()
        self.fail_on_write = fail_on_write
        self.close_calls = 0

    def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:
        if self.fail_on_write:
            raise RuntimeError("snapshot write failed")
        return super().put_json(rel_key, payload, tier=tier)

    def close(self) -> None:
        self.close_calls += 1


class StatefulFakeStore(MemorySnapshotStore):

    def __init__(self) -> None:
        super().__init__()
        self.keys: list[str] = []
        self.store = self.objects
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

    SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"


def test_publish_live_uploads_all_files_manifest_last() -> None:
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
        "status/data_health.json",
        "manifest.json",
    ]
    assert set(store.keys[:-1]) == set(expected_keys[:-1]), f"got {store.keys}"
    assert store.keys[-1] == "manifest.json"
    assert store.keys.index("live/stop_departures.json") < store.keys.index("manifest.json")
    assert store.keys.index("status/data_health.json") < store.keys.index("manifest.json")
    assert store.tiers == ["live"] * len(expected_keys)

    assert isinstance(res, PublishResult)
    assert res.provider_id == "stm"
    assert res.tier == "live"
    assert res.keys_written == expected_keys


@pytest.mark.parametrize("fail_on_write", [False, True])
def test_publish_closes_internally_constructed_storage(
    monkeypatch: pytest.MonkeyPatch,
    fail_on_write: bool,
) -> None:
    from transit_ops.snapshots import publish as snapshot_publish

    store = CloseTrackingStore(fail_on_write=fail_on_write)
    monkeypatch.setattr(
        snapshot_publish,
        "build_snapshot_storage",
        lambda *_args, **_kwargs: store,
    )

    if fail_on_write:
        with pytest.raises(RuntimeError, match="snapshot write failed"):
            snapshot_publish.publish_snapshot(
                "stm",
                tier="live",
                settings=FakeSettings(),
                engine=FakeEngine(),
            )
    else:
        snapshot_publish.publish_snapshot(
            "stm",
            tier="live",
            settings=FakeSettings(),
            engine=FakeEngine(),
        )

    assert store.close_calls == 1


@pytest.mark.parametrize("fail_on_write", [False, True])
def test_publish_never_closes_caller_owned_storage(fail_on_write: bool) -> None:
    store = CloseTrackingStore(fail_on_write=fail_on_write)

    if fail_on_write:
        with pytest.raises(RuntimeError, match="snapshot write failed"):
            publish_snapshot(
                "stm",
                tier="live",
                settings=FakeSettings(),
                engine=FakeEngine(),
                storage=store,
            )
    else:
        publish_snapshot(
            "stm",
            tier="live",
            settings=FakeSettings(),
            engine=FakeEngine(),
            storage=store,
        )

    assert store.close_calls == 0


def test_publish_live_stamps_h4_envelope_on_every_payload() -> None:
    store = FakeStore()
    publish_snapshot(
        "stm", tier="live", settings=FakeSettings(), engine=FakeEngine(), storage=store
    )
    gen_ids = {p.publish_generation_id for p in store.payloads}
    assert len(gen_ids) == 1
    gen_id = next(iter(gen_ids))
    assert gen_id is not None and gen_id.startswith("stm@")
    for p in store.payloads:
        assert p.methodology_version is not None
        assert p.schema_version == 1


def test_collect_payloads_stamps_h4_envelope() -> None:
    from transit_ops.snapshots.contract import PayloadEnvelope
    from transit_ops.snapshots.publish import collect_payloads

    class _ConnectEngine:
        def connect(self):  # noqa: ANN202
            @contextmanager
            def _cm():
                yield FakeConn()

            return _cm()

    items, _routes, _stamp, _prior = collect_payloads(
        "stm", tier="live", settings=FakeSettings(), engine=_ConnectEngine()
    )
    envelopes = [p for (_k, p) in items if isinstance(p, PayloadEnvelope)]
    assert envelopes, "expected at least one PayloadEnvelope in collected live items"
    gen_ids = {p.publish_generation_id for p in envelopes}
    assert len(gen_ids) == 1 and next(iter(gen_ids)) is not None
    for p in envelopes:
        assert p.methodology_version is not None


def test_publish_result_display_dict() -> None:
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
    assert len(d["keys_written"]) == 7


def test_publish_rejects_unimplemented_tier() -> None:
    with pytest.raises(ValueError, match="unknown tier"):
        publish_snapshot(
            "stm",
            tier="unknown_tier",
            settings=FakeSettings(),
            engine=FakeEngine(),
            storage=FakeStore(),
        )


def test_full_historic_rebuild_rejects_non_historic_before_io(monkeypatch) -> None:
    from transit_ops.snapshots import publish as snapshot_publish

    def forbidden(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        raise AssertionError("non-historic full-rebuild rejection must precede I/O setup")

    monkeypatch.setattr(snapshot_publish, "get_settings", forbidden)
    monkeypatch.setattr(snapshot_publish, "make_engine", forbidden)
    monkeypatch.setattr(snapshot_publish, "build_snapshot_storage", forbidden)

    for tier in ("live", "static"):
        with pytest.raises(ValueError, match="requires tier='historic'"):
            snapshot_publish.publish_snapshot(
                "stm",
                tier=tier,
                full_historic_rebuild=True,
            )


@pytest.mark.parametrize(
    ("evidence_available", "failure_at"),
    [(False, None), (True, None), (True, "entry"), (True, "write"), (True, "release")],
)
def test_historic_phase_ledger_and_receipt_savepoint_are_exclusive_and_isolated(
    monkeypatch, evidence_available, failure_at,
) -> None:
    from types import SimpleNamespace

    from transit_ops.snapshots import publish as snapshot_publish

    observation_fields = historic_receipts._HistoricPartitionObservation.__dataclass_fields__
    assert "partition" not in observation_fields
    assert {"ref", "raw_day_count", "detached_summary"} <= set(observation_fields)

    empty_one_entity = historic_receipts.HistoryScopeCardinality(
        entity_count=1,
        month_count=0,
        dense_scope_count=0,
        observed_scope_count=0,
    )
    assert historic_receipts._receipt_cardinality_mapping(
        "network",
        empty_one_entity,
        (),
    )[1]
    assert not historic_receipts._receipt_cardinality_mapping(
        "lines",
        empty_one_entity,
        (),
    )[1]
    assert not historic_receipts._receipt_cardinality_mapping(
        "stops",
        empty_one_entity,
        (),
    )[1]

    class Clock:
        def __init__(self) -> None:
            self.value = 0

        def __call__(self) -> int:
            current = self.value
            self.value += 10
            return current

    batch_ledger = snapshot_publish._HistoricPhaseLedger(clock=Clock())
    batch_run = SimpleNamespace(ledger=batch_ledger)

    def lazy_batch():
        with batch_ledger.phase("source_digest"):
            pass
        yield object(), object()

    _, _, batch_scope_build_ns = historic_receipts._next_historic_partition(
        iter(lazy_batch()),
        batch_run,
    )
    assert batch_ledger.phase_ns["build"] > 0
    assert batch_ledger.phase_ns["source_digest"] > 0
    assert batch_scope_build_ns == 0

    class Result:
        def mappings(self):
            return self

        def all(self):
            return list(self.rows)

        def __init__(self, rows=()):  # noqa: ANN001
            self.rows = list(rows)

        def fetchone(self):  # noqa: ANN201
            return self.rows[0] if self.rows else None

        def scalar_one(self):  # noqa: ANN201
            return self.rows[0][0] if self.rows else 0

    events: list[str] = []
    state_params: list[dict[str, object]] = []

    class Connection:
        def execute(self, statement, params=None):  # noqa: ANN001, ANN201
            name = query_name(statement)
            if name == "publish.lock.try_acquire":
                return Result([(True,)])
            if name == "publish.prior_files_total":
                return Result()
            if name == "publish.state.upsert":
                events.append("state_upsert")
                state_params.append(dict(params))
            return Result()

        @contextmanager
        def begin_nested(self):
            events.append("savepoint_begin")
            if failure_at == "entry":
                raise RuntimeError("savepoint entry failed")
            try:
                yield self
                if failure_at == "release":
                    raise RuntimeError("savepoint release failed")
            except Exception:
                events.append("savepoint_rollback")
                raise
            else:
                events.append("savepoint_commit")

    connection = Connection()

    class Engine:
        def begin(self):  # noqa: ANN201
            @contextmanager
            def transaction():
                events.append("outer_begin")
                try:
                    yield connection
                except Exception:
                    events.append("outer_rollback")
                    raise
                else:
                    events.append("outer_commit")

            return transaction()

    ledger = snapshot_publish._HistoricPhaseLedger(clock=Clock())
    monkeypatch.setattr(
        snapshot_publish,
        "_HistoricPhaseLedger",
        lambda: ledger,
    )
    monkeypatch.setattr(
        historic_tier,
        "publication_stamp",
        lambda: "2026-07-29T00:00:00Z",
    )

    def publish_historic(_conn, storage, *, _historic_run, **_kwargs):  # noqa: ANN001
        with _historic_run.ledger.phase("build"):
            with _historic_run.ledger.phase("source_digest"):
                pass
        for scope_class in (
            "retention_edge",
            "mutable_edge",
            "settled_candidate",
        ):
            _historic_run.ledger.observe_scope("network", scope_class)
            _historic_run.ledger.add_scope_detail_ns(
                "network",
                scope_class,
                "partition_materialize",
                1,
            )
            with _historic_run.ledger.phase(
                "gate",
                family="network",
                scope_class=scope_class,
                scope_metric="child_gate",
            ):
                pass
            _historic_run.observations["network"].append(SimpleNamespace(scope_class=scope_class))
        _historic_run.receipt_evidence_available = evidence_available
        _historic_run.receipt_cardinality_gate_passed = True
        _historic_run.receipt_scope_cardinality = {
            "network": {
                "entity_count": 1,
                "observed_scope_count": 3,
                "cardinality_gate_passed": True,
            }
        }
        _historic_run.entity_receipts = [SimpleNamespace(scope_count=3)]
        _historic_run.complete_receipt_families = ("network", "lines", "stops")
        _historic_run.receipt_rows_attempted = 1
        _historic_run.receipt_json_bytes_attempted = 100
        storage.put_json(
            "historic/phase-ledger-fixture.json",
            {"fixture": True},
            tier="historic",
        )
        return ["historic/phase-ledger-fixture.json"]

    def persist_receipts(*_args, **_kwargs):
        events.append("receipt_write")
        if failure_at == "write":
            raise RuntimeError("receipt write failed")
        return historic_receipts.HistoricReceiptPersistenceStats(1, 1, 100, 100, 7, 11)

    monkeypatch.setattr(historic_tier, "publish", publish_historic)
    monkeypatch.setattr(
        historic_receipts,
        "persist_historic_receipts",
        persist_receipts,
    )

    result = snapshot_publish.publish_snapshot(
        "stm",
        tier="historic",
        settings=FakeSettings(),
        engine=Engine(),
        storage=StatefulFakeStore(),
        gate_enabled=False,
    )

    telemetry = result.historic_telemetry
    assert telemetry is not None
    assert telemetry["phase_ns"]["build"] == 20
    assert telemetry["phase_ns"]["source_digest"] == 10
    assert telemetry["publish_total_ns"] == sum(telemetry["phase_ns"].values())
    assert telemetry["other_ms"] >= 0
    assert {
        scope_class: detail["scopes_rebuilt"]
        for scope_class, detail in telemetry["family_scope_detail"]["network"].items()
    } == {
        "retention_edge": 1,
        "mutable_edge": 1,
        "settled_candidate": 1,
    }
    assert telemetry["receipt_rows_attempted"] == 1
    changed = int(evidence_available and failure_at is None)
    assert telemetry["receipt_rows_changed"] == changed
    assert telemetry["receipt_json_bytes_attempted"] == 100
    assert telemetry["receipt_json_bytes_changed"] == changed * 100
    assert telemetry["receipt_persist_failed"] is (failure_at is not None)
    assert telemetry["timing_complete"] is True
    receipt_events = {
        None: ["savepoint_begin", "receipt_write", "savepoint_commit"],
        "entry": ["savepoint_begin"],
        "write": ["savepoint_begin", "receipt_write", "savepoint_rollback"],
        "release": ["savepoint_begin", "receipt_write", "savepoint_rollback"],
    }[failure_at] if evidence_available else []
    assert events == ["outer_begin", *receipt_events, "state_upsert", "outer_commit"]
    assigned_stats = evidence_available and failure_at not in {"entry", "write"}
    assert telemetry["stale_receipt_entities_deleted"] == (7 if assigned_stats else 0)
    assert telemetry["stale_receipt_months_deleted"] == (11 if assigned_stats else 0)
    assert "outer_rollback" not in events
    assert len(state_params) == 1
    assert state_params[0]["historic_phase_detail"]["timing_complete"] is False
    assert state_params[0]["historic_receipt_rows_attempted"] == 1
    assert state_params[0]["historic_receipt_rows_changed"] == changed


def test_publish_accepts_registry_kwarg() -> None:
    store = FakeStore()
    res = publish_snapshot(
        "stm",
        tier="live",
        settings=FakeSettings(),
        engine=FakeEngine(),
        storage=store,
        registry=object(),
    )
    assert res.tier == "live"
    assert len(store.keys) == 7


def test_publish_static_writes_expected_keys() -> None:
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

                def all(self):
                    return list(outer._rows)

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

    import datetime as _dt

    dispatch = {
        "publish.lock.try_acquire": [True],
        "publish.static_stamp": [
            {"loaded_at_utc": _dt.datetime(2026, 6, 1, 0, 0, tzinfo=_dt.UTC)},
        ],
        "static.reliability_route_ids": [{"route_id": "165"}],
        "static.routes_index": [
            {
                "route_id": "165",
                "route_short_name": "165",
                "route_long_name": "Côte-Vertu",
                "route_color": "009EE0",
                "route_type": 3,
            }
        ],
        "static.stops_index": [
            {
                "stop_id": "51234",
                "stop_code": "51234",
                "stop_name": "Côte-Vertu",
                "stop_lat": 45.49,
                "stop_lon": -73.66,
            }
        ],
        "static.labels": [
            {"label_key": "network_health", "label_fr": "Santé", "label_en": "Health"}
        ],
        "static.dataset_version": [{"dataset_version_id": 1}],
        "static.rep_dates": [
            {"weekday_date": datetime.date(2026, 6, 3), "weekend_date": datetime.date(2026, 6, 6)}
        ],
        "static.active_services": [("svc_wd",)],
        "static.all_route_metadata": [
            {"route_id": "165", "route_long_name": "Côte-Vertu", "route_type": 3}
        ],
        "static.all_route_shapes": [],
        "static.all_route_stops": [],
        "static.all_route_schedules": [],
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
    assert not any(k.startswith("static/stops/") for k in written)
    assert "static/basemap.json" in written
    assert "_meta/publish_state_static.json" in store.store
    import json as _json

    ri = _json.loads(store.store["static/routes_index.json"])
    assert ri["generated_utc"] == "2026-06-01T00:00:00Z"
    assert ri["routes"][0]["id"] == "165"
    assert ri["routes"][0]["reliability"] is True


def test_publish_static_hoists_schedule_context_for_two_routes() -> None:
    import datetime

    from transit_ops.snapshots.publish import _publish_static

    conn = RecordingNamedConn(
        {
            "static.dataset_version": [{"dataset_version_id": 1}],
            "static.rep_dates": [
                {
                    "weekday_date": datetime.date(2026, 6, 3),
                    "weekend_date": datetime.date(2026, 6, 6),
                }
            ],
            "static.active_services": [("svc",)],
            "static.all_route_metadata": [
                {"route_id": "202", "route_long_name": "Route 202", "route_type": 3},
                {"route_id": "101", "route_long_name": "Route 101", "route_type": 3},
            ],
            "static.all_route_shapes": [],
            "static.all_route_stops": [],
            "static.all_route_schedules": [],
            "static.all_stops": [
                {
                    "stop_id": "S1",
                    "stop_code": "S1",
                    "stop_name": "Stop 1",
                    "stop_lat": 45.5,
                    "stop_lon": -73.5,
                    "wheelchair_boarding": 1,
                }
            ],
            "static.all_stop_schedules": [],
        }
    )

    class SequentialSettings(FakeSettings):
        SNAPSHOT_PUBLISH_CONCURRENCY = 1

    store = FakeStore()
    _publish_static(
        conn,
        store,
        provider_id="stm",
        settings=SequentialSettings(),
        stamp="t",
    )

    assert (
        conn.queries.count("static.dataset_version"),
        conn.queries.count("static.rep_dates"),
        conn.queries.count("static.active_services"),
    ) == (1, 1, 2)
    assert [
        conn.queries.count(name)
        for name in (
            "static.all_route_metadata",
            "static.all_route_shapes",
            "static.all_route_stops",
            "static.all_route_schedules",
        )
    ] == [1, 1, 1, 1]
    assert {
        "static.dim_route_ids",
        "static.route_name_type",
        "static.route_shapes",
        "static.route_stops",
        "static.route_schedule",
    }.isdisjoint(conn.queries)

    route_keys = [key for key in store.keys if key.startswith("static/routes/")]
    stop_keys = [key for key in store.keys if key.startswith("static/stops/")]
    assert route_keys == ["static/routes/101.json", "static/routes/202.json"]
    assert stop_keys == ["static/stops/S1.json"]
    assert store.keys.index(route_keys[-1]) < store.keys.index(stop_keys[0])
    payload_by_key = dict(zip(store.keys, store.payloads, strict=True))
    for key in route_keys:
        assert payload_by_key[key].methodology_version == "static-1"
        assert payload_by_key[key].publish_generation_id == "stm@t"


def test_publish_static_route_hash_gate_keeps_identical_bytes_and_rewrites_only_change() -> None:
    import json

    from transit_ops.snapshots.publish import _publish_static
    from transit_ops.snapshots.storage import HashGatedStorage, state_fingerprint

    class SequentialSettings(FakeSettings):
        SNAPSHOT_PUBLISH_CONCURRENCY = 1

    def route_conn(long_name):  # noqa: ANN001, ANN202
        return RecordingNamedConn(
            {
                "static.dataset_version": [{"dataset_version_id": 1}],
                "static.rep_dates": [],
                "static.all_route_metadata": [
                    {"route_id": "101", "route_long_name": long_name, "route_type": 3}
                ],
                "static.all_route_shapes": [],
                "static.all_route_stops": [],
                "static.all_route_schedules": [],
            }
        )

    inner = StatefulFakeStore()
    state_key = "_meta/publish_state_static.json"
    fingerprint = state_fingerprint("static")

    first = HashGatedStorage(inner, state_rel_key=state_key, fingerprint=fingerprint)
    first.load()
    _publish_static(
        route_conn("Route 101"),
        first,
        provider_id="stm",
        settings=SequentialSettings(),
        stamp="t",
    )
    first.flush_state()
    original_route_bytes = inner.store["static/routes/101.json"]

    identical = HashGatedStorage(inner, state_rel_key=state_key, fingerprint=fingerprint)
    identical.load()
    _publish_static(
        route_conn("Route 101"),
        identical,
        provider_id="stm",
        settings=SequentialSettings(),
        stamp="t",
    )
    assert identical.written == []
    assert "static/routes/101.json" in identical.skipped
    assert inner.store["static/routes/101.json"] == original_route_bytes

    changed = HashGatedStorage(inner, state_rel_key=state_key, fingerprint=fingerprint)
    changed.load()
    _publish_static(
        route_conn("Changed route"),
        changed,
        provider_id="stm",
        settings=SequentialSettings(),
        stamp="t",
    )
    assert changed.written == ["static/routes/101.json"]
    assert set(changed.skipped) == {
        "static/basemap.json",
        "static/routes_index.json",
        "static/stops_index.json",
        "labels/fr.json",
        "labels/en.json",
    }
    assert inner.store["static/routes/101.json"] != original_route_bytes
    assert json.loads(inner.store[state_key])["fingerprint"] == fingerprint


def test_publish_historic_hoists_name_catalogs_for_two_routes(monkeypatch) -> None:
    from types import SimpleNamespace

    from transit_ops.snapshots import publish as snapshot_publish

    conn = RecordingNamedConn(
        {
            "route.spine.route_ids": [("101",), ("202",)],
            "static.route_names": [
                {"route_id": "101", "route_name": "Route 101"},
                {"route_id": "202", "route_name": "Route 202"},
            ],
            "static.stop_names": [{"stop_id": "S1", "stop_name": "Stop 1"}],
        }
    )

    for name in (
        "build_network_trend",
        "build_hotspots",
        "build_repeat_offenders",
        "build_alert_history",
        "build_provenance",
    ):
        monkeypatch.setattr(snapshot_publish.builders, name, lambda *args, **kwargs: object())
    monkeypatch.setattr(
        snapshot_publish.builders,
        "build_stop_reliability",
        lambda *args, **kwargs: {},
    )
    monkeypatch.setattr(snapshot_publish.builders, "build_receipts", lambda *args, **kwargs: {})
    monkeypatch.setattr(
        snapshot_publish.builders,
        "build_alert_archive",
        lambda *args, **kwargs: SimpleNamespace(page_items=[], index=object()),
    )

    historic_compatibility._build_items(
        conn,
        provider_id="stm",
        settings=FakeSettings(),
        stamp="t",
    )

    assert (
        conn.queries.count("static.route_names"),
        conn.queries.count("static.stop_names"),
    ) == (1, 1)


def test_publish_historic_writes_expected_keys_and_network_history(tmp_path) -> None:
    import datetime
    import pathlib
    from contextlib import contextmanager

    from transit_ops.snapshots.contract import NetworkTrend
    from transit_ops.snapshots.historic_tier import publish as _publish_historic
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    class _FakeResult:
        def __init__(self, rows):
            self._rows = list(rows)

        def mappings(self):
            outer = self

            class M:
                def fetchone(self):
                    return outer._rows[0] if outer._rows else None

                def all(self):
                    return list(outer._rows)

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

    dispatch = {
        "publish.lock.try_acquire": [True],
        "history.hotspots.timezone": [{"timezone": "UTC"}],
        "history.hotspots.names": [],
        "history.hotspots.route_daily": [],
        "history.hotspots.stop_daily": [],
        "history.repeat_offenders.timezone": [{"timezone": "UTC"}],
        "history.repeat_offenders.names": [],
        "history.repeat_offenders.daily": [],
        "history.network.delay": [
            {
                "local_date": datetime.date(2026, 6, 1),
                "observation_count": 10,
                "in_clamp_observation_count": 8,
                "on_time_count": 7,
                "severe_count": 1,
                "sum_delay_seconds": 240,
                "source_generated_utc": datetime.datetime(2026, 6, 2, 1, tzinfo=datetime.UTC),
            }
        ],
        "history.network.fact": [],
        "history.network.cancellation": [],
        "history.network.occupancy": [],
        "receipts.network_daily": [
            {
                "local_date": datetime.date(2025, 1, 1),
                "known_obs": 80,
                "on_time": 68,
                "severe": 4,
                "pooled_delay_sec": 4000,
                "inclamp_obs": 80,
            },
            {
                "local_date": datetime.date(2026, 6, 1),
                "known_obs": 100,
                "on_time": 90,
                "severe": 5,
                "pooled_delay_sec": 5000,
                "inclamp_obs": 100,
            },
        ],
        "network.trend.daily_hourly": [
            {
                "local_date": datetime.date(2026, 6, 1),
                "known_obs": 100,
                "on_time": 90,
                "pooled_delay_sec": 5000,
                "inclamp_obs": 100,
            },
        ],
        "network.trend.daily_p90": [
            {"local_date": datetime.date(2026, 6, 1), "p90_min": 3.5, "vehicles": 42},
        ],
        "network.trend.week_hourly": [
            {
                "local_date": datetime.date(2026, 6, 1),
                "known_obs": 200,
                "on_time": 180,
                "pooled_delay_sec": 12000,
                "inclamp_obs": 200,
            },
        ],
        "network.trend.week_cancel": [
            {"local_date": datetime.date(2026, 6, 1), "canceled": 4, "total": 200},
        ],
        "network.trend.week_occupancy": [
            {
                "local_date": datetime.date(2026, 6, 1),
                "empty": 0,
                "many_seats": 60,
                "few_seats": 25,
                "standing": 10,
                "full": 5,
            },
        ],
        "network.trend.month_hourly": [
            {
                "local_date": datetime.date(2026, 6, 1),
                "known_obs": 1000,
                "on_time": 820,
                "pooled_delay_sec": 90000,
                "inclamp_obs": 1000,
            },
        ],
        "network.trend.month_cancel": [
            {"local_date": datetime.date(2026, 6, 1), "canceled": 12, "total": 600},
        ],
        "network.trend.month_occupancy": [
            {
                "local_date": datetime.date(2026, 6, 1),
                "empty": 10,
                "many_seats": 40,
                "few_seats": 30,
                "standing": 15,
                "full": 5,
            },
        ],
        "hotspots.list": [
            {
                "entity_kind": "route",
                "entity_id": "165",
                "issue_count": 5,
                "severity_label": "high",
            },
        ],
        "repeat.offenders": [
            {
                "entity_kind": "route",
                "entity_id": "165",
                "route_id": "165",
                "recurrence_days": 7,
                "window_days": 30,
                "avg_delay_seconds": 180,
                "severity_label": "high",
            },
        ],
        "alerts.history": [
            {
                "alert_header_text": "Votre ligne",
                "header_text_en": None,
                "alert_id": None,
                "severity": "WARNING",
                "routes": ["165"],
                "stops": ["51234"],
                "start_utc": datetime.datetime(2026, 6, 1, 8, 0, tzinfo=datetime.UTC),
                "end_utc": datetime.datetime(2026, 6, 1, 9, 0, tzinfo=datetime.UTC),
            },
        ],
        "alerts.archive.publish": [],
        "provenance.sources": [
            {
                "dataset_kind": "static_schedule",
                "storage_backend": "s3",
                "storage_path": "bucket/path",
                "source_url": None,
                "loaded_at_utc": datetime.datetime(2026, 6, 1, 0, 0, tzinfo=datetime.UTC),
            },
        ],
        "provenance.freshness": [
            {"endpoint_key": "vehicle_positions", "status": "ok", "completed_age_seconds": 30},
        ],
        "static.stop_names": [
            {"stop_id": "51234", "stop_name": "Côte-Vertu"},
        ],
        "static.route_names": [
            {"route_id": "165", "route_name": "Ligne 165"},
        ],
        "stop.reliability.by_grain": [
            {
                "stop_id": "51234",
                "grain": "am_peak",
                "obs": 10,
                "severe": 1,
                "weighted_delay_sec": 600.0,
            },
            {
                "stop_id": "51234",
                "grain": "weekday",
                "obs": 14,
                "severe": 1,
                "weighted_delay_sec": 1080.0,
            },
        ],
        "stop.reliability.dow": [
            {
                "stop_id": "51234",
                "day_of_week_iso": 1,
                "dow_obs": 20,
                "severe": 2,
                "weighted_delay_sec": 1200.0,
            },
            {
                "stop_id": "51234",
                "day_of_week_iso": 7,
                "dow_obs": 0,
                "severe": 0,
                "weighted_delay_sec": None,
            },
        ],
        "route.spine.route_ids": [
            ("101",),
            ("202",),
        ],
        "route.cancellation.daily": [
            {
                "provider_local_date": datetime.date(2026, 6, 1),
                "cancellation_rate_pct": 2.5,
                "canceled_trip_days": 3,
                "total_trip_days": 120,
                "scheduled_trip_days": 130,
                "delivered_trip_days": 117,
                "silent_trip_days": 10,
                "service_completeness_pct": 90.0,
            },
        ],
        "route.delay.by_crowding": [
            {
                "band": "many_seats",
                "delay_obs": 40,
                "sum_delay_sec": 3600.0,
                "w_p50_sec": None,
                "p50_obs": 0,
                "day_count": 1,
            },
        ],
        "route.occupancy.by_dow": [
            {
                "day_of_week_iso": 1,
                "empty": 0,
                "many_seats": 50,
                "few_seats": 30,
                "standing": 15,
                "full": 5,
            },
            {
                "day_of_week_iso": 6,
                "empty": 40,
                "many_seats": 30,
                "few_seats": 20,
                "standing": 10,
                "full": 0,
            },
        ],
        "route.occupancy.by_grain": [
            {
                "d": datetime.date(2026, 6, 1),
                "empty": 0,
                "many_seats": 50,
                "few_seats": 30,
                "standing": 15,
                "full": 5,
            },
        ],
        "route.occupancy.band_window": [
            {"empty": 0, "many_seats": 50, "few_seats": 30, "standing": 15, "full": 5},
        ],
        "stop.occupancy.band_window": [
            {
                "stop_id": "51234",
                "empty": 0,
                "many_seats": 50,
                "few_seats": 30,
                "standing": 15,
                "full": 5,
            },
        ],
        "route.service_span.daily": [
            {
                "provider_local_date": datetime.date(2026, 6, 1),
                "first_trip_start_utc": datetime.datetime(2026, 6, 1, 10, 0, tzinfo=datetime.UTC),
                "last_trip_start_utc": datetime.datetime(2026, 6, 2, 1, 0, tzinfo=datetime.UTC),
                "service_span_min": 900,
                "first_trip_delay_seconds": 30,
                "last_trip_delay_seconds": 90,
                "trip_count": 120,
            },
        ],
        "route.skipped_stop.daily": [
            {
                "provider_local_date": datetime.date(2026, 6, 1),
                "skipped_stop_rate_pct": 3.94,
                "skipped_stop_count": 12,
                "stop_time_update_count": 305,
            },
        ],
        "route.reliability.daily": [
            {
                "d": datetime.date(2026, 6, 1),
                "known_obs": 50,
                "on_time": 45,
                "avg_delay_sec": 90,
                "severe": 5,
            },
        ],
        "route.headway.observed_by_shift": [
            {"shift": "am_peak", "observed_headway_min": 8.0, "sample_count": 20},
        ],
        "static.dataset_version": [{"dataset_version_id": 1}],
        "static.rep_dates": [
            {"weekday_date": datetime.date(2026, 6, 3), "weekend_date": datetime.date(2026, 6, 6)},
        ],
        "static.active_services": [("svc_wd",)],
        "static.route_schedule": [],
        "route.spine.anchor": [{"anchor": datetime.date(2026, 6, 30)}],
        "route.habit.spine": [
            {
                "day_of_week_iso": 1,
                "hour_of_day_local": 8,
                "repeat_problem_score": 0.7,
                "known_obs": 0,
            },
        ],
        "stop.delay.anchor": [{"anchor": datetime.date(2026, 6, 30)}],
        "stop.reliability.by_route": [
            {"stop_id": "51234", "route_id": "101", "obs": 100, "weighted_delay_sec": 9000},
        ],
        "stop.reliability.weekly": [
            {"stop_id": "51234", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ],
        "stop.reliability.monthly": [
            {"stop_id": "51234", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ],
        "route.weak_stops.legacy": [
            {"stop_id": "51234", "obs": 100, "weighted_delay_sec": 9000, "severe": 10},
        ],
        "route.weak_stops.by_grain": [
            {"stop_id": "51234", "obs": 10, "severe": 1, "sum_delay_sec": 900},
        ],
        "receipts.accountability": [
            {
                "provider_local_date": datetime.date(2025, 1, 1),
                "affected_route_count": 2,
                "affected_stop_count": 7,
                "delayed_trip_count": 20,
                "severe_delay_count": 4,
                "alert_count": 1,
                "rider_impact_score": 0.2,
            },
            {
                "provider_local_date": datetime.date(2026, 6, 1),
                "affected_route_count": 3,
                "affected_stop_count": 12,
                "delayed_trip_count": 45,
                "severe_delay_count": 5,
                "alert_count": 2,
                "rider_impact_score": 0.35,
            },
        ],
        "receipts.worst_route": [
            {"d": datetime.date(2026, 6, 1), "route_id": "165", "avg_delay_seconds": 200},
        ],
        "receipts.worst_stop": [
            {
                "d": datetime.date(2026, 6, 1),
                "stop_id": "51234",
                "avg_delay_seconds": 180,
                "max_delay_seconds": 600,
            },
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

    keys = [pathlib.Path(key).as_posix() for key in keys]
    key_set = set(keys)
    assert any("historic/network_trend.json" in k for k in key_set)
    assert any("historic/hotspots.json" in k for k in key_set)
    assert any("historic/repeat_offenders.json" in k for k in key_set)
    assert any("historic/alert_history.json" in k for k in key_set)
    assert any("provenance.json" in k for k in key_set)
    network_partition_keys = [
        key
        for key in keys
        if "historic/history/network/generations/" in key and key.endswith("/2026-06.json")
    ]
    assert len(network_partition_keys) == 1
    network_index_key = next(
        key
        for key in keys
        if "historic/history/network/generations/" in key and key.endswith("/index.json")
    )
    assert keys.index(network_partition_keys[0]) < keys.index(network_index_key)
    root_index_key = next(key for key in keys if "historic/history/index.json" in key)
    assert keys.index(network_index_key) < keys.index(root_index_key)
    assert keys[-1] == root_index_key
    assert not any(k.endswith("historic/provenance.json") for k in key_set)

    assert any("historic/route_reliability/101.json" in k for k in key_set)
    assert any("historic/route_reliability/202.json" in k for k in key_set)

    assert any("historic/stop_reliability/51234.json" in k for k in key_set)

    assert any("historic/receipts/2025-01-01.json" in k for k in key_set)
    assert any("historic/receipts/2026-06-01.json" in k for k in key_set)

    from transit_ops.snapshots.contract import Receipt, ReceiptsIndex, RouteReliabilityIndex

    index_path = next(k for k in keys if "historic/receipts/index.json" in k)
    ri = ReceiptsIndex.model_validate_json(pathlib.Path(index_path).read_bytes())
    assert ri.dates == ["2025-01-01", "2026-06-01"]
    assert [item.date for item in ri.available] == ri.dates
    published_receipts = {
        date: Receipt.model_validate_json(
            pathlib.Path(
                next(key for key in keys if key.endswith(f"historic/receipts/{date}.json"))
            ).read_bytes()
        )
        for date in ri.dates
    }
    assert ri.collection_generation_id == historic_compatibility._receipts_collection_generation_id(
        published_receipts
    )

    rr_index_path = next(k for k in keys if "historic/route_reliability/index.json" in k)
    rri = RouteReliabilityIndex.model_validate_json(pathlib.Path(rr_index_path).read_bytes())
    assert rri.route_ids == ["101", "202"]

    network_trend_path = next(k for k in keys if "historic/network_trend.json" in k)
    raw = pathlib.Path(network_trend_path).read_bytes()
    parsed = NetworkTrend.model_validate_json(raw)
    assert isinstance(parsed.series, list)
    assert isinstance(parsed.weekly, list) and len(parsed.weekly) > 0
    assert isinstance(parsed.monthly, list) and len(parsed.monthly) > 0
    assert all(p.p90_min is None and p.vehicles is None for p in parsed.weekly)
    assert all(p.p90_min is None and p.vehicles is None for p in parsed.monthly)

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
    assert len(res.keys_written) >= 5


class _RecordingConn:

    def __init__(self):
        self.sql: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        s = str(statement)
        self.sql.append(s)
        import datetime as _dt

        if query_name(statement) == "publish.lock.try_acquire":
            return _ScalarResult(True)
        if "loaded_at_utc FROM core.dataset_versions" in s:
            return _StampResult(_dt.datetime(2026, 6, 1, 0, 0, tzinfo=_dt.UTC))
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


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


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
    for col in (
        "gate_checks_run",
        "gate_errors",
        "gate_warnings",
        "gate_verdict",
        "gate_generated_utc",
    ):
        assert col in inserts[0], f"{col} missing from state upsert SQL"


def test_gate_summary_none_report_is_all_null() -> None:
    from transit_ops.snapshots.publish import _gate_summary

    s = _gate_summary(None)
    assert s == {
        "gate_checks_run": None,
        "gate_errors": None,
        "gate_warnings": None,
        "gate_verdict": None,
        "gate_generated_utc": None,
    }


def test_gate_summary_verdict_pass_warn_fail() -> None:
    from transit_ops.snapshots.publish import _gate_summary

    assert (
        _gate_summary({"checks_run": 5, "errors": 2, "warnings": 3, "generated_utc": "t"})[
            "gate_verdict"
        ]
        == "fail"
    )
    assert (
        _gate_summary({"checks_run": 5, "errors": 0, "warnings": 3, "generated_utc": "t"})[
            "gate_verdict"
        ]
        == "warn"
    )
    s = _gate_summary({"checks_run": 5, "errors": 0, "warnings": 0, "generated_utc": "t"})
    assert s["gate_verdict"] == "pass"
    assert s["gate_checks_run"] == 5 and s["gate_generated_utc"] == "t"


class _ParamRecordingConn(FakeConn):

    def __init__(self) -> None:
        self.state_params: list[dict] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        if "INSERT INTO core.snapshot_publish_state" in str(statement):
            self.state_params.append(dict(params or {}))
        return super().execute(statement, params)


def test_publish_live_persists_state_with_gate_summary() -> None:
    conn = _ParamRecordingConn()

    class _Engine:
        def begin(self):  # noqa: ANN202
            @contextmanager
            def _cm():
                yield conn

            return _cm()

    res = publish_snapshot(
        "stm", tier="live", settings=FakeSettings(), engine=_Engine(), storage=FakeStore()
    )
    assert res.tier == "live"
    assert len(conn.state_params) == 1
    p = conn.state_params[0]
    assert p["tier"] == "live"
    assert p["gate_verdict"] == "pass"
    assert p["gate_errors"] == 0 and p["gate_warnings"] == 0
    assert p["gate_checks_run"] == 7
    assert p["written"] == 7 and p["skipped"] == 0 and p["total"] == 7


def test_publish_result_reports_skip_counts() -> None:
    conn = _RecordingConn()
    res = _publish_static_once(StatefulFakeStore(), conn)
    d = res.display_dict()
    assert d["files_written"] == len(res.keys_written)
    assert d["files_skipped"] == 0
    assert d["files_written"] > 0


def test_static_stamp_uses_dataset_loaded_at() -> None:
    import json

    store = StatefulFakeStore()
    _publish_static_once(store, _RecordingConn())
    for key in ("static/routes_index.json", "static/stops_index.json", "labels/fr.json"):
        assert json.loads(store.store[key])["generated_utc"] == "2026-06-01T00:00:00Z"


def test_publish_static_second_run_skips_unchanged() -> None:
    store = StatefulFakeStore()
    res1 = _publish_static_once(store, _RecordingConn())
    assert res1.keys_skipped == []
    run1_written = set(res1.keys_written)

    store.get_json_calls.clear()
    res2 = _publish_static_once(store, _RecordingConn())
    assert set(res2.keys_skipped) == run1_written
    assert res2.keys_written == []
    assert store.get_json_calls.count("_meta/publish_state_static.json") == 1


def test_publish_static_rewrites_when_fingerprint_changes() -> None:
    import json

    from transit_ops.snapshots.storage import CACHE_CONTROL, _body

    store = StatefulFakeStore()
    res1 = _publish_static_once(store, _RecordingConn())
    run1_written = set(res1.keys_written)

    state = json.loads(store.store["_meta/publish_state_static.json"])
    state["fingerprint"] = f"v1|cc:{CACHE_CONTROL['static']}"
    store.store["_meta/publish_state_static.json"] = _body(state)

    res2 = _publish_static_once(store, _RecordingConn())
    assert set(res2.keys_written) == run1_written
    assert res2.keys_skipped == []


def test_publish_live_is_not_hash_gated() -> None:

    class GuardStore(FakeStore):
        def get_json(self, rel_key):  # pragma: no cover - must not be reached
            raise AssertionError("live tier must not be hash-gated")

    store = GuardStore()
    res = publish_snapshot(
        "stm", tier="live", settings=FakeSettings(), engine=FakeEngine(), storage=store
    )
    assert res.tier == "live"
    assert len(store.keys) == 7
    assert res.keys_skipped == []


def test_live_gate_checker_crash_never_aborts_cycle(monkeypatch) -> None:
    from transit_ops.snapshots import gate as _gate

    def _boom(rel_key, payload):  # noqa: ANN001, ARG001
        raise RuntimeError("checker exploded")

    monkeypatch.setattr(_gate, "check_payload", _boom)

    store = FakeStore()
    res = publish_snapshot(
        "stm", tier="live", settings=FakeSettings(), engine=FakeEngine(), storage=store
    )
    assert res.tier == "live"
    assert len(store.keys) == 7
    assert store.keys[-1] == "manifest.json"


def test_static_gate_blocks_sentinel_payload(monkeypatch) -> None:
    from transit_ops.snapshots import gate as _gate
    from transit_ops.snapshots import publish as _pub

    def _poison(conn, storage, *, provider_id, settings, stamp):  # noqa: ANN001, ARG001
        storage.put_json(
            "static/routes_index.json", {"generated_utc": stamp, "bad": 9999.9999}, tier="static"
        )

    monkeypatch.setattr(_pub, "_publish_static", _poison)

    store = StatefulFakeStore()
    with pytest.raises(_gate.GateError):
        _publish_static_once(store, _RecordingConn())
    assert "static/routes_index.json" not in store.store


def test_static_gate_force_overrides_sentinel(monkeypatch) -> None:
    from transit_ops.snapshots import publish as _pub

    def _poison(conn, storage, *, provider_id, settings, stamp):  # noqa: ANN001, ARG001
        storage.put_json(
            "static/routes_index.json", {"generated_utc": stamp, "bad": 9999.9999}, tier="static"
        )

    monkeypatch.setattr(_pub, "_publish_static", _poison)

    store = StatefulFakeStore()
    res = publish_snapshot(
        "stm",
        tier="static",
        settings=FakeSettings(),
        engine=_RecordingEngine(_RecordingConn()),
        storage=store,
        force=True,
    )
    assert "static/routes_index.json" in res.keys_written


def test_static_gate_reports_on_success(monkeypatch) -> None:
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
    assert bm["url"] == "/data/v1/stm/static/basemap/montreal.pmtiles"
    assert bm["format"] == "pmtiles"


def test_historic_route_enumeration_excludes_unrouted_sentinel() -> None:
    sql = str(_ROUTE_INVENTORY_SQL)
    assert "FROM gold.route_delay_spine" in sql
    assert "MAX(provider_local_date) AS spine_anchor" in sql
    assert "GROUP BY route_id" in sql
    assert "__unrouted__" not in sql
    assert "route_reliability_weekly" not in sql
    assert "route_reliability_monthly" not in sql


def test_static_publish_rebuilds_unchanged_gtfs_after_upgrade_or_asset_changes(monkeypatch) -> None:
    import json

    from transit_ops.providers.registry import ProviderRegistry
    from transit_ops.snapshots.storage import CACHE_CONTROL

    class DatasetConn(_RecordingConn):
        unchanged = True

        def execute(self, statement, params=None):
            if query_name(statement) == "publish.static_skip.match":
                return NamedRowsResult([(5,)] if self.unchanged else [])
            return super().execute(statement, params)

    registry = ProviderRegistry.from_project_root()
    monkeypatch.setattr(ProviderRegistry, "from_project_root", lambda **kwargs: registry)
    public = registry.get_provider("stm").public
    settings = FakeSettings()
    store, conn = StatefulFakeStore(), DatasetConn()
    state_key = "_meta/publish_state_static.json"
    basemap_key = "static/basemap.json"
    assert basemap_key in _publish_static_once(store, conn, settings).keys_written
    assert _publish_static_once(store, conn, settings).keys_written == []

    state = json.loads(store.store[state_key])
    state["fingerprint"] = f"v2|cc:{CACHE_CONTROL['static']}"
    store.store[state_key] = json.dumps(state).encode()
    assert basemap_key in _publish_static_once(store, conn, settings).keys_written
    assert _publish_static_once(store, conn, settings).keys_written == []

    public.basemap_url = "/data/v1/stm/static/basemap/updated.pmtiles"
    assert basemap_key in _publish_static_once(store, conn, settings).keys_written
    assert json.loads(store.store[basemap_key])["url"] == public.basemap_url
    assert _publish_static_once(store, conn, settings).keys_written == []

    settings.SNAPSHOT_BASEMAP_STYLE_URL = "/map/updated-style.json"
    assert basemap_key in _publish_static_once(store, conn, settings).keys_written
    assert json.loads(store.store[basemap_key])["style_url"] == settings.SNAPSHOT_BASEMAP_STYLE_URL

    public.basemap_url = None
    result = _publish_static_once(store, conn, settings)
    assert "static/routes_index.json" in result.keys_written
    assert basemap_key not in result.keys_written
    assert _publish_static_once(store, conn, settings).keys_written == []

    conn.unchanged = False
    result = _publish_static_once(store, conn, settings)
    assert "static/routes_index.json" in result.keys_skipped


def test_publish_historic_uses_one_sorted_route_batch_and_preserves_hash_gate(
    monkeypatch,
) -> None:
    from types import SimpleNamespace

    from transit_ops.snapshots import publish as snapshot_publish
    from transit_ops.snapshots.contract import RouteReliability
    from transit_ops.snapshots.storage import HashGatedStorage, state_fingerprint

    stamp = "2026-07-21T00:00:00Z"
    batch_calls: list[tuple[str, str]] = []

    def build_batch(conn, *, provider_id, generated_utc):  # noqa: ANN001, ANN202
        batch_calls.append((provider_id, generated_utc))
        return {
            "R2": RouteReliability(generated_utc=generated_utc, id="R2", name="Route Two"),
            "R1": RouteReliability(generated_utc=generated_utc, id="R1", name="Route One"),
        }

    monkeypatch.setattr(
        snapshot_publish.builders,
        "build_all_route_reliability",
        build_batch,
        raising=False,
    )

    def old_loop(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        pytest.fail("publisher must not call the legacy per-route builder loop")

    monkeypatch.setattr(snapshot_publish.builders, "build_route_reliability", old_loop)
    for name in (
        "build_network_trend",
        "build_hotspots",
        "build_repeat_offenders",
        "build_alert_history",
        "build_provenance",
    ):
        monkeypatch.setattr(snapshot_publish.builders, name, lambda *args, **kwargs: object())
    monkeypatch.setattr(snapshot_publish.builders, "build_stop_reliability", lambda *a, **k: {})
    monkeypatch.setattr(snapshot_publish.builders, "build_receipts", lambda *a, **k: {})
    monkeypatch.setattr(
        snapshot_publish.builders,
        "build_alert_archive",
        lambda *a, **k: SimpleNamespace(page_items=[], index=object()),
    )

    items, route_items, stages, _archive = historic_compatibility._build_items(
        RecordingNamedConn({}),
        provider_id="stm",
        settings=FakeSettings(),
        stamp=stamp,
    )

    assert batch_calls == [("stm", stamp)]
    assert [item[0] for item in route_items] == [
        "historic/route_reliability/R1.json",
        "historic/route_reliability/R2.json",
    ]
    route_index_item = next(
        item for item in items if item[0] == "historic/route_reliability/index.json"
    )
    assert route_index_item[1].route_ids == ["R1", "R2"]
    assert stages[1][0] is route_items
    assert stages[2][0] == [route_index_item]

    published_items = [*route_items, route_index_item]
    envelope.stamp_envelope(published_items, provider_id="stm", stamp=stamp)
    assert all(item[1].methodology_version == "reliability-2" for item in published_items)
    assert all(item[1].publish_generation_id == f"stm@{stamp}" for item in published_items)

    fingerprint = state_fingerprint("historic")
    assert fingerprint == "v1|cc:public, max-age=3600, stale-while-revalidate=86400"
    inner = StatefulFakeStore()
    state_key = "_meta/publish_state_historic.json"

    first = HashGatedStorage(inner, state_rel_key=state_key, fingerprint=fingerprint)
    first.load()
    for rel_key, payload, tier in published_items:
        first.put_json(rel_key, payload, tier=tier)
    first.flush_state()
    assert first.written == [item[0] for item in published_items]

    identical = HashGatedStorage(inner, state_rel_key=state_key, fingerprint=fingerprint)
    identical.load()
    for rel_key, payload, tier in published_items:
        identical.put_json(rel_key, payload, tier=tier)
    assert identical.written == []
    assert identical.skipped == [item[0] for item in published_items]

    changed_items = [
        (rel_key, payload.model_copy(deep=True), tier) for rel_key, payload, tier in published_items
    ]
    changed_items[0][1].name = "Changed Route One"
    changed = HashGatedStorage(inner, state_rel_key=state_key, fingerprint=fingerprint)
    changed.load()
    for rel_key, payload, tier in changed_items:
        changed.put_json(rel_key, payload, tier=tier)
    assert changed.written == ["historic/route_reliability/R1.json"]
    assert set(changed.skipped) == {
        "historic/route_reliability/R2.json",
        "historic/route_reliability/index.json",
    }
