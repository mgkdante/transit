import {
	createRetainedHistoryResource,
	loadRetainedHistorySeed,
	type RetainedHistoryResourceOptions,
} from '#lib/v1/history/retainedHistoryResource.svelte.ts';
import type { AdapterCtx } from '#lib/v1/adapter/index.ts';
import { getLineHistoryIndex, loadLineHistoryRange } from '#lib/v1/repositories/historic.ts';
import type {
	HistoricAvailabilityIndex,
	HistoricCollectionIndex,
	HistoryRangeResource,
	HistoryRangeSeed,
	LineHistoryPartition,
	RawHistoryRangeRequest,
} from '#lib/v1/index.ts';
import { buildRetainedLineHistory, type RetainedLineHistory } from './retainedHistory';

export type LineHistoryResource = HistoryRangeResource<
	HistoricCollectionIndex,
	RetainedLineHistory
> & { readonly rootIndex?: HistoricAvailabilityIndex | null };

export interface LineHistorySeed extends HistoryRangeSeed<
	HistoricCollectionIndex,
	RetainedLineHistory
> {
	readonly entityId: string;
	readonly rootIndex?: HistoricAvailabilityIndex | null;
}

function lineHistoryOptions(
	entityId: string,
	initialRequest: RawHistoryRangeRequest,
	ctx?: AdapterCtx,
	onRoot?: (root: HistoricAvailabilityIndex | null) => void,
): RetainedHistoryResourceOptions<LineHistoryPartition[], RetainedLineHistory> {
	return {
		initialRequest,
		missingSelectionError: 'line history range requires a resolved selection',
		loadIndex: (signal) => getLineHistoryIndex(entityId, { ...ctx, signal }, onRoot),
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
	let rootIndex: HistoricAvailabilityIndex | null = null;
	const seed = await loadRetainedHistorySeed(
		lineHistoryOptions(entityId, request, ctx, (root) => {
			rootIndex = root;
		}),
		ctx.signal ?? new AbortController().signal,
	);
	return { entityId, ...seed, rootIndex };
}

export function createLineHistoryResource(
	entityId: string,
	initialRequest: RawHistoryRangeRequest,
	seed?: () => LineHistorySeed | undefined,
): LineHistoryResource {
	let rootIndex = $state.raw<HistoricAvailabilityIndex | null>(
		seed?.()?.entityId === entityId ? (seed?.()?.rootIndex ?? null) : null,
	);
	const history = createRetainedHistoryResource({
		...lineHistoryOptions(entityId, initialRequest, undefined, (root) => {
			rootIndex = root;
		}),
		seed: () => {
			const candidate = seed?.();
			return candidate?.entityId === entityId ? candidate : undefined;
		},
	});
	return Object.defineProperty(history, 'rootIndex', { get: () => rootIndex });
}
