import type { MapOptions } from 'maplibre-gl';

export type MapFitPadding = NonNullable<NonNullable<MapOptions['fitBoundsOptions']>['padding']>;

export const MONTREAL_MAP_BOUNDS: [[number, number], [number, number]] = [
	[-74.1, 45.25],
	[-73.2, 45.75],
];
export const MONTREAL_MAP_CENTER: [number, number] = [-73.5673, 45.5017];

export type MapViewportOptions = {
	bounds: [[number, number], [number, number]];
	maxBounds: [[number, number], [number, number]];
	fitBoundsOptions: NonNullable<MapOptions['fitBoundsOptions']>;
} & Pick<
	MapOptions,
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

export function centerFromProviderBbox(bbox?: readonly number[] | null): [number, number] {
	if (bbox?.length !== 4 || !bbox.every(Number.isFinite)) return MONTREAL_MAP_CENTER;
	const [minLon, minLat, maxLon, maxLat] = bbox;
	if (minLon >= maxLon || minLat >= maxLat) return MONTREAL_MAP_CENTER;
	return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

export function mapViewportOptions(
	providerBbox?: readonly number[] | null,
	fitPadding: MapFitPadding = 40,
	maxBbox?: readonly number[] | null,
): MapViewportOptions {
	const bounds = boundsFromProviderBbox(providerBbox);
	// maxBounds may be LOOSER than the initial fit so the camera can show map
	// beyond the (island-focused) fit window — e.g. the west overflow revealed by
	// a left fit-padding — without MapLibre clamping it back. Falls back to the
	// fit bounds when not supplied.
	const maxBounds = maxBbox ? boundsFromProviderBbox(maxBbox) : bounds;
	return {
		bounds,
		maxBounds,
		fitBoundsOptions: {
			padding: fitPadding,
		},
		minZoom: 9,
		maxZoom: 16,
		renderWorldCopies: false,
		refreshExpiredTiles: false,
		maxTileCacheZoomLevels: 8,
		fadeDuration: 0,
	};
}
