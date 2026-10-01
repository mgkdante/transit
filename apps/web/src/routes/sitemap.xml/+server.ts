import type { RequestHandler } from './$types';
import { readPublicSiteConfig } from '$lib/site/config';
import { buildSitemapXml, type SitemapEntities } from '$lib/site/seoFiles';
import { getRoutesIndex, getStopsIndex } from '$lib/v1/repositories/static';
import { serverV1Context } from '$lib/v1/serverContext';

export const prerender = false;

const SITEMAP_CACHE_CONTROL = 'public, max-age=3600, s-maxage=14400';

export const GET: RequestHandler = async (event) => {
	const { platform } = event;
	const config = readPublicSiteConfig();
	const hasSnapshotTransport = Boolean(platform?.env?.SNAPSHOTS || platform?.env?.DATA);

	let entities: SitemapEntities = {};
	if (hasSnapshotTransport && config.indexing) {
		try {
			const ctx = serverV1Context(event);
			const [routes, stops] = await Promise.all([getRoutesIndex(ctx), getStopsIndex(ctx)]);
			const staticLastmod = routes.generated_utc ?? stops.generated_utc ?? null;
			entities = {
				routeIds: routes.routes.map((r) => r.id),
				stopIds: stops.stops.map((s) => s.id),
				entityLastmod: staticLastmod,
				staticLastmod,
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
