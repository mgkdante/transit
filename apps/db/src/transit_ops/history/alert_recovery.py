"""Plan evidence and insert absent Gold entries within the caller's transaction."""

from collections.abc import Iterable
from dataclasses import replace
from datetime import datetime
from typing import Protocol

from sqlalchemy import Connection, text

from transit_ops.gold.alert_archive import (
    _ALERT_ARCHIVE_LOCK_SQL,
    _write_params,
    prepare_recovered_archive_record,
)
from transit_ops.history.alert_recovery_models import (
    Candidate,
    RecoveryReport,
    SourceKind,
    SourceReport,
    select_candidates,
    unrecovered_ids,
)


class RecoverySourceReader(Protocol):
    def __call__(
        self, connection: Connection, *, provider_id: str, recovered_at_utc: datetime
    ) -> tuple[tuple[Candidate, ...], SourceReport]: ...


_INSERT = text("""
    INSERT INTO gold.alert_archive_entry (
        provider_id, alert_id, archive_month, header_text, header_text_en,
        description_text, description_text_en, severity, cause, effect, route_ids, stop_ids,
        start_utc, end_utc, active_periods, url, url_en, message,
        first_seen_utc, last_seen_utc, content_hash, updated_at_utc
    ) VALUES (
        :provider_id, :alert_id, :archive_month, :header_text, :header_text_en,
        :description_text, :description_text_en, :severity, :cause, :effect, :route_ids, :stop_ids,
        :start_utc, :end_utc, CAST(:active_periods AS jsonb), :url, :url_en,
        CAST(:message AS jsonb), :first_seen_utc, :last_seen_utc, :content_hash, :updated_at_utc
    ) ON CONFLICT (provider_id, alert_id) DO NOTHING RETURNING alert_id
""")
_CURRENT = text("SELECT alert_id FROM gold.alert_archive_entry WHERE provider_id = :provider_id")
_KINDS: tuple[SourceKind, ...] = ("backup", "published", "capture")


def _require_transaction(connection: Connection, dry_run: bool) -> None:
    if (
        connection.dialect.name != "postgresql"
        or not connection.in_transaction()
        or getattr(connection.connection.dbapi_connection, "autocommit", True)
        or connection.get_isolation_level() != "READ COMMITTED"
    ):
        raise ValueError("recovery requires non-autocommit PostgreSQL READ COMMITTED transaction")
    read_only = connection.execute(text("SHOW transaction_read_only")).scalar_one() == "on"
    if read_only != dry_run:
        raise ValueError("recovery transaction read-only mode mismatch")


def recover_alert_archive_entries(
    connection: Connection,
    *,
    provider_id: str,
    candidates: Iterable[Candidate],
    source_reports: Iterable[SourceReport],
    expected_ids: Iterable[str] | None = None,
    dry_run: bool = True,
    recovered_at_utc: datetime,
) -> RecoveryReport:
    """Validate the entire proposal before writing; never own commit or rollback."""
    if not provider_id or provider_id != provider_id.strip():
        raise ValueError("provider identity required")
    if recovered_at_utc.utcoffset() is None:
        raise ValueError("aware recovery timestamp required")
    reports = tuple(source_reports)
    kinds = [r.kind for r in reports]
    if len(kinds) != len(set(kinds)) or any(k not in _KINDS for k in kinds):
        raise ValueError("duplicate or unknown source report kind")
    candidates = tuple(candidates)
    if any(c.source_kind not in kinds for c in candidates):
        raise ValueError("candidate source report mismatch")
    selected, conflicts = select_candidates(candidates, provider_id=provider_id)
    reports = tuple(next((r for r in reports if r.kind == k), SourceReport(k)) for k in _KINDS)
    _require_transaction(connection, dry_run)
    return _compare_and_insert(
        connection,
        RecoveryReport(provider_id, dry_run, reports, recovered_at_utc),
        selected,
        conflicts,
        {c.alert_id for c in candidates},
        None if expected_ids is None else tuple(expected_ids),
    )


def _compare_and_insert(
    connection: Connection,
    report: RecoveryReport,
    selected: list[Candidate],
    conflicts: tuple[str, ...],
    found: set[str],
    expected_ids: tuple[str, ...] | None,
) -> RecoveryReport:
    provider_id, dry_run = report.provider_id, report.dry_run
    reports = report.source_reports
    sources_complete = all(r.complete for r in reports)
    if not dry_run and sources_complete:
        connection.execute(_ALERT_ARCHIVE_LOCK_SQL, {"provider_id": provider_id})
    present = set(connection.execute(_CURRENT, {"provider_id": provider_id}).scalars())
    relevant = found | set(expected_ids or ())
    found = found | present
    conflicts = tuple(k for k in conflicts if k not in present)
    proposed = [c for c in selected if c.alert_id not in present]
    inserted = []
    if not dry_run and sources_complete and not conflicts:
        for candidate in proposed:
            record = prepare_recovered_archive_record(
                candidate.record, provider_id=provider_id, recovered_at_utc=report.recovered_at_utc
            )
            identity = connection.execute(_INSERT, _write_params(record)).scalar_one_or_none()
            if identity is None:
                present.add(candidate.alert_id)
            else:
                inserted.append(identity)
    return replace(
        report,
        would_insert=tuple(c.alert_id for c in proposed),
        inserted=tuple(sorted(inserted)),
        already_present=tuple(sorted(present & relevant)),
        conflicts=conflicts,
        unrecovered_expected_ids=unrecovered_ids(expected_ids, found, reports),
        complete=sources_complete and not conflicts,
    )
