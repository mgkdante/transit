"""SCD Type 2 dedup of silver.i3_alerts — stop the 99.4% redundant writes.

Revision ID: 0021_i3_alerts_scd2_dedup
Revises: 0020_current_vehicle_map_with_status_view
Create Date: 2026-05-27

Why this migration exists:
    A two-snapshot comparison showed STM's i3 feed returns IDENTICAL alert
    content across consecutive fetches (header.timestamp didn't even advance).
    Yet our ingestion writes 955 fresh silver rows per snapshot — once every
    5 min, 24×7. Storage trajectory at that rate:
      955 × 12 × 24 = 275,000 rows/day · 100M rows/year

    DB measurement at migration time: 128,169 rows, only 717 unique by
    content hash. **99.44% redundancy.** Table is 123 MB raw + 6 MB indexes.

    Same story for silver.i3_alert_informed_entities (420K rows, 52 MB).

What this migration does:
    SCD Type 2 redesign of silver.i3_alerts:
      1. Add columns: content_hash, first_seen_at, last_seen_at, valid_to
      2. Backfill content_hash (md5 of canonical content concatenation —
         deterministic, matches Python hashing in src/transit_ops/silver/i3.py)
      3. Initialize first_seen_at / last_seen_at = captured_at_utc
      4. Collapse duplicates: for each (provider_id, content_hash) keep the
         single oldest row, set first_seen_at = MIN, last_seen_at = MAX,
         DELETE the rest in 100k-row batches inside autocommit_block (proven
         pattern from migration 0017)
      5. Delete orphan entities (entities whose parent alert row was deleted)
      6. Add UNIQUE INDEX on (provider_id, content_hash) WHERE valid_to IS NULL
         — enables future ON CONFLICT DO UPDATE in ingestion code
      7. VACUUM ANALYZE both tables (PARALLEL 0 — same /dev/shm constraint
         from migration 0017)

    Ingestion code (src/transit_ops/silver/i3.py) updated in the same PR to:
      - Compute content_hash at normalize time (matching SQL md5 expression)
      - INSERT ... ON CONFLICT (provider_id, content_hash) WHERE valid_to IS NULL
        DO UPDATE SET last_seen_at = excluded.last_seen_at
      → 99.4% of cycles write NOTHING new, just bump last_seen_at on existing row

Hash canonicalization:
    md5 of UTF-8 bytes of `\\x1F`-joined string of 10 fields:
      alert_id, alert_header_text, description_text, severity, cause, effect,
      active_period_start_epoch, active_period_end_epoch,
      published_at_epoch, updated_at_epoch
    NULLs encoded as empty string. Timestamps as integer epoch seconds
    (sub-second precision intentionally dropped — content identity, not
    snapshot identity).

Downgrade:
    Drops the SCD2 columns + index, restores legacy gold view. Does NOT
    restore the deleted duplicate rows (they were redundant by definition).
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0021_i3_alerts_scd2_dedup"
down_revision = "0020_current_vehicle_map_with_status_view"
branch_labels = None
depends_on = None


# `\x1F` (ASCII Unit Separator) is non-printable so it won't collide with any
# real text content in alert headers/descriptions/severity etc.
_FIELD_SEP = "\x1F"


_ADD_COLUMNS = """
ALTER TABLE silver.i3_alerts
    ADD COLUMN IF NOT EXISTS content_hash   TEXT,
    ADD COLUMN IF NOT EXISTS first_seen_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_seen_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS valid_to       TIMESTAMPTZ
"""


# Canonical content hash. Must match Python hashing in
# src/transit_ops/silver/i3.py exactly — same separator, same field order,
# same NULL→empty-string treatment, same integer-epoch timestamps.
_BACKFILL_HASH = r"""
UPDATE silver.i3_alerts
SET content_hash = md5(
        coalesce(alert_id,           '') || E'\x1F' ||
        coalesce(alert_header_text,  '') || E'\x1F' ||
        coalesce(description_text,   '') || E'\x1F' ||
        coalesce(severity,           '') || E'\x1F' ||
        coalesce(cause,              '') || E'\x1F' ||
        coalesce(effect,             '') || E'\x1F' ||
        coalesce(extract(epoch from active_period_start_utc)::bigint::text, '') || E'\x1F' ||
        coalesce(extract(epoch from active_period_end_utc)::bigint::text,   '') || E'\x1F' ||
        coalesce(extract(epoch from published_at_utc)::bigint::text,        '') || E'\x1F' ||
        coalesce(extract(epoch from updated_at_utc)::bigint::text,          '')
    ),
    first_seen_at = captured_at_utc,
    last_seen_at  = captured_at_utc
WHERE content_hash IS NULL
"""


# For each (provider_id, content_hash), find the surviving row (oldest
# captured_at_utc); update its first/last_seen to the group MIN/MAX. The
# rest become orphans and get deleted in batches below.
_PROMOTE_SURVIVORS = """
WITH per_hash AS (
    SELECT provider_id, content_hash,
           min(captured_at_utc) AS first_seen,
           max(captured_at_utc) AS last_seen,
           min(ctid::text)      AS keeper_ctid
    FROM silver.i3_alerts
    GROUP BY provider_id, content_hash
)
UPDATE silver.i3_alerts AS a
SET first_seen_at = per_hash.first_seen,
    last_seen_at  = per_hash.last_seen
FROM per_hash
WHERE a.provider_id  = per_hash.provider_id
  AND a.content_hash = per_hash.content_hash
  AND a.ctid::text   = per_hash.keeper_ctid
"""


_BUILD_KEEPER_TABLE = """
CREATE TEMP TABLE i3_alert_keepers AS
SELECT provider_id,
       content_hash,
       min(i3_alert_snapshot_id) AS keeper_snapshot_id,
       (SELECT alert_index FROM silver.i3_alerts AS a2
         WHERE a2.provider_id  = a.provider_id
           AND a2.content_hash = a.content_hash
         ORDER BY a2.i3_alert_snapshot_id ASC, a2.alert_index ASC
         LIMIT 1) AS keeper_alert_index
FROM silver.i3_alerts AS a
GROUP BY provider_id, content_hash;

CREATE INDEX ON i3_alert_keepers (provider_id, content_hash);
CREATE INDEX ON i3_alert_keepers (keeper_snapshot_id, keeper_alert_index);
"""


_BATCH_SIZE = 100_000


def _delete_in_batches(bind, delete_sql: str, label: str) -> int:
    total = 0
    batch_no = 0
    while True:
        batch_no += 1
        result = bind.execute(text(delete_sql))
        deleted = result.rowcount or 0
        total += deleted
        if deleted == 0:
            break
        print(f"  {label} batch {batch_no}: deleted {deleted:,} (total {total:,})")
    return total


_ADD_UNIQUE_INDEX = """
CREATE UNIQUE INDEX IF NOT EXISTS ux_silver_i3_alerts_active_content_hash
    ON silver.i3_alerts (provider_id, content_hash)
    WHERE content_hash IS NOT NULL AND valid_to IS NULL
"""

# SET NOT NULL deferred to a follow-up migration. The realtime worker on the
# Oracle A1 VM is still running the pre-deploy ingestion code that doesn't
# populate content_hash, so SET NOT NULL would race with new inserts and fail
# (exactly what happened in the first attempt). The UNIQUE INDEX with
# `WHERE content_hash IS NOT NULL AND valid_to IS NULL` is sufficient to
# enable ON CONFLICT dedup for the new ingestion code while tolerating
# legacy NULL writes from the old worker. Once the new code is deployed
# everywhere and no more NULL rows are arriving, a follow-up migration can
# safely SET NOT NULL.
_SET_NOT_NULL = "-- intentionally empty; see comment in migration 0021"


# After dedup the gold view must keep working. The 0017-era view JOINed on
# (snapshot_id, alert_index); we keep that shape but add WHERE valid_to IS NULL
# so the view only ever returns currently-active alerts (SCD2 semantics).
_REFRESH_GOLD_VIEW = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
WITH latest_snapshot AS (
    SELECT provider_id, max(i3_alert_snapshot_id) AS i3_alert_snapshot_id
    FROM silver.i3_alerts
    WHERE valid_to IS NULL
    GROUP BY provider_id
)
SELECT
    a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.description_text,
    a.severity,
    a.cause,
    a.effect,
    e.route_id,
    e.stop_id,
    e.trip_id,
    e.area_id,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.captured_at_utc
FROM silver.i3_alerts AS a
INNER JOIN latest_snapshot AS ls
    ON ls.provider_id = a.provider_id
   AND ls.i3_alert_snapshot_id = a.i3_alert_snapshot_id
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
WHERE a.valid_to IS NULL
  AND COALESCE(a.active_period_start_utc, a.captured_at_utc) <= now()
  AND COALESCE(a.active_period_end_utc, now() + interval '100 years') >= now()
"""


_LEGACY_GOLD_VIEW_FROM_0017 = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
WITH latest_snapshot AS (
    SELECT provider_id, max(i3_alert_snapshot_id) AS i3_alert_snapshot_id
    FROM silver.i3_alerts
    GROUP BY provider_id
)
SELECT
    a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.description_text,
    a.severity,
    a.cause,
    a.effect,
    e.route_id,
    e.stop_id,
    e.trip_id,
    e.area_id,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.captured_at_utc
FROM silver.i3_alerts AS a
INNER JOIN latest_snapshot AS ls
    ON ls.provider_id = a.provider_id
   AND ls.i3_alert_snapshot_id = a.i3_alert_snapshot_id
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
WHERE COALESCE(a.active_period_start_utc, a.captured_at_utc) <= now()
  AND COALESCE(a.active_period_end_utc, now() + interval '100 years') >= now()
"""


def upgrade() -> None:
    # 1. Schema additions (idempotent, no lock-storm because TEXT/TIMESTAMP
    #    additions only update the system catalog).
    op.execute(_ADD_COLUMNS)

    # 2. Backfill + dedup must run outside the alembic-managed transaction
    #    so the 100k-row batches each commit independently (WAL stays bounded
    #    on the small Oracle A1 VM — same constraint that drove migration 0017).
    with op.get_context().autocommit_block():
        bind = op.get_bind()

        print("Backfilling content_hash + first_seen_at + last_seen_at...")
        bind.execute(text(_BACKFILL_HASH))
        n_total = bind.execute(
            text("SELECT count(*) FROM silver.i3_alerts")
        ).scalar()
        n_unique = bind.execute(
            text("SELECT count(DISTINCT (provider_id, content_hash)) FROM silver.i3_alerts")
        ).scalar()
        print(f"  total rows: {n_total:,}  unique by content: {n_unique:,}  "
              f"redundancy: {(1 - n_unique/n_total)*100:.1f}%")

        print("Promoting one survivor per content_hash...")
        bind.execute(text(_PROMOTE_SURVIVORS))

        print("Building keeper table...")
        bind.execute(text(_BUILD_KEEPER_TABLE))

        print("Wiping duplicate alert rows (keep min ctid per content_hash)...")
        _delete_in_batches(
            bind,
            f"""
            DELETE FROM silver.i3_alerts
            WHERE ctid IN (
                SELECT a.ctid
                FROM silver.i3_alerts AS a
                LEFT JOIN (
                    SELECT provider_id, content_hash, min(ctid::text) AS keeper_ctid
                    FROM silver.i3_alerts
                    GROUP BY provider_id, content_hash
                ) AS k
                  ON k.provider_id  = a.provider_id
                 AND k.content_hash = a.content_hash
                WHERE a.ctid::text <> k.keeper_ctid
                LIMIT {_BATCH_SIZE}
            )
            """,
            "silver.i3_alerts",
        )

        print("Wiping orphan informed_entities (parent alert row gone)...")
        _delete_in_batches(
            bind,
            f"""
            DELETE FROM silver.i3_alert_informed_entities AS e
            WHERE ctid IN (
                SELECT e2.ctid
                FROM silver.i3_alert_informed_entities AS e2
                LEFT JOIN silver.i3_alerts AS a
                    ON a.i3_alert_snapshot_id = e2.i3_alert_snapshot_id
                   AND a.alert_index          = e2.alert_index
                WHERE a.i3_alert_snapshot_id IS NULL
                LIMIT {_BATCH_SIZE}
            )
            """,
            "informed_entities",
        )

        print("Final backfill pass for late worker arrivals...")
        late = bind.execute(
            text("SELECT count(*) FROM silver.i3_alerts WHERE content_hash IS NULL")
        ).scalar()
        if late:
            print(f"  {late:,} late rows from worker; backfilling")
            bind.execute(text(_BACKFILL_HASH))
            # One more dedup sweep on the newly-hashed rows
            _delete_in_batches(
                bind,
                f"""
                DELETE FROM silver.i3_alerts
                WHERE ctid IN (
                    SELECT a.ctid
                    FROM silver.i3_alerts AS a
                    LEFT JOIN (
                        SELECT provider_id, content_hash, min(ctid::text) AS keeper_ctid
                        FROM silver.i3_alerts
                        GROUP BY provider_id, content_hash
                    ) AS k
                      ON k.provider_id  = a.provider_id
                     AND k.content_hash = a.content_hash
                    WHERE a.ctid::text <> k.keeper_ctid
                    LIMIT {_BATCH_SIZE}
                )
                """,
                "silver.i3_alerts (late pass)",
            )
        else:
            print("  no late arrivals — clean")

        # SET NOT NULL is deferred to a follow-up migration once the new
        # ingestion code is deployed everywhere (see _SET_NOT_NULL comment).
        # The partial index below is sufficient for ON CONFLICT dedup in
        # the new code path; NULL legacy rows from old worker code are
        # tolerated.
        print("Sealing schema: UNIQUE INDEX on (provider_id, content_hash) WHERE hash IS NOT NULL AND active...")
        bind.execute(text(_ADD_UNIQUE_INDEX))

        print("Refreshing gold.current_i3_alerts view (SCD2-aware)...")
        bind.execute(text(_REFRESH_GOLD_VIEW))

        print("Reclaiming disk + refreshing planner stats (PARALLEL 0)...")
        for stmt in (
            "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alerts",
            "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alert_informed_entities",
        ):
            print(f"  {stmt}")
            op.execute(stmt)


def downgrade() -> None:
    # Restore legacy gold view shape (no valid_to filter)
    op.execute(_LEGACY_GOLD_VIEW_FROM_0017)
    # Drop SCD2 schema additions
    op.execute("DROP INDEX IF EXISTS silver.ux_silver_i3_alerts_active_content_hash")
    op.execute(
        """
        ALTER TABLE silver.i3_alerts
            DROP COLUMN IF EXISTS content_hash,
            DROP COLUMN IF EXISTS first_seen_at,
            DROP COLUMN IF EXISTS last_seen_at,
            DROP COLUMN IF EXISTS valid_to
        """
    )
