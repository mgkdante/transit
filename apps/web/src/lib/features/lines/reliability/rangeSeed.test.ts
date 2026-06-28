import { describe, it, expect } from 'vitest';
import { isIsoDate, resolveRangeSeed } from './rangeSeed';

describe('isIsoDate', () => {
	it('accepts a YYYY-MM-DD string only', () => {
		expect(isIsoDate('2026-06-18')).toBe(true);
		expect(isIsoDate('2026-6-1')).toBe(false);
		expect(isIsoDate('not-a-date')).toBe(false);
		expect(isIsoDate('')).toBe(false);
		expect(isIsoDate(null)).toBe(false);
		expect(isIsoDate(undefined)).toBe(false);
	});
});

describe('resolveRangeSeed — the URL is a hint, never a data source', () => {
	const avail = new Set(['2026-06-16', '2026-06-17', '2026-06-18']);

	it('keeps both bounds when they are real available dates', () => {
		expect(resolveRangeSeed('2026-06-16', '2026-06-18', 'range', avail)).toEqual({
			from: '2026-06-16',
			to: '2026-06-18',
			activateRange: false, // already range → no need to activate
		});
	});

	it('drops an out-of-window / non-existent bound (no fabricated window)', () => {
		expect(resolveRangeSeed('2026-01-01', '2026-06-18', 'range', avail)).toEqual({
			from: '',
			to: '2026-06-18',
			activateRange: false,
		});
		expect(resolveRangeSeed('2026-06-16', '2030-12-31', 'range', avail).to).toBe('');
	});

	it('activates range mode when a COMPLETE valid from+to arrives without ?grain=range', () => {
		const r = resolveRangeSeed('2026-06-16', '2026-06-18', 'day', avail);
		expect(r.activateRange).toBe(true);
		expect(r.from).toBe('2026-06-16');
		expect(r.to).toBe('2026-06-18');
	});

	it('does NOT activate range on a partial (only one bound) seed', () => {
		expect(resolveRangeSeed('2026-06-16', '', 'day', avail).activateRange).toBe(false);
		expect(resolveRangeSeed('', '2026-06-18', 'day', avail).activateRange).toBe(false);
	});

	it('does NOT activate range when there are no dated days to range over', () => {
		expect(resolveRangeSeed('2026-06-16', '2026-06-18', 'day', new Set()).activateRange).toBe(
			false,
		);
	});

	it('a single-day from==to is a valid (exact) range and still activates', () => {
		const r = resolveRangeSeed('2026-06-17', '2026-06-17', 'day', avail);
		expect(r).toEqual({ from: '2026-06-17', to: '2026-06-17', activateRange: true });
	});
});
