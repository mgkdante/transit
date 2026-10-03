import { centerFromProviderBbox, type MapFitPadding } from '../../components/map/viewport';
import type { V1Context } from '$lib/v1/boot';

export function mapCameraFraming({ manifest, provider }: V1Context) {
	const bounds = provider?.fit_bounds ?? manifest.bbox;
	return {
		bounds,
		maxBounds: provider?.max_bounds ?? manifest.bbox,
		center: centerFromProviderBbox(bounds),
	};
}

// The existing poster renderer still uses these accepted STM camera values.
export const ISLAND_FIT_BOUNDS = [-73.9757, 45.4022, -73.4764, 45.7028] as const;
export const mapInitialCenter = centerFromProviderBbox(ISLAND_FIT_BOUNDS);

// A shared longitude midpoint preserves framing when maxBounds constrains zoom.
export const MAP_MAX_BOUNDS = [-74.28605, 45.3, -73.16605, 45.82] as const;

const MAP_FIT_PADDING_PX = 40;
// Symmetric side padding preserves the accepted desktop framing at all heights.
const DESKTOP_SIDE_PAD_FRAC = 0.4;

/** Derive camera padding from the hydration-safe layout snapshot and whole-map width. */
export function deriveMapFitPadding(isDesktopLayout: boolean, mapWidthPx: number): MapFitPadding {
	if (!isDesktopLayout || mapWidthPx <= 0) return MAP_FIT_PADDING_PX;
	const side = Math.round(mapWidthPx * DESKTOP_SIDE_PAD_FRAC);
	return { top: 0, bottom: 0, left: side, right: side };
}
