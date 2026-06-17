// basemap.ts — null-safe MapLibre style resolver.
//
// Pure, SSR-safe, unit-testable: NO `window`, NO maplibre-gl import at module
// scope (only the StyleSpecification *type*, erased at compile time). Given a
// snapshot Manifest (+ optionally the resolved BasemapFile pointer it names),
// produce a MapLibre `StyleSpecification` the MapStage can hand straight to
// `map.setStyle` / the Map constructor.
//
// Two honest branches, driven by the contract's null:
//   1. Manifest.basemap === null (no PMTiles archive hosted yet, OR no
//      BasemapFile passed) → a SELF-CONTAINED minimal dark style: a solid
//      surface background + a graticule drawn from an inline GeoJSON source.
//      ZERO external glyphs/sprites/tiles, so it renders offline and never
//      blocks on a 404. This is the "no basemap" honesty state.
//   2. Otherwise → a vector style sourced from the BasemapFile's `pmtiles://`
//      archive, themed with the active neutral surface palette. min_zoom/max_zoom
//      on the source come from the BasemapFile; the layer paint uses raw
//      token-derived hexes (this file can't read CSS vars — see BASEMAP_PALETTES
//      below). The vector branch uses a glyph endpoint for road/street labels.
//
// DOCTRINE: a basemap is geographic CHROME, not a data mark, so it stays off
// the dataviz status/occupancy/severity scales AND off interactive --primary.
// It uses the neutral dark *surface* palette (background/land/water/roads),
// leaving the dataviz scale free for the overlay marks drawn on top.

import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from 'maplibre-gl';
import type { BasemapFile, Manifest } from '$lib/v1/schemas';

/**
 * Neutral surface palette for the basemap chrome. These mirror the theme
 * surface/border tokens in src/lib/styles/tokens.css. We inline the resolved
 * hexes here because a MapLibre `StyleSpecification` is plain JSON consumed by
 * a WebGL renderer that cannot read CSS custom properties.
 *
 * NOTE: these are surface/neutral tokens ONLY — never the dataviz data scale
 * and never interactive --primary. Keep in sync with the dark theme block.
 */
export type BasemapTheme = 'dark' | 'light';

interface BasemapPalette {
	background: string;
	land: string;
	water: string;
	waterEdge: string;
	road: string;
	roadMajor: string;
	ink: string;
	labelHalo: string;
}

type PaintValue = unknown;
type LayerPaint = Record<string, PaintValue>;
type BasemapPaintMap = Record<string, LayerPaint>;

const BASEMAP_PALETTES: Record<BasemapTheme, BasemapPalette> = {
	dark: {
		/** --background (dark) — the void behind everything. */
		background: '#141414',
		/** --manifesto (dark) — deep land fill, a touch darker than the void. */
		land: '#0f0d0a',
		/** Cool dark water — intentionally distinct from the warm land fill. */
		water: '#17313a',
		/** Water boundary ink, strong enough to define shorelines at low zoom. */
		waterEdge: '#347383',
		/** --border (dark) — minor road / casing strokes. */
		road: '#3a3a3a',
		/** --border-strong (dark) — major road / graticule ink. */
		roadMajor: '#4a4a4a',
		/** Label ink: brighter than road strokes, still below transit markers. */
		ink: '#A8A8A8',
		/** Label halo blends into the dark map surface. */
		labelHalo: '#141414',
	},
	light: {
		/** --background (light) — warm station paper. */
		background: '#F7F2E9',
		/** --manifesto (light) — warm land fill. */
		land: '#F2E9D8',
		/** Cool river water — not another cream/tan so waterways remain legible. */
		water: '#CFE1E6',
		/** Water boundary ink, quiet enough to stay below roads and entities. */
		waterEdge: '#7CA7B2',
		/** --border (light) — minor road / casing strokes. */
		road: '#C9BCA1',
		/** --muted-foreground (light) — major road / graticule ink. */
		roadMajor: '#6E6557',
		/** Label ink: readable on warm paper without becoming primary data. */
		ink: '#5F574C',
		/** Label halo blends into the light map surface. */
		labelHalo: '#F7F2E9',
	},
};

function paintsForTheme(theme: BasemapTheme): BasemapPaintMap {
	const palette = BASEMAP_PALETTES[theme];
	return {
		background: { 'background-color': palette.background },
		graticule: {
			'line-color': palette.roadMajor,
			'line-width': 0.5,
			'line-opacity': 0.4,
		},
		earth: { 'fill-color': palette.land },
		landuse: { 'fill-color': palette.land, 'fill-opacity': 0.5 },
		water: {
			'line-color': palette.water,
			'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.3, 11, 0.55, 14, 0.85],
			'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.45, 11, 0.62, 14, 0.72],
		},
		'water-edge': {
			'line-color': palette.waterEdge,
			'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.55, 13, 1.05],
			'line-opacity': 0.9,
		},
		'roads-minor': {
			'line-color': palette.road,
			'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.45, 11, 0.8, 14, 1.05],
			'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 11, 0.78, 13, 0.82],
		},
			'roads-major': {
				'line-color': palette.roadMajor,
				'line-width': 1.25,
			},
			'roads-major-labels': {
				'text-color': palette.ink,
				'text-halo-color': palette.labelHalo,
				'text-halo-width': 1.25,
			},
			'roads-minor-labels': {
				'text-color': palette.ink,
				'text-halo-color': palette.labelHalo,
				'text-halo-width': 1.15,
			},
		};
	}

interface PaintableMap {
	getLayer(id: string): unknown;
	setPaintProperty(layer: string, property: string, value: PaintValue): void;
}

/** Repaint an already-loaded basemap for a theme toggle without resetting the style source. */
export function applyBasemapTheme(map: PaintableMap, theme: BasemapTheme): void {
	for (const [layer, paint] of Object.entries(paintsForTheme(theme))) {
		if (!map.getLayer(layer)) continue;
		for (const [property, value] of Object.entries(paint)) {
			map.setPaintProperty(layer, property, value);
		}
	}
}

const PMTILES_SCHEME = 'pmtiles://';

/** The vector source id every generated vector style registers under. */
export const BASEMAP_SOURCE_ID = 'basemap';

const BASEMAP_GLYPHS_URL =
	'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
const ROAD_NAME_FIELD = [
	'coalesce',
	['get', 'name:en'],
	['get', 'name'],
	['get', 'ref'],
] as ExpressionSpecification;
const MAJOR_ROAD_FILTER = [
	'match',
	['get', 'kind'],
	['highway', 'major_road', 'medium_road'],
	true,
	false,
] as FilterSpecification;
const MINOR_ROAD_FILTER = [
	'match',
	['get', 'kind'],
	['highway', 'major_road', 'medium_road'],
	false,
	true,
] as FilterSpecification;

// Minimal local GeoJSON shapes for the inline graticule. We define these here
// rather than import the global `GeoJSON.*` namespace (@types/geojson) — that
// package is only a transitive maplibre dependency, not a direct one, so the
// ambient namespace isn't guaranteed in this module's isolated type graph.
// MapLibre's geojson source `data` accepts any structurally-valid GeoJSON, so
// these structural types are assignable at the call site.
type Lon = number;
type Lat = number;
type Position = [Lon, Lat];

interface GraticuleFeature {
	type: 'Feature';
	properties: Record<string, number | string>;
	geometry: { type: 'LineString'; coordinates: Position[] };
}

interface GraticuleCollection {
	type: 'FeatureCollection';
	features: GraticuleFeature[];
}

/**
 * Build the `pmtiles://`-prefixed source url MapLibre routes to the registered
 * pmtiles Protocol. Idempotent: a url already carrying the scheme is returned
 * unchanged, so callers can pass either a bare https archive url or one a
 * publisher already prefixed.
 */
export function toPmtilesUrl(url: string): string {
	return url.startsWith(PMTILES_SCHEME) ? url : `${PMTILES_SCHEME}${url}`;
}

/**
 * A self-contained minimal dark style with NO external dependencies.
 *
 * - solid surface background (the dark void)
 * - a 10°-spaced graticule (lon/lat grid) from an INLINE GeoJSON source so the
 *   user sees *something* geographic without any tile/glyph/sprite fetch.
 *
 * Used whenever there is no hosted PMTiles archive (Manifest.basemap === null)
 * or no BasemapFile was supplied. Honest "no basemap" state — not an error.
 */
export function minimalDarkStyle(theme: BasemapTheme = 'dark'): StyleSpecification {
	const paint = paintsForTheme(theme);
	return {
		version: 8,
		name: `transit-minimal-${theme}`,
		// No external glyphs/sprite: this style draws no text/symbol layers, so
		// MapLibre never needs a glyph endpoint. Omitting them keeps it offline.
		sources: {
			graticule: {
				type: 'geojson',
				data: graticuleGeoJson(),
			},
		},
		layers: [
			{
				id: 'background',
				type: 'background',
				paint: paint.background,
			},
			{
				id: 'graticule',
				type: 'line',
				source: 'graticule',
				paint: paint.graticule,
			},
		],
	};
}

/**
 * Build a vector basemap style from a BasemapFile pointer, themed with the
 * neutral dark surface palette. The single vector source points at the
 * `pmtiles://` archive; min/max zoom come from the BasemapFile when present.
 *
 * The layer set keys on the PROTOMAPS basemap v3 source-layer names that the
 * Montréal extract ships (`earth`, `landuse`, `water`, `roads`), NOT the
 * OpenMapTiles names — a `pmtiles extract` of a build.protomaps.com archive uses
 * the Protomaps schema. Road tiers are split on the `kind` property
	 * (`highway`/`major_road`/`medium_road` = major, the rest minor). Text labels
	 * use MapLibre's standard line-placement symbol technique, with a public glyph
	 * endpoint and no sprite dependency.
 *
 * CONFIRM against `pmtiles show montreal.pmtiles` at extract time (task 1.2):
 * if the build's layer/property names differ, reconcile here — a wrong
 * `source-layer` renders silently empty, not an error.
 */
export function vectorStyleFromBasemap(
	file: BasemapFile,
	theme: BasemapTheme = 'dark',
): StyleSpecification {
	const sourceUrl = toPmtilesUrl(file.url);
	const paint = paintsForTheme(theme);

	const vectorSource: StyleSpecification['sources'][string] = {
		type: 'vector',
		url: sourceUrl,
		attribution: file.attribution,
		...(file.min_zoom != null ? { minzoom: file.min_zoom } : {}),
		...(file.max_zoom != null ? { maxzoom: file.max_zoom } : {}),
	};

		return {
			version: 8,
			name: `transit-basemap-${theme}`,
			glyphs: BASEMAP_GLYPHS_URL,
			sources: {
				[BASEMAP_SOURCE_ID]: vectorSource,
			},
		layers: [
			{
				id: 'background',
				type: 'background',
				paint: paint.background,
			},
			{
				id: 'earth',
				type: 'fill',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'earth',
				paint: paint.earth,
			},
			{
				id: 'landuse',
				type: 'fill',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'landuse',
				paint: paint.landuse,
			},
			{
				id: 'water',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'water',
				paint: paint.water,
			},
			{
				id: 'water-edge',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'water',
				paint: paint['water-edge'],
			},
			{
				id: 'roads-minor',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				minzoom: 9,
				paint: paint['roads-minor'],
			},
			{
				id: 'roads-major',
				type: 'line',
					source: BASEMAP_SOURCE_ID,
					'source-layer': 'roads',
					filter: MAJOR_ROAD_FILTER,
					paint: paint['roads-major'],
				},
				{
					id: 'roads-major-labels',
					type: 'symbol',
					source: BASEMAP_SOURCE_ID,
					'source-layer': 'roads',
					minzoom: 10,
					filter: MAJOR_ROAD_FILTER,
					layout: {
						'symbol-placement': 'line',
						'text-field': ROAD_NAME_FIELD,
						'text-font': ['Noto Sans Regular'],
						'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
						'symbol-spacing': 420,
						'text-rotation-alignment': 'map',
						'text-keep-upright': true,
						'text-allow-overlap': false,
						'text-ignore-placement': false,
						'text-optional': true,
					},
					paint: paint['roads-major-labels'],
				},
				{
					id: 'roads-minor-labels',
					type: 'symbol',
					source: BASEMAP_SOURCE_ID,
					'source-layer': 'roads',
					minzoom: 12.5,
					filter: MINOR_ROAD_FILTER,
					layout: {
						'symbol-placement': 'line',
						'text-field': ROAD_NAME_FIELD,
						'text-font': ['Noto Sans Regular'],
						'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 9, 15, 11],
						'symbol-spacing': 340,
						'text-rotation-alignment': 'map',
						'text-keep-upright': true,
						'text-allow-overlap': false,
						'text-ignore-placement': false,
						'text-optional': true,
					},
					paint: paint['roads-minor-labels'],
				},
			],
		};
	}

/**
 * Resolve the MapLibre style for the current snapshot.
 *
 * - `manifest.basemap === null` (or no `basemapFile` supplied) → the
 *   self-contained {@link minimalDarkStyle} (no external glyphs/tiles).
 * - otherwise → a {@link vectorStyleFromBasemap} built from the pointer.
 *
 * Pure and SSR-safe: no `window`, no maplibre-gl runtime import. Unit-testable
 * by asserting on the returned plain-JSON StyleSpecification.
 */
export function resolveBasemapStyle(
	manifest: Pick<Manifest, 'basemap'>,
	basemapFile?: BasemapFile | null,
	theme: BasemapTheme = 'dark',
): StyleSpecification {
	// Honesty branch: the contract says basemap=null means "no archive hosted".
	// Also guard the case where the manifest names a pointer but the caller
	// couldn't resolve the BasemapFile (passed null/undefined) — fall back to
	// the minimal style rather than emitting a broken vector source.
	if (manifest.basemap == null || basemapFile == null) {
		return minimalDarkStyle(theme);
	}
	return vectorStyleFromBasemap(basemapFile, theme);
}

/**
 * Build a 10°-spaced lon/lat graticule as an inline GeoJSON FeatureCollection.
 * Pure helper for {@link minimalDarkStyle}; kept module-private-ish but exported
 * for unit tests that assert the grid is well-formed.
 */
export function graticuleGeoJson(): GraticuleCollection {
	const features: GraticuleFeature[] = [];

	// Meridians (constant longitude, -180..180 every 10°).
	for (let lon = -180; lon <= 180; lon += 10) {
		const coordinates: Position[] = [];
		for (let lat = -80; lat <= 80; lat += 5) {
			coordinates.push([lon, lat]);
		}
		features.push({
			type: 'Feature',
			properties: { kind: 'meridian', lon },
			geometry: { type: 'LineString', coordinates },
		});
	}

	// Parallels (constant latitude, -80..80 every 10°).
	for (let lat = -80; lat <= 80; lat += 10) {
		const coordinates: Position[] = [];
		for (let lon = -180; lon <= 180; lon += 5) {
			coordinates.push([lon, lat]);
		}
		features.push({
			type: 'Feature',
			properties: { kind: 'parallel', lat },
			geometry: { type: 'LineString', coordinates },
		});
	}

	return { type: 'FeatureCollection', features };
}
