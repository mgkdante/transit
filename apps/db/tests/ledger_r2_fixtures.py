"""Conditional S3 test store with opaque tokens and lost acknowledgements."""

import io
import json
from hashlib import sha256

import pytest
from botocore.exceptions import ClientError, ReadTimeoutError
from test_ledger_r2_documents import DOC as DOC
from test_ledger_r2_documents import ID as ID
from test_ledger_r2_documents import NOW
from test_ledger_r2_documents import RECORD as RECORD

from transit_ops.control.objects import SnapshotConditionalObjects
from transit_ops.history import ledger_r2_documents as m
from transit_ops.snapshots.serialization import snapshot_json_bytes
from transit_ops.snapshots.storage import SnapshotStorage


def error(status, code):
    return ClientError(
        {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}, "ObjectOperation"
    )


class S3:
    def __init__(self):
        self.objects, self.failure, self.unreadable = {}, None, False

    def head_object(self, **kw):
        if kw["Key"] not in self.objects:
            raise error(404, "NoSuchKey")
        body = self.objects[kw["Key"]]
        return {
            "ETag": '"opaque-' + sha256(body).hexdigest() + '"',
            "ContentLength": len(body),
            "LastModified": NOW,
            "Metadata": {},
        }

    def get_object(self, **kw):
        if self.unreadable:
            raise ReadTimeoutError(endpoint_url="https://example.invalid")
        meta = self.head_object(**kw)
        if "IfMatch" in kw and kw["IfMatch"] != meta["ETag"]:
            raise error(412, "PreconditionFailed")
        return {**meta, "Body": io.BytesIO(self.objects[kw["Key"]])}

    def put_object(self, **kw):
        key = kw["Key"]
        if kw.get("IfNoneMatch") == "*" and key in self.objects:
            raise error(412, "PreconditionFailed")
        if "IfMatch" in kw and (
            key not in self.objects or self.head_object(Key=key)["ETag"] != kw["IfMatch"]
        ):
            raise error(412, "PreconditionFailed")
        self.objects[key] = kw["Body"]
        if self.failure:
            self.unreadable = self.failure == "unreadable"
            self.failure = None
            raise ReadTimeoutError(endpoint_url="https://example.invalid")
        return {}

    def list_objects_v2(self, **kw):
        return {
            "Contents": [
                {"Key": key, **self.head_object(Key=key)}
                for key in sorted(self.objects)
                if key.startswith(kw["Prefix"])
            ],
            "IsTruncated": False,
        }


def remote(client):
    return SnapshotConditionalObjects(
        SnapshotStorage(client, bucket="private", base_prefix="x"), min_interval_s=0
    )


@pytest.fixture
def pair():
    client = S3()
    return client, remote(client), remote(client)


def seed(objects, after, seq, *, previous=None, records=(RECORD,), at=NOW):
    before = snapshot_json_bytes(m.encode_window(previous)) if previous is not None else None
    prior = objects.read(m.transition_key(ID, seq - 1)) if seq > 1 else None
    first = json.loads(prior.body)["next_record"] if prior is not None else 1
    _, envelope = m.prepare_transition(
        after, records, ID, seq, before, at, operation_id=f"seed-{seq}", first_record=first
    )
    objects.create(m.transition_key(ID, seq), envelope)
