import { describe, it, expect } from 'vitest';
import { selectGradedPeriods, selectDayPercentiles } from './gradedPeriods';
import type { StopReliabilityPeriod } from '$lib/v1/schemas';

const label = (g: string) => ({ day: 'Day', week: 'Week', month: 'Month' })[g] ?? g;

describe('selectGradedPeriods', () => {
	it('captions the DAY grain "median" (real p50) and week/month "avg" (mean)', () => {
		const periods: StopReliabilityPeriod[] = [
			{ grain: 'day', otp_pct: 82, p50_min: 2.4, p90_min: 11.6 },
			{ grain: 'week', otp_pct: 71, avg_delay_min: 3.3 },
		];
		const day = selectGradedPeriods(periods, 'day', label);
		expect(day).toHaveLength(1);
		expect(day[0].grain).toBe('Day'); // localized, never the raw 'day'
		expect(day[0].delayKind).toBe('median');
		expect(day[0].delayMin).toBe(2.4);

		const week = selectGradedPeriods(periods, 'week', label);
		expect(week[0].delayKind).toBe('avg');
		expect(week[0].delayMin).toBe(3.3);
	});

	it('filters to the selected grain only', () => {
		const rows = selectGradedPeriods(
			[
				{ grain: 'day', p50_min: 1 },
				{ grain: 'week', avg_delay_min: 2 },
			],
			'week',
			label,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].delayMin).toBe(2);
	});
});

describe('selectDayPercentiles', () => {
	it('reads the day period p50/p90 only on the day grain', () => {
		const periods: StopReliabilityPeriod[] = [{ grain: 'day', p50_min: 2.4, p90_min: 11.6 }];
		expect(selectDayPercentiles(periods, 'day')).toEqual({ p50: 2.4, p90: 11.6 });
		expect(selectDayPercentiles(periods, 'week')).toBeNull();
	});

	it('returns null when both percentiles are absent (never a fabricated 0)', () => {
		expect(selectDayPercentiles([{ grain: 'day', otp_pct: 80 }], 'day')).toBeNull();
	});

	it('is null when no day period exists', () => {
		expect(selectDayPercentiles([{ grain: 'week', avg_delay_min: 2 }], 'day')).toBeNull();
		expect(selectDayPercentiles(null, 'day')).toBeNull();
	});
});
