import { describe, it, expect } from 'vitest';
import { selectReceiptTimeOfDay } from './timeOfDay';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';

const labels = { shiftLabel: (s: string) => s };

describe('selectReceiptTimeOfDay', () => {
	it('ranks shifts worst-first by severe share on the FIXED SEVERE_DOMAIN', () => {
		const vm = selectReceiptTimeOfDay(
			[
				{
					shift: 'am_peak',
					severe_pct: 5,
					observation_count: 200,
					severe_count: 10,
					avg_delay_min: 4,
				},
				{
					shift: 'pm_peak',
					severe_pct: 11.1,
					observation_count: 180,
					severe_count: 20,
					avg_delay_min: 8,
				},
			],
			labels,
		);
		expect(vm.hasTimeOfDay).toBe(true);
		expect(vm.rows.map((r) => r.key)).toEqual(['pm_peak', 'am_peak']);
		expect(vm.rows[0].domain).toBe(SEVERE_DOMAIN);
		expect(vm.rows[0].display).toBe('11.1%');
		expect(vm.rows[0].severity).toBe('critical');
	});

	it('secondary-sorts equal shares by canonical shift order', () => {
		const vm = selectReceiptTimeOfDay(
			[
				{
					shift: 'pm_peak',
					severe_pct: 5,
					observation_count: 1,
					severe_count: 0,
					avg_delay_min: 0,
				},
				{
					shift: 'am_peak',
					severe_pct: 5,
					observation_count: 1,
					severe_count: 0,
					avg_delay_min: 0,
				},
			],
			labels,
		);
		expect(vm.rows.map((r) => r.key)).toEqual(['am_peak', 'pm_peak']);
	});

	it('drops a null-share shift (no fabricated-0 ranking)', () => {
		const vm = selectReceiptTimeOfDay(
			[
				{
					shift: 'am_peak',
					severe_pct: null,
					observation_count: 1,
					severe_count: null,
					avg_delay_min: 3,
				},
				{ shift: 'night', severe_pct: 2, observation_count: 1, severe_count: 0, avg_delay_min: 1 },
			],
			labels,
		);
		expect(vm.rows.map((r) => r.key)).toEqual(['night']);
	});

	it('stands down on ramp-in (by_shift absent/empty)', () => {
		expect(selectReceiptTimeOfDay(undefined, labels).hasTimeOfDay).toBe(false);
		expect(selectReceiptTimeOfDay([], labels).hasTimeOfDay).toBe(false);
	});
});
