// selectPunctualityTrend — the FIRST spec-emitting selector (S7 P1.4 pilot).
//
// Owns the §01 OTP-trend shaping that used to live in Cluster01Punctuality.svelte: the
// granularity MATRIX (DAY grain → the intra-day pattern across the time-of-day shifts;
// week / month / range → the dated daily series), the Wilson 95% band (daily periods
// only — the shift view carries no bounds), and the ABSOLUTE domains (OTP [0,100],
// retard [0,8]) pulled from domains.ts. The component no longer derives any of this; it
// renders the returned spec through the one <Chart>. Honest absence: too few real points
// ⇒ an `absence` spec (the renderer shows "no data + why"), never an empty axis.
//
// This is a standalone selector now; P2.2 folds it into the per-section selector module.

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, TrendDatum, TrendSpec } from '$lib/components/dataviz/chart';
import { DELAY_POS_DOMAIN, OTP_DOMAIN } from '$lib/features/reliability/domains';
import { SHIFT_GRAIN_ORDER } from '$lib/features/reliability/shiftGrains';
import type { PunctualityVM } from '../clusters';

/** Chart Doctrine constants (the degradation ladder + the OTP target). */
const MIN_POINTS_FOR_LINE = 7;
const MIN_N_RATE = 30;
const OTP_TARGET = 80;

/** Already-localized labels the spec carries (i18n stays out of the selector). */
export interface PunctualityTrendLabels {
	/** Accessible name describing data + window (e.g. "On-time % · by day"). */
	title: string;
	/** Primary-series label (on-time %). */
	otpLabel: string;
	/** Secondary-series label (avg delay / retard). */
	retardLabel: string;
	/** Percent unit suffix (e.g. "%"). */
	pctUnit: string;
	/** Minutes unit suffix (e.g. " min"). */
	minUnit: string;
	/** Full localized shift label (day-grain TOOLTIP header). */
	shiftLabel: (grain: string) => string;
	/** SHORT localized shift label (day-grain x-axis TICK — keeps 5 shifts from overlapping on a phone). */
	shiftShort: (grain: string) => string;
}

export function selectPunctualityTrend(
	vm: PunctualityVM,
	grain: string,
	locale: Locale,
	labels: PunctualityTrendLabels,
): TrendSpec | AbsenceSpec {
	const isDayGrain = grain === 'day';
	const order = SHIFT_GRAIN_ORDER as readonly string[];

	const points: TrendDatum[] = isDayGrain
		? vm.peakOffPeak.byShift
				.slice()
				.sort((a, b) => order.indexOf(a.grain) - order.indexOf(b.grain))
				.map((r) => ({
					// x is the band-scale key AND the tick label — use the SHORT shift label so the 5
					// shifts don't overlap on a narrow plot; the FULL label rides the tooltip (xLabel).
					x: labels.shiftShort(r.grain),
					xLabel: labels.shiftLabel(r.grain),
					y: r.otpPct,
					y2: r.avgDelayMin,
				}))
		: vm.trend.map((p) => ({
				x: p.date ? new Date(p.date).getTime() : Number.NaN,
				xLabel: p.date ?? '',
				// Plot the EXACT rate (Σ on_time / Σ n × 100), not the integer otp_pct — the Wilson
				// band below is built from exact counts, so an integer-rounded centre fell OUTSIDE
				// its own band on ~22% of daily points. Fall back to otp_pct when counts are absent.
				y:
					p.observation_count != null && p.observation_count > 0 && p.on_time != null
						? (p.on_time / p.observation_count) * 100
						: (p.otp_pct ?? null),
				y2: p.avg_delay_min ?? null,
				bandLo: p.wilson_lo ?? null,
				bandHi: p.wilson_hi ?? null,
				n: p.observation_count ?? null,
			}));

	// A trend needs at least two REAL points to read as a shape (Chart Doctrine: below
	// the line floor it degrades — here, to honest absence rather than a one-dot line).
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

	const hasBand = !isDayGrain && points.some((p) => p.bandLo != null && p.bandHi != null);

	return {
		kind: 'trend',
		title: labels.title,
		locale,
		xScale: isDayGrain ? 'band' : 'time',
		domain: OTP_DOMAIN,
		unit: labels.pctUnit,
		label: labels.otpLabel,
		points,
		hasBand,
		target: OTP_TARGET,
		secondary: { domain: DELAY_POS_DOMAIN, unit: labels.minUnit, label: labels.retardLabel },
		minPointsForLine: MIN_POINTS_FOR_LINE,
		minN: MIN_N_RATE,
	};
}
