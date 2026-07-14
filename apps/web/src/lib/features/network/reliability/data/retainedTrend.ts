import type { DateWindow } from '$lib/filters';
import { roundHalfAwayFromZero } from '$lib/utils';
import type { HistoryRangeLoadResult } from '$lib/v1/history/rangeResource.svelte';
import {
	mergeNetworkHistory,
	selectNetworkHistoryPartitionRefs,
	type NetworkHistoryRange,
} from '$lib/v1/history/families';
import { addIsoDays } from '$lib/v1/history/selection';
import type { HistoricCollectionIndex, NetworkHistoryPartition, TrendPoint } from '$lib/v1/schemas';
import { wilsonBounds } from '$lib/v1/stats';

export interface RetainedNetworkTrend {
	readonly series: readonly TrendPoint[];
	readonly weekly: readonly TrendPoint[];
	readonly monthly: readonly TrendPoint[];
}

function pointFromRange(
	date: string,
	range: NetworkHistoryRange,
	includeDailyOnly: boolean,
): TrendPoint {
	const delay = range.delay.value;
	const cancellation = range.cancellation.value;
	const percentile = includeDailyOnly
		? (range.delayPercentiles.value?.find((entry) => entry.date === date)?.value ?? null)
		: null;
	const vehicles = includeDailyOnly
		? (range.vehicles.value?.find((entry) => entry.date === date)?.value ?? null)
		: null;
	const wilson = delay == null ? null : wilsonBounds(delay.onTimeCount, delay.observationCount);

	return {
		date,
		otp_pct: delay == null ? null : roundHalfAwayFromZero(delay.otpPct, 0),
		avg_delay_min:
			delay?.averageDelaySeconds == null
				? null
				: roundHalfAwayFromZero(delay.averageDelaySeconds / 60, 1),
		p90_min:
			percentile?.p90_delay_seconds == null
				? null
				: roundHalfAwayFromZero(percentile.p90_delay_seconds / 60, 1),
		vehicles,
		cancellation_rate:
			cancellation?.cancellationRatePct == null
				? null
				: roundHalfAwayFromZero(cancellation.cancellationRatePct, 2),
		service_completeness_rate:
			cancellation?.completenessPct == null
				? null
				: Math.min(100, roundHalfAwayFromZero(cancellation.completenessPct, 2)),
		occupancy_mix: range.occupancy.value?.mix ?? null,
		observation_count: delay?.observationCount ?? null,
		wilson_lo: wilson?.[0] ?? null,
		wilson_hi: wilson?.[1] ?? null,
	};
}

function hasDisplayedData(point: TrendPoint): boolean {
	return Object.entries(point).some(([key, value]) => key !== 'date' && value !== null);
}

function partitionsForWindow(
	index: HistoricCollectionIndex,
	partitions: readonly NetworkHistoryPartition[],
	window: DateWindow,
): NetworkHistoryPartition[] {
	const expectedMonths = new Set(
		selectNetworkHistoryPartitionRefs(index, window).map((ref) => ref.coverage_start.slice(0, 7)),
	);
	return partitions.filter((partition) => expectedMonths.has(partition.month));
}

function mergeBucket(
	index: HistoricCollectionIndex,
	partitions: readonly NetworkHistoryPartition[],
	window: DateWindow,
): NetworkHistoryRange {
	return mergeNetworkHistory(index, partitionsForWindow(index, partitions, window), window);
}

function isoWeekStart(date: string): string {
	const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
	return addIsoDays(date, -((day + 6) % 7));
}

function monthEnd(monthStart: string): string {
	const year = Number(monthStart.slice(0, 4));
	const month = Number(monthStart.slice(5, 7));
	const nextYear = month === 12 ? year + 1 : year;
	const nextMonth = month === 12 ? 1 : month + 1;
	return addIsoDays(
		`${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`,
		-1,
	);
}

function clippedWindow(window: DateWindow, start: string, end: string): DateWindow {
	return {
		from: window.from > start ? window.from : start,
		to: window.to < end ? window.to : end,
	};
}

function coarsePoints(
	grain: 'week' | 'month',
	dates: readonly string[],
	index: HistoricCollectionIndex,
	partitions: readonly NetworkHistoryPartition[],
	window: DateWindow,
): TrendPoint[] {
	const starts = [
		...new Set(
			dates.map((date) => (grain === 'week' ? isoWeekStart(date) : `${date.slice(0, 7)}-01`)),
		),
	].sort();

	return starts.flatMap((start) => {
		const end = grain === 'week' ? addIsoDays(start, 6) : monthEnd(start);
		const bucket = clippedWindow(window, start, end);
		const point = pointFromRange(start, mergeBucket(index, partitions, bucket), false);
		return hasDisplayedData(point) ? [point] : [];
	});
}

function intersectsCollectionGap(index: HistoricCollectionIndex, window: DateWindow): boolean {
	return (index.gaps ?? []).some(
		(gap) => gap.start_date <= window.to && gap.end_date >= window.from,
	);
}

function allMetricsComplete(range: NetworkHistoryRange): boolean {
	return [
		range.delay,
		range.delayPercentiles,
		range.vehicles,
		range.cancellation,
		range.occupancy,
	].every((metric) => metric.status === 'complete');
}

export function buildRetainedNetworkTrend(
	index: HistoricCollectionIndex,
	partitions: readonly NetworkHistoryPartition[],
	window: DateWindow,
): HistoryRangeLoadResult<RetainedNetworkTrend> {
	const fullRange = mergeNetworkHistory(index, partitions, window);
	const dates = [
		...new Set(
			partitions.flatMap((partition) =>
				partition.days
					.filter((day) => window.from <= day.date && day.date <= window.to)
					.map((day) => day.date),
			),
		),
	].sort();
	const series = dates.flatMap((date) => {
		const point = pointFromRange(
			date,
			mergeBucket(index, partitions, { from: date, to: date }),
			true,
		);
		return hasDisplayedData(point) ? [point] : [];
	});

	if (series.length === 0) return { value: null, status: 'no_data' };

	const value: RetainedNetworkTrend = {
		series,
		weekly: coarsePoints('week', dates, index, partitions, window),
		monthly: coarsePoints('month', dates, index, partitions, window),
	};
	const status =
		allMetricsComplete(fullRange) && !intersectsCollectionGap(index, window)
			? 'complete'
			: 'partial';
	return { value, status };
}
