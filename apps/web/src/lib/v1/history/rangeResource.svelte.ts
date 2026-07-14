import type { DateWindow } from '$lib/filters';
import { untrack } from 'svelte';
import {
	resolveHistoryRange,
	type HistoryAvailability,
	type ResolvedHistoryRange,
} from './selection';

export interface RawHistoryRangeRequest {
	readonly hasFrom: boolean;
	readonly hasTo: boolean;
	readonly rawFrom: string | null;
	readonly rawTo: string | null;
}

export interface HistoryRangeLoadResult<TValue> {
	readonly value: TValue | null;
	readonly status: 'complete' | 'partial' | 'no_data';
}

export interface HistoryRangeLoader<TIndex, TValue> {
	loadIndex(signal: AbortSignal): Promise<TIndex | null>;
	availability(index: TIndex): HistoryAvailability;
	defaultWindow(index: TIndex): DateWindow;
	load(
		resolved: ResolvedHistoryRange,
		index: TIndex,
		signal: AbortSignal,
	): Promise<HistoryRangeLoadResult<TValue>>;
}

export type HistoryRangeResourceState =
	| 'idle'
	| 'loading-index'
	| 'current'
	| 'loading-range'
	| 'ready'
	| 'partial'
	| 'no-data'
	| 'error';

export interface HistoryRangeResource<TIndex, TValue> {
	readonly request: RawHistoryRangeRequest;
	readonly index: TIndex | null;
	readonly resolved: ResolvedHistoryRange | null;
	readonly value: TValue | null;
	readonly state: HistoryRangeResourceState;
	readonly error: Error | null;
	setRequest(request: RawHistoryRangeRequest): void;
	retry(): void;
	destroy(): void;
}

export interface HistoryRangeResourceOptions {
	readonly initialRequest: RawHistoryRangeRequest;
}

type FailureStage = 'index' | 'range' | null;
type IndexStatus = 'idle' | 'loading' | 'available' | 'missing' | 'failed' | 'aborted';

function snapshotRequest(request: RawHistoryRangeRequest): RawHistoryRangeRequest {
	return {
		hasFrom: request.hasFrom,
		hasTo: request.hasTo,
		rawFrom: request.rawFrom,
		rawTo: request.rawTo,
	};
}

function sameRequest(a: RawHistoryRangeRequest, b: RawHistoryRangeRequest): boolean {
	return (
		a.hasFrom === b.hasFrom && a.hasTo === b.hasTo && a.rawFrom === b.rawFrom && a.rawTo === b.rawTo
	);
}

function isExplicit(request: RawHistoryRangeRequest): boolean {
	return request.hasFrom || request.hasTo;
}

function isAbortError(error: unknown): boolean {
	return (
		typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
	);
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function rangeState(status: HistoryRangeLoadResult<unknown>['status']): HistoryRangeResourceState {
	if (status === 'complete') return 'ready';
	if (status === 'partial') return 'partial';
	return 'no-data';
}

export function historyRangeRequestFromSearchParams(
	params: URLSearchParams,
): RawHistoryRangeRequest {
	return {
		hasFrom: params.has('from'),
		hasTo: params.has('to'),
		rawFrom: params.get('from'),
		rawTo: params.get('to'),
	};
}

export function createHistoryRangeResource<TIndex, TValue>(
	loader: HistoryRangeLoader<TIndex, TValue>,
	options: HistoryRangeResourceOptions,
): HistoryRangeResource<TIndex, TValue> {
	const initialRequest = snapshotRequest(options.initialRequest);
	let request = $state.raw<RawHistoryRangeRequest>(initialRequest);
	let index = $state.raw<TIndex | null>(null);
	let resolved = $state.raw<ResolvedHistoryRange | null>(null);
	let value = $state.raw<TValue | null>(null);
	let state = $state<HistoryRangeResourceState>('idle');
	let error = $state.raw<Error | null>(null);

	let destroyed = false;
	let failureStage: FailureStage = null;
	let indexStatus: IndexStatus = 'idle';
	let indexSequence = 0;
	let rangeSequence = 0;
	let indexIdentity = 0;
	let indexController: AbortController | null = null;
	let rangeController: AbortController | null = null;
	let rangeKey: string | null = null;

	const abortRange = () => {
		rangeSequence += 1;
		rangeController?.abort();
		rangeController = null;
		rangeKey = null;
	};

	const failIndex = (cause: unknown) => {
		if (destroyed) return;
		indexSequence += 1;
		indexController?.abort();
		indexController = null;
		abortRange();
		index = null;
		resolved = null;
		value = null;
		failureStage = 'index';
		indexStatus = 'failed';
		error = toError(cause);
		state = isExplicit(request) ? 'error' : 'current';
	};

	const resolveAgainstIndex = (accepted: TIndex): ResolvedHistoryRange | null => {
		try {
			const availability = loader.availability(accepted);
			if (availability.kind === 'empty') {
				return {
					selection: null,
					canonicalWindow: null,
					intersectingGaps: [],
					correction: null,
				};
			}
			return resolveHistoryRange(
				request.hasFrom ? request.rawFrom : undefined,
				request.hasTo ? request.rawTo : undefined,
				availability,
				loader.defaultWindow(accepted),
			);
		} catch (cause) {
			failIndex(cause);
			return null;
		}
	};

	const startRange = (accepted: TIndex, nextResolved: ResolvedHistoryRange, key: string) => {
		abortRange();
		const token = rangeSequence;
		const controller = new AbortController();
		rangeController = controller;
		rangeKey = key;
		failureStage = null;
		error = null;
		value = null;
		state = 'loading-range';

		let pending: Promise<HistoryRangeLoadResult<TValue>>;
		try {
			pending = loader.load(nextResolved, accepted, controller.signal);
		} catch (cause) {
			if (isAbortError(cause)) {
				controller.abort();
				rangeController = null;
				failureStage = 'range';
				error = null;
				state = 'error';
			} else {
				failureStage = 'range';
				error = toError(cause);
				state = 'error';
			}
			return;
		}

		pending
			.then((result) => {
				if (destroyed || token !== rangeSequence || key !== rangeKey) return;
				value = result.value;
				state = rangeState(result.status);
				error = null;
				failureStage = null;
			})
			.catch((cause) => {
				if (destroyed || token !== rangeSequence || key !== rangeKey) return;
				if (isAbortError(cause)) {
					rangeController?.abort();
					rangeController = null;
					value = null;
					error = null;
					failureStage = 'range';
					state = 'error';
					return;
				}
				value = null;
				error = toError(cause);
				failureStage = 'range';
				state = 'error';
			});
	};

	const applyRequest = () => {
		if (destroyed) return;
		if (index === null) {
			resolved = null;
			value = null;
			if (indexStatus === 'idle') {
				state = 'idle';
			} else if (indexStatus === 'missing') {
				error = null;
				state = 'current';
			} else if (indexStatus === 'failed' || indexStatus === 'aborted') {
				state = isExplicit(request) ? 'error' : 'current';
			} else {
				state = isExplicit(request) ? 'loading-index' : 'current';
			}
			return;
		}

		const nextResolved = resolveAgainstIndex(index);
		if (nextResolved === null) return;
		resolved = nextResolved;

		if (
			!isExplicit(request) ||
			nextResolved.canonicalWindow === null ||
			nextResolved.selection === null
		) {
			abortRange();
			failureStage = null;
			error = null;
			value = null;
			state = 'current';
			return;
		}

		const nextKey = `${indexIdentity}:${nextResolved.canonicalWindow.from}:${nextResolved.canonicalWindow.to}`;
		if (nextKey === rangeKey) return;
		startRange(index, nextResolved, nextKey);
	};

	const startIndex = () => {
		if (destroyed) return;
		indexSequence += 1;
		const token = indexSequence;
		indexController?.abort();
		abortRange();
		const controller = new AbortController();
		indexController = controller;
		index = null;
		resolved = null;
		value = null;
		error = null;
		failureStage = null;
		indexStatus = 'loading';
		state = isExplicit(request) ? 'loading-index' : 'current';

		let pending: Promise<TIndex | null>;
		try {
			pending = loader.loadIndex(controller.signal);
		} catch (cause) {
			if (isAbortError(cause)) {
				controller.abort();
				indexController = null;
				failureStage = 'index';
				indexStatus = 'aborted';
				error = null;
				state = isExplicit(request) ? 'error' : 'current';
			} else {
				failIndex(cause);
			}
			return;
		}

		pending
			.then((loaded) => {
				if (destroyed || token !== indexSequence) return;
				indexController = null;
				if (loaded === null) {
					index = null;
					indexStatus = 'missing';
					resolved = null;
					value = null;
					error = null;
					failureStage = null;
					state = 'current';
					return;
				}

				index = loaded;
				indexStatus = 'available';
				indexIdentity += 1;
				applyRequest();
			})
			.catch((cause) => {
				if (destroyed || token !== indexSequence) return;
				if (isAbortError(cause)) {
					indexController?.abort();
					indexController = null;
					failureStage = 'index';
					indexStatus = 'aborted';
					error = null;
					state = isExplicit(request) ? 'error' : 'current';
					return;
				}
				failIndex(cause);
			});
	};

	const disposeEffects = $effect.root(() => {
		$effect(() => {
			untrack(startIndex);
		});
	});

	return {
		get request() {
			return request;
		},
		get index() {
			return index;
		},
		get resolved() {
			return resolved;
		},
		get value() {
			return value;
		},
		get state() {
			return state;
		},
		get error() {
			return error;
		},
		setRequest(nextRequest) {
			if (destroyed) return;
			const next = snapshotRequest(nextRequest);
			if (sameRequest(request, next)) return;
			request = next;
			applyRequest();
		},
		retry() {
			if (destroyed) return;
			if (failureStage === 'index') {
				startIndex();
				return;
			}
			const retryIndex = index;
			const retryResolved = resolved;
			if (
				failureStage === 'range' &&
				retryIndex !== null &&
				retryResolved !== null &&
				retryResolved.canonicalWindow !== null &&
				retryResolved.selection !== null
			) {
				const key = `${indexIdentity}:${retryResolved.canonicalWindow.from}:${retryResolved.canonicalWindow.to}`;
				startRange(retryIndex, retryResolved, key);
			}
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			disposeEffects();
			indexSequence += 1;
			rangeSequence += 1;
			indexController?.abort();
			rangeController?.abort();
			indexController = null;
			rangeController = null;
			index = null;
			resolved = null;
			value = null;
			error = null;
			failureStage = null;
			indexStatus = 'idle';
			rangeKey = null;
			state = 'idle';
		},
	};
}
