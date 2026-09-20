import type { DateWindow } from './window';
import type { HistoricCollectionIndex } from '$lib/v1/schemas';
import { availabilityFromCollectionIndex, defaultWindowFromCollectionIndex } from './selection';
import {
	createHistoryRangeResource,
	loadHistoryRangeSeed,
	type HistoryRangeLoadResult,
	type HistoryRangeLoader,
	type HistoryRangeResource,
	type HistoryRangeSeed,
	type RawHistoryRangeRequest,
} from './rangeResource.svelte';

export interface RetainedHistoryResourceOptions<TPartitions, TValue> {
	readonly initialRequest: RawHistoryRangeRequest;
	readonly seed?: () => HistoryRangeSeed<HistoricCollectionIndex, TValue> | undefined;
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

function retainedLoader<TPartitions, TValue>(
	options: RetainedHistoryResourceOptions<TPartitions, TValue>,
): HistoryRangeLoader<HistoricCollectionIndex, TValue> {
	return {
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
	};
}

export function loadRetainedHistorySeed<TPartitions, TValue>(
	options: RetainedHistoryResourceOptions<TPartitions, TValue>,
	signal: AbortSignal,
): Promise<HistoryRangeSeed<HistoricCollectionIndex, TValue>> {
	return loadHistoryRangeSeed(retainedLoader(options), options.initialRequest, signal);
}

export function createRetainedHistoryResource<TPartitions, TValue>(
	options: RetainedHistoryResourceOptions<TPartitions, TValue>,
): HistoryRangeResource<HistoricCollectionIndex, TValue> {
	return createHistoryRangeResource(retainedLoader(options), {
		initialRequest: options.initialRequest,
		seed: options.seed,
	});
}
