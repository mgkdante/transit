import type { Locale } from '$lib/i18n';
import type {
	AbsenceSpec,
	AbsoluteDomain,
	HistogramBin,
	HistogramSpec,
} from '$lib/components/dataviz/chart';
import { DELAY_HISTOGRAM_DOMAIN } from '$lib/features/reliability/domains';
import type { PunctualityVM } from '../clusters';

export interface PunctualityDistributionLabels {
	title: string;
	unit: string;
	xLabel?: string;
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
			reason: vm.headline.delayHistogram == null ? 'histogram-not-published' : 'no-observations',
			variant: 'block',
		};
	}

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
		medianRef: p50 != null ? Math.round(p50 * 60) : null,
		p90Ref: p90 != null ? Math.round(p90 * 60) : null,
	};
}
