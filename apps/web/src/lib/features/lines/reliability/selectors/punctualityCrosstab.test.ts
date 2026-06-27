import { describe, it, expect } from 'vitest';
import {
	selectPunctualityCrosstab,
	MIN_TRUSTED_OBS,
	type CrosstabLabels,
} from './punctualityCrosstab';
import { OTP_DOMAIN } from '$lib/features/reliability/domains';
import { SHIFT_GRAIN_ORDER } from '$lib/features/reliability/shiftGrains';
import type { CrosstabCell } from '$lib/v1';

const labels: CrosstabLabels = {
	title: 'Shift × day-type OTP',
	xLabel: 'Time of day',
	yLabel: 'On-time %',
	shiftLabel: (s) => s.toUpperCase(),
	weekdayLabel: 'Weekday',
	weekendLabel: 'Weekend',
};

const cell = (
	shift: string,
	day_type: string,
	otp_pct: number | null,
	n: number,
): CrosstabCell => ({
	shift,
	day_type,
	otp_pct,
	observation_count: n,
});

describe('selectPunctualityCrosstab', () => {
	it('emits two series (weekday + weekend) over the shift axis on OTP_DOMAIN', () => {
		const cells = SHIFT_GRAIN_ORDER.flatMap((s) => [
			cell(s, 'weekday', 85, 200),
			cell(s, 'weekend', 92, 120),
		]);
		const { spec, hasData } = selectPunctualityCrosstab(cells, 'en', labels);
		expect(hasData).toBe(true);
		if (spec.kind !== 'line') throw new Error('expected line');
		expect(spec.domain).toEqual(OTP_DOMAIN);
		expect(spec.domain[0]).toBe(0); // zero-based
		expect(spec.xLabels.length).toBe(SHIFT_GRAIN_ORDER.length);
		expect(spec.series.map((s) => s.key)).toEqual(['weekday', 'weekend']);
		// Weekend is dashed (distinguished by pattern, not colour alone).
		expect(spec.series[1].dashed).toBe(true);
		expect(spec.series[0].points.every((p) => p === 85)).toBe(true);
	});

	it('gaps a cell below MIN_TRUSTED_OBS (honest no-data, never a fabricated point)', () => {
		const cells = [
			cell('am_peak', 'weekday', 90, MIN_TRUSTED_OBS), // trusted
			cell('midday', 'weekday', 88, MIN_TRUSTED_OBS - 1), // too few → gap
			cell('pm_peak', 'weekend', 80, 50),
		];
		const { spec } = selectPunctualityCrosstab(cells, 'en', labels);
		if (spec.kind !== 'line') throw new Error('expected line');
		const wk = spec.series.find((s) => s.key === 'weekday');
		const amIdx = SHIFT_GRAIN_ORDER.indexOf('am_peak');
		const midIdx = SHIFT_GRAIN_ORDER.indexOf('midday');
		expect(wk?.points[amIdx]).toBe(90); // trusted
		expect(wk?.points[midIdx]).toBeNull(); // n < MIN_TRUSTED_OBS → gap
	});

	it('returns an honest-absence spec when no cell is trusted', () => {
		const cells = [cell('am_peak', 'weekday', 90, 5), cell('midday', 'weekend', null, 100)];
		const { spec, hasData } = selectPunctualityCrosstab(cells, 'en', labels);
		expect(hasData).toBe(false);
		expect(spec.kind).toBe('absence');
	});
});
