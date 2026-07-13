import { describe, expect, it } from 'vitest';
import { ManifestSchema } from './manifest';
import {
	HistoricAvailabilityIndexSchema,
	HistoricCollectionIndexSchema,
	HistoricCoverageGapSchema,
	HistoricFamilyAvailabilitySchema,
	HistoricPartitionRefSchema,
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
