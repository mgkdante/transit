"""Build the immutable, partitioned retained-alert collection."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from transit_ops.snapshots.builders._helpers import (
    _alert_active_periods,
    _iso,
    _iso_date,
    _route_sort_key,
    _severity_code,
)
from transit_ops.snapshots.contract import (
    ALERT_ARCHIVE_PAGE_BYTE_CEILING,
    ALERT_ARCHIVE_PAGE_ENTRY_CAP,
    AlertArchiveEntry,
    AlertArchiveIndex,
    AlertArchiveMonth,
    AlertArchivePage,
    AlertArchivePageRef,
)
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover
    from sqlalchemy.engine import Connection


_ALERT_ARCHIVE_SQL = named_query(
    "alerts.archive.publish",
    """
    SELECT
        archive.provider_id,
        archive.alert_id,
        archive.archive_month,
        archive.header_text,
        archive.header_text_en,
        archive.description_text,
        archive.description_text_en,
        archive.severity,
        archive.cause,
        archive.effect,
        archive.route_ids,
        archive.stop_ids,
        archive.start_utc,
        archive.end_utc,
        archive.active_periods,
        archive.url,
        archive.first_seen_utc,
        archive.last_seen_utc,
        archive.updated_at_utc,
        provider.timezone AS provider_timezone,
        MIN((archive.first_seen_utc AT TIME ZONE provider.timezone)::date) OVER ()
            AS first_available_date,
        MAX((archive.last_seen_utc AT TIME ZONE provider.timezone)::date) OVER ()
            AS last_available_date
    FROM gold.alert_archive_entry AS archive
    JOIN gold.dim_provider AS provider
      ON provider.provider_id = archive.provider_id
    WHERE archive.provider_id = :provider_id
    ORDER BY archive.archive_month DESC,
             COALESCE(archive.start_utc, archive.first_seen_utc) DESC,
             archive.last_seen_utc DESC,
             archive.alert_id
    """,
)


@dataclass(frozen=True)
class AlertArchiveBundle:
    page_items: list[tuple[str, AlertArchivePage]]
    index: AlertArchiveIndex
    # Internal verification context, not part of the public JSON contract.
    provider_timezone: str = "UTC"


def _natural_ids(values: object) -> list[str]:
    unique = {str(value) for value in (values or [])}  # type: ignore[union-attr]
    return sorted(unique, key=_route_sort_key)


def _duration_minutes(start: object, end: object) -> float | None:
    if start is None or end is None:
        return None
    try:
        start_dt = datetime.fromisoformat(_iso(start).replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(_iso(end).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    seconds = (end_dt - start_dt).total_seconds()
    return round(seconds / 60.0) if seconds >= 0 else None


def _canonical_utc(value: object) -> str:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return _iso(value)


def _optional_canonical_utc(value: object) -> str | None:
    return None if value is None else _canonical_utc(value)


def _month(value: object) -> str:
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m")  # type: ignore[union-attr]
    return str(value)[:7]


def _entry(row: dict) -> AlertArchiveEntry:  # type: ignore[type-arg]
    start = row.get("start_utc")
    end = row.get("end_utc")
    return AlertArchiveEntry(
        id=str(row["alert_id"]),
        severity=_severity_code(row.get("severity")),
        header_text=row.get("header_text"),
        header_text_en=row.get("header_text_en"),
        description=row.get("description_text"),
        description_en=row.get("description_text_en"),
        routes=_natural_ids(row.get("route_ids")),
        stops=_natural_ids(row.get("stop_ids")),
        start_utc=_optional_canonical_utc(start),
        end_utc=_optional_canonical_utc(end),
        duration_min=_duration_minutes(start, end),
        impact_passages=None,
        cause=row.get("cause"),
        effect=row.get("effect"),
        severity_level=row.get("severity"),
        url=row.get("url"),
        active_periods=_alert_active_periods(row.get("active_periods"), start, end),
        first_seen_utc=_canonical_utc(row["first_seen_utc"]),
        last_seen_utc=_canonical_utc(row["last_seen_utc"]),
    )


def _entry_newest_key(item: tuple[dict, AlertArchiveEntry]) -> tuple[str, str]:  # type: ignore[type-arg]
    row, entry = item
    return (
        _optional_canonical_utc(row.get("start_utc")) or entry.first_seen_utc,
        entry.last_seen_utc,
    )


def _provider_local_date(value: str, provider_timezone: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo("UTC"))
    return parsed.astimezone(ZoneInfo(provider_timezone)).date().isoformat()


def _page_coverage(page: AlertArchivePage, provider_timezone: str) -> tuple[str, str]:
    # Observation bounds are the honest minimum baseline. Active periods may
    # widen it (including long-running/future/open periods) but can never erase
    # the dates on which the alert was actually observed.
    bounds: list[str] = []
    for entry in page.alerts:
        bounds.extend([entry.first_seen_utc, entry.last_seen_utc])
        for period in entry.active_periods:
            if period.start_utc is not None:
                bounds.append(period.start_utc)
            if period.end_utc is not None:
                bounds.append(period.end_utc)
    dates = [_provider_local_date(value, provider_timezone) for value in bounds]
    return min(dates), max(dates)


def _page_stamp(rows: list[dict]) -> str:  # type: ignore[type-arg]
    return max(_canonical_utc(row["updated_at_utc"]) for row in rows)


def _finalize_page(
    *,
    month: str,
    page_number: int,
    rows: list[dict],
    entries: list[AlertArchiveEntry],
    provider_timezone: str,
) -> tuple[str, AlertArchivePage, AlertArchivePageRef]:  # type: ignore[type-arg]
    page = AlertArchivePage(
        generated_utc=_page_stamp(rows),
        methodology_version="alerts-1",
        month=month,
        page=page_number,
        alerts=entries,
    )
    body = page.model_dump_json().encode("utf-8")
    digest = hashlib.sha256(body).hexdigest()
    path = f"historic/alerts/generations/{digest}/{month}/page-{page_number:04d}.json"
    coverage_start, coverage_end = _page_coverage(page, provider_timezone)
    ref = AlertArchivePageRef(
        path=path,
        page=page_number,
        count=len(entries),
        byte_size=len(body),
        sha256=digest,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
    )
    return path, page, ref


def _collection_generation_id(
    months: list[AlertArchiveMonth],
    first_available_date: str | None,
    last_available_date: str | None,
) -> str:
    canonical = {
        "first_available_date": first_available_date,
        "last_available_date": last_available_date,
        "months": [month.model_dump(mode="json") for month in months],
    }
    body = json.dumps(canonical, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


def build_alert_archive(
    conn: Connection,
    provider_id: str,
    *,
    generated_utc: str,
) -> AlertArchiveBundle:
    """Build all retained alerts as immutable monthly pages plus a stable index."""
    rows = [
        dict(row)
        for row in conn.execute(
            _ALERT_ARCHIVE_SQL,
            {"provider_id": provider_id},
        ).mappings()
    ]

    if not rows:
        index = AlertArchiveIndex(
            generated_utc=generated_utc,
            collection_generation_id=_collection_generation_id([], None, None),
            first_available_date=None,
            last_available_date=None,
            total_alerts=0,
            months=[],
        )
        return AlertArchiveBundle(page_items=[], index=index)

    provider_timezone = str(rows[0].get("provider_timezone") or "UTC")
    first_available_date = _iso_date(rows[0]["first_available_date"])
    last_available_date = _iso_date(rows[0]["last_available_date"])
    grouped: dict[str, list[tuple[dict, AlertArchiveEntry]]] = {}
    for row in rows:
        grouped.setdefault(_month(row["archive_month"]), []).append((row, _entry(row)))

    page_items: list[tuple[str, AlertArchivePage]] = []
    month_models: list[AlertArchiveMonth] = []
    for month in sorted(grouped, reverse=True):
        items = sorted(grouped[month], key=lambda item: item[1].id)
        items.sort(key=_entry_newest_key, reverse=True)
        refs: list[AlertArchivePageRef] = []
        current_rows: list[dict] = []
        current_entries: list[AlertArchiveEntry] = []
        page_number = 1

        def finalize(
            current_month: str = month,
            month_refs: list[AlertArchivePageRef] = refs,
        ) -> None:
            nonlocal current_rows, current_entries, page_number
            path, page, ref = _finalize_page(
                month=current_month,
                page_number=page_number,
                rows=current_rows,
                entries=current_entries,
                provider_timezone=provider_timezone,
            )
            page_items.append((path, page))
            month_refs.append(ref)
            current_rows = []
            current_entries = []
            page_number += 1

        for row, entry in items:
            candidate_rows = [*current_rows, row]
            candidate_entries = [*current_entries, entry]
            too_many = len(candidate_entries) > ALERT_ARCHIVE_PAGE_ENTRY_CAP
            too_large = False
            if not too_many:
                candidate = AlertArchivePage(
                    generated_utc=_page_stamp(candidate_rows),
                    methodology_version="alerts-1",
                    month=month,
                    page=page_number,
                    alerts=candidate_entries,
                )
                too_large = (
                    len(candidate.model_dump_json().encode("utf-8"))
                    > ALERT_ARCHIVE_PAGE_BYTE_CEILING
                )
            if current_entries and (too_many or too_large):
                finalize()
                current_rows = [row]
                current_entries = [entry]
            else:
                current_rows = candidate_rows
                current_entries = candidate_entries
        if current_entries:
            finalize()
        month_models.append(AlertArchiveMonth(month=month, total_alerts=len(items), pages=refs))

    index = AlertArchiveIndex(
        generated_utc=generated_utc,
        collection_generation_id=_collection_generation_id(
            month_models,
            first_available_date,
            last_available_date,
        ),
        first_available_date=first_available_date,
        last_available_date=last_available_date,
        total_alerts=len(rows),
        months=month_models,
    )
    return AlertArchiveBundle(
        page_items=page_items,
        index=index,
        provider_timezone=provider_timezone,
    )


__all__ = ["AlertArchiveBundle", "_ALERT_ARCHIVE_SQL", "build_alert_archive"]
