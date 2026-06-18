// Unit suite for basemap.ts — the null-safe MapLibre style resolver.
//
// Pure JSON in / pure JSON out: no maplibre-gl runtime, no window. We assert the
// honesty branch (null → minimal dark, no external glyph/sprite/tile refs) and
// the vector branch's Protomaps source-layer reconciliation (slice-9.3 task 1.3)
// — a wrong source-layer renders silently empty, so it must be locked by a test.

import { describe, it, expect } from 'vitest';
import {
	resolveBasemapStyle,
	minimalDarkStyle,
	vectorStyleFromBasemap,
	applyBasemapTheme,
	toPmtilesUrl,
	BASEMAP_SOURCE_ID,
} from './basemap';
import { BasemapFileSchema } from '$lib/v1/schemas';

// Parse through the schema so the branded `generated_utc` (IsoUtc) is satisfied.
const FILE = BasemapFileSchema.parse({
	url: 'https://transit.yesid.dev/data/v1/stm/static/basemap/montreal.pmtiles',
	attribution: '© OpenStreetMap contributors, © Protomaps',
	generated_utc: '2026-06-15T00:00:00Z',
	min_zoom: 0,
	max_zoom: 15,
});

describe('toPmtilesUrl', () => {
	it('prefixes a bare https archive url with the pmtiles:// scheme', () => {
		expect(toPmtilesUrl(FILE.url)).toBe(`pmtiles://${FILE.url}`);
	});
	it('is idempotent for an already-prefixed url', () => {
		const pre = `pmtiles://${FILE.url}`;
		expect(toPmtilesUrl(pre)).toBe(pre);
	});
});

describe('minimalDarkStyle (no-basemap honesty state)', () => {
	const style = minimalDarkStyle();
	it('references NO external glyphs, sprite, or vector tiles', () => {
		expect(style.glyphs).toBeUndefined();
		expect(style.sprite).toBeUndefined();
		const hasVector = Object.values(style.sources).some((s) => s.type === 'vector');
		expect(hasVector).toBe(false);
	});
	it('draws only a solid background + an inline graticule', () => {
		expect(style.layers.map((l) => l.id)).toEqual(['background', 'graticule']);
	});

	it('can resolve the light theme palette for the no-basemap state', () => {
		const light = minimalDarkStyle('light');
		expect(light.name).toBe('transit-minimal-light');
		expect(light.layers[0]).toMatchObject({
			id: 'background',
			paint: { 'background-color': '#F7F2E9' },
		});
		expect(light.layers[1]).toMatchObject({
			id: 'graticule',
			paint: { 'line-color': '#6E6557' },
		});
	});
});

describe('vectorStyleFromBasemap (Protomaps schema)', () => {
	const style = vectorStyleFromBasemap(FILE);
	const layerOf = (id: string) => style.layers.find((l) => l.id === id);

	it('registers one pmtiles:// vector source under the basemap id with the zoom range', () => {
		const src = style.sources[BASEMAP_SOURCE_ID];
		expect(src.type).toBe('vector');
		expect((src as { url: string }).url).toBe(`pmtiles://${FILE.url}`);
		expect((src as { minzoom?: number }).minzoom).toBe(0);
		expect((src as { maxzoom?: number }).maxzoom).toBe(15);
	});

	it('decorates the public attribution with a one-line thank-you for OSM contributors', () => {
		const src = style.sources[BASEMAP_SOURCE_ID];
		expect((src as { attribution?: string }).attribution).toBe(
			'Big thanks to © OpenStreetMap contributors, © Protomaps <span class="transit-basemap-thanks" aria-label="thank you">🧡</span>',
		);
	});

	it('keys land/water/roads on Protomaps source-layer names (not OpenMapTiles)', () => {
		const sourceLayers = style.layers
			.filter((l) => 'source-layer' in l)
			.map((l) => (l as { 'source-layer': string })['source-layer']);
		expect(sourceLayers).toEqual([
			'earth',
			'landuse',
			'landuse',
			'water',
			'water',
			'roads',
			'roads',
			'roads',
			'roads',
			'roads',
			'roads',
			'places',
			'places',
			'places',
			'pois',
			'pois',
			'pois',
			'pois',
			'roads',
			'roads',
			'roads',
		]);
		// Guard against a silent regression to the old OpenMapTiles names.
		expect(sourceLayers).not.toContain('landcover');
		expect(sourceLayers).not.toContain('transportation');
	});

	it('draws land fills before water so the river remains visible at low zoom', () => {
		expect(style.layers.map((l) => l.id).slice(0, 5)).toEqual([
			'background',
			'earth',
			'landuse',
			'landuse-green',
			'water',
		]);
	});

	it('splits road tiers on the Protomaps `kind` property', () => {
		expect(layerOf('roads-casing')).toMatchObject({
			id: 'roads-casing',
			type: 'line',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'roads',
			minzoom: 8,
			paint: { 'line-color': '#242424' },
		});
		expect(layerOf('roads-tunnel')).toMatchObject({
			id: 'roads-tunnel',
			type: 'line',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'roads',
			minzoom: 10,
			filter: ['==', ['get', 'is_tunnel'], true],
			paint: { 'line-dasharray': [1.6, 1.2] },
		});
		expect(layerOf('roads-link')).toMatchObject({
			id: 'roads-link',
			type: 'line',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'roads',
			minzoom: 10,
			filter: ['==', ['get', 'is_link'], true],
		});
		expect((layerOf('roads-major') as { filter?: unknown }).filter).toEqual([
			'match',
			['get', 'kind'],
			['highway', 'major_road', 'medium_road'],
			true,
			false,
		]);
		expect(layerOf('roads-bridge')).toMatchObject({
			id: 'roads-bridge',
			type: 'line',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'roads',
			minzoom: 10,
			filter: ['==', ['get', 'is_bridge'], true],
		});
	});

	it('references public glyphs for text labels but no sprite', () => {
		expect(style.glyphs).toBe(
			'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
		);
		expect(style.sprite).toBeUndefined();
	});

	it('adds road label layers using standard MapLibre line placement and collision', () => {
		expect(layerOf('roads-major-labels')).toMatchObject({
			id: 'roads-major-labels',
			type: 'symbol',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'roads',
			minzoom: 9,
			filter: ['match', ['get', 'kind'], ['highway', 'major_road', 'medium_road'], true, false],
			layout: {
				'symbol-placement': 'line',
				'text-field': [
					'coalesce',
					['get', 'name'],
					['get', 'name:fr'],
					['get', 'name:en'],
					['get', 'ref'],
				],
				'text-font': ['Noto Sans Regular'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 11.5, 15, 13],
				'symbol-spacing': 360,
				'symbol-sort-key': ['coalesce', ['get', 'sort_rank'], 0],
				'text-rotation-alignment': 'map',
				'text-pitch-alignment': 'map',
				'text-max-angle': 30,
				'text-padding': 4,
				'text-keep-upright': true,
				'text-allow-overlap': false,
				'text-ignore-placement': false,
				'text-optional': true,
			},
		});
		expect(layerOf('roads-minor-labels')).toMatchObject({
			id: 'roads-minor-labels',
			type: 'symbol',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'roads',
			minzoom: 11,
			filter: ['match', ['get', 'kind'], ['highway', 'major_road', 'medium_road'], false, true],
			layout: {
				'symbol-placement': 'line',
				'text-field': [
					'coalesce',
					['get', 'name'],
					['get', 'name:fr'],
					['get', 'name:en'],
					['get', 'ref'],
				],
				'text-font': ['Noto Sans Regular'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.25, 13, 10.5, 15, 12],
				'symbol-spacing': 300,
				'symbol-sort-key': ['coalesce', ['get', 'sort_rank'], 0],
				'text-rotation-alignment': 'map',
				'text-pitch-alignment': 'map',
				'text-max-angle': 30,
				'text-padding': 3,
				'text-keep-upright': true,
				'text-allow-overlap': false,
				'text-ignore-placement': false,
				'text-optional': true,
			},
		});
	});

	it('adds OSM-style place hierarchy labels for city, neighbourhood, and locality context', () => {
		expect(layerOf('places-city-labels')).toMatchObject({
			id: 'places-city-labels',
			type: 'symbol',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'places',
			minzoom: 6,
			filter: ['match', ['get', 'kind_detail'], ['city', 'town', 'village'], true, false],
			layout: {
				'symbol-placement': 'point',
				'text-field': [
					'coalesce',
					['get', 'name:fr'],
					['get', 'name:en'],
					['get', 'name'],
					['get', 'ref'],
				],
				'text-font': ['Noto Sans Medium'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 10, 15, 14, 18],
				'symbol-sort-key': ['coalesce', ['get', 'population_rank'], ['get', 'sort_rank'], 0],
				'text-padding': 14,
				'text-max-width': 12,
				'text-allow-overlap': false,
				'text-ignore-placement': false,
				'text-optional': true,
			},
		});

		expect(layerOf('places-neighbourhood-labels')).toMatchObject({
			id: 'places-neighbourhood-labels',
			type: 'symbol',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'places',
			minzoom: 9,
			filter: [
				'any',
				['match', ['get', 'kind'], ['macrohood', 'neighbourhood'], true, false],
				['match', ['get', 'kind_detail'], ['neighbourhood', 'quarter'], true, false],
			],
			layout: {
				'symbol-placement': 'point',
				'text-field': [
					'coalesce',
					['get', 'name:fr'],
					['get', 'name:en'],
					['get', 'name'],
					['get', 'ref'],
				],
				'text-font': ['Noto Sans Medium'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 12, 15, 14],
				'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
				'text-radial-offset': 0.45,
				'text-justify': 'auto',
				'symbol-sort-key': ['coalesce', ['get', 'population_rank'], ['get', 'sort_rank'], 0],
				'text-max-width': 11,
				'text-allow-overlap': false,
				'text-ignore-placement': false,
				'text-optional': true,
			},
		});

		expect(layerOf('places-locality-labels')).toMatchObject({
			id: 'places-locality-labels',
			type: 'symbol',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'places',
			minzoom: 11,
			filter: [
				'any',
				['match', ['get', 'kind'], ['locality'], true, false],
				[
					'match',
					['get', 'kind_detail'],
					['locality', 'hamlet', 'farm', 'isolated_dwelling'],
					true,
					false,
				],
			],
			layout: {
				'symbol-placement': 'point',
				'text-field': [
					'coalesce',
					['get', 'name:fr'],
					['get', 'name:en'],
					['get', 'name'],
					['get', 'ref'],
				],
				'text-font': ['Noto Sans Regular'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 13, 10.5, 15, 12],
				'symbol-sort-key': ['coalesce', ['get', 'population_rank'], ['get', 'sort_rank'], 0],
				'text-padding': 8,
				'text-max-width': 10,
				'text-allow-overlap': false,
				'text-ignore-placement': false,
				'text-optional': true,
			},
		});
	});

	it('adds POI icon dots plus labels for parks and landmarks', () => {
		expect(layerOf('poi-park-icons')).toMatchObject({
			id: 'poi-park-icons',
			type: 'circle',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'pois',
			minzoom: 11,
			filter: [
				'any',
				[
					'match',
					['get', 'kind'],
					['park', 'garden', 'recreation_ground', 'nature_reserve', 'forest', 'wood'],
					true,
					false,
				],
				[
					'match',
					['get', 'kind_detail'],
					['park', 'garden', 'recreation_ground', 'nature_reserve', 'forest', 'wood'],
					true,
					false,
				],
			],
			paint: {
				'circle-color': '#8CBF9B',
				'circle-stroke-color': '#141414',
			},
		});

		expect(layerOf('poi-landmark-icons')).toMatchObject({
			id: 'poi-landmark-icons',
			type: 'circle',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'pois',
			minzoom: 12,
			filter: [
				'any',
				[
					'match',
					['get', 'kind'],
					[
						'museum',
						'theatre',
						'library',
						'university',
						'college',
						'school',
						'hospital',
						'stadium',
						'sports_centre',
						'attraction',
						'monument',
						'memorial',
						'place_of_worship',
						'townhall',
						'station',
						'landmark',
						'viewpoint',
					],
					true,
					false,
				],
				[
					'match',
					['get', 'kind_detail'],
					[
						'museum',
						'theatre',
						'library',
						'university',
						'college',
						'school',
						'hospital',
						'stadium',
						'sports_centre',
						'attraction',
						'monument',
						'memorial',
						'place_of_worship',
						'townhall',
						'station',
						'landmark',
						'viewpoint',
					],
					true,
					false,
				],
			],
		});

		expect(layerOf('poi-park-labels')).toMatchObject({
			id: 'poi-park-labels',
			type: 'symbol',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'pois',
			minzoom: 11,
			filter: [
				'any',
				[
					'match',
					['get', 'kind'],
					['park', 'garden', 'recreation_ground', 'nature_reserve', 'forest', 'wood'],
					true,
					false,
				],
				[
					'match',
					['get', 'kind_detail'],
					['park', 'garden', 'recreation_ground', 'nature_reserve', 'forest', 'wood'],
					true,
					false,
				],
			],
			layout: {
				'symbol-placement': 'point',
				'symbol-sort-key': ['coalesce', ['get', 'min_zoom'], ['get', 'sort_rank'], 0],
				'text-max-width': 10,
			},
		});

		expect(layerOf('poi-landmark-labels')).toMatchObject({
			id: 'poi-landmark-labels',
			type: 'symbol',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'pois',
			minzoom: 12,
			filter: [
				'any',
				[
					'match',
					['get', 'kind'],
					[
						'museum',
						'theatre',
						'library',
						'university',
						'college',
						'school',
						'hospital',
						'stadium',
						'sports_centre',
						'attraction',
						'monument',
						'memorial',
						'place_of_worship',
						'townhall',
						'station',
						'landmark',
						'viewpoint',
					],
					true,
					false,
				],
				[
					'match',
					['get', 'kind_detail'],
					[
						'museum',
						'theatre',
						'library',
						'university',
						'college',
						'school',
						'hospital',
						'stadium',
						'sports_centre',
						'attraction',
						'monument',
						'memorial',
						'place_of_worship',
						'townhall',
						'station',
						'landmark',
						'viewpoint',
					],
					true,
					false,
				],
			],
			layout: {
				'symbol-placement': 'point',
				'symbol-sort-key': ['coalesce', ['get', 'min_zoom'], ['get', 'sort_rank'], 0],
				'text-max-width': 10,
			},
		});
	});

	it('adds text-based road shields with line collision rules', () => {
		expect(layerOf('road-shields')).toMatchObject({
			id: 'road-shields',
			type: 'symbol',
			source: BASEMAP_SOURCE_ID,
			'source-layer': 'roads',
			minzoom: 9,
			filter: ['any', ['has', 'shield_text'], ['has', 'ref']],
			layout: {
				'symbol-placement': 'line',
				'text-field': ['coalesce', ['get', 'shield_text'], ['get', 'ref']],
				'text-font': ['Noto Sans Medium'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 9, 8.5, 12, 9.5, 15, 10.5],
				'symbol-spacing': 520,
				'symbol-sort-key': ['coalesce', ['get', 'sort_rank'], 0],
				'text-rotation-alignment': 'map',
				'text-pitch-alignment': 'map',
				'text-padding': 7,
				'text-keep-upright': true,
				'text-allow-overlap': false,
				'text-ignore-placement': false,
				'text-optional': true,
			},
			paint: {
				'text-color': '#141414',
				'text-halo-color': '#D0D0D0',
			},
		});
	});

	it('paints road labels with theme-aware ink and halo', () => {
		expect(layerOf('roads-major-labels')).toMatchObject({
			paint: {
				'text-color': '#A8A8A8',
				'text-halo-color': '#141414',
				'text-halo-width': 1.25,
			},
		});

		const light = vectorStyleFromBasemap(FILE, 'light');
		expect(light.layers.find((l) => l.id === 'roads-major-labels')).toMatchObject({
			paint: {
				'text-color': '#5F574C',
				'text-halo-color': '#F7F2E9',
				'text-halo-width': 1.25,
			},
		});
	});

	it('can resolve a light themed vector basemap style', () => {
		const light = vectorStyleFromBasemap(FILE, 'light');
		expect(light.name).toBe('transit-basemap-light');
		expect(light.layers[0]).toMatchObject({
			id: 'background',
			paint: { 'background-color': '#F7F2E9' },
		});
		expect(light.layers.find((l) => l.id === 'earth')).toMatchObject({
			paint: { 'fill-color': '#F2E9D8' },
		});
		expect(light.layers.find((l) => l.id === 'water')).toMatchObject({
			type: 'line',
			paint: {
				'line-color': '#CFE1E6',
			},
		});
		expect(light.layers.find((l) => l.id === 'water-edge')).toMatchObject({
			type: 'line',
			paint: {
				'line-color': '#7CA7B2',
				'line-opacity': 0.9,
			},
		});
		expect(light.layers.find((l) => l.id === 'roads-major')).toMatchObject({
			paint: { 'line-color': '#6E6557' },
		});
		expect(light.layers.find((l) => l.id === 'roads-major-labels')).toMatchObject({
			paint: {
				'text-color': '#5F574C',
				'text-halo-color': '#F7F2E9',
			},
		});
		expect(light.layers.find((l) => l.id === 'landuse-green')).toMatchObject({
			paint: {
				'fill-color': '#DCE8CC',
			},
		});
	});

	it('keeps dark water visually separate from dark ground', () => {
		expect(layerOf('earth')).toMatchObject({
			paint: { 'fill-color': '#0f0d0a' },
		});
		expect(layerOf('water')).toMatchObject({
			type: 'line',
			paint: {
				'line-color': '#17313a',
			},
		});
		expect(layerOf('water-edge')).toMatchObject({
			type: 'line',
			paint: {
				'line-color': '#347383',
				'line-opacity': 0.9,
			},
		});
	});

	it('draws minor roads strongly enough by the time stops appear', () => {
		expect(layerOf('roads-minor')).toMatchObject({
			minzoom: 8,
			paint: {
				'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.35, 10, 0.65, 12, 0.9, 14, 1.05],
				'line-opacity': [
					'interpolate',
					['linear'],
					['zoom'],
					8,
					0.36,
					10,
					0.64,
					12,
					0.78,
					13,
					0.82,
				],
			},
		});
	});
});

describe('applyBasemapTheme', () => {
	it('repaints existing basemap layers without requiring a full style swap', () => {
		const calls: Array<[string, string, unknown]> = [];
		const map = {
			getLayer: (id: string) => ({ id }),
			setPaintProperty: (layer: string, property: string, value: unknown) => {
				calls.push([layer, property, value]);
			},
		};

		applyBasemapTheme(map, 'light');

		expect(calls).toContainEqual(['background', 'background-color', '#F7F2E9']);
		expect(calls).toContainEqual(['earth', 'fill-color', '#F2E9D8']);
		expect(calls).toContainEqual(['water', 'line-color', '#CFE1E6']);
		expect(calls).not.toContainEqual(['water', 'fill-color', '#CFE1E6']);
		expect(calls).toContainEqual(['landuse-green', 'fill-color', '#DCE8CC']);
		expect(calls).toContainEqual(['water-edge', 'line-color', '#7CA7B2']);
		expect(calls).toContainEqual(['roads-casing', 'line-color', '#E5DAC7']);
		expect(calls).toContainEqual(['roads-tunnel', 'line-color', '#C9BCA1']);
		expect(calls).toContainEqual(['roads-link', 'line-color', '#C9BCA1']);
		expect(calls).toContainEqual(['roads-major', 'line-color', '#6E6557']);
		expect(calls).toContainEqual(['roads-bridge', 'line-color', '#8D806E']);
		expect(calls).toContainEqual(['places-city-labels', 'text-color', '#4F4A42']);
		expect(calls).toContainEqual(['places-neighbourhood-labels', 'text-color', '#4F4A42']);
		expect(calls).toContainEqual(['places-locality-labels', 'text-color', '#4F4A42']);
		expect(calls).toContainEqual(['poi-park-icons', 'circle-color', '#4F744F']);
		expect(calls).toContainEqual(['poi-landmark-icons', 'circle-color', '#7A6642']);
		expect(calls).toContainEqual(['poi-park-labels', 'text-color', '#4F744F']);
		expect(calls).toContainEqual(['poi-landmark-labels', 'text-color', '#7A6642']);
		expect(calls).toContainEqual(['road-shields', 'text-color', '#F7F2E9']);
		expect(calls).toContainEqual(['road-shields', 'text-halo-color', '#4F4A42']);
		expect(calls).toContainEqual(['roads-major-labels', 'text-color', '#5F574C']);
		expect(calls).toContainEqual(['roads-major-labels', 'text-halo-color', '#F7F2E9']);
		expect(calls).toContainEqual(['roads-minor-labels', 'text-color', '#5F574C']);
		expect(calls).toContainEqual(['roads-minor-labels', 'text-halo-color', '#F7F2E9']);
	});

	it('skips missing layers so the no-basemap fallback stays safe', () => {
		const calls: Array<[string, string, unknown]> = [];
		const map = {
			getLayer: (id: string) => (id === 'background' ? { id } : undefined),
			setPaintProperty: (layer: string, property: string, value: unknown) => {
				calls.push([layer, property, value]);
			},
		};

		applyBasemapTheme(map, 'dark');

		expect(calls).toEqual([['background', 'background-color', '#141414']]);
	});
});

describe('resolveBasemapStyle (honesty branch)', () => {
	it('falls back to minimal dark when manifest.basemap is null', () => {
		expect(resolveBasemapStyle({ basemap: null }, FILE).name).toBe('transit-minimal-dark');
	});
	it('falls back to minimal dark when the BasemapFile is missing', () => {
		expect(resolveBasemapStyle({ basemap: 'static/basemap.json' }, null).name).toBe(
			'transit-minimal-dark',
		);
	});
	it('builds the vector style when both the pointer and file are present', () => {
		expect(resolveBasemapStyle({ basemap: 'static/basemap.json' }, FILE).name).toBe(
			'transit-basemap-dark',
		);
	});
	it('passes the selected theme through to either style branch', () => {
		expect(resolveBasemapStyle({ basemap: null }, FILE, 'light').name).toBe(
			'transit-minimal-light',
		);
		expect(resolveBasemapStyle({ basemap: 'static/basemap.json' }, FILE, 'light').name).toBe(
			'transit-basemap-light',
		);
	});
});
