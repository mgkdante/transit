"""Window coordination and audit writes in the caller's transaction."""

import json
from collections.abc import Mapping
from datetime import date
from typing import Literal, get_args

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


def _window_start(dataset: datasets.HistoryDataset, key: str, revision: int) -> date | None:
    start = datasets.window_start(dataset, key)
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
    return start


def _lock(connection: Connection, identity: Mapping[str, object]) -> None:
    key = ["transit.history_window"] + [
        identity[field] for field in ("dataset_id", "provider_id", "revision", "window_key")
    ]
    connection.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(CAST(:lock_key AS text), 0))"),
        {"lock_key": json.dumps(key, separators=(",", ":"))},
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
