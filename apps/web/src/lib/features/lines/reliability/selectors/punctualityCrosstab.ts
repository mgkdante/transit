// selectPunctualityCrosstab — the §01 shift × day-type OTP crosstab, as TWO LINES.
//
// The old stepped-heatmap grid becomes the cohesive line language: weekday vs weekend
// on-time % across the day's shifts (am_peak→night) on the fixed OTP_DOMAIN. A cell with
// fewer than MIN_TRUSTED_OBS observations (or a null OTP) is an honest GAP in its line,
// never a fabricated point. Honest absence when neither line has a trusted reading.

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, LineSpec, LineSeries } from '$lib/components/dataviz/chart';
import { OTP_DOMAIN } from '$lib/features/reliability/domains';
import { SHIFT_GRAIN_ORDER } from '$lib/features/reliability/shiftGrains';
import type { CrosstabCell } from '$lib/v1';

/** A cell needs at least this many observations to be a trusted point (else: honest gap). */
export const MIN_TRUSTED_OBS = 30;

export interface CrosstabLabels {
	title: string;
	xLabel: string;
	yLabel: string;
	/** Localized label for a shift token (am_peak → "AM peak"). */
	shiftLabel: (shift: string) => string;
	weekdayLabel: string;
	weekendLabel: string;
}

export interface CrosstabResult {
	spec: LineSpec | AbsenceSpec;
	hasData: boolean;
}

export function selectPunctualityCrosstab(
	cells: readonly CrosstabCell[],
	locale: Locale,
	labels: CrosstabLabels,
): CrosstabResult {
	const index: Partial<Record<string, CrosstabCell>> = {};
	for (const c of cells) index[`${c.shift}|${c.day_type}`] = c;

	const trusted = (dayType: string) =>
		SHIFT_GRAIN_ORDER.map((shift) => {
			const c = index[`${shift}|${dayType}`];
			const n = c?.observation_count ?? 0;
			return c && n >= MIN_TRUSTED_OBS && c.otp_pct != null ? c.otp_pct : null;
		});

	const weekday = trusted('weekday');
	const weekend = trusted('weekend');
	const hasData = [...weekday, ...weekend].some((v) => v != null);

	if (!hasData) {
		return {
			spec: {
				kind: 'absence',
				title: labels.title,
				locale,
				reason: 'no-observations',
				variant: 'block',
			},
			hasData,
		};
	}

	const series: LineSeries[] = [
		{ key: 'weekday', label: labels.weekdayLabel, points: weekday, colorVar: 'var(--foreground)' },
		{
			key: 'weekend',
			label: labels.weekendLabel,
			points: weekend,
			colorVar: 'var(--muted-foreground)',
			dashed: true,
		},
	];

	return {
		spec: {
			kind: 'line',
			title: labels.title,
			locale,
			xLabels: SHIFT_GRAIN_ORDER.map((s) => labels.shiftLabel(s)),
			domain: OTP_DOMAIN,
			unit: '%',
			xLabel: labels.xLabel,
			yLabel: labels.yLabel,
			series,
		},
		hasData,
	};
}
