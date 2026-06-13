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
    batch commits independently — WAL stays bounded on the small A1 VM. Because
    alembic only stamps the revision AFTER upgrade() returns, an interrupt
    mid-DELETE re-runs the WHOLE upgrade(); the collapse must therefore be
    idempotent/resumable. It is: the span table is computed over the FULL content
    group (remaining NULL rows + any survivor a prior partial run already
    promoted, rejoined by content_hash = legacy_hash), and the promote runs in
    two passes — re-stamp the EXISTING survivor in place when one exists, else
    promote a NULL keeper guarded by `content_hash IS NULL`. So a resumed run
    folds the leftover NULL dup into the existing survivor (re-stamping its full
    span) instead of minting a SECOND closed survivor for the same content
    version with a narrower span — which no constraint would catch (both closed
    rows sit outside the ux_silver_i3_alerts_active_content_hash partial index).

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
# `existing_survivor_ctid` flags a group that ALREADY has a promoted, closed
# survivor from a prior partial run (its content_hash == this group's
# legacy_hash); on resume that survivor is re-stamped (not re-minted) and the
# remaining NULL dups are simply deleted — preserving "exactly one closed
# survivor per content version".
_BUILD_LEGACY_KEEPERS = f"""
CREATE TEMP TABLE i3_legacy_keepers AS
SELECT
    nulls.provider_id,
    nulls.legacy_hash,
    nulls.keeper_ctid,
    promoted.survivor_ctid AS existing_survivor_ctid
FROM (
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
        alert_index DESC
) AS nulls
LEFT JOIN LATERAL (
    -- A survivor promoted by a prior partial run carries content_hash =
    -- legacy_hash AND valid_to IS NOT NULL (closed). DISTINCT ON keeps the
    -- canonical (latest-captured) one if a defensive read finds more than one.
    SELECT p.ctid AS survivor_ctid
    FROM silver.i3_alerts AS p
    WHERE p.provider_id = nulls.provider_id
      AND p.content_hash = nulls.legacy_hash
      AND p.valid_to IS NOT NULL
    ORDER BY p.last_seen_at DESC NULLS LAST, p.captured_at_utc DESC, p.ctid DESC
    LIMIT 1
) AS promoted ON TRUE;

CREATE INDEX ON i3_legacy_keepers (provider_id, legacy_hash);
"""


# Group span (MIN/MAX captured) per (provider_id, legacy_hash) over the FULL
# content group: the remaining NULL-hash rows PLUS any survivor already promoted
# by a prior partial run (joined back by content_hash = legacy_hash). For an
# already-promoted survivor we fold in its EXISTING first_seen_at/last_seen_at —
# the span the first run already computed over the WHOLE group — NOT just its own
# captured_at_utc. That is what guarantees a resumed run re-stamps the survivor
# with a span that still covers rows the partial DELETE already removed (e.g. the
# group's earliest capture), instead of narrowing first_seen to whatever NULL
# dups happen to survive the interrupt.
_BUILD_LEGACY_SPANS = f"""
CREATE TEMP TABLE i3_legacy_spans AS
WITH null_hash AS (
    SELECT
        provider_id,
        {_LEGACY_HASH_EXPR} AS legacy_hash,
        captured_at_utc AS first_at,
        captured_at_utc AS last_at
    FROM silver.i3_alerts
    WHERE content_hash IS NULL
),
null_groups AS (
    SELECT DISTINCT provider_id, legacy_hash FROM null_hash
),
group_bounds AS (
    SELECT provider_id, legacy_hash, first_at, last_at FROM null_hash
    UNION ALL
    -- Fold in any already-promoted survivor's PRE-COMPUTED span so the resumed
    -- span covers the WHOLE history, including rows a prior partial DELETE
    -- already removed (use first_seen_at/last_seen_at, falling back to its own
    -- captured_at_utc, never just captured_at_utc — that would re-narrow).
    SELECT
        g.provider_id,
        g.legacy_hash,
        coalesce(p.first_seen_at, p.captured_at_utc) AS first_at,
        coalesce(p.last_seen_at, p.captured_at_utc) AS last_at
    FROM null_groups AS g
    JOIN silver.i3_alerts AS p
        ON p.provider_id = g.provider_id
       AND p.content_hash = g.legacy_hash
       AND p.valid_to IS NOT NULL
)
SELECT
    provider_id,
    legacy_hash,
    min(first_at) AS first_seen,
    max(last_at) AS last_seen
FROM group_bounds
GROUP BY 1, 2;

CREATE INDEX ON i3_legacy_spans (provider_id, legacy_hash);
"""


# Promote in two passes, both keyed on i3_legacy_keepers/spans:
#
#   PASS 1 (resume re-stamp): for a group that ALREADY has a promoted survivor
#   from a prior partial run, UPDATE that EXISTING survivor row in place with the
#   FULL-group span. No new row is minted, so the group still has exactly one
#   closed survivor. Keyed on a.ctid = k.existing_survivor_ctid.
#
#   PASS 2 (first-time promote): for a group with NO existing survivor
#   (existing_survivor_ctid IS NULL), promote the latest NULL-hash keeper —
#   setting content_hash + first/last_seen span + valid_to together. The
#   `AND a.content_hash IS NULL` guard means an already-promoted survivor can
#   never be re-promoted (idempotency (a)); content_hash AND valid_to set
#   together keep the promoted row OUT of the active partial-index domain
#   (valid_to IS NULL) so it never collides with an active hashed twin.
#
# NOTE: the a.ctid = k.*_ctid joins assume keeper/survivor ctids are stable for
# the duration of upgrade() — i.e. no concurrent VACUUM FULL or HOT-update of
# these rows. That holds here: the legacy NULL-hash set (and its already-closed
# survivors) is disjoint from the live worker write-set, which only touches
# active hashed rows.
_PROMOTE_LEGACY_SURVIVORS = """
WITH restamp AS (
    UPDATE silver.i3_alerts AS a
    SET first_seen_at = s.first_seen,
        last_seen_at  = s.last_seen,
        valid_to      = s.last_seen
    FROM i3_legacy_keepers AS k
    JOIN i3_legacy_spans AS s
        ON s.provider_id = k.provider_id
       AND s.legacy_hash = k.legacy_hash
    WHERE k.existing_survivor_ctid IS NOT NULL
      AND a.ctid = k.existing_survivor_ctid
      AND a.content_hash = k.legacy_hash
    RETURNING 1
)
UPDATE silver.i3_alerts AS a
SET content_hash  = k.legacy_hash,
    first_seen_at = s.first_seen,
    last_seen_at  = s.last_seen,
    valid_to      = s.last_seen
FROM i3_legacy_keepers AS k
JOIN i3_legacy_spans AS s
    ON s.provider_id = k.provider_id
   AND s.legacy_hash = k.legacy_hash
WHERE k.existing_survivor_ctid IS NULL
  AND a.ctid = k.keeper_ctid
  AND a.content_hash IS NULL
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
