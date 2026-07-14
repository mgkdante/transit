import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { DateWindow } from '$lib/filters';
import {
	createHistoryRangeResource,
	historyRangeRequestFromSearchParams,
	type HistoryRangeLoader,
	type HistoryRangeResource,
	type RawHistoryRangeRequest,
} from './rangeResource.svelte';
import type { HistoryAvailability } from './selection';

interface TestIndex {
	readonly id: string;
}

interface TestValue {
	readonly label: string;
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

const index: TestIndex = { id: 'index-a' };
const availability: HistoryAvailability = {
	kind: 'continuous',
	firstDate: '2026-01-01',
	lastDate: '2026-03-31',
	gaps: [{ start_date: '2026-02-10', end_date: '2026-02-12', reason: 'outage' }],
};
const defaultWindow: DateWindow = { from: '2026-03-01', to: '2026-03-31' };

function request(from?: string | null, to?: string | null): RawHistoryRangeRequest {
	return {
		hasFrom: from !== undefined,
		hasTo: to !== undefined,
		rawFrom: from ?? null,
		rawTo: to ?? null,
	};
}

function makeLoader(
	overrides: Partial<HistoryRangeLoader<TestIndex, TestValue>> = {},
): HistoryRangeLoader<TestIndex, TestValue> {
	return {
		loadIndex: vi.fn(async () => index),
		availability: vi.fn(() => availability),
		defaultWindow: vi.fn(() => defaultWindow),
		load: vi.fn(async () => ({ value: { label: 'loaded' }, status: 'complete' as const })),
		...overrides,
	};
}

async function settle(resource: HistoryRangeResource<TestIndex, TestValue>) {
	await vi.waitFor(() => {
		flushSync();
		expect(['loading-index', 'loading-range']).not.toContain(resource.state);
	});
}

const resources: Array<HistoryRangeResource<TestIndex, TestValue>> = [];

function create(
	loader: HistoryRangeLoader<TestIndex, TestValue>,
	initialRequest: RawHistoryRangeRequest,
) {
	const resource = createHistoryRangeResource(loader, { initialRequest });
	resources.push(resource);
	flushSync();
	return resource;
}

afterEach(() => {
	for (const resource of resources.splice(0)) resource.destroy();
});

describe('historyRangeRequestFromSearchParams', () => {
	it('preserves raw presence, blanks, half-pairs, malformed values, inversion, and first repeats', () => {
		expect(historyRangeRequestFromSearchParams(new URLSearchParams())).toEqual(request());
		expect(historyRangeRequestFromSearchParams(new URLSearchParams('from=&to='))).toEqual(
			request('', ''),
		);
		expect(historyRangeRequestFromSearchParams(new URLSearchParams('from=2026-01-01'))).toEqual(
			request('2026-01-01'),
		);
		expect(historyRangeRequestFromSearchParams(new URLSearchParams('to=bad'))).toEqual(
			request(undefined, 'bad'),
		);
		expect(
			historyRangeRequestFromSearchParams(
				new URLSearchParams('from=2026-03-20&from=2026-03-21&to=2026-01-10'),
			),
		).toEqual(request('2026-03-20', '2026-01-10'));
	});
});

describe('createHistoryRangeResource current and resolution states', () => {
	it('stays idle and performs no discovery before its client effect runs', () => {
		const loader = makeLoader();
		const resource = createHistoryRangeResource(loader, { initialRequest: request() });
		resources.push(resource);

		expect(resource.state).toBe('idle');
		expect(loader.loadIndex).not.toHaveBeenCalled();
		flushSync();
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		expect(resource.state).toBe('current');
	});

	it('keeps the compatibility lane current while optional discovery loads and never loads partitions', async () => {
		const pending = deferred<TestIndex | null>();
		const loader = makeLoader({ loadIndex: vi.fn(() => pending.promise) });
		const initial = request();
		const resource = create(loader, initial);

		expect(resource.state).toBe('current');
		expect(resource.value).toBeNull();
		(initial as { rawFrom: string | null }).rawFrom = 'mutated';
		expect(resource.request).toEqual(request());
		expect(loader.load).not.toHaveBeenCalled();

		pending.resolve(index);
		await settle(resource);
		expect(resource.state).toBe('current');
		expect(resource.index).toBe(index);
		expect(resource.resolved?.selection).toEqual(defaultWindow);
		expect(resource.resolved?.canonicalWindow).toBeNull();
		expect(loader.load).not.toHaveBeenCalled();
	});

	it('treats an optional null index as current for default and explicit requests', async () => {
		for (const raw of [request(), request('2026-01-10', '2026-01-20')]) {
			const loader = makeLoader({ loadIndex: vi.fn(async () => null) });
			const resource = create(loader, raw);
			await settle(resource);
			expect(resource.state).toBe('current');
			expect(resource.index).toBeNull();
			expect(resource.resolved).toBeNull();
			expect(loader.load).not.toHaveBeenCalled();
		}
	});

	it('keeps a settled optional null index current when a later request becomes explicit', async () => {
		const loader = makeLoader({ loadIndex: vi.fn(async () => null) });
		const resource = create(loader, request());
		await settle(resource);

		resource.setRequest(request('2026-01-10', '2026-01-20'));
		flushSync();
		expect(resource.state).toBe('current');
		expect(resource.error).toBeNull();
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		expect(loader.load).not.toHaveBeenCalled();
	});

	it('loads a valid initial deep link without exposing current or stale values', async () => {
		const indexPending = deferred<TestIndex | null>();
		const rangePending = deferred<{ value: TestValue | null; status: 'complete' }>();
		const loader = makeLoader({
			loadIndex: vi.fn(() => indexPending.promise),
			load: vi.fn(() => rangePending.promise),
		});
		const resource = create(loader, request('2026-01-10', '2026-01-20'));

		expect(resource.state).toBe('loading-index');
		expect(resource.value).toBeNull();
		indexPending.resolve(index);
		await vi.waitFor(() => {
			flushSync();
			expect(resource.state).toBe('loading-range');
		});
		expect(resource.value).toBeNull();
		expect(resource.resolved?.canonicalWindow).toEqual({
			from: '2026-01-10',
			to: '2026-01-20',
		});
		expect(loader.load).toHaveBeenCalledTimes(1);

		rangePending.resolve({ value: { label: 'historic' }, status: 'complete' });
		await settle(resource);
		expect(resource.state).toBe('ready');
		expect(resource.value).toEqual({ label: 'historic' });
	});

	it('exposes corrections but never loads fallback partitions for invalid explicit requests', async () => {
		const cases = [
			[request('2026-01-10'), 'malformed'],
			[request('', '2026-01-20'), 'malformed'],
			[request('2025-12-31', '2026-01-20'), 'outside-coverage'],
			[request('2026-02-10', '2026-02-20'), 'gap'],
		] as const;

		for (const [raw, reason] of cases) {
			const loader = makeLoader();
			const resource = create(loader, raw);
			await settle(resource);
			expect(resource.state).toBe('current');
			expect(resource.resolved?.selection).toEqual(defaultWindow);
			expect(resource.resolved?.canonicalWindow).toBeNull();
			expect(resource.resolved?.correction?.reason).toBe(reason);
			expect(loader.load).not.toHaveBeenCalled();
		}
	});

	it('keeps empty availability honest with no correction and no partition request', async () => {
		const loader = makeLoader({ availability: vi.fn(() => ({ kind: 'empty' as const })) });
		const resource = create(loader, request('2026-01-10', '2026-01-20'));
		await settle(resource);

		expect(resource.state).toBe('current');
		expect(resource.resolved).toEqual({
			selection: null,
			canonicalWindow: null,
			intersectingGaps: [],
			correction: null,
		});
		expect(loader.load).not.toHaveBeenCalled();
	});

	it('canonicalizes inverted ranges, exposes intersecting gaps, and deduplicates canonical attempts', async () => {
		const loader = makeLoader();
		const resource = create(loader, request('2026-02-20', '2026-02-01'));
		await settle(resource);

		expect(resource.resolved?.canonicalWindow).toEqual({
			from: '2026-02-01',
			to: '2026-02-20',
		});
		expect(resource.resolved?.intersectingGaps).toEqual(availability.gaps);
		expect(loader.load).toHaveBeenCalledTimes(1);

		resource.setRequest(request('2026-02-01', '2026-02-20'));
		flushSync();
		await Promise.resolve();
		expect(loader.load).toHaveBeenCalledTimes(1);
		resource.setRequest(request('2026-02-01', '2026-02-20'));
		flushSync();
		expect(loader.load).toHaveBeenCalledTimes(1);
	});
});

describe('createHistoryRangeResource loader status, cancellation, and retry', () => {
	it.each([
		['complete', 'ready', null],
		['partial', 'partial', { label: 'partial-but-real' }],
		['no_data', 'no-data', { label: 'metadata-only' }],
	] as const)('maps %s solely from loader status to %s', async (status, state, value) => {
		const loader = makeLoader({ load: vi.fn(async () => ({ value, status })) });
		const resource = create(loader, request('2026-01-10', '2026-01-20'));
		await settle(resource);

		expect(resource.state).toBe(state);
		expect(resource.value).toBe(value);
	});

	it('aborts A for B, hides A immediately, and ignores an A completion that ignores abort', async () => {
		const attempts: Array<{
			window: DateWindow;
			signal: AbortSignal;
			pending: ReturnType<typeof deferred<{ value: TestValue | null; status: 'complete' }>>;
		}> = [];
		const loader = makeLoader({
			load: vi.fn((resolved, _index, signal) => {
				const pending = deferred<{ value: TestValue | null; status: 'complete' }>();
				attempts.push({ window: resolved.selection!, signal, pending });
				return pending.promise;
			}),
		});
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await vi.waitFor(() => {
			flushSync();
			expect(attempts).toHaveLength(1);
		});

		resource.setRequest(request('2026-03-01', '2026-03-10'));
		flushSync();
		expect(attempts).toHaveLength(2);
		expect(attempts[0].signal.aborted).toBe(true);
		expect(resource.state).toBe('loading-range');
		expect(resource.value).toBeNull();

		attempts[0].pending.resolve({ value: { label: 'stale-a' }, status: 'complete' });
		await Promise.resolve();
		flushSync();
		expect(resource.value).toBeNull();

		attempts[1].pending.resolve({ value: { label: 'fresh-b' }, status: 'complete' });
		await settle(resource);
		expect(resource.value).toEqual({ label: 'fresh-b' });
	});

	it('switching to current aborts the range and never starts a fallback load', async () => {
		const range = deferred<{ value: TestValue | null; status: 'complete' }>();
		let signal!: AbortSignal;
		const loader = makeLoader({
			load: vi.fn((_resolved, _index, attemptSignal) => {
				signal = attemptSignal;
				return range.promise;
			}),
		});
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await vi.waitFor(() => expect(loader.load).toHaveBeenCalledTimes(1));

		resource.setRequest(request());
		flushSync();
		expect(signal.aborted).toBe(true);
		expect(resource.state).toBe('current');
		expect(resource.value).toBeNull();
		expect(loader.load).toHaveBeenCalledTimes(1);
	});

	it('switching to an invalid request aborts the range and exposes only its correction', async () => {
		const range = deferred<{ value: TestValue | null; status: 'complete' }>();
		let signal!: AbortSignal;
		const loader = makeLoader({
			load: vi.fn((_resolved, _index, attemptSignal) => {
				signal = attemptSignal;
				return range.promise;
			}),
		});
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await vi.waitFor(() => expect(loader.load).toHaveBeenCalledTimes(1));

		resource.setRequest(request('2026-03-01'));
		flushSync();
		expect(signal.aborted).toBe(true);
		expect(resource.state).toBe('current');
		expect(resource.value).toBeNull();
		expect(resource.resolved?.correction?.reason).toBe('malformed');
		expect(loader.load).toHaveBeenCalledTimes(1);
	});

	it('uses only the latest request made while the index is loading', async () => {
		const pending = deferred<TestIndex | null>();
		const loader = makeLoader({ loadIndex: vi.fn(() => pending.promise) });
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		resource.setRequest(request('2026-03-01', '2026-03-10'));
		flushSync();

		pending.resolve(index);
		await settle(resource);
		expect(loader.load).toHaveBeenCalledTimes(1);
		expect(vi.mocked(loader.load).mock.calls[0][0].selection).toEqual({
			from: '2026-03-01',
			to: '2026-03-10',
		});
	});

	it('retries an index failure without starting range work early', async () => {
		const failure = new Error('index failed');
		const signals: AbortSignal[] = [];
		const loadIndex = vi
			.fn<HistoryRangeLoader<TestIndex, TestValue>['loadIndex']>()
			.mockImplementationOnce((signal) => {
				signals.push(signal);
				return Promise.reject(failure);
			})
			.mockImplementationOnce((signal) => {
				signals.push(signal);
				return Promise.resolve(index);
			});
		const loader = makeLoader({ loadIndex });
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await settle(resource);

		expect(resource.state).toBe('error');
		expect(resource.error).toBe(failure);
		expect(loader.load).not.toHaveBeenCalled();
		resource.retry();
		flushSync();
		await settle(resource);
		expect(loadIndex).toHaveBeenCalledTimes(2);
		expect(signals[0]).not.toBe(signals[1]);
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);
		expect(loader.load).toHaveBeenCalledTimes(1);
		expect(resource.state).toBe('ready');
	});

	it('retries a range failure against the accepted index without reloading discovery', async () => {
		const failure = new Error('range failed');
		const signals: AbortSignal[] = [];
		const load = vi
			.fn<HistoryRangeLoader<TestIndex, TestValue>['load']>()
			.mockImplementationOnce((_resolved, _index, signal) => {
				signals.push(signal);
				return Promise.reject(failure);
			})
			.mockImplementationOnce((_resolved, _index, signal) => {
				signals.push(signal);
				return Promise.resolve({ value: { label: 'retried' }, status: 'complete' });
			});
		const loader = makeLoader({ load });
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await settle(resource);

		expect(resource.state).toBe('error');
		expect(resource.error).toBe(failure);
		resource.retry();
		flushSync();
		await settle(resource);
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(2);
		expect(signals[0]).not.toBe(signals[1]);
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);
		expect(resource.value).toEqual({ label: 'retried' });
	});

	it('keeps default-path index failures non-blocking but exposes the same error diagnostically', async () => {
		const failure = new Error('optional discovery failed');
		const loader = makeLoader({ loadIndex: vi.fn(async () => Promise.reject(failure)) });
		const resource = create(loader, request());
		await settle(resource);

		expect(resource.state).toBe('current');
		expect(resource.error).toBe(failure);
		expect(resource.value).toBeNull();
	});

	it('aborts and invalidates accepted range work when index-derived resolution throws', async () => {
		const failure = new Error('availability failed');
		const pending = deferred<{ value: TestValue | null; status: 'complete' }>();
		let rangeSignal!: AbortSignal;
		const availabilityForAttempt = vi
			.fn<HistoryRangeLoader<TestIndex, TestValue>['availability']>()
			.mockReturnValueOnce(availability)
			.mockImplementation(() => {
				throw failure;
			});
		const loader = makeLoader({
			availability: availabilityForAttempt,
			load: vi.fn((_resolved, _index, signal) => {
				rangeSignal = signal;
				return pending.promise;
			}),
		});
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await vi.waitFor(() => expect(loader.load).toHaveBeenCalledTimes(1));

		resource.setRequest(request('2026-03-01', '2026-03-10'));
		flushSync();
		expect(resource.state).toBe('error');
		expect(resource.error).toBe(failure);
		expect(resource.index).toBeNull();
		expect(rangeSignal.aborted).toBe(true);

		pending.resolve({ value: { label: 'stale' }, status: 'complete' });
		await Promise.resolve();
		flushSync();
		expect(resource.state).toBe('error');
		expect(resource.value).toBeNull();
	});

	it('keeps a synchronous AbortError silent and exposes a retryable state', () => {
		const abort = new DOMException('cancelled', 'AbortError');
		const loader = makeLoader({
			loadIndex: vi.fn(() => {
				throw abort;
			}),
		});
		const resource = create(loader, request('2026-01-01', '2026-01-10'));

		expect(resource.state).toBe('error');
		expect(resource.error).toBeNull();
		resource.retry();
		flushSync();
		expect(loader.loadIndex).toHaveBeenCalledTimes(2);
	});

	it('keeps an asynchronous index AbortError silent and retries discovery', async () => {
		const abort = new DOMException('cancelled', 'AbortError');
		const loadIndex = vi
			.fn<HistoryRangeLoader<TestIndex, TestValue>['loadIndex']>()
			.mockRejectedValueOnce(abort)
			.mockResolvedValueOnce(index);
		const loader = makeLoader({ loadIndex });
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await settle(resource);

		expect(resource.state).toBe('error');
		expect(resource.error).toBeNull();
		resource.retry();
		flushSync();
		await settle(resource);
		expect(loadIndex).toHaveBeenCalledTimes(2);
		expect(resource.state).toBe('ready');
	});

	it('keeps a synchronous range AbortError silent and retries only that range', async () => {
		const abort = new DOMException('cancelled', 'AbortError');
		const load = vi
			.fn<HistoryRangeLoader<TestIndex, TestValue>['load']>()
			.mockImplementationOnce(() => {
				throw abort;
			})
			.mockResolvedValueOnce({ value: { label: 'retried' }, status: 'complete' });
		const loader = makeLoader({ load });
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await settle(resource);

		expect(resource.state).toBe('error');
		expect(resource.error).toBeNull();
		resource.retry();
		flushSync();
		await settle(resource);
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(2);
		expect(resource.value).toEqual({ label: 'retried' });
	});

	it('keeps an active range AbortError silent and retries only that range', async () => {
		const abort = new DOMException('cancelled', 'AbortError');
		const load = vi
			.fn<HistoryRangeLoader<TestIndex, TestValue>['load']>()
			.mockRejectedValueOnce(abort)
			.mockResolvedValueOnce({ value: { label: 'retried' }, status: 'complete' });
		const loader = makeLoader({ load });
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await settle(resource);

		expect(resource.state).toBe('error');
		expect(resource.error).toBeNull();
		resource.retry();
		flushSync();
		await settle(resource);
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(2);
		expect(resource.value).toEqual({ label: 'retried' });
	});

	it('destroy aborts both stages, makes late completion inert, and makes later methods no-ops', async () => {
		const indexPending = deferred<TestIndex | null>();
		let indexSignal!: AbortSignal;
		const loader = makeLoader({
			loadIndex: vi.fn((signal) => {
				indexSignal = signal;
				return indexPending.promise;
			}),
		});
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		expect(indexSignal.aborted).toBe(false);

		resource.destroy();
		expect(indexSignal.aborted).toBe(true);
		expect(resource.state).toBe('idle');
		indexPending.resolve(index);
		await Promise.resolve();
		flushSync();
		expect(resource.state).toBe('idle');
		resource.setRequest(request('2026-03-01', '2026-03-10'));
		resource.retry();
		flushSync();
		expect(loader.loadIndex).toHaveBeenCalledTimes(1);
		expect(loader.load).not.toHaveBeenCalled();
	});

	it('destroy aborts active range work and ignores its late rejection', async () => {
		const pending = deferred<{ value: TestValue | null; status: 'complete' }>();
		let signal!: AbortSignal;
		const loader = makeLoader({
			load: vi.fn((_resolved, _index, attemptSignal) => {
				signal = attemptSignal;
				return pending.promise;
			}),
		});
		const resource = create(loader, request('2026-01-01', '2026-01-10'));
		await vi.waitFor(() => expect(loader.load).toHaveBeenCalledTimes(1));

		resource.destroy();
		expect(signal.aborted).toBe(true);
		expect(resource.state).toBe('idle');
		pending.reject(new Error('late failure'));
		await Promise.resolve();
		flushSync();
		expect(resource.state).toBe('idle');
		expect(resource.error).toBeNull();
	});
});
