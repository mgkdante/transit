import { centerFromProviderBbox, type MapFitPadding } from '../../components/map/viewport';
import type { Manifest } from '$lib/v1/schemas';
import type { PublicProvider } from '$lib/v1/providers';

export function mapCameraFraming({
	manifest,
	provider,
}: {
	manifest: Pick<Manifest, 'bbox'>;
	provider?: Pick<PublicProvider, 'fit_bounds' | 'max_bounds'> | null;
}) {
	const bounds = provider?.fit_bounds ?? manifest.bbox;
	return {
		bounds,
		maxBounds: provider?.max_bounds ?? manifest.bbox,
		center: centerFromProviderBbox(bounds),
	};
}

const MAP_FIT_PADDING_PX = 40;
// Symmetric side padding preserves the accepted desktop framing at all heights.
const DESKTOP_SIDE_PAD_FRAC = 0.4;

/** Derive camera padding from the hydration-safe layout snapshot and whole-map width. */
export function deriveMapFitPadding(isDesktopLayout: boolean, mapWidthPx: number): MapFitPadding {
	if (!isDesktopLayout || mapWidthPx <= 0) return MAP_FIT_PADDING_PX;
	const side = Math.round(mapWidthPx * DESKTOP_SIDE_PAD_FRAC);
	return { top: 0, bottom: 0, left: side, right: side };
}
