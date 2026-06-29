import { describe, expect, it } from 'vitest';
import { selectPunctualityTimeOfDay, type TimeOfDayLabels } from './punctualityTimeOfDay';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import type { PunctualityVM } from '../clusters';

const labels: TimeOfDayLabels = {
	title: 'Severe by time of day',
	unit: '%',
	shiftLabel: (g) => g.toUpperCase(),
};

function vmWith(
	byShift: { grain: string; severePct: number | null; observationCount?: number | null }[],
): PunctualityVM {
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
		// No observation counts on these rows → the reference falls back to the plain mean.
		expect(spec.medianRef).toBeCloseTo((4 + 8 + 12) / 3, 5);
	});

	it('weights the all-day reference by each shift observation count (H6)', () => {
		// A tiny-n night shift with a high 30% severe rate must NOT drag the reference up the way a
		// plain mean-of-rates would: the line is the true all-day severe-share (Σ severe×obs / Σ obs).
		const spec = selectPunctualityTimeOfDay(
			vmWith([
				{ grain: 'am_peak', severePct: 4, observationCount: 1000 },
				{ grain: 'midday', severePct: 8, observationCount: 200 },
				{ grain: 'pm_peak', severePct: 12, observationCount: 1000 },
				{ grain: 'night', severePct: 30, observationCount: 50 },
			]),
			'en',
			labels,
		);
		if (spec.kind !== 'dot-strip') return;
		// Weighted: (4·1000 + 8·200 + 12·1000 + 30·50) / 2250 = 19100/2250 ≈ 8.49.
		expect(spec.medianRef).toBeCloseTo(19100 / 2250, 5);
		// The naive mean-of-rates would be (4+8+12+30)/4 = 13.5 — the weighted line sits well below it.
		expect(spec.medianRef as number).toBeLessThan(13.5);
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
