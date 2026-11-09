import { describe, expect, it } from 'vitest';
import { spacedTicks } from './responsiveTicks';

describe('spacedTicks', () => {
	it.each([160, 240, 500, 1800])(
		'keeps numeric landmarks at least 40px apart over %s px',
		(width) => {
			const ticks = spacedTicks(
				[-300, -60, 0, 60, 300, 600, 1800],
				(v) => ((v + 300) / 2100) * width,
				40,
			);
			expect(ticks[0]).toBe(-300);
			for (let i = 1; i < ticks.length; i++)
				expect(((ticks[i] - ticks[i - 1]) / 2100) * width).toBeGreaterThanOrEqual(40);
		},
	);
	it.each([160, 240, 500, 1800])('always keeps a pinned landmark over %s px', (width) => {
		const ticks = spacedTicks(
			[-300, -60, 0, 60, 300, 600, 1800],
			(v) => ((v + 300) / 2100) * width,
			40,
			(v) => v === 0,
		);
		expect(ticks).toContain(0);
		for (let i = 1; i < ticks.length; i++)
			expect(((ticks[i] - ticks[i - 1]) / 2100) * width).toBeGreaterThanOrEqual(40);
	});
	it('preserves every well-spaced label and handles empty data', () => {
		expect(spacedTicks(['a', 'b'], (_, i) => i * 100, 60)).toEqual(['a', 'b']);
		expect(spacedTicks([], () => 0, 60)).toEqual([]);
	});
});
