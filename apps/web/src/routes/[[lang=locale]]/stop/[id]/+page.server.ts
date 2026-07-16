import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canonicalDetailTabLocation } from '$lib/site/detailTabs';
import { getStop } from '$lib/v1';
import { serverV1Context, type IdentitySeed } from '$lib/v1/serverContext';

export const load: PageServerLoad = async (event) => {
	const canonicalLocation = canonicalDetailTabLocation(event.url);
	if (canonicalLocation) redirect(308, canonicalLocation);

	const id = event.params.id.trim() || event.params.id;
	const fallback: IdentitySeed = { id, name: id };

	try {
		const stop = await getStop(id, serverV1Context(event));
		const name = stop?.name.trim();
		return {
			seed: name ? { id, name } : fallback,
			stopSeed: { key: id, data: stop },
		};
	} catch {
		return { seed: fallback, stopSeed: null };
	}
};
