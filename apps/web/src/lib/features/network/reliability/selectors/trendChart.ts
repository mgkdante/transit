import {
	DELAY_DIST_DOMAIN,
	OTP_TREND_REFERENCE,
	otpTrendDomain,
} from '$lib/features/reliability/shiftGrains';
import type { ChartSpec, SparklineSpec, TrendDatum } from '$lib/components/dataviz/chart';
import { sparkZoomDomain } from '$lib/components/dataviz/chart/sparkDomain';
import type { Locale } from '$lib/i18n/config';
import type { TrendPoint } from '$lib/v1';

export interface TrendChartOptions {
	readonly locale: Locale;
	readonly title: string;
	readonly onTimeLabel: string;
	readonly retardLabel: string;
	readonly delayOnlyTitle: string;
	readonly onTimeOnlyTitle: string;
	readonly pctUnit: string;
	readonly minUnit: string;
	readonly minimumPoints?: 1 | 2;
}

export function selectTrendChart(
	points: readonly TrendPoint[],
	effectiveRetard: 'p90' | 'avg',
	opts: TrendChartOptions,
): ChartSpec {
	const onTime = points.map((p) => p.otp_pct ?? null);
	const retard = points.map((p) =>
		effectiveRetard === 'avg' ? (p.avg_delay_min ?? null) : (p.p90_min ?? null),
	);
	const minimumPoints = opts.minimumPoints ?? 2;
	const hasPrimary = onTime.filter((value) => value != null).length >= minimumPoints;
	const hasRetard = retard.filter((value) => value != null).length >= minimumPoints;
	const allowRetardOnly = opts.minimumPoints === 1;
	if (!hasPrimary && !(allowRetardOnly && hasRetard)) {
		return {
			kind: 'absence',
			title: opts.title,
			locale: opts.locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}
	const retardOnly = allowRetardOnly && !hasPrimary && hasRetard;
	if (retardOnly) {
		const specPoints: TrendDatum[] = points.map((point, index) => ({
			x: point.date,
			xLabel: point.date,
			y: retard[index] ?? null,
			y2: null,
		}));
		return {
			kind: 'trend',
			title: opts.delayOnlyTitle,
			locale: opts.locale,
			xScale: 'band',
			domain: DELAY_DIST_DOMAIN,
			unit: opts.minUnit,
			label: opts.retardLabel,
			colorVar: 'var(--dataviz-status-late)',
			points: specPoints,
			hasBand: false,
			minPointsForLine: 2,
			minN: 0,
		};
	}

	const specPoints: TrendDatum[] = points.map((p, i) => ({
		x: p.date,
		xLabel: p.date,
		y: onTime[i] ?? null,
		y2: retard[i] ?? null,
	}));
	const includeSecondary = !allowRetardOnly || hasRetard;

	return {
		kind: 'trend',
		title: allowRetardOnly && !hasRetard ? opts.onTimeOnlyTitle : opts.title,
		locale: opts.locale,
		xScale: 'band',
		domain: otpTrendDomain(onTime),
		unit: opts.pctUnit,
		label: opts.onTimeLabel,
		points: specPoints,
		hasBand: false,
		target: OTP_TREND_REFERENCE,
		...(includeSecondary
			? {
					secondary: {
						domain: DELAY_DIST_DOMAIN,
						unit: opts.minUnit,
						label: opts.retardLabel,
					},
				}
			: {}),
		minPointsForLine: 2,
		minN: 0,
	};
}

export interface VehiclesSparkOptions {
	readonly locale: Locale;
	readonly title: string;
	readonly label: string;
}

export function selectVehiclesSpark(
	points: readonly TrendPoint[],
	opts: VehiclesSparkOptions,
): SparklineSpec | null {
	const values = points.map((p) => p.vehicles ?? null);
	const domain = sparkZoomDomain(values);
	if (domain == null) return null;
	return {
		kind: 'sparkline',
		title: opts.title,
		locale: opts.locale,
		domain,
		unit: '',
		label: opts.label,
		values,
		xLabels: points.map((p) => p.date),
		colorVar: 'var(--dataviz-status-unknown)',
		showLast: true,
		width: '100%',
		height: 56,
	};
}
