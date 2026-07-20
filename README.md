# Transit

An end-to-end Montréal transit data platform: ingest STM schedule and realtime
feeds, build accountable analytics, publish a versioned public snapshot, and
serve it through a fast citizen dashboard.

- Dashboard: [transit.yesid.dev](https://transit.yesid.dev)
- Public data contract:
  [data.yesid.dev/v1/stm/manifest.json](https://data.yesid.dev/v1/stm/manifest.json)

Transit is an independent portfolio project. It is not affiliated with or
endorsed by the Société de transport de Montréal (STM). Its data is
informational and must not be used for emergencies or trip-critical decisions.

## What it does

- Captures GTFS schedules, GTFS-Realtime trip and vehicle updates, and STM
  service alerts.
- Preserves source artifacts in Bronze storage, normalizes them into Silver,
  and builds Gold reporting marts in PostgreSQL/PostGIS.
- Publishes a versioned, cacheable `/v1` snapshot instead of exposing the
  database to the public app.
- Presents live network activity, service reliability, route coverage, delays,
  occupancy, alerts, and freshness in English and French.

## Architecture

```text
STM feeds
   │
   ▼
apps/db ──► Bronze (R2) ──► Silver + Gold (PostgreSQL/PostGIS)
                                      │
                                      ▼
                           versioned /v1 snapshot (R2)
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
              apps/data-proxy             apps/web
              edge contract               SvelteKit dashboard
```

The three application domains have one-way responsibilities:

| Domain | Responsibility |
|---|---|
| [`apps/db`](apps/db/README.md) | Python ingestion, normalization, marts, publication, retention, and health checks |
| `apps/data-proxy` | Cloudflare Worker for the public `/v1` contract and compatibility routes |
| `apps/web` | SvelteKit citizen dashboard; reads snapshots only, never PostgreSQL |

The web app consumes an immutable `yesid.dev-design` Release under
`apps/web/vendor/design`. The snapshot retains its accompanying MIT license and
must never be edited by hand.

## Local development

Prerequisites: Bun 1.3+, Node 22+, Python 3.12, [uv](https://docs.astral.sh/uv/),
PostgreSQL/PostGIS, and credentials for the feed or storage paths you run.

Install the JavaScript workspace and start the dashboard:

```bash
bun install --frozen-lockfile
bun run dev
```

Run the root web gates:

```bash
bun run check
bun run test
bun run build
```

Set up and verify the data pipeline:

```bash
cd apps/db
uv sync --frozen
uv run ruff check .
uv run pytest
```

Copy `.env.example` to `.env` only for local work and provide the variables for
the path you are exercising. Never commit credentials or production exports.

## Notion Home

The [Transit Notion home](https://www.notion.so/themlabs/Transit-3663e8630690809891abd71e03b57254?source=copy_link)
contains the deeper architecture, decisions, and operational history; workspace
access may be required. Repository-facing rules live in [AGENTS.md](AGENTS.md).

## Project policies

- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Security](SECURITY.md)
- [MIT License](LICENSE)

<!-- ST5 temporary docs-only classifier probe; close unmerged. -->
