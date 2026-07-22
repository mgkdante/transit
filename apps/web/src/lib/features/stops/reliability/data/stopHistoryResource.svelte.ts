import { createRetainedHistoryResource } from '$lib/v1/history/retainedHistoryResource.svelte';
import { getStopHistoryIndex, loadStopHistoryRange } from '$lib/v1/repositories/historic';
import type {
	HistoricCollectionIndex,
	HistoryRangeResource,
	RawHistoryRangeRequest,
} from '$lib/v1';
import { buildRetainedStopHistory, type RetainedStopHistory } from './retainedHistory';

export type StopHistoryResource = HistoryRangeResource<
	HistoricCollectionIndex,
	RetainedStopHistory
>;

export function createStopHistoryResource(
	entityId: string,
	initialRequest: RawHistoryRangeRequest,
): StopHistoryResource {
	return createRetainedHistoryResource({
		initialRequest,
		missingSelectionError: 'stop history range requires a resolved selection',
		loadIndex: (signal) => getStopHistoryIndex(entityId, { signal }),
		loadRange: (index, selection, signal) =>
			loadStopHistoryRange(entityId, index, selection, { signal }),
		build: (index, partitions, selection) =>
			buildRetainedStopHistory(entityId, index, partitions, selection),
	});
}
