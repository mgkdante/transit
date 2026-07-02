import { describe, it, expect } from 'vitest';
import { selectWeekdaySeasonality, MIN_WEEKDAY_SEVERE_OBSERVATIONS } from './weekdaySeasonality';
import { DELAY_DOW_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { RouteDayOfWeek } from '$lib/v1/schemas';

const labels = {
	severeShare: 'Severe',
	avgDelay: 'Avg delay',
	weekdayLabel: (iso: number) => `D${iso}`,
};

describe('selectWeekdaySeasonality', () => {
	it('ranks worst-first by mean delay on the FIXED DELAY_DOW_DOMAIN', () => {
		const dow: RouteDayOfWeek[] = [
			{ day_of_week_iso: 1, avg_delay_min: 2.0, severe_pct: 8, observation_count: 20 },
			{ day_of_week_iso: 5, avg_delay_min: 6.5, severe_pct: 12, observation_count: 30 },
		];
		const rows = selectWeekdaySeasonality(dow, labels);
		expect(rows.map((r) => r.key)).toEqual([5, 1]);
		expect(rows[0].domain).toEqual(DELAY_DOW_DOMAIN);
		expect(rows[0].severity).toBe('high'); // 6.5 >= 5
	});

	it('shows the severe share ONLY when enough observations back it', () => {
		const dow: RouteDayOfWeek[] = [
			{
				day_of_week_iso: 1,
				avg_delay_min: 3.0,
				severe_pct: 20,
				observation_count: MIN_WEEKDAY_SEVERE_OBSERVATIONS,
			},
			{ day_of_week_iso: 2, avg_delay_min: 3.0, severe_pct: 20, observation_count: 2 },
		];
		const rows = selectWeekdaySeasonality(dow, labels);
		const d1 = rows.find((r) => r.key === 1)!;
		const d2 = rows.find((r) => r.key === 2)!;
		expect(d1.subtitle).toContain('20.0%'); // trusted severe share
		expect(d2.subtitle).toBe('Avg delay'); // thin sample → plain caption
	});

	it('DROPS null-avg weekdays (no fabricated 0-delay bar)', () => {
		const rows = selectWeekdaySeasonality(
			[{ day_of_week_iso: 3, avg_delay_min: null, severe_pct: 5 }],
			labels,
		);
		expect(rows).toEqual([]);
	});

	it('is honest on null/empty input', () => {
		expect(selectWeekdaySeasonality(null, labels)).toEqual([]);
	});
});
