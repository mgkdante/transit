import { describe, expect, it } from 'vitest';
import { ladderGrains, HOTSPOT_GRAINS, OFFENDER_GRAINS } from './ladderGrains';

const row = (grain: string, entries = 0, tray = 0) => ({
	grain,
	entries: Array.from({ length: entries }, (_, id) => ({ id })),
	tray: Array.from({ length: tray }, (_, id) => ({ id })),
});

describe.each([{ known: HOTSPOT_GRAINS }, { known: OFFENDER_GRAINS }])(
	'ladderGrains $known',
	({ known }) => {
		it('indexes only known grains and offers ranked or tray rows in vocabulary order', () => {
			const result = ladderGrains(
				[row(known[0], 2), row(known[1], 0, 1), row('mystery', 5)],
				known,
			);
			expect([...result.ladders.keys()]).toEqual([known[0], known[1]]);
			expect([...result.present]).toEqual([known[0], known[1]]);
			expect(result.defaultGrain).toBe(known[0]);
		});

		it('defaults to the finest populated grain and uses the first vocabulary item when empty', () => {
			expect(ladderGrains([row(known[0]), row(known[1], 1)], known).defaultGrain).toBe(known[1]);
			const empty = ladderGrains(undefined, known);
			expect(empty.ladders.size).toBe(0);
			expect(empty.present.size).toBe(0);
			expect(empty.defaultGrain).toBe(known[0]);
		});

		it('uses the last duplicate, even when that ladder is empty', () => {
			const last = row(known[0]);
			const result = ladderGrains([row(known[0], 2), last], known);
			expect(result.ladders.get(known[0])).toBe(last);
			expect(result.present.size).toBe(0);
		});
	},
);
