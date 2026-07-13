"""Bounded sync from retained Silver alerts into the long-lived Gold archive."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.settings import Settings, get_settings
from transit_ops.sql_registry import named_query

_ALERT_ARCHIVE_LOCK_SQL = named_query(
    "alerts.archive.lock",
    """
    SELECT pg_advisory_xact_lock(
        hashtext('transit.alert_archive'),
        hashtext(:provider_id)
    )
    """,
)

_ALERT_ARCHIVE_SOURCE_SQL = named_query(
    "alerts.archive.source",
    """
    WITH base AS (
        SELECT
            a.i3_alert_snapshot_id,
            a.alert_index,
            a.provider_id,
            NULLIF(BTRIM(a.alert_id), '') AS upstream_alert_id,
            COALESCE(
                'upstream:' || NULLIF(BTRIM(a.alert_id), ''),
                'synthetic:' || SUBSTRING(
                    MD5(
                        COALESCE(a.alert_header_text, '') || '|' ||
                        COALESCE(EXTRACT(EPOCH FROM a.active_period_start_utc)::text, '') || '|' ||
                        COALESCE(EXTRACT(EPOCH FROM a.active_period_end_utc)::text, '')
                    ) FROM 1 FOR 12
                )
            ) AS stable_alert_id,
            a.alert_header_text,
            a.alert_header_text_en,
            a.description_text,
            a.description_text_en,
            a.severity,
            a.cause,
            a.effect,
            a.active_period_start_utc,
            a.active_period_end_utc,
            a.url,
            a.url_en,
            COALESCE(a.first_seen_at, a.captured_at_utc) AS first_seen_utc,
            COALESCE(a.last_seen_at, a.captured_at_utc) AS last_seen_utc,
            a.captured_at_utc,
            dp.timezone,
            (a.captured_at_utc AT TIME ZONE dp.timezone)::date AS provider_local_date
        FROM silver.i3_alerts AS a
        INNER JOIN gold.dim_provider AS dp
            ON dp.provider_id = a.provider_id
        WHERE a.provider_id = :provider_id
          AND (a.captured_at_utc AT TIME ZONE dp.timezone)::date >= :from_date
          AND (a.captured_at_utc AT TIME ZONE dp.timezone)::date <= :to_date
    ), ranked AS (
        SELECT
            base.*,
            ROW_NUMBER() OVER (
                PARTITION BY stable_alert_id
                ORDER BY last_seen_utc DESC,
                         captured_at_utc DESC,
                         i3_alert_snapshot_id DESC,
                         alert_index DESC
            ) AS version_rank
        FROM base
    ), latest AS (
        SELECT * FROM ranked WHERE version_rank = 1
    ), latest_values AS (
        SELECT
            stable_alert_id,
            (ARRAY_AGG(alert_header_text ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE alert_header_text IS NOT NULL))[1] AS header_text,
            (ARRAY_AGG(alert_header_text_en ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE alert_header_text_en IS NOT NULL))[1] AS header_text_en,
            (ARRAY_AGG(description_text ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE description_text IS NOT NULL))[1] AS description_text,
            (ARRAY_AGG(description_text_en ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE description_text_en IS NOT NULL))[1] AS description_text_en,
            (ARRAY_AGG(severity ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE severity IS NOT NULL))[1] AS severity,
            (ARRAY_AGG(cause ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE cause IS NOT NULL))[1] AS cause,
            (ARRAY_AGG(effect ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE effect IS NOT NULL))[1] AS effect,
            (ARRAY_AGG(active_period_start_utc ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE active_period_start_utc IS NOT NULL))[1] AS start_utc,
            (ARRAY_AGG(active_period_end_utc ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE active_period_end_utc IS NOT NULL))[1] AS end_utc,
            (ARRAY_AGG(COALESCE(url, url_en) ORDER BY last_seen_utc DESC, captured_at_utc DESC,
                i3_alert_snapshot_id DESC, alert_index DESC)
                FILTER (WHERE COALESCE(url, url_en) IS NOT NULL))[1] AS url
        FROM base
        GROUP BY stable_alert_id
    ), seen AS (
        SELECT
            stable_alert_id,
            MIN(first_seen_utc) AS first_seen_utc,
            MAX(last_seen_utc) AS last_seen_utc
        FROM base
        GROUP BY stable_alert_id
    ), entities AS (
        SELECT
            b.stable_alert_id,
            ARRAY_AGG(DISTINCT e.route_id ORDER BY e.route_id)
                FILTER (WHERE e.route_id IS NOT NULL) AS route_ids,
            ARRAY_AGG(DISTINCT e.stop_id ORDER BY e.stop_id)
                FILTER (WHERE e.stop_id IS NOT NULL) AS stop_ids
        FROM base AS b
        LEFT JOIN silver.i3_alert_informed_entities AS e
            ON e.i3_alert_snapshot_id = b.i3_alert_snapshot_id
           AND e.alert_index = b.alert_index
        GROUP BY b.stable_alert_id
    ), period_values AS (
        SELECT DISTINCT
            b.stable_alert_id,
            p.start_utc,
            p.end_utc
        FROM base AS b
        INNER JOIN silver.i3_alert_active_periods AS p
            ON p.i3_alert_snapshot_id = b.i3_alert_snapshot_id
           AND p.alert_index = b.alert_index
        UNION
        SELECT DISTINCT
            b.stable_alert_id,
            b.active_period_start_utc,
            b.active_period_end_utc
        FROM base AS b
        WHERE (b.active_period_start_utc IS NOT NULL OR b.active_period_end_utc IS NOT NULL)
          AND NOT EXISTS (
              SELECT 1
              FROM silver.i3_alert_active_periods AS p
              WHERE p.i3_alert_snapshot_id = b.i3_alert_snapshot_id
                AND p.alert_index = b.alert_index
          )
    ), periods AS (
        SELECT
            stable_alert_id,
            JSONB_AGG(
                JSONB_BUILD_OBJECT('start_utc', start_utc, 'end_utc', end_utc)
                ORDER BY start_utc NULLS FIRST, end_utc NULLS FIRST
            ) AS active_periods
        FROM period_values
        GROUP BY stable_alert_id
    ), bounds AS (
        SELECT
            MIN(provider_local_date) AS source_from,
            MAX(provider_local_date) AS source_to
        FROM base
    )
    SELECT
        l.upstream_alert_id AS alert_id,
        DATE_TRUNC(
            'month',
            COALESCE(v.start_utc, s.first_seen_utc)
                AT TIME ZONE l.timezone
        )::date AS archive_month,
        v.header_text,
        v.header_text_en,
        v.description_text,
        v.description_text_en,
        v.severity,
        v.cause,
        v.effect,
        COALESCE(e.route_ids, ARRAY[]::text[]) AS route_ids,
        COALESCE(e.stop_ids, ARRAY[]::text[]) AS stop_ids,
        v.start_utc,
        v.end_utc,
        COALESCE(p.active_periods, '[]'::jsonb) AS active_periods,
        v.url,
        s.first_seen_utc,
        s.last_seen_utc,
        bounds.source_from,
        bounds.source_to
    FROM latest AS l
    INNER JOIN latest_values AS v USING (stable_alert_id)
    INNER JOIN seen AS s USING (stable_alert_id)
    INNER JOIN entities AS e USING (stable_alert_id)
    LEFT JOIN periods AS p USING (stable_alert_id)
    CROSS JOIN bounds
    ORDER BY archive_month, alert_id
    """,
)

_ALERT_ARCHIVE_EXISTING_SQL = named_query(
    "alerts.archive.existing",
    """
    SELECT
        provider_id,
        alert_id,
        archive_month,
        header_text,
        header_text_en,
        description_text,
        description_text_en,
        severity,
        cause,
        effect,
        route_ids,
        stop_ids,
        start_utc,
        end_utc,
        active_periods,
        url,
        first_seen_utc,
        last_seen_utc,
        content_hash,
        updated_at_utc
    FROM gold.alert_archive_entry
    WHERE provider_id = :provider_id
      AND alert_id = ANY(:alert_ids)
    """,
)

_ALERT_ARCHIVE_UPSERT_SQL = named_query(
    "alerts.archive.upsert",
    """
    INSERT INTO gold.alert_archive_entry (
        provider_id,
        alert_id,
        archive_month,
        header_text,
        header_text_en,
        description_text,
        description_text_en,
        severity,
        cause,
        effect,
        route_ids,
        stop_ids,
        start_utc,
        end_utc,
        active_periods,
        url,
        first_seen_utc,
        last_seen_utc,
        content_hash,
        updated_at_utc
    ) VALUES (
        :provider_id,
        :alert_id,
        :archive_month,
        :header_text,
        :header_text_en,
        :description_text,
        :description_text_en,
        :severity,
        :cause,
        :effect,
        :route_ids,
        :stop_ids,
        :start_utc,
        :end_utc,
        CAST(:active_periods AS jsonb),
        :url,
        :first_seen_utc,
        :last_seen_utc,
        :content_hash,
        :updated_at_utc
    )
    ON CONFLICT (provider_id, alert_id) DO UPDATE SET
        header_text = EXCLUDED.header_text,
        header_text_en = EXCLUDED.header_text_en,
        description_text = EXCLUDED.description_text,
        description_text_en = EXCLUDED.description_text_en,
        severity = EXCLUDED.severity,
        cause = EXCLUDED.cause,
        effect = EXCLUDED.effect,
        route_ids = EXCLUDED.route_ids,
        stop_ids = EXCLUDED.stop_ids,
        start_utc = EXCLUDED.start_utc,
        end_utc = EXCLUDED.end_utc,
        active_periods = EXCLUDED.active_periods,
        url = EXCLUDED.url,
        last_seen_utc = EXCLUDED.last_seen_utc,
        content_hash = EXCLUDED.content_hash,
        updated_at_utc = EXCLUDED.updated_at_utc
    """,
)

_SCALAR_FIELDS = (
    "header_text",
    "header_text_en",
    "description_text",
    "description_text_en",
    "severity",
    "cause",
    "effect",
    "start_utc",
    "end_utc",
    "url",
)


@dataclass(frozen=True)
class AlertArchiveSyncResult:
    provider_id: str
    requested_from: date
    requested_to: date
    source_from: date | None
    source_to: date | None
    source_count: int
    inserted_count: int
    updated_count: int
    unchanged_count: int
    dry_run: bool
    synced_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        for key in ("requested_from", "requested_to", "source_from", "source_to"):
            value = payload[key]
            payload[key] = value.isoformat() if value is not None else None
        payload["synced_at_utc"] = self.synced_at_utc.isoformat()
        return payload


@dataclass(frozen=True)
class AlertArchiveBackfillResult:
    provider_id: str
    requested_from: date
    requested_to: date
    month_batch: int
    dry_run: bool
    batches: tuple[AlertArchiveSyncResult, ...]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "requested_from": self.requested_from.isoformat(),
            "requested_to": self.requested_to.isoformat(),
            "month_batch": self.month_batch,
            "dry_run": self.dry_run,
            "batches": [batch.display_dict() for batch in self.batches],
        }


def alert_archive_default_bounds(
    *,
    provider_timezone: str,
    retention_days: int,
    now_utc: datetime | None = None,
) -> tuple[date, date]:
    """Return the retained provider-local sync window, month-floored."""

    now = _utc(now_utc) or datetime.now(UTC)
    provider_today = now.astimezone(ZoneInfo(provider_timezone)).date()
    retained_anchor = provider_today - timedelta(days=retention_days)
    return retained_anchor.replace(day=1), provider_today


def _add_months(month_start: date, count: int) -> date:
    month_index = month_start.year * 12 + (month_start.month - 1) + count
    year, zero_based_month = divmod(month_index, 12)
    return date(year, zero_based_month + 1, 1)


def alert_archive_month_batches(
    from_date: date,
    to_date: date,
    *,
    month_batch: int = 1,
) -> list[tuple[date, date]]:
    """Split an inclusive range into oldest-first calendar-month batches."""

    if from_date > to_date:
        raise ValueError("from_date must be on or before to_date")
    if month_batch <= 0:
        raise ValueError("month_batch must be positive")

    batches: list[tuple[date, date]] = []
    cursor = from_date
    while cursor <= to_date:
        first_month = cursor.replace(day=1)
        next_batch_month = _add_months(first_month, month_batch)
        batch_to = min(to_date, next_batch_month - timedelta(days=1))
        batches.append((cursor, batch_to))
        cursor = batch_to + timedelta(days=1)
    return batches


def _utc(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return _utc(parsed)
    raise TypeError(f"expected timestamp, got {type(value).__name__}")


def _iso(value: object) -> str | None:
    parsed = _utc(value)
    return parsed.isoformat().replace("+00:00", "Z") if parsed is not None else None


def _stable_alert_id(
    provider_id: str,
    upstream_id: object,
    header_text: object,
    start_utc: object,
    end_utc: object,
) -> str:
    source_id = str(upstream_id).strip() if upstream_id is not None else ""
    if source_id:
        return source_id
    normalized_start = _utc(start_utc)
    normalized_end = _utc(end_utc)
    basis = "|".join(str(value or "") for value in (header_text, normalized_start, normalized_end))
    digest = hashlib.sha1(basis.encode("utf-8"), usedforsecurity=False).hexdigest()[:12]
    return f"{provider_id}-alert-{digest}"


def _natural_key(value: str) -> tuple[object, ...]:
    return tuple(
        int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)
    )


def _ids(values: object) -> list[str]:
    if not isinstance(values, list | tuple | set):
        return []
    return sorted({str(value) for value in values if value is not None}, key=_natural_key)


def _periods(values: object) -> list[dict[str, str | None]]:
    if isinstance(values, str):
        try:
            values = json.loads(values)
        except json.JSONDecodeError:
            return []
    if not isinstance(values, list):
        return []
    unique: dict[tuple[str | None, str | None], dict[str, str | None]] = {}
    for value in values:
        if not isinstance(value, Mapping):
            continue
        start = _iso(value.get("start_utc"))
        end = _iso(value.get("end_utc"))
        if start is None and end is None:
            continue
        unique[(start, end)] = {"start_utc": start, "end_utc": end}
    return [unique[key] for key in sorted(unique, key=lambda item: (item[0] or "", item[1] or ""))]


def _date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    raise TypeError(f"expected date, got {type(value).__name__}")


def _record_from_source(
    row: Mapping[str, Any], *, provider_id: str, synced_at_utc: datetime
) -> dict[str, Any]:
    first_seen = _utc(row.get("first_seen_utc"))
    last_seen = _utc(row.get("last_seen_utc"))
    if first_seen is None or last_seen is None:
        raise ValueError("alert archive source rows require real first/last seen timestamps")
    alert_id = _stable_alert_id(
        provider_id,
        row.get("alert_id"),
        row.get("header_text"),
        row.get("start_utc"),
        row.get("end_utc"),
    )
    archive_month = _date(row.get("archive_month"))
    if archive_month is None:
        raise ValueError("alert archive source rows require archive_month")
    periods = _periods(row.get("active_periods"))
    if not periods and (row.get("start_utc") is not None or row.get("end_utc") is not None):
        periods = [{"start_utc": _iso(row.get("start_utc")), "end_utc": _iso(row.get("end_utc"))}]
    record: dict[str, Any] = {
        "provider_id": provider_id,
        "alert_id": alert_id,
        "archive_month": archive_month,
        **{field: row.get(field) for field in _SCALAR_FIELDS},
        "start_utc": _utc(row.get("start_utc")),
        "end_utc": _utc(row.get("end_utc")),
        "route_ids": _ids(row.get("route_ids")),
        "stop_ids": _ids(row.get("stop_ids")),
        "active_periods": periods,
        "first_seen_utc": first_seen,
        "last_seen_utc": last_seen,
        "updated_at_utc": synced_at_utc,
    }
    record["content_hash"] = _content_hash(record)
    return record


def _merge_record(
    source: dict[str, Any], existing: Mapping[str, Any], *, synced_at_utc: datetime
) -> dict[str, Any]:
    merged = dict(source)
    merged["archive_month"] = _date(existing.get("archive_month"))
    merged["first_seen_utc"] = _utc(existing.get("first_seen_utc"))
    existing_last_seen = _utc(existing.get("last_seen_utc"))
    source_is_newer = existing_last_seen is None or source["last_seen_utc"] > existing_last_seen
    merged["last_seen_utc"] = max(
        value for value in (existing_last_seen, source["last_seen_utc"]) if value is not None
    )
    for field in _SCALAR_FIELDS:
        if source_is_newer:
            if source.get(field) is None:
                merged[field] = existing.get(field)
        elif existing.get(field) is not None:
            merged[field] = existing.get(field)
    merged["start_utc"] = _utc(merged.get("start_utc"))
    merged["end_utc"] = _utc(merged.get("end_utc"))
    merged["route_ids"] = _ids([*_ids(existing.get("route_ids")), *source["route_ids"]])
    merged["stop_ids"] = _ids([*_ids(existing.get("stop_ids")), *source["stop_ids"]])
    merged["active_periods"] = _periods(
        [*_periods(existing.get("active_periods")), *source["active_periods"]]
    )
    merged["updated_at_utc"] = synced_at_utc
    merged["content_hash"] = _content_hash(merged)
    return merged


def _content_hash(record: Mapping[str, Any]) -> str:
    payload = {
        key: value for key, value in record.items() if key not in {"content_hash", "updated_at_utc"}
    }

    def json_value(value: object):  # noqa: ANN202
        if isinstance(value, datetime):
            return _iso(value)
        if isinstance(value, date):
            return value.isoformat()
        return value

    encoded = json.dumps(
        {key: json_value(value) for key, value in payload.items()},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _write_params(record: Mapping[str, Any]) -> dict[str, Any]:
    params = dict(record)
    params["active_periods"] = json.dumps(
        params["active_periods"], ensure_ascii=False, separators=(",", ":")
    )
    return params


def sync_alert_archive_on_connection(
    connection: Connection,
    *,
    provider_id: str,
    from_date: date,
    to_date: date,
    dry_run: bool = False,
    synced_at_utc: datetime | None = None,
) -> AlertArchiveSyncResult:
    if from_date > to_date:
        raise ValueError("from_date must be on or before to_date")
    synced_at = _utc(synced_at_utc) or datetime.now(UTC)
    connection.execute(_ALERT_ARCHIVE_LOCK_SQL, {"provider_id": provider_id})
    rows = list(
        connection.execute(
            _ALERT_ARCHIVE_SOURCE_SQL,
            {"provider_id": provider_id, "from_date": from_date, "to_date": to_date},
        ).mappings()
    )
    if not rows:
        return AlertArchiveSyncResult(
            provider_id=provider_id,
            requested_from=from_date,
            requested_to=to_date,
            source_from=None,
            source_to=None,
            source_count=0,
            inserted_count=0,
            updated_count=0,
            unchanged_count=0,
            dry_run=dry_run,
            synced_at_utc=synced_at,
        )

    source_records = [
        _record_from_source(row, provider_id=provider_id, synced_at_utc=synced_at) for row in rows
    ]
    alert_ids = [record["alert_id"] for record in source_records]
    existing_rows = list(
        connection.execute(
            _ALERT_ARCHIVE_EXISTING_SQL,
            {"provider_id": provider_id, "alert_ids": alert_ids},
        ).mappings()
    )
    existing_by_id = {str(row["alert_id"]): row for row in existing_rows}

    inserted = 0
    updated = 0
    unchanged = 0
    writes: list[dict[str, Any]] = []
    for source in source_records:
        existing = existing_by_id.get(source["alert_id"])
        if existing is None:
            inserted += 1
            writes.append(source)
            continue
        merged = _merge_record(source, existing, synced_at_utc=synced_at)
        if merged["content_hash"] == existing.get("content_hash"):
            unchanged += 1
        else:
            updated += 1
            writes.append(merged)

    if writes and not dry_run:
        connection.execute(_ALERT_ARCHIVE_UPSERT_SQL, [_write_params(record) for record in writes])

    bounds_from = [_date(row.get("source_from")) for row in rows]
    bounds_to = [_date(row.get("source_to")) for row in rows]
    return AlertArchiveSyncResult(
        provider_id=provider_id,
        requested_from=from_date,
        requested_to=to_date,
        source_from=min(value for value in bounds_from if value is not None),
        source_to=max(value for value in bounds_to if value is not None),
        source_count=len(source_records),
        inserted_count=inserted,
        updated_count=updated,
        unchanged_count=unchanged,
        dry_run=dry_run,
        synced_at_utc=synced_at,
    )


def sync_alert_archive(
    provider_id: str,
    *,
    from_date: date,
    to_date: date,
    dry_run: bool = False,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> AlertArchiveSyncResult:
    if from_date > to_date:
        raise ValueError("from_date must be on or before to_date")
    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    with engine.begin() as connection:
        return sync_alert_archive_on_connection(
            connection,
            provider_id=provider_id,
            from_date=from_date,
            to_date=to_date,
            dry_run=dry_run,
        )


def backfill_alert_archive(
    provider_id: str,
    *,
    from_date: date,
    to_date: date,
    month_batch: int = 1,
    dry_run: bool = False,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> AlertArchiveBackfillResult:
    batches = alert_archive_month_batches(
        from_date,
        to_date,
        month_batch=month_batch,
    )
    settings = settings or get_settings()
    engine = engine or make_engine(settings)

    receipts: list[AlertArchiveSyncResult] = []
    for batch_from, batch_to in batches:
        with engine.begin() as connection:
            receipts.append(
                sync_alert_archive_on_connection(
                    connection,
                    provider_id=provider_id,
                    from_date=batch_from,
                    to_date=batch_to,
                    dry_run=dry_run,
                )
            )

    return AlertArchiveBackfillResult(
        provider_id=provider_id,
        requested_from=from_date,
        requested_to=to_date,
        month_batch=month_batch,
        dry_run=dry_run,
        batches=tuple(receipts),
    )
