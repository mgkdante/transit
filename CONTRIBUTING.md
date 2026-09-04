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

Run the affected subset while iterating. Before handing off a release candidate,
run this ordered clean-clone CI-equivalent command from the repository root.
The tool contract is Bun 1.3.11, Node.js 22, Python 3.12, uv 0.11.15,
playwright-core 1.62.0 with Chromium 151.0.7922.34, and Gitleaks 8.30.1.
The final real-DB verification is supported on Linux and WSL and requires
Docker Compose v2 plus the standard `setsid` utility. Its one command creates a
one-service, digest-pinned PostGIS container on a dynamic loopback port and
always removes the container and its data volume.

```bash
set -euo pipefail

test "$(bun --version)" = "1.3.11"
test "$(node --version | cut -d. -f1)" = "v22"
test "$(python3 --version | cut -d. -f1,2)" = "Python 3.12"
test "$(uv --version | cut -d' ' -f1,2)" = "uv 0.11.15"

GITLEAKS_VERSION=8.30.1
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -o /tmp/gitleaks.tar.gz
echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  /tmp/gitleaks.tar.gz" | sha256sum -c -
tar -xzf /tmp/gitleaks.tar.gz -C /tmp gitleaks
GITLEAKS_BIN=/tmp/gitleaks

bun install --frozen-lockfile
(cd apps/db && uv sync --locked)

node .github/scripts/materialize-shared-config.mjs
git diff --exit-code -- turbo.json
node --test .github/scripts/deploy-scope.test.mjs
node --test .github/scripts/refresh-basemap-r2.test.mjs
bun apps/web/vendor/design/tools/adopt.ts --check --dest apps/web/vendor/design

bun run --cwd apps/web tokens:build
git diff --exit-code -- apps/web/src/lib/styles/tokens.css apps/web/src/app.css
bun run --cwd apps/web og:check
bun run --cwd apps/web icons:check
bun run --cwd apps/web map-posters:check

bun run --cwd apps/data-proxy check
bun run --cwd apps/data-proxy test
bun run --cwd apps/web lint
bun run --cwd apps/web format:check
bun run --cwd apps/web check
bun run --cwd apps/web build
apps/web/node_modules/.bin/playwright-core install chromium-headless-shell
B9_REUSE_BUILD=1 bun run --cwd apps/web test:b9-display
bun run --cwd apps/web test

(
  cd apps/db
  env -u TRANSIT_TEST_DATABASE_URL COLUMNS=200 uv run pytest tests
  uv run ruff check src tests
  uv run mypy src/transit_ops/snapshots/publish.py
  test "$(uv run alembic heads 2>/dev/null | grep -c '(head)' || true)" = "1"
)

bun audit --audit-level=high
"$GITLEAKS_BIN" detect --redact --config .gitleaks.toml

bash apps/db/scripts/run-real-db-tests.sh
```

Behavior changes require a regression test. In the pull request, explain the
problem, the boundary that owns the fix, and the commands or runtime evidence
used to verify it.

`map-posters:check` verifies the checked-in dated posters and their source
receipt entirely offline. To intentionally rebuild those assets, install the
pinned browser with
`apps/web/node_modules/.bin/playwright-core install chromium-headless-shell`,
replace the receipt's filenames with the new `YYYYMMDD`, update the matching
`MapProgressive.svelte` filenames and bilingual `staticSnapshot` date, then run
`bun run --cwd apps/web map-posters:build`. Review the changed images, receipt,
client filenames, copy, and tests together.
