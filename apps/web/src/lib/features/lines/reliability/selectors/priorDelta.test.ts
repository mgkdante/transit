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
});
