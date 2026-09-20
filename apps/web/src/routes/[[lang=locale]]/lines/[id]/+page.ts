import type { PageLoad } from './$types';
import { detailTabFromSearchParams } from '$lib/site/detailTabs';

export const load: PageLoad = async ({ data, url }) => {
	// Universal data can carry the constructor on both sides of hydration without serializing it.
	let initialClusters;
	let initialImportFailed = false;
	const explicitRange =
		url.searchParams.has('from') ||
		url.searchParams.has('to') ||
		url.searchParams.get('grain') === 'range';
	// Corrections and optional-index fallback remain owned by the existing client coordinator.
	const settledSelection = !explicitRange || data.lineHistorySeed?.result != null;
	const grain = url.searchParams.get('grain');
	const settledGrain =
		explicitRange ||
		(grain !== 'week' && grain !== 'month') ||
		data.reliabilitySeed?.data?.periods?.some((period) => period.grain === grain);
	if (
		detailTabFromSearchParams(url.searchParams) === 'reliability' &&
		settledSelection &&
		settledGrain
	) {
		try {
			initialClusters = (
				await import('$lib/features/lines/reliability/RouteReliabilityClusters.svelte')
			).default;
		} catch {
			initialImportFailed = true;
		}
	}
	return { ...data, initialClusters, initialImportFailed };
};
