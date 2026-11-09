import { describe, it, expect } from 'vitest';
import { snapSize, stepSize, RIGHT_SIZES, LEFT_SIZES } from './panelSizes';
describe('panel size model', () => {
	it.each([
		[56, 56],
		[187, 56],
		[189, 320],
		[359, 320],
		[361, 400],
		[479, 400],
		[481, 560],
		[900, 560],
	])('snaps %s to %s', (width, expected) =>
		expect(snapSize(width, RIGHT_SIZES, 400)).toBe(expected),
	);
	it('uses standard for non-finite widths', () =>
		expect(snapSize(NaN, RIGHT_SIZES, 400)).toBe(400));
	it('steps and clamps both sides', () => {
		expect(stepSize(56, 'ArrowLeft', RIGHT_SIZES, 'right')).toBe(320);
		expect(stepSize(560, 'ArrowLeft', RIGHT_SIZES, 'right')).toBe(560);
		expect(stepSize(56, 'ArrowRight', LEFT_SIZES, 'left')).toBe(300);
		expect(stepSize(300, 'Home', LEFT_SIZES, 'left')).toBe(56);
		expect(stepSize(56, 'End', LEFT_SIZES, 'left')).toBe(300);
		expect(stepSize(400, 'Tab', RIGHT_SIZES, 'right')).toBeNull();
	});
});
