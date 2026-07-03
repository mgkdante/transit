import { describe, it, expect } from 'vitest';
import { selectHabitsHeatmap, selectHabitsHeatmapSpec } from './habitsHeatmap';

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

describe('selectHabitsHeatmapSpec (P5.2)', () => {
	const opts = {
		title: 'Severe-delay heatmap by day and hour',
		valueLabel: 'Severe delays',
		rowAxisLabel: 'Day',
		colAxisLabel: 'Hour',
		rowLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
		fullRowLabels: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
		tierLabels: ['Low', 'Low', 'Medium', 'High'],
		noDataLabel: 'No data',
		worstGlyph: '◆',
		hourLabel: (h: number) => `${String(h).padStart(2, '0')}:00`,
		hourTicks: [0, 6, 12, 18],
	} as const;

	it('emits an ABSOLUTE [0,1] classed-tier heatmap (never row-relative — the S7 P4 ruling)', () => {
		const vm = selectHabitsHeatmap([[0.2, null, 1.0]]);
		const spec = selectHabitsHeatmapSpec(vm, 'en', opts);
		expect(spec.kind).toBe('heatmap');
		expect(spec.mode).toBe('absolute');
		expect(spec.domain).toEqual([0, 1]);
		expect(spec.tiers?.tierLabels).toHaveLength(4);
		// Cells pad to 24 columns; a null cell is a typed absence, never a 0.
		expect(spec.cells[0]).toHaveLength(24);
		expect(spec.cells[0][0]).toEqual({ value: 0.2 });
		expect(spec.cells[0][1]).toEqual({ value: null, absentReason: 'no-observations' });
	});

	it('carries sparse hour ticks with formatted labels', () => {
		const vm = selectHabitsHeatmap([[0.5]]);
		const spec = selectHabitsHeatmapSpec(vm, 'en', opts);
		expect(spec.colTicks).toEqual([
			{ index: 0, label: '00:00' },
			{ index: 6, label: '06:00' },
			{ index: 12, label: '12:00' },
			{ index: 18, label: '18:00' },
		]);
	});
});
