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
	park: string;
	roadCasing: string;
	road: string;
	roadMajor: string;
	roadBridge: string;
	roadShieldInk: string;
	roadShieldHalo: string;
	ink: string;
	placeInk: string;
	parkInk: string;
	landmarkInk: string;
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
		/** Quiet green for parks and other orienting open space. */
		park: '#173327',
		/** Outer road stroke so streets read as streets, not loose hairlines. */
		roadCasing: '#242424',
		/** --border (dark) — minor road / casing strokes. */
		road: '#3a3a3a',
		/** --border-strong (dark) — major road / graticule ink. */
		roadMajor: '#4a4a4a',
		/** Slightly lifted bridge stroke for overpasses. */
		roadBridge: '#5F574C',
		/** Neutral road-shield ink + halo; never use bus orange for highway numbers. */
		roadShieldInk: '#141414',
		roadShieldHalo: '#D0D0D0',
		/** Label ink: brighter than road strokes, still below transit markers. */
		ink: '#A8A8A8',
		placeInk: '#D0D0D0',
		parkInk: '#8CBF9B',
		landmarkInk: '#C6B37E',
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
		/** Quiet green for parks and other orienting open space. */
		park: '#DCE8CC',
		/** Outer road stroke so streets read as streets, not loose hairlines. */
		roadCasing: '#E5DAC7',
		/** --border (light) — minor road / casing strokes. */
		road: '#C9BCA1',
		/** --muted-foreground (light) — major road / graticule ink. */
		roadMajor: '#6E6557',
		/** Slightly lifted bridge stroke for overpasses. */
		roadBridge: '#8D806E',
		/** Neutral road-shield ink + halo; never use bus orange for highway numbers. */
		roadShieldInk: '#F7F2E9',
		roadShieldHalo: '#4F4A42',
		/** Label ink: readable on warm paper without becoming primary data. */
		ink: '#5F574C',
		placeInk: '#4F4A42',
		parkInk: '#4F744F',
		landmarkInk: '#7A6642',
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
		'landuse-green': { 'fill-color': palette.park, 'fill-opacity': 0.48 },
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
		'roads-casing': {
			'line-color': palette.roadCasing,
			'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.9, 11, 1.5, 14, 2.1],
			'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.28, 10, 0.52, 13, 0.68],
		},
		'roads-tunnel': {
			'line-color': palette.road,
			'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 13, 1.2, 15, 1.7],
			'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.34, 13, 0.56, 15, 0.7],
			'line-dasharray': [1.6, 1.2],
		},
		'roads-minor': {
			'line-color': palette.road,
			'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.35, 10, 0.65, 12, 0.9, 14, 1.05],
			'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.36, 10, 0.64, 12, 0.78, 13, 0.82],
		},
		'roads-link': {
			'line-color': palette.road,
			'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 13, 0.85, 15, 1.2],
			'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 13, 0.72],
		},
		'roads-major': {
			'line-color': palette.roadMajor,
			'line-width': 1.25,
		},
		'roads-bridge': {
			'line-color': palette.roadBridge,
			'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 13, 1.8, 15, 2.35],
			'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 0.82],
		},
		'places-city-labels': {
			'text-color': palette.placeInk,
			'text-halo-color': palette.labelHalo,
			'text-halo-width': 1.8,
		},
		'places-neighbourhood-labels': {
			'text-color': palette.placeInk,
			'text-halo-color': palette.labelHalo,
			'text-halo-width': 1.55,
		},
		'places-locality-labels': {
			'text-color': palette.placeInk,
			'text-halo-color': palette.labelHalo,
			'text-halo-width': 1.35,
		},
		'poi-park-icons': {
			'circle-color': palette.parkInk,
			'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 3.2],
			'circle-opacity': 0.78,
			'circle-stroke-color': palette.labelHalo,
			'circle-stroke-width': 1,
		},
		'poi-landmark-icons': {
			'circle-color': palette.landmarkInk,
			'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 15, 3],
			'circle-opacity': 0.82,
			'circle-stroke-color': palette.labelHalo,
			'circle-stroke-width': 1,
		},
		'poi-park-labels': {
			'text-color': palette.parkInk,
			'text-halo-color': palette.labelHalo,
			'text-halo-width': 1.3,
		},
		'poi-landmark-labels': {
			'text-color': palette.landmarkInk,
			'text-halo-color': palette.labelHalo,
			'text-halo-width': 1.25,
		},
		'road-shields': {
			'text-color': palette.roadShieldInk,
			'text-halo-color': palette.roadShieldHalo,
			'text-halo-width': 2.15,
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
const THANKFUL_ATTRIBUTION_SUFFIX =
	' <span class="transit-basemap-thanks" aria-label="thank you">thanks <span style="color:#C96F2D">♥</span></span>';
const ROAD_NAME_FIELD = [
	'coalesce',
	['get', 'name'],
	['get', 'name:fr'],
	['get', 'name:en'],
	['get', 'ref'],
] as ExpressionSpecification;
const ROAD_SORT_KEY = ['coalesce', ['get', 'sort_rank'], 0] as ExpressionSpecification;
const PLACE_SORT_KEY = [
	'coalesce',
	['get', 'population_rank'],
	['get', 'sort_rank'],
	0,
] as ExpressionSpecification;
const POI_SORT_KEY = [
	'coalesce',
	['get', 'min_zoom'],
	['get', 'sort_rank'],
	0,
] as ExpressionSpecification;
const ORIENTATION_NAME_FIELD = [
	'coalesce',
	['get', 'name:fr'],
	['get', 'name:en'],
	['get', 'name'],
	['get', 'ref'],
] as ExpressionSpecification;
const ROAD_SHIELD_FIELD = [
	'coalesce',
	['get', 'shield_text'],
	['get', 'ref'],
] as ExpressionSpecification;
const MAJOR_ROAD_FILTER = [
	'match',
	['get', 'kind'],
	['highway', 'major_road', 'medium_road'],
	true,
	false,
] as FilterSpecification;
const ROAD_TUNNEL_FILTER = ['==', ['get', 'is_tunnel'], true] as FilterSpecification;
const ROAD_LINK_FILTER = ['==', ['get', 'is_link'], true] as FilterSpecification;
const ROAD_BRIDGE_FILTER = ['==', ['get', 'is_bridge'], true] as FilterSpecification;
const ROAD_SHIELD_FILTER = ['any', ['has', 'shield_text'], ['has', 'ref']] as FilterSpecification;
const GREEN_LANDUSE_FILTER = [
	'match',
	['get', 'kind'],
	['park', 'garden', 'recreation_ground', 'nature_reserve', 'forest', 'wood', 'grass', 'cemetery'],
	true,
	false,
] as FilterSpecification;
const CITY_PLACE_FILTER = [
	'match',
	['get', 'kind_detail'],
	['city', 'town', 'village'],
	true,
	false,
] as FilterSpecification;
const NEIGHBOURHOOD_FILTER = [
	'any',
	['match', ['get', 'kind'], ['macrohood', 'neighbourhood'], true, false],
	['match', ['get', 'kind_detail'], ['neighbourhood', 'quarter'], true, false],
] as FilterSpecification;
const LOCALITY_PLACE_FILTER = [
	'any',
	['match', ['get', 'kind'], ['locality'], true, false],
	[
		'match',
		['get', 'kind_detail'],
		['locality', 'hamlet', 'farm', 'isolated_dwelling'],
		true,
		false,
	],
] as FilterSpecification;
const PARK_POI_KINDS = ['park', 'garden', 'recreation_ground', 'nature_reserve', 'forest', 'wood'];
const LANDMARK_POI_KINDS = [
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
];
const PARK_POI_FILTER = [
	'any',
	['match', ['get', 'kind'], PARK_POI_KINDS, true, false],
	['match', ['get', 'kind_detail'], PARK_POI_KINDS, true, false],
] as FilterSpecification;
const LANDMARK_POI_FILTER = [
	'any',
	['match', ['get', 'kind'], LANDMARK_POI_KINDS, true, false],
	['match', ['get', 'kind_detail'], LANDMARK_POI_KINDS, true, false],
] as FilterSpecification;

function thankfulAttribution(attribution: string): string {
	return attribution.includes(THANKFUL_ATTRIBUTION_SUFFIX.trim())
		? attribution
		: `${attribution}${THANKFUL_ATTRIBUTION_SUFFIX}`;
}
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
		attribution: thankfulAttribution(file.attribution),
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
				id: 'landuse-green',
				type: 'fill',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'landuse',
				filter: GREEN_LANDUSE_FILTER,
				paint: paint['landuse-green'],
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
				id: 'roads-casing',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				minzoom: 8,
				paint: paint['roads-casing'],
			},
			{
				id: 'roads-tunnel',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				minzoom: 10,
				filter: ROAD_TUNNEL_FILTER,
				paint: paint['roads-tunnel'],
			},
			{
				id: 'roads-minor',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				minzoom: 8,
				paint: paint['roads-minor'],
			},
			{
				id: 'roads-link',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				minzoom: 10,
				filter: ROAD_LINK_FILTER,
				paint: paint['roads-link'],
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
				id: 'roads-bridge',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				minzoom: 10,
				filter: ROAD_BRIDGE_FILTER,
				paint: paint['roads-bridge'],
			},
			{
				id: 'places-city-labels',
				type: 'symbol',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'places',
				minzoom: 6,
				filter: CITY_PLACE_FILTER,
				layout: {
					'symbol-placement': 'point',
					'text-field': ORIENTATION_NAME_FIELD,
					'text-font': ['Noto Sans Medium'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 10, 15, 14, 18],
					'symbol-sort-key': PLACE_SORT_KEY,
					'text-padding': 14,
					'text-max-width': 12,
					'text-allow-overlap': false,
					'text-ignore-placement': false,
					'text-optional': true,
				},
				paint: paint['places-city-labels'],
			},
			{
				id: 'places-neighbourhood-labels',
				type: 'symbol',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'places',
				minzoom: 9,
				filter: NEIGHBOURHOOD_FILTER,
				layout: {
					'symbol-placement': 'point',
					'text-field': ORIENTATION_NAME_FIELD,
					'text-font': ['Noto Sans Medium'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 12, 15, 14],
					'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
					'text-radial-offset': 0.45,
					'text-justify': 'auto',
					'symbol-sort-key': PLACE_SORT_KEY,
					'text-padding': 8,
					'text-max-width': 11,
					'text-allow-overlap': false,
					'text-ignore-placement': false,
					'text-optional': true,
				},
				paint: paint['places-neighbourhood-labels'],
			},
			{
				id: 'places-locality-labels',
				type: 'symbol',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'places',
				minzoom: 11,
				filter: LOCALITY_PLACE_FILTER,
				layout: {
					'symbol-placement': 'point',
					'text-field': ORIENTATION_NAME_FIELD,
					'text-font': ['Noto Sans Regular'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 13, 10.5, 15, 12],
					'symbol-sort-key': PLACE_SORT_KEY,
					'text-padding': 8,
					'text-max-width': 10,
					'text-allow-overlap': false,
					'text-ignore-placement': false,
					'text-optional': true,
				},
				paint: paint['places-locality-labels'],
			},
			{
				id: 'poi-park-icons',
				type: 'circle',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'pois',
				minzoom: 11,
				filter: PARK_POI_FILTER,
				paint: paint['poi-park-icons'],
			},
			{
				id: 'poi-landmark-icons',
				type: 'circle',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'pois',
				minzoom: 12,
				filter: LANDMARK_POI_FILTER,
				paint: paint['poi-landmark-icons'],
			},
			{
				id: 'poi-park-labels',
				type: 'symbol',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'pois',
				minzoom: 11,
				filter: PARK_POI_FILTER,
				layout: {
					'symbol-placement': 'point',
					'text-field': ORIENTATION_NAME_FIELD,
					'text-font': ['Noto Sans Medium'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.5, 14, 11.5],
					'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
					'text-radial-offset': 0.45,
					'text-justify': 'auto',
					'symbol-sort-key': POI_SORT_KEY,
					'text-padding': 8,
					'text-max-width': 10,
					'text-allow-overlap': false,
					'text-ignore-placement': false,
					'text-optional': true,
				},
				paint: paint['poi-park-labels'],
			},
			{
				id: 'poi-landmark-labels',
				type: 'symbol',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'pois',
				minzoom: 12,
				filter: LANDMARK_POI_FILTER,
				layout: {
					'symbol-placement': 'point',
					'text-field': ORIENTATION_NAME_FIELD,
					'text-font': ['Noto Sans Regular'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 15, 11.5],
					'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
					'text-radial-offset': 0.45,
					'text-justify': 'auto',
					'symbol-sort-key': POI_SORT_KEY,
					'text-padding': 8,
					'text-max-width': 10,
					'text-allow-overlap': false,
					'text-ignore-placement': false,
					'text-optional': true,
				},
				paint: paint['poi-landmark-labels'],
			},
			{
				id: 'road-shields',
				type: 'symbol',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				minzoom: 9,
				filter: ROAD_SHIELD_FILTER,
				layout: {
					'symbol-placement': 'line',
					'text-field': ROAD_SHIELD_FIELD,
					'text-font': ['Noto Sans Medium'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 9, 8.5, 12, 9.5, 15, 10.5],
					'symbol-spacing': 520,
					'symbol-sort-key': ROAD_SORT_KEY,
					'text-rotation-alignment': 'map',
					'text-pitch-alignment': 'map',
					'text-padding': 7,
					'text-keep-upright': true,
					'text-allow-overlap': false,
					'text-ignore-placement': false,
					'text-optional': true,
				},
				paint: paint['road-shields'],
			},
			{
				id: 'roads-major-labels',
				type: 'symbol',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				minzoom: 9,
				filter: MAJOR_ROAD_FILTER,
				layout: {
					'symbol-placement': 'line',
					'text-field': ROAD_NAME_FIELD,
					'text-font': ['Noto Sans Regular'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 11.5, 15, 13],
					'symbol-spacing': 360,
					'symbol-sort-key': ROAD_SORT_KEY,
					'text-rotation-alignment': 'map',
					'text-pitch-alignment': 'map',
					'text-max-angle': 30,
					'text-padding': 4,
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
				minzoom: 11,
				filter: MINOR_ROAD_FILTER,
				layout: {
					'symbol-placement': 'line',
					'text-field': ROAD_NAME_FIELD,
					'text-font': ['Noto Sans Regular'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.25, 13, 10.5, 15, 12],
					'symbol-spacing': 300,
					'symbol-sort-key': ROAD_SORT_KEY,
					'text-rotation-alignment': 'map',
					'text-pitch-alignment': 'map',
					'text-max-angle': 30,
					'text-padding': 3,
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
