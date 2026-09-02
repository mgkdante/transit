# Cloudflare Worker deployment

The Transit citizen app is a SvelteKit Cloudflare Worker with Workers Static
Assets. [`wrangler.toml`](wrangler.toml) owns the Worker names, routes, bindings,
public variables, and asset directory. [`_headers`](_headers) owns response
headers for static assets at the app root.

The build emits `.svelte-kit/cloudflare/_worker.js` plus its static asset tree.
Cloudflare routing comes from `wrangler.toml` and zone-route specificity; the
adapter does not own a separate route manifest in this deployment mode.

## Deployment shape

| Lane | Worker | Host | Data |
| --- | --- | --- | --- |
| Production | `transit-web` | `transit.yesid.dev/*` zone route | Browser: `https://data.yesid.dev/v1`; SSR: `SNAPSHOTS` R2 binding, then `DATA` service fallback |
| Development | `transit-web-dev` | `dev.transit.yesid.dev` custom domain | Same read-only production `/v1` snapshot contract |

`[assets]` binds `ASSETS` to `.svelte-kit/cloudflare`. `SNAPSHOTS` binds the
`transit-snapshots` bucket for server reads, and `DATA` binds the
`transit-data-proxy` service for compatibility fallback. Production disables
the public `workers.dev` URL.

## Route ownership

Cloudflare selects the most specific matching zone route:

| Request | Owner |
| --- | --- |
| `transit.yesid.dev/data/*` | `transit-data-proxy` compatibility snapshot route |
| `transit.yesid.dev/api/v1/*` | `transit-data-proxy` public v1 API |
| `transit.yesid.dev/*` | SvelteKit web Worker |
| Other web `/api/*`, including `/api/vitals`, `/api/geocode/*`, and `/api/stops/*` | SvelteKit web Worker |
| `data.yesid.dev/v1/*` | Public R2 custom domain |

The narrow data and v1 API routes therefore beat the web catch-all. Keep them
in [`../data-proxy/wrangler.toml`](../data-proxy/wrangler.toml); adding a
SvelteKit `/data` route would create competing ownership and is not supported.

Local Vite development proxies `/data/v1/*` to `data.yesid.dev/v1/*`. Production
browser reads use the absolute R2 custom-domain base. Server loaders prefer the
direct bucket binding and use `DATA` only when the direct read fails with an
eligible non-cancellation error.

## Headers, caching, and CORS

The root [`_headers`](_headers) file owns the project asset rules. The adapter
copies it into the build and appends its generated `/_app/*` rules. SvelteKit
documents receive the matching security policy from `src/hooks.server.ts`;
`src/lib/site/securityHeaders.ts` and its tests keep the two paths aligned.

| Path | Cache policy |
| --- | --- |
| `/_app/immutable/*`, `/fonts/*` | One year, immutable |
| `/og/*` | One hour browser, one day shared, one week stale-while-revalidate |
| `/favicon.svg` | One week |
| `/service-worker.js` | Revalidate on every request |
| `/sw-kill.json`, `/data/*` | No store |
| `/offline.html` | One hour |

The web Worker does not set snapshot freshness for the direct R2 origin.
Publisher object metadata and Cloudflare cache rules own it. Public R2 CORS is
defined in [`../data-proxy/r2-cors.json`](../data-proxy/r2-cors.json) and allows
read-only `GET`/`HEAD` access, range and conditional request headers, and the
response headers needed for cache and range verification. The deploy workflow
applies that policy before either web lane is deployed.

## Build, deploy, and verify

Install the shared workspace once from the repository root, then validate the
web package:

```bash
bun install
cd apps/web
bun run check
bun run test
bun run build
bunx wrangler@4.100.0 deploy --dry-run --env=""
```

[`../../.github/workflows/web.yml`](../../.github/workflows/web.yml) is the
release path. It applies R2 CORS, builds with the lane's public variables, and
then deploys with one of these commands:

```bash
bunx wrangler@4.100.0 deploy --env dev
bunx wrangler@4.100.0 deploy --env=""
```

Development deploys from `develop` or an explicit dev dispatch. Production
deploys from `main` or an explicit production dispatch on `main`. After a
production deploy, run the shared route smoke from `apps/data-proxy`:

```bash
bash smoke.sh
```

That smoke proves `/data/*` and `/api/v1/*` still reach the data worker and that
web-owned API paths have not been intercepted.
