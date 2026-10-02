import { DELAY_DOW_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { SeverityCode, RouteDayOfWeek } from '$lib/v1/schemas';

export const MIN_WEEKDAY_SEVERE_OBSERVATIONS = 5;

export interface WeekdayRow {
	readonly key: number;
	readonly rank: number;
	readonly title: string;
	readonly subtitle: string;
	readonly severity: SeverityCode;
	readonly value: number;
	readonly domain: readonly [number, number];
	readonly unit: string;
	readonly display: string;
}

export interface WeekdaySeasonalityLabels {
	severeShare: string;
	avgDelay: string;
	weekdayLabel: (iso: number) => string;
}

export function selectWeekdaySeasonality(
	dayOfWeek: readonly RouteDayOfWeek[] | null | undefined,
	labels: WeekdaySeasonalityLabels,
): WeekdayRow[] {
	const rows = (dayOfWeek ?? [])
		.filter((d): d is RouteDayOfWeek & { avg_delay_min: number } => d.avg_delay_min != null)
		.map((d) => ({
			iso: d.day_of_week_iso,
			delay: d.avg_delay_min,
			severePct: d.severe_pct ?? null,
			observationCount: d.observation_count ?? null,
		}));
	return rows
		.slice()
		.sort((a, b) => b.delay - a.delay)
		.map((r, i) => {
			const severity: SeverityCode = r.delay >= 10 ? 'critical' : r.delay >= 5 ? 'high' : 'watch';
			const severeTrusted =
				r.severePct != null &&
				r.observationCount != null &&
				r.observationCount >= MIN_WEEKDAY_SEVERE_OBSERVATIONS;
			return {
				key: r.iso,
				rank: i + 1,
				title: labels.weekdayLabel(r.iso),
				subtitle: severeTrusted
					? `${labels.severeShare} ${r.severePct!.toFixed(1)}%`
					: labels.avgDelay,
				severity,
				value: r.delay,
				domain: DELAY_DOW_DOMAIN,
				unit: ' min',
				display: `${r.delay.toFixed(1)} min`,
			};
		});
}
