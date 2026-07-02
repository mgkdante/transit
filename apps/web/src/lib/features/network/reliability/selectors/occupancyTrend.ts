// selectOccupancyTrend — the per-day crowding small-multiple (one 100% bar per day).
//
// Ported VERBATIM from the NetworkHealth god-file. One StackedBar(scale='occupancy') per day
// THAT HAS occupancy telemetry; a day whose occupancy_mix is null/absent is SKIPPED entirely
// (never an even split). Each kept day's segments null-guard the same way the live bar does.
// Per-day crowding is a DAILY artifact — week/month carry no per-point occupancy mix — so the
// orchestrator only renders it on the day grain. Consumes the ALREADY-windowed series.

import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas';
import type { TrendPoint } from '$lib/v1/schemas';
import type { StackedSegment } from '$lib/components/dataviz';

/** One dated crowding column in the small-multiple. */
export interface OccupancyDay {
	readonly date: string;
	readonly dateLabel: string;
	readonly segments: StackedSegment[];
}

/**
 * `dateLabel`: the caller's localized short-date formatter (UTC day-key — i18n stays out).
 * `occupancyLabel`: code → the localized band label (SHARED $lib/v1/enumLabels vocabulary).
 */
export function selectOccupancyTrend(
	points: readonly TrendPoint[],
	dateLabel: (date: string) => string,
	occupancyLabel: (code: OccupancyCode) => string,
): OccupancyDay[] {
	return points
		.filter(
			(p): p is TrendPoint & { occupancy_mix: NonNullable<TrendPoint['occupancy_mix']> } =>
				p.occupancy_mix != null,
		)
		.map((p) => ({
			date: p.date,
			dateLabel: dateLabel(p.date),
			segments: OCCUPANCY_CODES.map((code: OccupancyCode) => ({
				code,
				value: p.occupancy_mix[code] ?? null,
				label: occupancyLabel(code),
			})),
		}));
}
