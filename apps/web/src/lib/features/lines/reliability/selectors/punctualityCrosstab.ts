import type { Locale } from '#lib/i18n/index.ts';
import type { AbsenceSpec, LineSpec, LineSeries } from '#lib/components/dataviz/chart/index.ts';
import { OTP_DOMAIN } from '#lib/features/reliability/domains.ts';
import { SHIFT_GRAIN_ORDER } from '#lib/features/reliability/shiftGrains.ts';
import type { CrosstabCell } from '#lib/v1/index.ts';

export const MIN_TRUSTED_OBS = 30;

export interface CrosstabLabels {
	title: string;
	xLabel: string;
	yLabel: string;
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
