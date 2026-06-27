import { describe, it, expect } from 'vitest';
import {
	heatmapTier,
	heatmapTierClass,
	HEATMAP_TIER_COUNT,
	HEATMAP_WORST_TIER,
} from './heatmapTiers';

const D: readonly [number, number] = [0, 1];

describe('heatmapTier', () => {
	it('bins [0,1] onto four fixed equal-width tiers', () => {
		expect(heatmapTier(0, D)).toBe(0);
		expect(heatmapTier(0.2, D)).toBe(0);
		expect(heatmapTier(0.25, D)).toBe(1);
		expect(heatmapTier(0.49, D)).toBe(1);
		expect(heatmapTier(0.5, D)).toBe(2);
		expect(heatmapTier(0.74, D)).toBe(2);
		expect(heatmapTier(0.75, D)).toBe(3);
		expect(heatmapTier(1, D)).toBe(HEATMAP_WORST_TIER);
	});

	it('returns null for a no-data cell (never a fabricated tier 0)', () => {
		expect(heatmapTier(null, D)).toBeNull();
		expect(heatmapTier(Number.NaN, D)).toBeNull();
	});

	it('clamps out-of-range values to the end tiers', () => {
		expect(heatmapTier(-5, D)).toBe(0);
		expect(heatmapTier(99, D)).toBe(HEATMAP_WORST_TIER);
	});

	it('positions the value within an arbitrary absolute domain (not /max)', () => {
		// On [0,100] the same fractions land in the same tiers — a fixed, stable binning.
		expect(heatmapTier(10, [0, 100])).toBe(0);
		expect(heatmapTier(60, [0, 100])).toBe(2);
		expect(heatmapTier(90, [0, 100])).toBe(3);
	});

	it('exposes exactly four tiers', () => {
		expect(HEATMAP_TIER_COUNT).toBe(4);
		expect(HEATMAP_WORST_TIER).toBe(3);
	});
});

describe('heatmapTierClass', () => {
	it('maps a tier index to its css class, null to the no-data swatch', () => {
		expect(heatmapTierClass(0)).toBe('dv-hm-tier-0');
		expect(heatmapTierClass(3)).toBe('dv-hm-tier-3');
		expect(heatmapTierClass(null)).toBe('dv-hm-nodata');
	});
});
