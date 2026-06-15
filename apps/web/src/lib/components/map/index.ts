// Barrel for `$lib/components/map`. The MapLibre stage + the null-safe basemap
// style resolver.
//
// SSR NOTE: MapStage is browser-only — it dynamic-imports maplibre-gl/pmtiles
// inside onMount and renders nothing server-side. `basemap.ts` is pure and
// SSR-safe (no window, no runtime maplibre import), so importing the resolver
// or its types from this barrel will NOT pull WebGL into a server/SSR bundle.

export { default as MapStage } from './MapStage.svelte';

export {
	resolveBasemapStyle,
	minimalDarkStyle,
	vectorStyleFromBasemap,
	graticuleGeoJson,
	toPmtilesUrl,
	BASEMAP_SOURCE_ID,
} from './basemap';
