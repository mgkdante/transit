// selectTrendChart — the primary network trend (on-time % vs a chosen delay series).
//
// P5.2: emits a dual-axis `trend` ChartSpec for the ONE <Chart> renderer (TrendMark).
// The pre-P5.2 note claiming TrendSpec "does not model" the dual series was STALE —
// TrendSpec.secondary + TrendDatum.y2 are exactly this shape, and the live p90/avg
// toggle simply re-emits the spec. The primary line is on-time %; the retard series
// reads either p90 ("slowest 10%") or avg-delay ("typical") on its OWN FIXED
// DELAY_DIST_DOMAIN [0,15] (the p90-capable NAMED PAIRED constant — see domains.ts A2),
// never the in-view max. null points are GAPS (never bridged).
//
// OTP ZOOM (S9B · DECISIONS B1/B2, carried through the migration): the primary domain
// is `otpTrendDomain(onTime)` — the DATA-ANCHORED, MIN-SPAN-floored, [0,100]-clamped
// zoom adjudicated honest in S9 (true tick labels + the absolute 80% reference INSIDE
// the window). This is the ONE documented exception to the trend kind's zero-based
// domain law; it applies ONLY to the network OTP trend (domains.ts owns the ruling).
// Consumes the ALREADY-windowed series (one slice, shared by the spark/cancel marks).

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
	/** Accessible title (the legacy summary label). */
	readonly title: string;
	/** Primary-series label (on-time %). */
	readonly onTimeLabel: string;
	/** The resolved retard-axis label (p90 or median — the toggle re-feeds this). */
	readonly retardLabel: string;
	readonly pctUnit: string;
	readonly minUnit: string;
}

/**
 * Build the primary trend spec. `effectiveRetard` is the resolved series channel — the
 * rider's pick on the day grain, forced to 'avg' on week/month (where p90 carries no data).
 */
export function selectTrendChart(
	points: readonly TrendPoint[],
	effectiveRetard: 'p90' | 'avg',
	opts: TrendChartOptions,
): ChartSpec {
	const onTime = points.map((p) => p.otp_pct ?? null);
	const retard = points.map((p) =>
		effectiveRetard === 'avg' ? (p.avg_delay_min ?? null) : (p.p90_min ?? null),
	);
	const specPoints: TrendDatum[] = points.map((p, i) => ({
		x: p.date,
		xLabel: p.date,
		y: onTime[i] ?? null,
		y2: retard[i] ?? null,
	}));

	// Below two real points a trend has no shape — honest absence, never a one-dot line.
	if (specPoints.filter((p) => p.y != null).length < 2) {
		return {
			kind: 'absence',
			title: opts.title,
			locale: opts.locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}

	return {
		kind: 'trend',
		title: opts.title,
		locale: opts.locale,
		xScale: 'band',
		// The zoom is computed over the ALREADY-windowed on-time series — the same slice every
		// other mark reads — so the axis tracks the visible window's real extremes (S9B).
		domain: otpTrendDomain(onTime),
		unit: opts.pctUnit,
		label: opts.onTimeLabel,
		points: specPoints,
		hasBand: false,
		target: OTP_TREND_REFERENCE,
		secondary: {
			domain: [DELAY_DIST_DOMAIN[0], DELAY_DIST_DOMAIN[1]],
			unit: opts.minUnit,
			label: opts.retardLabel,
		},
		// Metadata floors (network points carry no per-period n — the mark's comet dots
		// read every point at the low-N radius, matching the legacy uniform dots).
		minPointsForLine: 2,
		minN: 0,
	};
}

export interface VehiclesSparkOptions {
	readonly locale: Locale;
	/** Accessible title for the spark figure. */
	readonly title: string;
	/** Series label (tooltip row). */
	readonly label: string;
}

/**
 * The vehicles-in-service context spark (day-grain only; null = gap). P5.2: a
 * `sparkline` ChartSpec. The spec carries an EXPLICIT domain the mark never derives;
 * its VALUE is the blessed data-anchored zoom (chart/sparkDomain.ts owns the
 * adjudication — a tickless shape channel, not a cross-view magnitude).
 */
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
		width: 320,
		height: 56,
	};
}
