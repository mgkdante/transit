import type { DateWindow } from './window';
import type {
	AlertArchiveEntry,
	AlertArchiveIndex,
	AlertArchivePage,
	AlertArchivePageRef,
} from '$lib/v1/schemas';
import { providerLocalDateKey } from '$lib/utils/time';

export const HISTORY_PARTITION_CONCURRENCY = 4;

export class HistoryArtifactContractError extends Error {
	readonly path: string;

	constructor(path: string, message = 'invalid advertised history artifact', cause?: unknown) {
		super(`[v1.history] ${message}: ${path}`, cause === undefined ? undefined : { cause });
		this.name = 'HistoryArtifactContractError';
		this.path = path;
	}
}

export class HistoryPartitionLoadError extends Error {
	readonly path: string;

	constructor(path: string, cause: unknown) {
		super(`[v1.history] failed advertised history artifact: ${path}`, { cause });
		this.name = 'HistoryPartitionLoadError';
		this.path = path;
	}
}

export class HistoryTransientPublicationError extends HistoryArtifactContractError {
	constructor(path: string, message = 'retained history publication changed during discovery') {
		super(path, message);
		this.name = 'HistoryTransientPublicationError';
	}
}

const ALERT_ARTIFACT_PATH =
	/^historic\/alerts\/generations\/[0-9a-f]{64}\/\d{4}-(?:0[1-9]|1[0-2])\/page-\d{4}\.json$/;

export function canonicalHistoryJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => (item === undefined ? 'null' : canonicalHistoryJson(item))).join(',')}]`;
	}

	const record = value as Record<string, unknown>;
	const members = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalHistoryJson(record[key])}`);
	return `{${members.join(',')}}`;
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException('The operation was aborted', 'AbortError');
}

function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(abortReason(signal));

	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(abortReason(signal));
		signal.addEventListener('abort', onAbort, { once: true });
		pending.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener('abort', onAbort);
				reject(error);
			},
		);
	});
}

function concurrencyLimit(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return HISTORY_PARTITION_CONCURRENCY;
	return Math.min(8, Math.max(1, Math.trunc(value)));
}

function descending(a: string, b: string): number {
	return a === b ? 0 : a > b ? -1 : 1;
}

function ascending(a: string, b: string): number {
	return a === b ? 0 : a < b ? -1 : 1;
}

export function assertSafeHistoryArtifactPath(path: string): string {
	if (!ALERT_ARTIFACT_PATH.test(path)) {
		throw new HistoryArtifactContractError(path, 'unsafe advertised history artifact path');
	}
	return path;
}

export function selectAlertPageRefs(
	index: AlertArchiveIndex,
	window: DateWindow,
): AlertArchivePageRef[] {
	const byPath = new Map<string, { ref: AlertArchivePageRef; bytes: string }>();
	for (const month of index.months) {
		for (const ref of month.pages) {
			const bytes = canonicalHistoryJson(ref);
			const existing = byPath.get(ref.path);
			if (existing && existing.bytes !== bytes) {
				throw new HistoryArtifactContractError(
					ref.path,
					'conflicting metadata for advertised history artifact',
				);
			}
			if (!existing) byPath.set(ref.path, { ref, bytes });
		}
	}

	return [...byPath.values()]
		.map(({ ref }) => ref)
		.filter((ref) => ref.coverage_start <= window.to && ref.coverage_end >= window.from);
}

export async function loadHistoryPartitions<R extends { readonly path: string }, T>(
	refs: readonly R[],
	load: (ref: R, signal: AbortSignal) => Promise<T>,
	options: { readonly signal?: AbortSignal; readonly concurrency?: number } = {},
): Promise<T[]> {
	if (refs.length === 0) return [];

	const controller = new AbortController();
	const callerSignal = options.signal;
	const abortFromCaller = () => {
		if (!controller.signal.aborted && callerSignal) {
			controller.abort(abortReason(callerSignal));
		}
	};

	if (callerSignal?.aborted) abortFromCaller();
	else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

	if (controller.signal.aborted) {
		callerSignal?.removeEventListener('abort', abortFromCaller);
		throw abortReason(controller.signal);
	}

	const results = new Array<T>(refs.length);
	const workerCount = Math.min(concurrencyLimit(options.concurrency), refs.length);
	let nextIndex = 0;
	let firstFailure: HistoryArtifactContractError | HistoryPartitionLoadError | null = null;

	const worker = async (): Promise<void> => {
		while (!controller.signal.aborted) {
			const index = nextIndex;
			if (index >= refs.length) return;
			nextIndex += 1;
			const ref = refs[index];

			try {
				results[index] = await raceAbort(load(ref, controller.signal), controller.signal);
			} catch (cause) {
				if (firstFailure) throw firstFailure;
				if (controller.signal.aborted) throw abortReason(controller.signal);

				firstFailure =
					cause instanceof HistoryArtifactContractError
						? cause
						: new HistoryPartitionLoadError(ref.path, cause);
				controller.abort(firstFailure);
				throw firstFailure;
			}
		}

		throw firstFailure ?? abortReason(controller.signal);
	};

	try {
		await Promise.all(Array.from({ length: workerCount }, () => worker()));
		return results;
	} finally {
		callerSignal?.removeEventListener('abort', abortFromCaller);
	}
}

export function mergeAlertArchivePages(pages: readonly AlertArchivePage[]): AlertArchiveEntry[] {
	const byId = new Map<string, { entry: AlertArchiveEntry; canonical: string }>();
	for (const page of pages) {
		for (const entry of page.alerts) {
			const canonical = canonicalHistoryJson(entry);
			const existing = byId.get(entry.id);
			if (!existing) {
				byId.set(entry.id, { entry, canonical });
				continue;
			}
			if (existing.canonical === canonical) continue;

			if (
				entry.last_seen_utc > existing.entry.last_seen_utc ||
				(entry.last_seen_utc === existing.entry.last_seen_utc && canonical < existing.canonical)
			) {
				byId.set(entry.id, { entry, canonical });
			}
		}
	}

	return [...byId.values()]
		.map(({ entry }) => entry)
		.sort((a, b) => {
			const startOrder = descending(
				a.start_utc ?? a.first_seen_utc,
				b.start_utc ?? b.first_seen_utc,
			);
			if (startOrder !== 0) return startOrder;
			const seenOrder = descending(a.last_seen_utc, b.last_seen_utc);
			return seenOrder !== 0 ? seenOrder : ascending(a.id, b.id);
		});
}

function alertWindowOverlaps(
	start: string | null | undefined,
	end: string | null | undefined,
	window: DateWindow,
): boolean {
	const startDate = providerLocalDateKey(start);
	const endDate = providerLocalDateKey(end);
	return (
		!(endDate != null && endDate < window.from) && !(startDate != null && startDate > window.to)
	);
}

export function selectAlertEntriesForWindow(
	entries: readonly AlertArchiveEntry[],
	window: DateWindow,
): AlertArchiveEntry[] {
	return entries.filter((entry) => {
		if ((entry.active_periods?.length ?? 0) > 0) {
			return entry.active_periods!.some((period) =>
				alertWindowOverlaps(period.start_utc, period.end_utc, window),
			);
		}
		if (entry.start_utc != null || entry.end_utc != null) {
			return alertWindowOverlaps(entry.start_utc, entry.end_utc, window);
		}
		return alertWindowOverlaps(entry.first_seen_utc, entry.last_seen_utc, window);
	});
}
