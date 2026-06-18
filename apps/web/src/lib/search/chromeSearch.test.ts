import { describe, expect, it } from 'vitest';
import type { RouteIndexEntry, StopIndexEntry, Vehicle } from '$lib/v1/schemas';
import { chromeSearchResults, chromeSearchHref } from './chromeSearch';

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
		expect(chromeSearchHref({ kind: 'route', id: '161' })).toBe('/map?route=161');
		expect(chromeSearchHref({ kind: 'stop', id: '52819' })).toBe('/map?stop=52819');
		expect(chromeSearchHref({ kind: 'vehicle', id: '40061' })).toBe('/map?vehicle=40061');
	});

	it('stacks selected results onto the existing map filter query', () => {
		const current = new URLSearchParams('vehicle=40061&status=late&stop=53355');

		expect(chromeSearchHref({ kind: 'vehicle', id: '40062' }, current)).toBe(
			'/map?stop=53355&vehicle=40061%2C40062&status=late',
		);
		expect(chromeSearchHref({ kind: 'stop', id: '53355' }, current)).toBe(
			'/map?stop=53355&vehicle=40061&status=late',
		);
		expect(chromeSearchHref({ kind: 'route', id: '161' }, current)).toBe(
			'/map?route=161&stop=53355&vehicle=40061&status=late',
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
			'/map?route=161&near=45.525686%2C-73.594764&nearLabel=Mile+End',
		);
	});
});
