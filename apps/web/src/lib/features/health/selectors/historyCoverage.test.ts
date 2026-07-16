import { describe, expect, it } from 'vitest';
import type { HistoricAvailabilityIndex, IsoUtc } from '$lib/v1/schemas';
import {
	LINE_CURRENT_ONLY_SECTIONS,
	NETWORK_CURRENT_ONLY_SECTIONS,
	STOP_CURRENT_ONLY_SECTIONS,
} from '$lib/v1/history/families';
import { selectHistoryCoverage } from './historyCoverage';

const iso = (value: string) => value as unknown as IsoUtc;

function root(
	families: NonNullable<HistoricAvailabilityIndex['families']>,
): HistoricAvailabilityIndex {
	return { generated_utc: iso('2026-07-14T12:00:00Z'), families };
}

describe('selectHistoryCoverage', () => {
	it('orders the seven public families and preserves their real windows, gaps, and metric semantics', () => {
		const rows = selectHistoryCoverage(
			root([
				{
					family: 'network',
					selection_mode: 'range',
					index_path: 'historic/history/network/index.json',
					first_available_date: '2026-05-01',
					last_available_date: '2026-07-13',
					gaps: [
						{
							start_date: '2026-06-02',
							end_date: '2026-06-03',
							reason: 'source outage',
						},
					],
					metrics: [
						{
							metric: 'delay',
							aggregation: 'additive',
							first_available_date: '2026-05-01',
							last_available_date: '2026-07-13',
							gaps: [],
						},
						{
							metric: 'delay_percentiles',
							aggregation: 'daily_only',
							first_available_date: '2026-05-05',
							last_available_date: '2026-07-12',
							gaps: [{ start_date: '2026-06-10', end_date: '2026-06-10', reason: null }],
						},
						{
							metric: 'vehicles',
							aggregation: 'daily_only',
							first_available_date: '2026-05-01',
							last_available_date: '2026-07-13',
						},
					],
				},
				{
					family: 'repeat_offenders',
					selection_mode: 'date',
					index_path: 'historic/history/repeat_offenders/index.json',
					first_available_date: '2026-06-01',
					last_available_date: '2026-07-13',
				},
				{
					family: 'alerts',
					selection_mode: 'range',
					index_path: 'historic/alerts/index.json',
					first_available_date: '2026-05-20',
					last_available_date: '2026-07-14',
				},
				{
					family: 'receipts',
					selection_mode: 'date',
					index_path: 'historic/receipts/index.json',
					first_available_date: '2026-06-12',
					last_available_date: '2026-07-13',
				},
				{
					family: 'lines',
					selection_mode: 'range',
					index_path: 'historic/history/lines/index.json',
					first_available_date: '2026-05-01',
					last_available_date: '2026-07-13',
				},
				{
					family: 'stops',
					selection_mode: 'range',
					index_path: 'historic/history/stops/index.json',
					first_available_date: '2026-05-08',
					last_available_date: '2026-07-13',
				},
				{
					family: 'hotspots',
					selection_mode: 'date',
					index_path: 'historic/history/hotspots/index.json',
					first_available_date: '2026-06-01',
					last_available_date: '2026-07-13',
				},
			]),
		);

		expect(rows.map((row) => row.key)).toEqual([
			'alerts',
			'receipts',
			'network',
			'lines',
			'stops',
			'hotspots',
			'repeat_offenders',
		]);
		expect(rows[2]).toMatchObject({
			published: true,
			selectionMode: 'range',
			firstDate: '2026-05-01',
			lastDate: '2026-07-13',
			gaps: [{ startDate: '2026-06-02', endDate: '2026-06-03', reason: 'source outage' }],
			currentOnlySections: [...NETWORK_CURRENT_ONLY_SECTIONS],
			metrics: [
				{
					key: 'delay',
					aggregation: 'additive',
					firstDate: '2026-05-01',
					lastDate: '2026-07-13',
					gaps: [],
				},
				{
					key: 'delay_percentiles',
					aggregation: 'daily_only',
					firstDate: '2026-05-05',
					lastDate: '2026-07-12',
					gaps: [{ startDate: '2026-06-10', endDate: '2026-06-10', reason: null }],
				},
				{
					key: 'vehicles',
					aggregation: 'daily_only',
					firstDate: '2026-05-01',
					lastDate: '2026-07-13',
					gaps: null,
				},
			],
		});
		expect(rows[3]?.currentOnlySections).toEqual([...LINE_CURRENT_ONLY_SECTIONS]);
		expect(rows[4]?.currentOnlySections).toEqual([...STOP_CURRENT_ONLY_SECTIONS]);
		expect(rows[0]?.currentOnlySections).toEqual([]);
	});

	it('keeps missing expected families as honest unavailable rows once a real root exists', () => {
		const rows = selectHistoryCoverage(
			root([
				{
					family: 'alerts',
					selection_mode: 'range',
					index_path: 'historic/alerts/index.json',
				},
			]),
		);

		expect(rows).toHaveLength(7);
		expect(rows[0]).toMatchObject({ key: 'alerts', published: true });
		expect(rows[1]).toMatchObject({
			key: 'receipts',
			published: false,
			selectionMode: null,
			firstDate: null,
			lastDate: null,
			gaps: null,
			metrics: [],
		});
	});

	it('marks live vehicles current-only only when that exact published metric says so', () => {
		const base = {
			family: 'network',
			selection_mode: 'range' as const,
			index_path: 'historic/history/network/index.json',
		};
		const daily = selectHistoryCoverage(
			root([{ ...base, metrics: [{ metric: 'vehicles', aggregation: 'daily_only' }] }]),
		);
		const current = selectHistoryCoverage(
			root([{ ...base, metrics: [{ metric: 'vehicles', aggregation: 'current_only' }] }]),
		);

		expect(
			daily
				.find((row) => row.key === 'network')
				?.metrics.find((metric) => metric.key === 'vehicles')?.aggregation,
		).toBe('daily_only');
		expect(
			current
				.find((row) => row.key === 'network')
				?.metrics.find((metric) => metric.key === 'vehicles')?.aggregation,
		).toBe('current_only');
	});

	it('stands down for a missing or legacy root with no family inventory', () => {
		expect(selectHistoryCoverage(null)).toEqual([]);
		expect(selectHistoryCoverage(undefined)).toEqual([]);
		expect(selectHistoryCoverage(root([]))).toEqual([]);
		expect(selectHistoryCoverage({ generated_utc: iso('2026-07-14T12:00:00Z') })).toEqual([]);
	});
});
