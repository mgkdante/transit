import { describe, it, expect } from 'vitest';
import { selectHabitsHeatmap, type HabitsHeatmapOpts } from './habitsHeatmap';
import type { HabitsVM } from '../clusters';

const OPTS: HabitsHeatmapOpts = {
	title: 'Repeat-problem heatmap by day and hour',
	valueLabel: 'Repeat problems',
	rowAxisLabel: 'Day of week',
	colAxisLabel: 'Hour of day',
	rowLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
	fullRowLabels: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
	tierLabels: ['Rarely late', 'Sometimes late', 'Often late', 'Very unreliable'],
	noDataLabel: 'No data',
	worstGlyph: '◆',
	hourLabel: (h) => `${String(h).padStart(2, '0')}:00`,
	hourTicks: [0, 6, 12, 18],
};

/** A 7×24 matrix with one real value + one null in row 0, the rest 0. */
function makeMatrix(): (number | null)[][] {
	const m: (number | null)[][] = Array.from({ length: 7 }, () => Array<number | null>(24).fill(0));
	m[0][8] = 1; // Monday 08:00 = the route's worst hour
	m[0][3] = null; // Monday 03:00 = no data
	return m;
}

const vm = (matrix: (number | null)[][], isEmpty = false): HabitsVM => ({
	scale: 'repeat_problem_relative',
	matrix,
	isEmpty,
});

describe('selectHabitsHeatmap', () => {
	it('builds an absolute heatmap spec on the fixed [0,1] domain', () => {
		const s = selectHabitsHeatmap(vm(makeMatrix()), 'en', OPTS);
		expect(s.kind).toBe('heatmap');
		expect(s.mode).toBe('absolute');
		expect(s.domain).toEqual([0, 1]);
		expect(s.rowLabels).toHaveLength(7);
		expect(s.colLabels).toHaveLength(24);
		expect(s.cells).toHaveLength(7);
		expect(s.cells[0]).toHaveLength(24);
	});

	it('keeps a null cell honestly absent (never coerced to 0)', () => {
		const s = selectHabitsHeatmap(vm(makeMatrix()), 'en', OPTS);
		expect(s.cells[0][3].value).toBeNull();
		expect(s.cells[0][3].absentReason).toBe('no-observations');
		expect(s.cells[0][8].value).toBe(1);
		expect(s.cells[0][8].absentReason).toBeUndefined();
	});

	it('carries the classed-tier legend + the worst glyph', () => {
		const s = selectHabitsHeatmap(vm(makeMatrix()), 'en', OPTS);
		expect(s.tiers?.tierLabels).toEqual([
			'Rarely late',
			'Sometimes late',
			'Often late',
			'Very unreliable',
		]);
		expect(s.tiers?.noDataLabel).toBe('No data');
		expect(s.tiers?.worstGlyph).toBe('◆');
	});

	it('formats hour labels + a sparse clock-tick subset for the column axis', () => {
		const s = selectHabitsHeatmap(vm(makeMatrix()), 'en', OPTS);
		expect(s.colLabels[8]).toBe('08:00');
		expect(s.colTicks).toEqual([
			{ index: 0, label: '00:00' },
			{ index: 6, label: '06:00' },
			{ index: 12, label: '12:00' },
			{ index: 18, label: '18:00' },
		]);
	});

	it('pads short rows to 24 columns of honest no-data', () => {
		const short: (number | null)[][] = [[0.5]]; // 1 row, 1 col
		const s = selectHabitsHeatmap(vm(short), 'en', OPTS);
		// row 0 has 24 cols; the missing ones are null (no data)
		expect(s.cells[0]).toHaveLength(24);
		expect(s.cells[0][5].value).toBeNull();
	});
});
