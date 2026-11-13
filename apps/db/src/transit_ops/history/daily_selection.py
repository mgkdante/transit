"""Read-only discovery and classification of capture archive work."""

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from functools import total_ordering
from typing import Literal

from sqlalchemy import Connection, text

from transit_ops.history import datasets as declarations
from transit_ops.history import ledger
from transit_ops.history.working_captures import rows_fingerprint


@total_ordering
@dataclass(frozen=True)
class CaptureDay:
    provider_id: str
    dataset_id: str
    utc_date: date
    # Carry the caller's absence-proof bound through discovery to classification.
    empty_since: datetime | None = field(default=None, compare=False, repr=False)

    def __lt__(self, other: object) -> bool:
        if not isinstance(other, CaptureDay):
            return NotImplemented
        return (-self.utc_date.toordinal(), self.provider_id, self.dataset_id) < (
            -other.utc_date.toordinal(),
            other.provider_id,
            other.dataset_id,
        )


@dataclass(frozen=True)
class CaptureDayStatus:
    state: Literal["needs_work", "refused", "unchanged"]
    reason: str
    overdue_first_seal: bool = False


def _source(dataset_id: str) -> declarations.CaptureSource:
    source = declarations.get_dataset(dataset_id).source
    if not isinstance(source, declarations.CaptureSource):
        raise ValueError(f"not a capture dataset: {dataset_id}")
    return source


def _date(value: date) -> None:
    if type(value) is not date:
        raise ValueError("capture dates must be dates")


def _instant(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise ValueError("clock and empty_since must be timezone aware")
    return value.astimezone(UTC)


_PROVIDERS = """
    SELECT e.provider_id FROM core.feed_endpoints e
    WHERE e.endpoint_key = ANY(:capture_feeds)
      AND EXISTS (
          SELECT 1 FROM raw.ingestion_runs r
          WHERE r.provider_id = e.provider_id AND r.feed_endpoint_id = e.feed_endpoint_id
            AND r.started_at_utc >= :qualify_from AND r.started_at_utc < :end_at
          OFFSET 0 -- Keep the per-endpoint existence probe correlated.
      )
    UNION
    SELECT provider_id FROM core.history_window WHERE dataset_id = ANY(:capture_ids)
"""

_DAYS = """
WITH evidenced AS (
    SELECT r.provider_id, (r.started_at_utc AT TIME ZONE 'UTC')::date AS day
    FROM raw.ingestion_runs r JOIN core.feed_endpoints e USING (provider_id, feed_endpoint_id)
    WHERE e.endpoint_key = :endpoint AND r.started_at_utc >= :start_at
      AND r.started_at_utc < :end_at
    UNION
    SELECT provider_id, window_start FROM core.history_window
    WHERE dataset_id = :dataset AND revision = 0 AND window_start BETWEEN :start_day AND :end_day
), absent AS (
    SELECT e.provider_id, d::date AS day
    FROM core.feed_endpoints e
    CROSS JOIN generate_series(CAST(:start_day AS date)::timestamp,
                              CAST(:end_day AS date)::timestamp, interval '1 day') d
    WHERE e.provider_id = ANY(:providers) AND e.endpoint_key = :endpoint
      AND CAST(:empty_at AS timestamptz) IS NOT NULL
      AND d AT TIME ZONE 'UTC' >= CAST(:empty_at AS timestamptz)
      AND d AT TIME ZONE 'UTC' >= e.created_at_utc
)
SELECT provider_id, day FROM evidenced UNION SELECT provider_id, day FROM absent
"""


def _providers(
    connection: Connection, start: datetime, end: datetime, empty_since: datetime | None
) -> list[str]:
    captures = [
        (k, v.source)
        for k, v in declarations.HISTORY_DATASETS.items()
        if isinstance(v.source, declarations.CaptureSource)
    ]
    rows = connection.execute(
        text(_PROVIDERS),
        dict(
            capture_feeds=[v.endpoint_key for _, v in captures],
            capture_ids=[k for k, _ in captures],
            qualify_from=min(_instant(start), _instant(empty_since or start)),
            end_at=_instant(end),
        ),
    ).scalars()
    return [str(provider) for provider in rows]


def capture_days(
    connection: Connection,
    *,
    datasets: Sequence[str],
    start: date,
    end: date,
    empty_since: datetime | None,
) -> list[CaptureDay]:
    """Return all evidenced and proven empty days, without a work-limit prefilter."""
    sources = [(dataset, _source(dataset)) for dataset in datasets]
    _date(start)
    _date(end)
    if start > end:
        raise ValueError("start must not be after end")
    if empty_since is not None:
        empty_since = _instant(empty_since)
    days: set[CaptureDay] = set()
    start_at = datetime.combine(start, time(), UTC)
    end_at = datetime.combine(end, time(), UTC) + timedelta(days=1)
    providers = _providers(connection, start_at, end_at, empty_since) if sources else []
    for dataset, source in sources:
        rows = connection.execute(
            text(_DAYS),
            dict(
                providers=list(providers),
                endpoint=source.endpoint_key,
                dataset=dataset,
                start_at=start_at,
                end_at=end_at,
                start_day=start,
                end_day=end,
                empty_at=empty_since,
            ),
        )
        days.update(CaptureDay(p, dataset, d, empty_since) for p, d in rows)
    return sorted(days)


def _working(connection: Connection, day: CaptureDay, endpoint: str) -> tuple[str, bool]:
    start = datetime.combine(day.utc_date, time(), UTC)
    row = connection.execute(
        text("""
        SELECT e.created_at_utc, EXISTS (
            SELECT 1 FROM raw.ingestion_runs r WHERE r.provider_id=e.provider_id
              AND r.feed_endpoint_id=e.feed_endpoint_id
              AND r.started_at_utc >= :start_at AND r.started_at_utc < :end_at
        ) AS evidenced FROM core.feed_endpoints e
        WHERE e.provider_id=:provider AND e.endpoint_key=:endpoint
    """),
        dict(
            provider=day.provider_id,
            endpoint=endpoint,
            start_at=start,
            end_at=start + timedelta(days=1),
        ),
    ).one_or_none()
    if row is None:
        return hashlib.sha256(b"").hexdigest(), False
    permitted = (
        day.empty_since is not None
        and _instant(start) >= _instant(day.empty_since)
        and _instant(start) >= _instant(row[0])
    )
    return rows_fingerprint(
        connection, provider_id=day.provider_id, endpoint_key=endpoint, utc_date=day.utc_date
    ), bool(row[1] or permitted)


def _current(
    window: ledger.WindowState | None, copies: list[ledger.ArchiveCopy]
) -> ledger.ArchiveCopy | None:
    if window is None or window.current_version is None:
        return None
    current = next((c for c in copies if c.content_version == window.current_version), None)
    if current is None or current.state != "verified":
        raise RuntimeError("invalid current capture copy")
    return current


def _classify(
    window: ledger.WindowState | None,
    copies: list[ledger.ArchiveCopy],
    fingerprint: str,
    evidenced: bool,
) -> tuple[Literal["needs_work", "refused", "unchanged"], str]:
    current = _current(window, copies)
    trimmed = window is not None and window.working_state in ("partial", "trimmed")
    if window and (window.hold_reason == "ledger_rebuilt" or (trimmed and current is None)):
        return "refused", "rebuilt_verification_required"
    pending = next((c for c in copies if c.state == "allocated"), None)
    waiting = any(
        c.state == "sealed" and (current is None or c.content_version > current.content_version)
        for c in copies
    )
    if trimmed:
        assert window is not None
        remainder = window.remainder_fingerprint
        if remainder is None and window.working_state == "trimmed":
            remainder = hashlib.sha256(b"").hexdigest()
        if pending or waiting or fingerprint != remainder:
            return "refused", "trimmed_work_requires_union"
        return "unchanged", "current_matches_remainder"
    if pending:
        return "needs_work", "repair_pending"
    if waiting:
        return "needs_work", "verification_pending"
    if current is None:
        return ("needs_work", "first_seal") if evidenced or window else ("refused", "unproven_gap")
    assert window is not None and current.verified_at_utc is not None
    if fingerprint != current.details.get("rows_fingerprint") or _instant(
        window.working_changed_at_utc
    ) > _instant(current.verified_at_utc):
        return "needs_work", "working_changed"
    return "unchanged", "current_matches_working"


def capture_day_status(
    connection: Connection, day: CaptureDay, *, now: datetime
) -> CaptureDayStatus:
    """Classify in the caller's transaction; never seal, verify, or mutate state."""
    source = _source(day.dataset_id)
    _date(day.utc_date)
    now = _instant(now)
    if day.empty_since is not None:
        _instant(day.empty_since)
    closes = declarations.utc_day_closes_at(day.utc_date)
    if _instant(now) < _instant(closes):
        return CaptureDayStatus("unchanged", "still_open")
    window = ledger.window_state(
        connection,
        dataset_id=day.dataset_id,
        provider_id=day.provider_id,
        window_key=day.utc_date.isoformat(),
    )
    copies = ledger.find_copies(
        connection,
        dataset_id=day.dataset_id,
        provider_id=day.provider_id,
        start=day.utc_date,
        end=day.utc_date,
    )
    fingerprint, evidenced = _working(connection, day, source.endpoint_key)
    state, reason = _classify(window, copies, fingerprint, evidenced)
    overdue = (
        _instant(now) >= _instant(closes) + timedelta(days=7)
        and (evidenced or window is not None)
        and not any(c.sealed_at_utc is not None for c in copies)
    )
    return CaptureDayStatus(state, reason, overdue)
