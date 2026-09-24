import {
	createRetainedHistoryResource,
	loadRetainedHistorySeed,
	type RetainedHistoryResourceOptions,
} from '$lib/v1/history/retainedHistoryResource.svelte';
import type { AdapterCtx } from '$lib/v1/adapter';
import { getLineHistoryIndex, loadLineHistoryRange } from '$lib/v1/repositories/historic';
import type {
	HistoricCollectionIndex,
	HistoryRangeResource,
	HistoryRangeSeed,
	LineHistoryPartition,
	RawHistoryRangeRequest,
} from '$lib/v1';
import { buildRetainedLineHistory, type RetainedLineHistory } from './retainedHistory';

export type LineHistoryResource = HistoryRangeResource<
	HistoricCollectionIndex,
	RetainedLineHistory
>;

export interface LineHistorySeed extends HistoryRangeSeed<
	HistoricCollectionIndex,
	RetainedLineHistory
> {
	readonly entityId: string;
}

function lineHistoryOptions(
	entityId: string,
	initialRequest: RawHistoryRangeRequest,
	ctx?: AdapterCtx,
): RetainedHistoryResourceOptions<LineHistoryPartition[], RetainedLineHistory> {
	return {
		initialRequest,
		missingSelectionError: 'line history range requires a resolved selection',
		loadIndex: (signal) => getLineHistoryIndex(entityId, { ...ctx, signal }),
		loadRange: (index, selection, signal) =>
			loadLineHistoryRange(entityId, index, selection, { ...ctx, signal }),
		build: (index, partitions, selection) =>
			buildRetainedLineHistory(entityId, index, partitions, selection),
	};
}

export async function loadLineHistorySeed(
	entityId: string,
	request: RawHistoryRangeRequest,
	ctx: AdapterCtx,
): Promise<LineHistorySeed> {
	const seed = await loadRetainedHistorySeed(
		lineHistoryOptions(entityId, request, ctx),
		ctx.signal ?? new AbortController().signal,
	);
	return { entityId, ...seed };
}

export function createLineHistoryResource(
	entityId: string,
	initialRequest: RawHistoryRangeRequest,
	seed?: () => LineHistorySeed | undefined,
): LineHistoryResource {
	return createRetainedHistoryResource({
		...lineHistoryOptions(entityId, initialRequest),
		seed: () => {
			const candidate = seed?.();
			return candidate?.entityId === entityId ? candidate : undefined;
		},
	});
}
