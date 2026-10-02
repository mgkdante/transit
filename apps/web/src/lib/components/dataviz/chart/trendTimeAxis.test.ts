import { describe, expect, it } from 'vitest';
import { trendTimeAxis } from './trendTimeAxis';

const point = (date: string) => ({ x: Date.parse(date), xLabel: date, y: null });

describe('trend date ticks', () => {
	it.each(['en', 'fr'] as const)(
		'labels actual calendar dates in %s without intermediate ticks',
		(locale) => {
			const points = ['2026-08-27', '2026-08-28', '2026-08-29'].map(point);
			const axis = trendTimeAxis(points, locale);
			expect(axis.ticks).toEqual(points.map((p) => p.x));
			expect(axis.ticks.map(axis.format)).toEqual(
				locale === 'fr' ? ['27 août', '28 août', '29 août'] : ['Aug 27', 'Aug 28', 'Aug 29'],
			);
		},
	);

	it('keeps both ends of an irregular window and samples only real positions', () => {
		const points = [
			'2026-01-01',
			'2026-01-03',
			'2026-01-09',
			'2026-02-01',
			'2026-02-08',
			'2026-03-17',
		].map(point);
		const axis = trendTimeAxis(Object.freeze(points), 'en');
		expect(axis.ticks.length).toBeLessThanOrEqual(4);
		expect(axis.domain).toEqual([points[0].x, points.at(-1)?.x]);
		expect(axis.ticks[0]).toBe(points[0].x);
		expect(axis.ticks.at(-1)).toBe(points.at(-1)?.x);
		for (const tick of axis.ticks) expect(points.some((p) => p.x === tick)).toBe(true);
	});

	it('keeps labels apart across a long gap in the available dates', () => {
		const points = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-12-31'].map(
			point,
		);
		expect(trendTimeAxis(points, 'en').ticks).toEqual([points[0].x, points[4].x]);
	});

	it('includes years when the window crosses a year boundary', () => {
		const axis = trendTimeAxis(['2025-12-31', '2026-01-01'].map(point), 'en');
		expect(axis.ticks.map(axis.format)).toEqual(['Dec 31, 2025', 'Jan 1, 2026']);
	});

	it('deduplicates positions and leaves non-calendar labels intact', () => {
		const axis = trendTimeAxis(
			[
				{ x: 1, xLabel: 'Sample A', y: 0 },
				{ x: 1, xLabel: 'Sample A', y: 1 },
				{ x: NaN, xLabel: 'Unknown', y: null },
			],
			'en',
		);
		expect(axis.ticks).toEqual([1]);
		expect(axis.format(1)).toBe('Sample A');
		expect(trendTimeAxis([], 'en').ticks).toEqual([]);
		expect(trendTimeAxis([], 'en').domain).toEqual([0, 1]);
	});
});
