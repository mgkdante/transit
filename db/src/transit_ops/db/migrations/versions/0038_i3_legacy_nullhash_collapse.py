"""Collapse + close the legacy NULL-hash silver.i3_alerts rows (slice-9.1.1l).

Revision ID: 0038_i3_legacy_nullhash_collapse
Revises: 0037_i3_alert_text_en
Create Date: 2026-06-13

Why this migration exists:
    The pre-slice-h worker wrote ~2.7M legacy rows into silver.i3_alerts with
    content_hash IS NULL (it predated the 0021 SCD-2 columns). 0021 collapsed
    the THEN-existing rows on 2026-05-27, but the old worker kept inserting
    NULL-hash duplicates until the 2026-06-09 slice-h redeploy. Those legacy
    rows still bloat the table (2.8GB), keep gold.i3_alert_history_reporting
    fanning out ~8M joined rows daily, and block the deferred
    content_hash SET NOT NULL (0021:166-175). 0037's EN backfill left them
    untouched on purpose — this is their cleanup.

What this migration does (collapse + close, batched + /dev/shm-safe):
    1. Build a TEMP keeper table: one survivor per (provider_id, legacy_hash)
       over ONLY content_hash IS NULL rows, choosing the LATEST-captured
       duplicate (so the survivor carries the most complete entity set).
    2. Build a TEMP span table: group MIN/MAX(captured_at_utc) per
       (provider_id, legacy_hash) over the same NULL-hash work-set.
    3. PROMOTE each survivor in ONE UPDATE that sets content_hash +
       first_seen_at/last_seen_at = span + valid_to = last sighting. Setting
       content_hash AND valid_to together keeps the promoted row OUT of the
       ux_silver_i3_alerts_active_content_hash partial-index domain
       (WHERE content_hash IS NOT NULL AND valid_to IS NULL), so it can never
       collide with an active hashed twin.
    4. DELETE the remaining content_hash IS NULL rows in 100k-row batches
       (informed entities cascade via fk_silver_i3_alert_informed_entities_alert
       ON DELETE CASCADE — do NOT delete entities first).
    5. VACUUM (PARALLEL 0, ANALYZE) both tables (same /dev/shm constraint that
       drove 0017/0021).

    Everything runs inside op.get_context().autocommit_block() so each 100k
    batch commits independently — WAL stays bounded on the small A1 VM, and the
    migration is idempotent/resumable: every statement keys on remaining
    content_hash IS NULL rows, and the survivor-promote no-ops once a hash is
    promoted (the keeper temp table only sees NULL-hash rows).

Hash canonicalization:
    _LEGACY_HASH_EXPR copies the md5 body from 0021's _BACKFILL_HASH verbatim —
    same 10 fields, E'\\x1F' separators, integer-epoch timestamps, NULL→'' —
    so survivors carry a REAL content_hash identical to what the new worker /
    compute_alert_content_hash() would produce, which is what makes 0039's
    SET NOT NULL legal.

Downgrade:
    raise NotImplementedError — the deleted legacy duplicates are unrecoverable
    (0017 precedent). raw.i3_alert_snapshots keeps full raw_payload_json for
    >=30d as the replay safety net.
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0038_i3_legacy_nullhash_collapse"
down_revision = "0037_i3_alert_text_en"
branch_labels = None
depends_on = None


_BATCH_SIZE = 100_000


# md5 body copied VERBATIM from 0021's _BACKFILL_HASH (10 coalesced fields
# joined by E'\x1F', integer-epoch timestamps). MUST stay character-identical
# to the 0021 expression and to compute_alert_content_hash() in silver/i3.py.
_LEGACY_HASH_EXPR = r"""md5(
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
    )"""


# One survivor per (provider_id, legacy_hash) over the NULL-hash work-set,
# choosing the LATEST-captured duplicate (its entity set is the most complete).
_BUILD_LEGACY_KEEPERS = f"""
CREATE TEMP TABLE i3_legacy_keepers AS
SELECT DISTINCT ON (provider_id, legacy_hash)
    provider_id,
    legacy_hash,
    keeper_ctid
FROM (
    SELECT
        provider_id,
        {_LEGACY_HASH_EXPR} AS legacy_hash,
        ctid AS keeper_ctid,
        captured_at_utc,
        i3_alert_snapshot_id,
        alert_index
    FROM silver.i3_alerts
    WHERE content_hash IS NULL
) AS t
ORDER BY
    provider_id,
    legacy_hash,
    captured_at_utc DESC,
    i3_alert_snapshot_id DESC,
    alert_index DESC;

CREATE INDEX ON i3_legacy_keepers (provider_id, legacy_hash);
"""


# Group span (MIN/MAX captured) per (provider_id, legacy_hash), NULL-hash only.
_BUILD_LEGACY_SPANS = f"""
CREATE TEMP TABLE i3_legacy_spans AS
SELECT
    provider_id,
    {_LEGACY_HASH_EXPR} AS legacy_hash,
    min(captured_at_utc) AS first_seen,
    max(captured_at_utc) AS last_seen
FROM silver.i3_alerts
WHERE content_hash IS NULL
GROUP BY 1, 2;

CREATE INDEX ON i3_legacy_spans (provider_id, legacy_hash);
"""


# Promote the survivor: content_hash + first/last_seen span + valid_to in ONE
# statement. content_hash AND valid_to set together => the new row version never
# satisfies the active partial-index predicate (valid_to IS NULL) => no collision
# with an active hashed twin sharing the same content.
_PROMOTE_LEGACY_SURVIVORS = """
UPDATE silver.i3_alerts AS a
SET content_hash  = k.legacy_hash,
    first_seen_at = s.first_seen,
    last_seen_at  = s.last_seen,
    valid_to      = s.last_seen
FROM i3_legacy_keepers AS k
JOIN i3_legacy_spans AS s
    ON s.provider_id = k.provider_id
   AND s.legacy_hash = k.legacy_hash
WHERE a.ctid = k.keeper_ctid
"""


# Batched delete of the remaining NULL-hash rows. Informed entities cascade via
# the (i3_alert_snapshot_id, alert_index) ON DELETE CASCADE FK (0013:242-247).
_DELETE_LEGACY_BATCH = f"""
DELETE FROM silver.i3_alerts
WHERE ctid IN (
    SELECT ctid
    FROM silver.i3_alerts
    WHERE content_hash IS NULL
    LIMIT {_BATCH_SIZE}
)
"""


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


def upgrade() -> None:
    # Outside the alembic-managed transaction so each 100k batch commits
    # independently (WAL bounded on the A1 VM — same constraint as 0017/0021).
    with op.get_context().autocommit_block():
        bind = op.get_bind()

        # /dev/shm safety (lesson from the wave-2 incident): the keeper/span
        # temp-table builds sort/group the ~2.7M NULL-hash work-set in single
        # statements. Disable parallel workers so no parallel hash/sort tries to
        # resize the small containerized shared-memory segment ("could not
        # resize shared memory segment"), and bound work_mem so a large sort
        # spills to disk instead of ballooning memory. Session-scoped (SET, not
        # SET LOCAL) because autocommit_block commits between statements.
        bind.execute(text("SET max_parallel_workers_per_gather = 0"))
        bind.execute(text("SET work_mem = '128MB'"))

        before = bind.execute(
            text("SELECT count(*) FROM silver.i3_alerts WHERE content_hash IS NULL")
        ).scalar()
        print(f"Legacy NULL-hash rows before collapse: {before:,}")

        if before:
            print("Building keeper temp table (latest-captured survivor per hash)...")
            bind.execute(text(_BUILD_LEGACY_KEEPERS))

            print("Building span temp table (group MIN/MAX captured)...")
            bind.execute(text(_BUILD_LEGACY_SPANS))

            print("Promoting one closed survivor per content version...")
            bind.execute(text(_PROMOTE_LEGACY_SURVIVORS))

            print("Wiping remaining NULL-hash rows (entities cascade)...")
            _delete_in_batches(bind, _DELETE_LEGACY_BATCH, "silver.i3_alerts")
        else:
            print("  no legacy NULL-hash rows — nothing to collapse")

        after = bind.execute(
            text("SELECT count(*) FROM silver.i3_alerts WHERE content_hash IS NULL")
        ).scalar()
        print(f"Legacy NULL-hash rows after collapse: {after:,}")

        print("Reclaiming disk + refreshing planner stats (PARALLEL 0)...")
        for stmt in (
            "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alerts",
            "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alert_informed_entities",
        ):
            print(f"  {stmt}")
            op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError(
        "0038 deletes legacy NULL-hash duplicate rows irreversibly (0017 "
        "precedent). raw.i3_alert_snapshots retains raw_payload_json for >=30d "
        "as the replay source if a rebuild is ever required."
    )
