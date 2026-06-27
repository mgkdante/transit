// selectPunctualityDistribution — the §01 signed-delay distribution (A1 histogram).
//
// The D4 payoff: PR #158 added `delay_histogram` (21 signed bins, seconds edges) to the
// grain-aggregate period, threaded onto `PunctualityVM.headline.delayHistogram`. This
// selector turns it into the A1 spec the one <Chart> renders: a diverging histogram
// anchored at 0 (early left / on-time at 0 / late right), median + p90 reference lines, NO
// mean (skew makes a mean lie). Honest absence when there is no in-window distribution —
// which includes the DAY grain and any date range (the histogram is null there by
// contract), so "Today" shows "no data + why", never a fabricated shape.

import type { Locale } from '$lib/i18n';
import type {
	AbsenceSpec,
	AbsoluteDomain,
	HistogramBin,
	HistogramSpec,
} from '$lib/components/dataviz/chart';
import { DELAY_HISTOGRAM_DOMAIN } from '$lib/features/reliability/domains';
import type { PunctualityVM } from '../clusters';

/** Already-localized labels the spec carries. */
export interface PunctualityDistributionLabels {
	/** Accessible name (e.g. "Delay distribution · this week"). */
	title: string;
	/** Value unit suffix for the bins / refs (seconds, e.g. " s"). */
	unit: string;
	/** Localized x-axis title (the delay axis). */
	xLabel?: string;
	/** Localized y-axis title (the count axis). */
	yLabel?: string;
}

export function selectPunctualityDistribution(
	vm: PunctualityVM,
	locale: Locale,
	labels: PunctualityDistributionLabels,
): HistogramSpec | AbsenceSpec {
	const bins: HistogramBin[] = (vm.headline.delayHistogram ?? []).map((b) => ({
		lo: b.lo_sec ?? null,
		hi: b.hi_sec ?? null,
		count: b.count,
	}));
	const total = bins.reduce((s, b) => s + b.count, 0);
	if (bins.length === 0 || total === 0) {
		return {
			kind: 'absence',
			title: labels.title,
			locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}

	// The distribution's OWN peak — a within-distribution shape, not a cross-view magnitude
	// (see HistogramSpec.countDomain). Derive-once here (selectors decide), via reduce so no
	// `Math.max(...spread)` ever feeds a chart scale.
	const maxCount = bins.reduce((m, b) => (b.count > m ? b.count : m), 0);
	const countDomain: AbsoluteDomain = [0, Math.max(maxCount, 1)];

	const p50 = vm.headline.p50Min;
	const p90 = vm.headline.p90Min;

	return {
		kind: 'histogram',
		title: labels.title,
		locale,
		domain: DELAY_HISTOGRAM_DOMAIN,
		countDomain,
		unit: labels.unit,
		xLabel: labels.xLabel,
		yLabel: labels.yLabel,
		bins,
		// p50/p90 are MINUTES on the headline; the bins are SECONDS → convert the refs.
		medianRef: p50 != null ? Math.round(p50 * 60) : null,
		p90Ref: p90 != null ? Math.round(p90 * 60) : null,
	};
}
