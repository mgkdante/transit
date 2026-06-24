import type { RequestHandler } from './$types';
import { readPublicSiteConfig } from '$lib/site/config';
import { buildSitemapXml, type SitemapEntities } from '$lib/site/seoFiles';
import { bindingFetch } from '$lib/v1/binding';
import { getRoutesIndex, getStopsIndex } from '$lib/v1';
import type { AdapterCtx } from '$lib/v1/adapter';

// sitemap.xml — DYNAMIC (request-time), not prerendered. It enumerates EVERY
// per-entity URL: the 8 static surfaces PLUS one /lines/<id> and /stop/<id> per
// snapshot entity, in BOTH locales (EN + /fr), with hreflang alternates.
//
// WHY dynamic: the route/stop ids only exist in the published snapshot indexes,
// so they can't be known at build time. We fetch routes_index + stops_index over
// the DATA service binding (same pattern as +layout.server.ts) and feed the ids
// to the PURE buildSitemapXml() in $lib/site/seoFiles.
//
// FAIL-SOFT, two ways (mirrors +layout.server.ts) — NEVER a 500, never an empty
// 200 while static URLs exist:
//   · no binding (local `vite dev` / `vite preview`) → static-only sitemap (the
//     8 surfaces ×2 locales). Local dev therefore shows static-only, by design.
//   · binding present but a fetch/parse throws (data-proxy down / contract gap)
//     → also fall back to static-only.
//
// Cache-Control: sitemaps are crawled infrequently and the index is a daily
// build, so cache a few hours at the edge.
export const prerender = false;

const SITEMAP_CACHE_CONTROL = 'public, max-age=3600, s-maxage=14400';

export const GET: RequestHandler = async ({ url, platform }) => {
	const config = readPublicSiteConfig();
	const binding = platform?.env?.DATA;

	let entities: SitemapEntities = {};
	if (binding && config.indexing) {
		try {
			const ctx: AdapterCtx = {
				fetch: bindingFetch(binding, url.origin),
				cache: new Map<string, unknown>(),
			};
			// Fetch the two discovery indexes in parallel for the id lists. We do NOT
			// fetch the manifest separately: each index loader already loads it
			// internally (for URL resolution), and the static-tier publish time we'd
			// read from `manifest.files.static.generated_utc` is the SAME stamp the
			// indexes carry as `generated_utc`. Sourcing lastmod from the indexes drops
			// a redundant third manifest fetch.
			const [routes, stops] = await Promise.all([getRoutesIndex(ctx), getStopsIndex(ctx)]);
			// Dataset publish time for the entity / static pages. The routes index is the
			// static GTFS dataset, so its `generated_utc` IS the static publish time;
			// never fabricate when absent (buildSitemapXml omits <lastmod>).
			const staticLastmod = routes.generated_utc ?? stops.generated_utc ?? null;
			entities = {
				routeIds: routes.routes.map((r) => r.id),
				stopIds: stops.stops.map((s) => s.id),
				entityLastmod: staticLastmod,
				staticLastmod,
			};
		} catch {
			// Binding present but the index fetch/parse failed — degrade to static-only
			// rather than 500. The 8 surfaces stay crawlable.
			entities = {};
		}
	}

	return new Response(buildSitemapXml(config, entities), {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': SITEMAP_CACHE_CONTROL,
		},
	});
};
