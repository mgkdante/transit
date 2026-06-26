// selectWeakStops — the §01 worst-N accountability lollipop (A13).
//
// The weakest stops, worst mean-delay on top, on the fixed DELAY_POS_DOMAIN (the same
// delay renders the same length on every route/grain/refresh). Rank is by avg delay today
// — the contract's WeakStop carries only {id, name, avg_delay_min}; ranking by the Wilson
// LOWER bound + a per-stop whisker (the doctrine ideal) needs a small pipeline rollup to
// add wilson_lo/hi + n. Each row carries a drill href to its stop page. Honest absence
// when no stop has a measured delay.

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, MagnitudeBarsSpec, MagnitudeDatum } from '$lib/components/dataviz/chart';
import { DELAY_POS_DOMAIN } from '$lib/features/reliability/domains';
import { delayMinToSeverity } from '$lib/features/reliability/shiftGrains';
import { stopNameFallback } from '$lib/site/absence';
import type { WeakStop } from '$lib/v1';

export interface WeakStopsLabels {
	/** Accessible name (e.g. "Weakest stops by delay"). */
	title: string;
	/** Localized value-axis title (e.g. "Avg delay"). */
	xLabel: string;
	/** Value unit suffix (e.g. " min"). */
	unit: string;
	/** Build the drill link for a stop id. */
	stopHref: (id: string) => string;
}

export interface WeakStopsResult {
	spec: MagnitudeBarsSpec | AbsenceSpec;
	/** The full ranked count (before the worst-N truncation) — for the honest heading. */
	total: number;
	/** How many rows the spec actually carries (≤ N). */
	shown: number;
}

export function selectWeakStops(
	stops: readonly WeakStop[],
	n: number,
	locale: Locale,
	labels: WeakStopsLabels,
): WeakStopsResult {
	// The FULL ranked set (worst mean-delay first) before truncation — so the absolute
	// domain stays stable as N changes (a smaller N never rescales the remaining bars).
	const ranked = stops
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

	const rows: MagnitudeDatum[] = top.map((w) => ({
		key: w.id,
		label: w.name ?? stopNameFallback(w.id, locale),
		value: w.avg_delay_min ?? null,
		severity: delayMinToSeverity(w.avg_delay_min ?? null),
		href: labels.stopHref(w.id),
	}));

	return {
		spec: {
			kind: 'magnitude-bars',
			mark: 'lollipop',
			title: labels.title,
			locale,
			domain: DELAY_POS_DOMAIN,
			unit: labels.unit,
			xLabel: labels.xLabel,
			rows,
			sort: 'given',
			scale: 'severity',
		},
		total,
		shown,
	};
}
