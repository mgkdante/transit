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
		expect(min).toBeLessThan(87);
		expect(max).toBeGreaterThan(88);
	});

	it('a genuinely flat 88/88 series still gets a real window (a flat line inside it, no fake slope)', () => {
		const [min, max] = otpTrendDomain([88, 88, 88]);
		expect(max - min).toBeGreaterThanOrEqual(OTP_TREND_MIN_SPAN);
		expect(min).toBeLessThanOrEqual(88);
		expect(max).toBeGreaterThanOrEqual(88);
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
		const [min, max] = otpTrendDomain([87, 88, 87, 88, 87]);
		expect(min).toBeLessThanOrEqual(OTP_TREND_REFERENCE);
		expect(max).toBeGreaterThanOrEqual(88);
		expect(max - min).toBeGreaterThanOrEqual(OTP_TREND_MIN_SPAN);
	});

	it('exposes the absolute 80% reference anchor for the zoomed axis', () => {
		expect(OTP_TREND_REFERENCE).toBe(80);
	});
});
