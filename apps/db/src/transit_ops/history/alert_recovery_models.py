"""Typed recovery evidence shared by independent read-only source adapters."""

from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Any, Literal

from transit_ops.gold.alert_archive import prepare_recovered_archive_record

SourceKind = Literal["backup", "published", "capture"]


@dataclass(frozen=True)
class Candidate:
    provider_id: str
    alert_id: str
    archive_month: date
    record: dict[str, Any]
    source_kind: SourceKind
    source_locator: str


@dataclass(frozen=True)
class SourceReport:
    kind: SourceKind
    scanned: int = 0
    candidates: int = 0
    missing: tuple[str, ...] = ()
    errors: tuple[str, ...] = ()
    coverage: tuple[str, ...] = ("not read",)
    complete: bool = False


@dataclass(frozen=True)
class RecoveryReport:
    provider_id: str
    dry_run: bool
    source_reports: tuple[SourceReport, ...]
    recovered_at_utc: datetime
    would_insert: tuple[str, ...] = ()
    inserted: tuple[str, ...] = ()
    already_present: tuple[str, ...] = ()
    conflicts: tuple[str, ...] = ()
    unrecovered_expected_ids: tuple[str, ...] | None = None
    complete: bool = False


def select_candidates(
    candidates: Iterable[Candidate],
    *,
    provider_id: str,
) -> tuple[list[Candidate], tuple[str, ...]]:
    """Newest observation wins; tied unequal evidence is never arbitrarily merged."""
    groups: dict[str, list[Candidate]] = {}
    for candidate in candidates:
        row = candidate.record
        if (
            candidate.provider_id != provider_id
            or candidate.alert_id != row.get("alert_id")
            or candidate.archive_month != row.get("archive_month")
        ):
            raise ValueError("candidate identity mismatch")
        normalized = prepare_recovered_archive_record(
            row, provider_id=provider_id, recovered_at_utc=row["updated_at_utc"]
        )
        groups.setdefault(candidate.alert_id, []).append(replace(candidate, record=normalized))
    selected, conflicts = [], []
    for identity, group in sorted(groups.items()):
        latest = max(c.record["last_seen_utc"] for c in group)
        tied = [c for c in group if c.record["last_seen_utc"] == latest]
        semantics = [
            {k: v for k, v in c.record.items() if k not in {"content_hash", "updated_at_utc"}}
            for c in tied
        ]
        if any(row != semantics[0] for row in semantics[1:]):
            conflicts.append(identity)
        else:
            tied.sort(
                key=lambda c: (
                    ("backup", "published", "capture").index(c.source_kind),
                    c.source_locator,
                )
            )
            selected.append(tied[0])
    return selected, tuple(conflicts)


def unrecovered_ids(
    expected_ids: Iterable[str] | None,
    found_ids: Iterable[str],
    reports: Iterable[SourceReport],
) -> tuple[str, ...] | None:
    if expected_ids is None or not all(report.complete for report in reports):
        return None
    return tuple(sorted(set(expected_ids) - set(found_ids)))
