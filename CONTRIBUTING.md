# Contributing to Transit

Transit has three apps: `apps/db` (Python pipeline), `apps/data-proxy` (snapshot
Worker) and `apps/web` (SvelteKit dashboard). Keep each change inside its app,
preserve the snapshot contracts, and leave missing values unknown rather than
filling them in. Never commit dotenv files, credentials or raw operational
artifacts.

## Set up

Install Node from [.nvmrc](.nvmrc) and Bun from [.bun-version](.bun-version), then:

```sh
git clone https://github.com/mgkdante/transit.git
cd transit
bun install --frozen-lockfile
bun run setup:hooks
bun run dev
```

`setup:hooks` turns on the pre-commit check for generated social cards and
icons. `bun run dev` serves http://localhost:5173 from the public snapshots; it
needs internet access but no database, API keys or Cloudflare account.

On Windows, `bun install --frozen-lockfile` can resolve differently from Linux.
If it fails, run `bun install` and keep the `bun.lock` change out of your
commit. A dependency change needs a lockfile resolved by Bun on Linux, which is
what CI installs from.

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

Browser tests build the app and drive it with Playwright. From `apps/web`,
install Chromium once with `bunx playwright install chromium`, then run
`bun run test:e2e`. CI uses a pinned Chromium from the browser toolchain
manifests, which cover linux-x64 and win32-x64.

CI also checks the social cards, icons, map posters and deploy dry runs. Shared
design changes belong in
[yesid.dev-design](https://github.com/mgkdante/yesid.dev-design); the `@yesid/*`
URLs in `apps/web/package.json` pin the release in use.

## Python pipeline

From `apps/db`, with Python from [.python-version](.python-version) and
[uv](https://docs.astral.sh/uv/):

```sh
uv sync --locked
uv run ruff check src tests
uv run mypy
uv run pytest tests
```

Tests that need a real database skip unless `TRANSIT_TEST_DATABASE_URL` is set.
To run them, create a disposable local PostgreSQL with PostGIS, then set
`TRANSIT_TEST_DATABASE_URL=postgresql+psycopg://transit_ci:transit_ci@127.0.0.1:5432/transit_ci`
(adjust the password and port) and
`TRANSIT_TEST_DATABASE_DISPOSABLE=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE`. The
[target guard](apps/db/src/transit_ops/db/target_safety.py) only accepts
approved local role and database names, and the tests can change the database's
contents. Apply the migrations first with `DATABASE_URL` set to the same URL and
`uv run alembic upgrade head`.

For pipeline configuration, copy [.env.example](.env.example) to `apps/db/.env`.
Storage is local by default; capturing live feeds needs the provider API keys.
Some tests exercise Bash scripts and POSIX processes, so only a Linux run, as in
CI, covers them.

## Deploys and operations

Deploys and the scheduled pipeline run from [GitHub Actions](.github/workflows)
with the maintainer's Cloudflare, storage and database access. Never point tests
or migrations at production. Pull requests from branches of this repository get
a noindex web preview at `pr-<number>-transit-web.<subdomain>.workers.dev`,
linked from the PR's `preview` deployment; fork pull requests skip it.

## Questions and reports

See [SUPPORT.md](SUPPORT.md) for questions and bug reports and
[SECURITY.md](SECURITY.md) for vulnerabilities.
