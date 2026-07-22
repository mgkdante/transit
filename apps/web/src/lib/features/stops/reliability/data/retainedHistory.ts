import type { DateWindow } from '$lib/filters';

import { roundHalfAwayFromZero } from '$lib/utils';
import { mergeStopHistory, selectStopHistoryPartitionRefs } from '$lib/v1/history/families';
import type {
	HistoricCollectionIndex,
	HistoryRangeLoadResult,
	OccupancyMix,
	StopDailyPoint,
	StopHistoryPartition,
	StopHistoryRange,
	StopReliability,
} from '$lib/v1';

export interface RetainedStopHistory {
	readonly aggregate: StopHistoryRange;
	readonly daily: readonly StopDailyPoint[];
	readonly occupancyMix: OccupancyMix | null;
	readonly retainedDayCount: number;
}

export function clearRetainedStopHistory(current: StopReliability): StopReliability {
	return { ...current, daily: [], occupancy_mix: null };
}

export function applyRetainedStopHistory(
	current: StopReliability,
	retained: RetainedStopHistory,
): StopReliability {
	return {
		...current,
		daily: [...retained.daily],
		occupancy_mix: retained.occupancyMix,
	};
}

function partitionsForWindow(
	entityId: string,
	index: HistoricCollectionIndex,
	partitions: readonly StopHistoryPartition[],
	window: DateWindow,
): StopHistoryPartition[] {
	const expectedMonths = new Set(
		selectStopHistoryPartitionRefs(entityId, index, window).map((ref) =>
			ref.coverage_start.slice(0, 7),
		),
	);
	return partitions.filter((partition) => expectedMonths.has(partition.month));
}

function oneDayRange(
	entityId: string,
	index: HistoricCollectionIndex,
	partitions: readonly StopHistoryPartition[],
	date: string,
): StopHistoryRange {
	const window = { from: date, to: date };
	return mergeStopHistory(
		entityId,
		index,
		partitionsForWindow(entityId, index, partitions, window),
		window,
	);
}

function dailyPoint(date: string, range: StopHistoryRange): StopDailyPoint | null {
	const delay = range.delay.value;
	if (delay == null) return null;
	return {
		date,
		observation_count: delay.inClampObservationCount,
		severe_count: delay.severeCount,
		severe_pct: roundHalfAwayFromZero(delay.severePct, 1),
		avg_delay_min: roundHalfAwayFromZero(delay.averageDelaySeconds / 60, 1),
	};
}

function allChannelsComplete(range: StopHistoryRange): boolean {
	return [range.delay, range.delayPercentiles, range.occupancy].every(
		(metric) => metric.status === 'complete',
	);
}

export function buildRetainedStopHistory(
	entityId: string,
	index: HistoricCollectionIndex,
	partitions: readonly StopHistoryPartition[],
	window: DateWindow,
): HistoryRangeLoadResult<RetainedStopHistory> {
	const aggregate = mergeStopHistory(entityId, index, partitions, window);
	const dates = [
		...new Set(
			partitions.flatMap((partition) =>
				partition.days
					.filter((day) => window.from <= day.date && day.date <= window.to)
					.map((day) => day.date),
			),
		),
	].sort();
	const daily = dates.flatMap((date) => {
		const value = dailyPoint(date, oneDayRange(entityId, index, partitions, date));
		return value == null ? [] : [value];
	});
	const occupancyMix = aggregate.occupancy.value?.mix ?? null;
	if (daily.length === 0 && occupancyMix == null) return { status: 'no_data', value: null };

	return {
		status: allChannelsComplete(aggregate) ? 'complete' : 'partial',
		value: {
			aggregate,
			daily,
			occupancyMix,
			retainedDayCount: daily.length,
		},
	};
}
