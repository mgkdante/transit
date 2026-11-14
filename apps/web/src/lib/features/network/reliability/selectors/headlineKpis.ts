import type { AbsenceReasonKey } from '#lib/site/absence.ts';
import type { MetricKey, SupplementalMetricKey } from '#lib/features/metrics/metrics.content.ts';
import type { NetworkLiveView as NetworkFile } from '#lib/v1/reliabilityView.ts';

export interface KpiCardVM {
	readonly value: string | null;
	readonly label: string;
	readonly key: MetricKey | SupplementalMetricKey;
	readonly absentReason?: AbsenceReasonKey;
}

export interface HeadlineKpisVM {
	readonly headline: readonly KpiCardVM[];
	readonly reporting: readonly KpiCardVM[];
}

export interface HeadlineKpisLabels {
	readonly onTime: string;
	readonly coverage: string;
	readonly delayP50: string;
	readonly delayP90: string;
	readonly vehicles: string;
	readonly notReporting: string;
	readonly pctOrNull: (v: number | null) => string | null;
	readonly minOrNull: (v: number | null) => string | null;
	readonly fmtCount: (v: number) => string;
}

export function selectHeadlineKpis(net: NetworkFile, labels: HeadlineKpisLabels): HeadlineKpisVM {
	return {
		headline: [
			{
				value: labels.pctOrNull(net.onTimePct),
				label: labels.onTime,
				key: 'liveOtp',
				absentReason: 'not-reported',
			},
			{
				value: labels.pctOrNull(net.coveragePct),
				label: labels.coverage,
				key: 'coverage',
				absentReason: 'not-reported',
			},
			{
				value: labels.minOrNull(net.p50Min),
				label: labels.delayP50,
				key: 'liveDelayPercentiles',
				absentReason: 'not-reported',
			},
			{
				value: labels.minOrNull(net.p90Min),
				label: labels.delayP90,
				key: 'liveDelayPercentiles',
				absentReason: 'not-reported',
			},
		],
		reporting: [
			{
				value: labels.fmtCount(net.vehicles),
				label: labels.vehicles,
				key: 'vehicleCount',
			},
			{
				value: labels.fmtCount(net.silentTrips),
				label: labels.notReporting,
				key: 'silentTrip',
			},
		],
	};
}
