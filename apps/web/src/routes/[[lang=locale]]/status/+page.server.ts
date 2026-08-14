import type { PageServerLoad } from './$types';
import { getDataHealth } from '$lib/v1/repositories/dataHealth';
import { getHistoricAvailability } from '$lib/v1/repositories/historic';
import { getProvenance } from '$lib/v1/repositories/provenance';
import { serverV1Context } from '$lib/v1/serverContext';

export const load: PageServerLoad = async (event) => {
	const context = serverV1Context(event);
	const [provenanceResult, dataHealthResult, historicAvailabilityResult] =
		await Promise.allSettled([
			getProvenance(context),
			getDataHealth(context),
			getHistoricAvailability(context),
		]);

	return {
		provenanceSeed:
			provenanceResult.status === 'fulfilled'
				? { key: 'provenance', data: provenanceResult.value }
				: null,
		dataHealthSeed:
			dataHealthResult.status === 'fulfilled'
				? { key: 'data-health', data: dataHealthResult.value }
				: null,
		historicAvailabilitySeed:
			historicAvailabilityResult.status === 'fulfilled'
				? { key: 'historic-availability', data: historicAvailabilityResult.value }
				: null,
	};
};
