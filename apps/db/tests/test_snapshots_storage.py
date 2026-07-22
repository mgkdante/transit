from __future__ import annotations

import hashlib
import io
import json
import multiprocessing
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from botocore.exceptions import ClientError

import transit_ops.snapshots.storage as storage_module
from transit_ops.snapshots.contract import VehiclesFile
from transit_ops.snapshots.storage import (
    CACHE_CONTROL,
    HashGatedStorage,
    ImmutableKeyCollisionError,
    LocalSnapshotStorage,
    SnapshotStorage,
    StoredObjectVersion,
    StoredObjectVersionMismatchError,
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


class _VersionInventoryClient(FakeS3Client):
    def __init__(self) -> None:
        super().__init__()
        self.list_calls: list[dict] = []

    def list_objects_v2(self, **kwargs):
        self.list_calls.append(kwargs)
        if "ContinuationToken" not in kwargs:
            return {
                "IsTruncated": True,
                "NextContinuationToken": "page-2",
                "Contents": [
                    {
                        "Key": "v1/stm/historic/a.json",
                        "ETag": '"a"',
                        "LastModified": datetime(2026, 7, 1, tzinfo=UTC),
                        "Size": 10,
                    }
                ],
            }
        return {
            "IsTruncated": False,
            "Contents": [
                {
                    "Key": "v1/stm/historic/b.json",
                    "ETag": '"b"',
                    "LastModified": datetime(2026, 7, 2, tzinfo=UTC),
                    "Size": 20,
                }
            ],
        }

    def head_object(self, **kwargs):
        if kwargs["Key"].endswith("missing.json"):
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {
            "ETag": '"head"',
            "LastModified": datetime(2026, 7, 3, tzinfo=UTC),
            "ContentLength": 30,
        }


class _ConditionalCreateRaceClient(FakeS3Client):
    """Synchronize two missing HEADs and enforce S3 conditional-create semantics."""

    def __init__(self) -> None:
        super().__init__()
        self._state_lock = threading.Lock()
        self._initial_head_barrier = threading.Barrier(2)
        self._heads_to_synchronize = 2
        self.successful_put_calls: list[str] = []
        self.precondition_failures = 0

    def head_object(self, **kw):
        key = kw["Key"]
        with self._state_lock:
            self.head_calls.append(key)
            obj = self.objects.get(key)
            synchronize = self._heads_to_synchronize > 0
            if synchronize:
                self._heads_to_synchronize -= 1
            response = (
                {
                    "ContentLength": obj.get("HeadContentLength", len(obj["Body"])),
                    "Metadata": dict(obj.get("Metadata", {})),
                }
                if obj is not None
                else None
            )

        if synchronize:
            self._initial_head_barrier.wait(timeout=2)
        if response is None:
            raise ClientError({"Error": {"Code": "404", "Message": "missing"}}, "HeadObject")
        return response

    def put_object(self, **kw):
        key = kw["Key"]
        with self._state_lock:
            self.put_calls.append(key)
            if kw.get("IfNoneMatch") == "*" and key in self.objects:
                self.precondition_failures += 1
                raise ClientError(
                    {
                        "Error": {"Code": "PreconditionFailed", "Message": "already exists"},
                        "ResponseMetadata": {"HTTPStatusCode": 412},
                    },
                    "PutObject",
                )
            self.objects[key] = kw
            self.successful_put_calls.append(key)


class _PreconditionRaceWinnerClient(FakeS3Client):
    """Install a competing winner immediately before rejecting a conditional PUT."""

    def __init__(self, *, winner_body: bytes, winner_metadata: dict[str, str]) -> None:
        super().__init__()
        self._winner_body = winner_body
        self._winner_metadata = winner_metadata

    def put_object(self, **kw):
        key = kw["Key"]
        self.put_calls.append(key)
        assert kw.get("IfNoneMatch") == "*"
        self.objects[key] = {
            **kw,
            "Body": self._winner_body,
            "Metadata": self._winner_metadata,
        }
        raise ClientError(
            {
                "Error": {"Code": "PreconditionFailed", "Message": "already exists"},
                "ResponseMetadata": {"HTTPStatusCode": 412},
            },
            "PutObject",
        )


class _StableCasClient(FakeS3Client):
    """In-memory S3 fake that enforces If-Match and If-None-Match atomically."""

    def __init__(self) -> None:
        super().__init__()
        self._state_lock = threading.Lock()
        self.conditional_puts: list[dict] = []
        self.precondition_failures = 0

    @staticmethod
    def _etag(body: bytes) -> str:
        return f'"{hashlib.sha256(body).hexdigest()}"'

    def seed(self, key: str, body: bytes) -> None:
        self.objects[key] = {"Body": body, "ETag": self._etag(body)}

    def head_object(self, **kw):
        key = kw["Key"]
        with self._state_lock:
            self.head_calls.append(key)
            obj = self.objects.get(key)
            if obj is None:
                raise ClientError(
                    {"Error": {"Code": "404", "Message": "missing"}},
                    "HeadObject",
                )
            return {
                "ContentLength": len(obj["Body"]),
                "ETag": obj["ETag"],
                "Metadata": dict(obj.get("Metadata", {})),
            }

    def put_object(self, **kw):
        key = kw["Key"]
        with self._state_lock:
            self.put_calls.append(key)
            self.conditional_puts.append(kw)
            existing = self.objects.get(key)
            failed = kw.get("IfNoneMatch") == "*" and existing is not None
            if_match = kw.get("IfMatch")
            failed = failed or (
                if_match is not None and (existing is None or existing["ETag"] != if_match)
            )
            if failed:
                self.precondition_failures += 1
                raise ClientError(
                    {
                        "Error": {"Code": "PreconditionFailed", "Message": "stale version"},
                        "ResponseMetadata": {"HTTPStatusCode": 412},
                    },
                    "PutObject",
                )
            etag = self._etag(kw["Body"])
            self.objects[key] = {**kw, "ETag": etag}
            return {"ETag": etag}


class _CloseTrackingBody(io.BytesIO):
    def __init__(self, value: bytes) -> None:
        super().__init__(value)
        self.was_closed = False

    def close(self) -> None:
        self.was_closed = True
        super().close()


class _ConditionalReadClient(FakeS3Client):
    def __init__(self, *, body: bytes = b'{"ok":true}') -> None:
        super().__init__()
        self.body = body
        self.etag = '"inventory-etag"'
        self.modified = datetime(2026, 7, 3, tzinfo=UTC)
        self.content_length = len(body)
        self.error_code: str | None = None
        self.error_status: int | None = None
        self.last_body: _CloseTrackingBody | None = None
        self.get_requests: list[dict] = []

    def get_object(self, **kw):
        self.get_requests.append(kw)
        if self.error_code is not None:
            status = self.error_status
            if status is None:
                status = 412 if self.error_code in {"412", "PreconditionFailed"} else 404
            raise ClientError(
                {
                    "Error": {"Code": self.error_code, "Message": "conditional read failed"},
                    "ResponseMetadata": {"HTTPStatusCode": status},
                },
                "GetObject",
            )
        body = _CloseTrackingBody(self.body)
        self.last_body = body
        return {
            "Body": body,
            "ETag": self.etag,
            "LastModified": self.modified,
            "ContentLength": self.content_length,
        }


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


def _attempt_local_stable_activation_in_process(
    root: str,
    rel_key: str,
    expected_version: storage_module.StableObjectVersion,
    candidate: int,
    read_barrier,
    result_queue,
) -> None:
    """Force two processes to capture the same active bytes before replacing them."""

    original_read_bytes = storage_module.pathlib.Path.read_bytes
    synchronized = False

    def synchronized_read_bytes(path):
        nonlocal synchronized
        body = original_read_bytes(path)
        if not synchronized and path.name == "index.json":
            synchronized = True
            try:
                read_barrier.wait(timeout=1)
            except threading.BrokenBarrierError:
                pass
        return body

    storage_module.pathlib.Path.read_bytes = synchronized_read_bytes
    store = storage_module.LocalSnapshotStorage(root, "v1/stm")
    try:
        outcome = store.activate_stable_json_outcome(
            rel_key,
            {"generation": f"candidate-{candidate}"},
            expected_version=expected_version,
            tier="historic",
        )
    except storage_module.StableActivationConflictError:
        result_queue.put(("conflict", candidate, None))
    except BaseException as exc:  # noqa: BLE001 - child errors must reach the parent
        result_queue.put(("error", candidate, repr(exc)))
    else:
        result_queue.put(("outcome", candidate, outcome.written))


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


def test_r2_cross_instance_concurrent_duplicate_immutable_attempts_create_once():
    client = _ConditionalCreateRaceClient()
    stores = [
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
    ]
    key = "historic/alerts/generations/abc/2026-07/page-0001.json"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(
            pool.map(
                lambda store: store.put_immutable_json_outcome(key, {"page": 1}),
                stores,
            )
        )

    full_key = f"v1/stm/{key}"
    assert sorted(outcome.written for outcome in outcomes) == [False, True]
    assert client.successful_put_calls == [full_key]
    assert client.precondition_failures == 1
    assert all(client.objects[full_key]["IfNoneMatch"] == "*" for _outcome in outcomes)


def test_r2_cross_instance_concurrent_different_immutable_bytes_collide():
    client = _ConditionalCreateRaceClient()
    stores = [
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
    ]
    key = "historic/alerts/generations/abc/2026-07/page-0001.json"

    def attempt(index: int):
        try:
            return stores[index].put_immutable_json_outcome(key, {"page": index})
        except Exception as exc:  # noqa: BLE001 - the assertion below owns the exact type
            return exc

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))

    outcomes = [result for result in results if not isinstance(result, Exception)]
    collisions = [result for result in results if isinstance(result, ImmutableKeyCollisionError)]
    assert len(outcomes) == 1 and outcomes[0].written is True
    assert len(collisions) == 1
    assert client.successful_put_calls == [f"v1/stm/{key}"]
    assert client.precondition_failures == 1


def test_r2_precondition_race_exact_verification_rejects_forged_matching_metadata():
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    key = "historic/alerts/generations/abc/2026-07/page-0001.json"
    full_key = f"v1/stm/{key}"
    requested_body = snapshot_json_bytes({"page": 1})
    winner_body = snapshot_json_bytes({"page": 2})
    assert len(winner_body) == len(requested_body)
    client = _PreconditionRaceWinnerClient(
        winner_body=winner_body,
        winner_metadata={"sha256": hashlib.sha256(requested_body).hexdigest()},
    )
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")

    with pytest.raises(ImmutableKeyCollisionError, match=f"immutable key collision: {key}"):
        store.put_immutable_json_outcome(key, {"page": 1})

    assert client.get_calls == [full_key]


def test_r2_precondition_race_exact_verification_accepts_identical_winner():
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    key = "historic/alerts/generations/abc/2026-07/page-0001.json"
    full_key = f"v1/stm/{key}"
    requested_body = snapshot_json_bytes({"page": 1})
    client = _PreconditionRaceWinnerClient(
        winner_body=requested_body,
        winner_metadata={"sha256": hashlib.sha256(requested_body).hexdigest()},
    )
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")

    outcome = store.put_immutable_json_outcome(key, {"page": 1})

    assert outcome.key == full_key
    assert outcome.written is False
    assert client.get_calls == [full_key]


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


def test_r2_stable_activation_captures_absence_and_conditionally_creates():
    client = _StableCasClient()
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")
    rel_key = "historic/history/index.json"

    version = store.capture_stable_version(rel_key)
    outcome = store.activate_stable_json_outcome(
        rel_key,
        {"generation": "one"},
        expected_version=version,
        tier="historic",
    )

    assert version.rel_key == rel_key
    assert version.token is None
    assert outcome == storage_module.StableActivationOutcome(
        key=f"v1/stm/{rel_key}",
        written=True,
    )
    put = client.conditional_puts[-1]
    assert put["IfNoneMatch"] == "*"
    assert "IfMatch" not in put
    assert put["CacheControl"] == CACHE_CONTROL["historic"]


def test_r2_stable_activation_captures_etag_and_conditionally_replaces():
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    client = _StableCasClient()
    store = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")
    rel_key = "historic/history/index.json"
    full_key = f"v1/stm/{rel_key}"
    client.seed(full_key, snapshot_json_bytes({"generation": "old"}))

    version = store.capture_stable_version(rel_key)
    outcome = store.activate_stable_json_outcome(
        rel_key,
        {"generation": "new"},
        expected_version=version,
        tier="historic",
    )

    assert version.token == client._etag(snapshot_json_bytes({"generation": "old"}))
    assert outcome.written is True
    put = client.conditional_puts[-1]
    assert put["IfMatch"] == version.token
    assert "IfNoneMatch" not in put


def test_r2_stale_different_stable_activation_raises_typed_conflict():
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    client = _StableCasClient()
    stores = [
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
    ]
    rel_key = "historic/history/index.json"
    client.seed(f"v1/stm/{rel_key}", snapshot_json_bytes({"generation": "old"}))
    versions = [store.capture_stable_version(rel_key) for store in stores]

    stores[0].activate_stable_json_outcome(
        rel_key,
        {"generation": "winner"},
        expected_version=versions[0],
        tier="historic",
    )
    with pytest.raises(
        storage_module.StableActivationConflictError,
        match=f"stable activation conflict: {rel_key}",
    ):
        stores[1].activate_stable_json_outcome(
            rel_key,
            {"generation": "loser"},
            expected_version=versions[1],
            tier="historic",
        )


def test_r2_stale_identical_stable_activation_is_idempotent():
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    client = _StableCasClient()
    stores = [
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
    ]
    rel_key = "historic/history/index.json"
    full_key = f"v1/stm/{rel_key}"
    client.seed(full_key, snapshot_json_bytes({"generation": "old"}))
    versions = [store.capture_stable_version(rel_key) for store in stores]
    payload = {"generation": "winner"}

    stores[0].activate_stable_json_outcome(
        rel_key,
        payload,
        expected_version=versions[0],
        tier="historic",
    )
    outcome = stores[1].activate_stable_json_outcome(
        rel_key,
        payload,
        expected_version=versions[1],
        tier="historic",
    )

    assert outcome == storage_module.StableActivationOutcome(key=full_key, written=False)
    assert client.get_calls == [full_key]


def test_r2_two_publishers_from_same_version_cannot_activate_different_roots():
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    client = _StableCasClient()
    stores = [
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
        SnapshotStorage(client, bucket="b", base_prefix="v1/stm"),
    ]
    rel_key = "historic/history/index.json"
    full_key = f"v1/stm/{rel_key}"
    client.seed(full_key, snapshot_json_bytes({"generation": "old"}))
    versions = [store.capture_stable_version(rel_key) for store in stores]

    def attempt(index: int):
        try:
            return stores[index].activate_stable_json_outcome(
                rel_key,
                {"generation": f"candidate-{index}"},
                expected_version=versions[index],
                tier="historic",
            )
        except storage_module.StableActivationConflictError as exc:
            return exc

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))

    outcomes = [
        result for result in results if isinstance(result, storage_module.StableActivationOutcome)
    ]
    conflicts = [
        result
        for result in results
        if isinstance(result, storage_module.StableActivationConflictError)
    ]
    assert len(outcomes) == 1 and outcomes[0].written is True
    assert len(conflicts) == 1
    assert client.precondition_failures == 1


def test_local_stable_activation_enforces_cross_instance_cas(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    stores = [
        LocalSnapshotStorage(str(tmp_path), "v1/stm"),
        LocalSnapshotStorage(str(tmp_path), "v1/stm"),
    ]
    rel_key = "historic/history/index.json"
    absent = stores[0].capture_stable_version(rel_key)

    created = stores[0].activate_stable_json_outcome(
        rel_key,
        {"generation": "old"},
        expected_version=absent,
        tier="historic",
    )
    versions = [store.capture_stable_version(rel_key) for store in stores]

    def attempt(index: int):
        try:
            result = stores[index].activate_stable_json_outcome(
                rel_key,
                {"generation": f"candidate-{index}"},
                expected_version=versions[index],
                tier="historic",
            )
        except storage_module.StableActivationConflictError as exc:
            result = exc
        return index, result

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))

    winners = [
        (index, result)
        for index, result in results
        if isinstance(result, storage_module.StableActivationOutcome)
    ]
    conflicts = [
        result
        for _index, result in results
        if isinstance(result, storage_module.StableActivationConflictError)
    ]

    assert absent.token is None
    assert created.written is True
    assert len(winners) == 1 and winners[0][1].written is True
    assert len(conflicts) == 1
    winner_index = winners[0][0]
    loser_index = 1 - winner_index
    idempotent = stores[loser_index].activate_stable_json_outcome(
        rel_key,
        {"generation": f"candidate-{winner_index}"},
        expected_version=versions[loser_index],
        tier="historic",
    )
    assert idempotent.written is False


def test_local_stable_activation_enforces_cross_process_cas(tmp_path):
    store = storage_module.LocalSnapshotStorage(str(tmp_path), "v1/stm")
    rel_key = "historic/history/index.json"
    store.put_json(rel_key, {"generation": "old"}, tier="historic")
    expected_version = store.capture_stable_version(rel_key)
    context = multiprocessing.get_context("fork")
    read_barrier = context.Barrier(2)
    result_queue = context.Queue()
    processes = [
        context.Process(
            target=_attempt_local_stable_activation_in_process,
            args=(
                str(tmp_path),
                rel_key,
                expected_version,
                candidate,
                read_barrier,
                result_queue,
            ),
        )
        for candidate in range(2)
    ]

    try:
        for process in processes:
            process.start()
        for process in processes:
            process.join(timeout=10)
        results = [result_queue.get(timeout=2) for _process in processes]
    finally:
        for process in processes:
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)
        result_queue.close()
        result_queue.join_thread()

    assert [process.exitcode for process in processes] == [0, 0]
    assert not [result for result in results if result[0] == "error"]
    winners = [result for result in results if result[0] == "outcome"]
    conflicts = [result for result in results if result[0] == "conflict"]
    assert len(winners) == 1 and winners[0][2] is True
    assert len(conflicts) == 1
    active = store.get_json(rel_key)
    assert active == {"generation": f"candidate-{winners[0][1]}"}
    history_dir = tmp_path / "v1/stm/historic/history"
    assert not list(history_dir.glob("*.lock"))
    assert not list(history_dir.glob(".*.tmp"))


def test_hash_gate_delegates_stable_activation_and_accounts_without_hash_skip():
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    client = _StableCasClient()
    inner = SnapshotStorage(client, bucket="b", base_prefix="v1/stm")
    state_key = "_meta/publish_state_historic.json"
    rel_key = "historic/history/index.json"
    payload = {"generation": "new"}
    payload_digest = hashlib.md5(snapshot_json_bytes(payload)).hexdigest()
    inner.put_json(rel_key, {"generation": "old"}, tier="historic")
    inner.put_json(
        state_key,
        {
            "fingerprint": state_fingerprint("historic"),
            "hashes": {rel_key: payload_digest},
        },
        tier="internal",
    )
    gated = HashGatedStorage(
        inner,
        state_rel_key=state_key,
        fingerprint=state_fingerprint("historic"),
    )
    gated.load()
    version = gated.capture_stable_version(rel_key)

    key = gated.activate_stable_json(
        rel_key,
        payload,
        expected_version=version,
        tier="historic",
    )
    second = HashGatedStorage(
        inner,
        state_rel_key=state_key,
        fingerprint=state_fingerprint("historic"),
    )
    second.load()
    repeated_key = second.activate_stable_json(
        rel_key,
        payload,
        expected_version=version,
        tier="historic",
    )

    assert key == repeated_key == f"v1/stm/{rel_key}"
    assert gated.written == [rel_key]
    assert gated.skipped == []
    assert second.written == []
    assert second.skipped == [rel_key]
    assert client.precondition_failures == 1


def test_snapshot_storage_lists_every_version_page_and_strips_provider_prefix():
    client = _VersionInventoryClient()
    storage = SnapshotStorage(client, bucket="snapshots", base_prefix="v1/stm")

    versions = list(storage.iter_object_versions("historic/"))

    assert versions == [
        StoredObjectVersion(
            rel_key="historic/a.json",
            etag='"a"',
            last_modified_utc=datetime(2026, 7, 1, tzinfo=UTC),
            size=10,
        ),
        StoredObjectVersion(
            rel_key="historic/b.json",
            etag='"b"',
            last_modified_utc=datetime(2026, 7, 2, tzinfo=UTC),
            size=20,
        ),
    ]
    assert client.list_calls == [
        {"Bucket": "snapshots", "Prefix": "v1/stm/historic/"},
        {
            "Bucket": "snapshots",
            "Prefix": "v1/stm/historic/",
            "ContinuationToken": "page-2",
        },
    ]


def test_snapshot_storage_captures_head_metadata_and_missing_object():
    storage = SnapshotStorage(
        _VersionInventoryClient(),
        bucket="snapshots",
        base_prefix="v1/stm",
    )

    assert storage.capture_object_version("historic/a.json") == StoredObjectVersion(
        rel_key="historic/a.json",
        etag='"head"',
        last_modified_utc=datetime(2026, 7, 3, tzinfo=UTC),
        size=30,
    )
    assert storage.capture_object_version("historic/missing.json") is None


def test_snapshot_storage_reads_the_inventoried_version_conditionally_and_closes_body():
    client = _ConditionalReadClient()
    storage = SnapshotStorage(client, bucket="snapshots", base_prefix="v1/stm")
    version = StoredObjectVersion(
        rel_key="historic/a.json",
        etag=client.etag,
        last_modified_utc=client.modified,
        size=len(client.body),
    )

    assert storage.read_bytes_at_version("historic/a.json", version) == client.body

    assert client.get_requests == [
        {
            "Bucket": "snapshots",
            "Key": "v1/stm/historic/a.json",
            "IfMatch": client.etag,
        }
    ]
    assert client.last_body is not None
    assert client.last_body.was_closed


@pytest.mark.parametrize("error_code", ["PreconditionFailed", "NoSuchKey"])
def test_snapshot_storage_conditional_read_fails_closed_on_stale_or_missing_object(
    error_code: str,
):
    client = _ConditionalReadClient()
    client.error_code = error_code
    storage = SnapshotStorage(client, bucket="snapshots", base_prefix="v1/stm")
    version = StoredObjectVersion(
        rel_key="historic/a.json",
        etag=client.etag,
        last_modified_utc=client.modified,
        size=len(client.body),
    )

    with pytest.raises(StoredObjectVersionMismatchError, match="historic/a.json"):
        storage.read_bytes_at_version("historic/a.json", version)


@pytest.mark.parametrize("status", [404, 412])
def test_snapshot_storage_conditional_read_uses_http_status_fallback(status: int):
    client = _ConditionalReadClient()
    client.error_code = "Unknown"
    client.error_status = status
    storage = SnapshotStorage(client, bucket="snapshots", base_prefix="v1/stm")
    version = StoredObjectVersion(
        rel_key="historic/a.json",
        etag=client.etag,
        last_modified_utc=client.modified,
        size=len(client.body),
    )

    with pytest.raises(StoredObjectVersionMismatchError, match="historic/a.json"):
        storage.read_bytes_at_version("historic/a.json", version)


def test_snapshot_storage_conditional_read_propagates_non_version_storage_errors():
    client = _ConditionalReadClient()
    client.error_code = "AccessDenied"
    client.error_status = 403
    storage = SnapshotStorage(client, bucket="snapshots", base_prefix="v1/stm")
    version = StoredObjectVersion(
        rel_key="historic/a.json",
        etag=client.etag,
        last_modified_utc=client.modified,
        size=len(client.body),
    )

    with pytest.raises(ClientError, match="AccessDenied"):
        storage.read_bytes_at_version("historic/a.json", version)


@pytest.mark.parametrize("drift", ["etag", "modified", "size", "truncated"])
def test_snapshot_storage_conditional_read_rejects_response_or_body_drift(drift: str):
    client = _ConditionalReadClient()
    version = StoredObjectVersion(
        rel_key="historic/a.json",
        etag=client.etag,
        last_modified_utc=client.modified,
        size=len(client.body),
    )
    if drift == "etag":
        client.etag = '"changed"'
    elif drift == "modified":
        client.modified = datetime(2026, 7, 4, tzinfo=UTC)
    elif drift == "size":
        client.content_length += 1
    else:
        client.body = client.body[:-1]
    storage = SnapshotStorage(client, bucket="snapshots", base_prefix="v1/stm")

    with pytest.raises(StoredObjectVersionMismatchError, match="historic/a.json"):
        storage.read_bytes_at_version("historic/a.json", version)

    assert client.last_body is not None
    assert client.last_body.was_closed


def test_snapshot_storage_conditional_read_rejects_a_version_for_another_key():
    client = _ConditionalReadClient()
    storage = SnapshotStorage(client, bucket="snapshots", base_prefix="v1/stm")
    version = StoredObjectVersion(
        rel_key="historic/other.json",
        etag=client.etag,
        last_modified_utc=client.modified,
        size=len(client.body),
    )

    with pytest.raises(ValueError, match="different key"):
        storage.read_bytes_at_version("historic/a.json", version)
    assert client.get_requests == []


def test_snapshot_storage_conditional_reads_use_and_reuse_thread_local_clients():
    seeded_client = FakeS3Client()
    created: list[_ConditionalReadClient] = []
    factory_lock = threading.Lock()
    task_barrier = threading.Barrier(4)

    def factory() -> _ConditionalReadClient:
        client = _ConditionalReadClient()
        with factory_lock:
            created.append(client)
        return client

    storage = SnapshotStorage(
        seeded_client,
        bucket="snapshots",
        base_prefix="v1/stm",
        client_factory=factory,
    )

    def read_twice(index: int) -> tuple[bytes, bytes]:
        path = f"historic/{index}.json"
        version = StoredObjectVersion(
            rel_key=path,
            etag='"inventory-etag"',
            last_modified_utc=datetime(2026, 7, 3, tzinfo=UTC),
            size=len(b'{"ok":true}'),
        )
        task_barrier.wait(timeout=2)
        return (
            storage.read_bytes_at_version(path, version),
            storage.read_bytes_at_version(path, version),
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(read_twice, range(4)))

    assert results == [(b'{"ok":true}', b'{"ok":true}')] * 4
    assert seeded_client.get_calls == []
    assert len(created) == 4
    assert sorted(len(client.get_requests) for client in created) == [2, 2, 2, 2]


def test_local_snapshot_storage_has_list_head_and_raw_read_parity(tmp_path):
    storage = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    body = b'{"hello":"world"}'
    storage.put_bytes("historic/generations/a.json", body, tier="historic_immutable")

    listed = list(storage.iter_object_versions("historic/"))
    captured = storage.capture_object_version("historic/generations/a.json")

    assert listed == [captured]
    assert captured is not None
    assert captured.rel_key == "historic/generations/a.json"
    assert captured.etag == hashlib.sha256(body).hexdigest()
    assert captured.size == len(body)
    assert captured.last_modified_utc.tzinfo == UTC
    assert storage.read_bytes("historic/generations/a.json") == body
    assert storage.read_bytes("historic/missing.json") is None
    assert storage.read_bytes_at_version("historic/generations/a.json", captured) == body

    storage.put_bytes("historic/generations/a.json", b"changed", tier="historic_immutable")
    with pytest.raises(StoredObjectVersionMismatchError):
        storage.read_bytes_at_version("historic/generations/a.json", captured)
