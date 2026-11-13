"""Scripted feed-days shared by offline history tests."""

import hashlib
from datetime import UTC, date, datetime, timedelta

from transit_ops.history.poll_record import (
    CaptureEntry,
    FeedDay,
    PollEntry,
    PollRecord,
    ProcessingEntry,
)


def scripted_feed_day(
    *, index_family="realtime_snapshot", provider_id="network", endpoint_key="feed"
):
    start = datetime(2026, 1, 2, tzinfo=UTC)
    payloads = (b"first", b"second", b"second")
    captures, polls = [], []
    for i, status in enumerate(
        ("stored", "stored", "stored", "failed", "unfinished", "capture_missing")
    ):
        at = start + timedelta(seconds=30 * i)
        indexed = i in (0, 1, 2, 5)
        source = "header" if i == 0 else "capture_time" if indexed else None
        stamp = at - timedelta(seconds=2) if i == 0 else at if indexed else None
        polls.append(_poll(i, status, at, stamp, source, indexed, index_family))
        if indexed:
            data = payloads[i] if i < 3 else b"missing"
            captures.append(_capture(i, data, at, stamp, source, payloads, index_family))
    return PollRecord(
        FeedDay(provider_id, endpoint_key, index_family, date(2026, 1, 2)),
        tuple(polls),
        tuple(captures),
        _processing(index_family, start),
        30,
        30_000,
    ), payloads


def _poll(i, status, at, stamp, source, indexed, index_family):
    return PollEntry(
        i,
        "i3_alerts" if index_family == "alert_snapshot" else "trip_updates",
        status,
        "succeeded" if indexed else status,
        at,
        at,
        None if status == "unfinished" else at,
        at,
        200 if indexed else None,
        "failure" if status == "failed" else None,
        stamp,
        source,
        1 if indexed else None,
        index_family,
        i if indexed else None,
        None,
        "absent" if i == 5 else None,
    )


def _capture(i, data, at, stamp, source, payloads, index_family):
    return CaptureEntry(
        index_family,
        i,
        i,
        i,
        i < 3,
        0 if i < 3 else None,
        sum(map(len, payloads[:i])) if i < 3 else None,
        len(data),
        hashlib.sha256(data).hexdigest(),
        "s3",
        f"capture/{i}",
        "realtime",
        "https://example.invalid/feed",
        at,
        at,
        at,
        stamp,
        source,
        1,
        200,
        "v1" if index_family == "alert_snapshot" else None,
        1 if index_family == "alert_snapshot" else None,
    )


def _processing(index_family, start):
    processing = [
        ProcessingEntry(
            "silver_load",
            index_family,
            2,
            "by_time",
            "failed",
            start + timedelta(seconds=90),
            start + timedelta(seconds=90),
            "load failed",
            None,
            20,
        )
    ]
    processing.extend(
        ProcessingEntry(
            "gold_facts",
            index_family,
            (0, 1, 2, 5)[i],
            "recorded",
            status,
            None,
            start,
            None,
            rows,
            None,
        )
        for i, (status, rows) in enumerate(
            (("observed", 2), ("none_observed", 0), ("not_observed", None), ("failed", None))
        )
    )
    return tuple(processing)
