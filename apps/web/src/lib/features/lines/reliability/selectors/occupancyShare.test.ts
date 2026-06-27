import { describe, it, expect } from 'vitest';
import { selectOccupancyShare } from './occupancyShare';

const label = (c: string) =>
	({
		empty: 'Empty',
		many_seats: 'Many seats',
		few_seats: 'Few seats',
		standing: 'Standing',
		full: 'Full',
	})[c] ?? c;

describe('selectOccupancyShare', () => {
	it('builds a 100%-stacked occupancy share spec from a fractional mix', () => {
		const s = selectOccupancyShare(
			{ empty: 0, many_seats: 0.3, few_seats: 0.35, standing: 0.3, full: 0.05 },
			'en',
			{ title: 'Crowding mix', label },
		);
		expect(s).not.toBeNull();
		expect(s!.kind).toBe('stacked-share');
		expect(s!.scale).toBe('occupancy');
		// zero-share bands (empty) are dropped — no slivers
		expect(s!.segments.map((x) => x.key)).toEqual(['many_seats', 'few_seats', 'standing', 'full']);
		// shares normalise to 100
		const sum = s!.segments.reduce((a, x) => a + x.share, 0);
		expect(Math.round(sum)).toBe(100);
		expect(Math.round(s!.segments[1].share)).toBe(35);
		expect(s!.segments[0].occupancy).toBe('many_seats');
		expect(s!.segments[0].glyph).toBeTruthy();
	});

	it('returns null on no telemetry / all-zero mix (honest absence, never a fake split)', () => {
		expect(selectOccupancyShare(null, 'en', { title: 't', label })).toBeNull();
		expect(
			selectOccupancyShare({ empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 0 }, 'en', {
				title: 't',
				label,
			}),
		).toBeNull();
		expect(
			selectOccupancyShare(
				{ empty: null, many_seats: null, few_seats: null, standing: null, full: null },
				'en',
				{
					title: 't',
					label,
				},
			),
		).toBeNull();
	});
});
