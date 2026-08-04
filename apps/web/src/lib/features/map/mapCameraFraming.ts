import { centerFromProviderBbox, type MapFitPadding } from '$lib/components/map';

// Initial framing fits the Île de Montréal extremes rather than the wider
// basemap square, keeping off-island east geometry from consuming the view.
export const ISLAND_FIT_BOUNDS = [-73.9757, 45.4022, -73.4764, 45.7028] as const;
export const mapInitialCenter = centerFromProviderBbox(ISLAND_FIT_BOUNDS);

// The pan limit stays looser than the fit target so both overlay-side bands can
// render without exposing the full south-shore sprawl, and its LONGITUDE MIDPOINT
// IS THE ISLAND'S: on WIDE/SHORT desktop the fit lands wider than this window, so
// MapLibre's constrain parks the camera on the midpoint whatever the padding asks
// for — which is why re-centring the midpoint, not shrinking the padding, is what
// fixes that regime. On TALL desktop the camera escapes the constrain entirely and
// the symmetric side inset below is what centres it instead.
export const MAP_MAX_BOUNDS = [-74.28605, 45.3, -73.16605, 45.82] as const;

const MAP_FIT_PADDING_PX = 40;
// BOTH the side TOTAL and its SYMMETRY are load-bearing; only the old vertical inset
// was inert. On wide/short desktop the fit lands wider than the pan window, so the
// constrain owns the camera and the left/right split cannot reach it. On TALL desktop
// the vertical fit binds first, the settled zoom rises above the constrain floor and
// the camera is free horizontally — there the split reaches the camera in full, and
// this constant being ONE symmetric value is the only thing centring the island
// (the old 0.37/0.43 biased it up to 143.7px LEFT). The total is what sets the zoom:
// below ~0.3 it stops saturating and the settled zoom climbs off the floor.
const DESKTOP_SIDE_PAD_FRAC = 0.4;

/** Derive camera padding from the hydration-safe layout snapshot and whole-map width. */
export function deriveMapFitPadding(isDesktopLayout: boolean, mapWidthPx: number): MapFitPadding {
	if (!isDesktopLayout || mapWidthPx <= 0) return MAP_FIT_PADDING_PX;
	const side = Math.round(mapWidthPx * DESKTOP_SIDE_PAD_FRAC);
	return { top: 0, bottom: 0, left: side, right: side };
}
