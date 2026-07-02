import { describe, it, expect } from 'vitest';
import {
	usableGrains,
	usableFromOffered,
	isGrainUsable,
	MIN_POINTS_PER_GRAIN,
	availableGrains,
	resolveWindow,
} from './grain';
import type { Grain } from '$lib/v1/schemas';
import type { DateWindow } from './state';

describe('usableGrains — data-depth gating (the flat-trend fix)', () => {
	it('enables only grains with >= minPoints trustworthy buckets', () => {
		// a thin route: plenty of days, but week/month collapse to too few points.
		const counts = { day: 30, week: 4, month: 1 };
		expect(usableGrains('historic', counts)).toEqual(['day']);
	});

	it('enables coarser grains once they have enough buckets', () => {
		const counts = { day: 90, week: 12, month: 8 };
		expect(usableGrains('historic', counts)).toEqual(['day', 'week', 'month']);
	});

	it('treats a missing count as zero (grain disabled, not crashed)', () => {
		expect(usableGrains('historic', {})).toEqual([]);
	});

	it('never exceeds the tier-available set', () => {
		const counts = { day: 99, week: 99, month: 99, live: 99 };
		const usable = usableGrains('static', counts);
		for (const g of usable) expect(availableGrains('static')).toContain(g);
	});

	it('respects a custom minPoints', () => {
		const counts = { day: 5, week: 5, month: 5 };
		expect(usableGrains('historic', counts, 5)).toEqual(['day', 'week', 'month']);
		expect(usableGrains('historic', counts, MIN_POINTS_PER_GRAIN)).toEqual([]);
	});

	it('isGrainUsable gates on both availability and depth', () => {
		const counts = { day: 30, week: 2 };
		expect(isGrainUsable('historic', 'day', counts)).toBe(true);
		expect(isGrainUsable('historic', 'week', counts)).toBe(false); // too few buckets
		expect(isGrainUsable('historic', 'nonsense', counts)).toBe(false);
	});
});

describe('usableFromOffered — data-depth gating against an explicit offered list', () => {
	const OFFERED: readonly Grain[] = ['day', 'week', 'month'];

	it('enables only offered grains with >= minPoints buckets, preserving order', () => {
		expect(usableFromOffered(OFFERED, { day: 30, week: 4, month: 1 })).toEqual(['day']);
		expect(usableFromOffered(OFFERED, { day: 90, week: 12, month: 8 })).toEqual([
			'day',
			'week',
			'month',
		]);
	});

	it('defaults minPoints to MIN_POINTS_PER_GRAIN (7)', () => {
		expect(usableFromOffered(OFFERED, { day: 7, week: 6, month: 7 })).toEqual(['day', 'month']);
	});

	it('treats a missing count as zero (grain disabled, not crashed)', () => {
		expect(usableFromOffered(OFFERED, {})).toEqual([]);
		expect(usableFromOffered(OFFERED, { day: 30 })).toEqual(['day']);
	});

	it('is boundary-inclusive at buckets === minPoints (>= semantics)', () => {
		expect(usableFromOffered(OFFERED, { day: 7, week: 7, month: 7 }, 7)).toEqual([
			'day',
			'week',
			'month',
		]);
	});

	it('respects a custom minPoints (1 reproduces a length>0 gate)', () => {
		expect(usableFromOffered(OFFERED, { day: 5, week: 1, month: 0 }, 1)).toEqual(['day', 'week']);
	});

	it('only ever returns grains the caller offered', () => {
		// A count for a non-offered grain is ignored (never leaks into the result).
		expect(usableFromOffered(['day', 'week'], { day: 30, week: 30, month: 30 })).toEqual([
			'day',
			'week',
		]);
	});
});

describe('resolveWindow — the shared availability clamp (URL is a hint, never data)', () => {
	const avail = new Set(['2026-06-16', '2026-06-17', '2026-06-18']);
	const w = (from: string, to: string): DateWindow => ({ from, to });

	it('keeps a window whose BOTH bounds are real available dates', () => {
		expect(resolveWindow(w('2026-06-16', '2026-06-18'), avail)).toEqual({
			from: '2026-06-16',
			to: '2026-06-18',
		});
	});

	it('keeps a single-day window when that day exists', () => {
		expect(resolveWindow(w('2026-06-17', '2026-06-17'), avail)).toEqual({
			from: '2026-06-17',
			to: '2026-06-17',
		});
	});

	it('DROPS the whole window when a bound is out of the available set (no half span)', () => {
		expect(resolveWindow(w('2026-01-01', '2026-06-18'), avail)).toBeUndefined();
		expect(resolveWindow(w('2026-06-16', '2030-12-31'), avail)).toBeUndefined();
	});

	it('passes an undefined window through as undefined', () => {
		expect(resolveWindow(undefined, avail)).toBeUndefined();
	});

	it('drops any window when the surface carries no dated days', () => {
		expect(resolveWindow(w('2026-06-16', '2026-06-18'), new Set())).toBeUndefined();
	});
});
