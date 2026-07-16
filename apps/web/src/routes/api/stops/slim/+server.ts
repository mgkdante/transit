import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStopsIndex } from '$lib/v1/repositories/static';
import { toSlimStopsIndex } from '$lib/v1/repositories/stopsSlim';
import { serverV1Context } from '$lib/v1/serverContext';

export const prerender = false;

// GET /api/stops/slim — the slim stops-index fast-path (§C8 item 3).
//
// Projects the full `stops_index.json` (1.15 MB) down to {id,name,lat,lon,code}
// SERVER-SIDE so the map/near-me client pays a fraction of the payload + parse.
// Drops the bulky per-stop `mode` + `routes[]` reverse index (which only /stops +
// /search render). The full catalogue is still one page-load away via
// `getStopsIndex`; this endpoint never fabricates data — a fetch failure surfaces
// as 503 and the client repo (`getStopsIndexSlim`) fails soft to a client-side
// projection of the full index, so the map always resolves every stop.
//
// Reads through the shared server context: direct R2 binding in production,
// compatibility DATA binding only as fallback, and event.fetch in local dev.
export const GET: RequestHandler = async (event) => {
	try {
		const slim = toSlimStopsIndex(await getStopsIndex(serverV1Context(event)));
		return json(slim, {
			headers: {
				// Static tier (daily republish). Cache at the edge + browser; SWR keeps a
				// stale copy serving while a fresh one is fetched after a deploy.
				'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
			},
		});
	} catch {
		// Upstream snapshot unreachable — the client falls back to the full index.
		return json({ error: 'stops_index_unavailable' }, { status: 503 });
	}
};
