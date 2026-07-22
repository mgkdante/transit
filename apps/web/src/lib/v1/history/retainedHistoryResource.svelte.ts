import type { DateWindow } from '$lib/filters';
import type { HistoricCollectionIndex } from '$lib/v1/schemas';
import { availabilityFromCollectionIndex, defaultWindowFromCollectionIndex } from './selection';
import {
	createHistoryRangeResource,
	type HistoryRangeLoadResult,
	type HistoryRangeResource,
	type RawHistoryRangeRequest,
} from './rangeResource.svelte';

export interface RetainedHistoryResourceOptions<TPartitions, TValue> {
	readonly initialRequest: RawHistoryRangeRequest;
	readonly missingSelectionError: string;
	loadIndex(signal: AbortSignal): Promise<HistoricCollectionIndex | null>;
	loadRange(
		index: HistoricCollectionIndex,
		selection: DateWindow,
		signal: AbortSignal,
	): Promise<TPartitions>;
	build(
		index: HistoricCollectionIndex,
		partitions: TPartitions,
		selection: DateWindow,
	): HistoryRangeLoadResult<TValue>;
}

export function createRetainedHistoryResource<TPartitions, TValue>(
	options: RetainedHistoryResourceOptions<TPartitions, TValue>,
): HistoryRangeResource<HistoricCollectionIndex, TValue> {
	return createHistoryRangeResource(
		{
			loadIndex: (signal) => options.loadIndex(signal),
			availability: availabilityFromCollectionIndex,
			defaultWindow: defaultWindowFromCollectionIndex,
			load: async (resolved, index, signal) => {
				if (resolved.selection === null) {
					throw new RangeError(options.missingSelectionError);
				}
				const partitions = await options.loadRange(index, resolved.selection, signal);
				return options.build(index, partitions, resolved.selection);
			},
		},
		{ initialRequest: options.initialRequest },
	);
}
