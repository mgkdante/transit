# Contributing to Transit

Transit is three apps: `apps/db` (Python pipeline), `apps/data-proxy` (snapshot
Worker) and `apps/web` (SvelteKit dashboard). Keep changes within their domain,
preserve snapshot contracts and unknown values, and never commit dotenv files,
credentials or raw operational artifacts.

## Set up

Install Node from [.nvmrc](.nvmrc) and Bun from [.bun-version](.bun-version), then:

```sh
git clone https://github.com/mgkdante/transit.git
cd transit
bun install --frozen-lockfile
node .github/scripts/materialize-shared-config.mjs
bun run setup:hooks
bun run dev
```

The materialize step writes the shared Turbo config that `turbo.json` extends;
the root `build`, `test`, `check` and `lint` scripts need it. `setup:hooks` turns
on the pre-commit guards for generated social cards and icons and for the
vendored design release. `bun run dev` reads public snapshots through the
[Vite proxy](apps/web/vite.config.ts): it needs internet access but no database,
agency API key, storage credentials or Cloudflare account.

On Windows, Bun writes the vendored `file:` paths in `bun.lock` with
backslashes, so `--frozen-lockfile` fails: run `bun install` and keep that
`bun.lock` change out of your commits. If an install fails with `EEXIST`, run
`bun run clean:vendor-links` and install again. A dependency change needs a
lock resolved by Bun on Linux, which is what CI installs from.

## Check a change

```sh
bun run test:setup
bun run test:commands
bun run --cwd apps/data-proxy check
bun run --cwd apps/data-proxy test
bun run --cwd apps/web check
bun run --cwd apps/web lint
bun run --cwd apps/web format:check
bun run --cwd apps/web test
bun run --cwd apps/web build
```

Browser tests build the app and drive it with Playwright. Locally, install
Playwright's Chromium once from `apps/web` with `bunx playwright install chromium`,
then run `bun run --cwd apps/web test:e2e`. CI installs a pinned Chromium from
the browser toolchain manifests, which cover linux-x64 and win32-x64 only.

The [web workflow](.github/workflows/web.yml) also checks vendored design,
social cards, icons, map posters and deployment dry runs. Shared design changes
belong in [yesid.dev-design](https://github.com/mgkdante/yesid.dev-design); the
[design manifest](apps/web/vendor/design/manifest.json) names the release in use.

## Python pipeline

`apps/db` uses Python from [.python-version](.python-version) and uv: `uv sync
--locked`, then `uv run pytest tests`, `uv run ruff check src tests` and
`uv run mypy`. The README's
[Python section](README.md#work-on-the-python-pipeline) covers configuration, the
disposable PostGIS test database and the cases a native Windows run cannot prove.
