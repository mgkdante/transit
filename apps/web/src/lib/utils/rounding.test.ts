import { describe, expect, it } from 'vitest';
import { roundHalfAwayFromZero } from './rounding';

describe('roundHalfAwayFromZero', () => {
	it('rounds positive and negative decimal ties away from zero', () => {
		expect(roundHalfAwayFromZero(1.005, 2)).toBe(1.01);
		expect(roundHalfAwayFromZero(-1.005, 2)).toBe(-1.01);
	});

	it('rounds ordinary decimal values to the requested precision', () => {
		expect(roundHalfAwayFromZero(12.344, 2)).toBe(12.34);
		expect(roundHalfAwayFromZero(12.345, 2)).toBe(12.35);
		expect(roundHalfAwayFromZero(-12.345, 2)).toBe(-12.35);
	});

	it('handles scientific notation without binary tie drift', () => {
		expect(roundHalfAwayFromZero(1.25e-7, 8)).toBe(1.3e-7);
		expect(roundHalfAwayFromZero(-1.25e-7, 8)).toBe(-1.3e-7);
	});

	it('normalizes negative zero', () => {
		const rounded = roundHalfAwayFromZero(-0, 2);

		expect(rounded).toBe(0);
		expect(Object.is(rounded, -0)).toBe(false);
	});
});
