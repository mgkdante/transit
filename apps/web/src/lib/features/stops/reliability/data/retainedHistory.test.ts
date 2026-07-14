import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DateWindow } from '$lib/filters';
import { encodeHistoryEntityId } from '$lib/v1/history/entity';
import {
	HistoricCollectionIndexSchema,
	StopHistoryPartitionSchema,
	type HistoricCollectionIndex,
	type HistoricMetricCoverage,
	type HistoricPartitionRef,
	type IsoUtc,
	type StopHistoryPartition,
	type StopReliability,
} from '$lib/v1/schemas';
import {
	applyRetainedStopHistory,
	buildRetainedStopHistory,
	clearRetainedStopHistory,
} from './retainedHistory';

vi.mock('$lib/v1', async () => ({
	...(await import('$lib/v1/history/families')),
}));

const GENERATED = '2026-07-13T12:00:00Z' as IsoUtc;
const COLLECTION_GENERATION = 'c'.repeat(64);
const ENTITY_ID = '../A/B?é';
const WINDOW: DateWindow = { from: '2026-01-31', to: '2026-02-01' };

function coverage(
	metric: HistoricMetricCoverage['metric'],
	aggregation: HistoricMetricCoverage['aggregation'],
	first: string | null,
	last: string | null,
): HistoricMetricCoverage {
	return {
		metric,
		aggregation,
		first_available_date: first,
		last_available_date: last,
		gaps: [],
	};
}

function partitionRef(
	month: string,
	shaCharacter: string,
	coverageStart: string,
	coverageEnd: string,
): HistoricPartitionRef {
	const sha256 = shaCharacter.repeat(64);
	return {
		path: `historic/history/stops/${encodeHistoryEntityId(ENTITY_ID)}/generations/${sha256}/${month}.json`,
		coverage_start: coverageStart,
		coverage_end: coverageEnd,
		count: 1,
		sha256,
		byte_size: 100,
	};
}

function collectionIndex(
	refs: readonly HistoricPartitionRef[],
	metrics: readonly HistoricMetricCoverage[],
	first: string | null,
	last: string | null,
): HistoricCollectionIndex {
	return HistoricCollectionIndexSchema.parse({
		generated_utc: GENERATED,
		family: 'stops',
		selection_mode: 'range',
		entity_id: ENTITY_ID,
		collection_generation_id: COLLECTION_GENERATION,
		first_available_date: first,
		last_available_date: last,
		gaps: [],
		partitions: refs,
		metrics,
	});
}

function partition(month: string, days: Array<Record<string, unknown>>): StopHistoryPartition {
	return StopHistoryPartitionSchema.parse({
		generated_utc: GENERATED,
		month,
		entity_id: ENTITY_ID,
		days,
	});
}

function crossMonthFixture(): {
	index: HistoricCollectionIndex;
	partitions: StopHistoryPartition[];
} {
	const january = partition('2026-01', [
		{
			date: '2026-01-31',
			delay: {
				observation_count: 80,
				in_clamp_observation_count: 80,
				severe_count: 8,
				sum_delay_seconds: 4_800,
			},
			occupancy: { empty: 0, many_seats: 5, few_seats: 3, standing: 2, full: 0 },
		},
	]);
	const february = partition('2026-02', [
		{
			date: '2026-02-01',
			delay: {
				observation_count: 20,
				in_clamp_observation_count: 20,
				severe_count: 0,
				sum_delay_seconds: 0,
			},
		},
	]);
	const refs = [
		partitionRef('2026-01', 'a', '2026-01-31', '2026-01-31'),
		partitionRef('2026-02', 'b', '2026-02-01', '2026-02-01'),
	];
	return {
		index: collectionIndex(
			refs,
			[
				coverage('delay', 'additive', WINDOW.from, WINDOW.to),
				coverage('occupancy', 'additive', WINDOW.from, WINDOW.from),
			],
			WINDOW.from,
			WINDOW.to,
		),
		partitions: [february, january],
	};
}

describe('buildRetainedStopHistory', () => {
	it('uses the public $lib/v1 barrel from Stop feature production files', () => {
		for (const file of ['retainedHistory.ts', 'stopHistoryResource.svelte.ts']) {
			const source = readFileSync(
				resolve(process.cwd(), 'src/lib/features/stops/reliability/data', file),
				'utf8',
			);
			expect(source).not.toMatch(/from '\$lib\/v1\//);
		}
	});

	it('pools the exact cross-month severe-delay proxy and average ingredients', () => {
		const { index, partitions } = crossMonthFixture();
		const result = buildRetainedStopHistory(ENTITY_ID, index, partitions, WINDOW);

		expect(result.value?.aggregate).toMatchObject({
			family: 'stops',
			entityId: ENTITY_ID,
			window: WINDOW,
			delay: {
				status: 'complete',
				value: {
					observationCount: 100,
					inClampObservationCount: 100,
					severeCount: 8,
					sumDelaySeconds: 4_800,
					severePct: 8,
					averageDelaySeconds: 48,
				},
			},
		});
		expect(result.value?.retainedDayCount).toBe(2);
	});

	it('keeps a measured zero distinct from no data in the dated adapter', () => {
		const { index, partitions } = crossMonthFixture();
		const result = buildRetainedStopHistory(ENTITY_ID, index, partitions, WINDOW);

		expect(result.value?.daily).toEqual([
			{
				date: '2026-01-31',
				observation_count: 80,
				severe_count: 8,
				severe_pct: 10,
				avg_delay_min: 1,
			},
			{
				date: '2026-02-01',
				observation_count: 20,
				severe_count: 0,
				severe_pct: 0,
				avg_delay_min: 0,
			},
		]);

		const empty = collectionIndex([], [], null, null);
		expect(
			buildRetainedStopHistory(ENTITY_ID, empty, [], {
				from: '2026-03-01',
				to: '2026-03-31',
			}),
		).toEqual({ status: 'no_data', value: null });
	});

	it('carries a partial occupancy mix without pretending the window is complete', () => {
		const { index, partitions } = crossMonthFixture();
		const result = buildRetainedStopHistory(ENTITY_ID, index, partitions, WINDOW);

		expect(result.status).toBe('partial');
		expect(result.value?.aggregate.occupancy.status).toBe('partial');
		expect(result.value?.occupancyMix).toEqual({
			empty: 0,
			many_seats: 0.5,
			few_seats: 0.3,
			standing: 0.2,
			full: 0,
		});
	});

	it('replaces only retained fields and never fabricates current-only Stop sections', () => {
		const { index, partitions } = crossMonthFixture();
		const retained = buildRetainedStopHistory(ENTITY_ID, index, partitions, WINDOW).value!;
		const current: StopReliability = {
			generated_utc: GENERATED,
			id: ENTITY_ID,
			name: 'Current stop',
			periods: [
				{ grain: 'week', severe_pct: 9 },
				{ grain: 'am_peak', severe_pct: 12 },
			],
			day_of_week: [{ day_of_week_iso: 1, severe_pct: 7 }],
			by_route: [{ route: '51', avg_delay_min: 1.5 }],
			habits: { scale: 'severe_relative', matrix: [[0.25]] },
			daily: [
				{
					date: '2026-01-01',
					observation_count: 1,
					severe_count: 1,
					severe_pct: 100,
				},
			],
			occupancy_mix: { empty: 1, many_seats: 0, few_seats: 0, standing: 0, full: 0 },
		};

		const applied = applyRetainedStopHistory(current, retained);
		expect(applied.daily).toEqual(retained.daily);
		expect(applied.occupancy_mix).toEqual(retained.occupancyMix);
		expect(applied.periods).toBe(current.periods);
		expect(applied.day_of_week).toBe(current.day_of_week);
		expect(applied.by_route).toBe(current.by_route);
		expect(applied.habits).toBe(current.habits);

		const sparseApplied = applyRetainedStopHistory(
			{ generated_utc: GENERATED, id: ENTITY_ID },
			retained,
		);
		for (const field of ['periods', 'day_of_week', 'by_route', 'habits'] as const) {
			expect(sparseApplied).not.toHaveProperty(field);
		}

		const cleared = clearRetainedStopHistory(current);
		expect(cleared.daily).toEqual([]);
		expect(cleared.occupancy_mix).toBeNull();
		expect(cleared.periods).toBe(current.periods);
		expect(cleared.day_of_week).toBe(current.day_of_week);
		expect(cleared.by_route).toBe(current.by_route);
		expect(cleared.habits).toBe(current.habits);
	});
});
