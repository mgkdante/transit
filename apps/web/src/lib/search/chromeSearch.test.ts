import { describe, expect, it, vi } from 'vitest';
import type { RouteIndexEntry, StopIndexEntry, Vehicle } from '$lib/v1/schemas';

// `chromeSearchResultHref` reaches `routeFor` via `$lib/nav`, whose `intent`
// module imports `goto` from `$app/navigation` — the SvelteKit client runtime
// touches `window` at module load, which the node "data" project lacks. Stub it
// so the (pure) `routeFor`/`chromeSearchResultHref` graph loads; `goto` is never
// called in these unit tests.
vi.mock('$app/navigation', () => ({ goto: () => Promise.resolve() }));

import {
	chromeSearchResults,
	chromeSearchHref,
	chromeSearchResultHref,
	scopeForPath,
	type ChromeSearchResult,
} from './chromeSearch';

const routes: RouteIndexEntry[] = [
	{ id: '24', short: '24', long: 'Sherbrooke', type: 3 },
	{ id: '161', short: '161', long: 'Van Horne', type: 3 },
	{ id: '1', short: '1', long: 'Ligne 1 - Verte', type: 1 },
];

const stops: StopIndexEntry[] = [
	{ id: '52819', code: '52618', name: 'Montgomery / Sherbrooke', lat: 45.52, lon: -73.55 },
	{ id: '51243', code: '51243', name: 'Station Villa-Maria', lat: 45.48, lon: -73.62 },
	{ id: '57191', code: '57191', name: 'Van Horne / Rockland', lat: 45.53, lon: -73.59 },
];

const updatedUtc = '2026-06-16T00:00:00Z' as Vehicle['updated_utc'];

const vehicles: Vehicle[] = [
	{
		id: '40061',
		lat: 45.5,
		lon: -73.6,
		status: 'late',
		updated_utc: updatedUtc,
		route: '161',
		trip: '296851600',
		next_stop: '57191',
	},
	{
		id: '161',
		lat: 45.51,
		lon: -73.61,
		status: 'on_time',
		updated_utc: updatedUtc,
		route: '24',
	},
];

describe('chromeSearchResults', () => {
	it('prioritizes route and stop matches over exact live bus ids', () => {
		const results = chromeSearchResults('161', { routes, stops, vehicles });

		expect(results.map((result) => `${result.kind}:${result.id}`)).toEqual([
			'route:161',
			'vehicle:161',
		]);
	});

	it('matches stop names and rider-facing stop codes', () => {
		expect(chromeSearchResults('villa', { routes, stops, vehicles })[0]).toMatchObject({
			kind: 'stop',
			id: '51243',
			label: 'Station Villa-Maria',
		});
		expect(chromeSearchResults('52618', { routes, stops, vehicles })[0]).toMatchObject({
			kind: 'stop',
			id: '52819',
			label: 'Montgomery / Sherbrooke',
			meta: '52618',
		});
	});

	it('only returns vehicles on exact id matches', () => {
		expect(
			chromeSearchResults('400', { routes, stops, vehicles }).some((r) => r.kind === 'vehicle'),
		).toBe(false);
		expect(chromeSearchResults('40061', { routes, stops, vehicles })[0]).toMatchObject({
			kind: 'vehicle',
			id: '40061',
			label: '40061',
			meta: 'Route 161',
		});
	});

	it('includes address autocomplete suggestions after local route and stop matches', () => {
		const results = chromeSearchResults('casgrain', {
			routes,
			stops,
			vehicles,
			addresses: [
				{
					lat: 45.5256864,
					lon: -73.5947644,
					label: '5333 Avenue Casgrain, Montréal, Quebec',
					source: 'geo_ca',
					precision: 'address',
				},
			],
		});

		expect(results[0]).toMatchObject({
			kind: 'address',
			id: '45.525686,-73.594764',
			label: '5333 Avenue Casgrain, Montréal, Quebec',
			meta: 'Address',
			lat: 45.5256864,
			lon: -73.5947644,
		});
	});

	it('keeps Google autocomplete suggestions coordinate-less for local resolution on selection', () => {
		const results = chromeSearchResults('casgrain', {
			addresses: [
				{
					label: '5333 Avenue Casgrain, Montréal, QC, Canada',
					source: 'google_places',
					precision: 'address',
					placeId: 'google-address',
					attribution: 'google',
				},
			],
		});

		expect(results[0]).toMatchObject({
			kind: 'address',
			id: 'google:google-address',
			label: '5333 Avenue Casgrain, Montréal, QC, Canada',
			meta: 'Address',
			attribution: 'google',
			// placeId + source ride through so selection can resolve by Place Details
			// instead of re-text-searching the label (the wrong-place fix).
			placeId: 'google-address',
			source: 'google_places',
		});
		expect(results[0]?.lat).toBeUndefined();
		expect(results[0]?.lon).toBeUndefined();
	});

	it('finds métro stations and accented names the way riders type them', () => {
		const metro: StopIndexEntry[] = [
			{ id: '10146', code: '10146', name: 'Station Berri-UQAM', lat: 45.51, lon: -73.56 },
			{ id: '11000', code: '11000', name: 'Station Crémazie', lat: 45.55, lon: -73.62 },
		];

		// space where the data has a hyphen
		expect(chromeSearchResults('berri uqam', { stops: metro })[0]).toMatchObject({
			kind: 'stop',
			id: '10146',
		});
		// reversed token order
		expect(chromeSearchResults('uqam berri', { stops: metro })[0]).toMatchObject({
			kind: 'stop',
			id: '10146',
		});
		// no accent on an EN keyboard
		expect(chromeSearchResults('cremazie', { stops: metro })[0]).toMatchObject({
			kind: 'stop',
			id: '11000',
		});
	});

	it('collapses the métro interchange duplicate platforms (shared code) to one result', () => {
		const platforms: StopIndexEntry[] = [
			{ id: '9999111', code: '10146', name: 'Station Berri-UQAM', lat: 45.51, lon: -73.56 },
			{ id: '9999112', code: '10146', name: 'Station Berri-UQAM', lat: 45.51, lon: -73.56 },
			{ id: '9999114', code: '10146', name: 'Station Berri-UQAM', lat: 45.51, lon: -73.56 },
		];

		const results = chromeSearchResults('berri uqam', { stops: platforms });
		const stops = results.filter((r) => r.kind === 'stop');
		expect(stops).toHaveLength(1);
		expect(stops[0]?.id).toBe('9999111');
	});

	it('collapses a station name attached to many stops (different codes) to one', () => {
		const station: StopIndexEntry[] = [
			{ id: '1', code: '10280', name: 'Station Henri-Bourassa', lat: 45.554, lon: -73.668 },
			{ id: '50301', code: '50301', name: 'Station Henri-Bourassa', lat: 45.554, lon: -73.669 },
			{ id: '50303', code: '50303', name: 'Station Henri-Bourassa', lat: 45.554, lon: -73.668 },
		];

		const stops = chromeSearchResults('henri bourassa', { stops: station }).filter(
			(r) => r.kind === 'stop',
		);
		expect(stops).toHaveLength(1);
		expect(stops[0]?.id).toBe('1');
	});

	it('keeps two distinct same-named non-station stops separate', () => {
		const twins: StopIndexEntry[] = [
			{ id: '100', code: '100', name: 'Parc / Laurier', lat: 45.52, lon: -73.6 },
			{ id: '200', code: '200', name: 'Parc / Laurier', lat: 45.521, lon: -73.601 },
		];
		const stops = chromeSearchResults('parc laurier', { stops: twins }).filter(
			(r) => r.kind === 'stop',
		);
		expect(stops).toHaveLength(2);
	});

	it('matches an intersection stop with the cross streets in either order', () => {
		const intersection: StopIndexEntry[] = [
			{ id: '52819', code: '52618', name: 'Montgomery / Sherbrooke', lat: 45.52, lon: -73.55 },
		];

		expect(chromeSearchResults('sherbrooke montgomery', { stops: intersection })[0]).toMatchObject({
			kind: 'stop',
			id: '52819',
		});
	});
});

describe('chromeSearchHref', () => {
	it('routes every selected result into the map filter spine', () => {
		// Each pick also carries a one-shot `focus` so the map zooms to the entity.
		expect(chromeSearchHref({ kind: 'route', id: '161' })).toBe('/map?route=161&focus=route%3A161');
		expect(chromeSearchHref({ kind: 'stop', id: '52819' })).toBe(
			'/map?stop=52819&focus=stop%3A52819',
		);
		expect(chromeSearchHref({ kind: 'vehicle', id: '40061' })).toBe(
			'/map?vehicle=40061&focus=vehicle%3A40061',
		);
	});

	it('stacks selected results onto the existing map filter query', () => {
		const current = new URLSearchParams('vehicle=40061&status=late&stop=53355');

		expect(chromeSearchHref({ kind: 'vehicle', id: '40062' }, current)).toBe(
			'/map?stop=53355&vehicle=40061%2C40062&status=late&focus=vehicle%3A40062',
		);
		expect(chromeSearchHref({ kind: 'stop', id: '53355' }, current)).toBe(
			'/map?stop=53355&vehicle=40061&status=late&focus=stop%3A53355',
		);
		expect(chromeSearchHref({ kind: 'route', id: '161' }, current)).toBe(
			'/map?route=161&stop=53355&vehicle=40061&status=late&focus=route%3A161',
		);
	});

	it('routes address results to the map near target while preserving existing filters', () => {
		const current = new URLSearchParams('route=161&status=late');

		expect(
			chromeSearchHref(
				{
					kind: 'address',
					id: '45.525686,-73.594764',
					label: '5333 Avenue Casgrain, Montréal, Quebec',
					lat: 45.5256864,
					lon: -73.5947644,
				},
				current,
			),
		).toBe(
			'/map?route=161&status=late&near=45.525686%2C-73.594764&nearLabel=5333+Avenue+Casgrain%2C+Montr%C3%A9al%2C+Quebec',
		);
	});

	it('preserves an active address target when stacking route, stop, or bus filters', () => {
		const current = new URLSearchParams('near=45.525686,-73.594764&nearLabel=Mile End');

		expect(chromeSearchHref({ kind: 'route', id: '161' }, current)).toBe(
			'/map?route=161&near=45.525686%2C-73.594764&nearLabel=Mile+End&focus=route%3A161',
		);
	});
});

describe('scopeForPath', () => {
	it('maps the line catalogue and route detail to route scope', () => {
		expect(scopeForPath('/lines')).toBe('route');
		expect(scopeForPath('/route/161')).toBe('route');
	});

	it('maps the stop catalogue and stop detail to stop scope', () => {
		expect(scopeForPath('/stops')).toBe('stop');
		expect(scopeForPath('/stop/52819')).toBe('stop');
	});

	it('maps the map surface to map scope', () => {
		expect(scopeForPath('/map')).toBe('map');
	});

	it('falls back to the full blend on the hub, network, and search surfaces', () => {
		expect(scopeForPath('/')).toBe('all');
		expect(scopeForPath('/network')).toBe('all');
		expect(scopeForPath('/search')).toBe('all');
	});
});

describe('chromeSearchResults scope', () => {
	it('restricts route scope to lines, dropping stops, vehicles, and addresses', () => {
		// "van horne" matches route 161 (long) AND stop 57191 (name) — without scope
		// the blend carries both; route scope must keep ONLY the line.
		const blended = chromeSearchResults('van horne', { routes, stops, vehicles });
		expect(blended.some((result) => result.kind === 'route')).toBe(true);
		expect(blended.some((result) => result.kind === 'stop')).toBe(true);

		const results = chromeSearchResults(
			'van horne',
			{
				routes,
				stops,
				vehicles,
				addresses: [
					{ lat: 45.5, lon: -73.6, label: 'Van Horne', source: 'geo_ca', precision: 'address' },
				],
			},
			{ scope: 'route' },
		);

		expect(results.length).toBeGreaterThan(0);
		expect(results.every((result) => result.kind === 'route')).toBe(true);
	});

	it('restricts stop scope to stops, dropping everything else', () => {
		const results = chromeSearchResults(
			'van horne',
			{ routes, stops, vehicles },
			{ scope: 'stop' },
		);

		expect(results.length).toBeGreaterThan(0);
		expect(results.every((result) => result.kind === 'stop')).toBe(true);
	});

	it('keeps the full blend on map scope (unchanged ordering)', () => {
		const results = chromeSearchResults('161', { routes, stops, vehicles }, { scope: 'map' });

		expect(results.map((result) => `${result.kind}:${result.id}`)).toEqual([
			'route:161',
			'vehicle:161',
		]);
	});

	it('matches today behavior on all scope and when scope is omitted', () => {
		const blend = ['route:161', 'vehicle:161'];
		expect(
			chromeSearchResults('161', { routes, stops, vehicles }, { scope: 'all' }).map(
				(result) => `${result.kind}:${result.id}`,
			),
		).toEqual(blend);
		expect(
			chromeSearchResults('161', { routes, stops, vehicles }).map(
				(result) => `${result.kind}:${result.id}`,
			),
		).toEqual(blend);
	});
});

describe('chromeSearchResultHref', () => {
	const routeResult: ChromeSearchResult = {
		kind: 'route',
		id: '161',
		label: '161 Van Horne',
		priority: 0,
	};
	const stopResult: ChromeSearchResult = {
		kind: 'stop',
		id: '52819',
		label: 'Montgomery / Sherbrooke',
		meta: '52618',
		priority: 4,
	};

	it('deep-links a route pick to its detail page in route scope', () => {
		expect(chromeSearchResultHref(routeResult, 'route')).toBe('/route/161');
	});

	it('deep-links a stop pick to its detail page in stop scope', () => {
		expect(chromeSearchResultHref(stopResult, 'stop')).toBe('/stop/52819');
	});

	it('falls through to the map filter spine on map and all scope', () => {
		expect(chromeSearchResultHref(routeResult, 'map')).toBe('/map?route=161&focus=route%3A161');
		expect(chromeSearchResultHref(stopResult, 'all')).toBe('/map?stop=52819&focus=stop%3A52819');
	});

	it('falls through to the map near target for an address (no detail route)', () => {
		const address: ChromeSearchResult = {
			kind: 'address',
			id: '45.525686,-73.594764',
			label: '5333 Avenue Casgrain, Montréal, Quebec',
			lat: 45.5256864,
			lon: -73.5947644,
			priority: 30,
		};

		expect(chromeSearchResultHref(address, 'route')).toBe(
			'/map?near=45.525686%2C-73.594764&nearLabel=5333+Avenue+Casgrain%2C+Montr%C3%A9al%2C+Quebec',
		);
	});

	it('URI-encodes the entity id through routeFor', () => {
		expect(chromeSearchResultHref({ ...routeResult, id: '10 A' }, 'route')).toBe('/route/10%20A');
	});
});
