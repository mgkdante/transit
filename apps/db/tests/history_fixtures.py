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


def _working_endpoint(connection, provider_id, endpoint_key):
    from real_db_seed import feed_endpoints
    from sqlalchemy import text

    params = dict(p=provider_id, key=endpoint_key)
    endpoint = connection.execute(
        text(
            "SELECT feed_endpoint_id FROM core.feed_endpoints "
            "WHERE provider_id=:p AND endpoint_key=:key"
        ),
        params,
    ).scalar_one_or_none()
    if endpoint is None:
        endpoint = connection.execute(
            text(
                "SELECT nextval(pg_get_serial_sequence('core.feed_endpoints', 'feed_endpoint_id'))"
            )
        ).scalar_one()
        feed_endpoints(connection, dict(params, e=endpoint), endpoint_key=":key", feed_kind=":key")
    return endpoint


def _working_capture(connection, params, endpoint_key):
    from real_db_seed import ingestion_objects, realtime_snapshot_index
    from sqlalchemy import text

    ingestion_objects(connection, params, checksum_sha256=":checksum", byte_size="12")
    if endpoint_key in ("i3_alerts", "service_alerts"):
        connection.execute(
            text(
                "INSERT INTO raw.i3_alert_snapshots (i3_alert_snapshot_id, provider_id, "
                "feed_endpoint_id, ingestion_run_id, ingestion_object_id, captured_at_utc, "
                "storage_backend, storage_path, checksum_sha256, byte_size, http_status_code, "
                "api_version, alert_count, raw_payload_json) "
                "VALUES (:s,:p,:e,:r,:o,:end,'s3',:path,:checksum,12,200,'v1',2,'{}'::jsonb)"
            ),
            params,
        )
    else:
        realtime_snapshot_index(
            connection,
            params,
            ingestion_object_id=":o",
            feed_timestamp_utc=":stamp",
            captured_at_utc=":end",
        )


def _working_run(connection, params, with_capture):
    from real_db_seed import ingestion_runs
    from sqlalchemy import text

    ingestion_runs(
        connection,
        params,
        run_kind=":kind",
        status=":status",
        started_at_utc=":start",
        completed_at_utc="NULL" if params["status"] in ("pending", "running") else ":end",
    )
    connection.execute(
        text(
            "UPDATE raw.ingestion_runs SET requested_at_utc=:start, error_message=:error, "
            "feed_timestamp_utc=CASE WHEN :stored THEN :stamp ELSE NULL END, "
            "http_status_code=CASE WHEN :stored THEN 200 ELSE NULL END, "
            "entity_count=CASE WHEN :stored THEN :n ELSE NULL END WHERE ingestion_run_id=:r"
        ),
        dict(params, stored=with_capture),
    )


def seed_working_day(
    connection,
    *,
    provider_id,
    endpoint_key,
    run_id=1,
    capture_id=1,
    started_at_utc,
    captured_at_utc=None,
    feed_timestamp_utc=None,
    status="succeeded",
    error_message=None,
    with_capture=True,
    run_kind=None,
):
    """Seed one poll; the caller owns the provider and transaction. Return its endpoint id."""
    endpoint = _working_endpoint(connection, provider_id, endpoint_key)
    end = captured_at_utc or started_at_utc + timedelta(seconds=4)
    params = dict(
        p=provider_id,
        e=endpoint,
        r=run_id,
        s=capture_id,
        o=run_id,
        start=started_at_utc,
        end=end,
        stamp=feed_timestamp_utc or end,
        status=status,
        kind=run_kind or endpoint_key,
        error=error_message,
        path=f"capture/{run_id}",
        checksum="a" * 64,
        n=2,
    )
    _working_run(connection, params, with_capture)
    if with_capture:
        _working_capture(connection, params, endpoint_key)
    return endpoint
