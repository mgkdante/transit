// headlineKpis — the receipt's four headline KPI view-models (S13).
//
// Ports the AccountabilityReceipt inline `kpi` formatting into a PURE presenter: the
// day's on-time %, average delay, severe-delay share, and rider-impact score, each a
// VM carrying its formatted display (null → the MetricDisplay honest-absence chip,
// NEVER a fabricated 0) + its metric-explainer key + tile size. A real measured 0
// stays a real 0; only a null reading reads the styled 'no-observations' chip.

import type { Receipt } from '$lib/v1/schemas';
import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';

/** One headline KPI tile VM (MetricDisplay-ready). */
export interface HeadlineKpiVM {
	readonly key: MetricKey | SupplementalMetricKey;
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
	readonly riderImpact: string;
	/** "82%" or null. */
	readonly fmtPct: (v: number | null | undefined) => string | null;
	/** "3.4 min" or null. */
	readonly fmtMin: (v: number | null | undefined) => string | null;
	/** "4.2%" (fixed-1 severe share) or null. */
	readonly fmtSeverePct: (v: number | null | undefined) => string | null;
	/** "7.2" (rider-impact score) or null. */
	readonly fmtScore: (v: number | null | undefined) => string | null;
}

/** Build the four headline KPI VMs from the day's receipt. */
export function selectHeadlineKpis(
	receipt: Pick<Receipt, 'otp_pct' | 'avg_delay_min' | 'severe_pct' | 'rider_impact_score'>,
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
		{
			key: 'riderImpact',
			label: labels.riderImpact,
			value: labels.fmtScore(receipt.rider_impact_score),
			size: 'md',
		},
	];
}
