import type { PageServerLoad } from './$types';
import { getNetworkTrend } from '$lib/v1/repositories/historic';
import { getNetwork } from '$lib/v1/repositories/live';
import { getProvenance } from '$lib/v1/repositories/provenance';
import { serverV1Context } from '$lib/v1/serverContext';

export const load: PageServerLoad = async (event) => {
	const context = serverV1Context(event);
	const [networkResult, trendResult, provenanceResult] = await Promise.allSettled([
		getNetwork(context),
		getNetworkTrend(context),
		getProvenance(context),
	]);

	return {
		networkSeed: networkResult.status === 'fulfilled' ? networkResult.value : null,
		trendSeed:
			trendResult.status === 'fulfilled' ? { key: 'network-trend', data: trendResult.value } : null,
		provenanceSeed:
			provenanceResult.status === 'fulfilled'
				? { key: 'provenance', data: provenanceResult.value }
				: null,
	};
};
