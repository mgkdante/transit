// selectCancelTrend — the network-wide cancellation-rate trend + its latest reading.
//
// P5.2: emits a single-series `trend` ChartSpec for the ONE <Chart> renderer (the
// legacy TrendLine primitive is retired). Stand the whole block DOWN when the series
// carries no cancellation data (every point null) — never a flat zero line. FIXED
// absolute [0,100] domain (CANCEL_RATE_DOMAIN): cancellation rate is a PERCENTAGE (a
// share of a whole), so its honest domain IS the whole — a near-zero network rate
// truthfully reads "rare" instead of an in-view max that made 2% today fill the frame
// and 4% tomorrow only half. No secondary series. Consumes the ALREADY-windowed series.

import { CANCEL_RATE_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { ChartSpec, TrendDatum } from '$lib/components/dataviz/chart';
import type { Locale } from '$lib/i18n/config';
import type { TrendPoint } from '$lib/v1';

export interface CancelTrendOptions {
	readonly locale: Locale;
	/** Accessible title (the legacy summary label). */
	readonly title: string;
	/** Series label (axis + tooltip). */
	readonly seriesLabel: string;
	readonly pctUnit: string;
}

/** The cancellation-trend view-model. */
export interface CancelTrendVM {
	/** True when at least one point carries a cancellation reading (else stand the block down). */
	readonly hasCancel: boolean;
	/** The latest non-null cancellation reading (%), or null. */
	readonly latest: number | null;
	/** The single-series trend spec (only meaningful when hasCancel). */
	readonly spec: ChartSpec;
}

export function selectCancelTrend(
	points: readonly TrendPoint[],
	opts: CancelTrendOptions,
): CancelTrendVM {
	const series = points.map((p) => p.cancellation_rate ?? null);
	let latest: number | null = null;
	for (let i = series.length - 1; i >= 0; i--) {
		const v = series[i];
		if (v != null) {
			latest = v;
			break;
		}
	}
	const specPoints: TrendDatum[] = points.map((p, i) => ({
		x: p.date,
		xLabel: p.date,
		y: series[i] ?? null,
	}));
	const spec: ChartSpec =
		specPoints.filter((p) => p.y != null).length >= 2
			? {
					kind: 'trend',
					title: opts.title,
					locale: opts.locale,
					xScale: 'band',
					domain: [CANCEL_RATE_DOMAIN[0], CANCEL_RATE_DOMAIN[1]],
					unit: opts.pctUnit,
					label: opts.seriesLabel,
					points: specPoints,
					hasBand: false,
					minPointsForLine: 2,
					minN: 0,
				}
			: {
					kind: 'absence',
					title: opts.title,
					locale: opts.locale,
					reason: 'no-observations',
					variant: 'block',
				};
	return {
		hasCancel: series.some((v) => v != null),
		latest,
		spec,
	};
}
