import { describe, expect, it } from 'vitest';
import {
	SHIFT_GRAIN_ORDER,
	DAY_TYPE_GRAIN_ORDER,
	SHIFT_GRAINS,
	DAY_TYPE_GRAINS,
	isShiftGrain,
	isDayTypeGrain,
	shiftLabel,
	dayTypeLabel,
} from './shiftGrains';

describe('shiftGrains — membership predicates', () => {
	it('isShiftGrain is true for every canonical shift token', () => {
		for (const g of SHIFT_GRAIN_ORDER) expect(isShiftGrain(g)).toBe(true);
		// The membership set mirrors the order array exactly.
		expect([...SHIFT_GRAINS].sort()).toEqual([...SHIFT_GRAIN_ORDER].sort());
	});

	it('isShiftGrain is false for calendar grains and junk', () => {
		for (const g of ['day', 'week', 'month', 'weekday', 'weekend', '', 'AM peak', 'foo']) {
			expect(isShiftGrain(g)).toBe(false);
		}
	});

	it('isDayTypeGrain is true for every canonical day-type token', () => {
		for (const g of DAY_TYPE_GRAIN_ORDER) expect(isDayTypeGrain(g)).toBe(true);
		expect([...DAY_TYPE_GRAINS].sort()).toEqual([...DAY_TYPE_GRAIN_ORDER].sort());
	});

	it('isDayTypeGrain is false for calendar grains, shift tokens, and junk', () => {
		for (const g of ['day', 'week', 'month', 'am_peak', 'night', '', 'Weekday', 'bar']) {
			expect(isDayTypeGrain(g)).toBe(false);
		}
	});
});

describe('shiftGrains — canonical order arrays', () => {
	it('shift grains read AM → night in chronological order', () => {
		expect(SHIFT_GRAIN_ORDER).toEqual(['am_peak', 'midday', 'pm_peak', 'evening', 'night']);
	});

	it('day-type grains read weekday before weekend', () => {
		expect(DAY_TYPE_GRAIN_ORDER).toEqual(['weekday', 'weekend']);
	});
});

describe('shiftGrains — localized labels', () => {
	it('resolves each shift token to its EN + FR label', () => {
		expect(shiftLabel('am_peak', 'en')).toBe('AM peak');
		expect(shiftLabel('am_peak', 'fr')).toBe('Pointe AM');
		expect(shiftLabel('midday', 'en')).toBe('Midday');
		expect(shiftLabel('midday', 'fr')).toBe('Journée');
		expect(shiftLabel('pm_peak', 'en')).toBe('PM peak');
		expect(shiftLabel('pm_peak', 'fr')).toBe('Pointe PM');
		expect(shiftLabel('evening', 'en')).toBe('Evening');
		expect(shiftLabel('evening', 'fr')).toBe('Soirée');
		expect(shiftLabel('night', 'en')).toBe('Night');
		expect(shiftLabel('night', 'fr')).toBe('Nuit');
	});

	it('resolves each day-type token to its EN + FR label', () => {
		expect(dayTypeLabel('weekday', 'en')).toBe('Weekday');
		expect(dayTypeLabel('weekday', 'fr')).toBe('Semaine');
		expect(dayTypeLabel('weekend', 'en')).toBe('Weekend');
		expect(dayTypeLabel('weekend', 'fr')).toBe('Fin de semaine');
	});

	it('falls back to the raw token for an unknown grain (no fabricated label)', () => {
		expect(shiftLabel('day', 'en')).toBe('day');
		expect(shiftLabel('weekday', 'en')).toBe('weekday'); // a day-type token is not a shift token
		expect(shiftLabel('mystery', 'fr')).toBe('mystery');
		expect(dayTypeLabel('month', 'fr')).toBe('month');
		expect(dayTypeLabel('am_peak', 'en')).toBe('am_peak'); // a shift token is not a day-type token
		expect(dayTypeLabel('junk', 'en')).toBe('junk');
	});
});
