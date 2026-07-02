import { describe, it, expect } from 'vitest';
import { selectCompleteness } from './completeness';
import type { TrendPoint } from '$lib/v1';

const pt = (date: string, rate: number | null): TrendPoint => ({
	date,
	otp_pct: 88,
	avg_delay_min: 1.1,
	service_completeness_rate: rate,
});

describe('selectCompleteness', () => {
	it('stands DOWN when every point rate is null (today prod ramp-in reality)', () => {
		const vm = selectCompleteness([pt('2026-06-01', null), pt('2026-06-08', null)]);
		expect(vm.hasData).toBe(false);
		expect(vm.latest).toBeNull();
	});

	it('stands UP and reports the LATEST non-null rate', () => {
		const vm = selectCompleteness([pt('2026-06-01', 91), pt('2026-06-08', 94.2)]);
		expect(vm.hasData).toBe(true);
		expect(vm.latest).toBe(94.2);
	});

	it('reads the freshest served rate when only recent buckets carry a value', () => {
		const vm = selectCompleteness([pt('2026-06-01', null), pt('2026-06-08', 96)]);
		expect(vm.hasData).toBe(true);
		expect(vm.latest).toBe(96);
	});

	it('keeps a real measured 0 as a value (never mistaken for absence)', () => {
		const vm = selectCompleteness([pt('2026-06-08', 0)]);
		expect(vm.hasData).toBe(true);
		expect(vm.latest).toBe(0);
	});

	it('is honest-absent on an empty series', () => {
		expect(selectCompleteness([])).toEqual({ hasData: false, latest: null });
	});
});
