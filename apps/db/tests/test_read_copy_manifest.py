import hashlib
import io
from dataclasses import replace
from datetime import UTC, datetime

import pytest
from history_fixtures import scripted_feed_day

from transit_ops.history.ledger import ArchiveCopy
from transit_ops.history.manifest import (
    ManifestInvalid,
    build_manifest,
    encode_manifest,
    read_copy_manifest,
)
from transit_ops.history.pack import write_pack
from transit_ops.ingestion.storage import LocalBronzeStorage


@pytest.fixture
def stored_manifest(tmp_path):
    record, payloads = scripted_feed_day()
    pack = write_pack(payloads, io.BytesIO())
    entries = iter(pack.captures)
    record = replace(
        record,
        captures=tuple(
            replace(c, stream=(p := next(entries)).stream, offset=p.offset) if c.packed else c
            for c in record.captures
        ),
    )
    now = datetime(2026, 1, 3, tzinfo=UTC)
    manifest = build_manifest(
        record,
        feed_endpoint_id=1,
        feed_kind="trip_updates",
        content_version=1,
        supersedes=None,
        pack_path="archive/pack.xz",
        pack=pack,
        sealed_at_utc=now,
        sealed_by="commit",
    )
    data = encode_manifest(manifest)
    path = "manifest.json.gz"
    (tmp_path / path).write_bytes(data)
    copy = _copy(data, path, now)
    storage = LocalBronzeStorage("local", tmp_path)

    def resolve(backend):
        assert backend == "local"
        return storage

    return resolve, copy, manifest


def _copy(data, path, now):
    return ArchiveCopy(
        dataset_id="capture.feed",
        provider_id="network",
        revision=1,
        window_key="2026-01-02",
        content_version=1,
        schema_version=1,
        storage_backend="local",
        storage_path=None,
        manifest_path=path,
        byte_size=None,
        sha256=None,
        manifest_sha256=hashlib.sha256(data).hexdigest(),
        record_count=None,
        poll_count=None,
        source_bytes=None,
        content_sha256=None,
        poll_record_sha256=None,
        first_time_utc=None,
        last_time_utc=None,
        allocated_at_utc=now,
        sealed_at_utc=now,
        verified_at_utc=None,
        rejected_at_utc=None,
        reject_reason=None,
        details={},
        window_start=None,
        is_current=False,
    )


def test_copy_manifest_is_read_and_checked(stored_manifest):
    storage, copy, manifest = stored_manifest
    assert read_copy_manifest(storage, copy) == manifest


def test_manifest_that_differs_from_its_row_is_refused(stored_manifest):
    storage, copy, _ = stored_manifest
    for changes in (
        {"manifest_sha256": "0" * 64},
        {"content_version": 2},
        {"window_key": "2026-01-03"},
        {"provider_id": "another"},
        {"dataset_id": "capture.another"},
    ):
        with pytest.raises(ManifestInvalid):
            read_copy_manifest(storage, replace(copy, **changes))
    for field in ("manifest_path", "manifest_sha256"):
        with pytest.raises(ValueError, match=field):
            read_copy_manifest(storage, replace(copy, **{field: None}))
    with pytest.raises(FileNotFoundError):
        read_copy_manifest(storage, replace(copy, manifest_path="absent"))
