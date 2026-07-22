import { createRetainedHistoryResource } from '$lib/v1/history/retainedHistoryResource.svelte';
import { getLineHistoryIndex, loadLineHistoryRange } from '$lib/v1/repositories/historic';
import type {
	HistoricCollectionIndex,
	HistoryRangeResource,
	RawHistoryRangeRequest,
} from '$lib/v1';
import { buildRetainedLineHistory, type RetainedLineHistory } from './retainedHistory';

export type LineHistoryResource = HistoryRangeResource<
	HistoricCollectionIndex,
	RetainedLineHistory
>;

export function createLineHistoryResource(
	entityId: string,
	initialRequest: RawHistoryRangeRequest,
): LineHistoryResource {
	return createRetainedHistoryResource({
		initialRequest,
		missingSelectionError: 'line history range requires a resolved selection',
		loadIndex: (signal) => getLineHistoryIndex(entityId, { signal }),
		loadRange: (index, selection, signal) =>
			loadLineHistoryRange(entityId, index, selection, { signal }),
		build: (index, partitions, selection) =>
			buildRetainedLineHistory(entityId, index, partitions, selection),
	});
}
