import { expect, it, vi } from 'vitest';
vi.mock('$app/navigation', () => ({ goto: () => Promise.resolve() }));
import { searchTransit } from './transitSearch';
import type { Vehicle } from '#lib/v1/schemas/index.ts';
import type { StopIndexEntry } from '#lib/v1/schemas/index.ts';
const vehicle = (id: string): Vehicle => ({
	id,
	lat: 0,
	lon: 0,
	status: 'late',
	updated_utc: '2026-06-16T00:00:00Z' as Vehicle['updated_utc'],
});
const resultIds = (items: readonly { id: string }[]) => items.map(({ id }) => id);

it('keeps unknown modes only without a mode selection', () => {
	const query = 'hub';
	const sources = { routes: [{ id: 'unknown', short: '?', long: 'Hub', type: 999 }] };
	const modes = new Set(['bus'] as const);
	expect(resultIds(searchTransit({ surface: 'header', query }, sources))).toEqual(['unknown']);
	expect(searchTransit({ surface: 'page', query }, sources).routes).toEqual(sources.routes);
	expect(searchTransit({ surface: 'header', query, modes }, sources)).toEqual([]);
	expect(searchTransit({ surface: 'page', query, modes }, sources).routes).toEqual([]);
});

it.each([
	['CRÉMAZIE', 'c', 'Station Crémazie'],
	['cremazie', 'c', 'Station Crémazie'],
	['Berri-UQAM', 'b', 'Station Berri-UQAM'],
	['uqam berri', 'b', 'Station Berri-UQAM'],
])('matches accents and punctuation without changing labels: %s', (query, id, label) => {
	const stops = [
		{ id: 'c', code: '300', name: 'Station Crémazie', lat: 0, lon: 0 },
		{ id: 'b', code: '100', name: 'Station Berri-UQAM', lat: 0, lon: 0 },
	];
	expect(resultIds(searchTransit({ surface: 'header', query }, { stops }))).toEqual([id]);
	const page = searchTransit({ surface: 'page', query }, { stops });
	expect(resultIds(page.stops)).toEqual([id]);
	expect(page.stops[0].name).toBe(label);
});

it('accepts absent sources without inventing results', () => {
	for (const sources of [{}, { routes: null, stops: null, vehicles: null, addresses: null }]) {
		for (const [query, folded] of [
			['hub', 'hub'],
			['', ''],
			['   ', ''],
			['---', ''],
		]) {
			expect(searchTransit({ surface: 'header', query }, sources)).toEqual([]);
			expect(searchTransit({ surface: 'page', query }, sources)).toEqual({
				query: folded,
				routes: [],
				stops: [],
				vehicles: [],
			});
		}
	}
});

it('returns no address unless supplied', () => {
	const query = 'unrelated query';
	const addresses = Object.freeze(
		['Zulu', 'Alpha', 'Third', 'Fourth'].map((label, lat) =>
			Object.freeze({
				label,
				lat,
				lon: 0,
				source: 'geo_ca' as const,
				precision: 'address' as const,
			}),
		),
	);
	expect(searchTransit({ surface: 'header', query }, {})).toEqual([]);
	expect(searchTransit({ surface: 'header', query }, { addresses }).map((r) => r.label)).toEqual([
		'Zulu',
		'Alpha',
		'Third',
	]);
	expect(
		searchTransit({ surface: 'header', query, modes: new Set(['bus']) }, { addresses }),
	).toEqual([]);
	expect(searchTransit({ surface: 'page', query }, { addresses })).toEqual({
		query,
		routes: [],
		stops: [],
		vehicles: [],
	});
});

it('does not mutate inputs', () => {
	const routes = Object.freeze([Object.freeze({ id: 'r', short: '1', long: 'Hub', type: 3 })]);
	const stops = Object.freeze([
		Object.freeze({ id: 's', code: '1', name: 'Hub', mode: 'bus' as const, lat: 0, lon: 0 }),
	]);
	const vehicles = Object.freeze([Object.freeze(vehicle('hub'))]);
	const sources = Object.freeze({ routes, stops, vehicles });
	const before = JSON.stringify(sources);
	const modes = new Set(['bus'] as const);
	searchTransit({ surface: 'header', query: 'hub', modes }, sources);
	const page = searchTransit({ surface: 'page', query: 'hub', modes }, sources);
	expect(page.routes[0]).toBe(routes[0]);
	expect(page.stops[0]).toBe(stops[0]);
	expect(page.vehicles[0]).toBe(vehicles[0]);
	expect(JSON.stringify(sources)).toBe(before);
	expect([...modes]).toEqual(['bus']);
});

it('keeps header caps and full page counts', () => {
	const routes = Array.from({ length: 51 }, (_, i) => ({
		id: String(i),
		short: String(i),
		long: 'Hub',
		type: 3,
	}));
	const stops = Array.from({ length: 51 }, (_, i) => ({
		id: String(i),
		code: String(i),
		name: 'Hub',
		lat: 0,
		lon: 0,
	}));
	for (const scope of ['route', 'stop'] as const)
		expect(
			resultIds(searchTransit({ surface: 'header', query: 'hub', scope }, { routes, stops })),
		).toEqual(['0', '1', '2', '3', '4']);
	for (const scope of ['all', 'map'] as const)
		expect(
			searchTransit({ surface: 'header', query: 'hub', scope }, { routes, stops }).map(
				(r) => `${r.kind}:${r.id}`,
			),
		).toEqual([
			'route:0',
			'route:1',
			'route:2',
			'route:3',
			'route:4',
			'stop:0',
			'stop:1',
			'stop:2',
		]);
	const page = searchTransit({ surface: 'page', query: 'hub' }, { routes, stops });
	expect(page.routes).toHaveLength(51);
	expect(page.stops).toHaveLength(51);
});

it('preserves mode filtering relative to stop deduplication', () => {
	const stops: StopIndexEntry[] = [
		{ id: 'rail-first', code: 'r', name: 'Station Central', lat: 0, lon: 0, mode: 'rail' },
		{ id: 'metro-second', code: 'm', name: 'Station Central', lat: 0, lon: 0, mode: 'metro' },
	];
	const modes = new Set(['metro'] as const);
	expect(
		resultIds(searchTransit({ surface: 'header', query: 'central', modes }, { stops })),
	).toEqual(['metro-second']);
	expect(searchTransit({ surface: 'page', query: 'central', modes }, { stops }).stops).toEqual([]);
});

it("preserves each surface's tied line and stop order", () => {
	const routes = [
		{ id: 'z', short: '20', long: 'Café', type: 3 },
		{ id: 'a', short: '3', long: 'Café', type: 3 },
	];
	const stops = [
		{ id: 'z', code: 'z', name: 'Zulu Hub', lat: 0, lon: 0 },
		{ id: 'a', code: 'a', name: 'Alpha Hub', lat: 0, lon: 0 },
	];
	expect(resultIds(searchTransit({ surface: 'header', query: 'café' }, { routes }))).toEqual([
		'a',
		'z',
	]);
	expect(resultIds(searchTransit({ surface: 'page', query: 'café' }, { routes }).routes)).toEqual([
		'z',
		'a',
	]);
	expect(resultIds(searchTransit({ surface: 'header', query: 'hub' }, { stops }))).toEqual([
		'a',
		'z',
	]);
	expect(
		resultIds(searchTransit({ surface: 'header', query: 'hub', scope: 'stop' }, { stops })),
	).toEqual(['z', 'a']);
	expect(resultIds(searchTransit({ surface: 'page', query: 'hub' }, { stops }).stops)).toEqual([
		'z',
		'a',
	]);
});

it("keeps exact, prefix, substring and reversed-token matches in today's order", () => {
	const routes = ['x hub', 'hub north', 'hub', 'hub x'].map((long, i) => ({
		id: `r${i}`,
		short: `n${i}`,
		long,
		type: 3,
	}));
	const vehicles: Vehicle[] = [vehicle('40061')];
	for (const [query, ids] of [
		['hub', ['r2', 'r1', 'r3', 'r0']],
		['x hub', ['r0', 'r3']],
		['n1', ['r1']],
		['r1', ['r1']],
	] as const) {
		expect(resultIds(searchTransit({ surface: 'header', query }, { routes }))).toEqual(ids);
		expect(resultIds(searchTransit({ surface: 'page', query }, { routes }).routes)).toEqual(ids);
	}
	for (const query of ['400', '40061']) {
		const ids = query === '40061' ? ['40061'] : [];
		expect(resultIds(searchTransit({ surface: 'header', query }, { vehicles }))).toEqual(ids);
		expect(resultIds(searchTransit({ surface: 'page', query }, { vehicles }).vehicles)).toEqual(
			ids,
		);
	}
});
