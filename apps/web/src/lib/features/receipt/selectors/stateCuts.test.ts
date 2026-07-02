import { describe, it, expect } from 'vitest';
import { selectStateCuts } from './stateCuts';
import { CANCEL_RATE_DOMAIN } from '$lib/features/reliability/domains';

const labels = {
	delivered: 'Delivered',
	cancelled: 'Cancelled',
	silent: 'Silent',
	fmtSharePct: (v: number | null) => (v == null ? null : `${v.toFixed(1)}%`),
};

describe('selectStateCuts', () => {
	it('heroes the completeness number and computes delivered/cancelled/silent shares', () => {
		const vm = selectStateCuts(
			{
				scheduled_trip_days: 100,
				delivered_trip_days: 80,
				cancelled_trip_days: 5,
				silent_trip_days: 15,
				service_completeness_pct: 80,
				not_reported_route_count: 3,
			},
			labels,
		);
		expect(vm.hasData).toBe(true);
		expect(vm.completeness).toBe(80);
		expect(vm.completenessDisplay).toBe('80.0%');
		expect(vm.rows.map((r) => r.key)).toEqual(['delivered', 'cancelled', 'silent']);
		expect(vm.rows[0].value).toBe(80);
		expect(vm.rows[0].domain).toBe(CANCEL_RATE_DOMAIN);
		// A delivered share is the GOOD reading — never a hot severity.
		expect(vm.rows[0].severity).toBe('watch');
		// A 15% silent gap reads critical.
		expect(vm.rows[2].severity).toBe('critical');
	});

	it('stands down on ramp-in (service_states absent → no fabricated 0)', () => {
		const vm = selectStateCuts(undefined, labels);
		expect(vm.hasData).toBe(false);
		expect(vm.completeness).toBeNull();
		expect(vm.rows.every((r) => r.value === null)).toBe(true);
	});

	it('null shares when the scheduled denominator is absent, but heroes a real completeness', () => {
		const vm = selectStateCuts(
			{
				scheduled_trip_days: null,
				delivered_trip_days: null,
				cancelled_trip_days: 2,
				service_completeness_pct: 91,
				not_reported_route_count: null,
			},
			labels,
		);
		expect(vm.hasData).toBe(true); // real completeness alone stands it up
		expect(vm.completeness).toBe(91);
		expect(vm.rows.every((r) => r.value === null)).toBe(true);
	});
});
