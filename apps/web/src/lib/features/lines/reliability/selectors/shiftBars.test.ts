import { describe, it, expect } from 'vitest';
import { selectShiftBars, type ShiftBarDatum } from './shiftBars';

const rows: ShiftBarDatum[] = [
	{ key: 'am', label: 'AM peak', value: 1.2, severity: 'high' },
	{ key: 'mid', label: 'Midday', value: null, severity: 'watch' },
	{ key: 'pm', label: 'PM peak', value: 0.4, severity: 'watch', note: '28% bunched' },
];

const opts = {
	title: 'Spread',
	rowLabel: 'Shift',
	xLabel: 'Spread',
	unit: '',
	domain: [0, 1.2] as const,
	noDataMarker: 'no data',
};

describe('selectShiftBars', () => {
	it('builds a magnitude-bars spec in GIVEN shift order (never re-sorted)', () => {
		const s = selectShiftBars(rows, 'en', opts);
		expect(s.kind).toBe('magnitude-bars');
		if (s.kind !== 'magnitude-bars') return;
		expect(s.sort).toBe('given');
		expect(s.scale).toBe('severity');
		expect(s.domain).toEqual([0, 1.2]);
		expect(s.rows.map((r) => r.key)).toEqual(['am', 'mid', 'pm']);
		expect(s.rowLabel).toBe('Shift');
	});

	it('keeps a null reading honestly absent (labelled, no fake-0 bar)', () => {
		const s = selectShiftBars(rows, 'en', opts);
		if (s.kind !== 'magnitude-bars') throw new Error('expected bars');
		const mid = s.rows.find((r) => r.key === 'mid')!;
		expect(mid.value).toBeNull();
		expect(mid.label).toBe('Midday · no data');
		expect(mid.absentReason).toBe('no-observations');
		// a real value keeps its bare label + carries its note
		const pm = s.rows.find((r) => r.key === 'pm')!;
		expect(pm.label).toBe('PM peak');
		expect(pm.note).toBe('28% bunched');
	});

	it('returns an absence spec when no shift carries a reading', () => {
		const s = selectShiftBars(
			[{ key: 'am', label: 'AM peak', value: null, severity: 'watch' }],
			'en',
			opts,
		);
		expect(s.kind).toBe('absence');
	});
});
