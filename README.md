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

## Fast local tests

Run `bun run test:changed` from the root on Windows or Linux after installing
repository dependencies and Playwright browsers. It uses the merge base with
`origin/main` plus staged, unstaged and untracked files; fetch main to refresh it.
Vitest follows affected module graphs; other runners and generated-input
boundaries use full owning suites. The tested browser map selects changed/related
specs at phone and desktop sizes; unknown/shared paths select all specs there.
Selection reasons, runner results and elapsed times are printed. Existing project
filters and skips apply. Use `--all` for full suites, including theme/motion
variants, or `--base HEAD` to benchmark a small edit against a candidate commit.
This local loop supplements the full CI gates; failures propagate.
