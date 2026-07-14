import {
	availabilityFromCollectionIndex,
	createHistoryRangeResource,
	defaultWindowFromCollectionIndex,
	getNetworkHistoryIndex,
	loadNetworkHistoryRange,
	type HistoryRangeResource,
	type RawHistoryRangeRequest,
} from '$lib/v1';
import type { HistoricCollectionIndex } from '$lib/v1/schemas/history';
import { buildRetainedNetworkTrend, type RetainedNetworkTrend } from './retainedTrend';

export type NetworkHistoryResource = HistoryRangeResource<
	HistoricCollectionIndex,
	RetainedNetworkTrend
>;

export function createNetworkHistoryResource(
	initialRequest: RawHistoryRangeRequest,
): NetworkHistoryResource {
	return createHistoryRangeResource(
		{
			loadIndex: (signal) => getNetworkHistoryIndex({ signal }),
			availability: availabilityFromCollectionIndex,
			defaultWindow: defaultWindowFromCollectionIndex,
			load: async (resolved, index, signal) => {
				if (resolved.selection === null) {
					throw new RangeError('network history range requires a resolved selection');
				}
				const partitions = await loadNetworkHistoryRange(index, resolved.selection, { signal });
				return buildRetainedNetworkTrend(index, partitions, resolved.selection);
			},
		},
		{ initialRequest },
	);
}
