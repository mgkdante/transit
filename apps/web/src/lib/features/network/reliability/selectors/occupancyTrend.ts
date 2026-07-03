// selectOccupancyTrend — the per-day crowding small-multiple (one 100% bar per day).
//
// P5.2: each kept day emits a `stacked-share` ChartSpec for the ONE <Chart> renderer
// (the legacy StackedBar primitive is retired). One strip per day THAT HAS occupancy
// telemetry; a day whose occupancy_mix is null/absent — or all-zero, which the shared
// helper treats identically — is SKIPPED entirely (never an even split). Per-day
// crowding is a DAILY artifact — week/month carry no per-point occupancy mix — so the
// orchestrator only renders it on the day grain. Consumes the ALREADY-windowed series.

import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas';
import type { TrendPoint } from '$lib/v1/schemas';
import type { StackedShareSpec } from '$lib/components/dataviz/chart';
import { stackedShareSpec } from '$lib/components/dataviz/chart/share';
import type { Locale } from '$lib/i18n/config';

/** One dated crowding column in the small-multiple. */
export interface OccupancyDay {
	readonly date: string;
	readonly dateLabel: string;
	readonly spec: StackedShareSpec;
}

export interface OccupancyTrendOptions {
	readonly locale: Locale;
	/** Localized strip title for a day (e.g. "Crowding · Jun 30"). */
	readonly titleFor: (dateLabel: string) => string;
}

/**
 * `dateLabel`: the caller's localized short-date formatter (UTC day-key — i18n stays out).
 * `occupancyLabel`: code → the localized band label (SHARED $lib/v1/enumLabels vocabulary).
 */
export function selectOccupancyTrend(
	points: readonly TrendPoint[],
	dateLabel: (date: string) => string,
	occupancyLabel: (code: OccupancyCode) => string,
	opts: OccupancyTrendOptions,
): OccupancyDay[] {
	const out: OccupancyDay[] = [];
	for (const p of points) {
		const mix = p.occupancy_mix;
		if (mix == null) continue;
		const label = dateLabel(p.date);
		const spec = stackedShareSpec({
			title: opts.titleFor(label),
			locale: opts.locale,
			scale: 'occupancy',
			size: 'sm',
			inputs: OCCUPANCY_CODES.map((code: OccupancyCode) => ({
				code,
				value: mix[code] ?? null,
				label: occupancyLabel(code),
			})),
		});
		if (spec) out.push({ date: p.date, dateLabel: label, spec });
	}
	return out;
}
