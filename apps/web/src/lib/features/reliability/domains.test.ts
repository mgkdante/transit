// domains.test.ts — pins the S9B OTP-trend zoom helper + the DECISIONS A2 "keep the pair"
// (network [0,15] p90-capable vs lines [0,8] avg-only). The zoom must be DATA-ANCHORED,
// MIN-SPAN-floored, and [0,100]-CLAMPED — never an in-view /max normalization, never a
// fabricated slope on a genuinely flat series.

import { describe, expect, it } from 'vitest';
import {
	DELAY_POS_DOMAIN,
	DELAY_DIST_DOMAIN,
	OTP_TREND_MIN_SPAN,
	OTP_TREND_REFERENCE,
	otpTrendDomain,
} from './domains';

describe('DECISIONS A2 — the delay-trend domain pair stays split (not unified)', () => {
	it('keeps both named constants: lines avg-only [0,8] and network p90-capable [0,15]', () => {
		expect(DELAY_POS_DOMAIN).toEqual([0, 8]);
		expect(DELAY_DIST_DOMAIN).toEqual([0, 15]);
	});
});

describe('otpTrendDomain — data-anchored, min-span-floored, [0,100]-clamped (S9B)', () => {
	it('a near-flat 87/88 week gets a floored span so the wiggle shows slope (never sub-pixel)', () => {
		const [min, max] = otpTrendDomain([87, 88, 87, 88]);
		expect(max - min).toBeGreaterThanOrEqual(OTP_TREND_MIN_SPAN);
		// The real values sit strictly INSIDE the padded window (honest, not edge-pinned).
		expect(min).toBeLessThan(87);
		expect(max).toBeGreaterThan(88);
	});

	it('a genuinely flat 88/88 series still gets a real window (a flat line inside it, no fake slope)', () => {
		const [min, max] = otpTrendDomain([88, 88, 88]);
		expect(max - min).toBeGreaterThanOrEqual(OTP_TREND_MIN_SPAN);
		expect(min).toBeLessThanOrEqual(88);
		expect(max).toBeGreaterThanOrEqual(88);
		// The value is NOT normalized to an edge — it lands somewhere inside the frame.
		expect(min).toBeLessThan(88);
		expect(max).toBeGreaterThan(88);
	});

	it('a wide series data-anchors to its real extremes (padded), not the full [0,100]', () => {
		const [min, max] = otpTrendDomain([40, 95]);
		expect(min).toBeGreaterThan(0);
		expect(max).toBeLessThanOrEqual(100);
		expect(min).toBeLessThan(40);
		expect(max).toBeGreaterThanOrEqual(95);
	});

	it('never exceeds the absolute [0,100] whole even when the data hugs the walls', () => {
		const low = otpTrendDomain([0, 1, 2]);
		expect(low[0]).toBe(0);
		expect(low[1]).toBeLessThanOrEqual(100);
		expect(low[1] - low[0]).toBeGreaterThanOrEqual(OTP_TREND_MIN_SPAN);

		const high = otpTrendDomain([98, 99, 100]);
		expect(high[1]).toBe(100);
		expect(high[0]).toBeGreaterThanOrEqual(0);
		expect(high[1] - high[0]).toBeGreaterThanOrEqual(OTP_TREND_MIN_SPAN);
	});

	it('ignores null / NaN gaps when anchoring', () => {
		expect(otpTrendDomain([null, 87, null, 88, null])).toEqual(otpTrendDomain([87, 88]));
	});

	it('an all-null / empty series falls back to the honest full [0,100] (no fabricated zoom)', () => {
		expect(otpTrendDomain([])).toEqual([0, 100]);
		expect(otpTrendDomain([null, null])).toEqual([0, 100]);
	});

	it('keeps the 80% reference INSIDE the zoom on prod-shaped data (87-88 wiggle)', () => {
		// Prod OTP runs above the target; a domain anchored only to the data would
		// clamp the target hairline to the floor, a falsely positioned anchor.
		const [min, max] = otpTrendDomain([87, 88, 87, 88, 87]);
		expect(min).toBeLessThanOrEqual(OTP_TREND_REFERENCE);
		expect(max).toBeGreaterThanOrEqual(88);
		expect(max - min).toBeGreaterThanOrEqual(OTP_TREND_MIN_SPAN);
	});

	it('exposes the absolute 80% reference anchor for the zoomed axis', () => {
		expect(OTP_TREND_REFERENCE).toBe(80);
	});
});
