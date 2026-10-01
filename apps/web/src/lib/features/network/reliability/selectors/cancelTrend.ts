import { CANCEL_RATE_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { ChartSpec, TrendDatum } from '$lib/components/dataviz/chart';
import type { Locale } from '$lib/i18n/config';
import type { TrendPoint } from '$lib/v1';

export interface CancelTrendOptions {
	readonly locale: Locale;
	readonly title: string;
	readonly seriesLabel: string;
	readonly pctUnit: string;
}

export interface CancelTrendVM {
	readonly hasCancel: boolean;
	readonly latest: number | null;
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
