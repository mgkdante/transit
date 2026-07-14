import { createResource, type Resource } from '../resource.svelte';
import {
	datesForAvailability,
	nextAvailableDate,
	previousAvailableDate,
	resolveHistoryDate,
	type HistoryAvailability,
	type HistoryCorrection,
	type ResolvedHistoryDate,
} from './selection';

export interface RawHistoryDateRequest {
	readonly hasDate: boolean;
	readonly rawDate: string | null;
}

export interface HistoryDateLoader<TIndex, TValue> {
	loadIndex(signal: AbortSignal): Promise<TIndex | null>;
	availability(index: TIndex): HistoryAvailability;
	loadCurrent(signal: AbortSignal): Promise<TValue>;
	loadDate(date: string, index: TIndex, signal: AbortSignal): Promise<TValue>;
}

export type HistoryDateResourceMode = 'current' | 'history';

export type HistoryDateResourceState =
	| 'idle'
	| 'loading-index'
	| 'loading-current'
	| 'loading-date'
	| 'current'
	| 'history'
	| 'error';

export interface HistoryDateResource<TIndex, TValue> extends Resource<TValue> {
	readonly request: RawHistoryDateRequest;
	readonly index: TIndex | null;
	readonly resolved: ResolvedHistoryDate | null;
	readonly availableDates: readonly string[];
	readonly selectedDate: string | null;
	readonly canonicalDate: string | null;
	readonly previousDate: string | null;
	readonly nextDate: string | null;
	readonly correction: HistoryCorrection | null;
	readonly mode: HistoryDateResourceMode;
	readonly state: HistoryDateResourceState;
	readonly value: TValue | null;
	setRequest(request: RawHistoryDateRequest): void;
	retry(): void;
	destroy(): void;
}

export interface HistoryDateResourceOptions {
	readonly initialRequest: RawHistoryDateRequest;
	readonly freshness?: boolean;
}

interface IndexAttempt<TIndex> {
	readonly attempt: number;
	readonly index: TIndex | null;
	readonly availability: HistoryAvailability | null;
}

interface PayloadAttempt<TValue> {
	readonly attempt: number;
	readonly laneKey: string;
	readonly mode: HistoryDateResourceMode;
	readonly value: TValue;
	readonly generated_utc?: string | null;
}

interface PayloadLane {
	readonly key: string;
	readonly mode: HistoryDateResourceMode;
	readonly date: string | null;
}

const EMPTY_RESOLUTION: ResolvedHistoryDate = {
	selection: null,
	canonicalDate: null,
	correction: null,
};

function snapshotRequest(request: RawHistoryDateRequest): RawHistoryDateRequest {
	return { hasDate: request.hasDate, rawDate: request.rawDate };
}

function sameRequest(a: RawHistoryDateRequest, b: RawHistoryDateRequest): boolean {
	return a.hasDate === b.hasDate && a.rawDate === b.rawDate;
}

function abortError(): DOMException {
	return new DOMException('History request was aborted.', 'AbortError');
}

function waitUntilAborted(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) {
			reject(abortError());
			return;
		}
		signal.addEventListener('abort', () => reject(abortError()), { once: true });
	});
}

function generatedUtc(value: unknown): string | null | undefined {
	if (typeof value !== 'object' || value === null || !('generated_utc' in value)) return undefined;
	const stamp = value.generated_utc;
	return typeof stamp === 'string' || stamp === null ? stamp : undefined;
}

export function historyDateRequestFromSearchParams(params: URLSearchParams): RawHistoryDateRequest {
	return {
		hasDate: params.has('date'),
		rawDate: params.get('date'),
	};
}

export function createHistoryDateResource<TIndex, TValue>(
	loader: HistoryDateLoader<TIndex, TValue>,
	options: HistoryDateResourceOptions,
): HistoryDateResource<TIndex, TValue> {
	let request = $state.raw<RawHistoryDateRequest>(snapshotRequest(options.initialRequest));
	let correctionEvent = $state.raw<HistoryCorrection | null>(null);
	let payloadRequest = snapshotRequest(options.initialRequest);
	let payloadRevision = $state(0);
	let destroyed = false;
	let latestIndexAttempt = 0;
	let latestPayloadAttempt = 0;
	let indexResource!: Resource<IndexAttempt<TIndex>>;
	let payloadResource!: Resource<PayloadAttempt<TValue>>;

	const exactIndexAttempt = (): IndexAttempt<TIndex> | null => {
		const accepted = indexResource.data;
		return accepted !== null && accepted.attempt === latestIndexAttempt ? accepted : null;
	};

	const visibleIndexAttempt = (): IndexAttempt<TIndex> | null => {
		if (destroyed) return null;
		const accepted = indexResource.data;
		if (accepted === null) return null;
		if (indexResource.loading) return accepted;
		return accepted.attempt === latestIndexAttempt ? accepted : null;
	};

	const resolveAgainst = (
		accepted: IndexAttempt<TIndex> | null,
		activeRequest: RawHistoryDateRequest,
	): ResolvedHistoryDate | null => {
		if (accepted === null) return null;
		if (accepted.index === null || accepted.availability === null) return EMPTY_RESOLUTION;
		return resolveHistoryDate(
			activeRequest.hasDate ? activeRequest.rawDate : undefined,
			accepted.availability,
		);
	};

	const laneFor = (
		accepted: IndexAttempt<TIndex> | null,
		activeRequest: RawHistoryDateRequest,
	): PayloadLane | null => {
		if (!activeRequest.hasDate) return { key: 'current', mode: 'current', date: null };
		if (accepted === null) return null;
		const resolved = resolveAgainst(accepted, activeRequest) ?? EMPTY_RESOLUTION;
		if (resolved.canonicalDate !== null && accepted.index !== null) {
			return {
				key: `history:${resolved.canonicalDate}`,
				mode: 'history',
				date: resolved.canonicalDate,
			};
		}
		return { key: 'current', mode: 'current', date: null };
	};

	const normalizeResolvedCurrent = (
		activeRequest: RawHistoryDateRequest,
		resolved: ResolvedHistoryDate | null,
	): void => {
		if (!activeRequest.hasDate || resolved === null || resolved.canonicalDate !== null) return;
		correctionEvent = resolved.correction;
		const normalized = { hasDate: false, rawDate: null } as const;
		request = normalized;
		payloadRequest = normalized;
	};

	const acceptedPayload = (): PayloadAttempt<TValue> | null => {
		if (destroyed || payloadResource.loading) return null;
		const accepted = payloadResource.data;
		const visibleLane = laneFor(visibleIndexAttempt(), request);
		if (
			accepted === null ||
			accepted.attempt !== latestPayloadAttempt ||
			visibleLane === null ||
			accepted.laneKey !== visibleLane.key
		) {
			return null;
		}
		return accepted;
	};

	const disposeEffects = $effect.root(() => {
		indexResource = createResource(async (signal) => {
			const attempt = ++latestIndexAttempt;
			const loaded = await loader.loadIndex(signal);
			return {
				attempt,
				index: loaded,
				availability: loaded === null ? null : loader.availability(loaded),
			};
		});

		payloadResource = createResource(
			async (signal) => {
				const activeRevision = payloadRevision;
				const activeRequest = payloadRequest;
				void activeRevision;
				const attempt = ++latestPayloadAttempt;
				let lane: PayloadLane = { key: 'current', mode: 'current', date: null };
				let value: TValue;

				if (!activeRequest.hasDate) {
					value = await loader.loadCurrent(signal);
				} else {
					if (indexResource.loading || !indexResource.settled) {
						return waitUntilAborted(signal);
					}

					const acceptedIndex = exactIndexAttempt();
					if (acceptedIndex === null) {
						if (indexResource.error !== null) throw indexResource.error;
						throw abortError();
					}

					const resolved = resolveAgainst(acceptedIndex, activeRequest) ?? EMPTY_RESOLUTION;
					lane = laneFor(acceptedIndex, activeRequest) ?? lane;
					normalizeResolvedCurrent(activeRequest, resolved);
					if (lane.mode === 'history' && lane.date !== null && acceptedIndex.index !== null) {
						value = await loader.loadDate(lane.date, acceptedIndex.index, signal);
					} else {
						value = await loader.loadCurrent(signal);
					}
				}

				return {
					attempt,
					laneKey: lane.key,
					mode: lane.mode,
					value,
					generated_utc: generatedUtc(value),
				};
			},
			{ freshness: options.freshness === true },
		);
	});

	const currentResolved = (): ResolvedHistoryDate | null =>
		resolveAgainst(visibleIndexAttempt(), request);

	const currentAvailability = (): HistoryAvailability | null =>
		visibleIndexAttempt()?.availability ?? null;

	const currentState = (): HistoryDateResourceState => {
		if (destroyed) return 'idle';
		const payload = acceptedPayload();
		if (payload !== null) return payload.mode;
		if (latestPayloadAttempt === 0 && !payloadResource.loading && !payloadResource.settled) {
			return 'idle';
		}
		if (request.hasDate && (indexResource.loading || !indexResource.settled)) {
			return 'loading-index';
		}
		if (payloadResource.loading) {
			return currentResolved()?.canonicalDate != null ? 'loading-date' : 'loading-current';
		}
		return 'error';
	};

	const retrySelected = () => {
		if (destroyed || payloadResource.loading) return;
		const payload = acceptedPayload();

		if (!request.hasDate) {
			if (payload === null && payloadResource.settled) {
				payloadResource.reload();
				return;
			}
			if (
				payload !== null &&
				!indexResource.loading &&
				indexResource.settled &&
				(exactIndexAttempt() === null || indexResource.error !== null)
			) {
				indexResource.reload();
			}
			return;
		}

		if (indexResource.loading) return;
		if (exactIndexAttempt() === null) {
			if (indexResource.settled) indexResource.reload();
			return;
		}
		if (payload === null && payloadResource.settled) payloadResource.reload();
	};

	return {
		get request() {
			return request;
		},
		get index() {
			return visibleIndexAttempt()?.index ?? null;
		},
		get resolved() {
			return currentResolved();
		},
		get availableDates() {
			const available = currentAvailability();
			return available === null ? [] : datesForAvailability(available);
		},
		get selectedDate() {
			return currentResolved()?.selection ?? null;
		},
		get canonicalDate() {
			return currentResolved()?.canonicalDate ?? null;
		},
		get previousDate() {
			const resolved = currentResolved();
			const available = currentAvailability();
			return resolved?.selection && available
				? previousAvailableDate(resolved.selection, available)
				: null;
		},
		get nextDate() {
			const resolved = currentResolved();
			const available = currentAvailability();
			return resolved?.selection && available
				? nextAvailableDate(resolved.selection, available)
				: null;
		},
		get correction() {
			return destroyed ? null : (correctionEvent ?? currentResolved()?.correction ?? null);
		},
		get mode() {
			return currentResolved()?.canonicalDate != null ? 'history' : 'current';
		},
		get state() {
			return currentState();
		},
		get value() {
			return acceptedPayload()?.value ?? null;
		},
		get data() {
			return acceptedPayload()?.value ?? null;
		},
		get error() {
			return destroyed ? null : (payloadResource.error ?? indexResource.error);
		},
		get loading() {
			return ['loading-index', 'loading-current', 'loading-date'].includes(currentState());
		},
		get settled() {
			return destroyed ? false : payloadResource.settled && !payloadResource.loading;
		},
		setRequest(nextRequest) {
			if (destroyed) return;
			let next = snapshotRequest(nextRequest);
			correctionEvent = null;
			const acceptedIndex = exactIndexAttempt();
			const nextResolved = resolveAgainst(acceptedIndex, next);
			if (next.hasDate && nextResolved !== null && nextResolved.canonicalDate === null) {
				correctionEvent = nextResolved.correction;
				next = { hasDate: false, rawDate: null };
			}
			if (sameRequest(request, next)) return;
			const previousLane = laneFor(acceptedIndex, request)?.key ?? null;
			const nextLane = laneFor(acceptedIndex, next)?.key ?? null;
			request = next;
			payloadRequest = next;
			if (previousLane === null || nextLane === null || previousLane !== nextLane) {
				payloadRevision += 1;
			}
		},
		retry() {
			retrySelected();
		},
		reload() {
			retrySelected();
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			disposeEffects();
		},
	};
}
