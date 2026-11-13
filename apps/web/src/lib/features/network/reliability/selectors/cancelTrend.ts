import { scaleLinear } from 'd3-scale';
import type { ChartSpec, TrendDatum } from '#lib/components/dataviz/chart/index.ts';
import type { Locale } from '#lib/i18n/config.ts';
import type { TrendPoint } from '#lib/v1/index.ts';

export interface CancelTrendOptions {
	readonly locale: Locale;
	readonly title: string;
	readonly seriesLabel: string;
	readonly pctUnit: string;
}

export interface CancelTrendVM {
	readonly hasCancel: boolean;
	readonly latest: number | null;
	readonly latestDate: string | null;
	readonly spec: ChartSpec;
}

export function selectCancelTrend(
	points: readonly TrendPoint[],
	opts: CancelTrendOptions,
): CancelTrendVM {
	const series = points.map((p) => p.cancellation_rate ?? null);
	let latest: number | null = null;
	let latestDate: string | null = null;
	for (let i = series.length - 1; i >= 0; i--) {
		const v = series[i];
		if (v != null) {
			latest = v;
			latestDate = points[i].date;
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
					domain: [
						0,
						scaleLinear()
							.domain([0, Math.max(...series.map((v) => v ?? 0), 0.01) * 1.05])
							.nice(5)
							.domain()[1],
					],
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
		latestDate,
		spec,
	};
}
