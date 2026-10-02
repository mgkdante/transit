import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, TrendDatum, TrendSpec } from '$lib/components/dataviz/chart';
import { DELAY_POS_DOMAIN, OTP_DOMAIN } from '$lib/features/reliability/domains';
import { SHIFT_GRAIN_ORDER } from '$lib/features/reliability/shiftGrains';
import type { PunctualityVM } from '../clusters';

const MIN_POINTS_FOR_LINE = 7;
const MIN_N_RATE = 30;
const OTP_TARGET = 80;

export interface PunctualityTrendLabels {
	title: string;
	otpLabel: string;
	retardLabel: string;
	pctUnit: string;
	minUnit: string;
	shiftLabel: (grain: string) => string;
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
					x: labels.shiftShort(r.grain),
					xLabel: labels.shiftLabel(r.grain),
					y: r.otpPct,
					y2: r.avgDelayMin,
				}))
		: vm.trend.map((p) => ({
				x: p.date ? new Date(p.date).getTime() : Number.NaN,
				xLabel: p.date ?? '',
				y:
					p.observation_count != null && p.observation_count > 0 && p.on_time != null
						? (p.on_time / p.observation_count) * 100
						: (p.otp_pct ?? null),
				y2: p.avg_delay_min ?? null,
				bandLo: p.wilson_lo ?? null,
				bandHi: p.wilson_hi ?? null,
				n: p.observation_count ?? null,
			}));

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
