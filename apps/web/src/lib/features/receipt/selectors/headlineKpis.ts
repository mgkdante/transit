// Receipt reliability figures; missing readings preserve the shared absence display.

import type { Receipt } from '$lib/v1/schemas';
import type { MetricKey } from '$lib/features/metrics/metrics.content';

/** One headline KPI tile VM (MetricDisplay-ready). */
export interface HeadlineKpiVM {
	readonly key: MetricKey;
	readonly label: string;
	/** Formatted value, or null → the styled honest-absence chip. */
	readonly value: string | null;
	readonly size: 'sm' | 'md' | 'lg';
}

/** Localized labels + formatters the caller supplies (the selector owns no i18n). */
export interface HeadlineKpiLabels {
	readonly onTime: string;
	readonly avgDelay: string;
	readonly severe: string;
	/** "82%" or null. */
	readonly fmtPct: (v: number | null | undefined) => string | null;
	/** "3.4 min" or null. */
	readonly fmtMin: (v: number | null | undefined) => string | null;
	/** "4.2%" (fixed-1 severe share) or null. */
	readonly fmtSeverePct: (v: number | null | undefined) => string | null;
}

/** Build the three reliability KPI VMs from the day's receipt. */
export function selectHeadlineKpis(
	receipt: Pick<Receipt, 'otp_pct' | 'avg_delay_min' | 'severe_pct'>,
	labels: HeadlineKpiLabels,
): HeadlineKpiVM[] {
	return [
		{ key: 'otp', label: labels.onTime, value: labels.fmtPct(receipt.otp_pct), size: 'lg' },
		{
			key: 'avgDelay',
			label: labels.avgDelay,
			value: labels.fmtMin(receipt.avg_delay_min),
			size: 'lg',
		},
		{
			key: 'severe',
			label: labels.severe,
			value: labels.fmtSeverePct(receipt.severe_pct),
			size: 'md',
		},
	];
}
