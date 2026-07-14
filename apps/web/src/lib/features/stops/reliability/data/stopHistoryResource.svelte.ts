import {
	availabilityFromCollectionIndex,
	createHistoryRangeResource,
	defaultWindowFromCollectionIndex,
	getStopHistoryIndex,
	loadStopHistoryRange,
	type HistoricCollectionIndex,
	type HistoryRangeResource,
	type RawHistoryRangeRequest,
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
	return createHistoryRangeResource(
		{
			loadIndex: (signal) => getStopHistoryIndex(entityId, { signal }),
			availability: availabilityFromCollectionIndex,
			defaultWindow: defaultWindowFromCollectionIndex,
			load: async (resolved, index, signal) => {
				if (resolved.selection === null) {
					throw new RangeError('stop history range requires a resolved selection');
				}
				const partitions = await loadStopHistoryRange(entityId, index, resolved.selection, {
					signal,
				});
				return buildRetainedStopHistory(entityId, index, partitions, resolved.selection);
			},
		},
		{ initialRequest },
	);
}
