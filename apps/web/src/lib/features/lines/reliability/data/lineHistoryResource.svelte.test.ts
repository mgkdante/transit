import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { HistoricCollectionIndex, IsoUtc, LineHistoryPartition } from '$lib/v1/schemas';
import type { RawHistoryRangeRequest } from '$lib/v1/history/rangeResource.svelte';
import { createLineHistoryResource } from './lineHistoryResource.svelte';

const repositories = vi.hoisted(() => ({
	getLineHistoryIndex: vi.fn(),
	loadLineHistoryRange: vi.fn(),
}));

const builders = vi.hoisted(() => ({
	buildRetainedLineHistory: vi.fn(),
}));

vi.mock('$lib/v1', async () => ({
	...(await import('$lib/v1/history')),
	...repositories,
}));

vi.mock('./retainedHistory', () => builders);

const entityId = 'A/B';
const generatedUtc = '2026-07-13T12:00:00Z' as IsoUtc;
const sha = 'a'.repeat(64);
const index = {
	generated_utc: generatedUtc,
	family: 'lines',
	selection_mode: 'range',
	collection_generation_id: 'f'.repeat(64),
	first_available_date: '2026-01-01',
	last_available_date: '2026-01-31',
	gaps: [],
	partitions: [
		{
			path: `historic/history/lines/A%2FB/generations/${sha}/2026-01.json`,
			coverage_start: '2026-01-01',
			coverage_end: '2026-01-31',
			count: 1,
			sha256: sha,
			byte_size: 100,
		},
	],
	metrics: [
		{
			metric: 'delay',
			aggregation: 'additive',
			first_available_date: '2026-01-01',
			last_available_date: '2026-01-31',
			gaps: [],
		},
	],
} as HistoricCollectionIndex;

const partitions = [
	{
		generated_utc: generatedUtc,
		month: '2026-01',
		entity_id: entityId,
		days: [
			{
				date: '2026-01-10',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 10,
					on_time_count: 8,
					severe_count: 1,
					sum_delay_seconds: 600,
				},
			},
		],
	},
] as LineHistoryPartition[];

function request(from?: string, to?: string): RawHistoryRangeRequest {
	return {
		hasFrom: from !== undefined,
		hasTo: to !== undefined,
		rawFrom: from ?? null,
		rawTo: to ?? null,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

const resources: ReturnType<typeof createLineHistoryResource>[] = [];

function create(initialRequest: RawHistoryRangeRequest) {
	const resource = createLineHistoryResource(entityId, initialRequest);
	resources.push(resource);
	flushSync();
	return resource;
}

beforeEach(() => {
	repositories.getLineHistoryIndex.mockReset();
	repositories.loadLineHistoryRange.mockReset();
	builders.buildRetainedLineHistory.mockReset();
	repositories.getLineHistoryIndex.mockResolvedValue(index);
	repositories.loadLineHistoryRange.mockResolvedValue(partitions);
	builders.buildRetainedLineHistory.mockReturnValue({
		status: 'complete',
		value: { periods: [{ date: '2026-01-10' }] },
	});
});

afterEach(() => {
	for (const resource of resources.splice(0)) resource.destroy();
});

describe('createLineHistoryResource', () => {
	it('discovers the fixed raw entity on the default lane without loading a partition', async () => {
		const resource = create(request());

		await vi.waitFor(() => expect(resource.index).toBe(index));
		expect(resource.state).toBe('current');
		expect(resource.resolved?.selection).toEqual({
			from: '2026-01-01',
			to: '2026-01-31',
		});
		expect(resource.resolved?.canonicalWindow).toBeNull();
		expect(repositories.getLineHistoryIndex).toHaveBeenCalledTimes(1);
		expect(repositories.getLineHistoryIndex.mock.calls[0]?.[0]).toBe(entityId);
		expect(repositories.getLineHistoryIndex.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
		expect(repositories.loadLineHistoryRange).not.toHaveBeenCalled();
		expect(builders.buildRetainedLineHistory).not.toHaveBeenCalled();
	});

	it('uses the same raw entity for discovery, range loading, and building while forwarding signals', async () => {
		const window = { from: '2026-01-10', to: '2026-01-20' };
		const resource = create(request(window.from, window.to));

		await vi.waitFor(() => expect(resource.state).toBe('ready'));
		const indexContext = repositories.getLineHistoryIndex.mock.calls[0]?.[1];
		const rangeCall = repositories.loadLineHistoryRange.mock.calls[0];
		expect(indexContext?.signal).toBeInstanceOf(AbortSignal);
		expect(rangeCall?.[0]).toBe(entityId);
		expect(rangeCall?.[1]).toBe(index);
		expect(rangeCall?.[2]).toEqual(window);
		expect(rangeCall?.[3]?.signal).toBeInstanceOf(AbortSignal);
		expect(rangeCall?.[3]?.signal).not.toBe(indexContext?.signal);
		expect(indexContext?.signal.aborted).toBe(false);
		expect(rangeCall?.[3]?.signal.aborted).toBe(false);
		expect(builders.buildRetainedLineHistory).toHaveBeenCalledWith(
			entityId,
			index,
			partitions,
			window,
		);
		expect(resource.value).toEqual({ periods: [{ date: '2026-01-10' }] });
	});

	it.each([
		['complete', 'ready', { periods: [{ date: '2026-01-10' }] }],
		['partial', 'partial', { periods: [{ date: '2026-01-10' }] }],
		['no_data', 'no-data', null],
	] as const)('preserves the builder %s status as %s', async (status, state, value) => {
		builders.buildRetainedLineHistory.mockReturnValue({ status, value });
		const resource = create(request('2026-01-10', '2026-01-20'));

		await vi.waitFor(() => expect(resource.state).toBe(state));
		expect(resource.value).toEqual(value);
	});

	it('aborts superseded range work and suppresses a stale completion that ignores abort', async () => {
		const first = deferred<LineHistoryPartition[]>();
		const second = deferred<LineHistoryPartition[]>();
		repositories.loadLineHistoryRange
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		builders.buildRetainedLineHistory.mockImplementation(
			(_rawEntityId, _index, _partitions, window) => ({
				status: 'complete',
				value: { periods: [{ date: window.from }] },
			}),
		);
		const resource = create(request('2026-01-01', '2026-01-10'));

		await vi.waitFor(() => expect(repositories.loadLineHistoryRange).toHaveBeenCalledTimes(1));
		const firstSignal = repositories.loadLineHistoryRange.mock.calls[0]?.[3]?.signal;
		resource.setRequest(request('2026-01-20', '2026-01-31'));
		flushSync();
		expect(repositories.loadLineHistoryRange).toHaveBeenCalledTimes(2);
		expect(firstSignal?.aborted).toBe(true);
		expect(resource.state).toBe('loading-range');
		expect(resource.value).toBeNull();

		first.resolve(partitions);
		await Promise.resolve();
		await Promise.resolve();
		flushSync();
		expect(resource.state).toBe('loading-range');
		expect(resource.value).toBeNull();

		second.resolve(partitions);
		await vi.waitFor(() => expect(resource.state).toBe('ready'));
		expect(resource.value).toEqual({ periods: [{ date: '2026-01-20' }] });
	});

	it('destroy aborts active work, clears state, and makes late completion inert', async () => {
		const pending = deferred<LineHistoryPartition[]>();
		repositories.loadLineHistoryRange.mockReturnValue(pending.promise);
		const resource = create(request('2026-01-10', '2026-01-20'));

		await vi.waitFor(() => expect(resource.state).toBe('loading-range'));
		const signal = repositories.loadLineHistoryRange.mock.calls[0]?.[3]?.signal;
		resource.destroy();
		resource.destroy();
		expect(signal?.aborted).toBe(true);
		expect(resource.state).toBe('idle');
		expect(resource.index).toBeNull();
		expect(resource.value).toBeNull();

		pending.resolve(partitions);
		await Promise.resolve();
		await Promise.resolve();
		flushSync();
		expect(resource.state).toBe('idle');
		expect(resource.value).toBeNull();
	});
});
