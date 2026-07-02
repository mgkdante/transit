// state.test.ts — the DateWindow shape helpers: the ISO shape gate + the {from,to}
// normalization the codec relies on. A window is present ONLY as a complete, valid,
// from<=to span; anything less is honest-absence (undefined).

import { describe, it, expect } from 'vitest';
import { isIsoDate, normalizeWindow } from './state';

describe('isIsoDate — the YYYY-MM-DD shape gate', () => {
	it('accepts a well-formed YYYY-MM-DD string only', () => {
		expect(isIsoDate('2026-06-18')).toBe(true);
		expect(isIsoDate('2026-6-1')).toBe(false); // not zero-padded
		expect(isIsoDate('2026/06/18')).toBe(false);
		expect(isIsoDate('not-a-date')).toBe(false);
		expect(isIsoDate('')).toBe(false);
		expect(isIsoDate(null)).toBe(false);
		expect(isIsoDate(undefined)).toBe(false);
	});
});

describe('normalizeWindow — a complete, valid, from<=to span or nothing', () => {
	it('builds a window from two valid, ordered bounds', () => {
		expect(normalizeWindow('2026-06-01', '2026-06-14')).toEqual({
			from: '2026-06-01',
			to: '2026-06-14',
		});
	});

	it('treats a single day (from==to) as a valid one-day window', () => {
		expect(normalizeWindow('2026-06-14', '2026-06-14')).toEqual({
			from: '2026-06-14',
			to: '2026-06-14',
		});
	});

	it('swaps an inverted from>to so the stored window reads from<=to', () => {
		expect(normalizeWindow('2026-06-14', '2026-06-01')).toEqual({
			from: '2026-06-01',
			to: '2026-06-14',
		});
	});

	it('drops a HALF window (one bound missing) — a half window is no window', () => {
		expect(normalizeWindow('2026-06-01', undefined)).toBeUndefined();
		expect(normalizeWindow(null, '2026-06-14')).toBeUndefined();
		expect(normalizeWindow('2026-06-01', '')).toBeUndefined();
	});

	it('drops a MALFORMED bound — never fabricates a span from junk', () => {
		expect(normalizeWindow('yesterday', '2026-06-14')).toBeUndefined();
		expect(normalizeWindow('2026-6-1', '2026-06-14')).toBeUndefined();
	});
});
