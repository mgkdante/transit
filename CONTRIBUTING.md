# Contributing

Transit is a maintainer-led portfolio project. Reproducible bug fixes,
accessibility improvements, tests, performance work, and documentation
corrections are welcome. Discuss substantial behavior or architecture changes
in an issue before implementing them.

## Boundaries

- Keep each pull request single-purpose.
- Preserve the separation between `apps/db`, `apps/data-proxy`, and `apps/web`.
- The public app reads the versioned snapshot contract, never PostgreSQL.
- Never hand-edit `apps/web/vendor/design`. Shared design changes ship from an
  exact immutable `yesid.dev-design` Release and land here in a dedicated bump.
- Do not include credentials, private data, production exports, or internal
  operational receipts.

## Verification

Install from the lockfile and run the core workspace commands:

```bash
bun install --frozen-lockfile
bun run check
bun run build
bun run test
```

For data-pipeline changes, also run the CI offline and migration-head gates:

```bash
cd apps/db
uv sync --locked
env -u TRANSIT_TEST_DATABASE_URL COLUMNS=200 uv run pytest tests
uv run ruff check src tests --select F
uv run mypy src/transit_ops/snapshots/publish.py
test "$(uv run alembic heads 2>/dev/null | grep -c '(head)' || true)" = "1"
```

CI separately runs `uv run alembic upgrade head` and `uv run pytest tests`
against its empty, disposable `postgis/postgis:16-3.4` service with `COLUMNS=200`,
`DATABASE_URL`, `TRANSIT_TEST_DATABASE_URL`, and `PGPASSWORD` set.

Behavior changes require a regression test. In the pull request, explain the
problem, the boundary that owns the fix, and the commands or runtime evidence
used to verify it.
