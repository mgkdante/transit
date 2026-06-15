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
//      archive, themed with the dataviz dark palette. min_zoom/max_zoom on the
//      source come from the BasemapFile; the layer paint uses raw token-derived
//      hexes (this file can't read CSS vars — see DATAVIZ_DARK below).
//
// DOCTRINE: a basemap is geographic CHROME, not a data mark, so it stays off
// the dataviz status/occupancy/severity scales AND off interactive --primary.
// It uses the neutral dark *surface* palette (background/land/water/roads),
// leaving the dataviz scale free for the overlay marks drawn on top.

import type { StyleSpecification } from 'maplibre-gl';
import type { BasemapFile, Manifest } from '$lib/v1/schemas';

/**
 * Neutral dark surface palette for the basemap chrome. These mirror the dark
 * theme's surface/border tokens in src/lib/styles/tokens.css. We inline the
 * resolved hexes here because a MapLibre `StyleSpecification` is plain JSON
 * consumed by a WebGL renderer that cannot read CSS custom properties.
 *
 * NOTE: these are surface/neutral tokens ONLY — never the dataviz data scale
 * and never interactive --primary. Keep in sync with the dark theme block.
 */
const DATAVIZ_DARK = {
	/** --background (dark) — the void behind everything. */
	background: '#141414',
	/** --manifesto (dark) — deep land fill, a touch darker than the void. */
	land: '#0f0d0a',
	/** --muted (dark) — water bodies. */
	water: '#1e1e1e',
	/** --border (dark) — minor road / casing strokes. */
	road: '#3a3a3a',
	/** --border-strong (dark) — major road / boundary strokes + graticule. */
	roadMajor: '#4a4a4a',
	/** --muted-foreground (dark) — place/label ink (when glyphs are available). */
	ink: '#949494',
} as const;

const PMTILES_SCHEME = 'pmtiles://';

/** The vector source id every generated vector style registers under. */
export const BASEMAP_SOURCE_ID = 'basemap';

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
export function minimalDarkStyle(): StyleSpecification {
	return {
		version: 8,
		name: 'transit-minimal-dark',
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
				paint: { 'background-color': DATAVIZ_DARK.background },
			},
			{
				id: 'graticule',
				type: 'line',
				source: 'graticule',
				paint: {
					'line-color': DATAVIZ_DARK.roadMajor,
					'line-width': 0.5,
					'line-opacity': 0.4,
				},
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
 * (`highway`/`major_road`/`medium_road` = major, the rest minor). No glyphs or
 * sprite are referenced, so the style renders offline with no font endpoint.
 *
 * CONFIRM against `pmtiles show montreal.pmtiles` at extract time (task 1.2):
 * if the build's layer/property names differ, reconcile here — a wrong
 * `source-layer` renders silently empty, not an error.
 */
export function vectorStyleFromBasemap(file: BasemapFile): StyleSpecification {
	const sourceUrl = toPmtilesUrl(file.url);

	const vectorSource: StyleSpecification['sources'][string] = {
		type: 'vector',
		url: sourceUrl,
		attribution: file.attribution,
		...(file.min_zoom != null ? { minzoom: file.min_zoom } : {}),
		...(file.max_zoom != null ? { maxzoom: file.max_zoom } : {}),
	};

	return {
		version: 8,
		name: 'transit-basemap-dark',
		sources: {
			[BASEMAP_SOURCE_ID]: vectorSource,
		},
		layers: [
			{
				id: 'background',
				type: 'background',
				paint: { 'background-color': DATAVIZ_DARK.background },
			},
			{
				id: 'earth',
				type: 'fill',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'earth',
				paint: { 'fill-color': DATAVIZ_DARK.land },
			},
			{
				id: 'landuse',
				type: 'fill',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'landuse',
				paint: { 'fill-color': DATAVIZ_DARK.land, 'fill-opacity': 0.5 },
			},
			{
				id: 'water',
				type: 'fill',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'water',
				paint: { 'fill-color': DATAVIZ_DARK.water },
			},
			{
				id: 'roads-minor',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				minzoom: 11,
				paint: {
					'line-color': DATAVIZ_DARK.road,
					'line-width': 0.75,
				},
			},
			{
				id: 'roads-major',
				type: 'line',
				source: BASEMAP_SOURCE_ID,
				'source-layer': 'roads',
				filter: ['match', ['get', 'kind'], ['highway', 'major_road', 'medium_road'], true, false],
				paint: {
					'line-color': DATAVIZ_DARK.roadMajor,
					'line-width': 1.25,
				},
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
): StyleSpecification {
	// Honesty branch: the contract says basemap=null means "no archive hosted".
	// Also guard the case where the manifest names a pointer but the caller
	// couldn't resolve the BasemapFile (passed null/undefined) — fall back to
	// the minimal style rather than emitting a broken vector source.
	if (manifest.basemap == null || basemapFile == null) {
		return minimalDarkStyle();
	}
	return vectorStyleFromBasemap(basemapFile);
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
