import type { Locale } from '$lib/i18n';
import type {
	AbsenceSpec,
	AbsoluteDomain,
	HistogramBin,
	HistogramSpec,
} from '$lib/components/dataviz/chart';
import { NETWORK_DELAY_HISTOGRAM_DOMAIN } from '$lib/features/reliability/domains';
import type { DelayBucket } from '$lib/v1/schemas';

export interface DelayHistogramLabels {
	title: string;
	caption: string;
	unit: string;
	xLabel: string;
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

	const bins: HistogramBin[] = rows.map((b) => ({
		lo: b.lo_min == null ? null : b.lo_min * MIN_TO_SEC,
		hi: b.hi_min == null ? null : b.hi_min * MIN_TO_SEC,
		count: b.count,
	}));

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
