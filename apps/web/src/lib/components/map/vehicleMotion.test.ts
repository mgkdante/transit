import { describe, expect, it } from 'vitest';
import { interpolateVehicleFeatures } from './vehicleMotion';

const from = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [-73.6, 45.5] },
			properties: {
				id: '40061',
				body: 'old-body',
				bearing: 350,
				hasHeading: 1,
				route: '161',
				selected: 0,
				hovered: 0,
				matched: 1,
			},
		},
	],
} as const;

const to = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [-73.58, 45.52] },
			properties: {
				id: '40061',
				body: 'new-body',
				bearing: 10,
				hasHeading: 1,
				route: '161',
				selected: 1,
				hovered: 1,
				matched: 1,
			},
		},
		{
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [-73.7, 45.6] },
			properties: {
				id: 'new-bus',
				body: 'new-body',
				bearing: 90,
				hasHeading: 1,
				route: '80',
				selected: 0,
				hovered: 0,
				matched: 1,
			},
		},
	],
} as const;

describe('interpolateVehicleFeatures', () => {
	it('interpolates coordinates and shortest-arc bearing while preserving target styling', () => {
		const mid = interpolateVehicleFeatures(from, to, 0.5);

		expect(mid.features[0].geometry.coordinates).toEqual([-73.59, 45.51]);
		expect(mid.features[0].properties.bearing).toBe(0);
		expect(mid.features[0].properties.body).toBe('new-body');
		expect(mid.features[0].properties.selected).toBe(1);
		expect(mid.features[0].properties.hovered).toBe(1);
	});

	it('snaps new vehicles directly to their target point', () => {
		const mid = interpolateVehicleFeatures(from, to, 0.5);

		expect(mid.features[1].properties.id).toBe('new-bus');
		expect(mid.features[1].geometry.coordinates).toEqual([-73.7, 45.6]);
	});
});
