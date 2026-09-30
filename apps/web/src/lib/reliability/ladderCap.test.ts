// ladderCap.test.ts — the S12 worst-N ladder cap helpers (cap + segments).

import { describe, it, expect } from 'vitest';
import { worstNCap, worstNSegments, SMALLEST_WORST_N, DEFAULT_WORST_N } from './ladderCap';
import { WORST_N_LADDER } from '$lib/filters';

describe('worstNCap', () => {
	it('maps a numeric rung to its integer', () => {
		expect(worstNCap('5')).toBe(5);
		expect(worstNCap('50')).toBe(50);
	});
	it('maps "all" to Infinity (no truncation)', () => {
		expect(worstNCap('all')).toBe(Number.POSITIVE_INFINITY);
	});
});

describe('worstNSegments', () => {
	it('lists every ladder rung labelled by its number, then the "All" rung', () => {
		const segs = worstNSegments('All');
		expect(segs.map((s) => s.key)).toEqual([...WORST_N_LADDER, 'all']);
		expect(segs.at(-1)).toEqual({ key: 'all', label: 'All' });
		// numeric rungs use their own number as the label.
		expect(segs[0]).toEqual({ key: '5', label: '5' });
	});
});

describe('constants', () => {
	it('the default cap is the 10 rung and the smallest rung is 5', () => {
		expect(DEFAULT_WORST_N).toBe('10');
		expect(SMALLEST_WORST_N).toBe(5);
	});
});
