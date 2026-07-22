import { createRetainedHistoryResource } from '$lib/v1/history/retainedHistoryResource.svelte';
import type {
	HistoryRangeResource,
	RawHistoryRangeRequest,
} from '$lib/v1/history/rangeResource.svelte';
import { getNetworkHistoryIndex, loadNetworkHistoryRange } from '$lib/v1/repositories/historic';
import type { HistoricCollectionIndex } from '$lib/v1/schemas/history';
import { buildRetainedNetworkTrend, type RetainedNetworkTrend } from './retainedTrend';

export type NetworkHistoryResource = HistoryRangeResource<
	HistoricCollectionIndex,
	RetainedNetworkTrend
>;

export function createNetworkHistoryResource(
	initialRequest: RawHistoryRangeRequest,
): NetworkHistoryResource {
	return createRetainedHistoryResource({
		initialRequest,
		missingSelectionError: 'network history range requires a resolved selection',
		loadIndex: (signal) => getNetworkHistoryIndex({ signal }),
		loadRange: (index, selection, signal) => loadNetworkHistoryRange(index, selection, { signal }),
		build: buildRetainedNetworkTrend,
	});
}
