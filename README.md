# Transit

[![web](https://github.com/yesid-dev/transit/actions/workflows/web.yml/badge.svg?branch=main)](https://github.com/yesid-dev/transit/actions/workflows/web.yml)

Transit is an independent dashboard for bus and metro service in Montréal (STM)
and Ottawa (OC Transpo). It captures GTFS and GTFS-Realtime feeds, normalizes
them in PostgreSQL and publishes versioned JSON snapshots that the web app
reads. When an agency doesn't publish a value, the dashboard shows it as
unknown instead of estimating it.

Live at [transit.yesid.dev](https://transit.yesid.dev).

## Stack

| Path | What it does | Built with |
| --- | --- | --- |
| `apps/db` | Captures feeds, normalizes them, computes daily rollups and publishes snapshots | Python, PostgreSQL, SQLAlchemy, Alembic, uv |
| `apps/data-proxy` | Serves the published snapshots from R2 | Cloudflare Workers |
| `apps/web` | The public dashboard; it reads snapshots and never touches the database | SvelteKit 3, Svelte 5, Tailwind CSS 4, MapLibre GL, LayerChart, Cloudflare Workers |

Bun workspaces and Turborepo run the JavaScript apps. Design tokens, motion and
shared UI come from pinned
[yesid.design](https://github.com/yesid-dev/yesid.design) releases.

## Quickstart

Install Node from [.nvmrc](.nvmrc) and Bun from [.bun-version](.bun-version), then:

```sh
git clone https://github.com/yesid-dev/transit.git
cd transit
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:5173. The dev server reads the public snapshots through a
proxy, so it needs an internet connection but no database, API keys or
Cloudflare account.

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) covers checks, browser tests and the Python
  pipeline.
- The
  [Architecture wiki](https://yesid-dev.notion.site/3663e8630690815b927dea4888252234?v=4093e8630690803dbdba000c6dfd9439)
  documents how the system is built, tested, deployed and operated.

## Admin deployment

Dispatch from main to build and deploy a selected SHA or branch immediately,
without running tests or waiting for CI. Targets are `web` (default), `data-proxy`,
or `both`; the job summary records the deployed SHA and Worker version per target.
Production deployments share a non-cancelling lock.

```sh
gh workflow run deploy-now.yml -R yesid-dev/transit --ref main -f ref=<sha> -f target=web
```

For VM workers, use the existing [worker-only rollout runbook](https://app.notion.com/p/40e3e8630690813a80eddf5efc7752bb),
including its documented Compose activation command and host preconditions.

## Analytics

The production site counts visits and a few named interactions with cookieless
Plausible (the event list is in `apps/web/src/lib/site/analytics.ts`), and loads
the Cloudflare Web Analytics beacon when `PUBLIC_CF_BEACON_TOKEN` is also set.
Local runs and forks send nothing unless `PUBLIC_PLAUSIBLE_DOMAIN` is set and
the page is served from that host.

## License

The source is under the [MIT License](LICENSE). Agency data, map data, fonts and
GSAP keep their own terms, listed in [NOTICE](NOTICE). Transit is not affiliated
with STM, OC Transpo or any other transit agency.
