import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FilterState } from '$lib/filters';
import { VehicleSchema } from '$lib/v1/schemas';
import type { VehicleSilenceContext } from './vehicleLayer';
import { toVehicleFeatures } from './vehicleLayer';
import { BUS_ICON, stateBadgeIconId, VEHICLE_MARKER_GEOMETRY } from './vehicleSprites';
import { STALE_CUTOFF_S } from './vehicleProjection';

const EMPTY_FILTER: FilterState = {
	routes: new Set(),
	stops: new Set(),
	trips: new Set(),
	vehicles: new Set(),
};

const vehicles = [
	{
		id: 'directional',
		lat: 45.5,
		lon: -73.6,
		status: 'on_time',
		updated_utc: '2026-06-15T00:00:00Z',
		bearing: 90,
	},
	{
		id: 'no-direction',
		lat: 45.51,
		lon: -73.61,
		status: 'late',
		updated_utc: '2026-06-15T00:00:00Z',
		bearing: null,
	},
].map((vehicle) => VehicleSchema.parse(vehicle));

describe('toVehicleFeatures entity filtering', () => {
	it('serializes the exact state badge mark for every filter mode with status precedence', () => {
		const [vehicle] = [
			{
				id: 'stateful',
				lat: 45.5,
				lon: -73.6,
				status: 'on_time',
				occupancy: 'full',
				updated_utc: '2026-06-15T00:00:00Z',
			},
		].map((candidate) => VehicleSchema.parse(candidate));
		const cases = [
			['default', EMPTY_FILTER, '', 1, BUS_ICON],
			['entity-only', { ...EMPTY_FILTER, entities: ['bus'] } as FilterState, '', 1, BUS_ICON],
			[
				'status',
				{ ...EMPTY_FILTER, status: ['on_time'] } as FilterState,
				stateBadgeIconId('status', 'on_time'),
				1,
				'veh-s-on_time',
			],
			[
				'occupancy',
				{ ...EMPTY_FILTER, occupancy: ['full'] } as FilterState,
				stateBadgeIconId('occupancy', 'full'),
				1,
				'veh-o-full',
			],
			[
				'both-active status precedence',
				{ ...EMPTY_FILTER, status: ['on_time'], occupancy: ['full'] } as FilterState,
				stateBadgeIconId('status', 'on_time'),
				1,
				'veh-s-on_time',
			],
			['unmatched', { ...EMPTY_FILTER, status: ['early'] } as FilterState, '', 0, BUS_ICON],
		] as const;

		for (const [name, filter, mark, matched, body] of cases) {
			const properties = toVehicleFeatures([vehicle], filter).features[0].properties;
			expect(properties, name).toMatchObject({ mark, matched, body });
			expect(properties, `${name} mark property`).toHaveProperty('mark');
		}

		const withoutTelemetry = VehicleSchema.parse({ ...vehicle, occupancy: null });
		const nullProperties = toVehicleFeatures([withoutTelemetry], {
			...EMPTY_FILTER,
			occupancy: ['full'],
		}).features[0].properties;
		expect(nullProperties).toMatchObject({ mark: '', matched: 0, body: BUS_ICON });
		expect(nullProperties).toHaveProperty('mark');
	});

	it('keeps every bearing outside the upright bus silhouette', () => {
		const bodyRadius = Math.hypot(6.5 - 4, 9.5 - 4) + 4 + 1;
		expect(VEHICLE_MARKER_GEOMETRY.chevronAnnulus.inner).toBeGreaterThan(bodyRadius);
	});

	it('keeps single and paired badges below every heading without covering each other', () => {
		const { stateBadge, silentBadge, box, plateMargin, chevronAnnulus } = VEHICLE_MARKER_GEOMETRY;
		const halfPlate = box / 2 - plateMargin + 1;
		for (const badge of [stateBadge, silentBadge]) {
			for (const offset of [badge.offset, badge.pairedOffset]) {
				expect(offset[1] - halfPlate * badge.scale).toBeGreaterThan(chevronAnnulus.outer);
			}
		}
		const gap = silentBadge.pairedOffset[0] - stateBadge.pairedOffset[0];
		expect(gap).toBeGreaterThan(halfPlate * (stateBadge.scale + silentBadge.scale));
	});

	it('does not restore the retired per-vehicle silence opacity expression', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/map/vehicleLayer.ts'),
			'utf8',
		);

		expect(source).not.toContain('SILENCE_OPACITY');
	});

	it('flags whether each bus reports a heading so the chevron layer can hide for headingless buses', () => {
		const features = toVehicleFeatures(vehicles, EMPTY_FILTER).features;

		expect(features.map((f) => [f.properties.id, f.properties.hasHeading])).toEqual([
			['directional', 1],
			['no-direction', 0],
		]);
	});

	it('marks the selected bus so the map can highlight it without filtering context', () => {
		const features = toVehicleFeatures(vehicles, EMPTY_FILTER, new Set(), 'no-direction').features;

		expect(features.map((f) => [f.properties.id, f.properties.selected])).toEqual([
			['directional', 0],
			['no-direction', 1],
		]);
	});

	it('does not serialize hover or the retired silence-opacity debug fields', () => {
		const features = toVehicleFeatures(vehicles, EMPTY_FILTER).features;

		for (const feature of features) {
			expect(feature.properties).not.toHaveProperty('hovered');
			expect(feature.properties).not.toHaveProperty('opacity');
			expect(feature.properties).not.toHaveProperty('silenceAgeS');
		}
	});

	it('keeps only the selected bus when a vehicle filter is active', () => {
		const filter = { ...EMPTY_FILTER, vehicles: new Set(['no-direction']) };
		const features = toVehicleFeatures(vehicles, filter).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 0],
			['no-direction', 1],
		]);
	});

	it('marks an exact vehicle filter as selected-sized even without an open detail panel', () => {
		const filter = { ...EMPTY_FILTER, vehicles: new Set(['no-direction']) };
		const features = toVehicleFeatures(vehicles, filter).features;

		expect(features.map((f) => [f.properties.id, f.properties.selected])).toEqual([
			['directional', 0],
			['no-direction', 1],
		]);
	});

	it('filters buses by selected stop and trip ids', () => {
		const filter = {
			...EMPTY_FILTER,
			stops: new Set(['stop-2']),
			trips: new Set(['trip-24-b']),
		};
		const withStopTrip = vehicles.map((vehicle) =>
			VehicleSchema.parse({
				...vehicle,
				next_stop: vehicle.id === 'no-direction' ? 'stop-2' : 'stop-1',
				trip: vehicle.id === 'no-direction' ? 'trip-24-b' : 'trip-24-a',
			}),
		);

		const features = toVehicleFeatures(withStopTrip, filter).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 0],
			['no-direction', 1],
		]);
	});

	it('keeps all buses (heading or not) when the bus marker is selected', () => {
		const filter = { ...EMPTY_FILTER, entities: ['bus'] } as unknown as FilterState;
		const features = toVehicleFeatures(vehicles, filter).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 1],
			['no-direction', 1],
		]);
	});

	it('hides all buses when only stops are selected', () => {
		const filter = { ...EMPTY_FILTER, entities: ['stop'] } as unknown as FilterState;
		const features = toVehicleFeatures(vehicles, filter).features;

		expect(features.map((f) => f.properties.matched)).toEqual([0, 0]);
	});

	it('keeps only buses with alerts when the bus alert filter is selected', () => {
		const filter = { ...EMPTY_FILTER, alerts: ['has_alert'] } as unknown as FilterState;
		const features = toVehicleFeatures(vehicles, filter, new Set(['directional'])).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 1],
			['no-direction', 0],
		]);
	});

	it('combines alert filtering with marker filtering', () => {
		const filter = {
			...EMPTY_FILTER,
			alerts: ['has_alert'],
			entities: ['bus'],
		} as unknown as FilterState;
		const features = toVehicleFeatures(vehicles, filter, new Set(['directional'])).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 1],
			['no-direction', 0],
		]);
	});
});

describe('toVehicleFeatures retired per-vehicle silence fade', () => {
	const TTL = 30;
	function fleet(freshUtc: string, silentUtc: string) {
		return [
			{ id: 'fresh', lat: 45.5, lon: -73.6, status: 'on_time', updated_utc: freshUtc, bearing: 90 },
			{
				id: 'silent',
				lat: 45.51,
				lon: -73.61,
				status: 'on_time',
				updated_utc: silentUtc,
				bearing: 90,
			},
		].map((v) => VehicleSchema.parse(v));
	}

	it('keeps VehicleSilenceContext only for the per-bus stale calculation', () => {
		const now = Date.parse('2026-06-21T12:00:00Z');
		const fresh = '2026-06-21T12:00:00Z';
		const silent = '2026-06-21T11:55:00Z';
		const silence: VehicleSilenceContext = {
			serverNow: now,
			ttlS: TTL,
		};
		const features = toVehicleFeatures(
			fleet(fresh, silent),
			EMPTY_FILTER,
			new Set(),
			null,
			silence,
		).features;
		const byId = Object.fromEntries(features.map((f) => [f.properties.id, f.properties]));
		expect(byId.fresh.stale).toBe(0);
		expect(byId.silent.stale).toBe(1);
		expect(byId.fresh).not.toHaveProperty('opacity');
		expect(byId.silent).not.toHaveProperty('silenceAgeS');
	});
});

describe('toVehicleFeatures per-bus staleness flag (S5.1: off reported_utc)', () => {
	const now = Date.parse('2026-06-21T12:00:00Z');
	const SNAPSHOT_UTC = '2026-06-21T12:00:00Z';

	function fleet(freshReported: string, staleReported: string) {
		return [
			{
				id: 'fresh',
				lat: 45.5,
				lon: -73.6,
				status: 'on_time',
				updated_utc: SNAPSHOT_UTC,
				reported_utc: freshReported,
				bearing: 90,
			},
			{
				id: 'stale',
				lat: 45.51,
				lon: -73.61,
				status: 'on_time',
				updated_utc: SNAPSHOT_UTC,
				reported_utc: staleReported,
				bearing: 90,
			},
		].map((v) => VehicleSchema.parse(v));
	}

	it('flags a bus whose OWN reported_utc is past the cutoff as stale:1, a fresh one stale:0', () => {
		const fresh = new Date(now - 5 * 1000).toISOString();
		const stale = new Date(now - (STALE_CUTOFF_S + 30) * 1000).toISOString();
		const features = toVehicleFeatures(fleet(fresh, stale), EMPTY_FILTER, new Set(), null, {
			serverNow: now,
		}).features;
		const byId = Object.fromEntries(features.map((f) => [f.properties.id, f.properties]));
		expect(byId.fresh.stale).toBe(0);
		expect(byId.stale.stale).toBe(1);
	});

	it('falls back to updated_utc for staleness when reported_utc is absent', () => {
		const oldSnapshot = new Date(now - (STALE_CUTOFF_S + 30) * 1000).toISOString();
		const [v] = [
			{ id: 'fallback', lat: 45.5, lon: -73.6, status: 'on_time', updated_utc: oldSnapshot },
		].map((x) => VehicleSchema.parse(x));
		const features = toVehicleFeatures([v], EMPTY_FILTER, new Set(), null, {
			serverNow: now,
		}).features;
		expect(features[0].properties.stale).toBe(1);
	});

	it('reports stale:0 for every bus when no silence context (no clock to measure against)', () => {
		const fresh = new Date(now - 5 * 1000).toISOString();
		const stale = new Date(now - (STALE_CUTOFF_S + 30) * 1000).toISOString();
		const features = toVehicleFeatures(fleet(fresh, stale), EMPTY_FILTER).features;
		expect(features.map((f) => f.properties.stale)).toEqual([0, 0]);
	});
});
