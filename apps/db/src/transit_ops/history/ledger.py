"""Window coordination and audit writes in the caller's transaction."""

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, fields
from datetime import UTC, date, datetime
from typing import Final, Literal, get_args

from sqlalchemy import Connection, text

from transit_ops.history import datasets

EventKind = Literal[
    "seal",
    "verify",
    "reject",
    "current",
    "trim",
    "restore",
    "hold",
    "unhold",
    "changed",
    "close_runs",
    "fold_published",
    "processing_evidence",
    "rebuild",
]
WorkingState = Literal["present", "partial", "trimmed", "empty"]
CopyState = Literal["allocated", "sealed", "verified", "rejected"]
HOLD_NO_END: Final[datetime] = datetime.max.replace(tzinfo=UTC)


class WindowNotFound(LookupError):
    """A hold was requested for a window that does not exist."""


@dataclass(frozen=True)
class WindowState:
    dataset_id: str
    provider_id: str
    revision: int
    window_key: str
    window_start: date | None
    working_state: WorkingState
    working_changed_at_utc: datetime
    next_version: int
    current_version: int | None
    trimmed_at_utc: datetime | None
    hold_until_utc: datetime | None
    hold_reason: str | None
    remainder_fingerprint: str | None


@dataclass(frozen=True)
class ArchiveCopy:
    dataset_id: str
    provider_id: str
    revision: int
    window_key: str
    content_version: int
    schema_version: int
    storage_backend: str
    storage_path: str | None
    manifest_path: str | None
    byte_size: int | None
    sha256: str | None
    manifest_sha256: str | None
    record_count: int | None
    poll_count: int | None
    source_bytes: int | None
    content_sha256: str | None
    poll_record_sha256: str | None
    first_time_utc: datetime | None
    last_time_utc: datetime | None
    allocated_at_utc: datetime
    sealed_at_utc: datetime | None
    verified_at_utc: datetime | None
    rejected_at_utc: datetime | None
    reject_reason: str | None
    details: dict[str, object]
    window_start: date | None
    is_current: bool

    @property
    def state(self) -> CopyState:
        if self.rejected_at_utc is not None:
            return "rejected"
        if self.verified_at_utc is not None:
            return "verified"
        if self.sealed_at_utc is not None:
            return "sealed"
        return "allocated"


def _window_start(dataset: datasets.HistoryDataset, key: str, revision: int) -> date | None:
    start = datasets.window_start(dataset, key)
    _check_revision(dataset, revision)
    return start


def _check_revision(dataset: datasets.HistoryDataset, revision: int) -> None:
    source = dataset.source
    if isinstance(source, datasets.TableSource):
        valid = (
            revision >= 0
            if source.revision_column is not None
            else revision == source.fixed_revision
        )
    else:
        valid = revision == 0
    if not valid:
        raise ValueError("revision does not fit the dataset declaration")


def _lock(connection: Connection, identity: Mapping[str, object]) -> None:
    key = ["transit.history_window"] + [
        identity[field] for field in ("dataset_id", "provider_id", "revision", "window_key")
    ]
    connection.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(CAST(:lock_key AS text), 0))"),
        {"lock_key": json.dumps(key, separators=(",", ":"))},
    )


def acquire_window_lock(
    connection: Connection,
    *,
    dataset_id: str,
    provider_id: str,
    window_key: str,
    revision: int = 0,
) -> None:
    _window_start(datasets.get_dataset(dataset_id), window_key, revision)
    _lock(
        connection,
        dict(
            dataset_id=dataset_id, provider_id=provider_id, revision=revision, window_key=window_key
        ),
    )


def lock_window(
    connection: Connection,
    *,
    dataset_id: str,
    provider_id: str,
    window_key: str,
    revision: int = 0,
    actor: str | None = None,
) -> None:
    dataset = datasets.get_dataset(dataset_id)
    start = _window_start(dataset, window_key, revision)
    if actor == "":
        raise ValueError("actor must not be empty")
    identity = dict(
        dataset_id=dataset_id, provider_id=provider_id, revision=revision, window_key=window_key
    )
    _lock(connection, identity)
    connection.execute(
        text("""
        INSERT INTO core.history_window
            (dataset_id, provider_id, revision, window_key, window_start,
             working_state, working_changed_at_utc)
        VALUES (:dataset_id, :provider_id, :revision, :window_key, :window_start,
                'present', clock_timestamp())
        ON CONFLICT (dataset_id, provider_id, revision, window_key)
        DO UPDATE SET working_state = 'present', working_changed_at_utc = clock_timestamp()
        """),
        {**identity, "window_start": start},
    )
    record_event(
        connection,
        kind="changed",
        dataset_id=dataset_id,
        provider_id=provider_id,
        revision=revision,
        window_key=window_key,
        actor=actor,
    )


def allocate_version(
    connection: Connection,
    *,
    dataset_id: str,
    provider_id: str,
    window_key: str,
    revision: int = 0,
    above_version: int = 0,
) -> int:
    dataset = datasets.get_dataset(dataset_id)
    start = _window_start(dataset, window_key, revision)
    if above_version < 0:
        raise ValueError("above_version must be nonnegative")
    identity = dict(
        dataset_id=dataset_id, provider_id=provider_id, revision=revision, window_key=window_key
    )
    _lock(connection, identity)
    connection.execute(
        text("""
        INSERT INTO core.history_window
            (dataset_id, provider_id, revision, window_key, window_start,
             working_state, working_changed_at_utc)
        VALUES (:dataset_id, :provider_id, :revision, :window_key, :window_start,
                'present', clock_timestamp())
        ON CONFLICT (dataset_id, provider_id, revision, window_key) DO NOTHING
        """),
        {**identity, "window_start": start},
    )
    return int(
        connection.execute(
            text("""
        UPDATE core.history_window
        SET next_version = GREATEST(next_version, :above_version + 1) + 1
        WHERE dataset_id = :dataset_id AND provider_id = :provider_id
          AND revision = :revision AND window_key = :window_key
        RETURNING next_version - 1
        """),
            {**identity, "above_version": above_version},
        ).scalar_one()
    )


def record_event(
    connection: Connection,
    *,
    kind: EventKind,
    dataset_id: str,
    provider_id: str,
    revision: int,
    window_key: str,
    content_version: int | None = None,
    reason: str | None = None,
    details: Mapping[str, object] | None = None,
    actor: str | None = None,
) -> int:
    datasets.get_dataset(dataset_id)
    if kind not in get_args(EventKind):
        raise ValueError("unknown history event kind")
    if content_version is not None and content_version < 1:
        raise ValueError("content_version must be positive")
    if reason == "" or actor == "":
        raise ValueError("reason and actor must not be empty")
    encoded = json.dumps(details or {}, sort_keys=True, separators=(",", ":"))
    return int(
        connection.execute(
            text("""
        INSERT INTO core.history_event
            (kind, dataset_id, provider_id, revision, window_key, content_version,
             reason, details, actor)
        VALUES (:kind, :dataset_id, :provider_id, :revision, :window_key, :content_version,
                :reason, CAST(:details AS jsonb),
                COALESCE(:actor, NULLIF(current_setting('application_name', true), ''),
                         current_user))
        RETURNING event_id
        """),
            dict(
                kind=kind,
                dataset_id=dataset_id,
                provider_id=provider_id,
                revision=revision,
                window_key=window_key,
                content_version=content_version,
                reason=reason,
                details=encoded,
                actor=actor,
            ),
        ).scalar_one()
    )


def _set_hold(
    connection: Connection, identity: Mapping[str, object], until: datetime | None, reason: str
) -> None:
    result = connection.execute(
        text("""
        UPDATE core.history_window
        SET hold_until_utc = CASE WHEN :no_end THEN 'infinity'::timestamptz
                                 ELSE CAST(:until_utc AS timestamptz) END,
            hold_reason = :reason
        WHERE dataset_id = :dataset_id AND provider_id = :provider_id
          AND revision = :revision AND window_key = :window_key
        """),
        {
            **identity,
            "no_end": until == HOLD_NO_END,
            "until_utc": None if until == HOLD_NO_END else until,
            "reason": reason if until is not None else None,
        },
    )
    if result.rowcount == 0:
        raise WindowNotFound(f"history window not found: {dict(identity)}")


def hold(
    connection: Connection,
    *,
    dataset_id: str,
    provider_id: str,
    window_key: str,
    revision: int = 0,
    until_utc: datetime | None,
    reason: str,
    actor: str | None = None,
) -> None:
    dataset = datasets.get_dataset(dataset_id)
    _window_start(dataset, window_key, revision)
    if reason == "" or actor == "":
        raise ValueError("reason and actor must not be empty")
    if until_utc is not None and (
        not isinstance(until_utc, datetime) or until_utc.utcoffset() is None
    ):
        raise ValueError("until_utc must be an aware datetime")
    identity = dict(
        dataset_id=dataset_id, provider_id=provider_id, revision=revision, window_key=window_key
    )
    details: dict[str, object] = {}
    if until_utc is not None:
        details["until_utc"] = (
            "infinity"
            if until_utc == HOLD_NO_END
            else until_utc.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
        )
    _lock(connection, identity)
    _set_hold(connection, identity, until_utc, reason)
    record_event(
        connection,
        dataset_id=dataset_id,
        provider_id=provider_id,
        revision=revision,
        window_key=window_key,
        kind="unhold" if until_utc is None else "hold",
        reason=reason,
        details=details,
        actor=actor,
    )


def window_state(
    connection: Connection,
    *,
    dataset_id: str,
    provider_id: str,
    window_key: str,
    revision: int = 0,
) -> WindowState | None:
    _window_start(datasets.get_dataset(dataset_id), window_key, revision)
    row = (
        connection.execute(
            text("""
        SELECT w.dataset_id, w.provider_id, w.revision, w.window_key, w.window_start,
               w.working_state, w.working_changed_at_utc, w.next_version, w.current_version,
               w.trimmed_at_utc, w.hold_reason,
               CASE WHEN w.hold_until_utc = 'infinity' THEN NULL
                    ELSE w.hold_until_utc END AS hold_until_utc,
               w.hold_until_utc = 'infinity' AS hold_has_no_end,
               CASE WHEN w.working_state IN ('partial', 'trimmed') THEN (
                   SELECT e.details->>'remainder_fingerprint' FROM core.history_event e
                   WHERE e.dataset_id = w.dataset_id AND e.provider_id = w.provider_id
                     AND e.revision = w.revision AND e.window_key = w.window_key
                     AND e.kind = 'trim'
                   ORDER BY e.event_id DESC LIMIT 1
               ) END AS remainder_fingerprint
        FROM core.history_window w
        WHERE w.dataset_id = :dataset_id AND w.provider_id = :provider_id
          AND w.revision = :revision AND w.window_key = :window_key
        """),
            dict(
                dataset_id=dataset_id,
                provider_id=provider_id,
                revision=revision,
                window_key=window_key,
            ),
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        return None
    values = dict(row)
    if values.pop("hold_has_no_end"):
        values["hold_until_utc"] = HOLD_NO_END
    return WindowState(**values)


def find_copies(
    connection: Connection,
    *,
    dataset_id: str,
    provider_id: str,
    start: date,
    end: date,
    revision: int = 0,
) -> list[ArchiveCopy]:
    dataset = datasets.get_dataset(dataset_id)
    if start > end:
        raise ValueError("start must not be after end")
    _check_revision(dataset, revision)
    columns = ", ".join(
        f"c.{field.name}"
        for field in fields(ArchiveCopy)
        if field.name not in {"window_start", "is_current"}
    )
    rows = connection.execute(
        text(f"""
        SELECT {columns}, w.window_start,
               COALESCE(w.current_version = c.content_version, false) AS is_current
        FROM core.history_archive_copy c
        JOIN core.history_window w USING (dataset_id, provider_id, revision, window_key)
        WHERE c.dataset_id = :dataset_id AND c.provider_id = :provider_id
          AND c.revision = :revision AND w.window_start BETWEEN :start AND :end
        ORDER BY w.window_start, c.window_key, c.content_version
        """),
        dict(
            dataset_id=dataset_id, provider_id=provider_id, revision=revision, start=start, end=end
        ),
    ).mappings()
    return [ArchiveCopy(**row) for row in rows]


def fold_sources(
    connection: Connection,
    *,
    dataset_id: str,
    provider_id: str,
    revision: int,
    window_keys: Sequence[str],
) -> dict[str, str | None]:
    dataset = datasets.get_dataset(dataset_id)
    _check_revision(dataset, revision)
    for key in window_keys:
        datasets.window_start(dataset, key)
    rows = connection.execute(
        text("""
        SELECT w.window_key, c.content_sha256
        FROM core.history_window w
        JOIN core.history_archive_copy c
          USING (dataset_id, provider_id, revision, window_key)
        WHERE w.dataset_id=:dataset_id AND w.provider_id=:provider_id
          AND w.revision=:revision AND w.window_key=ANY(:keys)
          AND c.content_version=w.current_version
          AND c.verified_at_utc IS NOT NULL AND c.rejected_at_utc IS NULL
          AND w.working_changed_at_utc <= c.verified_at_utc
    """),
        dict(
            dataset_id=dataset_id,
            provider_id=provider_id,
            revision=revision,
            keys=list(window_keys),
        ),
    ).all()
    digests: dict[str, str | None] = {key: digest for key, digest in rows}
    return {key: digests.get(key) for key in window_keys}


def _fold_period(dataset: datasets.HistoryDataset, fold: str, period_key: str) -> str:
    declaration = next((item for item in dataset.folds if item.name == fold), None)
    if declaration is None:
        raise ValueError(f"undeclared fold: {fold!r}")
    pattern = r"[0-9]{4}-[0-9]{2}" if declaration.period == "month" else r"[0-9]{4}"
    suffix = "-01" if declaration.period == "month" else "-01-01"
    try:
        if not re.fullmatch(pattern, period_key):
            raise ValueError
        date.fromisoformat(period_key + suffix)
    except ValueError:
        raise ValueError(f"invalid period_key: {period_key!r}") from None
    return period_key


def record_fold_published(
    connection: Connection,
    *,
    dataset_id: str,
    provider_id: str,
    revision: int,
    fold: str,
    period_key: str,
    object_key: str,
    sources: Mapping[str, str | None],
    actor: str | None = None,
) -> None:
    dataset = datasets.get_dataset(dataset_id)
    _check_revision(dataset, revision)
    period = _fold_period(dataset, fold, period_key)
    if not object_key:
        raise ValueError(f"empty object_key: {object_key!r}")
    if not sources:
        raise ValueError(f"empty sources: {sources!r}")
    for key, digest in sources.items():
        start = datasets.window_start(dataset, key)
        if start is None or not start.isoformat().startswith(period + "-"):
            raise ValueError(f"source key outside period: {key!r}")
        if digest is not None and re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            raise ValueError(f"invalid source digest: {digest!r}")
    record_event(
        connection,
        kind="fold_published",
        dataset_id=dataset_id,
        provider_id=provider_id,
        revision=revision,
        window_key=period_key,
        actor=actor,
        details={
            "fold": fold,
            "period_key": period_key,
            "object_key": object_key,
            "sources": dict(sources),
        },
    )


def record_processing_evidence(
    connection: Connection,
    *,
    dataset_id: str,
    provider_id: str,
    window_key: str,
    command: str,
    completed_at_utc: datetime,
    rows_by_capture: Mapping[int, int],
    actor: str | None = None,
) -> None:
    dataset = datasets.get_dataset(dataset_id)
    source = dataset.source
    if not isinstance(source, datasets.CaptureSource) or source.fact_table is None:
        raise ValueError(f"dataset has no capture fact table: {dataset_id!r}")
    _window_start(dataset, window_key, 0)
    if not command:
        raise ValueError(f"empty command: {command!r}")
    if completed_at_utc.utcoffset() is None:
        raise ValueError(f"completed_at_utc must be aware: {completed_at_utc!r}")
    for capture, rows in rows_by_capture.items():
        if type(capture) is not int or capture <= 0 or type(rows) is not int or rows < 0:
            raise ValueError(f"invalid capture outcome: {capture!r}: {rows!r}")
    lock_window(
        connection,
        dataset_id=dataset_id,
        provider_id=provider_id,
        window_key=window_key,
        actor=actor,
    )
    record_event(
        connection,
        kind="processing_evidence",
        dataset_id=dataset_id,
        provider_id=provider_id,
        revision=0,
        window_key=window_key,
        actor=actor,
        details={
            "command": command,
            "completed_at_utc": completed_at_utc.astimezone(UTC)
            .isoformat(timespec="microseconds")
            .replace("+00:00", "Z"),
            "index_family": source.index_family,
            "rows_by_capture": {str(capture): rows for capture, rows in rows_by_capture.items()},
        },
    )
