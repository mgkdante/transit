import { describe, it, expect } from 'vitest';
import {
	MIN_N_RATE,
	WILSON_Z,
	tierFor,
	isReliableRate,
	isSuppressedCount,
	wilsonBounds,
	wilsonBoundsProportion,
	wilsonLo,
	wilsonHi,
	rankByLowerBound,
} from './stats';

describe('constants mirror the Chart Doctrine §4.0 + the server', () => {
	it('MIN_N_RATE is 30 and z is 1.96', () => {
		expect(MIN_N_RATE).toBe(30);
		expect(WILSON_Z).toBe(1.96);
	});
});

describe('tierFor — the degradation ladder', () => {
	it('maps n to full/strip/sentence/none', () => {
		expect(tierFor(50)).toBe('full');
		expect(tierFor(30)).toBe('full');
		expect(tierFor(29)).toBe('strip');
		expect(tierFor(4)).toBe('strip');
		expect(tierFor(3)).toBe('sentence');
		expect(tierFor(1)).toBe('sentence');
		expect(tierFor(0)).toBe('none');
	});
	it('treats unknown depth (null/undefined/NaN) as none, never full', () => {
		expect(tierFor(null)).toBe('none');
		expect(tierFor(undefined)).toBe('none');
		expect(tierFor(Number.NaN)).toBe('none');
	});
});

describe('rate gates', () => {
	it('isReliableRate is n >= MIN_N_RATE', () => {
		expect(isReliableRate(30)).toBe(true);
		expect(isReliableRate(29)).toBe(false);
		expect(isReliableRate(null)).toBe(false);
	});
	it('isSuppressedCount is a non-zero count below the display floor', () => {
		expect(isSuppressedCount(9)).toBe(true);
		expect(isSuppressedCount(10)).toBe(false);
		expect(isSuppressedCount(0)).toBe(false);
		expect(isSuppressedCount(null)).toBe(false);
	});
});

describe('wilsonBounds — byte-for-byte with the server _wilson_bounds', () => {
	it('matches the textbook 95% interval for 50/100', () => {
		expect(wilsonBounds(50, 100)).toEqual([40.4, 59.6]);
	});
	it('matches the server emit-wiring fixture for 90/100', () => {
		expect(wilsonBounds(90, 100)).toEqual([82.6, 94.5]);
	});
	it('is null on a missing numerator or zero/missing denominator', () => {
		expect(wilsonBounds(null, 100)).toBeNull();
		expect(wilsonBounds(5, 0)).toBeNull();
		expect(wilsonBounds(5, null)).toBeNull();
	});
	it('clamps successes above n and stays within [0,100]', () => {
		const b = wilsonBounds(150, 100);
		expect(b).not.toBeNull();
		const [lo, hi] = b!;
		expect(lo).toBeGreaterThanOrEqual(0);
		expect(hi).toBeLessThanOrEqual(100);
		expect(lo).toBeLessThanOrEqual(hi);
	});
	it('lo/hi extract the bounds and guard null', () => {
		expect(wilsonLo(50, 100)).toBe(40.4);
		expect(wilsonHi(50, 100)).toBe(59.6);
		expect(wilsonLo(null, 0)).toBeNull();
		expect(wilsonHi(5, 0)).toBeNull();
	});
});

describe('wilsonBoundsProportion — the unrounded [0,1] kernel wilsonBounds wraps', () => {
	it('returns the same interval as wilsonBounds, in [0,1] and unrounded', () => {
		const p = wilsonBoundsProportion(50, 100);
		expect(p).not.toBeNull();
		expect(p![0]).toBeCloseTo(0.404, 3);
		expect(p![1]).toBeCloseTo(0.596, 3);
	});
	it('is null on a missing numerator or zero/missing denominator', () => {
		expect(wilsonBoundsProportion(null, 100)).toBeNull();
		expect(wilsonBoundsProportion(5, 0)).toBeNull();
		expect(wilsonBoundsProportion(5, null)).toBeNull();
	});
	it('clamps successes above n and stays within [0,1]', () => {
		const [lo, hi] = wilsonBoundsProportion(150, 100)!;
		expect(lo).toBeGreaterThanOrEqual(0);
		expect(hi).toBeLessThanOrEqual(1);
		expect(lo).toBeLessThanOrEqual(hi);
	});
});

describe('rankByLowerBound — the tiny-n fluke never out-ranks a real bad actor', () => {
	it('1-of-1 (100%) ranks BELOW 900-of-1000 (90%)', () => {
		const items = [
			{ id: 'fluke', lo: wilsonLo(1, 1) },
			{ id: 'real', lo: wilsonLo(900, 1000) },
		];
		const ranked = rankByLowerBound(items, (x) => x.lo);
		expect(ranked.map((x) => x.id)).toEqual(['real', 'fluke']);
	});
	it('null bounds sort last, stably, and the input is not mutated', () => {
		const items = [
			{ id: 'a', lo: null },
			{ id: 'b', lo: 80 },
			{ id: 'c', lo: null },
			{ id: 'd', lo: 90 },
		];
		const ranked = rankByLowerBound(items, (x) => x.lo);
		expect(ranked.map((x) => x.id)).toEqual(['d', 'b', 'a', 'c']);
		expect(items[0].id).toBe('a'); // original order intact
	});
});
