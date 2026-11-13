"""Deterministic, self-verifying descriptions of capture packs."""

import gzip
import hashlib
import io
import json
import re
import zlib
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime

from transit_ops.history.pack import PackedCapture, PackResult, StreamEntry
from transit_ops.history.poll_record import (
    CaptureEntry,
    FeedDayKey,
    PollEntry,
    PollRecord,
    PollRecordInvalid,
    ProcessingEntry,
    canonical_json,
    ordered_record,
    poll_record_sha256,
    typed_value,
)

FORMAT = "transit-capture-pack"
FORMAT_VERSION = 1


@dataclass(frozen=True)
class PackReference:
    path: str
    byte_size: int
    sha256: str


@dataclass(frozen=True)
class Manifest(FeedDayKey):
    format: str
    format_version: int
    feed_endpoint_id: int
    feed_kind: str
    content_version: int
    supersedes: int | None
    codec: str
    codec_params: dict[str, str | int]
    pack: PackReference | None
    streams: tuple[StreamEntry, ...]
    capture_count: int
    poll_count: int
    source_bytes: int
    first_time_utc: datetime | None
    last_time_utc: datetime | None
    declared_interval_seconds: int | None
    observed_interval_ms: int | None
    poll_record_sha256: str
    content_sha256: str
    sealed_at_utc: datetime
    sealed_by: str
    polls: tuple[PollEntry, ...]
    captures: tuple[CaptureEntry, ...]
    processing: tuple[ProcessingEntry, ...]


class ManifestInvalid(PollRecordInvalid):
    pass


def content_sha256(manifest: Manifest) -> str:
    head = asdict(manifest)
    value = dict(
        format=head["format"],
        format_version=head["format_version"],
        codec=head["codec"],
        codec_params=head["codec_params"],
        poll_record_sha256=head["poll_record_sha256"],
        pack=head["pack"],
        streams=head["streams"],
    )
    value["capture_layout"] = [
        {k: c[k] for k in ("index_family", "capture_row_id", "packed", "stream", "offset")}
        for c in sorted(
            head["captures"],
            key=lambda c: (c["captured_at_utc"].astimezone(UTC), c["capture_row_id"]),
        )
    ]
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _layout(record: PollRecord, pack: PackResult | None, path: str | None) -> None:
    captures = [c for c in record.captures if c.packed]
    if pack is not None and not re.fullmatch("[0-9a-f]{64}", pack.sha256):
        raise ManifestInvalid("invalid pack checksum")
    if (pack is None) != (path is None) or (pack is None) != (not captures):
        raise ManifestInvalid("pack presence differs")
    if any(c.stream is not None or c.offset is not None for c in record.captures if not c.packed):
        raise ManifestInvalid("unpacked capture has a layout")
    expected = tuple(
        PackedCapture(c.stream, c.offset, c.byte_size, c.sha256)
        for c in captures
        if c.stream is not None and c.offset is not None
    )
    if pack is not None and (len(expected) != len(captures) or expected != pack.captures):
        raise ManifestInvalid("pack captures differ")
    ids = {(c.index_family, c.capture_row_id) for c in record.captures}
    if any(
        p.status == "stored" and (p.index_family, p.capture_row_id) not in ids for p in record.polls
    ):
        raise ManifestInvalid("stored poll names absent capture")


def build_manifest(
    record: PollRecord,
    *,
    feed_endpoint_id: int,
    feed_kind: str,
    content_version: int,
    supersedes: int | None,
    pack_path: str | None,
    pack: PackResult | None,
    sealed_at_utc: datetime,
    sealed_by: str,
) -> Manifest:
    try:
        record = ordered_record(record)
        _layout(record, pack, pack_path)
        m = Manifest(
            **asdict(record.feed_day),
            format=FORMAT,
            format_version=FORMAT_VERSION,
            feed_endpoint_id=feed_endpoint_id,
            feed_kind=feed_kind,
            content_version=content_version,
            supersedes=supersedes,
            codec="xz",
            codec_params={"check": "crc64", "preset": 6},
            pack=PackReference(pack_path, pack.byte_size, pack.sha256)
            if pack and pack_path is not None
            else None,
            streams=pack.streams if pack else (),
            capture_count=len(record.captures),
            poll_count=len(record.polls),
            source_bytes=sum(c.byte_size for c in record.captures if c.packed),
            first_time_utc=record.polls[0].time_utc if record.polls else None,
            last_time_utc=record.polls[-1].time_utc if record.polls else None,
            declared_interval_seconds=record.declared_interval_seconds,
            observed_interval_ms=record.observed_interval_ms,
            poll_record_sha256=poll_record_sha256(record),
            content_sha256="0" * 64,
            sealed_at_utc=sealed_at_utc,
            sealed_by=sealed_by,
            polls=record.polls,
            captures=record.captures,
            processing=record.processing,
        )
        m = replace(m, content_sha256=content_sha256(m))
        typed_value(Manifest, asdict(m))
        return m
    except (TypeError, ValueError, KeyError) as exc:
        raise ManifestInvalid(str(exc)) from exc


def encode_manifest(manifest: Manifest) -> bytes:
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb", compresslevel=9, mtime=0) as stream:
        stream.write(canonical_json(asdict(manifest)))
    return out.getvalue()


def decode_manifest(data: bytes) -> Manifest:
    try:
        m: Manifest = typed_value(Manifest, json.loads(gzip.decompress(data)))
        if (m.format, m.format_version, m.codec, m.codec_params) != (
            FORMAT,
            FORMAT_VERSION,
            "xz",
            {"check": "crc64", "preset": 6},
        ):
            raise ManifestInvalid("unsupported format or codec")
        record = PollRecord(
            FeedDayKey(m.provider_id, m.endpoint_key, m.index_family, m.utc_date),
            m.polls,
            m.captures,
            m.processing,
            m.declared_interval_seconds,
            m.observed_interval_ms,
        )
        packed = tuple(
            PackedCapture(c.stream, c.offset, c.byte_size, c.sha256)
            for c in m.captures
            if c.packed and c.stream is not None and c.offset is not None
        )
        pack = (
            PackResult(m.pack.byte_size, m.pack.sha256, m.source_bytes, m.streams, packed)
            if m.pack
            else None
        )
        rebuilt = build_manifest(
            record,
            feed_endpoint_id=m.feed_endpoint_id,
            feed_kind=m.feed_kind,
            content_version=m.content_version,
            supersedes=m.supersedes,
            pack_path=m.pack.path if m.pack else None,
            pack=pack,
            sealed_at_utc=m.sealed_at_utc,
            sealed_by=m.sealed_by,
        )
        if m != rebuilt:
            raise ManifestInvalid("manifest digest or derived fields differ")
        return m
    except (ValueError, TypeError, KeyError, OSError, EOFError, zlib.error) as exc:
        raise ManifestInvalid(str(exc)) from exc
