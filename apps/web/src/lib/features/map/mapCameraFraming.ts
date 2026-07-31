import { centerFromProviderBbox, type MapFitPadding } from '$lib/components/map';

// Initial framing fits the Île de Montréal extremes rather than the wider
// basemap square, keeping off-island east geometry from consuming the view.
export const ISLAND_FIT_BOUNDS = [-73.9757, 45.4022, -73.4764, 45.7028] as const;
export const mapInitialCenter = centerFromProviderBbox(ISLAND_FIT_BOUNDS);

// The pan limit stays looser than the fit target so both overlay-side bands can
// render without exposing the full south-shore sprawl.
export const MAP_MAX_BOUNDS = [-74.32, 45.3, -73.2, 45.82] as const;

const MAP_FIT_PADDING_PX = 40;
const DESKTOP_LEFT_PAD_FRAC = 0.37;
const DESKTOP_RIGHT_PAD_FRAC = 0.43;
const DESKTOP_VERT_PAD_PX = 56;

/** Derive camera padding from the hydration-safe layout snapshot and whole-map width. */
export function deriveMapFitPadding(isDesktopLayout: boolean, mapWidthPx: number): MapFitPadding {
	if (!isDesktopLayout || mapWidthPx <= 0) return MAP_FIT_PADDING_PX;
	return {
		top: DESKTOP_VERT_PAD_PX,
		bottom: DESKTOP_VERT_PAD_PX,
		left: Math.round(mapWidthPx * DESKTOP_LEFT_PAD_FRAC),
		right: Math.round(mapWidthPx * DESKTOP_RIGHT_PAD_FRAC),
	};
}
