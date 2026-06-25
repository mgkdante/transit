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
	covToSeverity,
	DELAY_STOP_DOMAIN,
	DELAY_POS_DOMAIN,
	DELAY_DOW_DOMAIN,
	SEVERE_DOMAIN,
	OTP_DOMAIN,
	HEADWAY_DOMAIN,
	BUNCHED_DOMAIN,
	COV_DOMAIN,
} from './shiftGrains';

describe('S7 reliability chart domains — fixed, absolute, stable', () => {
	const all = [
		DELAY_STOP_DOMAIN,
		DELAY_POS_DOMAIN,
		DELAY_DOW_DOMAIN,
		SEVERE_DOMAIN,
		OTP_DOMAIN,
		HEADWAY_DOMAIN,
		BUNCHED_DOMAIN,
		COV_DOMAIN,
	];
	it('are [min,max] literals with min < max', () => {
		for (const d of all) {
			expect(d).toHaveLength(2);
			expect(d[0]).toBeLessThan(d[1]);
		}
	});
	it('lock the exact real-units domains the audit specified', () => {
		expect(DELAY_STOP_DOMAIN).toEqual([-2, 8]); // signed: early stops left of zero
		expect(DELAY_POS_DOMAIN).toEqual([0, 8]);
		expect(DELAY_DOW_DOMAIN).toEqual([0, 6]);
		// Severe share is a % of ALL arrivals → the FULL [0,100] scale (like OTP), so a 7%
		// share reads as 7%, not the ~20% a zoomed [0,35] domain exaggerated it to.
		expect(SEVERE_DOMAIN).toEqual([0, 100]);
		expect(OTP_DOMAIN).toEqual([0, 100]);
		expect(HEADWAY_DOMAIN).toEqual([0, 35]);
		expect(BUNCHED_DOMAIN).toEqual([0, 30]);
		expect(COV_DOMAIN).toEqual([0, 1.2]);
	});
});

describe('covToSeverity (S7)', () => {
	it('bands a CoV ratio onto severity (>=0.5 critical, >=0.3 high, else watch)', () => {
		expect(covToSeverity(0.5)).toBe('critical');
		expect(covToSeverity(0.3)).toBe('high');
		expect(covToSeverity(0.29)).toBe('watch');
		expect(covToSeverity(null)).toBe('watch');
		expect(covToSeverity(undefined)).toBe('watch');
	});
});

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
