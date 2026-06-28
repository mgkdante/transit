import { describe, it, expect } from 'vitest';
import { selectBestTimeInsight } from './bestTimeInsight';
import type { HabitsVM } from '../clusters';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Build a 7×24 matrix from a sparse {[r]: {[c]: v}} spec; everything else null. */
function matrixOf(spec: Record<number, Record<number, number>>): (number | null)[][] {
	return Array.from({ length: 7 }, (_, r) =>
		Array.from({ length: 24 }, (_, c) => spec[r]?.[c] ?? null),
	);
}
const vm = (matrix: (number | null)[][]): HabitsVM => ({
	scale: 'repeat_problem_relative',
	matrix,
	isEmpty: false,
});

describe('selectBestTimeInsight', () => {
	it('names the worst (day, hour) cell as the max value', () => {
		const res = selectBestTimeInsight(vm(matrixOf({ 4: { 17: 1.0 }, 0: { 8: 0.3 } })), {
			fullRowLabels: DAYS,
			hourLabel,
		});
		expect(res?.worstDayLabel).toBe('Fri');
		expect(res?.worstHourLabel).toBe('17:00');
	});

	it('picks the calmest weekday by row MEAN, excluding the worst day', () => {
		// Mon noisy, Sun all low → Sun is calmest; worst cell is Mon 8:00.
		const res = selectBestTimeInsight(
			vm(matrixOf({ 0: { 8: 1.0, 9: 0.9 }, 6: { 8: 0.05, 9: 0.02 } })),
			{ fullRowLabels: DAYS, hourLabel },
		);
		expect(res?.worstDayLabel).toBe('Mon');
		expect(res?.calmDayLabel).toBe('Sun');
		expect(res?.calmDayIdx).toBe(6);
	});

	it('suppresses the calm clause when only one day has data (no distinct calm day)', () => {
		const res = selectBestTimeInsight(vm(matrixOf({ 2: { 12: 1.0, 13: 0.2 } })), {
			fullRowLabels: DAYS,
			hourLabel,
		});
		expect(res?.worstDayLabel).toBe('Wed');
		expect(res?.calmDayIdx).toBe(-1);
		expect(res?.calmDayLabel).toBe('');
	});

	it('skips null/NaN cells (no-data never reads as a calm 0)', () => {
		const m = matrixOf({ 1: { 10: 1.0 } });
		m[5][10] = Number.NaN; // a NaN cell must not become the calmest
		const res = selectBestTimeInsight(vm(m), { fullRowLabels: DAYS, hourLabel });
		expect(res?.worstDayLabel).toBe('Tue');
		// Sat had only a NaN → it has no row mean → cannot be the calm day.
		expect(res?.calmDayLabel).not.toBe('Sat');
	});

	it('returns null for an all-null matrix', () => {
		expect(selectBestTimeInsight(vm(matrixOf({})), { fullRowLabels: DAYS, hourLabel })).toBeNull();
	});
});
