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
The tool contract is Bun 1.3.11, Node.js 22.23.2, Python 3.12, uv 0.11.15,
Wrangler 4.115.0, playwright-core 1.62.0 with Chromium 151.0.7922.34, and
Gitleaks 8.30.1.
The final real-DB verification is supported on Linux and WSL with a local amd64
Docker daemon and requires Python 3.12 and Docker Compose v2. Its one command
creates a one-service, digest-pinned PostGIS container on a dynamic loopback
port. Cleanup is attempted on handled exits, and success is returned only after
the generated data volume is proven absent. SIGKILL, host loss, and Docker
daemon loss cannot guarantee cleanup.

```bash
set -euo pipefail

nvm install
test "$(node --version)" = "v$(tr -d '\r\n' < .nvmrc)"
test "$(bun --version)" = "$(tr -d '\r\n' < .bun-version)"
test "$(uv --version | cut -d' ' -f1,2)" = "uv 0.11.15"

transit_tool_dir="$(mktemp -d)"
trap 'find -P "$transit_tool_dir" -depth -delete' EXIT
GITLEAKS_BIN="$(bash .github/scripts/install-gitleaks.sh "$transit_tool_dir")"
test "$("$GITLEAKS_BIN" version)" = "8.30.1"

bun install --frozen-lockfile
(cd apps/db && uv sync --locked)
test "$(cd apps/db && uv run python -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')" = "3.12"

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
./node_modules/.bin/wrangler deploy --dry-run --config apps/data-proxy/wrangler.toml
bun run --cwd apps/web lint
bun run --cwd apps/web format:check
bun run --cwd apps/web check
bun run --cwd apps/web build
(cd apps/web && ../../node_modules/.bin/wrangler deploy --dry-run --env="")
apps/web/node_modules/.bin/playwright-core install chromium-headless-shell
node apps/web/scripts/verify-browser-toolchain.mjs
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
python3 .github/scripts/check_public_tree.py
"$GITLEAKS_BIN" dir --redact --config .gitleaks.toml .
"$GITLEAKS_BIN" detect --redact --config .gitleaks.toml --log-opts HEAD

bash apps/db/scripts/verify-runtime-images.sh
bash apps/db/scripts/run-real-db-tests.sh
```

The repository pins the Ubuntu 24.04 runner series and readable OCI tags plus
multi-architecture index digests. It intentionally does not pretend every
input is byte-frozen: GitHub services the runner's patch image; Debian Bookworm
apt packages inside the pinned images receive security updates; local and CI
select an available Python 3.12 patch; host Docker Engine and Compose are
capability-checked; standard host tools, dependency and advisory registries,
and the scheduled Protomaps data source continue to move. Protected CI prints
the effective host and container versions; deployment images separately pin
and assert Python 3.12.14.

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
