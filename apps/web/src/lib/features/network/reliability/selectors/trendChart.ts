// selectTrendChart — the primary network trend (on-time % vs a chosen delay series).
//
// P5.2: emits a dual-axis `trend` ChartSpec for the ONE <Chart> renderer (TrendMark).
// The pre-P5.2 note claiming TrendSpec "does not model" the dual series was STALE —
// TrendSpec.secondary + TrendDatum.y2 are exactly this shape, and the live p90/avg
// toggle simply re-emits the spec. The primary line is on-time %; the retard series
// reads either p90 ("slowest 10%") or average delay on its OWN FIXED
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
	/** The resolved delay-axis label (p90 or average — the toggle re-feeds this). */
	readonly retardLabel: string;
	/** Accessible title when retained evidence contains delay but no OTP channel. */
	readonly delayOnlyTitle: string;
	/** Accessible title when retained evidence contains OTP but no selected delay channel. */
	readonly onTimeOnlyTitle: string;
	readonly pctUnit: string;
	readonly minUnit: string;
	/** A published retained point is still real evidence even when it cannot form a line. */
	readonly minimumPoints?: 1 | 2;
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
	const minimumPoints = opts.minimumPoints ?? 2;
	const hasPrimary = onTime.filter((value) => value != null).length >= minimumPoints;
	const hasRetard = retard.filter((value) => value != null).length >= minimumPoints;
	const allowRetardOnly = opts.minimumPoints === 1;
	// Current trends still need two OTP points to form a shape. A retained-range caller may admit
	// one published point in either channel instead of discarding real retained evidence.
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
		// The zoom is computed over the ALREADY-windowed on-time series — the same slice every
		// other mark reads — so the axis tracks the visible window's real extremes (S9B).
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
		width: '100%',
		height: 56,
	};
}
