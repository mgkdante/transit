import { describe, it, expect } from 'vitest';
import { VehicleSchema } from '#lib/v1/schemas/index.ts';
import { emptyFilterState, fromSearchParams, toSearchString } from '#lib/filters/index.ts';
import { toVehicleFeatures } from '#lib/components/map/vehicleLayer.ts';
import { outOfServiceCount } from './vehicleService';

describe.each(['stm', 'octranspo'])('%s vehicle service', (provider) => {
	const vehicles = ['trip', null, ''].map((trip, i) =>
		VehicleSchema.parse({
			id: provider + i,
			trip,
			lat: 45.5,
			lon: -73.6,
			status: 'late',
			delay_min: 5,
			updated_utc: '2026-06-15T00:00:00Z',
		}),
	);
	it('counts parked vehicles and hides them by default', () => {
		expect(outOfServiceCount(vehicles)).toBe(2);
		expect(outOfServiceCount([])).toBe(0);
		expect(
			toVehicleFeatures(vehicles, emptyFilterState()).features.map((v) => v.properties.id),
		).toEqual([provider + '0']);
	});
	it('round trips the opt-in through the URL and never adds punctuality markers', () => {
		const state = emptyFilterState();
		state.showOutOfService = true;
		state.status = ['late'];
		const restored = fromSearchParams(new URLSearchParams(toSearchString(state)));
		const features = toVehicleFeatures(vehicles, restored).features;
		expect(features).toHaveLength(3);
		expect(features.slice(1).map((v) => v.properties.mark)).toEqual(['', '']);
		expect(
			fromSearchParams(new URLSearchParams('out_of_service=0')).showOutOfService,
		).toBeUndefined();
	});
});
