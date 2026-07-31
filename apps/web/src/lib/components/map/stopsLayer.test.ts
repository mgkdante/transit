import type { LayerSpecification, Map as MapLibreMap, SourceSpecification } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import type { FilterState } from '$lib/filters';
import {
	addStopExceptionLayer,
	addStopExceptionSource,
	addStopsLayer,
	setStopException,
	STOP_EXCEPTION_LAYER,
	STOP_EXCEPTION_SOURCE,
	STOP_HIGHLIGHT_LAYER,
	STOPS_LAYER,
	STOPS_SOURCE,
	toStopFeatures,
} from './stopsLayer';
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
	it('hands the base layer in at z8 with static size and feature-state paint emphasis', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;

		addStopsLayer(map);
		const layer = layers.find((candidate) => candidate.id === STOPS_LAYER);
		if (!layer) throw new Error('expected stops layer');
		const rendered = layer as LayerSpecification & {
			layout: Record<string, unknown>;
			paint: Record<string, unknown>;
		};

		expect(rendered).toMatchObject({
			id: STOPS_LAYER,
			type: 'symbol',
			source: STOPS_SOURCE,
			minzoom: 8,
			layout: {
				'icon-image': STOP_ICON,
			},
		});
		expect(JSON.stringify(rendered.layout['icon-size'])).toContain('0');
		expect(JSON.stringify(rendered.layout['icon-size'])).not.toContain('selected');
		expect(JSON.stringify(rendered.layout['icon-size'])).not.toContain('hovered');
		expect(JSON.stringify(rendered.layout['icon-size'])).not.toContain('feature-state');
		expect(JSON.stringify(rendered.paint['icon-opacity'])).toContain('feature-state');
		expect(JSON.stringify(rendered.paint['icon-opacity'])).toContain('selected');
		expect(JSON.stringify(rendered.paint['icon-opacity'])).toContain('hovered');
		expect(JSON.stringify(rendered.paint['icon-opacity'])).toContain(
			JSON.stringify(['get', 'selected']),
		);
		expect(usesTopLevelZoomExpression(rendered.layout['icon-size'])).toBe(true);
		expect(usesTopLevelZoomExpression(rendered.paint['icon-opacity'])).toBe(true);
	});

	it('installs the minzoom-8 stop highlight below the stop symbol on the existing source', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;

		addStopsLayer(map);

		const highlight = layers.find((layer) => layer.id === STOP_HIGHLIGHT_LAYER);
		expect(highlight).toBeDefined();
		expect(highlight).toMatchObject({
			type: 'circle',
			source: STOPS_SOURCE,
			minzoom: 8,
		});
		expect(JSON.stringify(highlight?.paint)).toContain('feature-state');
		expect(layers.findIndex((layer) => layer.id === STOP_HIGHLIGHT_LAYER)).toBeLessThan(
			layers.findIndex((layer) => layer.id === STOPS_LAYER),
		);
	});

	it('retints an existing stop highlight on a live theme change', () => {
		const setPaintProperty = vi.fn();
		const map = {
			getLayer: (id: string) => ({ id }),
			setPaintProperty,
		} as unknown as MapLibreMap;

		addStopsLayer(map);

		expect(setPaintProperty).toHaveBeenCalledWith(
			STOP_HIGHLIGHT_LAYER,
			'circle-color',
			'rgb(20, 20, 20)',
		);
		expect(setPaintProperty).toHaveBeenCalledWith(
			STOP_HIGHLIGHT_LAYER,
			'circle-stroke-color',
			'rgb(255, 95, 87)',
		);
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

	it('does not serialize hover into the bulk stop source', () => {
		const features = toStopFeatures([
			{ id: 's1', name: 'Stop 1', lat: 45.5, lon: -73.6 },
			{ id: 's2', name: 'Stop 2', lat: 45.51, lon: -73.61 },
		]).features;

		for (const feature of features) expect(feature.properties).not.toHaveProperty('hovered');
	});
});

describe('low-zoom stop exception', () => {
	const stops = [
		{ id: 's1', name: 'Stop 1', code: '1001', lat: 45.5, lon: -73.6 },
		{ id: 's2', name: 'Stop 2', code: '1002', lat: 45.51, lon: -73.61 },
	];

	it('uses a dedicated non-promoted source and a data-property-styled maxzoom-8 layer', () => {
		const sources: Array<[string, SourceSpecification]> = [];
		const layers: LayerSpecification[] = [];
		const map = {
			getSource: () => undefined,
			addSource: (id: string, source: SourceSpecification) => sources.push([id, source]),
			getLayer: () => undefined,
			addLayer: (layer: LayerSpecification) => layers.push(layer),
		} as unknown as MapLibreMap;

		addStopExceptionSource(map);
		addStopExceptionLayer(map);

		expect(sources).toHaveLength(1);
		expect(sources[0]?.[0]).toBe(STOP_EXCEPTION_SOURCE);
		expect(sources[0]?.[1]).not.toHaveProperty('promoteId');
		const layer = layers.find((candidate) => candidate.id === STOP_EXCEPTION_LAYER);
		expect(layer).toMatchObject({
			type: 'symbol',
			source: STOP_EXCEPTION_SOURCE,
			maxzoom: 8,
		});
		const rendered = JSON.stringify(layer);
		expect(rendered).toContain(JSON.stringify(['get', 'selected']));
		expect(rendered).toContain(JSON.stringify(['get', 'hovered']));
		expect(rendered).not.toContain('feature-state');
	});

	it('writes at most selected plus hovered and gives selected priority on the same stop', () => {
		const setData = vi.fn();
		const map = {
			getSource: (id: string) => (id === STOP_EXCEPTION_SOURCE ? { setData } : undefined),
		} as unknown as MapLibreMap;
		const stopsById = Object.fromEntries(stops.map((stop) => [stop.id, stop]));

		setStopException(map, stopsById, 's2', 's1');
		let collection = setData.mock.calls.at(-1)?.[0] as {
			features: Array<{ properties: Record<string, unknown> }>;
		};
		expect(collection.features).toHaveLength(2);
		expect(collection.features.map((feature) => feature.properties)).toEqual([
			expect.objectContaining({ id: 's2', selected: 1, hovered: 0 }),
			expect.objectContaining({ id: 's1', selected: 0, hovered: 1 }),
		]);

		setStopException(map, stopsById, 's2', 's2');
		collection = setData.mock.calls.at(-1)?.[0] as typeof collection;
		expect(collection.features).toHaveLength(1);
		expect(collection.features[0]?.properties).toEqual(
			expect.objectContaining({ id: 's2', selected: 1, hovered: 0 }),
		);
	});
});
