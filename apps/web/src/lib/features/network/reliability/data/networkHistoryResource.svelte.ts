import {
	createRetainedHistoryResource,
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
	return createRetainedHistoryResource({
		initialRequest,
		missingSelectionError: 'network history range requires a resolved selection',
		loadIndex: (signal) => getNetworkHistoryIndex({ signal }),
		loadRange: (index, selection, signal) => loadNetworkHistoryRange(index, selection, { signal }),
		build: buildRetainedNetworkTrend,
	});
}
