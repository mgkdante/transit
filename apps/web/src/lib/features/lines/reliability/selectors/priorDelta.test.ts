import { describe, it, expect } from 'vitest';
import { proportionPriorDelta, meanPriorDelta } from './priorDelta';
import { MIN_N_RATE, MIN_POINTS_FOR_LINE } from '$lib/v1/stats';

describe('proportionPriorDelta — honest absence', () => {
	it('no prior percentage → delta null, hasPrior false, not significant', () => {
		const r = proportionPriorDelta(89, 2137, null, null);
		expect(r).toEqual({ delta: null, hasPrior: false, significant: false });
	});
	it('no current percentage → absent (can compare nothing)', () => {
		expect(proportionPriorDelta(null, 2137, 84, 2183).hasPrior).toBe(false);
	});
});

describe('proportionPriorDelta — significance gate (two-proportion z-test)', () => {
	it('a real move at large n is significant (route 10 day am_peak: 89 vs 84)', () => {
		const r = proportionPriorDelta(89, 2137, 84, 2183, { onTime: 1902 });
		expect(r.delta).toBe(5);
		expect(r.hasPrior).toBe(true);
		expect(r.significant).toBe(true);
	});
	it('a 1-pt move IS significant at n≈80k (big samples resolve small differences)', () => {
		const r = proportionPriorDelta(86, 79256, 85, 80832, { onTime: 68160 });
		expect(r.delta).toBe(1);
		expect(r.significant).toBe(true);
	});
	it('a 5-pt move is NOT significant at tiny n (the swing is within noise)', () => {
		const r = proportionPriorDelta(90, 40, 85, 40);
		expect(r.delta).toBe(5);
		expect(r.hasPrior).toBe(true);
		expect(r.significant).toBe(false);
	});
	it('both denominators must clear MIN_N_RATE — a big prior cannot rescue a tiny current', () => {
		expect(proportionPriorDelta(90, MIN_N_RATE - 1, 70, 5000).significant).toBe(false);
		expect(proportionPriorDelta(90, 5000, 70, MIN_N_RATE - 1).significant).toBe(false);
	});
	it('a zero delta is never significant (same rate ⇒ z = 0)', () => {
		const r = proportionPriorDelta(86, 50000, 86, 50000);
		expect(r.delta).toBe(0);
		expect(r.significant).toBe(false);
	});
	it('missing denominators → keep the delta but never call it significant', () => {
		const r = proportionPriorDelta(89, null, 84, null);
		expect(r).toEqual({ delta: 5, hasPrior: true, significant: false });
	});
	it('a negative move surfaces a negative delta', () => {
		expect(proportionPriorDelta(81, 4529, 90, 4400, { onTime: 3669 }).delta).toBe(-9);
	});
	it('derives the numerator from pct×n when on_time is absent (≈ same verdict)', () => {
		const withOnTime = proportionPriorDelta(89, 2137, 84, 2183, { onTime: 1902 });
		const derived = proportionPriorDelta(89, 2137, 84, 2183);
		expect(derived.significant).toBe(withOnTime.significant);
	});
	it('does NOT call a 1-pt move significant when the prior rounding band could erase it', () => {
		// 85% vs a prior shown as 84% at n≈16.4k: treating 84% as exact, the old z≈2.5 read
		// "significant". But the prior ships ROUNDED — it could truly be 84.5%, halving the move to
		// 0.5pt (z≈1.3). The gate now tests that least-favourable prior, so this reads within-noise.
		const r = proportionPriorDelta(85, 16400, 84, 16400, { onTime: 13940 });
		expect(r.delta).toBe(1);
		expect(r.hasPrior).toBe(true);
		expect(r.significant).toBe(false);
	});
	it('still calls a robust multi-point move significant despite the prior rounding band', () => {
		// 85% vs 80% at the same n: even the nearest admissible prior (80.5%) leaves a 4.5pt move
		// well past 95%, so the rounding-robust gate keeps the arrow.
		const r = proportionPriorDelta(85, 16400, 80, 16400, { onTime: 13940 });
		expect(r.delta).toBe(5);
		expect(r.significant).toBe(true);
	});
});

describe('proportionPriorDelta — exact prior numerator (FIX-4, no rounding band)', () => {
	it('uses the exact prior count when priorOnTime is present → resolves what the band suppressed', () => {
		// SAME inputs as the band-suppressed case above, but the contract now ships the EXACT prior
		// numerator: 13776/16400 = a true 84.0%, so the move is a real 1.0pt → pooled z ≈ 2.50 ≥ 1.96.
		const r = proportionPriorDelta(85, 16400, 84, 16400, { onTime: 13940, priorOnTime: 13776 });
		expect(r.delta).toBe(1);
		expect(r.hasPrior).toBe(true);
		expect(r.significant).toBe(true);
	});
	it('falls back to the ±0.5pt band when priorOnTime is absent (back-compat with old snapshots)', () => {
		// No exact prior → the conservative band hack treats the prior as possibly 84.5% (z ≈ 1.26),
		// so the SAME headline move reads within-noise. This is the pre-republish behaviour.
		const r = proportionPriorDelta(85, 16400, 84, 16400, { onTime: 13940 });
		expect(r.significant).toBe(false);
	});
	it('agrees with the verdict on robust moves whether exact or banded', () => {
		const exact = proportionPriorDelta(85, 16400, 80, 16400, { onTime: 13940, priorOnTime: 13120 });
		const banded = proportionPriorDelta(85, 16400, 80, 16400, { onTime: 13940 });
		expect(exact.significant).toBe(true);
		expect(banded.significant).toBe(true);
	});
	it('clamps the exact prior numerator to [0, priorN] (no NaN, proportion ≤ 1)', () => {
		const r = proportionPriorDelta(85, 16400, 84, 16400, { onTime: 13940, priorOnTime: 99999 });
		expect(r.delta).toBe(1);
		expect(typeof r.significant).toBe('boolean'); // defined, not NaN-derived
	});
});

describe('meanPriorDelta — honest absence', () => {
	it('no prior value → absent', () => {
		expect(meanPriorDelta(29.3, 44, null, null, { cov: 0.1 })).toEqual({
			delta: null,
			hasPrior: false,
			significant: false,
		});
	});
});

describe('meanPriorDelta — significance gate (shared-CoV two-sample z)', () => {
	it('a sub-minute jitter at small n is NOT significant (route 10 week am_peak)', () => {
		const r = meanPriorDelta(29.4, 20, 29.2, 24, { cov: 0.1 });
		expect(r.delta).toBe(0.2);
		expect(r.hasPrior).toBe(true);
		expect(r.significant).toBe(false);
	});
	it('a large, real move at a healthy sample IS significant', () => {
		const r = meanPriorDelta(18, 60, 9, 60, { cov: 0.2 });
		expect(r.delta).toBe(9);
		expect(r.significant).toBe(true);
	});
	it('without a CoV the spread is unknown → never significant, but delta still surfaces', () => {
		const r = meanPriorDelta(18, 60, 9, 60, { cov: null });
		expect(r.delta).toBe(9);
		expect(r.significant).toBe(false);
	});
	it('both windows must clear the gap-sample floor', () => {
		expect(meanPriorDelta(18, MIN_POINTS_FOR_LINE - 1, 9, 60, { cov: 0.2 }).significant).toBe(
			false,
		);
	});
	it('rounds the delta to one decimal by default', () => {
		expect(meanPriorDelta(12.36, 30, 12.0, 30, { cov: 0.15 }).delta).toBe(0.4);
	});
	it('a zero delta is never significant', () => {
		expect(meanPriorDelta(12, 60, 12, 60, { cov: 0.2 }).significant).toBe(false);
	});
	it('is direction-symmetric: a rise and its mirror-image fall get the same verdict', () => {
		// 10→8 (fall) vs 8→10 (rise), same |Δ|, n, CoV. The shared dispersion is anchored to the
		// AVERAGE of the two means, so both clear the gate identically — an SE tied to the current
		// value alone (the bug) called the fall significant but not the equal-magnitude rise.
		const fall = meanPriorDelta(8, 20, 10, 20, { cov: 0.34 });
		const rise = meanPriorDelta(10, 20, 8, 20, { cov: 0.34 });
		expect(rise.significant).toBe(fall.significant);
		expect(rise.significant).toBe(true);
		expect(fall.delta).toBe(-2);
		expect(rise.delta).toBe(2);
	});
});
