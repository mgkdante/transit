"""Heal gold.dim_*_history from an archived GTFS zip (slice-9.1.1u).

Why this module exists:
    Migration 0029 seeds the name-history tables from the CURRENT dims and the
    marts writer maintains them on every dim refresh — but ids retired by a
    GTFS edition drop that happened BEFORE 0029 landed have no names anywhere
    in the database (the June-2026 drop orphaned 12 route_ids and 15 stop_ids
    still present in the 730d rollups). Their names survive only inside the
    archived GTFS zips in bronze R2 while those raw static archives are retained.

    ``transit-ops backfill-dim-history <provider> --from-gtfs-zip <path>``
    parses routes.txt/stops.txt out of such a zip and inserts CLOSED history
    rows for ids missing ENTIRELY from the history tables. Ids the seed or
    writer already track are never touched, so running it with the current
    zip is a no-op and reruns are idempotent. When healing from several old
    editions, run the NEWEST zip first — the first zip providing an id wins.

    valid_from_utc comes from feed_info.txt's feed_start_date when present
    (else the backfill time); valid_to_utc is the backfill time — the rows
    are closed because a missing-from-history id is by definition not part
    of the current edition. last_seen_dataset_version_id stays NULL: the
    source dataset row was pruned long ago.
"""

from __future__ import annotations

import csv
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from io import TextIOWrapper
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.settings import Settings, get_settings

# Drop-day runbook (test-asserted; specs live in Notion, never repo .md).
# Written after the June-2026 edition landed under supervision; the same
# checklist armors the ~Aug-24 edition, where 0029 + the marts writer make
# name continuity automatic and only the morning-after checks remain.
GTFS_DROP_RUNBOOK = """
GTFS drop runbook — STM edition flip (next expected ~Aug 24; zips post ~10d early)

HEAL (one-time, June-2026 drop predates migration 0029):
  cd apps/db && uv run python -m transit_ops.cli backfill-dim-history stm \\
      --from-gtfs-zip <archived-bronze-gtfs.zip>
  The zip comes from bronze R2. Newest old edition first — the first zip
  providing a missing id wins. Idempotent; current ids no-op.

MORNING AFTER a drop (first daily-static-pipeline run with static_changed=true):
  [a] daily-static-pipeline green; row_counts: dim_route/dim_stop near prior
      magnitudes, dim_route_history/dim_stop_history counts grew.
  [b] history deltas:
        SELECT count(*) FILTER (WHERE valid_to_utc IS NULL)     AS open,
               count(*) FILTER (WHERE valid_to_utc IS NOT NULL) AS closed
        FROM gold.dim_route_history WHERE provider_id='stm';  -- and dim_stop_history
      closed grows iff ids/names changed. Seed/writer parity: open == count of
      gold.dim_route (resp. gold.dim_stop) rows.
  [c] RT transition watch: NULL-rate of delay_seconds on
      gold.latest_trip_delay_snapshot may spike while STM realtime still emits
      old-edition trip_ids (delay derivation joins stop_times pinned to the
      current version; rows still land with NULL delay). Self-heals when STM
      flips its RT feed — log it, do NOT patch.
  [d] PROHIBITION: do NOT run build-gold-marts (full rebuild) until 14 days
      post-drop — it re-derives all retained facts against the new version
      only and silently NULLs pre-drop delay_seconds. The per-cycle
      refresh-gold-realtime is safe (latest-snapshot-scoped upserts).
  [e] curl https://data.yesid.dev/v1/stm/manifest.json (dataset_version
      flipped) and static/routes_index.json (new route set).
  [f] after the 07:00 UTC historic publish: a retired-id
      historic/route_reliability/<id>.json and stop_reliability/<id>.json
      serve a non-null name; repeat_offenders.json rows carry route_name.
  [g] worker cadence still ~57s; pg_locks advisory check clean after any
      worker redeploy.
  [h] accepted degradation (raw ids by design): alert_history route/stop id
      arrays, stale R2 static files for retired ids, deep links to retired
      entities.
"""


INSERT_MISSING_DIM_ROUTE_HISTORY = text(
    """
    INSERT INTO gold.dim_route_history (
        provider_id,
        route_id,
        route_short_name,
        route_long_name,
        route_color,
        route_type,
        valid_from_utc,
        valid_to_utc,
        last_seen_dataset_version_id
    )
    SELECT
        :provider_id,
        :route_id,
        :route_short_name,
        :route_long_name,
        :route_color,
        :route_type,
        :valid_from_utc,
        :valid_to_utc,
        NULL
    WHERE NOT EXISTS (
        SELECT 1
        FROM gold.dim_route_history AS h
        WHERE h.provider_id = :provider_id
          AND h.route_id = :route_id
    )
    """
)

INSERT_MISSING_DIM_STOP_HISTORY = text(
    """
    INSERT INTO gold.dim_stop_history (
        provider_id,
        stop_id,
        stop_name,
        stop_lat,
        stop_lon,
        valid_from_utc,
        valid_to_utc,
        last_seen_dataset_version_id
    )
    SELECT
        :provider_id,
        :stop_id,
        :stop_name,
        :stop_lat,
        :stop_lon,
        :valid_from_utc,
        :valid_to_utc,
        NULL
    WHERE NOT EXISTS (
        SELECT 1
        FROM gold.dim_stop_history AS h
        WHERE h.provider_id = :provider_id
          AND h.stop_id = :stop_id
    )
    """
)

_COUNT_RUN_ROWS = """
    SELECT count(*)
    FROM gold.{table}
    WHERE provider_id = :provider_id
      AND valid_to_utc = :valid_to_utc
"""


@dataclass(frozen=True)
class GtfsNameRows:
    route_rows: list[dict] = field(default_factory=list)
    stop_rows: list[dict] = field(default_factory=list)
    feed_start_date: date | None = None


@dataclass(frozen=True)
class DimHistoryBackfillResult:
    provider_id: str
    gtfs_zip_path: str
    row_counts: dict[str, int]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "gtfs_zip_path": self.gtfs_zip_path,
            "row_counts": dict(self.row_counts),
        }


def _opt(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _opt_int(value: str | None) -> int | None:
    value = (value or "").strip()
    try:
        return int(value) if value else None
    except ValueError:
        return None


def _opt_float(value: str | None) -> float | None:
    value = (value or "").strip()
    try:
        return float(value) if value else None
    except ValueError:
        return None


def _iter_member_rows(zip_file: zipfile.ZipFile, member_key: str):
    member_map = {Path(n).name.lower(): n for n in zip_file.namelist() if not n.endswith("/")}
    member_name = member_map.get(member_key)
    if member_name is None:
        raise ValueError(f"GTFS archive is missing required member: {member_key}")
    with zip_file.open(member_name, "r") as raw_handle, TextIOWrapper(
        raw_handle, encoding="utf-8-sig", newline=""
    ) as text_handle:
        yield from csv.DictReader(text_handle)


def _read_feed_start_date(zip_file: zipfile.ZipFile) -> date | None:
    try:
        rows = list(_iter_member_rows(zip_file, "feed_info.txt"))
    except ValueError:
        return None
    raw = _opt(rows[0].get("feed_start_date")) if rows else None
    if raw is None:
        return None
    try:
        return datetime.strptime(raw, "%Y%m%d").date()
    except ValueError:
        return None


def parse_gtfs_name_rows(gtfs_zip_path: Path) -> GtfsNameRows:
    """Extract the name-bearing columns of routes.txt/stops.txt.

    Rows missing their natural key (or a stop_name, NOT NULL in the table)
    are skipped; duplicate ids are deduped last-wins so one backfill run can
    never collide with itself on the (provider, id, valid_from) PK.
    """
    with zipfile.ZipFile(gtfs_zip_path) as zip_file:
        routes: dict[str, dict] = {}
        for row in _iter_member_rows(zip_file, "routes.txt"):
            route_id = _opt(row.get("route_id"))
            if route_id is None:
                continue
            routes[route_id] = {
                "route_id": route_id,
                "route_short_name": _opt(row.get("route_short_name")),
                "route_long_name": _opt(row.get("route_long_name")),
                "route_color": _opt(row.get("route_color")),
                "route_type": _opt_int(row.get("route_type")),
            }

        stops: dict[str, dict] = {}
        for row in _iter_member_rows(zip_file, "stops.txt"):
            stop_id = _opt(row.get("stop_id"))
            stop_name = _opt(row.get("stop_name"))
            if stop_id is None or stop_name is None:
                continue
            stops[stop_id] = {
                "stop_id": stop_id,
                "stop_name": stop_name,
                "stop_lat": _opt_float(row.get("stop_lat")),
                "stop_lon": _opt_float(row.get("stop_lon")),
            }

        feed_start_date = _read_feed_start_date(zip_file)

    return GtfsNameRows(
        route_rows=list(routes.values()),
        stop_rows=list(stops.values()),
        feed_start_date=feed_start_date,
    )


def _backfill_on_connection(
    connection: Connection,
    *,
    provider_id: str,
    parsed: GtfsNameRows,
    backfilled_at_utc: datetime | None = None,
) -> dict[str, int]:
    backfilled_at_utc = backfilled_at_utc or datetime.now(UTC)
    valid_from_utc = (
        datetime.combine(parsed.feed_start_date, datetime.min.time(), tzinfo=UTC)
        if parsed.feed_start_date is not None
        else backfilled_at_utc
    )
    window = {
        "provider_id": provider_id,
        "valid_from_utc": valid_from_utc,
        # closed rows: a missing-from-history id is not part of the current
        # edition; valid_to_utc doubles as this run's marker for the counts
        "valid_to_utc": backfilled_at_utc,
    }

    if parsed.route_rows:
        connection.execute(
            INSERT_MISSING_DIM_ROUTE_HISTORY,
            [{**window, **row} for row in parsed.route_rows],
        )
    if parsed.stop_rows:
        connection.execute(
            INSERT_MISSING_DIM_STOP_HISTORY,
            [{**window, **row} for row in parsed.stop_rows],
        )

    counts = {}
    for key, table in (
        ("dim_route_history_inserted", "dim_route_history"),
        ("dim_stop_history_inserted", "dim_stop_history"),
    ):
        counts[key] = int(
            connection.execute(
                text(_COUNT_RUN_ROWS.format(table=table)),
                {"provider_id": provider_id, "valid_to_utc": backfilled_at_utc},
            ).scalar_one()
        )

    return {
        "routes_in_zip": len(parsed.route_rows),
        "stops_in_zip": len(parsed.stop_rows),
        **counts,
    }


def backfill_dim_name_history(
    provider_id: str,
    *,
    gtfs_zip_path: Path,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> DimHistoryBackfillResult:
    """Insert name rows for ids missing entirely from gold.dim_*_history."""
    if not Path(gtfs_zip_path).is_file():
        raise FileNotFoundError(f"GTFS archive not found: {gtfs_zip_path}")

    parsed = parse_gtfs_name_rows(Path(gtfs_zip_path))

    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    with engine.begin() as connection:
        row_counts = _backfill_on_connection(connection, provider_id=provider_id, parsed=parsed)

    return DimHistoryBackfillResult(
        provider_id=provider_id,
        gtfs_zip_path=str(gtfs_zip_path),
        row_counts=row_counts,
    )
