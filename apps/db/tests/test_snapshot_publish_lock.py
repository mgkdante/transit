"""Static/historic publish-lane advisory-lock orchestration."""

from __future__ import annotations

from contextlib import contextmanager

import pytest

from transit_ops.snapshots import publish
from transit_ops.snapshots.storage import (
    StableActivationConflictError,
    StableActivationOutcome,
    StableObjectVersion,
)
from transit_ops.sql_registry import query_name


class _Result:
    def __init__(self, scalar: object = None) -> None:
        self._scalar = scalar

    def scalar_one(self) -> object:
        return self._scalar

    def mappings(self) -> _Result:
        return self

    def fetchone(self):  # noqa: ANN201
        return None

    def __iter__(self):
        return iter([])

    def scalar(self) -> int:
        return 0


class _Conn:
    def __init__(self, events: list[str], *, lock_acquired: bool = True) -> None:
        self.events = events
        self.lock_acquired = lock_acquired
        self.params: list[tuple[str | None, dict[str, object]]] = []
        self.state_writes: list[dict[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ANN201
        name = query_name(statement)
        bound = dict(params or {})
        self.params.append((name, bound))
        self.events.append(f"sql:{name}")
        if name == "publish.lock.try_acquire":
            return _Result(self.lock_acquired)
        if name == "publish.state.upsert":
            self.state_writes.append(bound)
        return _Result()


class _Engine:
    def __init__(self, conn: _Conn) -> None:
        self.conn = conn

    def begin(self):  # noqa: ANN201
        @contextmanager
        def _transaction():
            yield self.conn

        return _transaction()


class _Store:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.objects: dict[str, bytes] = {}

    def full_key(self, rel_key: str) -> str:
        return rel_key

    def get_json(self, rel_key: str):  # noqa: ANN201
        self.events.append(f"get:{rel_key}")
        return None

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
        self.events.append(f"put:{rel_key}")
        self.objects[rel_key] = body
        return rel_key

    def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:
        from transit_ops.snapshots.serialization import snapshot_json_bytes

        return self.put_bytes(rel_key, snapshot_json_bytes(payload), tier=tier)


class _Settings:
    SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"
    SNAPSHOT_PUBLISH_CONCURRENCY = 1


def test_historic_lock_precedes_hash_load_public_write_flush_and_db_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    conn = _Conn(events)
    store = _Store(events)

    def _publish_one(_conn, storage, **_kwargs) -> None:  # noqa: ANN001
        events.append("publisher")
        storage.put_json("historic/compat.json", {"generation": 1}, tier="historic")

    monkeypatch.setattr(publish, "_publish_historic", _publish_one)

    publish.publish_snapshot(
        "stm",
        tier="historic",
        settings=_Settings(),
        engine=_Engine(conn),
        storage=store,
        gate_enabled=False,
    )

    assert events == [
        "sql:publish.lock.try_acquire",
        "get:_meta/publish_state_historic.json",
        "publisher",
        "put:historic/compat.json",
        "put:_meta/publish_state_historic.json",
        "sql:publish.state.upsert",
    ]


def test_denied_historic_lock_has_zero_storage_or_publish_state_side_effects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    conn = _Conn(events, lock_acquired=False)
    store = _Store(events)

    def _must_not_publish(*_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
        raise AssertionError("publisher ran without the lane lock")

    monkeypatch.setattr(publish, "_publish_historic", _must_not_publish)

    with pytest.raises(
        publish.PublishLockUnavailableError,
        match=r"provider='stm'.*tier='historic'",
    ):
        publish.publish_snapshot(
            "stm",
            tier="historic",
            settings=_Settings(),
            engine=_Engine(conn),
            storage=store,
            gate_enabled=False,
        )

    assert events == ["sql:publish.lock.try_acquire"]
    assert store.objects == {}
    assert conn.state_writes == []


def test_denied_static_lock_stops_before_dataset_stamp_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    conn = _Conn(events, lock_acquired=False)

    def _must_not_read_stamp(*_args, **_kwargs):  # noqa: ANN002, ANN003, ANN202
        raise AssertionError("static stamp loaded without the lane lock")

    monkeypatch.setattr(publish, "_static_stamp", _must_not_read_stamp)

    with pytest.raises(publish.PublishLockUnavailableError):
        publish.publish_snapshot(
            "stm",
            tier="static",
            settings=_Settings(),
            engine=_Engine(conn),
            storage=_Store(events),
            gate_enabled=False,
        )

    assert events == ["sql:publish.lock.try_acquire"]


@pytest.mark.parametrize("tier", ["static", "historic"])
def test_static_and_historic_publish_acquire_the_exact_lane_lock(
    monkeypatch: pytest.MonkeyPatch,
    tier: str,
) -> None:
    events: list[str] = []
    conn = _Conn(events)
    store = _Store(events)

    def _publish_nothing(*_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
        return None

    monkeypatch.setattr(publish, f"_publish_{tier}", _publish_nothing)
    if tier == "static":
        monkeypatch.setattr(publish, "_static_stamp", lambda *_args: "2026-07-14T00:00:00Z")

    publish.publish_snapshot(
        "stm",
        tier=tier,
        settings=_Settings(),
        engine=_Engine(conn),
        storage=store,
        gate_enabled=False,
    )

    assert conn.params[0] == (
        "publish.lock.try_acquire",
        {"provider_id": "stm", "tier": tier},
    )
    assert events[0] == "sql:publish.lock.try_acquire"


def test_publish_lock_key_is_provider_and_tier_scoped() -> None:
    events: list[str] = []
    conn = _Conn(events)

    for provider_id, tier in (("stm", "static"), ("stm", "historic"), ("exo", "static")):
        publish._acquire_publish_lock(conn, provider_id=provider_id, tier=tier)

    assert [params for name, params in conn.params if name == "publish.lock.try_acquire"] == [
        {"provider_id": "stm", "tier": "static"},
        {"provider_id": "stm", "tier": "historic"},
        {"provider_id": "exo", "tier": "static"},
    ]
    sql = str(publish._PUBLISH_LOCK_SQL)
    assert "pg_try_advisory_xact_lock" in sql
    assert "transit.snapshot_publish:" in sql
    assert ":provider_id" in sql
    assert ":tier" in sql


def test_live_publish_does_not_take_static_historic_lane_lock() -> None:
    events: list[str] = []
    conn = _Conn(events, lock_acquired=False)
    store = _Store(events)

    result = publish.publish_snapshot(
        "stm",
        tier="live",
        settings=_Settings(),
        engine=_Engine(conn),
        storage=store,
        gate_enabled=False,
    )

    assert result.tier == "live"
    assert "sql:publish.lock.try_acquire" not in events
    assert len(result.keys_written) == 7


def test_root_activation_conflict_does_not_flush_hash_or_db_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    conn = _Conn(events)

    class _ConflictingRootStore(_Store):
        def capture_stable_version(self, rel_key: str) -> StableObjectVersion:
            return StableObjectVersion(rel_key=rel_key, token="old-etag")

        def activate_stable_json_outcome(
            self,
            rel_key: str,
            payload: object,
            *,
            expected_version: StableObjectVersion,
            tier: str,
        ) -> StableActivationOutcome:
            raise StableActivationConflictError(rel_key)

    store = _ConflictingRootStore(events)

    def _conflicting_publish(_conn, storage, **_kwargs) -> None:  # noqa: ANN001
        storage.put_json("historic/compat.json", {"generation": 1}, tier="historic")
        storage.activate_stable_json(
            "historic/history/index.json",
            {"generation": 1},
            expected_version=storage.capture_stable_version("historic/history/index.json"),
            tier="historic",
        )

    monkeypatch.setattr(publish, "_publish_historic", _conflicting_publish)

    with pytest.raises(StableActivationConflictError):
        publish.publish_snapshot(
            "stm",
            tier="historic",
            settings=_Settings(),
            engine=_Engine(conn),
            storage=store,
            gate_enabled=False,
        )

    assert "put:historic/compat.json" in events
    assert "put:_meta/publish_state_historic.json" not in events
    assert "sql:publish.state.upsert" not in events
    assert conn.state_writes == []


def test_same_root_activation_is_counted_as_an_idempotent_skip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    conn = _Conn(events)

    class _SameRootStore(_Store):
        def capture_stable_version(self, rel_key: str) -> StableObjectVersion:
            return StableObjectVersion(rel_key=rel_key, token="etag")

        def activate_stable_json_outcome(
            self,
            rel_key: str,
            payload: object,
            *,
            expected_version: StableObjectVersion,
            tier: str,
        ) -> StableActivationOutcome:
            assert expected_version.token == "etag"
            assert tier == "historic"
            self.events.append(f"activate-same:{rel_key}")
            return StableActivationOutcome(key=rel_key, written=False)

    store = _SameRootStore(events)

    def _same_root_publish(_conn, storage, **_kwargs) -> None:  # noqa: ANN001
        storage.activate_stable_json(
            "historic/history/index.json",
            {"generation": 1},
            expected_version=storage.capture_stable_version("historic/history/index.json"),
            tier="historic",
        )

    monkeypatch.setattr(publish, "_publish_historic", _same_root_publish)

    result = publish.publish_snapshot(
        "stm",
        tier="historic",
        settings=_Settings(),
        engine=_Engine(conn),
        storage=store,
        gate_enabled=False,
    )

    assert result.keys_written == []
    assert result.keys_skipped == ["historic/history/index.json"]
    assert len(conn.state_writes) == 1
    state = conn.state_writes[0]
    assert state["written"] == 0
    assert state["skipped"] == 1
    assert state["total"] == 1
    assert state["stable_total"] == 1
