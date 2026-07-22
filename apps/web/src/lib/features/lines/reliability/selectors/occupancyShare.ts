// occupancyShare.ts — build a StackedShareSpec for an occupancy mix (A7/A9/A10, S7 P5).
// A 100%-stacked part-to-whole strip: each band's segment length IS its share of the
// observed mix. EXEMPT from the absolute-magnitude domain law (self-normalising to 100%,
// sequential occupancy luminance + a glyph per band). Honest absence: a null / all-zero mix
// returns null (the caller renders the AbsentValue chip), never a fabricated even split.
// Pure (data project): labels arrive resolved via opts.

import type { Locale } from '$lib/i18n';
import type { StackedShareSpec, ShareSegment } from '$lib/components/dataviz/chart/ChartSpec';
import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas/types';

export interface OccupancyShareOpts {
	/** Accessible name describing the mix (e.g. "Route 51 crowding mix"). */
	readonly title: string;
	/** Resolve a band's human label (legend + a11y). */
	readonly label: (code: OccupancyCode) => string;
}

/** A per-band occupancy mix as raw shares (fractions or counts); null = no telemetry. */
export type OccupancyMix = Partial<Record<OccupancyCode, number | null>> | null;

/**
 * Build the 100%-stacked occupancy share strip, or null when there's no telemetry (an
 * all-null / all-zero mix). Zero-share bands are dropped (no slivers); the remaining bands
 * carry their share of the whole in [0,100], the occupancy code (colour), and the fill glyph.
 */
export function selectOccupancyShare(
	mix: OccupancyMix,
	locale: Locale,
	opts: OccupancyShareOpts,
): StackedShareSpec | null {
	if (!mix) return null;
	const total = OCCUPANCY_CODES.reduce((sum, code) => {
		const v = mix[code];
		return sum + (v != null && v > 0 ? v : 0);
	}, 0);
	if (total <= 0) return null;

	const segments: ShareSegment[] = [];
	for (const code of OCCUPANCY_CODES) {
		const v = mix[code];
		if (v == null || v <= 0) continue;
		segments.push({
			key: code,
			label: opts.label(code),
			share: (v / total) * 100,
			occupancy: code,
		});
	}
	return { kind: 'stacked-share', title: opts.title, locale, scale: 'occupancy', segments };
}
