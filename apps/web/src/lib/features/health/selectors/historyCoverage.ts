import type {
	HistoricAvailabilityIndex,
	HistoricCoverageGap,
	HistoricFamilyAvailability,
	HistoricMetricCoverage,
	HistoryMetricAggregation,
	HistoryMetricName,
	HistorySelectionMode,
} from '$lib/v1/schemas';
import {
	LINE_CURRENT_ONLY_SECTIONS,
	NETWORK_CURRENT_ONLY_SECTIONS,
	STOP_CURRENT_ONLY_SECTIONS,
} from '$lib/v1/history/families';

const HISTORY_COVERAGE_FAMILIES = [
	'alerts',
	'receipts',
	'network',
	'lines',
	'stops',
	'hotspots',
	'repeat_offenders',
] as const;

export type HistoryCoverageFamilyKey = (typeof HISTORY_COVERAGE_FAMILIES)[number];

export interface HistoryCoverageGapView {
	readonly startDate: string;
	readonly endDate: string;
	readonly reason: string | null;
}

export interface HistoryCoverageMetricView {
	readonly key: HistoryMetricName;
	readonly aggregation: HistoryMetricAggregation;
	readonly firstDate: string | null;
	readonly lastDate: string | null;
	readonly gaps: readonly HistoryCoverageGapView[] | null;
}

export interface HistoryCoverageFamilyView {
	readonly key: HistoryCoverageFamilyKey;
	readonly published: boolean;
	readonly selectionMode: HistorySelectionMode | null;
	readonly firstDate: string | null;
	readonly lastDate: string | null;
	readonly gaps: readonly HistoryCoverageGapView[] | null;
	readonly metrics: readonly HistoryCoverageMetricView[];
	readonly currentOnlySections: readonly string[];
}

function date(value: string | null | undefined): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function gaps(values: readonly HistoricCoverageGap[] | undefined): HistoryCoverageGapView[] | null {
	if (values === undefined) return null;
	return values.map((gap) => ({
		startDate: gap.start_date,
		endDate: gap.end_date,
		reason: gap.reason?.trim() || null,
	}));
}

function metrics(
	values: readonly HistoricMetricCoverage[] | undefined,
): HistoryCoverageMetricView[] {
	return (values ?? []).map((metric) => ({
		key: metric.metric,
		aggregation: metric.aggregation,
		firstDate: date(metric.first_available_date),
		lastDate: date(metric.last_available_date),
		gaps: gaps(metric.gaps),
	}));
}

function currentOnlySections(key: HistoryCoverageFamilyKey): readonly string[] {
	if (key === 'network') return NETWORK_CURRENT_ONLY_SECTIONS;
	if (key === 'lines') return LINE_CURRENT_ONLY_SECTIONS;
	if (key === 'stops') return STOP_CURRENT_ONLY_SECTIONS;
	return [];
}

function row(
	key: HistoryCoverageFamilyKey,
	published: HistoricFamilyAvailability | undefined,
): HistoryCoverageFamilyView {
	const metricRows = metrics(published?.metrics);
	return {
		key,
		published: published !== undefined,
		selectionMode: published?.selection_mode ?? null,
		firstDate: date(published?.first_available_date),
		lastDate: date(published?.last_available_date),
		gaps: gaps(published?.gaps),
		metrics: metricRows,
		currentOnlySections: currentOnlySections(key),
	};
}

/**
 * Turn the optional retained-history root into the exact public family ledger.
 * A legacy/empty root stands down. Once the root publishes at least one family,
 * every expected family is retained in the view so omissions stay visible.
 */
export function selectHistoryCoverage(
	root: HistoricAvailabilityIndex | null | undefined,
): readonly HistoryCoverageFamilyView[] {
	const families = root?.families ?? [];
	if (families.length === 0) return [];

	return HISTORY_COVERAGE_FAMILIES.map((key) =>
		row(
			key,
			families.find((family) => family.family === key),
		),
	);
}
