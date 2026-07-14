import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { dataRefresh } from '$lib/stores';
import {
	createHistoryDateResource,
	historyDateRequestFromSearchParams,
	type HistoryDateLoader,
	type HistoryDateResource,
	type RawHistoryDateRequest,
} from './dateResource.svelte';
import type { HistoryAvailability } from './selection';

interface TestIndex {
	readonly id: string;
	readonly dates: readonly string[];
}

interface TestValue {
	readonly label: string;
	readonly generated_utc: string;
	readonly rows?: readonly unknown[];
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const index: TestIndex = {
	id: 'point-a',
	dates: ['2026-03-01', '2026-03-03', '2026-03-05'],
};

const availability: HistoryAvailability = { kind: 'discrete', dates: index.dates };
const current: TestValue = {
	label: 'current',
	generated_utc: '2026-03-06T12:00:00Z',
};
const historic: TestValue = {
	label: 'historic',
	generated_utc: '2026-03-03T23:59:59Z',
};

function request(date?: string | null): RawHistoryDateRequest {
	return {
		hasDate: date !== undefined,
		rawDate: date ?? null,
	};
}

function makeLoader(
	overrides: Partial<HistoryDateLoader<TestIndex, TestValue>> = {},
): HistoryDateLoader<TestIndex, TestValue> {
	return {
		loadIndex: vi.fn(async () => index),
		availability: vi.fn(() => availability),
		loadCurrent: vi.fn(async () => current),
		loadDate: vi.fn(async () => historic),
		...overrides,
	};
}

const resources: Array<HistoryDateResource<TestIndex, TestValue>> = [];

function create(
	loader: HistoryDateLoader<TestIndex, TestValue>,
	initialRequest: RawHistoryDateRequest,
	options: { freshness?: boolean } = {},
) {
	const resource = createHistoryDateResource(loader, { initialRequest, ...options });
	resources.push(resource);
	flushSync();
	return resource;
}

async function settle(resource: HistoryDateResource<TestIndex, TestValue>) {
	await vi.waitFor(() => {
		flushSync();
		expect(['idle', 'loading-index', 'loading-current', 'loading-date']).not.toContain(
			resource.state,
		);
	});
}

afterEach(() => {
	for (const resource of resources.splice(0)) resource.destroy();
	vi.restoreAllMocks();
});

describe('historyDateRequestFromSearchParams', () => {
	it('preserves absence, blanks, malformed values, and the first repeated date', () => {
		expect(historyDateRequestFromSearchParams(new URLSearchParams())).toEqual(request());
		expect(historyDateRequestFromSearchParams(new URLSearchParams('date='))).toEqual(request(''));
		expect(historyDateRequestFromSearchParams(new URLSearchParams('date=nope'))).toEqual(
			request('nope'),
		);
		expect(
			historyDateRequestFromSearchParams(new URLSearchParams('date=2026-03-01&date=2026-03-03')),
		).toEqual(request('2026-03-01'));
	});
});

describe('createHistoryDateResource current and selection lanes', () => {
	it('is idle before the client effect, snapshots its request, then starts current and discovery together', async () => {
		const indexPending = deferred<TestIndex | null>();
		const currentPending = deferred<TestValue>();
		const loader = makeLoader({
			loadIndex: vi.fn(() => indexPending.promise),
			loadCurrent: vi.fn(() => currentPending.promise),
		});
		const initial = request();
		const resource = createHistoryDateResource(loader, { initialRequest: initial });
		resources.push(resource);

		expect(resource.state).toBe('idle');
		expect(loader.loadIndex).not.toHaveBeenCalled();
		expect(loader.loadCurrent).not.toHaveBeenCalled();
		(initial as { rawDate: string | null }).rawDate = 'mutated';
		expect(resource.request).toEqual(request());

		flushSync();
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
		expect(loader.loadDate).not.toHaveBeenCalled();
		expect(resource.state).toBe('loading-current');

		currentPending.resolve(current);
		await vi.waitFor(() => {
			flushSync();
			expect(resource.state).toBe('current');
		});
		expect(resource.value).toEqual(current);
		expect(resource.availableDates).toEqual([]);

		indexPending.resolve(index);
		await vi.waitFor(() => {
			flushSync();
			expect(resource.availableDates).toEqual(index.dates);
		});
		expect(resource.value).toEqual(current);
		expect(resource.selectedDate).toBe('2026-03-05');
		expect(resource.canonicalDate).toBeNull();
		expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
		expect(loader.loadDate).not.toHaveBeenCalled();
	});

	it.each([
		['missing', null, undefined],
		['empty', { id: 'empty', dates: [] } satisfies TestIndex, { kind: 'empty' as const }],
	])('keeps current usable for a %s optional index', async (_, loaded, emptyAvailability) => {
		const loader = makeLoader({
			loadIndex: vi.fn(async () => loaded),
			availability: vi.fn(() => emptyAvailability ?? availability),
		});
		const resource = create(loader, request('2026-03-01'));
		await settle(resource);

		expect(resource.state).toBe('current');
		expect(resource.value).toEqual(current);
		expect(resource.availableDates).toEqual([]);
		expect(resource.correction).toBeNull();
		expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
		expect(loader.loadDate).not.toHaveBeenCalled();
	});

	it('loads a valid older date only after discovery and exposes honest navigation while it loads', async () => {
		const indexPending = deferred<TestIndex | null>();
		const datePending = deferred<TestValue>();
		const loader = makeLoader({
			loadIndex: vi.fn(() => indexPending.promise),
			loadDate: vi.fn(() => datePending.promise),
		});
		const resource = create(loader, request('2026-03-03'));

		expect(resource.state).toBe('loading-index');
		expect(resource.value).toBeNull();
		expect(loader.loadCurrent).not.toHaveBeenCalled();
		expect(loader.loadDate).not.toHaveBeenCalled();

		indexPending.resolve(index);
		await vi.waitFor(() => {
			flushSync();
			expect(resource.state).toBe('loading-date');
		});
		expect(resource.value).toBeNull();
		expect(resource.mode).toBe('history');
		expect(resource.selectedDate).toBe('2026-03-03');
		expect(resource.canonicalDate).toBe('2026-03-03');
		expect(resource.previousDate).toBe('2026-03-01');
		expect(resource.nextDate).toBe('2026-03-05');
		expect(loader.loadDate).toHaveBeenCalledWith('2026-03-03', index, expect.any(AbortSignal));

		datePending.resolve(historic);
		await settle(resource);
		expect(resource.state).toBe('history');
		expect(resource.value).toEqual(historic);
		expect(loader.loadCurrent).not.toHaveBeenCalled();
	});

	it('canonicalizes an explicit latest date to current without requesting its retained artifact', async () => {
		const loader = makeLoader();
		const resource = create(loader, request('2026-03-05'));
		await settle(resource);

		expect(resource.state).toBe('current');
		expect(resource.mode).toBe('current');
		expect(resource.selectedDate).toBe('2026-03-05');
		expect(resource.canonicalDate).toBeNull();
		expect(resource.correction).toBeNull();
		expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
		expect(loader.loadDate).not.toHaveBeenCalled();
	});

	it.each(['2026-03-05', 'not-a-date'])(
		'keeps the accepted current payload when canonical URL cleanup removes %s',
		async (rawDate) => {
			const loader = makeLoader();
			const resource = create(loader, request(rawDate));
			await settle(resource);
			expect(resource.value).toEqual(current);

			resource.setRequest(request());
			flushSync();
			expect(resource.request).toEqual(request());
			expect(resource.value).toEqual(current);
			expect(resource.correction).toBeNull();
			expect(resource.state).toBe('current');
			expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
			expect(loader.loadDate).not.toHaveBeenCalled();
		},
	);

	it('corrects a continuous retained gap to current without requesting a fallback artifact', async () => {
		const loader = makeLoader({
			availability: vi.fn(() => ({
				kind: 'continuous' as const,
				firstDate: '2026-03-01',
				lastDate: '2026-03-05',
				gaps: [{ start_date: '2026-03-02', end_date: '2026-03-02', reason: 'outage' }],
			})),
		});
		const resource = create(loader, request('2026-03-02'));
		await settle(resource);

		expect(resource.state).toBe('current');
		expect(resource.correction?.reason).toBe('gap');
		expect(resource.value).toEqual(current);
		expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
		expect(loader.loadDate).not.toHaveBeenCalled();
	});

	it('does not abort an in-flight current load when canonical cleanup removes explicit latest', async () => {
		const pending = deferred<TestValue>();
		let signal!: AbortSignal;
		const loader = makeLoader({
			loadCurrent: vi.fn((attemptSignal) => {
				signal = attemptSignal;
				return pending.promise;
			}),
		});
		const resource = create(loader, request('2026-03-05'));
		await vi.waitFor(() => expect(loader.loadCurrent).toHaveBeenCalledTimes(1));

		resource.setRequest(request());
		flushSync();
		expect(signal.aborted).toBe(false);
		expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
		pending.resolve(current);
		await settle(resource);
		expect(resource.value).toEqual(current);
	});

	it.each([
		['', 'malformed'],
		['not-a-date', 'malformed'],
		['2026-02-28', 'outside-coverage'],
		['2026-03-02', 'unpublished'],
	] as const)(
		'corrects %j once to current and never requests an invalid or fallback artifact',
		async (rawDate, reason) => {
			const loader = makeLoader();
			const resource = create(loader, request(rawDate));
			await settle(resource);

			expect(resource.state).toBe('current');
			expect(resource.value).toEqual(current);
			expect(resource.canonicalDate).toBeNull();
			expect(resource.correction?.reason).toBe(reason);
			const key = resource.correction?.key;
			resource.setRequest(request(rawDate));
			flushSync();
			expect(resource.correction?.key).toBe(key);
			expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
			expect(loader.loadDate).not.toHaveBeenCalled();
		},
	);

	it('treats a published-empty retained payload as a successful history value', async () => {
		const empty: TestValue = {
			label: 'published-empty',
			generated_utc: '2026-03-01T23:59:59Z',
			rows: [],
		};
		const loader = makeLoader({ loadDate: vi.fn(async () => empty) });
		const resource = create(loader, request('2026-03-01'));
		await settle(resource);

		expect(resource.state).toBe('history');
		expect(resource.value).toEqual(empty);
		expect(resource.value?.rows).toEqual([]);
	});
});

describe('createHistoryDateResource failure, retry, cancellation, and refresh', () => {
	it('keeps a default-path discovery failure non-blocking while an explicit failure is retryable', async () => {
		const failure = new Error('index failed');
		const defaultLoader = makeLoader({ loadIndex: vi.fn(async () => Promise.reject(failure)) });
		const currentResource = create(defaultLoader, request());
		await settle(currentResource);
		expect(currentResource.state).toBe('current');
		expect(currentResource.value).toEqual(current);
		expect(currentResource.error).toBe(failure);

		const loadIndex = vi
			.fn<HistoryDateLoader<TestIndex, TestValue>['loadIndex']>()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(index);
		const explicitLoader = makeLoader({ loadIndex });
		const explicitResource = create(explicitLoader, request('2026-03-01'));
		await settle(explicitResource);
		expect(explicitResource.state).toBe('error');
		expect(explicitResource.value).toBeNull();
		expect(explicitResource.error).toBe(failure);
		expect(explicitLoader.loadCurrent).not.toHaveBeenCalled();
		expect(explicitLoader.loadDate).not.toHaveBeenCalled();

		explicitResource.retry();
		flushSync();
		await settle(explicitResource);
		expect(loadIndex).toHaveBeenCalledTimes(2);
		expect(explicitResource.state).toBe('history');
	});

	it('retries a failed default current lane while optional discovery is still pending', async () => {
		const indexPending = deferred<TestIndex | null>();
		const currentFailure = new Error('current failed');
		const loadCurrent = vi
			.fn<HistoryDateLoader<TestIndex, TestValue>['loadCurrent']>()
			.mockRejectedValueOnce(currentFailure)
			.mockResolvedValueOnce(current);
		const loader = makeLoader({
			loadIndex: vi.fn(() => indexPending.promise),
			loadCurrent,
		});
		const resource = create(loader, request());
		await settle(resource);

		expect(resource.state).toBe('error');
		expect(resource.error).toBe(currentFailure);
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		resource.retry();
		flushSync();
		await settle(resource);
		expect(loadCurrent).toHaveBeenCalledTimes(2);
		expect(resource.state).toBe('current');
		expect(resource.value).toEqual(current);
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
	});

	it('never substitutes current after an advertised artifact fails and retries only that date', async () => {
		const failure = new Error('advertised object missing');
		const loadDate = vi
			.fn<HistoryDateLoader<TestIndex, TestValue>['loadDate']>()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(historic);
		const loader = makeLoader({ loadDate });
		const resource = create(loader, request('2026-03-03'));
		await settle(resource);

		expect(resource.state).toBe('error');
		expect(resource.value).toBeNull();
		expect(resource.error).toBe(failure);
		expect(loader.loadCurrent).not.toHaveBeenCalled();

		resource.retry();
		flushSync();
		await settle(resource);
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		expect(loadDate).toHaveBeenCalledTimes(2);
		expect(resource.state).toBe('history');
	});

	it.each(['synchronous', 'asynchronous'] as const)(
		'keeps a %s discovery AbortError silent, distinct from a missing index, and retryable',
		async (kind) => {
			const abort = new DOMException('cancelled', 'AbortError');
			const loadIndex = vi.fn<HistoryDateLoader<TestIndex, TestValue>['loadIndex']>();
			if (kind === 'synchronous') {
				loadIndex.mockImplementationOnce(() => {
					throw abort;
				});
			} else {
				loadIndex.mockRejectedValueOnce(abort);
			}
			loadIndex.mockResolvedValueOnce(index);
			const loader = makeLoader({ loadIndex });
			const resource = create(loader, request('2026-03-01'));
			await settle(resource);

			expect(resource.state).toBe('error');
			expect(resource.error).toBeNull();
			expect(resource.value).toBeNull();
			expect(loader.loadCurrent).not.toHaveBeenCalled();
			expect(loader.loadDate).not.toHaveBeenCalled();

			resource.retry();
			flushSync();
			await settle(resource);
			expect(loadIndex).toHaveBeenCalledTimes(2);
			expect(resource.state).toBe('history');
		},
	);

	it('aborts A for B immediately, hides A, and ignores a stale completion that ignores abort', async () => {
		const attempts: Array<{
			date: string;
			signal: AbortSignal;
			pending: ReturnType<typeof deferred<TestValue>>;
		}> = [];
		const loader = makeLoader({
			loadDate: vi.fn((date, _index, signal) => {
				const pending = deferred<TestValue>();
				attempts.push({ date, signal, pending });
				return pending.promise;
			}),
		});
		const resource = create(loader, request('2026-03-01'));
		await vi.waitFor(() => {
			flushSync();
			expect(attempts).toHaveLength(1);
		});

		resource.setRequest(request('2026-03-03'));
		flushSync();
		expect(attempts).toHaveLength(2);
		expect(attempts[0].signal.aborted).toBe(true);
		expect(resource.value).toBeNull();
		expect(resource.selectedDate).toBe('2026-03-03');

		attempts[0].pending.resolve({ ...historic, label: 'stale-a' });
		await Promise.resolve();
		flushSync();
		expect(resource.value).toBeNull();

		attempts[1].pending.resolve({ ...historic, label: 'fresh-b' });
		await settle(resource);
		expect(resource.value?.label).toBe('fresh-b');
	});

	it('uses only the latest raw request made while discovery is loading', async () => {
		const indexPending = deferred<TestIndex | null>();
		const loader = makeLoader({ loadIndex: vi.fn(() => indexPending.promise) });
		const resource = create(loader, request('2026-03-01'));
		resource.setRequest(request('2026-03-03'));
		flushSync();

		indexPending.resolve(index);
		await settle(resource);
		expect(loader.loadDate).toHaveBeenCalledTimes(1);
		expect(loader.loadDate).toHaveBeenCalledWith('2026-03-03', index, expect.any(AbortSignal));
		expect(resource.value).toEqual(historic);
	});

	it('switching from history to current aborts the date and never starts a fallback artifact', async () => {
		const pending = deferred<TestValue>();
		let dateSignal!: AbortSignal;
		const loader = makeLoader({
			loadDate: vi.fn((_date, _index, signal) => {
				dateSignal = signal;
				return pending.promise;
			}),
		});
		const resource = create(loader, request('2026-03-01'));
		await vi.waitFor(() => expect(loader.loadDate).toHaveBeenCalledTimes(1));

		resource.setRequest(request());
		flushSync();
		expect(dateSignal.aborted).toBe(true);
		expect(resource.value).toBeNull();
		await settle(resource);
		expect(resource.state).toBe('current');
		expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
		expect(loader.loadDate).toHaveBeenCalledTimes(1);
	});

	it.each(['synchronous', 'asynchronous'] as const)(
		'keeps a %s AbortError silent and retryable',
		async (kind) => {
			const abort = new DOMException('cancelled', 'AbortError');
			const loadDate = vi.fn<HistoryDateLoader<TestIndex, TestValue>['loadDate']>();
			if (kind === 'synchronous') {
				loadDate.mockImplementationOnce(() => {
					throw abort;
				});
			} else {
				loadDate.mockRejectedValueOnce(abort);
			}
			loadDate.mockResolvedValueOnce(historic);
			const loader = makeLoader({ loadDate });
			const resource = create(loader, request('2026-03-01'));
			await settle(resource);

			expect(resource.state).toBe('error');
			expect(resource.error).toBeNull();
			expect(resource.value).toBeNull();
			resource.retry();
			flushSync();
			await settle(resource);
			expect(loadDate).toHaveBeenCalledTimes(2);
			expect(resource.state).toBe('history');
		},
	);

	it('a global refresh refetches the selected history lane through a fresh index without losing selection', async () => {
		const indexes = [index, { ...index, id: 'point-b' }];
		const loader = makeLoader({
			loadIndex: vi.fn(async () => indexes.shift() ?? index),
			loadDate: vi.fn(async (date, accepted) => ({
				...historic,
				label: `${accepted.id}:${date}`,
			})),
		});
		const resource = create(loader, request('2026-03-03'));
		await settle(resource);
		expect(resource.value?.label).toBe('point-a:2026-03-03');

		dataRefresh.bumpEpoch();
		flushSync();
		expect(resource.value).toBeNull();
		expect(resource.canonicalDate).toBe('2026-03-03');
		await settle(resource);

		expect(loader.loadIndex).toHaveBeenCalledTimes(2);
		expect(loader.loadDate).toHaveBeenCalledTimes(2);
		expect(resource.value?.label).toBe('point-b:2026-03-03');
		expect(resource.request).toEqual(request('2026-03-03'));
	});

	it('normalizes explicit latest durably so a later index cannot resurrect it as history', async () => {
		const expanded: TestIndex = {
			id: 'point-b',
			dates: [...index.dates, '2026-03-06'],
		};
		const indexes = [index, expanded];
		const loader = makeLoader({
			loadIndex: vi.fn(async () => indexes.shift() ?? expanded),
			availability: vi.fn((accepted) => ({ kind: 'discrete' as const, dates: accepted.dates })),
		});
		const resource = create(loader, request('2026-03-05'));
		await settle(resource);
		expect(resource.request).toEqual(request());

		dataRefresh.bumpEpoch();
		flushSync();
		await settle(resource);

		expect(resource.request).toEqual(request());
		expect(resource.state).toBe('current');
		expect(loader.loadCurrent).toHaveBeenCalledTimes(2);
		expect(loader.loadDate).not.toHaveBeenCalled();
	});

	it('keeps an unpublished correction event but forgets its raw date before later publication', async () => {
		const expanded: TestIndex = {
			id: 'point-b',
			dates: ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05'],
		};
		const indexes = [index, expanded];
		const loader = makeLoader({
			loadIndex: vi.fn(async () => indexes.shift() ?? expanded),
			availability: vi.fn((accepted) => ({ kind: 'discrete' as const, dates: accepted.dates })),
		});
		const resource = create(loader, request('2026-03-02'));
		await settle(resource);
		const correction = resource.correction;
		expect(correction?.reason).toBe('unpublished');
		expect(resource.request).toEqual(request());

		dataRefresh.bumpEpoch();
		flushSync();
		await settle(resource);

		expect(resource.request).toEqual(request());
		expect(resource.correction).toEqual(correction);
		expect(resource.state).toBe('current');
		expect(loader.loadCurrent).toHaveBeenCalledTimes(2);
		expect(loader.loadDate).not.toHaveBeenCalled();
	});

	it('re-resolves a newly explicit date against the fresh index instead of stale refresh metadata', async () => {
		const freshIndexPending = deferred<TestIndex | null>();
		const currentRefresh = deferred<TestValue>();
		let refreshSignal!: AbortSignal;
		const freshIndex: TestIndex = {
			id: 'point-b',
			dates: ['2026-03-01', '2026-03-04', '2026-03-05'],
		};
		const loadIndex = vi
			.fn<HistoryDateLoader<TestIndex, TestValue>['loadIndex']>()
			.mockResolvedValueOnce(index)
			.mockImplementationOnce(() => freshIndexPending.promise);
		const loadCurrent = vi
			.fn<HistoryDateLoader<TestIndex, TestValue>['loadCurrent']>()
			.mockResolvedValueOnce(current)
			.mockImplementationOnce((signal) => {
				refreshSignal = signal;
				return currentRefresh.promise;
			});
		const loader = makeLoader({
			loadIndex,
			loadCurrent,
			availability: vi.fn((accepted) => ({ kind: 'discrete' as const, dates: accepted.dates })),
		});
		const resource = create(loader, request());
		await settle(resource);

		dataRefresh.bumpEpoch();
		flushSync();
		expect(loadCurrent).toHaveBeenCalledTimes(2);
		resource.setRequest(request('2026-03-04'));
		flushSync();
		expect(refreshSignal.aborted).toBe(true);
		expect(resource.state).toBe('loading-index');

		freshIndexPending.resolve(freshIndex);
		await settle(resource);
		expect(loader.loadDate).toHaveBeenCalledTimes(1);
		expect(loader.loadDate).toHaveBeenCalledWith('2026-03-04', freshIndex, expect.any(AbortSignal));
		expect(resource.state).toBe('history');
	});

	it('keeps normalized current independent of an in-flight index refresh', async () => {
		const freshIndexPending = deferred<TestIndex | null>();
		const loadIndex = vi
			.fn<HistoryDateLoader<TestIndex, TestValue>['loadIndex']>()
			.mockResolvedValueOnce(index)
			.mockImplementationOnce(() => freshIndexPending.promise);
		const loader = makeLoader({ loadIndex });
		const resource = create(loader, request('2026-03-05'));
		await settle(resource);
		expect(loader.loadCurrent).toHaveBeenCalledTimes(1);
		expect(resource.request).toEqual(request());

		dataRefresh.bumpEpoch();
		flushSync();
		expect(resource.state).toBe('loading-current');
		resource.setRequest(request());
		flushSync();
		await vi.waitFor(() => {
			flushSync();
			expect(resource.state).toBe('current');
		});
		expect(loader.loadCurrent).toHaveBeenCalledTimes(2);
		expect(loader.loadDate).not.toHaveBeenCalled();
		expect(resource.request).toEqual(request());

		freshIndexPending.resolve(index);
		await vi.waitFor(() => expect(loader.loadIndex).toHaveBeenCalledTimes(2));
	});

	it('a global refresh aborts unresolved current work and accepts only the refreshed current lane', async () => {
		const attempts: Array<{
			signal: AbortSignal;
			pending: ReturnType<typeof deferred<TestValue>>;
		}> = [];
		const loader = makeLoader({
			loadCurrent: vi.fn((signal) => {
				const pending = deferred<TestValue>();
				attempts.push({ signal, pending });
				return pending.promise;
			}),
		});
		const resource = create(loader, request());
		expect(attempts).toHaveLength(1);

		dataRefresh.bumpEpoch();
		flushSync();
		expect(attempts).toHaveLength(2);
		expect(attempts[0].signal.aborted).toBe(true);
		expect(resource.value).toBeNull();

		attempts[0].pending.resolve({ ...current, label: 'stale-current' });
		await Promise.resolve();
		flushSync();
		expect(resource.value).toBeNull();

		attempts[1].pending.resolve({ ...current, label: 'fresh-current' });
		await settle(resource);
		expect(resource.state).toBe('current');
		expect(resource.value?.label).toBe('fresh-current');
		expect(loader.loadIndex).toHaveBeenCalledTimes(2);
		expect(loader.loadDate).not.toHaveBeenCalled();
	});

	it('destroy aborts discovery and payload work and makes every late action inert', async () => {
		const indexPending = deferred<TestIndex | null>();
		let indexSignal!: AbortSignal;
		const loader = makeLoader({
			loadIndex: vi.fn((signal) => {
				indexSignal = signal;
				return indexPending.promise;
			}),
		});
		const resource = create(loader, request('2026-03-01'));
		expect(indexSignal.aborted).toBe(false);

		resource.destroy();
		expect(indexSignal.aborted).toBe(true);
		expect(resource.state).toBe('idle');
		indexPending.resolve(index);
		await Promise.resolve();
		flushSync();
		expect(resource.state).toBe('idle');
		resource.setRequest(request('2026-03-03'));
		resource.retry();
		flushSync();
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		expect(loader.loadCurrent).not.toHaveBeenCalled();
		expect(loader.loadDate).not.toHaveBeenCalled();
	});

	it('destroy aborts an active retained payload and ignores its late rejection', async () => {
		const pending = deferred<TestValue>();
		let dateSignal!: AbortSignal;
		const loader = makeLoader({
			loadDate: vi.fn((_date, _index, signal) => {
				dateSignal = signal;
				return pending.promise;
			}),
		});
		const resource = create(loader, request('2026-03-01'));
		await vi.waitFor(() => expect(loader.loadDate).toHaveBeenCalledTimes(1));

		resource.destroy();
		expect(dateSignal.aborted).toBe(true);
		expect(resource.state).toBe('idle');
		pending.reject(new Error('late failure'));
		await Promise.resolve();
		flushSync();
		expect(resource.state).toBe('idle');
		expect(resource.value).toBeNull();
		expect(resource.error).toBeNull();
	});

	it('destroy clears settled discovery, navigation, payload, and error state', async () => {
		const success = create(makeLoader(), request('2026-03-03'));
		await settle(success);
		expect(success.index).not.toBeNull();
		expect(success.availableDates).toEqual(index.dates);
		expect(success.value).not.toBeNull();

		success.destroy();
		expect(success.state).toBe('idle');
		expect(success.index).toBeNull();
		expect(success.resolved).toBeNull();
		expect(success.availableDates).toEqual([]);
		expect(success.selectedDate).toBeNull();
		expect(success.canonicalDate).toBeNull();
		expect(success.previousDate).toBeNull();
		expect(success.nextDate).toBeNull();
		expect(success.correction).toBeNull();
		expect(success.mode).toBe('current');
		expect(success.value).toBeNull();
		expect(success.error).toBeNull();

		const failure = new Error('retained day failed');
		const failed = create(
			makeLoader({ loadDate: vi.fn(async () => Promise.reject(failure)) }),
			request('2026-03-03'),
		);
		await settle(failed);
		expect(failed.error).toBe(failure);
		failed.destroy();
		expect(failed.state).toBe('idle');
		expect(failed.error).toBeNull();
		expect(failed.index).toBeNull();
	});
});

describe('createHistoryDateResource freshness ownership', () => {
	it('is directly compatible with ResourceBoundary and reports accepted current freshness', async () => {
		const note = vi.spyOn(dataRefresh, 'noteDataGeneratedUtc');
		const loader = makeLoader();
		const resource = create(loader, request(), { freshness: true });
		expect(resource.settled).toBe(false);
		expect(typeof resource.reload).toBe('function');
		await settle(resource);

		expect(resource.settled).toBe(true);
		expect(resource.data).toEqual(current);
		expect(note).toHaveBeenCalledTimes(1);
		expect(note).toHaveBeenCalledWith(current.generated_utc);
	});

	it('reports only the final accepted payload when freshness is enabled', async () => {
		const note = vi.spyOn(dataRefresh, 'noteDataGeneratedUtc');
		const stale = deferred<TestValue>();
		const fresh = deferred<TestValue>();
		const loader = makeLoader({
			loadDate: vi
				.fn<HistoryDateLoader<TestIndex, TestValue>['loadDate']>()
				.mockImplementationOnce(() => stale.promise)
				.mockImplementationOnce(() => fresh.promise),
		});
		const resource = create(loader, request('2026-03-01'), { freshness: true });
		await vi.waitFor(() => expect(loader.loadDate).toHaveBeenCalledTimes(1));

		resource.setRequest(request('2026-03-03'));
		flushSync();
		stale.resolve({ ...historic, generated_utc: '2026-03-01T23:59:59Z' });
		await Promise.resolve();
		flushSync();
		expect(note).not.toHaveBeenCalled();

		fresh.resolve(historic);
		await settle(resource);
		expect(note).toHaveBeenCalledTimes(1);
		expect(note).toHaveBeenLastCalledWith(historic.generated_utc);
	});

	it('never reports index, failed, or aborted attempts and stays opt-in', async () => {
		const note = vi.spyOn(dataRefresh, 'noteDataGeneratedUtc');
		const failure = new Error('day failed');
		const loader = makeLoader({ loadDate: vi.fn(async () => Promise.reject(failure)) });
		const resource = create(loader, request('2026-03-01'), { freshness: true });
		await settle(resource);
		expect(resource.state).toBe('error');
		expect(note).not.toHaveBeenCalled();

		const abort = new DOMException('cancelled', 'AbortError');
		const aborted = create(
			makeLoader({ loadDate: vi.fn(async () => Promise.reject(abort)) }),
			request('2026-03-01'),
			{ freshness: true },
		);
		await settle(aborted);
		expect(aborted.state).toBe('error');
		expect(aborted.error).toBeNull();
		expect(note).not.toHaveBeenCalled();

		const plainLoader = makeLoader();
		const plain = create(plainLoader, request());
		await settle(plain);
		expect(plain.state).toBe('current');
		expect(note).not.toHaveBeenCalled();
	});
});
