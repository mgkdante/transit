# Transit

Transit is an independent dashboard for bus and metro service in Montréal (STM)
and Ottawa (OC Transpo). It captures GTFS and GTFS-Realtime feeds, normalizes
them in PostgreSQL and publishes versioned JSON snapshots that the web app
reads. When an agency doesn't publish a value, the dashboard shows it as
unknown instead of estimating it.

Live at [transit.yesid.dev](https://transit.yesid.dev).

## Stack

| Path | What it does | Built with |
| --- | --- | --- |
| `apps/db` | Captures feeds, normalizes them, computes daily rollups and publishes snapshots | Python 3.12, PostgreSQL with PostGIS, SQLAlchemy, Alembic, uv |
| `apps/data-proxy` | Serves the published snapshots from R2 | Cloudflare Workers |
| `apps/web` | The public dashboard; it reads snapshots and never touches the database | SvelteKit 2, Svelte 5, Tailwind CSS 4, MapLibre GL, LayerChart, Cloudflare Workers |

Bun workspaces and Turborepo run the JavaScript apps. Design tokens, motion and
shared UI come from pinned
[yesid.dev-design](https://github.com/mgkdante/yesid.dev-design) releases.

## Quickstart

You need Node 22 ([.nvmrc](.nvmrc)) and Bun 1.3.11 ([.bun-version](.bun-version)).

```sh
git clone https://github.com/mgkdante/transit.git
cd transit
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:5173. The dev server reads the public snapshots through a
proxy, so it needs an internet connection but no database, API keys or
Cloudflare account.

[CONTRIBUTING.md](CONTRIBUTING.md) covers checks, browser tests and the Python
pipeline.

## Analytics

The production site counts visits with cookieless Plausible. Local runs and
forks send nothing unless `PUBLIC_PLAUSIBLE_DOMAIN` is set.

## License

The source is under the [MIT License](LICENSE). Agency data, map data, fonts and
GSAP keep their own terms, listed in [NOTICE](NOTICE). Transit is not affiliated
with STM, OC Transpo or any other transit agency.
