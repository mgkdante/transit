import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStopsIndex } from '$lib/v1/repositories/static';
import { toSlimStopsIndex } from '$lib/v1/repositories/stopsSlim';
import { serverV1Context } from '$lib/v1/serverContext';

export const prerender = false;

export const GET: RequestHandler = async (event) => {
	try {
		const slim = toSlimStopsIndex(await getStopsIndex(serverV1Context(event)));
		return json(slim, {
			headers: {
				'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
			},
		});
	} catch {
		return json({ error: 'stops_index_unavailable' }, { status: 503 });
	}
};
