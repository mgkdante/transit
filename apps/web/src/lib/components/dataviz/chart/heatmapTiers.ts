// heatmapTiers.ts — the classed-tier model for the heatmap mark (B10, S7 P4).
//
// A cell value on the spec's absolute [lo,hi] domain bins onto N DISCRETE tiers using
// FIXED, evenly-spaced thresholds (never a per-view quantile, never `/max`), so the same
// value reads the SAME tier on every route and every refresh. The tier colour is a
// perceptually-uniform, CVD-safe sequential ramp (the `--dataviz-heatmap-tier-*` tokens
// in tokens.css, luminance-inverted per theme like the occupancy ramp). The tier index
// ALSO drives the plain-language label + the worst-tier glyph, so the meaning never rests
// on hue alone (Wong/Tol CVD guidance + WCAG 1.4.1 "colour is not the only visual means").

/** Number of discrete tiers (calmest 0 → worst N-1). Operator-locked at a classed 4. */
export const HEATMAP_TIER_COUNT = 4;

/** Worst tier index — carries the glyph + the strongest-contrast colour. */
export const HEATMAP_WORST_TIER = HEATMAP_TIER_COUNT - 1;

/**
 * Bin a value onto a tier index in [0, HEATMAP_TIER_COUNT-1], or null when there is no
 * value (the honest no-data swatch). `domain` is the spec's absolute [lo,hi]; the value is
 * positioned within it and split on evenly-spaced FIXED thresholds. Out-of-range clamps to
 * the end tiers. NEVER reads an in-view max / quantile — the bins are stable across views.
 */
export function heatmapTier(
	value: number | null,
	domain: readonly [number, number],
): number | null {
	if (value == null || Number.isNaN(value)) return null;
	const [lo, hi] = domain;
	const span = hi - lo;
	const frac = span > 0 ? (value - lo) / span : 0;
	const clamped = Math.min(1, Math.max(0, frac));
	// Floor into N equal bins; the exact top edge (clamped === 1) lands in the last tier.
	return Math.min(HEATMAP_TIER_COUNT - 1, Math.floor(clamped * HEATMAP_TIER_COUNT));
}

/**
 * CSS class for a tier index (or the no-data swatch when null). The mark, the legend, and
 * the SR table all resolve colour through this single map so they can never disagree.
 */
export function heatmapTierClass(tier: number | null): string {
	return tier == null ? 'dv-hm-nodata' : `dv-hm-tier-${tier}`;
}
