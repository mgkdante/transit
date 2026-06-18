import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { IsoUtc, RouteFile } from '$lib/v1/schemas';
import {
	addRouteLineLayers,
	ROUTE_LINE_CASING_LAYER,
	ROUTE_LINE_HIT_LAYER,
	ROUTE_LINE_LAYER,
	ROUTE_LINE_SOURCE,
	toRouteLineFeatures,
} from './routeLines';

const utc = (value: string) => value as IsoUtc;

const route161: RouteFile = {
	generated_utc: utc('2026-06-16T00:00:00Z'),
	id: '161',
	long: 'Van Horne',
	directions: [
		{
			dir: 0,
			headsign: 'East',
			shape: {
				type: 'LineString',
				coordinates: [
					[-73.63, 45.51],
					[-73.62, 45.52],
				],
			},
		},
		{
			dir: 1,
			headsign: 'West',
			shape: {
				type: 'LineString',
				coordinates: [
					[-73.62, 45.52],
					[-73.63, 45.51],
				],
			},
		},
	],
};

const route24: RouteFile = {
	generated_utc: utc('2026-06-16T00:00:00Z'),
	id: '24',
	long: 'Sherbrooke',
	directions: [
		{
			dir: 0,
			headsign: 'North',
			shape: {
				type: 'LineString',
				coordinates: [
					[-73.58, 45.5],
					[-73.57, 45.51],
				],
			},
		},
	],
};

function usesTopLevelZoomExpression(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		(value[0] === 'interpolate' || value[0] === 'step') &&
		Array.isArray(value[2]) &&
		value[2][0] === 'zoom'
	);
}

describe('toRouteLineFeatures', () => {
	it('builds one line feature per route direction across multiple selected routes', () => {
		const features = toRouteLineFeatures([route161, route24], { id: '161', direction: 1 }).features;

		expect(features.map((feature) => feature.properties.id)).toEqual(['161:0', '161:1', '24:0']);
		expect(features.map((feature) => feature.properties.route_id)).toEqual(['161', '161', '24']);
		expect(features.map((feature) => feature.properties.selected)).toEqual([0, 1, 0]);
		expect(features[0].geometry).toEqual(route161.directions?.[0].shape);
	});

	it('assigns unique variant keys when one route has duplicate GTFS direction ids', () => {
		const routeWithVariants: RouteFile = {
			generated_utc: utc('2026-06-16T00:00:00Z'),
			id: '24',
			long: 'Sherbrooke',
			directions: [
				{
					dir: 0,
					headsign: 'Ouest',
					stops: [
						{ id: '52819', seq: 1, name: 'Montgomery / Sherbrooke' },
						{ id: '51243', seq: 47, name: 'Station Villa-Maria (Décarie / de Monkland)' },
					],
					shape: {
						type: 'LineString',
						coordinates: [
							[-73.55, 45.52],
							[-73.62, 45.48],
						],
					},
				},
				{
					dir: 0,
					headsign: 'Ouest destination Station Sherbrooke',
					stops: [
						{ id: '52819', seq: 1, name: 'Montgomery / Sherbrooke' },
						{ id: '52508', seq: 13, name: 'Station Sherbrooke (Édicule Est )' },
					],
					shape: {
						type: 'LineString',
						coordinates: [
							[-73.55, 45.52],
							[-73.57, 45.52],
						],
					},
				},
				{
					dir: 1,
					headsign: 'Est',
					stops: [
						{ id: '51241', seq: 1, name: 'Station Villa-Maria' },
						{ id: '52819', seq: 47, name: 'Montgomery / Sherbrooke' },
					],
					shape: {
						type: 'LineString',
						coordinates: [
							[-73.62, 45.48],
							[-73.55, 45.52],
						],
					},
				},
			],
		};

		const features = toRouteLineFeatures([routeWithVariants]).features;
		const variantKeys = features.map((feature) => feature.properties.variant_key);

		expect(features).toHaveLength(3);
		expect(new Set(features.map((feature) => feature.properties.id)).size).toBe(3);
		expect(new Set(variantKeys).size).toBe(3);
		expect(features.map((feature) => feature.properties.terminal_label)).toEqual([
			'toward Station Villa-Maria (Décarie / de Monkland)',
			'toward Station Sherbrooke (Édicule Est )',
			'toward Montgomery / Sherbrooke',
		]);

		const selected = toRouteLineFeatures([routeWithVariants], {
			id: '24',
			variantKey: variantKeys[1],
		}).features;

		expect(selected.map((feature) => feature.properties.selected)).toEqual([0, 1, 0]);
	});

	it('drops missing or malformed shapes', () => {
		const features = toRouteLineFeatures([
			{ ...route161, directions: [{ dir: 0, shape: null }] },
			{
				...route24,
				directions: [{ dir: 0, shape: { type: 'Point', coordinates: [-73.5, 45.5] } }],
			},
		]).features;

		expect(features).toEqual([]);
	});
});

describe('addRouteLineLayers', () => {
	it('adds cased brand-yellow route lines with selected width and a wide hit layer', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (layer: LayerSpecification) => {
				layers.push(layer);
			},
		} as unknown as MapLibreMap;

		addRouteLineLayers(map);

		expect(layers.map((layer) => layer.id)).toEqual([
			ROUTE_LINE_CASING_LAYER,
			ROUTE_LINE_LAYER,
			ROUTE_LINE_HIT_LAYER,
		]);
		expect(layers[0]).toMatchObject({
			type: 'line',
			source: ROUTE_LINE_SOURCE,
			paint: { 'line-color': 'rgb(20, 20, 20)' },
		});
		expect(layers[1]).toMatchObject({
			type: 'line',
			source: ROUTE_LINE_SOURCE,
			paint: { 'line-color': 'rgb(255, 182, 39)' },
		});
		const routePaint = (layers[1].paint ?? {}) as Record<string, unknown>;
		expect(JSON.stringify(routePaint['line-width'])).toContain('selected');
		expect(usesTopLevelZoomExpression(routePaint['line-width'])).toBe(true);
		const casingPaint = (layers[0].paint ?? {}) as Record<string, unknown>;
		expect(usesTopLevelZoomExpression(casingPaint['line-width'])).toBe(true);
		expect(layers[2]).toMatchObject({
			type: 'line',
			source: ROUTE_LINE_SOURCE,
			paint: { 'line-opacity': 0 },
		});
	});

	it('retints existing route line layers when the app theme changes', () => {
		const paintCalls: Array<[string, string, unknown]> = [];
		const map = {
			getLayer: (id: string) => (id === ROUTE_LINE_LAYER ? { id } : undefined),
			setPaintProperty: (layer: string, prop: string, value: unknown) => {
				paintCalls.push([layer, prop, value]);
			},
		} as unknown as MapLibreMap;

		addRouteLineLayers(map);

		expect(paintCalls).toContainEqual([ROUTE_LINE_CASING_LAYER, 'line-color', 'rgb(20, 20, 20)']);
		expect(paintCalls).toContainEqual([ROUTE_LINE_LAYER, 'line-color', 'rgb(255, 182, 39)']);
		expect(paintCalls).toContainEqual([ROUTE_LINE_HIT_LAYER, 'line-color', 'rgb(255, 182, 39)']);
	});
});
