import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { HistoricCollectionIndex, IsoUtc, StopHistoryPartition } from '$lib/v1/schemas';
import type { RawHistoryRangeRequest } from '$lib/v1/history/rangeResource.svelte';
import { createStopHistoryResource } from './stopHistoryResource.svelte';

const repositories = vi.hoisted(() => ({
	getStopHistoryIndex: vi.fn(),
	loadStopHistoryRange: vi.fn(),
}));

const builders = vi.hoisted(() => ({
	buildRetainedStopHistory: vi.fn(),
}));

vi.mock('$lib/v1/repositories/historic', () => repositories);

vi.mock('./retainedHistory', () => builders);

const entityId = '../A/B?é';
const generatedUtc = '2026-07-13T12:00:00Z' as IsoUtc;
const sha = 'a'.repeat(64);
const index = {
	generated_utc: generatedUtc,
	family: 'stops',
	selection_mode: 'range',
	entity_id: entityId,
	collection_generation_id: 'f'.repeat(64),
	first_available_date: '2026-01-01',
	last_available_date: '2026-01-31',
	gaps: [],
	partitions: [
		{
			path: `historic/history/stops/raw-safe/generations/${sha}/2026-01.json`,
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
					severe_count: 1,
					sum_delay_seconds: 600,
				},
			},
		],
	},
] as StopHistoryPartition[];

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

const resources: ReturnType<typeof createStopHistoryResource>[] = [];

function create(initialRequest: RawHistoryRangeRequest) {
	const resource = createStopHistoryResource(entityId, initialRequest);
	resources.push(resource);
	flushSync();
	return resource;
}

beforeEach(() => {
	repositories.getStopHistoryIndex.mockReset();
	repositories.loadStopHistoryRange.mockReset();
	builders.buildRetainedStopHistory.mockReset();
	repositories.getStopHistoryIndex.mockResolvedValue(index);
	repositories.loadStopHistoryRange.mockResolvedValue(partitions);
	builders.buildRetainedStopHistory.mockReturnValue({
		status: 'complete',
		value: { daily: [{ date: '2026-01-10' }] },
	});
});

afterEach(() => {
	for (const resource of resources.splice(0)) resource.destroy();
});

describe('createStopHistoryResource', () => {
	it('discovers the fixed raw stop on the default lane without loading a partition', async () => {
		const resource = create(request());

		await vi.waitFor(() => expect(resource.index).toBe(index));
		expect(resource.state).toBe('current');
		expect(resource.resolved?.selection).toEqual({
			from: '2026-01-01',
			to: '2026-01-31',
		});
		expect(resource.resolved?.canonicalWindow).toBeNull();
		expect(repositories.getStopHistoryIndex).toHaveBeenCalledTimes(1);
		expect(repositories.getStopHistoryIndex.mock.calls[0]?.[0]).toBe(entityId);
		expect(repositories.getStopHistoryIndex.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
		expect(repositories.loadStopHistoryRange).not.toHaveBeenCalled();
		expect(builders.buildRetainedStopHistory).not.toHaveBeenCalled();
	});

	it('keeps the awkward raw stop key through discovery, loading, and reduction', async () => {
		const window = { from: '2026-01-10', to: '2026-01-20' };
		const resource = create(request(window.from, window.to));

		await vi.waitFor(() => expect(resource.state).toBe('ready'));
		const indexContext = repositories.getStopHistoryIndex.mock.calls[0]?.[1];
		const rangeCall = repositories.loadStopHistoryRange.mock.calls[0];
		expect(repositories.getStopHistoryIndex.mock.calls[0]?.[0]).toBe(entityId);
		expect(indexContext?.signal).toBeInstanceOf(AbortSignal);
		expect(rangeCall?.[0]).toBe(entityId);
		expect(rangeCall?.[1]).toBe(index);
		expect(rangeCall?.[2]).toEqual(window);
		expect(rangeCall?.[3]?.signal).toBeInstanceOf(AbortSignal);
		expect(rangeCall?.[3]?.signal).not.toBe(indexContext?.signal);
		expect(indexContext?.signal.aborted).toBe(false);
		expect(rangeCall?.[3]?.signal.aborted).toBe(false);
		expect(builders.buildRetainedStopHistory).toHaveBeenCalledWith(
			entityId,
			index,
			partitions,
			window,
		);
		expect(resource.value).toEqual({ daily: [{ date: '2026-01-10' }] });
	});

	it.each([
		['complete', 'ready', { daily: [{ date: '2026-01-10' }] }],
		['partial', 'partial', { daily: [{ date: '2026-01-10' }] }],
		['no_data', 'no-data', null],
	] as const)('preserves the builder %s status as %s', async (status, state, value) => {
		builders.buildRetainedStopHistory.mockReturnValue({ status, value });
		const resource = create(request('2026-01-10', '2026-01-20'));

		await vi.waitFor(() => expect(resource.state).toBe(state));
		expect(resource.value).toEqual(value);
	});

	it('aborts superseded range work and suppresses stale completion', async () => {
		const first = deferred<StopHistoryPartition[]>();
		const second = deferred<StopHistoryPartition[]>();
		repositories.loadStopHistoryRange
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		builders.buildRetainedStopHistory.mockImplementation(
			(_rawEntityId, _index, _partitions, window) => ({
				status: 'complete',
				value: { daily: [{ date: window.from }] },
			}),
		);
		const resource = create(request('2026-01-01', '2026-01-10'));

		await vi.waitFor(() => expect(repositories.loadStopHistoryRange).toHaveBeenCalledTimes(1));
		const firstSignal = repositories.loadStopHistoryRange.mock.calls[0]?.[3]?.signal;
		resource.setRequest(request('2026-01-20', '2026-01-31'));
		flushSync();
		expect(repositories.loadStopHistoryRange).toHaveBeenCalledTimes(2);
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
		expect(resource.value).toEqual({ daily: [{ date: '2026-01-20' }] });
	});

	it('destroy aborts active work, clears state, and makes late completion inert', async () => {
		const pending = deferred<StopHistoryPartition[]>();
		repositories.loadStopHistoryRange.mockReturnValue(pending.promise);
		const resource = create(request('2026-01-10', '2026-01-20'));

		await vi.waitFor(() => expect(resource.state).toBe('loading-range'));
		const signal = repositories.loadStopHistoryRange.mock.calls[0]?.[3]?.signal;
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
