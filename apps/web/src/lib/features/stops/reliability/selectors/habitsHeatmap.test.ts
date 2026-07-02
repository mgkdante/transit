import { describe, it, expect } from 'vitest';
import { selectHabitsHeatmap, habitsCellText } from './habitsHeatmap';

const words = { low: 'Low', medium: 'Medium', high: 'High', noData: 'No data' };

describe('selectHabitsHeatmap', () => {
	it('reports hasHabits=true when any cell carries a real value', () => {
		const vm = selectHabitsHeatmap([
			[null, 0.5],
			[null, null],
		]);
		expect(vm.hasHabits).toBe(true);
		expect(vm.matrix).toHaveLength(2);
	});

	it('stands the section down (hasHabits=false) when every cell is null', () => {
		expect(selectHabitsHeatmap([[null, null]]).hasHabits).toBe(false);
	});

	it('is honest absence on a null/empty matrix', () => {
		expect(selectHabitsHeatmap(null).hasHabits).toBe(false);
		expect(selectHabitsHeatmap([]).hasHabits).toBe(false);
	});
});

describe('habitsCellText', () => {
	it('buckets a normalised value on the same [0,1] ramp the colour uses', () => {
		expect(habitsCellText(0.05, 0.0, words)).toBe('Low');
		expect(habitsCellText(0.5, 0.5, words)).toBe('Medium');
		expect(habitsCellText(0.95, 1.0, words)).toBe('High');
	});

	it('returns the noData word when the cell or its norm is absent', () => {
		expect(habitsCellText(null, 0.5, words)).toBe('No data');
		expect(habitsCellText(0.5, null, words)).toBe('No data');
	});
});
