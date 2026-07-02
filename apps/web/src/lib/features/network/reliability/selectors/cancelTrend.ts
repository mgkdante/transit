// selectCancelTrend — the network-wide cancellation-rate trend + its latest reading.
//
// Ported VERBATIM from the NetworkHealth god-file. Stand the whole block DOWN when the series
// carries no cancellation data (every point null) — never a flat zero line. FIXED absolute
// [0,100] domain (CANCEL_RATE_DOMAIN): cancellation rate is a PERCENTAGE (a share of a whole),
// so its honest domain IS the whole — a near-zero network rate truthfully reads "rare" instead
// of an in-view max that made 2% today fill the frame and 4% tomorrow only half. The onTime
// channel carries the data; the retard channel is empty (all-null gaps). Consumes the
// ALREADY-windowed series.

import { CANCEL_RATE_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { TrendPoint } from '$lib/v1';

/** The cancellation-trend view-model TrendLine consumes. */
export interface CancelTrendVM {
	/** True when at least one point carries a cancellation reading (else stand the block down). */
	readonly hasCancel: boolean;
	/** The cancellation-rate series (%) per point (null = gap). */
	readonly series: Array<number | null>;
	/** An all-null companion series (the empty retard channel — single-series chart). */
	readonly empty: Array<number | null>;
	/** The latest non-null cancellation reading (%), or null. */
	readonly latest: number | null;
	/** The FIXED [0,100] domain. */
	readonly domain: [number, number];
	/** x-axis labels (the point dates). */
	readonly xLabels: string[];
}

export function selectCancelTrend(points: readonly TrendPoint[]): CancelTrendVM {
	const series = points.map((p) => p.cancellation_rate ?? null);
	let latest: number | null = null;
	for (let i = series.length - 1; i >= 0; i--) {
		const v = series[i];
		if (v != null) {
			latest = v;
			break;
		}
	}
	return {
		hasCancel: series.some((v) => v != null),
		series,
		empty: series.map(() => null),
		latest,
		domain: [CANCEL_RATE_DOMAIN[0], CANCEL_RATE_DOMAIN[1]],
		xLabels: points.map((p) => p.date),
	};
}
