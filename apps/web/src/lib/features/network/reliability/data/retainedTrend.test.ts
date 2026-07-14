import { describe, expect, it } from 'vitest';
import type { DateWindow } from '$lib/filters';
import { wilsonBounds } from '$lib/v1/stats';
import {
	HistoricCollectionIndexSchema,
	NetworkHistoryPartitionSchema,
	type HistoricCollectionIndex,
	type HistoricMetricCoverage,
	type HistoricPartitionRef,
	type NetworkHistoryPartition,
} from '$lib/v1/schemas';
import { buildRetainedNetworkTrend } from './retainedTrend';

const GENERATED = '2026-07-13T12:00:00Z';
const COLLECTION_GENERATION = 'c'.repeat(64);

function coverage(
	metric: HistoricMetricCoverage['metric'],
	aggregation: HistoricMetricCoverage['aggregation'],
	first: string | null,
	last: string | null,
	gaps: HistoricMetricCoverage['gaps'] = [],
): HistoricMetricCoverage {
	return {
		metric,
		aggregation,
		first_available_date: first,
		last_available_date: last,
		gaps,
	};
}

const metricCoverages = (first: string, last: string): HistoricMetricCoverage[] => [
	coverage('delay', 'additive', first, last),
	coverage('delay_percentiles', 'daily_only', first, last),
	coverage('vehicles', 'daily_only', first, last),
	coverage('cancellation', 'additive', first, last),
	coverage('occupancy', 'additive', first, last),
];

function partitionRef(
	month: string,
	shaCharacter: string,
	coverageStart: string,
	coverageEnd: string,
	count: number,
): HistoricPartitionRef {
	const sha256 = shaCharacter.repeat(64);
	return {
		path: `historic/history/network/generations/${sha256}/${month}.json`,
		coverage_start: coverageStart,
		coverage_end: coverageEnd,
		count,
		sha256,
		byte_size: 100,
	};
}

function collectionIndex(
	refs: HistoricPartitionRef[],
	metrics: HistoricMetricCoverage[],
	gaps: HistoricCollectionIndex['gaps'] = [],
): HistoricCollectionIndex {
	return HistoricCollectionIndexSchema.parse({
		generated_utc: GENERATED,
		family: 'network',
		selection_mode: 'range',
		collection_generation_id: COLLECTION_GENERATION,
		first_available_date: refs[0]?.coverage_start ?? null,
		last_available_date: refs.at(-1)?.coverage_end ?? null,
		gaps,
		partitions: refs,
		metrics,
	});
}

function partition(month: string, days: Array<Record<string, unknown>>): NetworkHistoryPartition {
	return NetworkHistoryPartitionSchema.parse({ generated_utc: GENERATED, month, days });
}

const WINDOW: DateWindow = { from: '2026-01-31', to: '2026-02-03' };

function completeFixture(): {
	index: HistoricCollectionIndex;
	partitions: NetworkHistoryPartition[];
} {
	const january = partition('2026-01', [
		{
			date: '2026-01-31',
			delay: {
				observation_count: 100,
				in_clamp_observation_count: 80,
				on_time_count: 60,
				severe_count: 10,
				sum_delay_seconds: 4800,
			},
			delay_percentiles: {
				observation_count: 20,
				p50_delay_seconds: 60,
				p90_delay_seconds: 300,
			},
			vehicles: 12,
			cancellation: {
				canceled_trip_days: 2,
				total_trip_days: 20,
				scheduled_trip_days: 20,
				delivered_trip_days: 18,
				silent_trip_days: 1,
			},
			occupancy: { empty: 1, many_seats: 2, few_seats: 3, standing: 4, full: 0 },
		},
	]);
	const february = partition('2026-02', [
		{
			date: '2026-02-01',
			delay: {
				observation_count: 50,
				in_clamp_observation_count: 50,
				on_time_count: 50,
				severe_count: 0,
				sum_delay_seconds: 0,
			},
			delay_percentiles: {
				observation_count: 10,
				p50_delay_seconds: 0,
				p90_delay_seconds: 0,
			},
			vehicles: 1,
			cancellation: {
				canceled_trip_days: 0,
				total_trip_days: 10,
				scheduled_trip_days: 5,
				delivered_trip_days: 6,
				silent_trip_days: 0,
			},
			occupancy: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 10 },
		},
		{
			date: '2026-02-03',
			delay: {
				observation_count: 10,
				in_clamp_observation_count: 10,
				on_time_count: 0,
				severe_count: 0,
				sum_delay_seconds: -30,
			},
		},
	]);
	const refs = [
		partitionRef('2026-01', 'a', '2026-01-31', '2026-01-31', 1),
		partitionRef('2026-02', 'b', '2026-02-01', '2026-02-03', 2),
	];
	return {
		index: collectionIndex(refs, metricCoverages(WINDOW.from, WINDOW.to)),
		partitions: [february, january],
	};
}

describe('buildRetainedNetworkTrend', () => {
	it('emits exact sparse daily points, preserving real zero and daily-only p90/vehicles', () => {
		const { index, partitions } = completeFixture();
		const result = buildRetainedNetworkTrend(index, partitions, WINDOW);

		expect(result.status).toBe('complete');
		expect(result.value?.series.map((point) => point.date)).toEqual([
			'2026-01-31',
			'2026-02-01',
			'2026-02-03',
		]);
		expect(result.value?.series[0]).toMatchObject({
			otp_pct: 60,
			avg_delay_min: 1,
			p90_min: 5,
			vehicles: 12,
			cancellation_rate: 10,
			service_completeness_rate: 90,
			observation_count: 100,
			wilson_lo: wilsonBounds(60, 100)?.[0],
			wilson_hi: wilsonBounds(60, 100)?.[1],
		});
		expect(result.value?.series[1]).toMatchObject({
			otp_pct: 100,
			avg_delay_min: 0,
			p90_min: 0,
			vehicles: 1,
			cancellation_rate: 0,
			service_completeness_rate: 100,
			occupancy_mix: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 1 },
		});
		expect(result.value?.series[2]).toMatchObject({
			avg_delay_min: -0.1,
			p90_min: null,
			vehicles: null,
		});
	});

	it('pools clipped ISO weeks and calendar months through additive ingredients only', () => {
		const { index, partitions } = completeFixture();
		const value = buildRetainedNetworkTrend(index, partitions, WINDOW).value!;

		expect(value.weekly.map((point) => point.date)).toEqual(['2026-01-26', '2026-02-02']);
		expect(value.weekly[0]).toMatchObject({
			otp_pct: 73,
			avg_delay_min: 0.6,
			p90_min: null,
			vehicles: null,
			cancellation_rate: 6.67,
			service_completeness_rate: 96,
			observation_count: 150,
			wilson_lo: wilsonBounds(110, 150)?.[0],
			wilson_hi: wilsonBounds(110, 150)?.[1],
			occupancy_mix: {
				empty: 0.05,
				many_seats: 0.1,
				few_seats: 0.15,
				standing: 0.2,
				full: 0.5,
			},
		});
		expect(value.weekly[1]).toMatchObject({
			otp_pct: 0,
			avg_delay_min: -0.1,
			p90_min: null,
			vehicles: null,
		});
		expect(value.monthly.map((point) => point.date)).toEqual(['2026-01-01', '2026-02-01']);
		expect(value.monthly[1]).toMatchObject({
			otp_pct: 83,
			avg_delay_min: 0,
			p90_min: null,
			vehicles: null,
			observation_count: 60,
		});
	});

	it('rounds an exact cancellation tie away from zero using decimal semantics', () => {
		const date = '2026-02-01';
		const ref = partitionRef('2026-02', 'c', date, date, 1);
		const index = collectionIndex([ref], [coverage('cancellation', 'additive', date, date)]);
		const loaded = partition('2026-02', [
			{
				date,
				cancellation: {
					canceled_trip_days: 201,
					total_trip_days: 20_000,
				},
			},
		]);

		const result = buildRetainedNetworkTrend(index, [loaded], { from: date, to: date });

		expect(result.value?.series[0]?.cancellation_rate).toBe(1.01);
	});

	it('reports partial when only a subset of retained metrics covers the selected range', () => {
		const ref = partitionRef('2026-02', 'd', '2026-02-01', '2026-02-01', 1);
		const index = collectionIndex(
			[ref],
			[coverage('delay', 'additive', '2026-02-01', '2026-02-01')],
		);
		const loaded = partition('2026-02', [
			{
				date: '2026-02-01',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 10,
					on_time_count: 0,
					severe_count: 0,
					sum_delay_seconds: 0,
				},
			},
		]);

		expect(
			buildRetainedNetworkTrend(index, [loaded], {
				from: '2026-02-01',
				to: '2026-02-01',
			}),
		).toMatchObject({
			status: 'partial',
			value: { series: [{ otp_pct: 0, avg_delay_min: 0, observation_count: 10 }] },
		});
	});

	it('keeps daily-only vehicle data as a partial daily point without fabricating coarse data', () => {
		const ref = partitionRef('2026-02', 'e', '2026-02-01', '2026-02-01', 1);
		const index = collectionIndex(
			[ref],
			[coverage('vehicles', 'daily_only', '2026-02-01', '2026-02-01')],
		);
		const loaded = partition('2026-02', [{ date: '2026-02-01', vehicles: 7 }]);

		expect(
			buildRetainedNetworkTrend(index, [loaded], {
				from: '2026-02-01',
				to: '2026-02-01',
			}),
		).toEqual({
			status: 'partial',
			value: {
				series: [
					{
						date: '2026-02-01',
						otp_pct: null,
						avg_delay_min: null,
						p90_min: null,
						vehicles: 7,
						cancellation_rate: null,
						service_completeness_rate: null,
						occupancy_mix: null,
						observation_count: null,
						wilson_lo: null,
						wilson_hi: null,
					},
				],
				weekly: [],
				monthly: [],
			},
		});
	});

	it('keeps independently retained p90 data when additive delay is unavailable', () => {
		const date = '2026-02-01';
		const ref = partitionRef('2026-02', 'f', date, date, 1);
		const index = collectionIndex([ref], [coverage('delay_percentiles', 'daily_only', date, date)]);
		const loaded = partition('2026-02', [
			{
				date,
				delay_percentiles: {
					observation_count: 10,
					p50_delay_seconds: 60,
					p90_delay_seconds: 120,
				},
			},
		]);

		const result = buildRetainedNetworkTrend(index, [loaded], { from: date, to: date });

		expect(result).toMatchObject({
			status: 'partial',
			value: {
				series: [{ date, otp_pct: null, avg_delay_min: null, p90_min: 2 }],
				weekly: [],
				monthly: [],
			},
		});
	});

	it('returns honest no_data for an empty retained collection', () => {
		const empty = collectionIndex([], []);

		expect(
			buildRetainedNetworkTrend(empty, [], {
				from: '2026-02-01',
				to: '2026-02-28',
			}),
		).toEqual({ status: 'no_data', value: null });
	});
});
