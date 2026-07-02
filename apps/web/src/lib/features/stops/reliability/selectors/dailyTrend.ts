// selectDailyTrend — the S8A dated severe-share trend (Chart Doctrine A3).
//
// Shapes StopReliability.daily[] into a ChartSpec TrendSpec: a line/area over a
// TRUE time x-scale, the primary series = the per-day severe-delay share on the
// ABSOLUTE SEVERE_DOMAIN [0,100] (never an in-view max), the secondary = the
// per-day avg delay on DELAY_POS_DOMAIN [0,8]. This mirrors the lines punctuality
// trend pattern (selectPunctualityTrend): the renderer draws the returned spec
// through the ONE <Chart>; the section derives no scale inline.
//
// A per-day Wilson band rides the primary from the SERVED counts (severe_count /
// observation_count) so the band is exact — same $lib/v1/stats kernel the pooled
// range verdict uses. Honest absence: fewer than 2 real points ⇒ an `absence`
// spec (the renderer shows "no data + why"), never an empty axis. A day whose
// severe_pct is null (zero-observation days are already absent) BREAKS the line.

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, TrendDatum, TrendSpec } from '$lib/components/dataviz/chart';
import { SEVERE_DOMAIN, DELAY_POS_DOMAIN } from '$lib/features/reliability/shiftGrains';
import { wilsonBounds, MIN_POINTS_FOR_LINE, MIN_N_RATE } from '$lib/v1/stats';
import type { StopDailyPoint } from '$lib/v1';
import type { DateWindow } from '$lib/filters';

/** Already-localized labels the spec carries (i18n stays out of the selector). */
export interface DailyTrendLabels {
	/** Accessible chart title (data + window). */
	title: string;
	/** Primary-series label (severe-delay share). */
	severeLabel: string;
	/** Secondary-series label (avg delay). */
	avgLabel: string;
	/** Percent unit suffix. */
	pctUnit: string;
	/** Minutes unit suffix. */
	minUnit: string;
}

/**
 * Build the dated severe-share TrendSpec, optionally CLIPPED to `window` (S8B's
 * DateWindow — inclusive ISO compare). A null/undefined window plots the whole
 * series (the default full-window view).
 */
export function selectDailyTrend(
	daily: readonly StopDailyPoint[] | null | undefined,
	locale: Locale,
	labels: DailyTrendLabels,
	window?: DateWindow | null,
): TrendSpec | AbsenceSpec {
	const points: TrendDatum[] = (daily ?? [])
		.filter((p) => (window ? p.date >= window.from && p.date <= window.to : true))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
		.map((p) => {
			// Wilson band on the SEVERE proportion (severe / obs) in PERCENT — the same
			// kernel the pooled verdict uses, so the per-day band and the pooled band agree.
			const band =
				p.observation_count > 0 ? wilsonBounds(p.severe_count, p.observation_count) : null;
			return {
				x: p.date ? new Date(p.date).getTime() : Number.NaN,
				xLabel: p.date ?? '',
				y: p.severe_pct ?? null,
				y2: p.avg_delay_min ?? null,
				bandLo: band?.[0] ?? null,
				bandHi: band?.[1] ?? null,
				n: p.observation_count ?? null,
			};
		});

	// A trend needs ≥2 REAL points to read as a shape (Chart Doctrine: below the line
	// floor it degrades — here to honest absence, never a one-dot line).
	const realPoints = points.filter((p) => p.y != null).length;
	if (realPoints < 2) {
		return {
			kind: 'absence',
			title: labels.title,
			locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}

	const hasBand = points.some((p) => p.bandLo != null && p.bandHi != null);

	return {
		kind: 'trend',
		title: labels.title,
		locale,
		xScale: 'time',
		domain: SEVERE_DOMAIN,
		unit: labels.pctUnit,
		label: labels.severeLabel,
		points,
		hasBand,
		secondary: { domain: DELAY_POS_DOMAIN, unit: labels.minUnit, label: labels.avgLabel },
		minPointsForLine: MIN_POINTS_FOR_LINE,
		minN: MIN_N_RATE,
	};
}
