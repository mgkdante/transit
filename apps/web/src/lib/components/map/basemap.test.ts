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

	it('keys land/water/roads on Protomaps source-layer names (not OpenMapTiles)', () => {
		const sourceLayers = style.layers
			.filter((l) => 'source-layer' in l)
			.map((l) => (l as { 'source-layer': string })['source-layer']);
		expect(sourceLayers).toEqual([
			'earth',
			'landuse',
			'water',
			'water',
			'roads',
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
			'water',
			'water-edge',
		]);
	});

	it('splits road tiers on the Protomaps `kind` property', () => {
		expect((layerOf('roads-major') as { filter?: unknown }).filter).toEqual([
			'match',
			['get', 'kind'],
			['highway', 'major_road', 'medium_road'],
			true,
			false,
		]);
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
			minzoom: 10,
			filter: ['match', ['get', 'kind'], ['highway', 'major_road', 'medium_road'], true, false],
			layout: {
				'symbol-placement': 'line',
				'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ['get', 'ref']],
				'text-font': ['Noto Sans Regular'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
				'symbol-spacing': 420,
				'text-rotation-alignment': 'map',
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
			minzoom: 12.5,
			filter: ['match', ['get', 'kind'], ['highway', 'major_road', 'medium_road'], false, true],
			layout: {
				'symbol-placement': 'line',
				'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ['get', 'ref']],
				'text-font': ['Noto Sans Regular'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 9, 15, 11],
				'symbol-spacing': 340,
				'text-rotation-alignment': 'map',
				'text-keep-upright': true,
				'text-allow-overlap': false,
				'text-ignore-placement': false,
				'text-optional': true,
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
			minzoom: 9,
			paint: {
				'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.45, 11, 0.8, 14, 1.05],
				'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 11, 0.78, 13, 0.82],
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
		expect(calls).toContainEqual(['water-edge', 'line-color', '#7CA7B2']);
		expect(calls).toContainEqual(['roads-major', 'line-color', '#6E6557']);
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
