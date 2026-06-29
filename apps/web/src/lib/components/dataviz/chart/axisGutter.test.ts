import { describe, it, expect } from 'vitest';
import { categoryGutter } from './axisGutter';

describe('categoryGutter', () => {
	it('grows the gutter for longer labels (more chars → wider left)', () => {
		const short = categoryGutter(['12', '7', '100']);
		const long = categoryGutter(['Côte-des-Neiges / Édouard-Montpetit']);
		expect(long.left).toBeGreaterThan(short.left);
	});

	it('clamps to the min for tiny labels and the max for very long ones', () => {
		const tiny = categoryGutter(['1'], { min: 96, max: 216 });
		expect(tiny.left).toBe(96);
		const huge = categoryGutter(['x'.repeat(200)], { min: 96, max: 216 });
		expect(huge.left).toBe(216);
	});

	it('fits short labels whole (no truncation when they fit the gutter)', () => {
		const g = categoryGutter(['Midday', 'Evening', 'AM peak']);
		expect(g.truncate('Midday')).toBe('Midday');
		expect(g.truncate('AM peak')).toBe('AM peak');
	});

	it('truncates only at the point a label no longer fits, with an ellipsis', () => {
		const g = categoryGutter(['x'.repeat(200)], { min: 96, max: 216 });
		const out = g.truncate('y'.repeat(200));
		expect(out.length).toBe(g.maxChars);
		expect(out.endsWith('…')).toBe(true);
		// the truncation budget is derived from the gutter, not a blanket constant
		expect(g.maxChars).toBeGreaterThan(16);
	});

	it('truncation budget tracks the gutter width (wider gutter → more chars kept)', () => {
		const narrow = categoryGutter(['a'.repeat(40)], { min: 88, max: 120 });
		const wide = categoryGutter(['a'.repeat(40)], { min: 88, max: 240 });
		expect(wide.maxChars).toBeGreaterThan(narrow.maxChars);
	});

	it('handles null/undefined labels without throwing', () => {
		const g = categoryGutter([null, undefined, 'AM peak']);
		expect(g.left).toBeGreaterThan(0);
		expect(g.truncate('AM peak')).toBe('AM peak');
	});
});
