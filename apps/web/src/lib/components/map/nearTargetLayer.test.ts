import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import {
	LOCATION_PIN_ICON,
	NEAR_TARGET_LAYER,
	NEAR_TARGET_SOURCE,
	addNearTargetLayer,
	setNearTarget,
	toNearTargetFeatures,
} from './nearTargetLayer';

describe('nearTargetLayer', () => {
	it('builds one centered pin feature for any resolved near-me target', () => {
		expect(
			toNearTargetFeatures({
				lat: 45.525686,
				lon: -73.594764,
				label: '5333 Avenue Casgrain, Montréal, Quebec',
				precision: 'address',
			}),
		).toEqual({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [-73.594764, 45.525686] },
					properties: {
						id: 'near-target',
						label: '5333 Avenue Casgrain, Montréal, Quebec',
						precision: 'address',
					},
				},
			],
		});
	});

	it('clears the pin when no near-me target is selected', () => {
		expect(toNearTargetFeatures(null)).toEqual({ type: 'FeatureCollection', features: [] });
	});

	it('renders a distinct bottom-anchored symbol above the transit entities', () => {
		let layer: LayerSpecification | null = null;
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layer = nextLayer;
			},
		} as unknown as MapLibreMap;

		addNearTargetLayer(map);
		if (!layer) throw new Error('expected near-target layer');
		const rendered = layer as LayerSpecification & { layout: Record<string, unknown> };

		expect(rendered).toMatchObject({
			id: NEAR_TARGET_LAYER,
			type: 'symbol',
			source: NEAR_TARGET_SOURCE,
			layout: {
				'icon-image': LOCATION_PIN_ICON,
				'icon-anchor': 'bottom',
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
			},
		});
		expect(JSON.stringify(rendered.layout['icon-size'])).toContain('zoom');
	});

	it('pushes the current near target into the MapLibre source', () => {
		let data: unknown = null;
		const source = {
			setData: (nextData: Parameters<GeoJSONSource['setData']>[0]) => {
				data = nextData;
			},
		};
		const map = {
			getSource: (id: string) => (id === NEAR_TARGET_SOURCE ? source : undefined),
		} as unknown as MapLibreMap;

		setNearTarget(map, {
			lat: 45.5,
			lon: -73.6,
			label: 'My location',
			precision: 'address',
		});

		expect(data).toMatchObject({
			features: [
				{
					geometry: { coordinates: [-73.6, 45.5] },
					properties: { label: 'My location', precision: 'address' },
				},
			],
		});
	});
});
