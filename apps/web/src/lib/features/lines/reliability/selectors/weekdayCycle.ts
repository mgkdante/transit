// selectWeekdayCycle — the §05 weekday-seasonality cycle, as ONE LINE.
//
// Mean delay per weekday in the FIXED Mon→Sun cycle order (iso 1..7) on the shared
// DELAY_DOW_DOMAIN — the cohesive line language (was a custom CyclePlot). The cycle order
// IS the meaning (never sorted by delay). A weekday the contract omits is an honest GAP in
// the line, never a fabricated 0. Honest absence when no weekday carries a mean delay.
// (The severe-share second mark of the old CyclePlot is dropped for the single-line v1 —
// it rides a different domain; a dual-axis variant is a follow-up.)

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, LineSpec } from '$lib/components/dataviz/chart';
import { DELAY_DOW_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { RouteDayOfWeek } from '$lib/v1';

export interface WeekdayCycleLabels {
	title: string;
	/** Localized value-axis title + series label (e.g. "Avg delay"). */
	yLabel: string;
	/** Value unit suffix (e.g. " min"). */
	unit: string;
	/** Short weekday label for an ISO weekday (1=Mon..7=Sun). */
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
			domain: DELAY_DOW_DOMAIN,
			unit: labels.unit,
			yLabel: labels.yLabel,
			series: [{ key: 'delay', label: labels.yLabel, points, colorVar: 'var(--foreground)' }],
		},
		hasData,
	};
}
