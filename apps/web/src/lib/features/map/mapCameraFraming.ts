import { centerFromProviderBbox, type MapFitPadding } from '../../components/map/viewport';
import type { Manifest } from '#lib/v1/schemas/index.ts';
import type { PublicProvider } from '#lib/v1/providers.ts';

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

/** Hydration/poster fallback; the live camera uses measured chrome insets. */
export function deriveMapFitPadding(isDesktopLayout: boolean, _mapWidthPx: number): MapFitPadding {
	return isDesktopLayout
		? { top: 160, bottom: 72, left: 280, right: 16 }
		: { top: 160, bottom: 112, left: 16, right: 16 };
}
