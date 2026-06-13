"""Enable the deferred SET NOT NULL on silver.i3_alerts.content_hash (slice-9.1.1l).

Revision ID: 0039_i3_content_hash_not_null
Revises: 0038_i3_legacy_nullhash_collapse
Create Date: 2026-06-13

0021 deferred the content_hash SET NOT NULL (0021:166-175) because the old
worker still wrote NULL-hash rows. After the 2026-06-09 slice-h redeploy no new
NULL-hash rows arrive, and 0038 collapsed the legacy NULL-hash backlog, so the
table now has a real content_hash on every row.

This migration:
  1. Guards with a DO-block RAISE if ANY content_hash IS NULL still remains —
     fails loudly + re-runnably rather than silently (a straggler would mean a
     stale pre-SCD-2 writer is still alive; run 0038 first / investigate).
  2. ALTER TABLE silver.i3_alerts ALTER COLUMN content_hash SET NOT NULL. Post-
     0038 the table is tiny, so the validating scan + brief ACCESS EXCLUSIVE
     lock between worker cycles is fine.

Scope is content_hash ONLY (the 0021 deferral text names only content_hash).
first_seen_at / last_seen_at are 100% populated post-0038 but stay nullable.

Downgrade: ALTER COLUMN content_hash DROP NOT NULL.
"""

from __future__ import annotations

from alembic import op

revision = "0039_i3_content_hash_not_null"
down_revision = "0038_i3_legacy_nullhash_collapse"
branch_labels = None
depends_on = None


_GUARD_NO_NULL_HASH = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM silver.i3_alerts WHERE content_hash IS NULL) THEN
        RAISE EXCEPTION
            'content_hash NULL rows remain — run 0038 / check for a stale writer';
    END IF;
END
$$
"""


_SET_NOT_NULL = """
ALTER TABLE silver.i3_alerts
    ALTER COLUMN content_hash SET NOT NULL
"""


_DROP_NOT_NULL = """
ALTER TABLE silver.i3_alerts
    ALTER COLUMN content_hash DROP NOT NULL
"""


def upgrade() -> None:
    op.execute(_GUARD_NO_NULL_HASH)
    op.execute(_SET_NOT_NULL)


def downgrade() -> None:
    op.execute(_DROP_NOT_NULL)
