// selectDelayHistogram — the live delay distribution, RE-SEATED onto the ChartSpec kernel.
//
// S9A / S9C: this replaces the hand-rolled token-only <ul> whose bar width was `count / max`
// CSS — a within-distribution normalization that survived only as raw CSS (it would have
// FAILED the chartDoctrine gate written as a chart scale). The distribution is now the A1
// `kind: 'histogram'` spec the ONE <Chart> renders: the SAME 8 signed-minute buckets of the
// trip-level delays that power delay_p50/p90, on a diverging-at-0 signed axis (early left /
// on-time at 0 / late right) with the median + p90 as reference rules.
//
// UNIT BRIDGE: the network live buckets are published in signed MINUTES (lo_min/hi_min); the
// HistogramMark reads SECONDS (the shared NETWORK_DELAY_HISTOGRAM_DOMAIN), so we scale every
// edge ×60. The p50/p90 refs (minutes) convert the same way. The count y-axis rides the
// distribution's OWN peak (see HistogramSpec.countDomain — a within-distribution shape is NOT
// a cross-view magnitude, so the Lie-Factor law does not bind it), derived once here via a
// reduce (never Math.max over a spread feeding a chart scale). Honest absence: null/empty
// buckets OR a zero-total distribution ⇒ an `absence` spec (the renderer shows "no data +
// why"), never a fabricated shape.

import type { Locale } from '$lib/i18n';
import type {
	AbsenceSpec,
	AbsoluteDomain,
	HistogramBin,
	HistogramSpec,
} from '$lib/components/dataviz/chart';
import { NETWORK_DELAY_HISTOGRAM_DOMAIN } from '$lib/features/reliability/domains';
import type { DelayBucket } from '$lib/v1/schemas';

/** Already-localized labels the spec carries (i18n stays out of the selector). */
export interface DelayHistogramLabels {
	/** Accessible chart title (data + takeaway). */
	title: string;
	/** Plain-language caption beneath the mark (same basis as p50/p90). */
	caption: string;
	/** Value unit suffix (minutes, e.g. " min"). */
	unit: string;
	/** Localized x-axis title (the delay axis). */
	xLabel: string;
	/** Localized y-axis title (the count axis). */
	yLabel: string;
}

const MIN_TO_SEC = 60;

export function selectDelayHistogram(
	buckets: readonly DelayBucket[] | null | undefined,
	p50Min: number | null,
	p90Min: number | null,
	locale: Locale,
	labels: DelayHistogramLabels,
): HistogramSpec | AbsenceSpec {
	const rows = buckets ?? [];
	const total = rows.reduce((s, b) => s + b.count, 0);
	if (rows.length === 0 || total === 0) {
		return {
			kind: 'absence',
			title: labels.title,
			locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}

	// minutes → seconds so the network distribution reads on the SHARED signed axis.
	const bins: HistogramBin[] = rows.map((b) => ({
		lo: b.lo_min == null ? null : b.lo_min * MIN_TO_SEC,
		hi: b.hi_min == null ? null : b.hi_min * MIN_TO_SEC,
		count: b.count,
	}));

	// The distribution's OWN peak — a within-distribution shape, NOT a cross-view magnitude
	// (see HistogramSpec.countDomain). Derive-once via reduce so no `Math.max(...spread)` ever
	// feeds a chart scale; zero-based, ≥1 so an all-zero distribution never divides by zero.
	const maxCount = bins.reduce((m, b) => (b.count > m ? b.count : m), 0);
	const countDomain: AbsoluteDomain = [0, Math.max(maxCount, 1)];

	return {
		kind: 'histogram',
		title: labels.title,
		caption: labels.caption,
		locale,
		domain: NETWORK_DELAY_HISTOGRAM_DOMAIN,
		countDomain,
		unit: labels.unit,
		xLabel: labels.xLabel,
		yLabel: labels.yLabel,
		bins,
		medianRef: p50Min != null ? Math.round(p50Min * MIN_TO_SEC) : null,
		p90Ref: p90Min != null ? Math.round(p90Min * MIN_TO_SEC) : null,
	};
}
