import type { Receipt } from '$lib/v1/schemas';
import type { MetricKey } from '$lib/features/metrics/metrics.content';

export interface HeadlineKpiVM {
	readonly key: MetricKey;
	readonly label: string;
	readonly value: string | null;
	readonly size: 'sm' | 'md' | 'lg';
}

export interface HeadlineKpiLabels {
	readonly onTime: string;
	readonly avgDelay: string;
	readonly severe: string;
	readonly fmtPct: (v: number | null | undefined) => string | null;
	readonly fmtMin: (v: number | null | undefined) => string | null;
	readonly fmtSeverePct: (v: number | null | undefined) => string | null;
}

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
