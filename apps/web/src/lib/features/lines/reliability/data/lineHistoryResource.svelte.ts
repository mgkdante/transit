import {
	availabilityFromCollectionIndex,
	createHistoryRangeResource,
	defaultWindowFromCollectionIndex,
	getLineHistoryIndex,
	loadLineHistoryRange,
	type HistoricCollectionIndex,
	type HistoryRangeResource,
	type RawHistoryRangeRequest,
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
	return createHistoryRangeResource(
		{
			loadIndex: (signal) => getLineHistoryIndex(entityId, { signal }),
			availability: availabilityFromCollectionIndex,
			defaultWindow: defaultWindowFromCollectionIndex,
			load: async (resolved, index, signal) => {
				if (resolved.selection === null) {
					throw new RangeError('line history range requires a resolved selection');
				}
				const partitions = await loadLineHistoryRange(entityId, index, resolved.selection, {
					signal,
				});
				return buildRetainedLineHistory(entityId, index, partitions, resolved.selection);
			},
		},
		{ initialRequest },
	);
}
