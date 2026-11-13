import { expect, it } from 'vitest';
import { tripDirection } from './tripDirection';

it('gives a headsign only when exactly one direction matches', () => {
	const direction = (ids: string[], headsign: string | null = 'Terminal') => ({
		dir: 0,
		headsign,
		stops: ids.map((id, seq) => ({ id, seq })),
	});
	const forward = direction(['A', 'B', 'C']);
	expect(tripDirection(['X', 'Y'], [forward])).toBeNull();
	expect(tripDirection(['A', 'X', 'C'], [forward])).toBe('Terminal');
	expect(tripDirection(['A', 'C'], [forward, forward])).toBeNull();
	expect(tripDirection(['A'], [forward])).toBeNull();
	expect(tripDirection(['C', 'A'], [forward])).toBeNull();
	expect(tripDirection(['A', 'B', 'A', 'C'], [direction(['A', 'B', 'A', 'C'])])).toBe('Terminal');
	expect(tripDirection(['A', 'B'], [direction(['A', 'B'], '  ')])).toBeNull();
	expect(tripDirection(['A', 'B'], [direction(['A', 'B'], null)])).toBeNull();
	expect(tripDirection(['A', 'B'], [{ ...forward, stops: [...forward.stops].reverse() }])).toBe(
		'Terminal',
	);
});
