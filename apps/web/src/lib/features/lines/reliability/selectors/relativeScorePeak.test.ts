import { describe, it, expect } from 'vitest';
import { selectRelativeScorePeak } from './relativeScorePeak';
import { habitsBandCopy } from '../Cluster05Habits.copy';
import type { HabitsVM } from '../clusters';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const opts = {
	fullRowLabels: DAYS,
	hourLabel: (hour: number) => `${String(hour).padStart(2, '0')}:00`,
};

function matrixOf(spec: Record<number, Record<number, number>>): (number | null)[][] {
	return Array.from({ length: 7 }, (_, day) =>
		Array.from({ length: 24 }, (_, hour) => spec[day]?.[hour] ?? null),
	);
}
const vm = (matrix: (number | null)[][]): HabitsVM => ({
	scale: 'repeat_problem_relative',
	matrix,
	isEmpty: false,
});

describe('selectRelativeScorePeak', () => {
	it('names an observed maximum without inventing a best weekday from unequal coverage', () => {
		const matrix = matrixOf({ 4: { 17: 1, 18: 0.3 }, 0: { 8: 0.2 } });
		expect(selectRelativeScorePeak(vm(matrix), opts)).toEqual({
			dayLabel: 'Fri',
			hourLabel: '17:00',
		});
	});

	it('retains a real zero when comparing hours within one observed day', () => {
		const matrix = matrixOf({ 2: { 12: 1, 13: 0 } });
		expect(selectRelativeScorePeak(vm(matrix), opts)).toEqual({
			dayLabel: 'Wed',
			hourLabel: '12:00',
		});
	});

	it.each([
		['absent', matrixOf({})],
		['all zero', matrixOf({ 0: { 8: 0 }, 1: { 8: 0 } })],
		['equal positive', matrixOf({ 0: { 8: 1 }, 1: { 8: 1 } })],
		['single observation', matrixOf({ 0: { 8: 1 } })],
		['nonfinite values', matrixOf({ 0: { 8: Number.POSITIVE_INFINITY, 9: Number.NaN } })],
		['invalid negative score', matrixOf({ 0: { 8: -1 }, 1: { 8: 1 } })],
		['invalid score above one', matrixOf({ 0: { 8: 1.1 }, 1: { 8: 1 } })],
	] as const)('omits unsupported contrast from %s', (_label, matrix) => {
		expect(selectRelativeScorePeak(vm(matrix), opts)).toBeNull();
	});

	it('ignores unavailable and invalid cells without turning them into calm zeroes', () => {
		const matrix = matrixOf({ 0: { 8: 0.3 }, 1: { 10: 1 }, 5: { 10: Number.NaN } });
		const before = structuredClone(matrix);
		expect(selectRelativeScorePeak(vm(matrix), opts)).toEqual({
			dayLabel: 'Tue',
			hourLabel: '10:00',
		});
		expect(matrix).toEqual(before);
		expect(matrix[0][0]).toBeNull();
	});

	it('names one tied maximum in stable row/hour order when lower scores also exist', () => {
		const matrix = matrixOf({ 0: { 8: 1, 9: 1 }, 3: { 8: 1, 9: 0.2 } });
		const result = selectRelativeScorePeak(vm(matrix), opts);
		expect(result).toEqual({ dayLabel: 'Mon', hourLabel: '08:00' });
		expect(habitsBandCopy.en.relativePeak(result!.dayLabel, result!.hourLabel)).toBe(
			'An observed peak in this line’s relative score: Mon, 08:00.',
		);
		expect(habitsBandCopy.fr.relativePeak('Lundi', '08:00')).toBe(
			'Un pic observé du score relatif de cette ligne : Lundi, 08:00.',
		);
	});

	it('preserves peak identity when raw scores scale before normalization', () => {
		const raw = matrixOf({ 0: { 8: 80, 9: 10 }, 3: { 8: 40, 9: 40 }, 6: { 8: 20, 9: 20 } });
		const results = [0.01, 1, 1000].map((factor) => {
			const scaled = raw.map((row) => row.map((value) => (value == null ? null : value * factor)));
			const maximum = Math.max(...scaled.flat().filter((value): value is number => value != null));
			const normalized = scaled.map((row) =>
				row.map((value) => (value == null ? null : value / maximum)),
			);
			return selectRelativeScorePeak(vm(normalized), opts);
		});
		for (const result of results) expect(result).toEqual({ dayLabel: 'Mon', hourLabel: '08:00' });
	});
});
