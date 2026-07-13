import { describe, expect, it } from 'vitest';
import { ManifestSchema } from './manifest';
import {
	HistoricAvailabilityIndexSchema,
	HistoricCancellationMetricSchema,
	HistoricCollectionIndexSchema,
	HistoricCoverageGapSchema,
	HistoricDelayMetricSchema,
	HistoricDelayPercentilesSchema,
	HistoricEntityDirectoryIndexSchema,
	HistoricEntityIndexRefSchema,
	HistoricFamilyAvailabilitySchema,
	HistoricMetricCoverageSchema,
	HistoricOccupancyMetricSchema,
	HistoricPartitionRefSchema,
	HistoricSkippedStopMetricSchema,
	LineHistoryDaySchema,
	LineHistoryPartitionSchema,
	NetworkHistoryDaySchema,
	NetworkHistoryPartitionSchema,
	StopHistoryDaySchema,
	StopHistoryPartitionSchema,
	HistoryMetricAggregationSchema,
	HistoryMetricNameSchema,
	HistorySelectionModeSchema,
	type HistoricAvailabilityIndex,
	type HistoricCollectionIndex,
} from './history';

const ISO = '2026-07-13T12:00:00Z';

describe('shared retained-history schemas', () => {
	it('parses the exact selection-mode vocabulary and rejects drift', () => {
		expect(HistorySelectionModeSchema.parse('range')).toBe('range');
		expect(HistorySelectionModeSchema.parse('date')).toBe('date');
		expect(() => HistorySelectionModeSchema.parse('month')).toThrow();
	});

	it('parses coverage gaps and partition refs with honest nullable defaults', () => {
		const gap = HistoricCoverageGapSchema.parse({
			start_date: '2026-03-08',
			end_date: '2026-03-09',
		});
		const partition = HistoricPartitionRefSchema.parse({
			path: 'historic/alerts/generations/a/page.json',
			coverage_start: '2026-03-01',
			coverage_end: '2026-03-31',
			count: null,
			sha256: null,
		});

		expect(gap.reason).toBeUndefined();
		expect(partition.count).toBeNull();
		expect(partition.sha256).toBeNull();
		expect(() =>
			HistoricPartitionRefSchema.parse({
				path: 'historic/example.json',
				coverage_start: '2026-03-01',
				coverage_end: '2026-03-31',
				count: -1,
			}),
		).toThrow();
		expect(() =>
			HistoricPartitionRefSchema.parse({
				path: 'historic/example.json',
				coverage_start: '2026-03-01',
				coverage_end: '2026-03-31',
				sha256: 'abc',
			}),
		).toThrow();
		expect(() =>
			HistoricPartitionRefSchema.parse({
				path: 'historic/example.json',
				coverage_start: '2026-03-01',
				coverage_end: '2026-03-31',
				byte_size: 0,
			}),
		).toThrow();
	});

	it('round-trips a collection index with exact additive fields', () => {
		const parsed: HistoricCollectionIndex = HistoricCollectionIndexSchema.parse({
			generated_utc: ISO,
			family: 'alerts',
			selection_mode: 'range',
			entity_id: null,
			collection_generation_id: 'generation-1',
			first_available_date: '2026-03-01',
			last_available_date: '2026-03-31',
			available_dates: ['2026-03-01'],
			gaps: [{ start_date: '2026-03-08', end_date: '2026-03-09', reason: 'provider outage' }],
			partitions: [
				{
					path: 'historic/example.json',
					coverage_start: '2026-03-01',
					coverage_end: '2026-03-31',
					count: 0,
				},
			],
		});

		expect(parsed.selection_mode).toBe('range');
		expect(parsed.gaps?.[0]?.reason).toBe('provider outage');
		expect(parsed.partitions?.[0]?.count).toBe(0);
	});

	it('round-trips the family availability index and minimal additive forms', () => {
		const family = HistoricFamilyAvailabilitySchema.parse({
			family: 'receipts',
			selection_mode: 'date',
			index_path: 'historic/receipts/index.json',
			first_available_date: null,
			last_available_date: null,
		});
		const parsed: HistoricAvailabilityIndex = HistoricAvailabilityIndexSchema.parse({
			generated_utc: ISO,
			families: [family],
		});

		expect(parsed.families?.[0]?.selection_mode).toBe('date');
		expect(
			HistoricCollectionIndexSchema.parse({
				generated_utc: ISO,
				family: 'receipts',
				selection_mode: 'date',
			}),
		).toMatchObject({ family: 'receipts' });
		expect(HistoricAvailabilityIndexSchema.parse({ generated_utc: ISO })).toMatchObject({
			generated_utc: ISO,
		});
	});

	it('mirrors the closed metric vocabulary and additive collection fields', () => {
		expect(HistoryMetricAggregationSchema.parse('daily_only')).toBe('daily_only');
		expect(HistoryMetricNameSchema.parse('skipped_stops')).toBe('skipped_stops');
		expect(() => HistoryMetricNameSchema.parse('made_up')).toThrow();

		const metric = HistoricMetricCoverageSchema.parse({
			metric: 'delay',
			aggregation: 'additive',
			first_available_date: '2026-05-01',
			last_available_date: '2026-06-30',
		});
		const family = HistoricFamilyAvailabilitySchema.parse({
			family: 'network',
			selection_mode: 'range',
			index_path: 'historic/history/network/index.json',
			collection_generation_id: 'network-generation',
			metrics: [metric],
		});

		expect(family.collection_generation_id).toBe('network-generation');
		expect(family.metrics?.[0]?.metric).toBe('delay');
	});

	it('pins entity directory identity, family, range mode, and child generation', () => {
		const entityId = 'A/B';
		const encodedId = '412f42';
		const ref = HistoricEntityIndexRefSchema.parse({
			entity_id: entityId,
			encoded_id: encodedId,
			index_path: `historic/history/lines/${encodedId}/index.json`,
			collection_generation_id: 'line-generation',
		});
		const directory = HistoricEntityDirectoryIndexSchema.parse({
			generated_utc: ISO,
			family: 'lines',
			selection_mode: 'range',
			collection_generation_id: 'directory-generation',
			entities: [ref],
		});

		expect(directory.entities?.[0]?.entity_id).toBe(entityId);
		expect(() =>
			HistoricEntityIndexRefSchema.parse({
				entity_id: entityId,
				encoded_id: encodedId,
				index_path: `historic/history/lines/${encodedId}/index.json`,
			}),
		).toThrow();
		expect(() => HistoricEntityIndexRefSchema.parse({ ...ref, encoded_id: '4142' })).toThrow();
		expect(() =>
			HistoricEntityDirectoryIndexSchema.parse({
				...directory,
				family: 'network',
			}),
		).toThrow();
		expect(() =>
			HistoricEntityDirectoryIndexSchema.parse({
				...directory,
				selection_mode: 'date',
			}),
		).toThrow();
		expect(() =>
			HistoricEntityDirectoryIndexSchema.parse({
				...directory,
				entities: [{ ...ref, index_path: `historic/history/stops/${encodedId}/index.json` }],
			}),
		).toThrow();
	});

	it('reports lone-surrogate entity IDs as Zod validation failures without throwing', () => {
		const parse = () =>
			HistoricEntityIndexRefSchema.safeParse({
				entity_id: '\ud800',
				encoded_id: 'efbfbd',
				index_path: 'historic/history/lines/efbfbd/index.json',
				collection_generation_id: 'line-generation',
			});

		expect(parse).not.toThrow();
		expect(parse()).toMatchObject({ success: false });
	});

	it('rejects impossible additive and daily-only metric shapes', () => {
		const delay = {
			observation_count: 10,
			in_clamp_observation_count: 8,
			on_time_count: 6,
			severe_count: 2,
			sum_delay_seconds: 240,
		};
		expect(HistoricDelayMetricSchema.parse(delay).observation_count).toBe(10);
		for (const invalid of [
			{ ...delay, observation_count: 0 },
			{ ...delay, on_time_count: 11 },
			{ ...delay, severe_count: 11 },
			{ ...delay, in_clamp_observation_count: 11 },
			{ observation_count: 10, sum_delay_seconds: 1 },
		]) {
			expect(() => HistoricDelayMetricSchema.parse(invalid)).toThrow();
		}

		expect(() => HistoricDelayPercentilesSchema.parse({ observation_count: 3 })).toThrow();
		expect(() =>
			HistoricCancellationMetricSchema.parse({ canceled_trip_days: 2, total_trip_days: 1 }),
		).toThrow();
		expect(() =>
			HistoricCancellationMetricSchema.parse({ canceled_trip_days: 0, total_trip_days: 0 }),
		).toThrow();
		expect(
			HistoricCancellationMetricSchema.parse({
				canceled_trip_days: 0,
				total_trip_days: 0,
				scheduled_trip_days: 4,
			}).scheduled_trip_days,
		).toBe(4);
		expect(() =>
			HistoricOccupancyMetricSchema.parse({
				empty: 0,
				many_seats: 0,
				few_seats: 0,
				standing: 0,
				full: 0,
			}),
		).toThrow();
		expect(() =>
			HistoricSkippedStopMetricSchema.parse({
				skipped_stop_count: 3,
				stop_time_update_count: 2,
			}),
		).toThrow();
	});

	it('validates monthly partition dates, ordering, membership, and honest day presence', () => {
		const delay = { observation_count: 2, in_clamp_observation_count: 2, sum_delay_seconds: 60 };
		const valid = {
			generated_utc: ISO,
			month: '2026-06',
			days: [{ date: '2026-06-01', delay }],
		};
		expect(NetworkHistoryPartitionSchema.parse(valid).days).toHaveLength(1);
		expect(LineHistoryPartitionSchema.parse({ ...valid, entity_id: 'A/B' }).entity_id).toBe('A/B');
		expect(StopHistoryPartitionSchema.parse({ ...valid, entity_id: 'Édouard' }).entity_id).toBe(
			'Édouard',
		);

		for (const daySchema of [NetworkHistoryDaySchema, LineHistoryDaySchema, StopHistoryDaySchema]) {
			expect(() => daySchema.parse({ date: '2026-06-01' })).toThrow();
		}
		expect(() => NetworkHistoryDaySchema.parse({ date: '2026-06-01', vehicles: 0 })).toThrow();
		for (const invalid of [
			{ ...valid, month: '2026-6' },
			{ ...valid, month: '2026-13' },
			{ ...valid, days: [] },
			{
				...valid,
				days: [
					{ date: '2026-06-02', delay },
					{ date: '2026-06-01', delay },
				],
			},
			{
				...valid,
				days: [
					{ date: '2026-06-01', delay },
					{ date: '2026-06-01', vehicles: 1 },
				],
			},
			{ ...valid, days: [{ date: '2026-05-31', delay }] },
		]) {
			expect(() => NetworkHistoryPartitionSchema.parse(invalid)).toThrow();
		}
	});

	it('matches Python date.fromisoformat for early valid years and year zero', () => {
		const occupancy = {
			empty: 1,
			many_seats: 0,
			few_seats: 0,
			standing: 0,
			full: 0,
		};
		for (const daySchema of [NetworkHistoryDaySchema, LineHistoryDaySchema, StopHistoryDaySchema]) {
			for (const date of ['0001-01-01', '0099-12-31']) {
				expect(daySchema.parse({ date, occupancy }).date).toBe(date);
			}
			expect(() => daySchema.parse({ date: '0000-01-01', occupancy })).toThrow();
		}
	});
});

describe('manifest historic history pointer compatibility', () => {
	const base = {
		provider: 'stm',
		display_name: 'STM',
		bbox: [-73.97, 45.4, -73.47, 45.7],
		attribution: 'STM',
		dataset_version: '2026.07.13',
		labels: {},
		surfaces: [],
	};

	it('accepts an old manifest with no history_index pointer', () => {
		const parsed = ManifestSchema.parse({
			...base,
			files: { live: { generated_utc: ISO }, historic: {} },
		});
		expect(parsed.files.historic?.history_index).toBeUndefined();
	});

	it('accepts the additive history_index pointer', () => {
		const parsed = ManifestSchema.parse({
			...base,
			files: {
				live: { generated_utc: ISO },
				historic: { history_index: 'historic/history/index.json' },
			},
		});
		expect(parsed.files.historic?.history_index).toBe('historic/history/index.json');
	});
});
