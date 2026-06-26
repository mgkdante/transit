import { describe, expect, it } from 'vitest';
import {
	selectPunctualityDistribution,
	type PunctualityDistributionLabels,
} from './punctualityDistribution';
import { DELAY_HISTOGRAM_DOMAIN } from '$lib/features/reliability/domains';
import type { PunctualityVM } from '../clusters';

const labels: PunctualityDistributionLabels = { title: 'Delay distribution', unit: ' s' };

function vmWithHistogram(
	delayHistogram: PunctualityVM['headline']['delayHistogram'],
	p50Min: number | null = 1.0,
	p90Min: number | null = 5.0,
): PunctualityVM {
	return {
		headline: { otpPct: 86, avgDelayMin: 1.2, p50Min, p90Min, severePct: 4, delayHistogram },
		trend: [],
		dayOfWeek: [],
		weakStops: [],
		peakOffPeak: { byShift: [], byDayType: [] },
		byShiftDaytype: [],
		isEmpty: false,
	} as unknown as PunctualityVM;
}

const hist = [
	{ lo_sec: -60, hi_sec: -30, count: 3 },
	{ lo_sec: -30, hi_sec: 0, count: 12 },
	{ lo_sec: 0, hi_sec: 30, count: 20 }, // the peak
	{ lo_sec: 30, hi_sec: 60, count: 8 },
	{ lo_sec: 1800, hi_sec: null, count: 1 }, // the [3600+] overflow shape (hi=null)
];

describe('selectPunctualityDistribution — the A1 signed-delay histogram', () => {
	it('maps the contract bins, pins the signed domain + the within-distribution count domain', () => {
		const spec = selectPunctualityDistribution(vmWithHistogram(hist), 'en', labels);
		expect(spec.kind).toBe('histogram');
		if (spec.kind !== 'histogram') return;
		expect(spec.domain).toBe(DELAY_HISTOGRAM_DOMAIN);
		expect(spec.domain[0]).toBeLessThan(0); // straddles 0 (signed)
		expect(spec.domain[1]).toBeGreaterThan(0);
		// countDomain = [0, the distribution's own peak] — readable shape, zero-based.
		expect(spec.countDomain).toEqual([0, 20]);
		expect(spec.bins.map((b) => b.count)).toEqual([3, 12, 20, 8, 1]);
		expect(spec.bins[4].hi).toBeNull(); // the overflow bin keeps hi=null
		// p50/p90 are MINUTES on the headline → SECONDS on the bins' axis.
		expect(spec.medianRef).toBe(60); // 1.0 min → 60 s
		expect(spec.p90Ref).toBe(300); // 5.0 min → 300 s
	});

	it('null delay_histogram (day grain / range) → honest absence, never a fabricated shape', () => {
		const spec = selectPunctualityDistribution(vmWithHistogram(null), 'en', labels);
		expect(spec.kind).toBe('absence');
		if (spec.kind !== 'absence') return;
		expect(spec.reason).toBe('no-observations');
	});

	it('an all-zero histogram is absence, not a flat row of zero bars', () => {
		const zero = [
			{ lo_sec: 0, hi_sec: 30, count: 0 },
			{ lo_sec: 30, hi_sec: 60, count: 0 },
		];
		const spec = selectPunctualityDistribution(vmWithHistogram(zero), 'en', labels);
		expect(spec.kind).toBe('absence');
	});
});
