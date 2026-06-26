import { describe, expect, it } from 'vitest';
import { selectPunctualityTimeOfDay, type TimeOfDayLabels } from './punctualityTimeOfDay';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import type { PunctualityVM } from '../clusters';

const labels: TimeOfDayLabels = {
	title: 'Severe by time of day',
	unit: '%',
	shiftLabel: (g) => g.toUpperCase(),
};

function vmWith(byShift: { grain: string; severePct: number | null }[]): PunctualityVM {
	return {
		headline: {
			otpPct: null,
			avgDelayMin: null,
			p50Min: null,
			p90Min: null,
			severePct: null,
			delayHistogram: null,
		},
		trend: [],
		dayOfWeek: [],
		weakStops: [],
		peakOffPeak: { byShift, byDayType: [] },
		byShiftDaytype: [],
		isEmpty: false,
	} as unknown as PunctualityVM;
}

describe('selectPunctualityTimeOfDay — the §01 time-of-day dot-strip', () => {
	it('orders shifts am→night, bands severity, the fixed SEVERE_DOMAIN + the all-day mean', () => {
		const spec = selectPunctualityTimeOfDay(
			vmWith([
				{ grain: 'pm_peak', severePct: 12 },
				{ grain: 'am_peak', severePct: 4 },
				{ grain: 'midday', severePct: 8 },
			]),
			'en',
			labels,
		);
		expect(spec.kind).toBe('dot-strip');
		if (spec.kind !== 'dot-strip') return;
		expect(spec.domain).toBe(SEVERE_DOMAIN);
		expect(spec.points.map((p) => p.key)).toEqual(['am_peak', 'midday', 'pm_peak']);
		// severeShareToSeverity: >=10 critical, >=5 high, else watch.
		expect(spec.points.map((p) => p.severity)).toEqual(['watch', 'high', 'critical']);
		expect(spec.medianRef).toBeCloseTo((4 + 8 + 12) / 3, 5);
	});

	it('keeps null-severe shifts as honest gaps but stays a dot-strip while one is real', () => {
		const spec = selectPunctualityTimeOfDay(
			vmWith([
				{ grain: 'am_peak', severePct: 6 },
				{ grain: 'night', severePct: null },
			]),
			'en',
			labels,
		);
		expect(spec.kind).toBe('dot-strip');
		if (spec.kind !== 'dot-strip') return;
		expect(spec.points.length).toBe(2);
		expect(spec.points.find((p) => p.key === 'night')?.value).toBeNull();
	});

	it('no shift carries a real severe share → honest absence', () => {
		const spec = selectPunctualityTimeOfDay(
			vmWith([{ grain: 'am_peak', severePct: null }]),
			'en',
			labels,
		);
		expect(spec.kind).toBe('absence');
	});
});
