import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DateWindow } from '$lib/filters';
import { encodeHistoryEntityId } from '$lib/v1/history/entity';
import {
	HistoricCollectionIndexSchema,
	LineHistoryPartitionSchema,
	type HistoricCollectionIndex,
	type HistoricMetricCoverage,
	type HistoricPartitionRef,
	type LineHistoryPartition,
} from '$lib/v1/schemas';
import { wilsonBounds } from '$lib/v1/stats';
import { buildRetainedLineHistory } from './retainedHistory';

vi.mock('$lib/v1', async () => ({
	...(await import('$lib/v1/history/families')),
	wilsonBounds: (await import('$lib/v1/stats')).wilsonBounds,
}));

const GENERATED = '2026-07-13T12:00:00Z';
const COLLECTION_GENERATION = 'c'.repeat(64);
const ENTITY_ID = 'A/B?é';
const WINDOW: DateWindow = { from: '2026-01-31', to: '2026-02-02' };

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

function allLineCoverages(first: string, last: string): HistoricMetricCoverage[] {
	return [
		coverage('delay', 'additive', first, last),
		coverage('delay_percentiles', 'daily_only', first, last),
		coverage('cancellation', 'additive', first, last),
		coverage('occupancy', 'additive', first, last),
		coverage('service_span', 'daily_only', first, last),
		coverage('skipped_stops', 'additive', first, last),
	];
}

function partitionRef(
	entityId: string,
	month: string,
	shaCharacter: string,
	coverageStart: string,
	coverageEnd: string,
	count: number,
): HistoricPartitionRef {
	const sha256 = shaCharacter.repeat(64);
	return {
		path: `historic/history/lines/${encodeHistoryEntityId(entityId)}/generations/${sha256}/${month}.json`,
		coverage_start: coverageStart,
		coverage_end: coverageEnd,
		count,
		sha256,
		byte_size: 100,
	};
}

function collectionIndex(
	entityId: string,
	refs: HistoricPartitionRef[],
	metrics: HistoricMetricCoverage[],
	first: string | null,
	last: string | null,
	gaps: HistoricCollectionIndex['gaps'] = [],
): HistoricCollectionIndex {
	return HistoricCollectionIndexSchema.parse({
		generated_utc: GENERATED,
		family: 'lines',
		selection_mode: 'range',
		entity_id: entityId,
		collection_generation_id: COLLECTION_GENERATION,
		first_available_date: first,
		last_available_date: last,
		gaps,
		partitions: refs,
		metrics,
	});
}

function partition(
	entityId: string,
	month: string,
	days: Array<Record<string, unknown>>,
): LineHistoryPartition {
	return LineHistoryPartitionSchema.parse({
		generated_utc: GENERATED,
		month,
		entity_id: entityId,
		days,
	});
}

function completeFixture(): {
	index: HistoricCollectionIndex;
	partitions: LineHistoryPartition[];
} {
	const january = partition(ENTITY_ID, '2026-01', [
		{
			date: '2026-01-30',
			delay: {
				observation_count: 1_000,
				in_clamp_observation_count: 1_000,
				on_time_count: 1_000,
				severe_count: 0,
				sum_delay_seconds: 60_000,
			},
		},
		{
			date: '2026-01-31',
			delay: {
				observation_count: 100,
				in_clamp_observation_count: 80,
				on_time_count: 60,
				severe_count: 10,
				sum_delay_seconds: 4_800,
			},
			delay_percentiles: {
				observation_count: 20,
				p50_delay_seconds: 60,
				p90_delay_seconds: 300,
			},
			cancellation: {
				canceled_trip_days: 2,
				total_trip_days: 20,
				scheduled_trip_days: 20,
				delivered_trip_days: 18,
				silent_trip_days: 1,
			},
			occupancy: { empty: 1, many_seats: 2, few_seats: 3, standing: 4, full: 0 },
			service_span: {
				trip_count: 3,
				first_trip_utc: '2026-01-31T05:00:00Z',
				last_trip_utc: '2026-01-31T23:00:00Z',
				first_trip_delay_seconds: 0,
				last_trip_delay_seconds: 60,
			},
			skipped_stops: { skipped_stop_count: 0, stop_time_update_count: 10 },
		},
	]);
	const february = partition(ENTITY_ID, '2026-02', [
		{
			date: '2026-02-01',
			delay: {
				observation_count: 20,
				in_clamp_observation_count: 10,
				on_time_count: 10,
				severe_count: 0,
				sum_delay_seconds: 0,
			},
			cancellation: {
				canceled_trip_days: 0,
				total_trip_days: 10,
				scheduled_trip_days: 10,
				delivered_trip_days: 10,
				silent_trip_days: 0,
			},
			occupancy: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 10 },
			service_span: {
				trip_count: 4,
				first_trip_utc: '2026-02-01T05:10:00Z',
				last_trip_utc: '2026-02-01T22:40:00Z',
				first_trip_delay_seconds: -30,
				last_trip_delay_seconds: 30,
			},
			skipped_stops: { skipped_stop_count: 2, stop_time_update_count: 10 },
		},
		{
			date: '2026-02-02',
			delay_percentiles: {
				observation_count: 7,
				p50_delay_seconds: 30,
				p90_delay_seconds: 120,
			},
		},
		{
			date: '2026-02-03',
			delay: {
				observation_count: 1_000,
				in_clamp_observation_count: 1_000,
				on_time_count: 0,
				severe_count: 1_000,
				sum_delay_seconds: -60_000,
			},
		},
	]);
	const refs = [
		partitionRef(ENTITY_ID, '2026-01', 'a', '2026-01-30', '2026-01-31', 2),
		partitionRef(ENTITY_ID, '2026-02', 'b', '2026-02-01', '2026-02-03', 3),
	];
	return {
		index: collectionIndex(
			ENTITY_ID,
			refs,
			allLineCoverages('2026-01-30', '2026-02-03'),
			'2026-01-30',
			'2026-02-03',
		),
		partitions: [february, january],
	};
}

describe('buildRetainedLineHistory', () => {
	it('uses narrow v1 runtime leaves without crossing feature domains', () => {
		const files = [
			'src/lib/features/lines/reliability/data/retainedHistory.ts',
			'src/lib/features/lines/reliability/data/lineHistoryResource.svelte.ts',
			'src/lib/features/lines/RouteDetail.svelte',
			'src/lib/features/lines/reliability/RouteReliabilityClusters.svelte',
			'src/lib/features/lines/reliability/reliability.copy.ts',
		];
		for (const file of files) {
			const source = readFileSync(resolve(process.cwd(), file), 'utf8');
			expect(source).not.toMatch(
				/import\s+(?!type\b)[^;]+from '\$lib\/v1(?:\/(?:schemas|history))?';/,
			);
		}

		const retained = readFileSync(resolve(process.cwd(), files[0]), 'utf8');
		const resource = readFileSync(resolve(process.cwd(), files[1]), 'utf8');
		expect(retained).toContain("from '$lib/v1/history/families'");
		expect(resource).toContain("from '$lib/v1/history/retainedHistoryResource.svelte'");
		expect(resource).toContain("from '$lib/v1/repositories/historic'");
	});

	it('keeps an awkward entity isolated and pools the exact clipped range across months', () => {
		const { index, partitions } = completeFixture();
		const result = buildRetainedLineHistory(ENTITY_ID, index, partitions, WINDOW);

		expect(result.status).toBe('complete');
		// A percentile-only or service-only calendar day does not contribute to the
		// pooled delay reading and must not inflate the range's "N days" claim.
		expect(result.value?.retainedDayCount).toBe(2);
		expect(result.value?.aggregate).toMatchObject({
			family: 'lines',
			entityId: ENTITY_ID,
			window: WINDOW,
			delay: {
				status: 'complete',
				value: {
					observationCount: 120,
					inClampObservationCount: 90,
					onTimeCount: 70,
					severeCount: 10,
					sumDelaySeconds: 4_800,
					otpPct: 70 / 1.2,
					severePct: 100 / 12,
					averageDelaySeconds: 4_800 / 90,
				},
			},
			cancellation: {
				status: 'complete',
				value: {
					canceledTripDays: 2,
					totalTripDays: 30,
					scheduledTripDays: 30,
					deliveredTripDays: 28,
					silentTripDays: 1,
					cancellationRatePct: 20 / 3,
					completenessPct: 280 / 3,
				},
			},
			skippedStops: {
				status: 'complete',
				value: {
					skippedStopCount: 2,
					stopTimeUpdateCount: 20,
					skippedStopRatePct: 10,
				},
			},
		});
		expect(result.value?.occupancyMix).toEqual({
			empty: 0.05,
			many_seats: 0.1,
			few_seats: 0.15,
			standing: 0.2,
			full: 0.5,
		});
	});

	it('emits sparse daily presentation rows with exact daily-only percentiles and real zeros', () => {
		const { index, partitions } = completeFixture();
		const value = buildRetainedLineHistory(ENTITY_ID, index, partitions, WINDOW).value!;

		expect(value.periods.map((period) => period.date)).toEqual([
			'2026-01-31',
			'2026-02-01',
			'2026-02-02',
		]);
		expect(value.periods[0]).toEqual({
			grain: 'day',
			date: '2026-01-31',
			otp_pct: 60,
			avg_delay_min: 1,
			p50_min: 1,
			p90_min: 5,
			severe_pct: 10,
			observation_count: 100,
			on_time: 60,
			wilson_lo: wilsonBounds(60, 100)?.[0],
			wilson_hi: wilsonBounds(60, 100)?.[1],
		});
		expect(value.periods[1]).toMatchObject({
			grain: 'day',
			date: '2026-02-01',
			otp_pct: 50,
			avg_delay_min: 0,
			p50_min: null,
			p90_min: null,
			severe_pct: 0,
			observation_count: 20,
			on_time: 10,
		});
		expect(value.periods[2]).toEqual({
			grain: 'day',
			date: '2026-02-02',
			otp_pct: null,
			avg_delay_min: null,
			p50_min: 0.5,
			p90_min: 2,
			severe_pct: null,
			observation_count: null,
			on_time: null,
			wilson_lo: null,
			wilson_hi: null,
		});
	});

	it('converts cancellation, service-span, and skipped-stop rows without hiding zero', () => {
		const { index, partitions } = completeFixture();
		const value = buildRetainedLineHistory(ENTITY_ID, index, partitions, WINDOW).value!;

		expect(value.cancellations).toEqual([
			{
				grain: 'day',
				date: '2026-01-31',
				cancellation_rate_pct: 10,
				canceled_trip_days: 2,
				total_trip_days: 20,
				scheduled_trip_days: 20,
				delivered_trip_days: 18,
				silent_trip_days: 1,
				service_completeness_pct: 90,
			},
			{
				grain: 'day',
				date: '2026-02-01',
				cancellation_rate_pct: 0,
				canceled_trip_days: 0,
				total_trip_days: 10,
				scheduled_trip_days: 10,
				delivered_trip_days: 10,
				silent_trip_days: 0,
				service_completeness_pct: 100,
			},
		]);
		expect(value.serviceSpans).toEqual([
			{
				date: '2026-01-31',
				first_trip_utc: '2026-01-31T05:00:00Z',
				last_trip_utc: '2026-01-31T23:00:00Z',
				service_span_min: 1_080,
				first_trip_delay_min: 0,
				last_trip_delay_min: 1,
				trip_count: 3,
			},
			{
				date: '2026-02-01',
				first_trip_utc: '2026-02-01T05:10:00Z',
				last_trip_utc: '2026-02-01T22:40:00Z',
				service_span_min: 1_050,
				first_trip_delay_min: -0.5,
				last_trip_delay_min: 0.5,
				trip_count: 4,
			},
		]);
		expect(value.skippedStops).toEqual([
			{
				date: '2026-01-31',
				skipped_stop_rate_pct: 0,
				skipped_stop_count: 0,
				stop_time_update_count: 10,
			},
			{
				date: '2026-02-01',
				skipped_stop_rate_pct: 20,
				skipped_stop_count: 2,
				stop_time_update_count: 10,
			},
		]);
	});

	it('returns a partial value when only delay is retained while preserving zero numerators', () => {
		const date = '2026-02-01';
		const ref = partitionRef(ENTITY_ID, '2026-02', 'd', date, date, 1);
		const index = collectionIndex(
			ENTITY_ID,
			[ref],
			[coverage('delay', 'additive', date, date)],
			date,
			date,
		);
		const loaded = partition(ENTITY_ID, '2026-02', [
			{
				date,
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 10,
					on_time_count: 0,
					severe_count: 0,
					sum_delay_seconds: 0,
				},
			},
		]);

		const result = buildRetainedLineHistory(ENTITY_ID, index, [loaded], {
			from: date,
			to: date,
		});

		expect(result).toMatchObject({
			status: 'partial',
			value: {
				retainedDayCount: 1,
				periods: [
					{
						date,
						otp_pct: 0,
						avg_delay_min: 0,
						severe_pct: 0,
						observation_count: 10,
						on_time: 0,
					},
				],
				cancellations: [],
				occupancyMix: null,
				serviceSpans: [],
				skippedStops: [],
			},
		});
	});

	it('returns honest no_data instead of a zero-filled retained value', () => {
		const empty = collectionIndex(ENTITY_ID, [], [], null, null);

		expect(
			buildRetainedLineHistory(ENTITY_ID, empty, [], {
				from: '2026-02-01',
				to: '2026-02-28',
			}),
		).toEqual({ status: 'no_data', value: null });
	});
});
