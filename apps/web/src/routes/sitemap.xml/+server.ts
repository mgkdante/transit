import type { RequestHandler } from './$types';
import { readPublicSiteConfig } from '$lib/site/config';
import { buildSitemapXml, type SitemapEntities } from '$lib/site/seoFiles';
import { getRoutesIndex, getStopsIndex } from '$lib/v1/repositories/static';
import { serverV1Context } from '$lib/v1/serverContext';
import { loadProviderCatalog, resolveProvider } from '$lib/v1/providers';

export const prerender = false;

const SITEMAP_CACHE_CONTROL = 'public, max-age=3600, s-maxage=14400';

export const GET: RequestHandler = async (event) => {
	const { platform } = event;
	const config = readPublicSiteConfig();
	const hasSnapshotTransport = Boolean(platform?.env?.SNAPSHOTS || platform?.env?.DATA);

	let entities: SitemapEntities = {};
	if (hasSnapshotTransport && config.indexing) {
		try {
			const initial = serverV1Context(event);
			const catalog = await loadProviderCatalog(initial.fetch ?? event.fetch);
			const selected = resolveProvider(event.url, catalog);
			if (selected.url.href !== event.url.href)
				return new Response(null, {
					status: 307,
					headers: { location: selected.url.pathname + selected.url.search },
				});
			const ctx = { ...initial, providerId: selected.provider.id };
			const [routes, stops] = await Promise.all([getRoutesIndex(ctx), getStopsIndex(ctx)]);
			const staticLastmod = routes.generated_utc ?? stops.generated_utc ?? null;
			entities = {
				routeIds: routes.routes.map((r) => r.id),
				stopIds: stops.stops.map((s) => s.id),
				entityLastmod: staticLastmod,
				staticLastmod,
				providerId: event.url.searchParams.has('provider') ? selected.provider.id : undefined,
			};
		} catch {
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
