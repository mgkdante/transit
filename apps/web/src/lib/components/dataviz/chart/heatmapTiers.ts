export const HEATMAP_TIER_COUNT = 4;

export const HEATMAP_WORST_TIER = HEATMAP_TIER_COUNT - 1;

export function heatmapTier(
	value: number | null,
	domain: readonly [number, number],
): number | null {
	if (value == null || Number.isNaN(value)) return null;
	const [lo, hi] = domain;
	const span = hi - lo;
	const frac = span > 0 ? (value - lo) / span : 0;
	const clamped = Math.min(1, Math.max(0, frac));
	return Math.min(HEATMAP_TIER_COUNT - 1, Math.floor(clamped * HEATMAP_TIER_COUNT));
}

export function heatmapTierClass(tier: number | null): string {
	return tier == null ? 'dv-hm-nodata' : `dv-hm-tier-${tier}`;
}
