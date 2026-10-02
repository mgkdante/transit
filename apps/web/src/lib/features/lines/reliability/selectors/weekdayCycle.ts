import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, LineSpec } from '$lib/components/dataviz/chart';
import { DELAY_DOW_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { RouteDayOfWeek } from '$lib/v1';

export interface WeekdayCycleLabels {
	title: string;
	xLabel: string;
	yLabel: string;
	unit: string;
	weekdayShort: (iso: number) => string;
}

export interface WeekdayCycleResult {
	spec: LineSpec | AbsenceSpec;
	hasData: boolean;
}

const ISO_WEEK = [1, 2, 3, 4, 5, 6, 7] as const;

export function selectWeekdayCycle(
	dayOfWeek: readonly RouteDayOfWeek[],
	locale: Locale,
	labels: WeekdayCycleLabels,
): WeekdayCycleResult {
	const byIso = new Map(dayOfWeek.map((d) => [d.day_of_week_iso, d]));
	const points = ISO_WEEK.map((iso) => byIso.get(iso)?.avg_delay_min ?? null);
	const hasData = points.some((p) => p != null);

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

	return {
		spec: {
			kind: 'line',
			title: labels.title,
			locale,
			xLabels: ISO_WEEK.map((iso) => labels.weekdayShort(iso)),
			xLabel: labels.xLabel,
			domain: DELAY_DOW_DOMAIN,
			unit: labels.unit,
			yLabel: labels.yLabel,
			series: [{ key: 'delay', label: labels.yLabel, points, colorVar: 'var(--foreground)' }],
		},
		hasData,
	};
}
