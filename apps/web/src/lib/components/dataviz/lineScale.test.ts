import { describe, it, expect } from 'vitest';
import { makeXScale } from './lineScale';

const W = 100;
const PAD = 10; // innerW = 80

describe('makeXScale — index fallback (byte-identical for categorical callers)', () => {
	it('spaces by array index when no times are given', () => {
		const s = makeXScale({ count: 3, width: W, pad: PAD });
		expect(s.timeBased).toBe(false);
		expect(s.x(0)).toBe(10);
		expect(s.x(1)).toBe(50); // PAD + 0.5 * innerW
		expect(s.x(2)).toBe(90);
	});

	it('centres a single point', () => {
		const s = makeXScale({ count: 1, width: W, pad: PAD });
		expect(s.x(0)).toBe(50);
		expect(s.indexAt(0.9)).toBe(0);
	});

	it('falls back to index when fewer than 2 distinct times', () => {
		const s = makeXScale({ count: 3, width: W, pad: PAD, times: [5, 5, 5] });
		expect(s.timeBased).toBe(false);
		expect(s.x(1)).toBe(50);
	});

	it('indexAt rounds to the nearest index', () => {
		const s = makeXScale({ count: 3, width: W, pad: PAD });
		expect(s.indexAt(0.1)).toBe(0); // vbX 10 -> idx 0
		expect(s.indexAt(0.5)).toBe(1);
		expect(s.indexAt(0.95)).toBe(2);
	});
});

describe('makeXScale — true time scale (the flat-trend fix)', () => {
	// day0, day1, day10 — adjacent indices, very UNEVEN calendar gaps.
	const times = [0, 86_400_000, 864_000_000];

	it('spaces by elapsed time, not by index', () => {
		const s = makeXScale({ count: 3, width: W, pad: PAD, times });
		expect(s.timeBased).toBe(true);
		expect(s.x(0)).toBe(10);
		// day1 is 1/10 of the span from the start -> hugs the left, NOT the midpoint.
		expect(s.x(1)).toBeCloseTo(18, 5); // PAD + (1/10) * 80
		expect(s.x(2)).toBe(90);
		// the index-mode midpoint (50) would FLATTEN the real gap — the bug.
		expect(s.x(1)).not.toBe(50);
	});

	it('indexAt inverts the time map (hit-test agrees with the plot)', () => {
		const s = makeXScale({ count: 3, width: W, pad: PAD, times });
		// the x of each point, as a fraction of width, resolves back to that point.
		for (let i = 0; i < 3; i++) {
			expect(s.indexAt(s.x(i) / W)).toBe(i);
		}
	});

	it('accepts Date and ISO-string times', () => {
		const s = makeXScale({
			count: 3,
			width: W,
			pad: PAD,
			times: ['2026-06-01', '2026-06-02', '2026-06-11'],
		});
		expect(s.timeBased).toBe(true);
		expect(s.x(1)).toBeCloseTo(18, 5);
	});

	it('a null/undated point keeps its index x rather than collapsing to the start', () => {
		const s = makeXScale({ count: 3, width: W, pad: PAD, times: [0, null, 864_000_000] });
		expect(s.timeBased).toBe(true); // 2 distinct dated points
		expect(s.x(0)).toBe(10);
		expect(s.x(2)).toBe(90);
		// the undated middle index falls back to its index x (50), not tMin (10).
		expect(s.x(1)).toBe(50);
	});
});
