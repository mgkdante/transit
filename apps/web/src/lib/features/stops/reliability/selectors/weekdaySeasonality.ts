// weekdaySeasonality — the per-stop weekday ranked list (day_of_week[]).
//
// Ports the StopDetail inline `rankedWeekdays` transform VERBATIM: rank the
// weekday series worst-first by mean delay on the FIXED DELAY_DOW_DOMAIN. A
// weekday earns a row ONLY when it carries a real mean delay (a null-avg or
// zero-observation weekday is DROPPED — never a fabricated 0-delay bar). The
// severe share rides as a second reading ONLY when enough observations back it
// (MIN_WEEKDAY_SEVERE_OBSERVATIONS) — a thin bucket keeps the plain avg caption.

import { DELAY_DOW_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { SeverityCode, RouteDayOfWeek } from '$lib/v1/schemas';

/** A weekday severe share resting on fewer than this many observations is withheld. */
export const MIN_WEEKDAY_SEVERE_OBSERVATIONS = 5;

/** One ranked weekday row (RankedRow-ready, carrying its absolute domain). */
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
	/** Per-row subtitle prefix when a well-sampled severe share is the reading. */
	severeShare: string;
	/** Per-row subtitle when the mean delay is the only reading. */
	avgDelay: string;
	/** Localized weekday name from an ISO index (1=Mon..7=Sun). */
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
			// ABSOLUTE severity off the real mean delay (never the in-view max) so a calm
			// 2-min weekday never reads 'critical' just for being this stop's worst.
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
