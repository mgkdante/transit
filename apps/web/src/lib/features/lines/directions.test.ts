import { describe, it, expect } from 'vitest';
import { directionHeadsigns } from './directions';

describe('directionHeadsigns', () => {
	it('maps each direction_id to its FIRST non-empty headsign (the canonical short label)', () => {
		const map = directionHeadsigns([
			{ dir: 0, headsign: 'Est' },
			{ dir: 0, headsign: 'Est destination Station Snowdon' },
			{ dir: 1, headsign: 'Ouest' },
		]);
		expect(map).toEqual({ 0: 'Est', 1: 'Ouest' });
	});

	it('skips empty / whitespace headsigns + null dirs, and is honest-empty for no data', () => {
		expect(
			directionHeadsigns([
				{ dir: 0, headsign: '   ' },
				{ dir: 1, headsign: null },
			]),
		).toEqual({});
		expect(directionHeadsigns(undefined)).toEqual({});
		expect(directionHeadsigns(null)).toEqual({});
		expect(directionHeadsigns([])).toEqual({});
	});
});
