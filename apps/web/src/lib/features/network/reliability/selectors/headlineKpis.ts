// selectHeadlineKpis — the live headline scalars → formatted ExplainedMetricCard view-models.
//
// S9C / DECISIONS C1: the top live board is FOUR glance cards (on_time_pct, coverage_pct,
// delay_p50_min, delay_p90_min); vehicles_in_service + non_responding move WHOLLY into the
// dedicated vehicles-reporting row (this selector shapes both groups so the section reads one
// mapping pass). Honesty: on_time/coverage/p50/p90 return NULL (not a fabricated 0) on a
// feed-omitted field so the card renders the styled AbsentValue chip with the 'not-reported'
// reason; vehicles/non_responding are contract-required ints (never null → no absence reason).
//
// i18n + formatting stay UPSTREAM: the caller passes the locale-bound formatters, so this
// selector is a pure scalar → VM shaper with no locale dependency.

import type { AbsenceReasonKey } from '$lib/site/absence';
import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
import type { NetworkFile } from '$lib/v1';

/** One live KPI card view-model (an ExplainedMetricCard-ready shape). */
export interface KpiCardVM {
	/** The formatted value, or null → the styled honest-absence chip. */
	readonly value: string | null;
	/** The metric label. */
	readonly label: string;
	/** The metric-explainer key (feeds the (i) affordance + /metrics deep link). */
	readonly key: MetricKey | SupplementalMetricKey;
	/** The absence reason when null (omitted for required-int scalars — never null). */
	readonly absentReason?: AbsenceReasonKey;
}

/** The two card groups: the four-tile headline board + the vehicles-reporting row. */
export interface HeadlineKpisVM {
	/** The four glance cards (C1): otp · coverage · p50 · p90. */
	readonly headline: readonly KpiCardVM[];
	/** The reporting-row cards: vehicles-in-service + non-responding (required ints). */
	readonly reporting: readonly KpiCardVM[];
}

/** The localized labels + formatters the caller supplies (i18n stays upstream). */
export interface HeadlineKpisLabels {
	readonly onTime: string;
	readonly coverage: string;
	readonly delayP50: string;
	readonly delayP90: string;
	readonly vehicles: string;
	readonly notReporting: string;
	/** Nullable percent → "82%" or NULL (renders the styled chip). */
	readonly pctOrNull: (v: number | null) => string | null;
	/** Nullable minute delay → "3 min" or NULL (renders the styled chip). */
	readonly minOrNull: (v: number | null) => string | null;
	/** A required count → plain integer (localized thousands separators). */
	readonly fmtCount: (v: number) => string;
}

export function selectHeadlineKpis(net: NetworkFile, labels: HeadlineKpisLabels): HeadlineKpisVM {
	return {
		headline: [
			{
				value: labels.pctOrNull(net.on_time_pct),
				label: labels.onTime,
				key: 'otp',
				absentReason: 'not-reported',
			},
			{
				value: labels.pctOrNull(net.coverage_pct),
				label: labels.coverage,
				key: 'coverage',
				absentReason: 'not-reported',
			},
			{
				value: labels.minOrNull(net.delay_p50_min),
				label: labels.delayP50,
				key: 'p50p90',
				absentReason: 'not-reported',
			},
			{
				value: labels.minOrNull(net.delay_p90_min),
				label: labels.delayP90,
				key: 'p50p90',
				absentReason: 'not-reported',
			},
		],
		reporting: [
			{
				value: labels.fmtCount(net.vehicles_in_service),
				label: labels.vehicles,
				key: 'vehicleCount',
			},
			{
				value: labels.fmtCount(net.non_responding),
				label: labels.notReporting,
				key: 'silentTrip',
			},
		],
	};
}
