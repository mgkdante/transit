import { describe, it, expect } from 'vitest';
import { selectDirectionAsymmetry } from './directionAsymmetry';

const opts = { dir0Label: 'East', dir1Label: 'West' };

describe('selectDirectionAsymmetry', () => {
	it('returns the shift with the largest gap and names slower/faster correctly', () => {
		const res = selectDirectionAsymmetry(
			[
				{ label: 'Midday', dir0: 10, dir1: 11 }, // diff 1 → below threshold
				{ label: 'PM peak', dir0: 14, dir1: 8 }, // diff 6 → East slower
			],
			opts,
		);
		expect(res?.shiftLabel).toBe('PM peak');
		expect(res?.slowerLabel).toBe('East');
		expect(res?.slowerMin).toBe(14);
		expect(res?.fasterLabel).toBe('West');
		expect(res?.fasterMin).toBe(8);
		expect(res?.diffMin).toBe(6);
	});

	it('flips slower/faster when dir1 is the longer wait', () => {
		const res = selectDirectionAsymmetry([{ label: 'AM peak', dir0: 6, dir1: 12 }], opts);
		expect(res?.slowerLabel).toBe('West');
		expect(res?.fasterLabel).toBe('East');
	});

	it('returns null when every gap is below the threshold', () => {
		const res = selectDirectionAsymmetry([{ label: 'Midday', dir0: 10, dir1: 11 }], opts);
		expect(res).toBeNull();
	});

	it('skips rows missing a direction (no fabricated 0)', () => {
		const res = selectDirectionAsymmetry(
			[
				{ label: 'Evening', dir0: 20, dir1: null },
				{ label: 'PM peak', dir0: 12, dir1: 7 },
			],
			opts,
		);
		expect(res?.shiftLabel).toBe('PM peak');
	});

	it('honours a custom minDiffMin', () => {
		const rows = [{ label: 'Midday', dir0: 10, dir1: 13 }]; // diff 3
		expect(selectDirectionAsymmetry(rows, { ...opts, minDiffMin: 5 })).toBeNull();
		expect(selectDirectionAsymmetry(rows, { ...opts, minDiffMin: 2 })?.diffMin).toBe(3);
	});
});
