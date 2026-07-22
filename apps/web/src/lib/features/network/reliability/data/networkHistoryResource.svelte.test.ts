import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { HistoricCollectionIndex, IsoUtc, NetworkHistoryPartition } from '$lib/v1/schemas';
import type { RawHistoryRangeRequest } from '$lib/v1/history/rangeResource.svelte';
import { createNetworkHistoryResource } from './networkHistoryResource.svelte';

const repositories = vi.hoisted(() => ({
	getNetworkHistoryIndex: vi.fn(),
	loadNetworkHistoryRange: vi.fn(),
}));

vi.mock('$lib/v1/repositories/historic', () => repositories);

const sha = 'a'.repeat(64);
const index = {
	generated_utc: '2026-07-13T12:00:00Z' as IsoUtc,
	family: 'network',
	selection_mode: 'range',
	collection_generation_id: 'f'.repeat(64),
	first_available_date: '2026-01-31',
	last_available_date: '2026-01-31',
	gaps: [],
	partitions: [
		{
			path: `historic/history/network/generations/${sha}/2026-01.json`,
			coverage_start: '2026-01-31',
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
			first_available_date: '2026-01-31',
			last_available_date: '2026-01-31',
			gaps: [],
		},
		{
			metric: 'delay_percentiles',
			aggregation: 'daily_only',
			first_available_date: '2026-01-31',
			last_available_date: '2026-01-31',
			gaps: [],
		},
		{
			metric: 'vehicles',
			aggregation: 'daily_only',
			first_available_date: '2026-01-31',
			last_available_date: '2026-01-31',
			gaps: [],
		},
		{
			metric: 'cancellation',
			aggregation: 'additive',
			first_available_date: '2026-01-31',
			last_available_date: '2026-01-31',
			gaps: [],
		},
		{
			metric: 'occupancy',
			aggregation: 'additive',
			first_available_date: '2026-01-31',
			last_available_date: '2026-01-31',
			gaps: [],
		},
	],
} as HistoricCollectionIndex;

const partitions = [
	{
		generated_utc: '2026-07-13T12:00:00Z' as IsoUtc,
		month: '2026-01',
		days: [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 10,
					on_time_count: 8,
					severe_count: 1,
					sum_delay_seconds: 600,
				},
				delay_percentiles: {
					observation_count: 10,
					p50_delay_seconds: 60,
					p90_delay_seconds: 120,
				},
				vehicles: 5,
				cancellation: {
					canceled_trip_days: 1,
					total_trip_days: 10,
					scheduled_trip_days: 10,
					delivered_trip_days: 9,
					silent_trip_days: 0,
				},
				occupancy: { empty: 1, many_seats: 2, few_seats: 3, standing: 3, full: 1 },
			},
		],
	},
] as NetworkHistoryPartition[];

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

const resources: ReturnType<typeof createNetworkHistoryResource>[] = [];

function create(initialRequest: RawHistoryRangeRequest) {
	const resource = createNetworkHistoryResource(initialRequest);
	resources.push(resource);
	flushSync();
	return resource;
}

beforeEach(() => {
	repositories.getNetworkHistoryIndex.mockReset();
	repositories.loadNetworkHistoryRange.mockReset();
	repositories.getNetworkHistoryIndex.mockResolvedValue(index);
	repositories.loadNetworkHistoryRange.mockResolvedValue(partitions);
});

afterEach(() => {
	for (const resource of resources.splice(0)) resource.destroy();
});

describe('createNetworkHistoryResource', () => {
	it('keeps the default lane current while exposing collection availability without a range load', async () => {
		const resource = create(request());

		await vi.waitFor(() => expect(resource.index).toBe(index));
		expect(resource.state).toBe('current');
		expect(resource.resolved?.selection).toEqual({
			from: '2026-01-31',
			to: '2026-01-31',
		});
		expect(resource.resolved?.canonicalWindow).toBeNull();
		expect(repositories.loadNetworkHistoryRange).not.toHaveBeenCalled();
	});

	it('loads an explicit range through the retained trend builder and forwards both abort contexts', async () => {
		const resource = create(request('2026-01-31', '2026-01-31'));

		await vi.waitFor(() => expect(resource.state).toBe('ready'));
		expect(resource.value?.series).toHaveLength(1);
		expect(resource.value?.series[0]).toMatchObject({
			date: '2026-01-31',
			otp_pct: 80,
			avg_delay_min: 1,
		});

		const indexContext = repositories.getNetworkHistoryIndex.mock.calls[0]?.[0];
		const rangeCall = repositories.loadNetworkHistoryRange.mock.calls[0];
		expect(indexContext?.signal).toBeInstanceOf(AbortSignal);
		expect(rangeCall?.[0]).toBe(index);
		expect(rangeCall?.[1]).toEqual({ from: '2026-01-31', to: '2026-01-31' });
		expect(rangeCall?.[2]?.signal).toBeInstanceOf(AbortSignal);
		expect(indexContext.signal.aborted).toBe(false);
		expect(rangeCall[2].signal.aborted).toBe(false);
	});

	it('aborts the repository range request when the selection returns to current', async () => {
		const pending = deferred<NetworkHistoryPartition[]>();
		repositories.loadNetworkHistoryRange.mockReturnValue(pending.promise);
		const resource = create(request('2026-01-31', '2026-01-31'));

		await vi.waitFor(() => expect(resource.state).toBe('loading-range'));
		const signal = repositories.loadNetworkHistoryRange.mock.calls[0]?.[2]?.signal;
		expect(signal).toBeInstanceOf(AbortSignal);

		resource.setRequest(request());
		flushSync();
		expect(signal.aborted).toBe(true);
		expect(resource.state).toBe('current');

		pending.resolve(partitions);
		await Promise.resolve();
		expect(resource.value).toBeNull();
	});
});
