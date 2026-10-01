import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, TrendDatum, TrendSpec } from '$lib/components/dataviz/chart';
import { SEVERE_DOMAIN, DELAY_POS_DOMAIN } from '$lib/features/reliability/shiftGrains';
import { wilsonBounds, MIN_POINTS_FOR_LINE, MIN_N_RATE } from '$lib/v1/stats';
import type { StopDailyPoint } from '$lib/v1';
import type { DateWindow } from '$lib/filters';

export interface DailyTrendLabels {
	title: string;
	severeLabel: string;
	avgLabel: string;
	pctUnit: string;
	minUnit: string;
}

export function selectDailyTrend(
	daily: readonly StopDailyPoint[] | null | undefined,
	locale: Locale,
	labels: DailyTrendLabels,
	window?: DateWindow | null,
): TrendSpec | AbsenceSpec {
	const points: TrendDatum[] = (daily ?? [])
		.filter((p) => (window ? p.date >= window.from && p.date <= window.to : true))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
		.map((p) => {
			const band =
				p.observation_count > 0 ? wilsonBounds(p.severe_count, p.observation_count) : null;
			return {
				x: p.date ? new Date(p.date).getTime() : Number.NaN,
				xLabel: p.date ?? '',
				y: p.severe_pct ?? null,
				y2: p.avg_delay_min ?? null,
				bandLo: band?.[0] ?? null,
				bandHi: band?.[1] ?? null,
				n: p.observation_count ?? null,
			};
		});

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

	const hasBand = points.some((p) => p.bandLo != null && p.bandHi != null);

	return {
		kind: 'trend',
		title: labels.title,
		locale,
		xScale: 'time',
		domain: SEVERE_DOMAIN,
		unit: labels.pctUnit,
		label: labels.severeLabel,
		points,
		hasBand,
		secondary: { domain: DELAY_POS_DOMAIN, unit: labels.minUnit, label: labels.avgLabel },
		minPointsForLine: MIN_POINTS_FOR_LINE,
		minN: MIN_N_RATE,
	};
}
