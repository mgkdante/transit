# Transit

Transit is an independent civic dashboard for exploring transit service with
inspectable data, charts and maps. It captures GTFS and GTFS-Realtime feeds,
normalizes them in Postgres, and publishes versioned snapshots for the citizen
web app. STM is the current starting point; provider manifests describe the
available data and attribution. Missing data remains unknown.

[Public dashboard](https://transit.yesid.dev) · [Source](https://github.com/mgkdante/transit)

| Domain | Responsibility | Command owner |
| --- | --- | --- |
| `apps/db` | Python ingestion, normalization and snapshot publication | [pyproject.toml](apps/db/pyproject.toml) |
| `apps/data-proxy` | Cloudflare Worker serving versioned snapshots | [package.json](apps/data-proxy/package.json) |
| `apps/web` | SvelteKit dashboard consuming snapshots, without direct DB access | [package.json](apps/web/package.json) |

## Start the web app

Install the supported Node and Bun pins from [.nvmrc](.nvmrc) and
[.bun-version](.bun-version). [package.json](package.json) owns workspace commands;
[bun.lock](bun.lock) owns the resolved JavaScript dependencies.

```sh
git clone https://github.com/mgkdante/transit.git
cd transit
bun install --frozen-lockfile
node .github/scripts/materialize-shared-config.mjs
bun run dev
```

Open the local URL printed by Vite. These commands work with native Windows or
Linux tooling. The default development preview reads public snapshots through
the [Vite proxy](apps/web/vite.config.ts). It needs internet access but no
database, agency API key, storage credentials or Cloudflare account. Previewing
does not publish data. Upstream freshness, feed coverage and basemap availability
remain properties of the public data service.

## Check a change

Run these commands from the repository root after installing dependencies:

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

The [web workflow](.github/workflows/web.yml) also checks vendored design,
generated tokens, social cards, icons, map posters, browser behavior and deployment
dry runs. Run the affected gate before changing those assets. The
[design manifest](apps/web/vendor/design/manifest.json) identifies the immutable
release: shared design changes belong in its source repository, followed by
release adoption. Browser checks use the pinned platform manifests and
[installer](apps/web/scripts/install-browser-toolchain.mjs); its required argument
is an absolute installation directory.

## Work on the Python pipeline

Use Python from [.python-version](.python-version) and the uv pin in
[setup-py](.github/actions/setup-py/action.yml). From `apps/db`, run:

```sh
uv sync --locked
uv run transit-ops --help
uv run ruff check src tests
uv run mypy
uv run pytest tests
uv run alembic heads
```

With `TRANSIT_TEST_DATABASE_URL` unset, real-database tests skip. The suite also
contains operational cases requiring Bash, POSIX processes or other runtime
access; a native Windows run does not prove those Linux cases. Mypy checks the
configured paths. `alembic heads` inspects migration history without applying it.

For pipeline configuration, copy [.env.example](.env.example) to `apps/db/.env`.
Local Bronze and snapshot storage are the defaults. Live feed capture requires
the relevant provider credentials; publication to remote storage needs explicit
configuration. Never point test or migration commands at production by accident.

Real-database tests need a dedicated disposable local PostgreSQL/PostGIS database.
The [target guard](apps/db/src/transit_ops/db/target_safety.py) requires an approved
local role/database pair and exact `TRANSIT_TEST_DATABASE_DISPOSABLE` confirmation;
tests can change its contents. See the
[real-DB command](apps/db/scripts/run-real-db-tests.sh) and
[backend workflow](.github/workflows/ci.yml) for the hosted Linux lifecycle.
Operational Bash scripts and container verification belong on the supported Linux
host; local Docker is not part of the Windows/WSL contributor workflow.

## Contribute and operate

Keep changes within their domain, preserve snapshot contracts and unknown values,
and run the relevant checks. Do not commit dotenv files, credentials or raw
operational artifacts. The [public-tree guard](.github/scripts/check_public_tree.py)
checks staged source for private residue; the
[security workflow](.github/workflows/secret-scan.yml) adds secret scanning.
Deployment requires the configured accounts, explicit targets and protected
workflow checks. A local build or dry run does not establish production adoption.

Transit source uses the [MIT License](LICENSE). [NOTICE](NOTICE) records separate
terms and attribution for design, GSAP, fonts, maps and provider data. Transit is
not affiliated with the transit agencies. Maintainer workflow instructions live
in [AGENTS.md](AGENTS.md); private workflow access is unnecessary for this setup.
