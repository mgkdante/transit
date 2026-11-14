import { createRetainedHistoryResource } from '#lib/v1/history/retainedHistoryResource.svelte.ts';
import { getStopHistoryIndex, loadStopHistoryRange } from '#lib/v1/repositories/historic.ts';
import type {
	HistoricAvailabilityIndex,
	HistoricCollectionIndex,
	HistoryRangeResource,
	RawHistoryRangeRequest,
} from '#lib/v1/index.ts';
import { buildRetainedStopHistory, type RetainedStopHistory } from './retainedHistory';

export type StopHistoryResource = HistoryRangeResource<
	HistoricCollectionIndex,
	RetainedStopHistory
> & { readonly rootIndex?: HistoricAvailabilityIndex | null };

export function createStopHistoryResource(
	entityId: string,
	initialRequest: RawHistoryRangeRequest,
): StopHistoryResource {
	let rootIndex = $state.raw<HistoricAvailabilityIndex | null>(null);
	const history = createRetainedHistoryResource({
		initialRequest,
		missingSelectionError: 'stop history range requires a resolved selection',
		loadIndex: (signal) =>
			getStopHistoryIndex(entityId, { signal }, (root) => {
				rootIndex = root;
			}),
		loadRange: (index, selection, signal) =>
			loadStopHistoryRange(entityId, index, selection, { signal }),
		build: (index, partitions, selection) =>
			buildRetainedStopHistory(entityId, index, partitions, selection),
	});
	return Object.defineProperty(history, 'rootIndex', { get: () => rootIndex });
}
