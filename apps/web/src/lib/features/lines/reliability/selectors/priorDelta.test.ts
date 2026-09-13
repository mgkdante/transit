import { describe, expect, it } from 'vitest';
import { priorDelta } from './priorDelta';

describe('priorDelta', () => {
	it('compares the published metric values without inferring sampling significance', () => {
		expect(priorDelta(90, 85)).toBe(5);
		expect(priorDelta(81, 90)).toBe(-9);
		// These gap distributions both have mean 7, but their medians are 3 and 1.
		// The observed median difference remains descriptive; no mean test applies.
		expect(priorDelta(3, 1, 1)).toBe(2);
	});

	it('distinguishes measured zero from missing observations', () => {
		expect(priorDelta(0, 0)).toBe(0);
		expect(priorDelta(90, 90)).toBe(0);
		for (const missing of [null, undefined, NaN, Infinity, -Infinity]) {
			expect(priorDelta(90, missing)).toBeNull();
			expect(priorDelta(missing, 90)).toBeNull();
		}
	});

	it('rounds positive and negative ties away from zero at the requested precision', () => {
		expect(priorDelta(1.5, 1)).toBe(1);
		expect(priorDelta(1, 1.5)).toBe(-1);
		expect(priorDelta(12.25, 12, 1)).toBe(0.3);
		expect(priorDelta(12, 12.25, 1)).toBe(-0.3);
		expect(Object.is(priorDelta(0, 0.01, 1), -0)).toBe(false);
	});
});
