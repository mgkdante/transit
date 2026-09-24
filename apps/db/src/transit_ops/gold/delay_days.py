"""Dirty state for retained capture-day delay metrics; independent of live serving."""

from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Literal

from sqlalchemy import Connection, bindparam

from transit_ops.sql_registry import named_query

DAILY_DELAY_TABLES = {
    "route_percentile_daily": "route_delay_percentile_daily",
    "stop_percentile_daily": "stop_delay_percentile_daily",
    "route_delay_by_crowding_daily": "route_delay_by_crowding_daily",
    "route_delay_spine": "route_delay_spine",
    "stop_delay_spine": "stop_delay_spine",
    "stop_delay_shift_daily": "stop_delay_shift_daily",
    "repeat_offender_daily_spine": "repeat_offender_daily_spine",
}

# Internal MVCC coordination, not a metric or capture ledger. Retain this one
# row/day with surviving daily history across source resets; age by its day key,
# not built_at_utc (the last lock acquisition). Metric status excludes this kind.
DAY_COORDINATION_KIND = "delay_day_coordination"
DAILY_DELAY_STATE_KINDS = (*DAILY_DELAY_TABLES, DAY_COORDINATION_KIND)

_DAY_LOCK = named_query(
    "rollup.delay_day.lock",
    "SELECT pg_advisory_xact_lock(hashtextextended(CAST(:lock_key AS text), 0))",
)
_DAY_COORDINATION = named_query(
    "rollup.delay_day.coordinate",
    """
    INSERT INTO gold.warm_rollup_periods
        (provider_id, rollup_kind, period_start_utc, built_at_utc)
    VALUES (:provider_id, 'delay_day_coordination', :period_start_utc, clock_timestamp())
    ON CONFLICT (provider_id, rollup_kind, period_start_utc) DO UPDATE
        SET built_at_utc = EXCLUDED.built_at_utc
    """,
)
_SELECT_CAPTURE_DATES = named_query(
    "rollup.delay_day.capture_dates",
    """
    SELECT DISTINCT timezone(p.timezone, c.captured_at_utc)::date AS local_date
    FROM (
        SELECT captured_at_utc FROM raw.realtime_snapshot_index
        WHERE provider_id = :provider_id
          AND realtime_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
        UNION
        SELECT captured_at_utc FROM gold.fact_trip_delay_snapshot
        WHERE provider_id = :provider_id
          AND realtime_snapshot_id = ANY(CAST(:snapshot_ids AS bigint[]))
    ) AS c JOIN gold.dim_provider AS p ON p.provider_id = :provider_id
    ORDER BY local_date
    """,
)
_INVALIDATE_DAY = named_query(
    "rollup.delay_day.invalidate",
    """
    INSERT INTO gold.warm_rollup_periods
        (provider_id, rollup_kind, period_start_utc, built_at_utc, invalidated_at_utc)
    SELECT :provider_id, pending.rollup_kind, :period_start_utc,
           clock_timestamp(), clock_timestamp()
    FROM (
    """
    + "\nUNION ALL\n".join(
        f"""
        SELECT '{kind}' AS rollup_kind
        WHERE EXISTS (
            SELECT 1 FROM gold.warm_rollup_periods
            WHERE provider_id = :provider_id AND rollup_kind = '{kind}'
              AND period_start_utc = :period_start_utc
        ) OR EXISTS (
            SELECT 1 FROM gold.{table}
            WHERE provider_id = :provider_id AND provider_local_date = :local_date
        )
        """
        for kind, table in DAILY_DELAY_TABLES.items()
    )
    + """
    ) AS pending
    ON CONFLICT (provider_id, rollup_kind, period_start_utc) DO UPDATE
        SET invalidated_at_utc = EXCLUDED.invalidated_at_utc
    """,
)
_DAY_STATE = named_query(
    "rollup.delay_day.state",
    """
    SELECT invalidated_at_utc FROM gold.warm_rollup_periods
    WHERE provider_id = :provider_id AND rollup_kind = :rollup_kind
      AND period_start_utc = :period_start_utc
    """,
)
_STATUS = named_query(
    "rollup.delay_day.status",
    """
    SELECT (period_start_utc AT TIME ZONE 'UTC')::date AS local_date,
           array_agg(rollup_kind ORDER BY rollup_kind) AS kinds
    FROM gold.warm_rollup_periods
    WHERE provider_id = :provider_id AND rollup_kind IN :kinds
      AND invalidated_at_utc IS NOT NULL
      AND (CAST(:from_date AS date) IS NULL OR period_start_utc >=
           timezone('UTC', CAST(:from_date AS date)::timestamp))
      AND (CAST(:to_date AS date) IS NULL OR period_start_utc <
           timezone('UTC', (CAST(:to_date AS date) + 1)::timestamp))
    GROUP BY period_start_utc ORDER BY period_start_utc
    """,
).bindparams(bindparam("kinds", expanding=True))


def day_key(local_date: date) -> datetime:
    return datetime(local_date.year, local_date.month, local_date.day, tzinfo=UTC)


def lock_delay_day(conn: Connection, provider_id: str, local_date: date) -> None:
    """Acquired after Gold/hour/5m locks; daily workers never request those earlier locks."""
    conn.execute(
        _DAY_LOCK, {"lock_key": f"transit.delay_day|{provider_id}|{local_date.isoformat()}"}
    )
    # Waiting on an advisory lock does not refresh an RR snapshot. This write
    # raises 40001 if another holder committed after that snapshot, so the caller
    # retries its whole transaction instead of missing a newly built metric.
    conn.execute(
        _DAY_COORDINATION,
        {"provider_id": provider_id, "period_start_utc": day_key(local_date)},
    )


def invalidate_delay_days(conn: Connection, provider_id: str, snapshot_ids: Sequence[int]) -> None:
    """Mark old/new capture days before fact replacement in the caller's transaction."""
    if any(type(snapshot_id) is not int or snapshot_id <= 0 for snapshot_id in snapshot_ids):
        raise ValueError("Daily invalidation requires positive capture IDs")
    if not snapshot_ids:
        return
    dates = (
        conn.execute(
            _SELECT_CAPTURE_DATES, {"provider_id": provider_id, "snapshot_ids": list(snapshot_ids)}
        )
        .scalars()
        .all()
    )
    for local_date in dates:
        # Lock even without a watermark: a simultaneous first build must see the correction.
        lock_delay_day(conn, provider_id, local_date)
        conn.execute(
            _INVALIDATE_DAY,
            {
                "provider_id": provider_id,
                "period_start_utc": day_key(local_date),
                "local_date": local_date,
            },
        )


def delay_day_state(
    conn: Connection, provider_id: str, kind: str, local_date: date
) -> Literal["missing", "clean", "dirty"]:
    if kind not in DAILY_DELAY_TABLES:
        raise ValueError("Daily delay state supports only capture-day delay kinds")
    row = conn.execute(
        _DAY_STATE,
        {
            "provider_id": provider_id,
            "rollup_kind": kind,
            "period_start_utc": day_key(local_date),
        },
    ).first()
    if row is None:
        return "missing"
    return "dirty" if row.invalidated_at_utc is not None else "clean"


def daily_delay_status(
    conn: Connection,
    provider_id: str,
    *,
    from_date: date | None = None,
    to_date: date | None = None,
    kinds: Sequence[str] | None = None,
) -> dict[str, object]:
    """Dirty metric days over inclusive local-date bounds; coordination rows are excluded."""
    selected = tuple(DAILY_DELAY_TABLES) if kinds is None else tuple(dict.fromkeys(kinds))
    if any(kind not in DAILY_DELAY_TABLES for kind in selected):
        raise ValueError("Daily delay status supports only capture-day delay kinds")
    if from_date is not None and to_date is not None and from_date > to_date:
        raise ValueError("Daily delay status dates must be ordered")
    rows = (
        conn.execute(
            _STATUS,
            {
                "provider_id": provider_id,
                "kinds": selected,
                "from_date": from_date,
                "to_date": to_date,
            },
        )
        .mappings()
        .all()
        if selected
        else []
    )
    return {
        "provider_id": provider_id,
        "dirty_days": [
            {"date": row["local_date"].isoformat(), "kinds": list(row["kinds"])} for row in rows
        ],
        "dirty_day_count": len(rows),
    }


def assert_daily_delay_history_clean(
    conn: Connection,
    provider_id: str,
    *,
    from_date: date | None = None,
    to_date: date | None = None,
    kinds: Sequence[str] | None = None,
) -> dict[str, object]:
    """Check visible DB state; the publisher owns its consistent read/CAS boundary."""
    status = daily_delay_status(
        conn, provider_id, from_date=from_date, to_date=to_date, kinds=kinds
    )
    if status["dirty_day_count"]:
        raise ValueError(
            f"Daily delay history has {status['dirty_day_count']} dirty day(s); "
            "preserve the published history and rebuild complete recorded cohorts first."
        )
    return status
