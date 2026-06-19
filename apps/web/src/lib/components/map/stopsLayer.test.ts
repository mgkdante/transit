import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { FilterState } from '$lib/filters';
import { addStopsLayer, STOPS_LAYER, STOPS_SOURCE, toStopFeatures } from './stopsLayer';
import { STOP_ICON } from './vehicleSprites';

function usesTopLevelZoomExpression(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		(value[0] === 'interpolate' || value[0] === 'step') &&
		Array.isArray(value[2]) &&
		value[2][0] === 'zoom'
	);
}

describe('addStopsLayer', () => {
	it('shows normal stops when low-zoom streets appear but allows selected stops from any zoom', () => {
		let layer: LayerSpecification | null = null;
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layer = nextLayer;
			},
		} as unknown as MapLibreMap;

		addStopsLayer(map);
		if (!layer) throw new Error('expected stops layer');
		const rendered = layer as LayerSpecification & {
			layout: Record<string, unknown>;
			paint: Record<string, unknown>;
		};

		expect(rendered).toMatchObject({
			id: STOPS_LAYER,
			type: 'symbol',
			source: STOPS_SOURCE,
			minzoom: 0,
			layout: {
				'icon-image': STOP_ICON,
			},
		});
		expect(JSON.stringify(rendered.layout['icon-size'])).toContain('0.95');
		expect(JSON.stringify(rendered.layout['icon-size'])).toContain('0');
		expect(JSON.stringify(rendered.layout['icon-size'])).toContain('selected');
		expect(JSON.stringify(rendered.layout['icon-size'])).toContain('hovered');
		expect(JSON.stringify(rendered.paint['icon-opacity'])).toContain('selected');
		expect(JSON.stringify(rendered.paint['icon-opacity'])).toContain('hovered');
		expect(usesTopLevelZoomExpression(rendered.layout['icon-size'])).toBe(true);
		expect(usesTopLevelZoomExpression(rendered.paint['icon-opacity'])).toBe(true);
	});

	it('hides stops when the shape filter selects buses only', () => {
		const filter = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
			entities: ['bus'],
		} as unknown as FilterState;

		expect(
			toStopFeatures([{ id: 's1', name: 'Stop 1', lat: 45.5, lon: -73.6 }], filter).features,
		).toEqual([]);
	});

	it('keeps only stops with alerts when the stop alert filter is selected', () => {
		const filter = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
			alerts: ['has_alert'],
		} as unknown as FilterState;

		expect(
			toStopFeatures(
				[
					{ id: 's1', name: 'Stop 1', lat: 45.5, lon: -73.6 },
					{ id: 's2', name: 'Stop 2', lat: 45.51, lon: -73.61 },
				],
				filter,
				new Set(['s2']),
			).features.map((feature) => feature.properties.id),
		).toEqual(['s2']);
	});

	it('combines alert filtering with marker filtering', () => {
		const filter = {
			routes: new Set(),
			stops: new Set(),
			trips: new Set(),
			vehicles: new Set(),
			alerts: ['has_alert'],
			entities: ['bus'],
		} as unknown as FilterState;

		expect(
			toStopFeatures([{ id: 's1', name: 'Stop 1', lat: 45.5, lon: -73.6 }], filter, new Set(['s1']))
				.features,
		).toEqual([]);
	});

	it('keeps only the selected stop when a stop filter is active and marks the highlighted stop', () => {
		const filter = {
			routes: new Set(),
			stops: new Set(['s2']),
			trips: new Set(),
			vehicles: new Set(),
		} as FilterState;

		expect(
			toStopFeatures(
				[
					{ id: 's1', name: 'Stop 1', lat: 45.5, lon: -73.6 },
					{ id: 's2', name: 'Stop 2', lat: 45.51, lon: -73.61 },
				],
				filter,
				new Set(),
				's2',
			).features.map((feature) => [feature.properties.id, feature.properties.selected]),
		).toEqual([['s2', 1]]);
	});

	it('marks an exact stop filter as selected-sized even without an open detail panel', () => {
		const filter = {
			routes: new Set(),
			stops: new Set(['s2']),
			trips: new Set(),
			vehicles: new Set(),
		} as FilterState;

		expect(
			toStopFeatures(
				[
					{ id: 's1', name: 'Stop 1', lat: 45.5, lon: -73.6 },
					{ id: 's2', name: 'Stop 2', lat: 45.51, lon: -73.61 },
				],
				filter,
			).features.map((feature) => [feature.properties.id, feature.properties.selected]),
		).toEqual([['s2', 1]]);
	});

	it('marks the hovered stop so the map can grow it without selecting it', () => {
		const features = (
			toStopFeatures as unknown as (...args: unknown[]) => ReturnType<typeof toStopFeatures>
		)(
			[
				{ id: 's1', name: 'Stop 1', lat: 45.5, lon: -73.6 },
				{ id: 's2', name: 'Stop 2', lat: 45.51, lon: -73.61 },
			],
			undefined,
			new Set(),
			null,
			's2',
		).features;

		expect(
			features.map((feature) => [
				feature.properties.id,
				feature.properties.selected,
				feature.properties.hovered,
			]),
		).toEqual([
			['s1', 0, 0],
			['s2', 0, 1],
		]);
	});
});
