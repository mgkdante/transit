import type { MapOptions } from 'maplibre-gl';

export type MapFitPadding = NonNullable<NonNullable<MapOptions['fitBoundsOptions']>['padding']>;

export const MONTREAL_MAP_BOUNDS: [[number, number], [number, number]] = [
	[-74.1, 45.25],
	[-73.2, 45.75],
];
const MONTREAL_MAP_CENTER: [number, number] = [-73.5673, 45.5017];

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
	size?: { width: number; height: number },
	preserveView?: { center: { lng: number; lat: number }; zoom: number },
): MapViewportOptions {
	const bounds = boundsFromProviderBbox(providerBbox);
	// maxBounds may be LOOSER than the initial fit so the camera can show map
	// beyond the (island-focused) fit window — e.g. the west overflow revealed by
	// a left fit-padding — without MapLibre clamping it back. Falls back to the
	// fit bounds when not supplied.
	let maxBounds = maxBbox ? boundsFromProviderBbox(maxBbox) : bounds;
	let minZoom = 9;
	let offset: [number, number] = [0, 0];
	if (size && size.width > 0 && size.height > 0) {
		const pad =
			typeof fitPadding === 'number'
				? { top: fitPadding, bottom: fitPadding, left: fitPadding, right: fitPadding }
				: { top: 0, bottom: 0, left: 0, right: 0, ...fitPadding };
		const x = (lng: number) => (lng + 180) / 360;
		const y = (lat: number) => (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
		const lat = (worldY: number) =>
			(Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
		const west = x(bounds[0][0]),
			east = x(bounds[1][0]);
		const north = y(bounds[1][1]),
			south = y(bounds[0][1]);
		// Prefer the screen centre, moving only enough to clear an open panel.
		// If that zoom cannot clear both edges, retain the uncovered-area fit.
		const margin = Math.min(pad.left, pad.right);
		const screenScale = Math.min(
			Math.max(1, size.width - 2 * margin) / (east - west),
			Math.max(1, size.height - pad.top - pad.bottom) / (south - north),
			512 * 2 ** 16,
		);
		const projectedWidth = (east - west) * screenScale;
		if (projectedWidth <= size.width - pad.left - pad.right) {
			const target = Math.max(
				pad.left + projectedWidth / 2,
				Math.min(size.width / 2, size.width - pad.right - projectedWidth / 2),
			);
			offset = [target - size.width / 2, 0];
			pad.left = margin;
			pad.right = margin;
			fitPadding = pad;
		}
		const scale = Math.min(
			Math.max(1, size.width - pad.left - pad.right) / (east - west),
			Math.max(1, size.height - pad.top - pad.bottom) / (south - north),
			512 * 2 ** 16,
		);
		minZoom = Math.log2(scale / 512);
		const cx = (west + east) / 2 - ((pad.left - pad.right) / 2 + offset[0]) / scale;
		const cy = (north + south) / 2 - (pad.top - pad.bottom) / (2 * scale);
		// Include the full viewport at fit zoom so MapLibre's constrain cannot
		// zoom in or shift the fit. Retain the provider's wider panning area.
		maxBounds = [
			[
				Math.min(maxBounds[0][0], (cx - size.width / (2 * scale) - 1e-8) * 360 - 180),
				Math.min(maxBounds[0][1], lat(cy + size.height / (2 * scale) + 1e-8)),
			],
			[
				Math.max(maxBounds[1][0], (cx + size.width / (2 * scale) + 1e-8) * 360 - 180),
				Math.max(maxBounds[1][1], lat(cy - size.height / (2 * scale) - 1e-8)),
			],
		];
		if (preserveView) {
			const halfWidth = size.width / (2 * 512 * 2 ** preserveView.zoom);
			const halfHeight = size.height / (2 * 512 * 2 ** preserveView.zoom);
			maxBounds = [
				[
					Math.min(maxBounds[0][0], (x(preserveView.center.lng) - halfWidth - 1e-8) * 360 - 180),
					Math.min(maxBounds[0][1], lat(y(preserveView.center.lat) + halfHeight + 1e-8)),
				],
				[
					Math.max(maxBounds[1][0], (x(preserveView.center.lng) + halfWidth + 1e-8) * 360 - 180),
					Math.max(maxBounds[1][1], lat(y(preserveView.center.lat) - halfHeight - 1e-8)),
				],
			];
			minZoom = Math.min(minZoom, preserveView.zoom);
		}
	}
	return {
		bounds,
		maxBounds,
		fitBoundsOptions: {
			padding: fitPadding,
			...(offset[0] ? { offset } : {}),
		},
		minZoom,
		maxZoom: 16,
		renderWorldCopies: false,
		refreshExpiredTiles: false,
		maxTileCacheZoomLevels: 8,
		fadeDuration: 0,
	};
}
