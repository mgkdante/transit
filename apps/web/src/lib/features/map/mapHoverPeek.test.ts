import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LiveIndex } from '$lib/v1/live';
import { VehicleSchema, type RouteIndexEntry } from '$lib/v1/schemas';
import { resolveMapHoverPeek, type MapHoverPeekContext } from './mapHoverPeek';

const now = Date.parse('2026-07-31T12:00:00Z');
const vehicles = [
	VehicleSchema.parse({
		id: 'bus-24',
		lat: 45.51,
		lon: -73.57,
		status: 'late',
		updated_utc: '2026-07-31T12:00:00Z',
		reported_utc: '2026-07-31T11:57:00Z',
		route: '24',
		trip: 'trip-secret',
		next_stop: 'stop-2',
		delay_min: 4,
		occupancy: 'standing',
	}),
	VehicleSchema.parse({
		id: 'bus-24-b',
		lat: 45.52,
		lon: -73.58,
		status: 'on_time',
		updated_utc: '2026-07-31T12:00:00Z',
		route: '24',
		next_stop: 'stop-2',
	}),
];
const byVehicleId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
const vehiclesByStop = new Map([['stop-2', new Set(['bus-24', 'bus-24-b'])]]);
const routesIndex: RouteIndexEntry[] = [
	{ id: '24', short: '24', long: 'Sherbrooke', type: 3 },
	{ id: '1', short: '1', long: null, type: 1 },
];
const stops = [
	{ id: 'stop-1', name: 'Place-des-Arts', code: '101', lat: 45.5, lon: -73.56 },
	{ id: 'stop-2', name: 'Sherbrooke / Saint-Denis', code: '202', lat: 45.51, lon: -73.57 },
];
const clock = { serverNow: now };
const context: MapHoverPeekContext = {
	index: { byVehicleId, vehiclesByStop } satisfies Pick<
		LiveIndex,
		'byVehicleId' | 'vehiclesByStop'
	>,
	stops,
	routesIndex,
	clock,
};

describe('resolveMapHoverPeek', () => {
	it('builds the vehicle keep table without trip, alerts, or forbidden live indexes', () => {
		const peek = resolveMapHoverPeek({ kind: 'vehicle', id: 'bus-24' }, context);

		expect(peek).toEqual({
			kind: 'vehicle',
			id: 'bus-24',
			title: 'Route 24',
			route: { id: '24', longName: 'Sherbrooke', type: 3, labelInferred: false },
			status: 'late',
			delayMin: 4,
			occupancy: 'standing',
			nextStop: {
				id: 'stop-2',
				name: 'Sherbrooke / Saint-Denis',
				nameAbsent: false,
			},
			nextStopAbsence: 'not-in-schedule',
			notReportingAgeS: 180,
		});
		expect(peek).not.toHaveProperty('trip');
		expect(peek).not.toHaveProperty('alerts');
	});

	it('uses the slim-stop absence vocabulary without leaking an unresolved stop id as a name', () => {
		const missingNextStop = VehicleSchema.parse({
			...vehicles[0],
			id: 'bus-missing-stop',
			next_stop: 'unresolved-stop',
		});
		const peek = resolveMapHoverPeek(
			{ kind: 'vehicle', id: missingNextStop.id },
			{
				...context,
				index: {
					...context.index,
					byVehicleId: new Map([[missingNextStop.id, missingNextStop]]),
				},
			},
		);

		expect(peek).toMatchObject({
			nextStop: null,
			nextStopAbsence: 'not-in-schedule',
		});
		expect(JSON.stringify(peek)).not.toContain('unresolved-stop');
	});

	it('builds route long-name/type/count from routesIndex and byVehicleId only', () => {
		expect(
			resolveMapHoverPeek(
				{ kind: 'route', id: '24', direction: 1, variantKey: 'parked-direction' },
				context,
			),
		).toEqual({
			kind: 'route',
			id: '24',
			title: 'Route 24',
			longName: 'Sherbrooke',
			type: 3,
			labelInferred: false,
			visibleVehicleCount: 2,
		});
	});

	it('marks an inferred route label and keeps direction text parked', () => {
		const peek = resolveMapHoverPeek({ kind: 'route', id: '1', direction: 0 }, context);

		expect(peek).toMatchObject({
			kind: 'route',
			longName: 'Route 1',
			labelInferred: true,
		});
		expect(peek).not.toHaveProperty('direction');
	});

	it('builds the stop code and vehicles-heading count with no departures field', () => {
		const peek = resolveMapHoverPeek({ kind: 'stop', id: 'stop-2' }, context);

		expect(peek).toEqual({
			kind: 'stop',
			id: 'stop-2',
			title: 'Sherbrooke / Saint-Denis',
			nameAbsent: false,
			code: '202',
			vehicleCount: 2,
		});
		expect(peek).not.toHaveProperty('departures');
	});

	it('recomputes stale age from the shared server clock without any lease or fetch input', () => {
		const first = resolveMapHoverPeek({ kind: 'vehicle', id: 'bus-24' }, context);
		const second = resolveMapHoverPeek(
			{ kind: 'vehicle', id: 'bus-24' },
			{ ...context, clock: { serverNow: now + 60_000 } },
		);

		expect(first).toMatchObject({ notReportingAgeS: 180 });
		expect(second).toMatchObject({ notReportingAgeS: 240 });
	});

	it('pins the typed context and forbidden source vocabulary', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/mapHoverPeek.ts'),
			'utf8',
		);
		expect(source).toContain("Pick<LiveIndex, 'byVehicleId' | 'vehiclesByStop'>");
		expect(source).not.toContain('byTripId');
		expect(source).not.toContain('byStopId');
	});
});
