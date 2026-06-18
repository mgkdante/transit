# Cloudflare deploy notes — transit web (slice-9.2 P5)

How the SvelteKit app deploys to Cloudflare and how it talks to the `/v1`
snapshot contract. Operational truth lives in the Transit Notion subtree
(Runtime / Architecture); this file is the in-repo quick reference for the
serving glue that ships in `apps/web/`.

## Topology

- **App**: SvelteKit + `@sveltejs/adapter-cloudflare`, deployed as a
  Cloudflare Worker with static assets. Production is
  `https://transit.yesid.dev`; the develop lane is
  `https://dev.transit.yesid.dev`.
- **Data**: the `/v1` snapshot contract is published to Cloudflare R2 and served
  by a **separate, more-specific zone-route Worker on
  `transit.yesid.dev/data/*`**. The app NEVER bundles or co-hosts the snapshot
  JSON — the snapshot-contract firewall keeps the pipeline output behind its own
  worker with its own freshness rules.
- **Develop data**: `dev.transit.yesid.dev` deliberately reads the production
  `/v1` snapshot contract read-only for now (`PUBLIC_V1_BASE` points at
  `https://transit.yesid.dev/data/v1`). That gives the web lane a real staging
  host without duplicating the data pipeline before a schema-contract change
  needs it.

## `_routes.json` — generated, do not hand-write

`adapter-cloudflare` **auto-generates `_routes.json`** at build time. It decides
which paths invoke the SvelteKit Worker (SSR / dynamic) vs. which are served as
static assets straight from the edge. We do not commit a hand-written
`_routes.json`.

What that means for the paths this slice owns:

- `/_app/immutable/*`, `/og/*`, `/favicon.svg`, `/fonts/*` — **static assets**.
  The adapter excludes static files from the Worker invocation automatically, so
  these are served from the edge and pick up the rules in `static/_headers`.
- `/data/*` — **must NOT be routed to this app at all**. It belongs to the
  `transit-data-proxy` Worker. In production Cloudflare's more-specific
  `transit.yesid.dev/data/*` route wins over the app route
  `transit.yesid.dev/*`. There is **no `/data` route in `src/routes/`**, so the
  adapter will not emit a Worker entry for it — but if a `/data` route is ever
  added, it must be added to the adapter's `routes.exclude` in `svelte.config.js`
  so the app Worker cannot swallow the data origin.

### If you ever need explicit excludes

`svelte.config.js` (owned by the main thread, not this slice) can pass excludes
to the adapter:

```js
adapter({
  routes: {
    include: ['/*'],
    // Keep data + prebuilt assets off the SvelteKit Worker:
    exclude: ['/data/*', '/og/*', '/_app/immutable/*', '/favicon.svg', '/fonts/*']
  }
});
```

The asset excludes are usually redundant (the adapter adds `<all>` for static
files), but **`/data/*` is the one exclude worth being explicit about** if a
local `/data` route is ever introduced for the dev proxy — it documents intent
and prevents the Worker from shadowing the data origin.

## Caching — `static/_headers`

`static/_headers` is copied to the deploy root and read by Cloudflare. Summary
(see the file for the authoritative rules):

| Path                 | Cache-Control                                                |
| -------------------- | ------------------------------------------------------------ |
| `/_app/immutable/*`  | `public, max-age=31536000, immutable`                        |
| `/fonts/*`           | `public, max-age=31536000, immutable`                        |
| `/og/*`              | `public, max-age=3600, s-maxage=86400, swr=604800`           |
| `/favicon.svg`       | `public, max-age=604800`                                      |
| `/data/*`            | `no-store` (belt-and-suspenders; freshness is the worker's)  |

**`/data/*` is never cached at this edge.** Stale transit data is the cardinal
sin of this app — the on-time numbers must reflect the snapshot the worker
serves, so we refuse to cache it here even though the app normally fetches it
from the `transit-data-proxy` Worker.

## Local dev — the `/data` proxy

`vite.config.ts` adds a dev-only `server.proxy` so the app can fetch relative
`/data/*` URLs locally without CORS or a hardcoded origin:

```
/data/v1/stm/manifest.json  ->  https://transit.yesid.dev/data/v1/stm/manifest.json
```

The `/data` prefix is preserved because it is part of the worker route. This is
**dev only** — Vite's `server.proxy` does not run in the deployed Worker.
Production resolves `/data/*` at the zone-route level, and SSR reads through the
`DATA` service binding.

## Develop lane

`develop` deploys to the Wrangler `dev` environment:

- Worker name: `transit-web-dev`
- Domain: `dev.transit.yesid.dev` as a Workers Custom Domain, so Cloudflare
  manages the exact-host edge certificate for this nested subdomain
- Indexing: disabled (`PUBLIC_INDEXING=false`, static `robots.txt` disallows
  crawlers, and `sitemap.xml` emits an empty urlset)
- Data: read-only production `/v1` snapshots via
  `https://transit.yesid.dev/data/v1`

This lane is for web/UI integration and smoke checks. Do not add a separate dev
snapshot bucket until a data-contract slice actually needs one.

## Open Graph cards

`scripts/build-og.ts` renders `static/og/en.png` and `static/og/fr.png`
(1200×630) from vendored TTFs in `scripts/og-fonts/`. Run `bun scripts/build-og.ts`
to regenerate (or `--check` in CI to fail on drift). `SeoHead.svelte` points
`og:image` at `/og/{lang}.png`; those assets are served static with the `/og/*`
TTL above.
