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
		expect(sourceLayers).toEqual(['earth', 'landuse', 'water', 'roads', 'roads']);
		// Guard against a silent regression to the old OpenMapTiles names.
		expect(sourceLayers).not.toContain('landcover');
		expect(sourceLayers).not.toContain('transportation');
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

	it('references NO external glyphs or sprite (renders offline)', () => {
		expect(style.glyphs).toBeUndefined();
		expect(style.sprite).toBeUndefined();
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
});
