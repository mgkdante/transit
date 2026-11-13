import gzip
import io
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone

import pytest
from history_fixtures import scripted_feed_day

from transit_ops.history.manifest import (
    ManifestInvalid,
    build_manifest,
    content_sha256,
    decode_manifest,
    encode_manifest,
)
from transit_ops.history.pack import read_pack, write_pack
from transit_ops.history.poll_record import canonical_json, observed_interval_ms, poll_record_sha256


def archive(*, family="realtime_snapshot", limit=1000):
    record, payloads = scripted_feed_day(index_family=family)
    out = io.BytesIO()
    pack = write_pack(payloads, out, stream_max_source_bytes=limit)
    entries = iter(pack.captures)
    captures = tuple(
        replace(c, stream=(p := next(entries)).stream, offset=p.offset) if c.packed else c
        for c in record.captures
    )
    return replace(record, captures=captures), pack, out.getvalue(), payloads


def manifest(record, pack, **changes):
    args = dict(
        feed_endpoint_id=1,
        feed_kind="trip_updates",
        content_version=1,
        supersedes=None,
        pack_path="archive/pack.xz" if pack else None,
        pack=pack,
        sealed_at_utc=datetime(2026, 1, 3, tzinfo=UTC),
        sealed_by="commit",
    )
    return build_manifest(record, **(args | changes))


@pytest.mark.parametrize("family", ["realtime_snapshot", "alert_snapshot"])
def test_manifest_lists_captures_in_capture_order_with_offsets(family):
    record, pack, data, payloads = archive(family=family)
    m = manifest(replace(record, captures=record.captures[::-1]), pack)
    assert m.captures == record.captures
    assert [(c.stream, c.offset, c.byte_size, c.sha256) for c in m.captures if c.packed] == [
        (c.stream, c.offset, c.byte_size, c.sha256) for c in pack.captures
    ]
    assert tuple(read_pack(io.BytesIO(data), m.streams, pack.captures)) == payloads
    assert decode_manifest(encode_manifest(m)) == m


def test_changing_a_poll_status_changes_the_content_digest():
    r, p, _, _ = archive()
    changed = replace(r, polls=(replace(r.polls[0], status="failed"), *r.polls[1:]))
    assert manifest(r, p).poll_record_sha256 != manifest(changed, p).poll_record_sha256
    assert manifest(r, p).content_sha256 != manifest(changed, p).content_sha256


def test_poll_record_digest_ignores_pack_layout():
    r, p, _, _ = archive()
    other, split, _, _ = archive(limit=5)
    m, n = manifest(r, p), manifest(other, split)
    assert m.poll_record_sha256 == n.poll_record_sha256
    assert m.content_sha256 != n.content_sha256
    resealed = manifest(
        r,
        p,
        content_version=2,
        supersedes=1,
        sealed_by="other",
        sealed_at_utc=m.sealed_at_utc + timedelta(days=1),
    )
    assert (m.poll_record_sha256, m.content_sha256) == (
        resealed.poll_record_sha256,
        resealed.content_sha256,
    )


def test_poll_record_digest_covers_processing_and_both_intervals():
    r, _, _, _ = archive()
    for changes in (dict(status="observed"), dict(rows=4)):
        assert poll_record_sha256(r) != poll_record_sha256(
            replace(r, processing=(replace(r.processing[0], **changes), *r.processing[1:]))
        )
    for changes in (dict(declared_interval_seconds=31), dict(observed_interval_ms=31_000)):
        assert poll_record_sha256(r) != poll_record_sha256(replace(r, **changes))
    assert poll_record_sha256(r) == poll_record_sha256(
        replace(r, polls=r.polls[::-1], captures=r.captures[::-1], processing=r.processing[::-1])
    )


def test_day_with_only_failed_polls_has_a_manifest_and_no_pack():
    r, _, _, _ = archive()
    r = replace(
        r, polls=tuple(p for p in r.polls if p.status == "failed"), captures=(), processing=()
    )
    m = manifest(r, None)
    assert (m.pack, m.streams, m.captures, m.polls) == (None, (), (), r.polls)
    assert decode_manifest(encode_manifest(m)) == m


def test_unpacked_capture_keeps_its_entry_with_packed_false():
    r, p, _, _ = archive()
    assert manifest(r, p).captures[-1] == r.captures[-1]
    assert (r.captures[-1].packed, r.captures[-1].stream, r.captures[-1].offset) == (
        False,
        None,
        None,
    )


def test_encoding_is_deterministic_and_round_trips():
    r, p, _, _ = archive()
    m = manifest(r, p)
    encoded = encode_manifest(m)
    assert encoded == encode_manifest(m)
    assert decode_manifest(encoded) == m
    raw = json.loads(gzip.decompress(encoded))
    raw["polls"][0]["entity_count"] += 1
    with pytest.raises(ManifestInvalid):
        decode_manifest(gzip.compress(canonical_json(raw), mtime=0))
    assert content_sha256(m) == m.content_sha256


def test_canonical_json_refuses_floats_and_naive_times():
    for value in (1.0, datetime(2026, 1, 1), {1: "key"}, {"nested": [object()]}):
        with pytest.raises(TypeError):
            canonical_json(value)
    at = datetime(2026, 1, 1, 2, tzinfo=timezone(timedelta(hours=2)))
    assert canonical_json({"é": at}) == '{"é":"2026-01-01T00:00:00.000000Z"}'.encode()


def test_observed_interval_is_the_lower_median_gap_in_milliseconds():
    at = datetime(2026, 1, 1, tzinfo=UTC)
    times = [at + timedelta(microseconds=x) for x in (0, 1001, 4002, 6003, 100004)]
    assert observed_interval_ms(times[:1]) is None
    assert observed_interval_ms(reversed(times[:4])) == 2
    assert observed_interval_ms(times) == 2


def test_record_and_pack_that_disagree_are_refused():
    r, p, _, _ = archive()
    cases = [
        (r, None, {}),
        (r, p, dict(pack_path=None)),
        (r, replace(p, sha256="invalid"), {}),
        (r, p, dict(sealed_at_utc=datetime(2026, 1, 1))),
        (replace(r, captures=()), p, {}),
        (replace(r, captures=r.captures[1:]), p, {}),
        (replace(r, captures=(replace(r.captures[-1], stream=0),)), None, {}),
        (replace(r, captures=(replace(r.captures[-1], offset=0),)), None, {}),
    ]
    for field, value in (("stream", 9), ("offset", 9), ("byte_size", 9), ("sha256", "a" * 64)):
        cases.append(
            (
                replace(r, captures=(replace(r.captures[0], **{field: value}), *r.captures[1:])),
                p,
                {},
            )
        )
    cases.append((replace(r, polls=(replace(r.polls[0], capture_row_id=99),)), p, {}))
    for record, pack, changes in cases:
        with pytest.raises(ManifestInvalid):
            manifest(record, pack, **changes)


def test_invalid_entries_and_duplicate_identities_are_refused():
    from transit_ops.history.poll_record import PollRecordInvalid

    r, p, _, _ = archive()
    for section, fields in {
        "polls": dict(status="bad", index_family="bad", feed_timestamp_source="bad"),
        "captures": dict(
            index_family="bad",
            feed_timestamp_source=None,
            sha256="A" * 64,
            api_version="v1",
            alert_count=1,
            captured_at_utc=datetime(2026, 1, 1),
        ),
        "processing": dict(stage="bad", status="bad", attribution="bad"),
    }.items():
        entries = getattr(r, section)
        for field, value in fields.items():
            changed = replace(r, **{section: (replace(entries[0], **{field: value}), *entries[1:])})
            with pytest.raises(PollRecordInvalid):
                poll_record_sha256(changed)
            with pytest.raises(ManifestInvalid):
                manifest(changed, p)
            raw = json.loads(gzip.decompress(encode_manifest(manifest(r, p))))
            raw[section][0][field] = value.isoformat() if isinstance(value, datetime) else value
            with pytest.raises(ManifestInvalid):
                decode_manifest(gzip.compress(canonical_json(raw), mtime=0))
        changed = (
            replace(r, **{section: (*entries, entries[0])})
            if section != "processing"
            else replace(r, feed_day=replace(r.feed_day, index_family="bad"))
        )
        with pytest.raises(PollRecordInvalid):
            poll_record_sha256(changed)


@pytest.mark.parametrize(
    "field,value",
    [
        ("format", "unknown"),
        ("format_version", 2),
        ("content_sha256", "0" * 64),
        ("poll_record_sha256", "0" * 64),
        ("observed_interval_ms", 1.5),
    ],
)
def test_invalid_manifest_head_is_refused(field, value):
    r, p, _, _ = archive()
    raw = json.loads(gzip.decompress(encode_manifest(manifest(r, p))))
    raw[field] = value
    with pytest.raises(ManifestInvalid):
        decode_manifest(gzip.compress(json.dumps(raw).encode(), mtime=0))


def test_processing_null_time_sorts_before_the_earliest_instant():
    from transit_ops.history.poll_record import ordered_record

    r, _, _, _ = archive()
    absent = replace(r.processing[1], started_at_utc=None, capture_row_id=99)
    earliest = replace(absent, started_at_utc=datetime.min.replace(tzinfo=UTC), capture_row_id=0)
    assert ordered_record(replace(r, processing=(earliest, absent))).processing == (
        absent,
        earliest,
    )


@pytest.mark.parametrize(
    "changes",
    [dict(status="failed"), dict(rows=3), dict(completed_at_utc=datetime(2026, 1, 4, tzinfo=UTC))],
)
def test_tied_processing_outcomes_have_a_total_order(changes):
    from transit_ops.history.poll_record import ordered_record

    r, _, _, _ = archive()
    first = r.processing[1]
    second = replace(first, **changes)
    forward = replace(r, processing=(first, second))
    backward = replace(r, processing=(second, first))
    assert poll_record_sha256(forward) == poll_record_sha256(backward)
    assert ordered_record(forward).processing == ordered_record(backward).processing


@pytest.mark.parametrize("section", ["polls", "captures", "processing"])
def test_entries_must_carry_the_feed_day_index_family(section):
    from transit_ops.history.poll_record import PollRecordInvalid

    r, p, _, _ = archive()
    entries = getattr(r, section)
    other = replace(entries[0], index_family="alert_snapshot")
    changed = replace(r, **{section: (other, *entries[1:])})
    with pytest.raises(PollRecordInvalid):
        poll_record_sha256(changed)
    with pytest.raises(ManifestInvalid):
        manifest(changed, p)
