import type { MapOptions } from 'maplibre-gl';

export const MONTREAL_MAP_BOUNDS: [[number, number], [number, number]] = [
	[-74.1, 45.25],
	[-73.2, 45.75],
];

export type MapViewportOptions = Pick<
	MapOptions,
	| 'maxBounds'
	| 'minZoom'
	| 'maxZoom'
	| 'renderWorldCopies'
	| 'refreshExpiredTiles'
	| 'maxTileCacheZoomLevels'
	| 'fadeDuration'
>;

function boundsFromProviderBbox(
	bbox?: readonly number[] | null,
): [[number, number], [number, number]] {
	if (bbox?.length !== 4 || !bbox.every(Number.isFinite)) return MONTREAL_MAP_BOUNDS;
	const [minLon, minLat, maxLon, maxLat] = bbox;
	if (minLon >= maxLon || minLat >= maxLat) return MONTREAL_MAP_BOUNDS;
	return [
		[minLon, minLat],
		[maxLon, maxLat],
	];
}

export function mapViewportOptions(providerBbox?: readonly number[] | null): MapViewportOptions {
	return {
		maxBounds: boundsFromProviderBbox(providerBbox),
		minZoom: 9,
		maxZoom: 16,
		renderWorldCopies: false,
		refreshExpiredTiles: false,
		maxTileCacheZoomLevels: 8,
		fadeDuration: 0,
	};
}
