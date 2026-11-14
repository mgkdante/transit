import hashlib
import json
from datetime import UTC, datetime

import pytest
from botocore.exceptions import ClientError

from transit_ops.control import objects as m
from transit_ops.settings import Settings
from transit_ops.snapshots.storage import LocalSnapshotStorage, SnapshotStorage


@pytest.fixture
def objects(tmp_path):
    return m.SnapshotConditionalObjects(
        LocalSnapshotStorage(str(tmp_path), "ledger/v1"), min_interval_s=0
    )


def test_create_writes_once_and_accepts_identical_bytes(objects):
    assert objects.create("a", {"v": 1})
    assert not objects.create("a", {"v": 1})
    with pytest.raises(m.ObjectCollision):
        objects.create("a", {"v": 2})
    assert json.loads(objects.read("a").body) == {"v": 1}


def test_replace_against_a_stale_token_keeps_stored_bytes(objects):
    assert objects.read("a") is None
    objects.create("a", {"v": 1})
    first = objects.read("a")
    assert first.key == "a"
    assert first.token == hashlib.sha256(first.body).hexdigest()
    assert objects.replace("a", {"v": 2}, expected=first.token)
    for token in (None, first.token):
        with pytest.raises(m.ObjectConflict):
            objects.replace("a", {"v": 3}, expected=token)
    assert json.loads(objects.read("a").body) == {"v": 2}


@pytest.mark.parametrize("key", ["", "/a", "a/./b", "a/../b", ".", "..", "a\\..\\b"])
@pytest.mark.parametrize("operation", ["read", "create", "replace", "list_keys"])
def test_unsafe_keys_are_refused(objects, key, operation):
    with pytest.raises(ValueError):
        if operation == "replace":
            objects.replace(key, {}, expected=None)
        elif operation == "create":
            objects.create(key, {})
        elif operation == "list_keys":
            list(objects.list_keys(key))
        else:
            objects.read(key)


def test_second_replace_of_one_key_waits_out_interval(tmp_path):
    now, sleeps = [0.0], []

    def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    obj = m.SnapshotConditionalObjects(
        LocalSnapshotStorage(str(tmp_path), "control/v1"), monotonic=lambda: now[0], sleep=sleep
    )
    obj.create("a", {"v": 1})
    now[0] = 0.25
    obj.replace("a", {"v": 2}, expected=obj.read("a").token)
    obj.replace("b", {}, expected=None)
    assert sleeps == [0.75]
    obj.replace("a", {"v": 3}, expected=obj.read("a").token)
    assert sleeps == [0.75, 1.0]


class Client:
    def __init__(self, status):
        self.status, self.calls = status, []

    def head_object(self, **kw):
        return {
            "ETag": '"one"',
            "ContentLength": 2,
            "LastModified": datetime(2026, 1, 1, tzinfo=UTC),
        }

    def get_object(self, **kw):
        self.calls.append(kw)
        raise ClientError(
            {
                "Error": {"Code": str(self.status)},
                "ResponseMetadata": {"HTTPStatusCode": self.status},
            },
            "GetObject",
        )

    put_object = get_object


@pytest.mark.parametrize("status,error", [(412, m.ObjectConflict), (429, m.ObjectRateLimited)])
def test_read_race_and_rate_limit(status, error):
    client = Client(status)
    obj = m.SnapshotConditionalObjects(SnapshotStorage(client, bucket="private", base_prefix="x"))
    with pytest.raises(error):
        obj.read("a")
    assert client.calls == [{"Bucket": "private", "Key": "x/a", "IfMatch": '"one"'}]


def test_r2_429_becomes_rate_limited_and_is_not_retried():
    client = Client(429)
    obj = m.SnapshotConditionalObjects(SnapshotStorage(client, bucket="private", base_prefix="x"))
    with pytest.raises(m.ObjectRateLimited):
        obj.replace("a", {}, expected=None)
    assert len(client.calls) == 1


@pytest.mark.parametrize(
    "factory,prefix", [(m.ledger_objects, "ledger/v1"), (m.control_objects, "control/v1")]
)
def test_factories_use_private_bronze_store_without_network(tmp_path, monkeypatch, factory, prefix):
    settings = Settings(_env_file=None, BRONZE_LOCAL_ROOT=str(tmp_path), BRONZE_S3_BUCKET="private")
    local = factory(settings)
    assert not list(tmp_path.iterdir())
    local.create("a", {})
    assert (tmp_path / prefix / "a").read_bytes() == b"{}"
    client = Client(429)
    monkeypatch.setattr(m, "build_s3_client", lambda settings: client)
    remote = factory(settings.model_copy(update={"BRONZE_STORAGE_BACKEND": "s3"}))
    with pytest.raises(m.ObjectRateLimited):
        remote.replace("a", {}, expected=None)
    assert client.calls[0]["Bucket"] == "private"
    assert client.calls[0]["Key"] == prefix + "/a"


def test_key_parts_escape_separators_and_colons():
    assert m.key_part("stop_time_diet:a/b") == "stop_time_diet%3Aa%2Fb"
