import { describe, expect, it } from 'vitest';
import type { NetworkFile } from '#lib/v1/schemas/network.ts';
import type { Hotspots } from '#lib/v1/schemas/generated/historic_hotspots.ts';
import { selectLivePulse, selectWorst } from './homePulse';

function network(overrides: Partial<NetworkFile> = {}): NetworkFile {
	return {
		schema_version: 1,
		generated_utc: '2026-11-12T23:50:24Z',
		vehicles_in_service: 355,
		on_time_pct: 57,
		status_dist: { on_time: 69, late: 78, severe: 42, early: 71, unknown: 95 },
		delay_p50_min: 0,
		delay_p90_min: 5,
		occupancy_mix: null,
		non_responding: 18,
		feed_freshness_s: 20,
		coverage_pct: 73,
		...overrides,
	} as NetworkFile;
}

describe('selectLivePulse', () => {
	it('reports buses more than five minutes late against buses with a delay reading', () => {
		expect(selectLivePulse(network())).toEqual({
			inService: 355,
			onTimePct: 57,
			severeLate: 42,
			withReading: 260,
			early: 71,
			notReporting: 18,
		});
	});

	it('never turns a missing delay reading into a reassuring zero', () => {
		const pulse = selectLivePulse(
			network({
				vehicles_in_service: 12,
				on_time_pct: null,
				status_dist: { on_time: 0, late: 0, severe: 0, early: 0, unknown: 12 },
			}),
		);
		expect(pulse?.severeLate).toBeNull();
		expect(pulse?.early).toBeNull();
		expect(pulse?.onTimePct).toBeNull();
	});

	it('has nothing to say before the live snapshot arrives', () => {
		expect(selectLivePulse(null)).toBeNull();
	});
});

describe('selectWorst', () => {
	const routes = [
		{ id: '7-354', short: '7' },
		{ id: '11', short: '11' },
	];
	const hotspots = {
		generated_utc: '2026-11-11T00:00:00Z',
		by_grain: [
			{ grain: 'day', date: '2026-11-10', entries: [{ id: '99', type: 'route', rank: 1 }] },
			{
				grain: 'week',
				date: '2026-11-04',
				window_end: '2026-11-10',
				entries: [
					{ id: 'S9', type: 'stop', rank: 3, name: 'RIDEAU / SUSSEX', severe_pct: 21.5 },
					{ id: '11', type: 'route', rank: 2, name: 'Waller <> Bayshore', severe_pct: 19 },
					{ id: '7-354', type: 'route', rank: 1, name: 'Carleton <> St-Laurent', severe_pct: 24 },
					{ id: 'S1', type: 'stop', rank: 4, name: null, severe_pct: null },
				],
			},
		],
	} as Hotspots;

	it('ranks the published week: lines by number first, stops by readable name', () => {
		const worst = selectWorst(hotspots, routes);
		expect(worst?.through).toBe('2026-11-10');
		expect(worst?.lines.map((line) => [line.label, line.detail])).toEqual([
			['7', 'Carleton <> St-Laurent'],
			['11', 'Waller <> Bayshore'],
		]);
		expect(worst?.stops.map((stop) => [stop.id, stop.label, stop.severePct])).toEqual([
			['S9', 'Rideau / Sussex', 21.5],
			['S1', 'S1', null],
		]);
	});

	it('keeps the first of any repeated entry, so a malformed file cannot break the list', () => {
		const repeated = {
			...hotspots,
			by_grain: [
				{
					grain: 'week',
					entries: [
						{ id: '11', type: 'route', rank: 1, name: 'Waller <> Bayshore', severe_pct: 30 },
						{ id: '11', type: 'route', rank: 2, name: 'Waller <> Bayshore', severe_pct: 20 },
						{ id: '11', type: 'stop', rank: 3, name: 'STOP ELEVEN', severe_pct: 10 },
					],
				},
			],
		} as Hotspots;
		const worst = selectWorst(repeated, routes);
		expect(worst?.lines.map((line) => [line.id, line.severePct])).toEqual([['11', 30]]);
		expect(worst?.stops.map((stop) => stop.id)).toEqual(['11']);
	});

	it('caps each list and reports absence when no daily ranking is published', () => {
		expect(selectWorst(hotspots, routes, { limit: 1 })?.lines).toHaveLength(1);
		expect(selectWorst(hotspots, routes, { grain: 'day' })?.lines.map((l) => l.id)).toEqual(['99']);
		expect(selectWorst({ ...hotspots, by_grain: [] }, routes)).toBeNull();
		expect(selectWorst(null, routes)).toBeNull();
	});
});
