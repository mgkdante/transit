import { describe, it, expect } from 'vitest';
import { selectWeekdayCycle, type WeekdayCycleLabels } from './weekdayCycle';
import { DELAY_DOW_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { RouteDayOfWeek } from '$lib/v1';

const WK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const labels: WeekdayCycleLabels = {
	title: 'Weekday cycle',
	yLabel: 'Avg delay',
	unit: ' min',
	weekdayShort: (iso) => WK[iso - 1],
};

describe('selectWeekdayCycle', () => {
	it('emits ONE line over the fixed Mon→Sun cycle on DELAY_DOW_DOMAIN, gapping omitted days', () => {
		const dow: RouteDayOfWeek[] = [
			{ day_of_week_iso: 1, avg_delay_min: 2.1 },
			{ day_of_week_iso: 3, avg_delay_min: 3.4 },
			{ day_of_week_iso: 5, avg_delay_min: null }, // present-but-null → gap
		];
		const { spec, hasData } = selectWeekdayCycle(dow, 'en', labels);
		expect(hasData).toBe(true);
		if (spec.kind !== 'line') throw new Error('expected line');
		expect(spec.domain).toEqual(DELAY_DOW_DOMAIN);
		expect(spec.domain[0]).toBe(0); // zero-based
		expect(spec.xLabels).toEqual(WK); // fixed cycle order, never sorted by value
		expect(spec.series).toHaveLength(1);
		expect(spec.series[0].points).toEqual([2.1, null, 3.4, null, null, null, null]);
	});

	it('returns honest absence when no weekday has a mean delay', () => {
		const { spec, hasData } = selectWeekdayCycle(
			[{ day_of_week_iso: 1, avg_delay_min: null }],
			'en',
			labels,
		);
		expect(hasData).toBe(false);
		expect(spec.kind).toBe('absence');
	});
});
