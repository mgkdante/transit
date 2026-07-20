# Cloudflare deploy notes — Transit web

How the SvelteKit app deploys to Cloudflare and how it talks to the `/v1`
snapshot contract. Operational truth lives in the Transit Notion subtree
(Runtime / Architecture); this file is the in-repo quick reference for the
serving glue that ships in `apps/web/`.

## Topology

- **App**: SvelteKit + `@sveltejs/adapter-cloudflare`, deployed as a
  Cloudflare Worker with static assets. Production is
  `https://transit.yesid.dev`; the develop lane is
  `https://dev.transit.yesid.dev`.
- **Data**: bulk browser reads use the R2 custom domain
  `https://data.yesid.dev/v1`. The web Worker also has a direct `SNAPSHOTS` R2
  binding for SSR. This keeps normal page traffic off the metered data-proxy
  Worker while preserving the same published object contract.
- **Compatibility/API Worker**: `transit.yesid.dev/data/*` remains available for
  old links, and `transit.yesid.dev/api/v1/*` continues to serve computed public
  endpoints. It is fallback transport, not the primary bulk-read path.
- **Develop data**: `dev.transit.yesid.dev` deliberately reads the production
  `/v1` snapshot contract read-only for now (`PUBLIC_V1_BASE` points at
  `https://data.yesid.dev/v1`). That gives the web lane a real staging
  host without duplicating the data pipeline before a schema-contract change
  needs it.

## `_routes.json` — generated, do not hand-write

`adapter-cloudflare` **auto-generates `_routes.json`** at build time. It decides
which paths invoke the SvelteKit Worker (SSR / dynamic) vs. which are served as
static assets straight from the edge. We do not commit a hand-written
`_routes.json`.

What that means for the relevant paths:

- `/_app/immutable/*`, `/og/*`, `/favicon.svg`, `/fonts/*` — **static assets**.
  The adapter excludes static files from the Worker invocation automatically, so
  these are served from the edge and pick up the rules in `static/_headers`.
- `/data/*` — **must NOT be routed to this app at all**. It is the compatibility
  route owned by `transit-data-proxy`. In production Cloudflare's more-specific
  `transit.yesid.dev/data/*` route wins over the app route
  `transit.yesid.dev/*`. There is **no `/data` route in `src/routes/`**, so the
  adapter will not emit a Worker entry for it — but if a `/data` route is ever
  added, it must be added to the adapter's `routes.exclude` in `svelte.config.js`
  so the app Worker cannot swallow the data origin.

### If you ever need explicit excludes

`svelte.config.js` can pass excludes to the adapter:

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

**`/data/*` is never cached by the web app.** It is only the compatibility route.
The primary R2 objects carry their publisher-assigned freshness headers. R2 CORS
is applied from `apps/data-proxy/r2-cors.json` before web deploys.

## Local dev — the `/data` proxy

`vite.config.ts` adds a dev-only `server.proxy` so local relative `/data/*`
requests reach the direct R2 custom domain:

```
/data/v1/stm/manifest.json  ->  https://data.yesid.dev/v1/stm/manifest.json
```

The local `/data` prefix is removed before the R2 request. This is **dev only**.
Production browser reads use the absolute R2 custom-domain base, while SSR reads
through the `SNAPSHOTS` binding and falls back to `DATA` only if needed.

## Develop lane

`develop` deploys to the Wrangler `dev` environment:

- Worker name: `transit-web-dev`
- Domain: `dev.transit.yesid.dev` as a Workers Custom Domain, so Cloudflare
  manages the exact-host edge certificate for this nested subdomain
- Indexing: disabled (`PUBLIC_INDEXING=false`, static `robots.txt` disallows
  crawlers, and `sitemap.xml` emits an empty urlset)
- Data: read-only production `/v1` snapshots via `https://data.yesid.dev/v1`

This lane is for web/UI integration and smoke checks. Do not add a separate dev
snapshot bucket until a data-contract slice actually needs one.

## Direct-R2 cache verification

The publisher uses these values before republishing a snapshot:

```text
SNAPSHOT_PUBLIC_BASE_URL=https://data.yesid.dev
SNAPSHOT_BASEMAP_PMTILES_URL=https://data.yesid.dev/v1/stm/static/basemap/montreal.pmtiles
```

The first value controls absolute `/v1` descriptor URLs. The second controls the
high-volume PMTiles archive URL stored inside `static/basemap.json`. Updating
only the first still leaves map range traffic on the compatibility Worker.

R2 custom domains do not cache JSON by file type automatically. To minimize R2
Class B reads, keep a Cache Rule for `data.yesid.dev/v1/*.json` that makes the
responses cache-eligible while respecting the publisher's `Cache-Control`, and
enable Smart Tiered Cache for the custom domain. After a CORS, publisher, or
cache-policy change, verify with two identical public requests: the second
response should report `CF-Cache-Status: HIT` and a positive `Age`.

## Open Graph cards

`scripts/build-og.ts` renders `static/og/en.png` and `static/og/fr.png`
(1200×630) from vendored TTFs in `scripts/og-fonts/`. Run `bun scripts/build-og.ts`
to regenerate (or `--check` in CI to fail on drift). `SeoHead.svelte` points
`og:image` at `/og/{lang}.png`; those assets are served static with the `/og/*`
TTL above.
