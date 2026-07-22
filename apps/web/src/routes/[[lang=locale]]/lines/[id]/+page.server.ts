import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canonicalDetailTabLocation } from '$lib/site/detailTabs';
import { getRoute } from '$lib/v1/repositories/static';
import { serverV1Context, type IdentitySeed } from '$lib/v1/serverContext';

export const load: PageServerLoad = async (event) => {
	const canonicalLocation = canonicalDetailTabLocation(event.url);
	if (canonicalLocation) redirect(308, canonicalLocation);

	const id = event.params.id.trim() || event.params.id;
	const fallback: IdentitySeed = { id, name: id };

	try {
		const route = await getRoute(id, serverV1Context(event));
		const longName = route?.long?.trim();
		return {
			seed: longName ? { id, name: `${id} ${longName}` } : fallback,
			routeSeed: { key: id, data: route },
		};
	} catch {
		return { seed: fallback, routeSeed: null };
	}
};
