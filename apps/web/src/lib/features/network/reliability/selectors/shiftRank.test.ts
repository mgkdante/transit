import { describe, it, expect } from 'vitest';
import { selectShiftRank } from './shiftRank';
import type { NetworkShift } from '$lib/v1';

const labels = {
	grainLabel: (g: string) => g,
	pctOrNull: (v: number | null) => (v == null ? null : `${v}%`),
	subtitle: (avg: number | null, severe: number | null) => `avg ${avg} · severe ${severe}`,
};

describe('selectShiftRank', () => {
	it('ranks worst-punctuality first (lowest OTP) and leads with the real OTP headline', () => {
		const rows: NetworkShift[] = [
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'pm_peak', otp_pct: 79, avg_delay_min: 2.6, severe_pct: 7.4 },
		];
		const out = selectShiftRank(rows, labels);
		expect(out.map((r) => r.key)).toEqual(['pm_peak', 'am_peak']);
		expect(out[0].display).toBe('79%');
		// The severe share is the ABSOLUTE magnitude value (never the in-view worst).
		expect(out[0].value).toBe(7.4);
	});

	it('drops a grain carrying NEITHER otp NOR severe (no fabricated 0)', () => {
		const rows: NetworkShift[] = [
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'night', otp_pct: null, avg_delay_min: null, severe_pct: null },
		];
		const out = selectShiftRank(rows, labels);
		expect(out.map((r) => r.key)).toEqual(['am_peak']);
	});

	it('keeps a null-OTP grain with a real severe share, ordered AFTER OTP-known grains, headline NULL', () => {
		const rows: NetworkShift[] = [
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'midday', otp_pct: null, avg_delay_min: 2.0, severe_pct: 9.0 },
		];
		const out = selectShiftRank(rows, labels);
		expect(out.map((r) => r.key)).toEqual(['am_peak', 'midday']);
		// The OTP-unknown grain's headline is NULL (renders the styled chip), never a fake 0%.
		expect(out[1].display).toBeNull();
		expect(out[1].value).toBe(9.0);
	});

	it('stands down on null / empty', () => {
		expect(selectShiftRank(null, labels)).toEqual([]);
		expect(selectShiftRank([], labels)).toEqual([]);
	});
});
