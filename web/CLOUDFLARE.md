# Cloudflare deploy notes — transit web (slice-9.2 P5)

How the SvelteKit app deploys to Cloudflare and how it talks to the `/v1`
snapshot contract. Operational truth lives in the Transit Notion subtree
(Runtime / Architecture); this file is the in-repo quick reference for the
serving glue that ships in `web/`.

## Topology

- **App**: SvelteKit + `@sveltejs/adapter-cloudflare`, deployed to Cloudflare
  (Pages-style Workers integration). Hosted at `https://transit.yesid.dev`.
- **Data**: the `/v1` snapshot contract is published to Cloudflare R2 and served
  by a **separate zone-route Worker on `data.yesid.dev`**. The app NEVER bundles
  or co-hosts the snapshot JSON — the snapshot-contract firewall (slice-9 plan)
  keeps the pipeline output behind its own origin with its own freshness rules.

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
  `data.yesid.dev` Worker. In production the app fetches the snapshot from that
  origin (or a same-origin route bound to it at the zone level), not from a
  SvelteKit route. There is **no `/data` route in `src/routes/`**, so the adapter
  will not emit a Worker entry for it — but if a `/data` route is ever added,
  it must be added to the adapter's `routes.exclude` in `svelte.config.js` so the
  edge serves it (or 404s) instead of the SvelteKit Worker swallowing it.

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
from the `data.yesid.dev` origin.

## Local dev — the `/data` proxy

`vite.config.ts` adds a dev-only `server.proxy` so the app can fetch relative
`/data/*` URLs locally without CORS or a hardcoded origin:

```
/data/network.json  ->  https://data.yesid.dev/v1/network.json
```

The `/data` prefix is stripped and the request is forwarded to the worker's
`/v1` base. This is **dev only** — Vite's `server.proxy` does not run in the
deployed Worker. Production resolves `/data/*` at the zone/origin level (the
`data.yesid.dev` worker), matching the dev shape exactly.

## Open Graph cards

`scripts/build-og.ts` renders `static/og/en.png` and `static/og/fr.png`
(1200×630) from vendored TTFs in `scripts/og-fonts/`. Run `tsx scripts/build-og.ts`
to regenerate (or `--check` in CI to fail on drift). `SeoHead.svelte` points
`og:image` at `/og/{lang}.png`; those assets are served static with the `/og/*`
TTL above.
