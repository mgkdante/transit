import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canonicalDetailTabLocation } from '$lib/site/detailTabs';
import { getRouteReliability } from '$lib/v1/repositories/historic';
import { getRoute } from '$lib/v1/repositories/static';
import { serverV1Context, type IdentitySeed } from '$lib/v1/serverContext';

export const load: PageServerLoad = async (event) => {
	const canonicalLocation = canonicalDetailTabLocation(event.url);
	if (canonicalLocation) redirect(308, canonicalLocation);

	const id = event.params.id.trim() || event.params.id;
	const fallback: IdentitySeed = { id, name: id };
	const context = serverV1Context(event);
	const [routeResult, reliabilityResult] = await Promise.allSettled([
		getRoute(id, context),
		getRouteReliability(id, context),
	]);
	const route = routeResult.status === 'fulfilled' ? routeResult.value : undefined;
	const longName = route?.long?.trim();

	return {
		seed: longName ? { id, name: `${id} ${longName}` } : fallback,
		routeSeed: routeResult.status === 'fulfilled' ? { key: id, data: routeResult.value } : null,
		reliabilitySeed:
			reliabilityResult.status === 'fulfilled' ? { key: id, data: reliabilityResult.value } : null,
	};
};
