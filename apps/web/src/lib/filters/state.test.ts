// state.test.ts — the DateWindow shape helpers: the ISO shape gate + the {from,to}
// normalization the codec relies on. A window is present ONLY as a complete, valid,
// from<=to span; anything less is honest-absence (undefined).

import { describe, it, expect } from 'vitest';
import {
	isIsoDate,
	normalizeWindow,
	isWorstN,
	normalizeWorstN,
	WORST_N_LADDER,
	cloneFilterState,
	isEmptyFilterState,
	emptyFilterState,
	isAlertAffects,
	isSeverityCode,
	normalizeAlertAffects,
	normalizeSeverity,
} from './state';

describe('isIsoDate — the YYYY-MM-DD shape gate', () => {
	it('accepts a well-formed YYYY-MM-DD string only', () => {
		expect(isIsoDate('2026-06-18')).toBe(true);
		expect(isIsoDate('2026-6-1')).toBe(false); // not zero-padded
		expect(isIsoDate('2026/06/18')).toBe(false);
		expect(isIsoDate('not-a-date')).toBe(false);
		expect(isIsoDate('')).toBe(false);
		expect(isIsoDate(null)).toBe(false);
		expect(isIsoDate(undefined)).toBe(false);
	});
});

describe('normalizeWindow — a complete, valid, from<=to span or nothing', () => {
	it('builds a window from two valid, ordered bounds', () => {
		expect(normalizeWindow('2026-06-01', '2026-06-14')).toEqual({
			from: '2026-06-01',
			to: '2026-06-14',
		});
	});

	it('treats a single day (from==to) as a valid one-day window', () => {
		expect(normalizeWindow('2026-06-14', '2026-06-14')).toEqual({
			from: '2026-06-14',
			to: '2026-06-14',
		});
	});

	it('swaps an inverted from>to so the stored window reads from<=to', () => {
		expect(normalizeWindow('2026-06-14', '2026-06-01')).toEqual({
			from: '2026-06-01',
			to: '2026-06-14',
		});
	});

	it('drops a HALF window (one bound missing) — a half window is no window', () => {
		expect(normalizeWindow('2026-06-01', undefined)).toBeUndefined();
		expect(normalizeWindow(null, '2026-06-14')).toBeUndefined();
		expect(normalizeWindow('2026-06-01', '')).toBeUndefined();
	});

	it('drops a MALFORMED bound — never fabricates a span from junk', () => {
		expect(normalizeWindow('yesterday', '2026-06-14')).toBeUndefined();
		expect(normalizeWindow('2026-6-1', '2026-06-14')).toBeUndefined();
	});
});

describe('worst-N (S12 ladder cap) — a fixed truthful rung or "all"', () => {
	it('accepts every ladder rung + the uncapped "all"', () => {
		for (const rung of WORST_N_LADDER) expect(isWorstN(rung)).toBe(true);
		expect(isWorstN('all')).toBe(true);
	});

	it('rejects an off-ladder integer and any junk (never an arbitrary cap)', () => {
		expect(isWorstN('7')).toBe(false);
		expect(isWorstN('0')).toBe(false);
		expect(isWorstN('1000')).toBe(false);
		// FIX-3: '100' was trimmed (a dead rung above the per-kind DB cap of 50) — it now
		// self-heals like any off-ladder value, so a stale ?n=100 deep link drops to default.
		expect(isWorstN('100')).toBe(false);
		expect(isWorstN('none')).toBe(false);
	});

	it('normalizeWorstN trims a valid rung and drops junk / nullish to undefined', () => {
		expect(normalizeWorstN(' 20 ')).toBe('20');
		expect(normalizeWorstN('all')).toBe('all');
		expect(normalizeWorstN('7')).toBeUndefined();
		expect(normalizeWorstN(null)).toBeUndefined();
		expect(normalizeWorstN(undefined)).toBeUndefined();
	});
});
describe('FilterState.date (S13)', () => {
	it('clone copies date', () => {
		const st = emptyFilterState();
		st.date = '2026-07-01';
		const copy = cloneFilterState(st);
		expect(copy.date).toBe('2026-07-01');
	});

	it('isEmpty is false when only date is set', () => {
		const st = emptyFilterState();
		st.date = '2026-07-01';
		expect(isEmptyFilterState(st)).toBe(false);
	});
});

describe('alerts axes (S15) — affects + severity single-select scalars', () => {
	it('isAlertAffects accepts lines|stops and rejects junk', () => {
		expect(isAlertAffects('lines')).toBe(true);
		expect(isAlertAffects('stops')).toBe(true);
		expect(isAlertAffects('all')).toBe(false);
		expect(isAlertAffects('bogus')).toBe(false);
	});

	it('isSeverityCode accepts the closed enum and rejects junk', () => {
		expect(isSeverityCode('critical')).toBe(true);
		expect(isSeverityCode('high')).toBe(true);
		expect(isSeverityCode('watch')).toBe(true);
		expect(isSeverityCode('apocalyptic')).toBe(false);
	});

	it('normalizers trim a valid value and self-heal junk / nullish to undefined', () => {
		expect(normalizeAlertAffects(' lines ')).toBe('lines');
		expect(normalizeAlertAffects('bogus')).toBeUndefined();
		expect(normalizeAlertAffects(null)).toBeUndefined();
		expect(normalizeSeverity(' watch ')).toBe('watch');
		expect(normalizeSeverity('kinda')).toBeUndefined();
		expect(normalizeSeverity(undefined)).toBeUndefined();
	});

	it('clone copies both axes; isEmpty is false when only one is set', () => {
		const st = emptyFilterState();
		st.alertAffects = 'stops';
		st.alertSeverity = 'high';
		const copy = cloneFilterState(st);
		expect(copy.alertAffects).toBe('stops');
		expect(copy.alertSeverity).toBe('high');
		const only = emptyFilterState();
		only.alertAffects = 'lines';
		expect(isEmptyFilterState(only)).toBe(false);
	});
});
