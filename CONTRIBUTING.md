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

The materialize step writes the verified shared Turbo base that the web unit
tests' shared-tooling check compares `turbo.json` against. `setup:hooks` turns
on the pre-commit guard for generated social cards and icons.
`bun run dev` reads public snapshots through the
[Vite proxy](apps/web/vite.config.ts): it needs internet access but no database,
agency API key, storage credentials or Cloudflare account.

On Windows, `bun install --frozen-lockfile` can resolve differently from Linux; if
it fails, run `bun install` and keep that `bun.lock` change out of your commits. A dependency
change needs a lock resolved by Bun on Linux, which is what CI installs from.

## Check a change

```sh
bun run test:commands
bun run --cwd apps/data-proxy check
bun run --cwd apps/data-proxy test
bun run --cwd apps/web check
bun run --cwd apps/web lint
bun run --cwd apps/web format:check
bun run --cwd apps/web test
bun run --cwd apps/web build
```

Browser tests build the app and drive it with Playwright. Locally, from
`apps/web`, install Playwright's Chromium once with `bunx playwright install chromium`,
then run `bun run test:e2e`. CI installs a pinned Chromium from
the browser toolchain manifests, which cover linux-x64 and win32-x64 only.

The [web workflow](.github/workflows/web.yml) also checks
social cards, icons, map posters and deployment dry runs. Shared design changes belong in
[yesid.dev-design](https://github.com/mgkdante/yesid.dev-design); the `@yesid/*` URLs in
`apps/web/package.json` name the release in use.

## Python pipeline

`apps/db` uses Python from [.python-version](.python-version) and uv: `uv sync
--locked`, then `uv run pytest tests`, `uv run ruff check src tests` and
`uv run mypy`. The README's
[Python section](README.md#work-on-the-python-pipeline) covers configuration, the
disposable PostGIS test database and the cases a native Windows run cannot prove.
