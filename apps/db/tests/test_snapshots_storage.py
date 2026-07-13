from __future__ import annotations

import hashlib
import io
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from botocore.exceptions import ClientError

from transit_ops.snapshots.contract import VehiclesFile
from transit_ops.snapshots.storage import (
    CACHE_CONTROL,
    HashGatedStorage,
    SnapshotStorage,
    state_fingerprint,
)


class FakeS3Client:
    def __init__(self):
        self.objects = {}
        self.head_calls: list[str] = []
        self.get_calls: list[str] = []
        self.put_calls: list[str] = []

    def put_object(self, **kw):
        self.put_calls.append(kw["Key"])
        self.objects[kw["Key"]] = kw

    def head_object(self, **kw):
        key = kw["Key"]
        self.head_calls.append(key)
        if key not in self.objects:
            raise ClientError({"Error": {"Code": "404", "Message": "missing"}}, "HeadObject")
        obj = self.objects[key]
        return {
            "ContentLength": obj.get("HeadContentLength", len(obj["Body"])),
            "Metadata": dict(obj.get("Metadata", {})),
        }

    def get_object(self, **kw):
        key = kw["Key"]
        self.get_calls.append(key)
        if key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject")
        return {"Body": io.BytesIO(self.objects[key]["Body"])}


class _CloseTrackingBody(io.BytesIO):
    def __init__(self, value: bytes) -> None:
        super().__init__(value)
        self.was_closed = False

    def close(self) -> None:
        self.was_closed = True
        super().close()


class _LegacyBodyClient(FakeS3Client):
    def __init__(self, key: str, body: bytes) -> None:
        super().__init__()
        self.objects[key] = {"Body": body}
        self.last_body: _CloseTrackingBody | None = None

    def get_object(self, **kw):
        key = kw["Key"]
        self.get_calls.append(key)
        body = _CloseTrackingBody(self.objects[key]["Body"])
        self.last_body = body
        return {"Body": body}


def test_put_json_sets_headers():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="transit-snapshots", base_prefix="v1/stm")
    store.put_json("live/vehicles.json", VehiclesFile(generated_utc="t", vehicles=[]), tier="live")
    obj = c.objects["v1/stm/live/vehicles.json"]
    assert obj["Bucket"] == "transit-snapshots"
    assert obj["ContentType"] == "application/json"
    assert obj["CacheControl"] == CACHE_CONTROL["live"]
    assert b'"vehicles"' in obj["Body"]


def test_put_json_returns_full_key():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="transit-snapshots", base_prefix="v1/stm")
    key = store.put_json(
        "live/vehicles.json", VehiclesFile(generated_utc="t", vehicles=[]), tier="live"
    )
    assert key == "v1/stm/live/vehicles.json"


def test_cache_control_values():
    assert CACHE_CONTROL["live"] == "public, max-age=30"
    assert CACHE_CONTROL["static"] == "public, max-age=86400, stale-while-revalidate=86400"
    assert CACHE_CONTROL["historic"] == "public, max-age=3600, stale-while-revalidate=86400"
    assert CACHE_CONTROL["internal"] == "private, no-store"
    assert CACHE_CONTROL["historic_immutable"] == "public, max-age=31536000, immutable"


def test_put_json_static_tier():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="transit-snapshots", base_prefix="v1/stm")
    store.put_json("static/stops.json", {"stops": []}, tier="static")
    obj = c.objects["v1/stm/static/stops.json"]
    assert obj["CacheControl"] == CACHE_CONTROL["static"]


def test_put_json_dict_payload():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="transit-snapshots", base_prefix="v1/stm")
    store.put_json("live/network.json", {"vehicles_in_service": 42}, tier="live")
    obj = c.objects["v1/stm/live/network.json"]
    assert b"vehicles_in_service" in obj["Body"]
    assert b"42" in obj["Body"]


def test_base_prefix_strips_slashes():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="bucket", base_prefix="/v1/stm/")
    store.put_json("live/vehicles.json", {}, tier="live")
    assert "v1/stm/live/vehicles.json" in c.objects


def test_local_backend_writes_file(tmp_path):
    from transit_ops.settings import Settings
    from transit_ops.snapshots.storage import build_snapshot_storage

    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="local",
        SNAPSHOT_LOCAL_ROOT=str(tmp_path),
    )
    store = build_snapshot_storage(s, provider_id="stm")
    store.put_json("live/network.json", {"vehicles_in_service": 1}, tier="live")
    assert (tmp_path / "v1/stm/live/network.json").exists()


def test_local_backend_file_content(tmp_path):
    from transit_ops.settings import Settings
    from transit_ops.snapshots.storage import build_snapshot_storage

    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="local",
        SNAPSHOT_LOCAL_ROOT=str(tmp_path),
    )
    store = build_snapshot_storage(s, provider_id="stm")
    store.put_json("live/network.json", {"vehicles_in_service": 7}, tier="live")
    content = (tmp_path / "v1/stm/live/network.json").read_bytes()
    assert b"vehicles_in_service" in content
    assert b"7" in content


def test_local_backend_missing_root_raises():
    from transit_ops.settings import Settings
    from transit_ops.snapshots.storage import build_snapshot_storage

    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="local",
        SNAPSHOT_LOCAL_ROOT=None,
    )
    with pytest.raises(ValueError, match="SNAPSHOT_LOCAL_ROOT"):
        build_snapshot_storage(s, provider_id="stm")


def test_s3_backend_missing_bucket_raises():
    from transit_ops.settings import Settings
    from transit_ops.snapshots.storage import build_snapshot_storage

    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="s3",
        SNAPSHOT_R2_BUCKET=None,
    )
    with pytest.raises(ValueError, match="SNAPSHOT_R2_BUCKET"):
        build_snapshot_storage(s, provider_id="stm")


def test_s3_backend_uses_injected_client():
    from transit_ops.settings import Settings
    from transit_ops.snapshots.storage import build_snapshot_storage

    c = FakeS3Client()
    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="s3",
        SNAPSHOT_R2_BUCKET="transit-snapshots",
    )
    store = build_snapshot_storage(s, provider_id="stm", client=c)
    store.put_json("live/vehicles.json", {"vehicles": []}, tier="live")
    assert "v1/stm/live/vehicles.json" in c.objects


# ---------------------------------------------------------------------------
# T1 — storage primitives: full_key / get_json / put_bytes / put_json delegation
# ---------------------------------------------------------------------------


def test_full_key_joins_prefix():
    store = SnapshotStorage(FakeS3Client(), bucket="b", base_prefix="/v1/stm/")
    assert store.full_key("static/routes_index.json") == "v1/stm/static/routes_index.json"


def test_get_json_returns_none_on_missing_key():
    store = SnapshotStorage(FakeS3Client(), bucket="b", base_prefix="v1/stm")
    assert store.get_json("_meta/publish_state_static.json") is None


def test_get_json_roundtrips_stored_object():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="b", base_prefix="v1/stm")
    store.put_bytes("_meta/state.json", json.dumps({"a": 1}).encode(), tier="internal")
    assert store.get_json("_meta/state.json") == {"a": 1}
    # internal tier carries the no-store header
    assert c.objects["v1/stm/_meta/state.json"]["CacheControl"] == CACHE_CONTROL["internal"]


def test_get_json_reraises_non_404_client_error():
    class BoomClient(FakeS3Client):
        def get_object(self, **kw):
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "nope"}}, "GetObject")

    store = SnapshotStorage(BoomClient(), bucket="b", base_prefix="v1/stm")
    with pytest.raises(ClientError):
        store.get_json("_meta/state.json")


def test_local_get_json_missing_returns_none(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    assert store.get_json("_meta/state.json") is None


def test_local_get_json_roundtrips(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    store.put_bytes("_meta/state.json", json.dumps({"b": 2}).encode(), tier="internal")
    assert store.get_json("_meta/state.json") == {"b": 2}


def test_put_json_delegates_to_put_bytes():
    calls = []

    class RecordingStore(SnapshotStorage):
        def put_bytes(self, rel_key, body, *, tier):
            calls.append((rel_key, body, tier))
            return self.full_key(rel_key)

    store = RecordingStore(FakeS3Client(), bucket="b", base_prefix="v1/stm")
    store.put_json("live/network.json", {"x": 1}, tier="live")
    assert len(calls) == 1
    rel_key, body, tier = calls[0]
    assert rel_key == "live/network.json"
    assert tier == "live"
    assert b'"x":1' in body


# ---------------------------------------------------------------------------
# T2 — HashGatedStorage skip/write/fingerprint/merge semantics
# ---------------------------------------------------------------------------


class StatefulFakeStore:
    """In-memory stand-in for an inner snapshot storage with hash-state support."""

    def __init__(self):
        self.store: dict[str, bytes] = {}
        self.put_bytes_calls: list[str] = []

    def full_key(self, rel_key):
        return f"v1/stm/{rel_key}"

    def put_bytes(self, rel_key, body, *, tier):
        self.put_bytes_calls.append(rel_key)
        self.store[rel_key] = body
        return self.full_key(rel_key)

    def get_json(self, rel_key):
        raw = self.store.get(rel_key)
        return json.loads(raw) if raw is not None else None


def test_hash_gated_skips_unchanged_put():
    inner = StatefulFakeStore()
    fp = state_fingerprint("static")
    # First run writes and flushes state.
    g1 = HashGatedStorage(inner, state_rel_key="_meta/publish_state_static.json", fingerprint=fp)
    g1.load()
    g1.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g1.flush_state()
    inner.put_bytes_calls.clear()

    # Second run with identical payload skips the put entirely.
    g2 = HashGatedStorage(inner, state_rel_key="_meta/publish_state_static.json", fingerprint=fp)
    g2.load()
    key = g2.put_json("static/routes_index.json", {"routes": []}, tier="static")
    assert "static/routes_index.json" not in inner.put_bytes_calls
    assert g2.skipped == ["static/routes_index.json"]
    assert g2.written == []
    assert key == "v1/stm/static/routes_index.json"


def test_hash_gated_writes_changed_put():
    inner = StatefulFakeStore()
    fp = state_fingerprint("static")
    g1 = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint=fp)
    g1.load()
    g1.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g1.flush_state()
    inner.put_bytes_calls.clear()

    g2 = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint=fp)
    g2.load()
    g2.put_json("static/routes_index.json", {"routes": ["165"]}, tier="static")
    assert "static/routes_index.json" in inner.put_bytes_calls
    assert g2.written == ["static/routes_index.json"]
    assert g2.skipped == []


def test_hash_gated_missing_state_writes_everything():
    inner = StatefulFakeStore()  # no state object
    g = HashGatedStorage(
        inner, state_rel_key="_meta/s.json", fingerprint=state_fingerprint("static")
    )
    g.load()
    g.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g.put_json("static/stops_index.json", {"stops": []}, tier="static")
    assert g.written == ["static/routes_index.json", "static/stops_index.json"]
    assert g.skipped == []


def test_hash_gated_fingerprint_mismatch_forces_full_rewrite():
    inner = StatefulFakeStore()
    # Pre-seed state with a stale fingerprint string but a matching content hash.
    g1 = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint="v1|cc:OLD-HEADER")
    g1.load()
    g1.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g1.flush_state()
    inner.put_bytes_calls.clear()

    # New fingerprint -> prior hashes ignored -> full rewrite even though bytes match.
    g2 = HashGatedStorage(
        inner, state_rel_key="_meta/s.json", fingerprint=state_fingerprint("static")
    )
    g2.load()
    g2.put_json("static/routes_index.json", {"routes": []}, tier="static")
    assert "static/routes_index.json" in inner.put_bytes_calls
    assert g2.written == ["static/routes_index.json"]


def test_hash_gated_flush_state_merges_prior_unproduced_keys():
    inner = StatefulFakeStore()
    fp = state_fingerprint("historic")
    g1 = HashGatedStorage(inner, state_rel_key="_meta/h.json", fingerprint=fp)
    g1.load()
    g1.put_json("historic/receipts/2026-06-01.json", {"date": "2026-06-01"}, tier="historic")
    g1.flush_state()

    # Run 2 produces a DIFFERENT key (the old receipt fell out of the window).
    g2 = HashGatedStorage(inner, state_rel_key="_meta/h.json", fingerprint=fp)
    g2.load()
    g2.put_json("historic/receipts/2026-06-02.json", {"date": "2026-06-02"}, tier="historic")
    g2.flush_state()

    state = inner.get_json("_meta/h.json")
    # Both the unproduced old key and the new key survive in the merged map.
    assert "historic/receipts/2026-06-01.json" in state["hashes"]
    assert "historic/receipts/2026-06-02.json" in state["hashes"]


def test_hash_gated_state_written_with_internal_cache_control():
    class TierRecordingStore(StatefulFakeStore):
        def __init__(self):
            super().__init__()
            self.tiers: dict[str, str] = {}

        def put_bytes(self, rel_key, body, *, tier):
            self.tiers[rel_key] = tier
            return super().put_bytes(rel_key, body, tier=tier)

    inner = TierRecordingStore()
    g = HashGatedStorage(
        inner, state_rel_key="_meta/s.json", fingerprint=state_fingerprint("static")
    )
    g.load()
    g.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g.flush_state()
    assert inner.tiers["_meta/s.json"] == "internal"
    assert inner.tiers["static/routes_index.json"] == "static"


def test_snapshot_serialization_is_the_exact_shared_byte_authority():
    from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256

    model = VehiclesFile(generated_utc="t", vehicles=[])
    mapping = {"z": "é", "a": [2, 1]}

    assert snapshot_json_bytes(model) == model.model_dump_json().encode("utf-8")
    assert snapshot_json_bytes(mapping) == json.dumps(
        mapping, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    assert snapshot_sha256(model) == hashlib.sha256(snapshot_json_bytes(model)).hexdigest()
    assert snapshot_sha256(mapping) == hashlib.sha256(snapshot_json_bytes(mapping)).hexdigest()


def test_history_collection_generation_uses_shared_snapshot_digest_authority():
    from transit_ops.snapshots.builders.historic.history_common import (
        history_collection_generation_id,
    )
    from transit_ops.snapshots.serialization import snapshot_sha256

    canonical = {"entities": [{"id": "747"}], "family": "lines"}

    assert history_collection_generation_id(canonical) == snapshot_sha256(canonical)


@pytest.mark.parametrize(
    "payload",
    [
        VehiclesFile(generated_utc="t", vehicles=[]),
        {"z": "é", "a": [2, 1]},
    ],
)
def test_snapshot_and_local_storage_write_exact_shared_serialization_bytes(payload, tmp_path):
    from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    client = FakeS3Client()
    remote = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")
    local = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/network/generations/digest/2026-07.json"

    remote.put_immutable_json(key, payload)
    local.put_immutable_json(key, payload)

    expected = snapshot_json_bytes(payload)
    remote_object = client.objects[f"v1/stm/{key}"]
    assert remote_object["Body"] == expected
    assert remote_object["Metadata"] == {"sha256": snapshot_sha256(payload)}
    assert (tmp_path / "v1/stm" / key).read_bytes() == expected


def test_r2_immutable_new_write_sets_sha_metadata_and_exact_repeat_skips_without_get():
    from transit_ops.snapshots.serialization import snapshot_sha256

    client = FakeS3Client()
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")
    key = "historic/alerts/generations/abc/2026-07/page-0001.json"

    first = store.put_immutable_json(key, {"page": 1})
    second = store.put_immutable_json(key, {"page": 1})

    full_key = f"v1/stm/{key}"
    assert first == second == full_key
    assert client.put_calls == [full_key]
    assert client.get_calls == []
    assert client.objects[full_key]["Metadata"] == {"sha256": snapshot_sha256({"page": 1})}


def test_r2_immutable_legacy_object_exact_compares_once_and_closes_body():
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    key = "historic/alerts/generations/abc/2026-07/page-0001.json"
    full_key = f"v1/stm/{key}"
    body = snapshot_json_bytes({"page": 1})
    client = _LegacyBodyClient(full_key, body)
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")

    assert store.put_immutable_json(key, {"page": 1}) == full_key

    assert client.put_calls == []
    assert client.get_calls == [full_key]
    assert client.last_body is not None and client.last_body.was_closed


@pytest.mark.parametrize(
    ("seed", "requested"),
    [
        ({"page": 1}, {"page": 2}),
        ({"page": 2}, {"page": 1}),
    ],
)
def test_r2_immutable_existing_different_bytes_fail_closed(seed, requested):
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    key = "historic/alerts/generations/abc/2026-07/page-0001.json"
    full_key = f"v1/stm/{key}"
    client = _LegacyBodyClient(full_key, snapshot_json_bytes(seed))
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")

    with pytest.raises(RuntimeError, match=f"immutable key collision: {key}"):
        store.put_immutable_json(key, requested)

    assert client.put_calls == []
    assert client.last_body is not None and client.last_body.was_closed


def test_r2_immutable_metadata_or_length_mismatch_fails_without_download_or_overwrite():
    from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256

    key = "historic/alerts/generations/abc/2026-07/page-0001.json"
    full_key = f"v1/stm/{key}"
    body = snapshot_json_bytes({"page": 1})
    cases = [
        {
            "Body": body,
            "Metadata": {"sha256": snapshot_sha256({"page": 2})},
        },
        {
            "Body": body,
            "Metadata": {"sha256": snapshot_sha256({"page": 1})},
            "HeadContentLength": len(body) + 1,
        },
    ]

    for existing in cases:
        client = FakeS3Client()
        client.objects[full_key] = existing
        store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")

        with pytest.raises(RuntimeError, match=f"immutable key collision: {key}"):
            store.put_immutable_json(key, {"page": 1})

        assert client.get_calls == []
        assert client.put_calls == []


def test_r2_immutable_probe_treats_only_not_found_as_absent():
    key = "historic/alerts/generations/abc/2026-07/page-0001.json"
    client = FakeS3Client()
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")

    assert store.immutable_exists(key) is False
    store.put_immutable_json(key, {"page": 1})
    assert store.immutable_exists(key) is True

    class AccessDeniedClient(FakeS3Client):
        def head_object(self, **kw):
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "nope"}}, "HeadObject")

    denied = SnapshotStorage(AccessDeniedClient(), bucket="b", base_prefix="v1/stm")
    with pytest.raises(ClientError):
        denied.immutable_exists(key)
    with pytest.raises(ClientError):
        denied.put_immutable_json(key, {"page": 1})


def test_local_immutable_repeat_skips_and_different_bytes_collide(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/network/generations/abc/2026-07.json"

    first = store.put_immutable_json(key, {"page": 1})
    second = store.put_immutable_json(key, {"page": 1})

    assert first == second
    assert store.immutable_exists(key) is True
    with pytest.raises(RuntimeError, match=f"immutable key collision: {key}"):
        store.put_immutable_json(key, {"page": 2})


def test_local_concurrent_duplicate_immutable_attempts_write_once(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/network/generations/abc/2026-07.json"

    with ThreadPoolExecutor(max_workers=16) as pool:
        outcomes = list(
            pool.map(
                lambda _index: store.put_immutable_json_outcome(key, {"page": 1}),
                range(64),
            )
        )

    assert sum(outcome.written for outcome in outcomes) == 1
    assert sum(not outcome.written for outcome in outcomes) == 63


def test_hash_gated_immutable_writes_and_skips_are_separate_from_mutable_state():
    client = FakeS3Client()
    inner = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")
    state_key = "_meta/publish_state_historic.json"
    mutable_key = "historic/alerts/index.json"
    immutable_key = "historic/alerts/generations/abc/2026-07/page-0001.json"

    first = HashGatedStorage(
        inner,
        state_rel_key=state_key,
        fingerprint=state_fingerprint("historic"),
    )
    first.load()
    first.put_json(mutable_key, {"index": 1}, tier="historic")
    first.put_immutable_json(immutable_key, {"page": 1})
    first.flush_state()

    assert first.written == [mutable_key]
    assert first.skipped == []
    assert first.immutable_written == [immutable_key]
    assert first.immutable_skipped == []

    second = HashGatedStorage(
        inner,
        state_rel_key=state_key,
        fingerprint=state_fingerprint("historic"),
    )
    second.load()
    second.put_json(mutable_key, {"index": 1}, tier="historic")
    second.put_immutable_json(immutable_key, {"page": 1})
    second.flush_state()

    assert second.written == []
    assert second.skipped == [mutable_key]
    assert second.immutable_written == []
    assert second.immutable_skipped == [immutable_key]
    assert immutable_key not in inner.get_json(state_key)["hashes"]


def test_concurrent_duplicate_immutable_attempts_put_once_and_account_atomically():
    client = FakeS3Client()
    inner = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")
    gated = HashGatedStorage(
        inner,
        state_rel_key="_meta/publish_state_historic.json",
        fingerprint=state_fingerprint("historic"),
    )
    gated.load()
    key = "historic/alerts/generations/abc/2026-07/page-0001.json"

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(
            pool.map(lambda _index: gated.put_immutable_json(key, {"page": 1}), range(64))
        )

    assert results == [f"v1/stm/{key}"] * 64
    assert gated.immutable_written == [key]
    assert gated.immutable_skipped == [key] * 63
    assert client.put_calls.count(f"v1/stm/{key}") == 1


def test_distinct_immutable_keys_do_not_share_one_global_io_lock():
    class SlowHeadClient(FakeS3Client):
        def __init__(self) -> None:
            super().__init__()
            self._probe_lock = threading.Lock()
            self.in_flight = 0
            self.peak = 0

        def head_object(self, **kw):
            with self._probe_lock:
                self.in_flight += 1
                self.peak = max(self.peak, self.in_flight)
            try:
                time.sleep(0.005)
                return super().head_object(**kw)
            finally:
                with self._probe_lock:
                    self.in_flight -= 1

    client = SlowHeadClient()
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(
            pool.map(
                lambda index: store.put_immutable_json(
                    f"historic/history/network/generations/{index}/2026-07.json",
                    {"page": index},
                ),
                range(32),
            )
        )

    assert client.peak >= 2


def test_snapshot_immutable_put_uses_long_lived_immutable_cache_control():
    client = FakeS3Client()
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")
    key = "historic/alerts/generations/abc/2026-07/page-0001.json"

    store.put_immutable_json(key, {"page": 1})

    assert client.objects[f"v1/stm/{key}"]["CacheControl"] == CACHE_CONTROL["historic_immutable"]
