import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canonicalDetailTabLocation, detailTabFromSearchParams } from '$lib/site/detailTabs';
import { historyRangeRequestFromSearchParams } from '$lib/v1/history/rangeResource.svelte';
import { loadLineHistorySeed } from '$lib/features/lines/reliability/data/lineHistoryResource.svelte';
import { getRouteReliability } from '$lib/v1/repositories/historic';
import { getRoute } from '$lib/v1/repositories/static';
import { serverV1Context, type IdentitySeed } from '$lib/v1/serverContext';

export const load: PageServerLoad = async (event) => {
	const canonicalLocation = canonicalDetailTabLocation(event.url);
	if (canonicalLocation) redirect(308, canonicalLocation);

	const id = event.params.id.trim() || event.params.id;
	const fallback: IdentitySeed = { id, name: id };
	const context = serverV1Context(event);
	const request = historyRangeRequestFromSearchParams(event.url.searchParams);
	const selectedHistory =
		detailTabFromSearchParams(event.url.searchParams) === 'reliability' &&
		(request.hasFrom || request.hasTo);
	const [routeResult, reliabilityResult, historyResult] = await Promise.allSettled([
		getRoute(id, context),
		getRouteReliability(id, context),
		selectedHistory
			? loadLineHistorySeed(id, request, { ...context, signal: event.request.signal })
			: Promise.resolve(null),
	]);
	const route = routeResult.status === 'fulfilled' ? routeResult.value : undefined;
	const longName = route?.long?.trim();

	return {
		seed: longName ? { id, name: `${id} ${longName}` } : fallback,
		routeSeed: routeResult.status === 'fulfilled' ? { key: id, data: routeResult.value } : null,
		reliabilitySeed:
			reliabilityResult.status === 'fulfilled' ? { key: id, data: reliabilityResult.value } : null,
		lineHistorySeed:
			historyResult.status === 'fulfilled' && historyResult.value?.result != null
				? historyResult.value
				: null,
	};
};
