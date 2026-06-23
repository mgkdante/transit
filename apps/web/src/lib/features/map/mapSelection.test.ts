import { describe, expect, it } from 'vitest';
import { buildLiveIndex } from '$lib/v1/live';
import type { Alert, IsoUtc, RouteFile, StopFile, StopIndexEntry, Vehicle } from '$lib/v1/schemas';
import { resolveMapSelection, sameNullableSelection, sameSelection } from './mapSelection';

const utc = (value: string) => value as IsoUtc;

const vehicles: Vehicle[] = [
	{
		id: 'veh-1',
		lat: 45.5,
		lon: -73.6,
		status: 'late',
		updated_utc: utc('2026-06-15T00:00:00Z'),
		route: '24',
		trip: 'trip-24-a',
		next_stop: 'stop-2',
		bearing: 90,
		delay_min: 4,
		occupancy: 'standing',
	},
	{
		id: 'veh-2',
		lat: 45.51,
		lon: -73.61,
		status: 'on_time',
		updated_utc: utc('2026-06-15T00:00:00Z'),
		route: '24',
		trip: 'trip-24-b',
		next_stop: 'stop-2',
		bearing: null,
		delay_min: 0,
		occupancy: 'many_seats',
	},
];

const stops: StopIndexEntry[] = [
	{ id: 'stop-1', name: 'Sherbrooke / Saint-Denis', code: '52618', lat: 45.51, lon: -73.57 },
	{ id: 'stop-2', name: 'Mont-Royal / Saint-Laurent', code: '53110', lat: 45.52, lon: -73.58 },
	{ id: 'stop-3', name: 'Van Horne / Rockland', code: '57191', lat: 45.53, lon: -73.59 },
];

const alerts: Alert[] = [
	{
		id: 'route-alert',
		severity: 'high',
		header_key: 'Detour on route 24',
		header_text: 'Detour on route 24',
		routes: ['24'],
		stops: [],
	},
	{
		id: 'stop-alert',
		severity: 'watch',
		header_key: 'Stop moved',
		header_text: 'Stop moved',
		routes: [],
		stops: ['stop-1', 'stop-2'],
	},
];
const routes: RouteFile[] = [
	{
		generated_utc: utc('2026-06-15T00:00:00Z'),
		id: '24',
		long: 'Sherbrooke',
		directions: [
			{
				dir: 0,
				headsign: 'East',
				shape: null,
				stops: [
					{ id: 'stop-1', seq: 1, name: 'Sherbrooke / Saint-Denis' },
					{ id: 'stop-2', seq: 2, name: 'Mont-Royal / Saint-Laurent' },
					{ id: 'stop-3', seq: 3, name: 'Van Horne / Rockland' },
				],
			},
			{
				dir: 1,
				headsign: 'West',
				shape: null,
				stops: [
					{ id: 'stop-3', seq: 1, name: 'Van Horne / Rockland' },
					{ id: 'stop-2', seq: 2, name: 'Mont-Royal / Saint-Laurent' },
					{ id: 'stop-1', seq: 3, name: 'Sherbrooke / Saint-Denis' },
				],
			},
		],
	},
];
const routeWithVariants: RouteFile = {
	generated_utc: utc('2026-06-15T00:00:00Z'),
	id: '24',
	long: 'Sherbrooke',
	directions: [
		{
			dir: 0,
			headsign: 'Ouest',
			shape: null,
			stops: [
				{ id: '52819', seq: 1, name: 'Montgomery / Sherbrooke' },
				{ id: '51243', seq: 47, name: 'Station Villa-Maria (Décarie / de Monkland)' },
			],
		},
		{
			dir: 0,
			headsign: 'Ouest destination Station Sherbrooke',
			shape: null,
			stops: [
				{ id: '52819', seq: 1, name: 'Montgomery / Sherbrooke' },
				{ id: '52508', seq: 13, name: 'Station Sherbrooke (Édicule Est )' },
			],
		},
		{
			dir: 1,
			headsign: 'Est',
			shape: null,
			stops: [
				{ id: '51241', seq: 1, name: 'Station Villa-Maria' },
				{ id: '52819', seq: 47, name: 'Montgomery / Sherbrooke' },
			],
		},
	],
};
const stopFiles: StopFile[] = [
	{
		generated_utc: utc('2026-06-15T00:00:00Z'),
		id: 'stop-1',
		name: 'Sherbrooke / Saint-Denis',
		lat: 45.51,
		lon: -73.57,
		code: '52618',
		routes_served: ['24', '55'],
		scheduled: [
			{ route: '24', headsign: 'East', times: ['08:00', '12:00', '23:50'] },
			{ route: '55', headsign: 'North', times: ['10:00', '20:00'] },
		],
	},
];

const index = buildLiveIndex({
	vehicles: { generated_utc: utc('2026-06-15T00:00:00Z'), vehicles },
	trips: {
		generated_utc: utc('2026-06-15T00:00:00Z'),
		trips: {
			'trip-24-a': {
				status: 'late',
				route: '24',
				delay_min: 4,
				stops: [
					{ stop: 'stop-2', eta_utc: utc('2026-06-15T00:06:00Z'), delay_min: 4 },
					{ stop: 'stop-3', eta_utc: utc('2026-06-15T00:16:00Z'), delay_min: 5 },
				],
			},
		},
	},
	stopDepartures: {
		generated_utc: utc('2026-06-15T00:00:00Z'),
		stops: {
			'stop-1': [
				{ route: '24', trip: 'trip-24-a', eta_utc: utc('2026-06-15T00:06:00Z'), delay_min: 4 },
				{ route: '55', trip: 'trip-55-a', eta_utc: utc('2026-06-15T00:16:00Z'), delay_min: 0 },
			],
		},
	},
});

describe('resolveMapSelection', () => {
	it('returns full vehicle state with trip and route/next-stop alerts', () => {
		const detail = resolveMapSelection(
			{ kind: 'vehicle', id: 'veh-1' },
			{ index, stops, alerts, routes },
		);

		expect(detail).toMatchObject({
			kind: 'vehicle',
			id: 'veh-1',
			title: 'Route 24',
			vehicle: { status: 'late', occupancy: 'standing', delay_min: 4 },
			trip: { route: '24', delay_min: 4 },
			route: { id: '24', long: 'Sherbrooke' },
			routeDirection: { dir: 0, headsign: 'East' },
			routeDirectionVariant: { dir: 0, headsign: 'East' },
			nextStop: { id: 'stop-2', name: 'Mont-Royal / Saint-Laurent' },
		});
		if (detail?.kind !== 'vehicle') throw new Error('expected vehicle detail');
		expect(detail.pastStops.map((stop) => stop.id)).toEqual(['stop-1']);
		expect(detail.nextStops.map((stop) => stop.id)).toEqual(['stop-2', 'stop-3']);
		expect(detail?.alerts.map((alert) => alert.id)).toEqual(['route-alert', 'stop-alert']);
	});

	it('keeps the stable route variant key when a vehicle sits on a duplicate direction id', () => {
		const duplicateIndex = buildLiveIndex({
			vehicles: {
				generated_utc: utc('2026-06-15T00:00:00Z'),
				vehicles: [
					{
						id: 'dup-vehicle',
						lat: 45.5,
						lon: -73.6,
						status: 'on_time',
						updated_utc: utc('2026-06-15T00:00:00Z'),
						route: '24',
						trip: 'dup-trip',
						next_stop: '52508',
						bearing: 90,
						delay_min: 0,
						occupancy: 'many_seats',
					},
				],
			},
			trips: {
				generated_utc: utc('2026-06-15T00:00:00Z'),
				trips: {
					'dup-trip': {
						status: 'on_time',
						route: '24',
						delay_min: 0,
						stops: [
							{ stop: '52819', eta_utc: utc('2026-06-15T00:06:00Z'), delay_min: 0 },
							{ stop: '52508', eta_utc: utc('2026-06-15T00:16:00Z'), delay_min: 0 },
						],
					},
				},
			},
			stopDepartures: { generated_utc: utc('2026-06-15T00:00:00Z'), stops: {} },
		});
		const routeDetail = resolveMapSelection(
			{ kind: 'route', id: '24' },
			{ index: duplicateIndex, stops, alerts, routes: [routeWithVariants] },
		);
		expect(routeDetail?.kind).toBe('route');
		if (routeDetail?.kind !== 'route') throw new Error('expected route detail');

		const vehicleDetail = resolveMapSelection(
			{ kind: 'vehicle', id: 'dup-vehicle' },
			{ index: duplicateIndex, stops, alerts, routes: [routeWithVariants] },
		);
		expect(vehicleDetail?.kind).toBe('vehicle');
		if (vehicleDetail?.kind !== 'vehicle') throw new Error('expected vehicle detail');

		expect(vehicleDetail.routeDirectionVariant?.key).toBe(routeDetail.directions[1].variantKey);
		expect(vehicleDetail.routeDirectionVariant?.label).toBe(
			'toward Station Sherbrooke (Édicule Est )',
		);
	});

	it('returns stop detail with routes and past/future times grouped by route', () => {
		const detail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{
				index,
				stops,
				alerts,
				stopFiles,
				now: new Date('2026-06-15T16:30:00Z'),
			},
		);
		expect(detail?.kind).toBe('stop');
		if (detail?.kind !== 'stop') throw new Error('expected stop detail');

		expect(detail).toMatchObject({
			kind: 'stop',
			id: 'stop-1',
			title: 'Sherbrooke / Saint-Denis',
			stop: { code: '52618' },
		});
		expect(detail?.departures).toHaveLength(2);
		expect(detail.routeTimes.map((route) => route.route)).toEqual(['24', '55']);
		expect(detail.routeTimes[0]).toMatchObject({
			route: '24',
			headsign: 'East',
			pastTimes: ['08:00', '12:00'],
			futureTimes: ['23:50'],
		});
		expect(detail.routeTimes[0].liveDepartures).toHaveLength(1);
		expect(detail?.vehicles.map((vehicle) => vehicle.id)).toEqual([]);
		expect(detail?.alerts.map((alert) => alert.id)).toEqual(['stop-alert']);
	});

	it('wraps static scheduled next times to the next service day instead of showing no data', () => {
		const detail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{
				index,
				stops,
				alerts,
				stopFiles,
				now: new Date('2026-06-16T04:30:00Z'),
			},
		);
		expect(detail?.kind).toBe('stop');
		if (detail?.kind !== 'stop') throw new Error('expected stop detail');

		expect(detail.routeTimes[0]).toMatchObject({
			route: '24',
			pastTimes: ['08:00', '12:00', '23:50'],
			futureTimes: ['08:00', '12:00', '23:50'],
		});
	});

	it('returns route detail with selected direction, live vehicles, and route alerts', () => {
		const detail = resolveMapSelection(
			{ kind: 'route', id: '24', direction: 0 },
			{ index, stops, alerts, routes },
		);

		expect(detail).toMatchObject({
			kind: 'route',
			id: '24',
			title: 'Route 24',
			route: { long: 'Sherbrooke' },
			direction: { dir: 0, headsign: 'East' },
		});
		if (detail?.kind !== 'route') throw new Error('expected route detail');
		expect(detail?.alerts.map((alert) => alert.id)).toEqual(['route-alert']);
		expect(detail?.vehicles.map((vehicle) => vehicle.id)).toEqual(['veh-1', 'veh-2']);
		expect(detail.directions).toHaveLength(1);
		expect(detail.directions[0].stops.map((stop) => stop.id)).toEqual([
			'stop-1',
			'stop-2',
			'stop-3',
		]);
	});

	it('distinguishes duplicate route direction variants with rider-facing terminal labels', () => {
		const detail = resolveMapSelection(
			{ kind: 'route', id: '24' },
			{ index, stops, alerts, routes: [routeWithVariants] },
		);
		expect(detail?.kind).toBe('route');
		if (detail?.kind !== 'route') throw new Error('expected route detail');

		const directionSummaries = detail.directions.map((direction) => ({
			variantKey: (direction as { variantKey?: string }).variantKey,
			label: (direction as { label?: string }).label,
			headsign: direction.headsign,
		}));

		expect(new Set(directionSummaries.map((direction) => direction.variantKey)).size).toBe(3);
		expect(directionSummaries.map((direction) => direction.label)).toEqual([
			'toward Station Villa-Maria (Décarie / de Monkland)',
			'toward Station Sherbrooke (Édicule Est )',
			'toward Montgomery / Sherbrooke',
		]);

		const selected = resolveMapSelection(
			{ kind: 'route', id: '24', variantKey: directionSummaries[1].variantKey } as never,
			{ index, stops, alerts, routes: [routeWithVariants] },
		);
		expect(selected?.kind).toBe('route');
		if (selected?.kind !== 'route') throw new Error('expected selected route detail');

		expect(selected.directions).toHaveLength(1);
		expect((selected.directions[0] as { variantKey?: string }).variantKey).toBe(
			directionSummaries[1].variantKey,
		);
		expect(selected.directions[0].stops.map((stop) => stop.id)).toEqual(['52819', '52508']);
	});

	it('normalizes bare French cardinal headsigns to English for right-panel direction labels', () => {
		const routeWithBareCardinals: RouteFile = {
			generated_utc: utc('2026-06-15T00:00:00Z'),
			id: '999',
			long: 'Cardinal test',
			directions: [
				{ dir: 0, headsign: 'Ouest', shape: null, stops: [] },
				{ dir: 1, headsign: 'Est', shape: null, stops: [] },
				{ dir: 2, headsign: 'Nord', shape: null, stops: [] },
				{ dir: 3, headsign: 'Sud', shape: null, stops: [] },
			],
		};

		const detail = resolveMapSelection(
			{ kind: 'route', id: '999' },
			{ index, stops, alerts, routes: [routeWithBareCardinals] },
		);

		expect(detail?.kind).toBe('route');
		if (detail?.kind !== 'route') throw new Error('expected route detail');
		expect(detail.directions.map((direction) => [direction.label, direction.headsign])).toEqual([
			['West', 'West'],
			['East', 'East'],
			['North', 'North'],
			['South', 'South'],
		]);
	});
});

describe('sameSelection / sameNullableSelection', () => {
	it('same kind+id are equal (point entities)', () => {
		expect(sameSelection({ kind: 'vehicle', id: 'a' }, { kind: 'vehicle', id: 'a' })).toBe(true);
		expect(sameSelection({ kind: 'stop', id: 's1' }, { kind: 'stop', id: 's1' })).toBe(true);
	});
	it('different kind or id are not equal', () => {
		expect(sameSelection({ kind: 'vehicle', id: 'a' }, { kind: 'stop', id: 'a' })).toBe(false);
		expect(sameSelection({ kind: 'vehicle', id: 'a' }, { kind: 'vehicle', id: 'b' })).toBe(false);
	});
	it('routes compare direction + variant', () => {
		expect(sameSelection({ kind: 'route', id: '24' }, { kind: 'route', id: '24' })).toBe(true);
		expect(
			sameSelection(
				{ kind: 'route', id: '24', direction: 0 },
				{ kind: 'route', id: '24', direction: 1 },
			),
		).toBe(false);
		expect(
			sameSelection(
				{ kind: 'route', id: '24', variantKey: 'a' },
				{ kind: 'route', id: '24', variantKey: 'b' },
			),
		).toBe(false);
	});
	it('treats missing direction/variant as null (equal)', () => {
		expect(
			sameSelection({ kind: 'route', id: '24', direction: null }, { kind: 'route', id: '24' }),
		).toBe(true);
	});
	it('sameNullableSelection: two nulls equal, one null not', () => {
		expect(sameNullableSelection(null, null)).toBe(true);
		expect(sameNullableSelection({ kind: 'vehicle', id: 'a' }, null)).toBe(false);
		expect(sameNullableSelection(null, { kind: 'vehicle', id: 'a' })).toBe(false);
		expect(sameNullableSelection({ kind: 'vehicle', id: 'a' }, { kind: 'vehicle', id: 'a' })).toBe(
			true,
		);
	});
});
