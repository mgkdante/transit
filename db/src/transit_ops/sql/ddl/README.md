# DDL Notes

Alembic is the source of truth for schema changes in Prompt 1.

Migration files live under `src/transit_ops/db/migrations/versions/`. This
directory is reserved for future SQL assets such as reporting views or reference
queries that do not belong inside Alembic revisions.
