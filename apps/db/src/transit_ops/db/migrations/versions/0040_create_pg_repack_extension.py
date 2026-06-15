"""Create the pg_repack extension so weekly bloat reclaim can actually run.

Revision ID: 0040_create_pg_repack_extension
Revises: 0039_i3_content_hash_not_null
Create Date: 2026-06-13

slice-9.1.1m — the weekly pg_repack job had no extension to call: Dockerfile.postgis
installs postgresql-16-repack but only `CREATE EXTENSION postgis` was ever issued
(0013_gold_ops_brain_contract.py). This migration creates the extension via a
versioned, idempotent, offline-/real-DB-testable DDL.

Catalog-light, no table scan: CREATE EXTENSION touches only the catalog and the
pg_repack `repack` schema (a handful of helper functions/tables). It never scans,
sorts, or rewrites any user table — pg_repack does its work later at invocation
time, never here. The DDL is a single fast statement, so no batched-commit loop
is needed.

Guarded create: dev machines and pg_dump-restored throwaway test clusters do not
ship the pg_repack .so (only the prod Dockerfile.postgis image does). The upgrade
first probes pg_available_extensions; if the package is absent it prints a loud
skip-notice and returns cleanly rather than erroring, so `alembic upgrade head`
stays green everywhere. On prod the package is present, so the extension is
created. Requires superuser — prod's `transit` role is the bootstrap superuser of
the official postgres image, which is fine.
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0040_create_pg_repack_extension"
down_revision = "0039_i3_content_hash_not_null"
branch_labels = None
depends_on = None


# Probe the local cluster's available-extension catalog. Returns 0 on a cluster
# whose image never installed postgresql-16-repack (dev / throwaway test box).
_AVAILABLE_PROBE = """
SELECT count(*) FROM pg_available_extensions WHERE name = 'pg_repack'
"""


# Idempotent — re-running upgrade on a cluster that already has the extension is
# a no-op (IF NOT EXISTS).
_CREATE_EXTENSION = """
CREATE EXTENSION IF NOT EXISTS pg_repack
"""


# CASCADE is intentionally omitted: a downgrade only runs in a planned window with
# no repack pass in flight, so there are no dependent repack.log_* objects to drop.
_DROP_EXTENSION = """
DROP EXTENSION IF EXISTS pg_repack
"""


def upgrade() -> None:
    bind = op.get_bind()
    available = bind.execute(text(_AVAILABLE_PROBE)).scalar()
    if not available:
        print(
            "pg_repack package not available in this cluster "
            "(pg_available_extensions has no 'pg_repack' row); skipping "
            "CREATE EXTENSION. This is expected on dev / throwaway test "
            "clusters that lack postgresql-16-repack. Prod ships it via "
            "Dockerfile.postgis."
        )
        return
    op.execute(_CREATE_EXTENSION)


def downgrade() -> None:
    op.execute(_DROP_EXTENSION)
