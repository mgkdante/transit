import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { FilterState } from '$lib/filters';
import { VehicleSchema } from '$lib/v1/schemas';
import {
	addVehicleLayers,
	VEHICLE_BODY_LAYER,
	VEHICLE_SOURCE,
	toVehicleFeatures,
} from './vehicleLayer';

function usesTopLevelZoomExpression(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		(value[0] === 'interpolate' || value[0] === 'step') &&
		Array.isArray(value[2]) &&
		value[2][0] === 'zoom'
	);
}

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
	it('uses a MapLibre-valid top-level zoom expression for selected and hovered bus size', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;

		addVehicleLayers(map);

		const layer = layers[0];
		expect(layer).toMatchObject({
			id: VEHICLE_BODY_LAYER,
			type: 'symbol',
			source: VEHICLE_SOURCE,
		});
		const layout = (layer.layout ?? {}) as Record<string, unknown>;
		expect(usesTopLevelZoomExpression(layout['icon-size'])).toBe(true);
		expect(JSON.stringify(layout['icon-size'])).toContain('selected');
		expect(JSON.stringify(layout['icon-size'])).toContain('hovered');
	});

	it('marks the selected bus so the map can highlight it without filtering context', () => {
		const features = toVehicleFeatures(vehicles, EMPTY_FILTER, new Set(), 'no-direction').features;

		expect(features.map((f) => [f.properties.id, f.properties.selected])).toEqual([
			['directional', 0],
			['no-direction', 1],
		]);
	});

	it('marks the hovered bus so the map can grow it without selecting it', () => {
		const features = (
			toVehicleFeatures as (
				...args:
					| Parameters<typeof toVehicleFeatures>
					| [...Parameters<typeof toVehicleFeatures>, string]
			) => ReturnType<typeof toVehicleFeatures>
		)(vehicles, EMPTY_FILTER, new Set(), null, 'directional').features;

		expect(
			features.map((f) => [f.properties.id, f.properties.selected, f.properties.hovered]),
		).toEqual([
			['directional', 0, 1],
			['no-direction', 0, 0],
		]);
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
