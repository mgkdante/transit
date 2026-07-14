import type { DateWindow } from '$lib/filters';
import { roundHalfAwayFromZero } from '$lib/utils';
import {
	mergeLineHistory,
	selectLineHistoryPartitionRefs,
	wilsonBounds,
	type CancellationPeriod,
	type HistoricCollectionIndex,
	type HistoryRangeLoadResult,
	type LineHistoryRange,
	type LineHistoryPartition,
	type OccupancyMix,
	type ReliabilityPeriod,
	type ServiceSpanPeriod,
	type SkippedStopPeriod,
	type RouteReliability,
} from '$lib/v1';

export interface RetainedLineHistory {
	readonly aggregate: LineHistoryRange;
	readonly periods: readonly ReliabilityPeriod[];
	readonly cancellations: readonly CancellationPeriod[];
	readonly occupancyMix: OccupancyMix | null;
	readonly serviceSpans: readonly ServiceSpanPeriod[];
	readonly skippedStops: readonly SkippedStopPeriod[];
	readonly retainedDayCount: number;
}

const CALENDAR_GRAINS = new Set(['day', 'week', 'month']);

export function clearRetainedLineHistory(current: RouteReliability): RouteReliability {
	return {
		...current,
		periods: (current.periods ?? []).filter((period) => !CALENDAR_GRAINS.has(period.grain)),
		cancellations: [],
		occupancy_mix: null,
		occupancy_by_grain: [
			{ grain: 'day', mix: null },
			...(current.occupancy_by_grain ?? []).filter((entry) => entry.grain !== 'day'),
		],
		service_spans: [],
		skipped_stops: [],
	};
}

export function applyRetainedLineHistory(
	current: RouteReliability,
	retained: RetainedLineHistory,
): RouteReliability {
	return {
		...current,
		periods: [
			...retained.periods,
			...(current.periods ?? []).filter((period) => !CALENDAR_GRAINS.has(period.grain)),
		],
		cancellations: [...retained.cancellations],
		occupancy_mix: retained.occupancyMix,
		occupancy_by_grain: [
			{ grain: 'day', mix: retained.occupancyMix },
			...(current.occupancy_by_grain ?? []).filter((entry) => entry.grain !== 'day'),
		],
		service_spans: [...retained.serviceSpans],
		skipped_stops: [...retained.skippedStops],
	};
}

function partitionsForWindow(
	entityId: string,
	index: HistoricCollectionIndex,
	partitions: readonly LineHistoryPartition[],
	window: DateWindow,
): LineHistoryPartition[] {
	const expectedMonths = new Set(
		selectLineHistoryPartitionRefs(entityId, index, window).map((ref) =>
			ref.coverage_start.slice(0, 7),
		),
	);
	return partitions.filter((partition) => expectedMonths.has(partition.month));
}

function oneDayRange(
	entityId: string,
	index: HistoricCollectionIndex,
	partitions: readonly LineHistoryPartition[],
	date: string,
): LineHistoryRange {
	const window = { from: date, to: date };
	return mergeLineHistory(
		entityId,
		index,
		partitionsForWindow(entityId, index, partitions, window),
		window,
	);
}

function dailyPeriod(date: string, range: LineHistoryRange): ReliabilityPeriod | null {
	const delay = range.delay.value;
	const percentile = range.delayPercentiles.value?.find((entry) => entry.date === date)?.value;
	if (delay == null && percentile == null) return null;
	const wilson = delay == null ? null : wilsonBounds(delay.onTimeCount, delay.observationCount);

	return {
		grain: 'day',
		date,
		otp_pct: delay == null ? null : roundHalfAwayFromZero(delay.otpPct, 0),
		avg_delay_min:
			delay?.averageDelaySeconds == null
				? null
				: roundHalfAwayFromZero(delay.averageDelaySeconds / 60, 1),
		p50_min:
			percentile?.p50_delay_seconds == null
				? null
				: roundHalfAwayFromZero(percentile.p50_delay_seconds / 60, 1),
		p90_min:
			percentile?.p90_delay_seconds == null
				? null
				: roundHalfAwayFromZero(percentile.p90_delay_seconds / 60, 1),
		severe_pct: delay == null ? null : roundHalfAwayFromZero(delay.severePct, 1),
		observation_count: delay?.observationCount ?? null,
		on_time: delay?.onTimeCount ?? null,
		wilson_lo: wilson?.[0] ?? null,
		wilson_hi: wilson?.[1] ?? null,
	};
}

function dailyCancellation(date: string, range: LineHistoryRange): CancellationPeriod | null {
	const value = range.cancellation.value;
	if (value == null) return null;
	return {
		grain: 'day',
		date,
		cancellation_rate_pct:
			value.cancellationRatePct == null
				? null
				: roundHalfAwayFromZero(value.cancellationRatePct, 2),
		canceled_trip_days: value.canceledTripDays,
		total_trip_days: value.totalTripDays,
		scheduled_trip_days: value.scheduledTripDays,
		delivered_trip_days: value.deliveredTripDays,
		silent_trip_days: value.silentTripDays,
		service_completeness_pct:
			value.completenessPct == null
				? null
				: Math.min(100, roundHalfAwayFromZero(value.completenessPct, 2)),
	};
}

function spanMinutes(first: string | null | undefined, last: string | null | undefined) {
	if (first == null || last == null) return null;
	const firstMs = Date.parse(first);
	const lastMs = Date.parse(last);
	if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return null;
	return roundHalfAwayFromZero((lastMs - firstMs) / 60_000, 0);
}

function dailyServiceSpan(date: string, range: LineHistoryRange): ServiceSpanPeriod | null {
	const value = range.serviceSpan.value?.find((entry) => entry.date === date)?.value;
	if (value == null) return null;
	return {
		date,
		first_trip_utc: value.first_trip_utc ?? null,
		last_trip_utc: value.last_trip_utc ?? null,
		service_span_min: spanMinutes(value.first_trip_utc, value.last_trip_utc),
		first_trip_delay_min:
			value.first_trip_delay_seconds == null
				? null
				: roundHalfAwayFromZero(value.first_trip_delay_seconds / 60, 1),
		last_trip_delay_min:
			value.last_trip_delay_seconds == null
				? null
				: roundHalfAwayFromZero(value.last_trip_delay_seconds / 60, 1),
		trip_count: value.trip_count,
	};
}

function dailySkippedStops(date: string, range: LineHistoryRange): SkippedStopPeriod | null {
	const value = range.skippedStops.value;
	if (value == null) return null;
	return {
		date,
		skipped_stop_rate_pct: roundHalfAwayFromZero(value.skippedStopRatePct, 2),
		skipped_stop_count: value.skippedStopCount,
		stop_time_update_count: value.stopTimeUpdateCount,
	};
}

function allChannelsComplete(range: LineHistoryRange): boolean {
	return [
		range.delay,
		range.delayPercentiles,
		range.cancellation,
		range.occupancy,
		range.serviceSpan,
		range.skippedStops,
	].every((metric) => metric.status === 'complete');
}

export function buildRetainedLineHistory(
	entityId: string,
	index: HistoricCollectionIndex,
	partitions: readonly LineHistoryPartition[],
	window: DateWindow,
): HistoryRangeLoadResult<RetainedLineHistory> {
	const aggregate = mergeLineHistory(entityId, index, partitions, window);
	const dates = [
		...new Set(
			partitions.flatMap((partition) =>
				partition.days
					.filter((day) => window.from <= day.date && day.date <= window.to)
					.map((day) => day.date),
			),
		),
	].sort();
	const daily = dates.map((date) => ({
		date,
		range: oneDayRange(entityId, index, partitions, date),
	}));
	const retainedDayCount = daily.filter(({ range }) => range.delay.value != null).length;
	const periods = daily.flatMap(({ date, range }) => {
		const value = dailyPeriod(date, range);
		return value == null ? [] : [value];
	});
	const cancellations = daily.flatMap(({ date, range }) => {
		const value = dailyCancellation(date, range);
		return value == null ? [] : [value];
	});
	const serviceSpans = daily.flatMap(({ date, range }) => {
		const value = dailyServiceSpan(date, range);
		return value == null ? [] : [value];
	});
	const skippedStops = daily.flatMap(({ date, range }) => {
		const value = dailySkippedStops(date, range);
		return value == null ? [] : [value];
	});
	const occupancyMix = aggregate.occupancy.value?.mix ?? null;
	const hasValue =
		periods.length > 0 ||
		cancellations.length > 0 ||
		serviceSpans.length > 0 ||
		skippedStops.length > 0 ||
		occupancyMix != null;
	if (!hasValue) return { value: null, status: 'no_data' };

	return {
		value: {
			aggregate,
			periods,
			cancellations,
			occupancyMix,
			serviceSpans,
			skippedStops,
			retainedDayCount,
		},
		status: allChannelsComplete(aggregate) ? 'complete' : 'partial',
	};
}
