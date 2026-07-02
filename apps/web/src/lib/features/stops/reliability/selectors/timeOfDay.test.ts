import { describe, it, expect } from 'vitest';
import { selectTimeOfDay } from './timeOfDay';
import { SEVERE_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { StopReliabilityPeriod } from '$lib/v1/schemas';

const labels = {
	shiftLabel: (g: string) => `S:${g}`,
	dayTypeLabel: (g: string) => `T:${g}`,
};

describe('selectTimeOfDay', () => {
	it('partitions shift + day-type grains (calendar grains stay OUT) and ranks by severe share', () => {
		const periods: StopReliabilityPeriod[] = [
			{ grain: 'day', p50_min: 2, p90_min: 5 }, // calendar → excluded
			{ grain: 'am_peak', severe_pct: 8 },
			{ grain: 'pm_peak', severe_pct: 14 },
			{ grain: 'weekday', severe_pct: 10 },
			{ grain: 'weekend', severe_pct: 4 },
		];
		const vm = selectTimeOfDay(periods, labels);
		expect(vm.shiftRows.map((r) => r.key)).toEqual(['pm_peak', 'am_peak']); // worst severe first
		expect(vm.shiftRows[0].domain).toEqual(SEVERE_DOMAIN);
		expect(vm.dayTypeRows.map((r) => r.key)).toEqual(['weekday', 'weekend']);
		expect(vm.hasTimeOfDay).toBe(true);
	});

	it('DROPS a period with a null severe share (no fake-0 ranking)', () => {
		const vm = selectTimeOfDay(
			[
				{ grain: 'am_peak', severe_pct: null, avg_delay_min: 3 },
				{ grain: 'pm_peak', severe_pct: 9 },
			],
			labels,
		);
		expect(vm.shiftRows.map((r) => r.key)).toEqual(['pm_peak']);
	});

	it('stands down (hasTimeOfDay=false) when no shift/day-type grain carries a severe share', () => {
		const vm = selectTimeOfDay([{ grain: 'week', otp_pct: 80 }], labels);
		expect(vm.hasTimeOfDay).toBe(false);
		expect(vm.shiftRows).toEqual([]);
		expect(vm.dayTypeRows).toEqual([]);
	});
});
