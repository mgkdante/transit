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

Install from the lockfile and run the JavaScript workspace gates:

```bash
bun install --frozen-lockfile
bun run check
bun run test
bun run build
```

For data-pipeline changes, also run:

```bash
cd apps/db
uv sync --frozen
uv run ruff check .
uv run pytest
```

Behavior changes require a regression test. In the pull request, explain the
problem, the boundary that owns the fix, and the commands or runtime evidence
used to verify it.
