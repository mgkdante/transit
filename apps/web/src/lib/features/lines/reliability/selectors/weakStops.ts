import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, MagnitudeBarsSpec, MagnitudeDatum } from '$lib/components/dataviz/chart';
import { DELAY_POS_DOMAIN, SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import { delayMinToSeverity, severeShareToSeverity } from '$lib/features/reliability/shiftGrains';
import { stopNameFallback } from '$lib/site/absence';
import type { WeakStop } from '$lib/v1';

export interface WeakStopsLabels {
	title: string;
	rowLabel: string;
	xLabel: string;
	unit: string;
	severeXLabel?: string;
	severeUnit?: string;
	note?: (w: WeakStop) => string;
	ciLabel?: string;
	stopHref: (id: string) => string;
}

export interface WeakStopsResult {
	spec: MagnitudeBarsSpec | AbsenceSpec;
	total: number;
	shown: number;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

const severeCiLo = (w: WeakStop): number | null =>
	w.wilson_lo != null && w.wilson_hi != null ? round1(100 - w.wilson_hi) : null;
const severeCiHi = (w: WeakStop): number | null =>
	w.wilson_lo != null && w.wilson_hi != null ? round1(100 - w.wilson_lo) : null;

export interface WeakStopsOpts {
	preRanked?: boolean;
}

export function selectWeakStops(
	stops: readonly WeakStop[],
	n: number,
	locale: Locale,
	labels: WeakStopsLabels,
	opts?: WeakStopsOpts,
): WeakStopsResult {
	const preRanked = opts?.preRanked === true;
	const ranked = preRanked
		? stops.slice()
		: stops
				.filter((w) => w.avg_delay_min != null)
				.slice()
				.sort((a, b) => (b.avg_delay_min ?? 0) - (a.avg_delay_min ?? 0));
	const total = ranked.length;
	const top = ranked.slice(0, Math.max(0, n));
	const shown = top.length;

	if (shown === 0) {
		return {
			spec: {
				kind: 'absence',
				title: labels.title,
				locale,
				reason: 'no-observations',
				variant: 'block',
			},
			total,
			shown,
		};
	}

	const rows: MagnitudeDatum[] = top.map((w) =>
		preRanked
			? {
					key: w.id,
					label: w.name ?? stopNameFallback(w.id, locale),
					value: w.severe_pct ?? null,
					severity: severeShareToSeverity(w.severe_pct ?? null),
					n: w.observation_count ?? null,
					wilsonLo: severeCiLo(w),
					wilsonHi: severeCiHi(w),
					note: labels.note?.(w),
					href: labels.stopHref(w.id),
				}
			: {
					key: w.id,
					label: w.name ?? stopNameFallback(w.id, locale),
					value: w.avg_delay_min ?? null,
					severity: delayMinToSeverity(w.avg_delay_min ?? null),
					href: labels.stopHref(w.id),
				},
	);

	return {
		spec: {
			kind: 'magnitude-bars',
			mark: 'lollipop',
			title: labels.title,
			locale,
			domain: preRanked ? SEVERE_DOMAIN : DELAY_POS_DOMAIN,
			unit: preRanked ? (labels.severeUnit ?? labels.unit) : labels.unit,
			rowLabel: labels.rowLabel,
			xLabel: preRanked ? (labels.severeXLabel ?? labels.xLabel) : labels.xLabel,
			ciLabel: preRanked ? labels.ciLabel : undefined,
			rows,
			sort: 'given',
			scale: 'severity',
		},
		total,
		shown,
	};
}
