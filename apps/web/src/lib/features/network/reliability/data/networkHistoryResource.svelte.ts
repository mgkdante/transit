import { createRetainedHistoryResource } from '#lib/v1/history/retainedHistoryResource.svelte.ts';
import type {
	HistoryRangeResource,
	RawHistoryRangeRequest,
} from '#lib/v1/history/rangeResource.svelte.ts';
import { getNetworkHistoryIndex, loadNetworkHistoryRange } from '#lib/v1/repositories/historic.ts';
import type { HistoricCollectionIndex } from '#lib/v1/schemas/history.ts';
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
