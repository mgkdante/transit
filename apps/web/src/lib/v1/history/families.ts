import type { DateWindow } from '$lib/filters';
import type {
	HistoricCollectionIndex,
	HistoricCancellationMetric,
	HistoricDelayMetric,
	HistoricDelayPercentiles,
	HistoricMetricCoverage,
	HistoricOccupancyMetric,
	HistoricPartitionRef,
	HistoricServiceSpanMetric,
	LineHistoryDay,
	LineHistoryPartition,
	NetworkHistoryDay,
	NetworkHistoryPartition,
	StopHistoryDay,
	StopHistoryPartition,
} from '$lib/v1/schemas';
import { encodeHistoryEntityId } from './entity';
import { HistoryArtifactContractError } from './partitions';
import { strictIsoDate } from './selection';

type Family = 'network' | 'lines' | 'stops';
type HistoryDay = NetworkHistoryDay | LineHistoryDay | StopHistoryDay;

export type HistoryValue<T> =
	| { readonly status: 'complete' | 'partial'; readonly value: T }
	| { readonly status: 'no_data' | 'current_only'; readonly value: null };

export interface DatedHistoryValue<T> {
	readonly date: string;
	readonly value: T;
}

export interface DelayHistoryAggregate {
	readonly observationCount: number;
	readonly inClampObservationCount: number | null;
	readonly onTimeCount: number;
	readonly severeCount: number;
	readonly sumDelaySeconds: number | null;
	readonly otpPct: number;
	readonly severePct: number;
	readonly averageDelaySeconds: number | null;
}

export interface StopDelayHistoryAggregate {
	readonly observationCount: number;
	readonly inClampObservationCount: number;
	readonly severeCount: number;
	readonly sumDelaySeconds: number;
	readonly severePct: number;
	readonly averageDelaySeconds: number;
}

export interface CancellationHistoryAggregate {
	readonly canceledTripDays: number;
	readonly totalTripDays: number;
	readonly cancellationRatePct: number | null;
	readonly scheduledTripDays: number | null;
	readonly deliveredTripDays: number | null;
	readonly silentTripDays: number | null;
	readonly completenessPct: number | null;
}

export interface OccupancyHistoryAggregate {
	readonly counts: Readonly<HistoricOccupancyMetric>;
	readonly totalCount: number;
	readonly mix: Readonly<HistoricOccupancyMetric>;
}

export interface SkippedStopsHistoryAggregate {
	readonly skippedStopCount: number;
	readonly stopTimeUpdateCount: number;
	readonly skippedStopRatePct: number;
}

export const NETWORK_CURRENT_ONLY_SECTIONS = ['live_status', 'by_shift', 'by_daytype'] as const;
export const LINE_CURRENT_ONLY_SECTIONS = [
	'identity',
	'live_status',
	'headway',
	'habits',
	'weak_stops',
	'by_shift',
	'by_daytype',
	'by_crowding',
] as const;
export const STOP_CURRENT_ONLY_SECTIONS = [
	'identity',
	'live_status',
	'periods',
	'habits',
	'weekday',
	'time_of_day',
	'by_route',
] as const;

type CurrentOnlyMap<TSections extends readonly string[]> = Readonly<
	Record<TSections[number], HistoryValue<never>>
>;

interface BaseHistoryRange {
	readonly window: DateWindow;
}

export interface NetworkHistoryRange extends BaseHistoryRange {
	readonly family: 'network';
	readonly delay: HistoryValue<DelayHistoryAggregate>;
	readonly delayPercentiles: HistoryValue<readonly DatedHistoryValue<HistoricDelayPercentiles>[]>;
	readonly vehicles: HistoryValue<readonly DatedHistoryValue<number>[]>;
	readonly cancellation: HistoryValue<CancellationHistoryAggregate>;
	readonly occupancy: HistoryValue<OccupancyHistoryAggregate>;
	readonly currentOnly: CurrentOnlyMap<typeof NETWORK_CURRENT_ONLY_SECTIONS>;
}

export interface LineHistoryRange extends BaseHistoryRange {
	readonly family: 'lines';
	readonly entityId: string;
	readonly delay: HistoryValue<DelayHistoryAggregate>;
	readonly delayPercentiles: HistoryValue<readonly DatedHistoryValue<HistoricDelayPercentiles>[]>;
	readonly cancellation: HistoryValue<CancellationHistoryAggregate>;
	readonly occupancy: HistoryValue<OccupancyHistoryAggregate>;
	readonly serviceSpan: HistoryValue<readonly DatedHistoryValue<HistoricServiceSpanMetric>[]>;
	readonly skippedStops: HistoryValue<SkippedStopsHistoryAggregate>;
	readonly currentOnly: CurrentOnlyMap<typeof LINE_CURRENT_ONLY_SECTIONS>;
}

export interface StopHistoryRange extends BaseHistoryRange {
	readonly family: 'stops';
	readonly entityId: string;
	readonly delay: HistoryValue<StopDelayHistoryAggregate>;
	readonly delayPercentiles: HistoryValue<readonly DatedHistoryValue<HistoricDelayPercentiles>[]>;
	readonly occupancy: HistoryValue<OccupancyHistoryAggregate>;
	readonly currentOnly: CurrentOnlyMap<typeof STOP_CURRENT_ONLY_SECTIONS>;
}

const SHA256 = /^[0-9a-f]{64}$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;

const FAMILY_METRICS: Readonly<
	Record<
		Family,
		Readonly<
			Partial<Record<HistoricMetricCoverage['metric'], HistoricMetricCoverage['aggregation']>>
		>
	>
> = {
	network: {
		delay: 'additive',
		delay_percentiles: 'daily_only',
		vehicles: 'daily_only',
		cancellation: 'additive',
		occupancy: 'additive',
	},
	lines: {
		delay: 'additive',
		delay_percentiles: 'daily_only',
		cancellation: 'additive',
		occupancy: 'additive',
		service_span: 'daily_only',
		skipped_stops: 'additive',
	},
	stops: {
		delay: 'additive',
		delay_percentiles: 'daily_only',
		occupancy: 'additive',
	},
};

function contract(path: string, message: string): never {
	throw new HistoryArtifactContractError(path, message);
}

function safeInteger(
	value: unknown,
	path: string,
	field: string,
	minimum = 0,
): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) {
		contract(path, `${field} must be a safe integer >= ${minimum}`);
	}
}

function optionalSafeInteger(value: unknown, path: string, field: string, minimum = 0): void {
	if (value != null) safeInteger(value, path, field, minimum);
}

function assertWindow(window: DateWindow): void {
	if (!strictIsoDate(window.from) || !strictIsoDate(window.to) || window.from > window.to) {
		throw new RangeError('History window must be an ordered pair of real ISO dates.');
	}
}

function assertMetricCoverage(
	family: Family,
	index: HistoricCollectionIndex,
	path: string,
): Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage> {
	const coverages = new Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>();
	for (const coverage of index.metrics ?? []) {
		if (coverages.has(coverage.metric)) {
			contract(path, `duplicate metric coverage for ${coverage.metric}`);
		}
		const aggregation = FAMILY_METRICS[family][coverage.metric];
		if (aggregation === undefined || coverage.aggregation !== aggregation) {
			contract(path, `invalid ${family} metric coverage for ${coverage.metric}`);
		}

		const first = coverage.first_available_date;
		const last = coverage.last_available_date;
		if ((first == null) !== (last == null)) {
			contract(path, `incomplete metric coverage bounds for ${coverage.metric}`);
		}
		if (first != null && last != null) {
			if (!strictIsoDate(first) || !strictIsoDate(last) || first > last) {
				contract(path, `invalid metric coverage bounds for ${coverage.metric}`);
			}
		}
		for (const gap of coverage.gaps ?? []) {
			if (
				!strictIsoDate(gap.start_date) ||
				!strictIsoDate(gap.end_date) ||
				gap.start_date > gap.end_date ||
				first == null ||
				last == null ||
				gap.start_date < first ||
				gap.end_date > last
			) {
				contract(path, `invalid metric coverage gap for ${coverage.metric}`);
			}
		}
		coverages.set(coverage.metric, coverage);
	}
	return coverages;
}

function indexPath(family: Family, entityId: string | null): string {
	if (family === 'network') return 'historic/history/network/index.json';
	const encoded = entityId == null ? 'missing' : encodeHistoryEntityId(entityId);
	return `historic/history/${family}/${encoded}/index.json`;
}

function assertCollectionCoverage(
	index: HistoricCollectionIndex,
	path: string,
	firstRefDate: string | null,
	lastRefDate: string | null,
	coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>,
): void {
	const first = index.first_available_date;
	const last = index.last_available_date;
	const gaps = index.gaps ?? [];
	if (firstRefDate == null || lastRefDate == null) {
		if (first != null || last != null || gaps.length > 0) {
			contract(path, 'empty collection must not advertise retained coverage');
		}
		for (const coverage of coverages.values()) {
			if (
				coverage.first_available_date != null ||
				coverage.last_available_date != null ||
				(coverage.gaps ?? []).length > 0
			) {
				contract(path, 'empty collection must not advertise metric coverage');
			}
		}
		return;
	}
	if (
		first == null ||
		last == null ||
		!strictIsoDate(first) ||
		!strictIsoDate(last) ||
		first > last ||
		first !== firstRefDate ||
		last !== lastRefDate
	) {
		contract(path, 'collection coverage must match its advertised partitions');
	}

	let previousGapEnd = '';
	for (const gap of gaps) {
		if (
			!strictIsoDate(gap.start_date) ||
			!strictIsoDate(gap.end_date) ||
			gap.start_date > gap.end_date ||
			gap.start_date <= first ||
			gap.end_date >= last ||
			gap.start_date <= previousGapEnd
		) {
			contract(path, 'collection coverage gaps must be ordered and internal');
		}
		previousGapEnd = gap.end_date;
	}

	let firstMetricDate: string | null = null;
	let lastMetricDate: string | null = null;
	for (const coverage of coverages.values()) {
		const metricFirst = coverage.first_available_date;
		const metricLast = coverage.last_available_date;
		if (metricFirst == null || metricLast == null) continue;
		if (metricFirst < first || metricLast > last) {
			contract(path, `${coverage.metric} coverage falls outside the collection`);
		}
		if (firstMetricDate == null || metricFirst < firstMetricDate) firstMetricDate = metricFirst;
		if (lastMetricDate == null || metricLast > lastMetricDate) lastMetricDate = metricLast;
	}
	if (firstMetricDate !== first || lastMetricDate !== last) {
		contract(path, 'collection coverage must equal the union of metric coverage');
	}
}

function assertCollectionIndex(
	family: Family,
	entityId: string | null,
	index: HistoricCollectionIndex,
): Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage> {
	const path = indexPath(family, entityId);
	if (index.family !== family || index.selection_mode !== 'range') {
		contract(path, `expected ${family} range collection index`);
	}
	if (family === 'network') {
		if (index.entity_id != null) contract(path, 'network collection must not carry entity_id');
	} else if (index.entity_id !== entityId) {
		contract(path, `collection entity mismatch (received ${String(index.entity_id)})`);
	}
	if (!SHA256.test(index.collection_generation_id ?? '')) {
		contract(path, 'collection_generation_id must be lowercase SHA-256');
	}

	const coverages = assertMetricCoverage(family, index, path);
	const paths = new Set<string>();
	const months = new Set<string>();
	let firstRefDate: string | null = null;
	let lastRefDate: string | null = null;
	for (const ref of index.partitions ?? []) {
		const month = assertPartitionRef(family, entityId, ref);
		if (paths.has(ref.path)) contract(ref.path, 'duplicate advertised partition path');
		if (months.has(month)) contract(ref.path, `duplicate advertised partition month ${month}`);
		paths.add(ref.path);
		months.add(month);
		if (firstRefDate == null || ref.coverage_start < firstRefDate) {
			firstRefDate = ref.coverage_start;
		}
		if (lastRefDate == null || ref.coverage_end > lastRefDate) {
			lastRefDate = ref.coverage_end;
		}
	}
	assertCollectionCoverage(index, path, firstRefDate, lastRefDate, coverages);
	return coverages;
}

function assertPartitionRef(
	family: Family,
	entityId: string | null,
	ref: HistoricPartitionRef,
): string {
	const path = ref.path;
	if (
		!strictIsoDate(ref.coverage_start) ||
		!strictIsoDate(ref.coverage_end) ||
		ref.coverage_start > ref.coverage_end
	) {
		contract(path, 'invalid advertised partition coverage');
	}
	const month = ref.coverage_start.slice(0, 7);
	if (!MONTH.test(month) || ref.coverage_end.slice(0, 7) !== month) {
		contract(path, 'partition coverage must stay inside one calendar month');
	}
	if (!SHA256.test(ref.sha256 ?? '')) {
		contract(path, 'partition sha256 must be lowercase SHA-256');
	}
	safeInteger(ref.count, path, 'count', 1);
	safeInteger(ref.byte_size, path, 'byte_size', 1);

	const encoded = family === 'network' ? '' : `${encodeHistoryEntityId(entityId ?? '')}/`;
	const expected = `historic/history/${family}/${encoded}generations/${ref.sha256}/${month}.json`;
	if (path !== expected) contract(path, `partition path must equal ${expected}`);
	return month;
}

function selectPartitionRefs(
	family: Family,
	entityId: string | null,
	index: HistoricCollectionIndex,
	window: DateWindow,
): HistoricPartitionRef[] {
	assertWindow(window);
	assertCollectionIndex(family, entityId, index);
	return [...(index.partitions ?? [])]
		.filter((ref) => ref.coverage_start <= window.to && ref.coverage_end >= window.from)
		.sort((left, right) => {
			const leftMonth = left.coverage_start.slice(0, 7);
			const rightMonth = right.coverage_start.slice(0, 7);
			return leftMonth.localeCompare(rightMonth) || left.path.localeCompare(right.path);
		});
}

export function selectNetworkHistoryPartitionRefs(
	index: HistoricCollectionIndex,
	window: DateWindow,
): HistoricPartitionRef[] {
	return selectPartitionRefs('network', null, index, window);
}

export function selectLineHistoryPartitionRefs(
	entityId: string,
	index: HistoricCollectionIndex,
	window: DateWindow,
): HistoricPartitionRef[] {
	return selectPartitionRefs('lines', entityId, index, window);
}

export function selectStopHistoryPartitionRefs(
	entityId: string,
	index: HistoricCollectionIndex,
	window: DateWindow,
): HistoricPartitionRef[] {
	return selectPartitionRefs('stops', entityId, index, window);
}

function assertDelay(family: Family, delay: NonNullable<HistoryDay['delay']>, path: string): void {
	safeInteger(delay.observation_count, path, 'delay.observation_count', 1);
	safeInteger(delay.severe_count, path, 'delay.severe_count');
	optionalSafeInteger(
		delay.in_clamp_observation_count,
		path,
		'delay.in_clamp_observation_count',
		1,
	);
	if (family === 'stops') {
		if (delay.on_time_count != null) contract(path, 'stop delay must not advertise route OTP');
		if (delay.in_clamp_observation_count !== delay.observation_count) {
			contract(path, 'stop delay in-clamp count must equal the observed population');
		}
	} else {
		safeInteger(delay.on_time_count, path, 'delay.on_time_count');
		if (delay.in_clamp_observation_count == null) {
			if (
				delay.on_time_count !== 0 ||
				delay.severe_count !== 0 ||
				delay.sum_delay_seconds != null
			) {
				contract(path, 'ghost-only delay must carry zero rates and no average ingredients');
			}
			return;
		}
	}
	safeInteger(delay.sum_delay_seconds, path, 'delay.sum_delay_seconds', -Number.MAX_SAFE_INTEGER);
	if (delay.in_clamp_observation_count > delay.observation_count) {
		contract(path, 'delay in-clamp count exceeds observations');
	}
	if ((delay.severe_count ?? 0) > delay.in_clamp_observation_count) {
		contract(path, 'delay severe count exceeds in-clamp observations');
	}
	if (
		family !== 'stops' &&
		(delay.on_time_count ?? 0) + (delay.severe_count ?? 0) > delay.in_clamp_observation_count
	) {
		contract(path, 'delay on-time plus severe counts exceed in-clamp observations');
	}
}

function assertCancellation(
	cancellation: NonNullable<NetworkHistoryDay['cancellation']>,
	path: string,
): void {
	safeInteger(cancellation.canceled_trip_days, path, 'cancellation.canceled_trip_days');
	safeInteger(cancellation.total_trip_days, path, 'cancellation.total_trip_days');
	optionalSafeInteger(cancellation.scheduled_trip_days, path, 'cancellation.scheduled_trip_days');
	optionalSafeInteger(cancellation.delivered_trip_days, path, 'cancellation.delivered_trip_days');
	optionalSafeInteger(cancellation.silent_trip_days, path, 'cancellation.silent_trip_days');
	if (cancellation.canceled_trip_days > cancellation.total_trip_days) {
		contract(path, 'canceled trip-days exceed observed trip-days');
	}
	if (
		cancellation.total_trip_days === 0 &&
		!(cancellation.scheduled_trip_days != null && cancellation.scheduled_trip_days > 0)
	) {
		contract(path, 'cancellation row has no positive denominator');
	}
	if (
		cancellation.scheduled_trip_days == null &&
		(cancellation.delivered_trip_days != null || cancellation.silent_trip_days != null)
	) {
		contract(path, 'scheduled counts are required for completeness ingredients');
	}
}

function assertOccupancy(
	occupancy: NonNullable<NetworkHistoryDay['occupancy']>,
	path: string,
	allowZero = false,
): void {
	let total = 0;
	for (const field of ['empty', 'many_seats', 'few_seats', 'standing', 'full'] as const) {
		safeInteger(occupancy[field], path, `occupancy.${field}`);
		total += occupancy[field];
		if (!Number.isSafeInteger(total))
			contract(path, 'occupancy total exceeds safe integer precision');
	}
	if (total === 0 && !allowZero) {
		contract(path, 'occupancy requires a positive telemetry denominator');
	}
}

function assertMetricIngredients(
	family: Family,
	day: HistoryDay,
	path: string,
	allowZeroOccupancy = false,
): void {
	if (day.delay != null) assertDelay(family, day.delay, path);
	if (day.delay_percentiles != null) {
		safeInteger(
			day.delay_percentiles.observation_count,
			path,
			'delay_percentiles.observation_count',
			1,
		);
	}
	if ('vehicles' in day && day.vehicles != null) {
		safeInteger(day.vehicles, path, 'vehicles', 1);
	}
	if ('cancellation' in day && day.cancellation != null) {
		assertCancellation(day.cancellation, path);
	}
	if (day.occupancy != null) assertOccupancy(day.occupancy, path, allowZeroOccupancy);
	if ('service_span' in day && day.service_span != null) {
		safeInteger(day.service_span.trip_count, path, 'service_span.trip_count', 1);
		optionalSafeInteger(
			day.service_span.first_trip_delay_seconds,
			path,
			'service_span.first_trip_delay_seconds',
			-Number.MAX_SAFE_INTEGER,
		);
		optionalSafeInteger(
			day.service_span.last_trip_delay_seconds,
			path,
			'service_span.last_trip_delay_seconds',
			-Number.MAX_SAFE_INTEGER,
		);
	}
	if ('skipped_stops' in day && day.skipped_stops != null) {
		safeInteger(day.skipped_stops.skipped_stop_count, path, 'skipped_stops.skipped_stop_count');
		safeInteger(
			day.skipped_stops.stop_time_update_count,
			path,
			'skipped_stops.stop_time_update_count',
			1,
		);
	}
}

function dayMetrics(day: HistoryDay): HistoricMetricCoverage['metric'][] {
	const metrics: HistoricMetricCoverage['metric'][] = [];
	for (const metric of Object.keys(FAMILY_METRICS.network) as HistoricMetricCoverage['metric'][]) {
		if (metric in day && day[metric as keyof HistoryDay] != null) metrics.push(metric);
	}
	if ('service_span' in day && day.service_span != null) metrics.push('service_span');
	if ('skipped_stops' in day && day.skipped_stops != null) metrics.push('skipped_stops');
	return metrics;
}

function assertDayCoverage(
	day: HistoryDay,
	coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>,
	path: string,
): void {
	for (const metric of dayMetrics(day)) {
		const coverage = coverages.get(metric);
		if (
			coverage?.first_available_date == null ||
			coverage.last_available_date == null ||
			day.date < coverage.first_available_date ||
			day.date > coverage.last_available_date ||
			(coverage.gaps ?? []).some((gap) => gap.start_date <= day.date && day.date <= gap.end_date)
		) {
			contract(path, `${metric} day falls outside advertised metric coverage`);
		}
	}
}

function validatePartition<TPartition extends { month: string; days: HistoryDay[] }>(
	family: Family,
	entityId: string | null,
	index: HistoricCollectionIndex,
	ref: HistoricPartitionRef,
	partition: TPartition,
): TPartition {
	const coverages = assertCollectionIndex(family, entityId, index);
	const month = assertPartitionRef(family, entityId, ref);
	const advertised = (index.partitions ?? []).find((candidate) => candidate.path === ref.path);
	if (advertised === undefined) {
		contract(ref.path, 'partition is not advertised by the collection index');
	}
	for (const field of ['coverage_start', 'coverage_end', 'count', 'sha256', 'byte_size'] as const) {
		if (advertised[field] !== ref[field]) {
			contract(ref.path, `partition ${field} does not match the collection index`);
		}
	}
	if (partition.month !== month) {
		contract(ref.path, `partition month mismatch (received ${partition.month})`);
	}
	if (partition.days.length !== ref.count) {
		contract(ref.path, `partition count mismatch (received ${partition.days.length})`);
	}
	if (
		partition.days.length === 0 ||
		partition.days[0].date !== ref.coverage_start ||
		partition.days.at(-1)?.date !== ref.coverage_end
	) {
		contract(ref.path, 'partition coverage does not match first and last payload dates');
	}

	let previous = '';
	for (const day of partition.days) {
		if (!strictIsoDate(day.date) || day.date.slice(0, 7) !== month || day.date <= previous) {
			contract(ref.path, 'partition days must be ascending, unique, and inside the path month');
		}
		previous = day.date;
		assertMetricIngredients(family, day, ref.path);
		assertDayCoverage(day, coverages, ref.path);
	}
	return partition;
}

export function validateNetworkHistoryPartition(
	index: HistoricCollectionIndex,
	ref: HistoricPartitionRef,
	partition: NetworkHistoryPartition,
): NetworkHistoryPartition {
	return validatePartition('network', null, index, ref, partition);
}

export function validateLineHistoryPartition(
	entityId: string,
	index: HistoricCollectionIndex,
	ref: HistoricPartitionRef,
	partition: LineHistoryPartition,
): LineHistoryPartition {
	if (partition.entity_id !== entityId) {
		contract(ref.path, `partition entity mismatch (received ${partition.entity_id})`);
	}
	return validatePartition('lines', entityId, index, ref, partition);
}

export function validateStopHistoryPartition(
	entityId: string,
	index: HistoricCollectionIndex,
	ref: HistoricPartitionRef,
	partition: StopHistoryPartition,
): StopHistoryPartition {
	if (partition.entity_id !== entityId) {
		contract(ref.path, `partition entity mismatch (received ${partition.entity_id})`);
	}
	return validatePartition('stops', entityId, index, ref, partition);
}

type ReducerStatus = 'complete' | 'partial' | 'no_data';

function exactAdd(total: number, value: number, path: string): number {
	const result = total + value;
	if (!Number.isSafeInteger(result))
		contract(path, 'pooled history value exceeds safe integer precision');
	return result;
}

function statusValue<T>(status: ReducerStatus, value: T): HistoryValue<T> {
	return status === 'no_data' ? { status: 'no_data', value: null } : { status, value };
}

function noData<T>(): HistoryValue<T> {
	return { status: 'no_data', value: null };
}

function coverageStatus(
	coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>,
	metric: HistoricMetricCoverage['metric'],
	window: DateWindow,
	hasValues: boolean,
): ReducerStatus {
	if (!hasValues) return 'no_data';
	const coverage = coverages.get(metric);
	if (coverage?.first_available_date == null || coverage.last_available_date == null) {
		return 'no_data';
	}
	if (
		window.from < coverage.first_available_date ||
		window.to > coverage.last_available_date ||
		(coverage.gaps ?? []).some((gap) => gap.start_date <= window.to && gap.end_date >= window.from)
	) {
		return 'partial';
	}
	return 'complete';
}

function reducerDays<
	TPartition extends { readonly month: string; readonly days: readonly HistoryDay[] },
>(
	family: Family,
	entityId: string | null,
	index: HistoricCollectionIndex,
	partitions: readonly TPartition[],
	window: DateWindow,
): {
	readonly days: HistoryDay[];
	readonly coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>;
} {
	assertWindow(window);
	const coverages = assertCollectionIndex(family, entityId, index);
	const path = indexPath(family, entityId);
	const expectedMonths = new Set(
		selectPartitionRefs(family, entityId, index, window).map((ref) =>
			ref.coverage_start.slice(0, 7),
		),
	);
	const loadedMonths = new Set<string>();
	const seenDates = new Set<string>();
	const days: HistoryDay[] = [];

	for (const partition of partitions) {
		if (!MONTH.test(partition.month) || partition.days.length === 0) {
			contract(path, `invalid loaded ${family} partition month`);
		}
		if (!expectedMonths.has(partition.month) || loadedMonths.has(partition.month)) {
			contract(path, `unexpected or duplicate loaded ${family} partition month ${partition.month}`);
		}
		loadedMonths.add(partition.month);
		if (family !== 'network') {
			const partitionEntity = 'entity_id' in partition ? partition.entity_id : undefined;
			if (partitionEntity !== entityId) {
				contract(path, `loaded partition entity mismatch (received ${partitionEntity})`);
			}
		}

		let previous = '';
		for (const day of partition.days) {
			if (
				!strictIsoDate(day.date) ||
				day.date.slice(0, 7) !== partition.month ||
				day.date <= previous
			) {
				contract(path, 'loaded partition days must be ascending, unique, and inside their month');
			}
			previous = day.date;
			if (seenDates.has(day.date)) contract(path, `duplicate loaded history day ${day.date}`);
			seenDates.add(day.date);
			assertMetricIngredients(family, day, path, true);
			assertDayCoverage(day, coverages, path);
			if (window.from <= day.date && day.date <= window.to) days.push(day);
		}
	}
	if (loadedMonths.size !== expectedMonths.size) {
		contract(path, 'loaded partitions do not match all intersecting advertised months');
	}

	days.sort((left, right) => left.date.localeCompare(right.date));
	return { days, coverages };
}

function reduceDelay(
	days: readonly HistoryDay[],
	coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>,
	window: DateWindow,
	path: string,
): HistoryValue<DelayHistoryAggregate> {
	const metrics = days
		.map((day) => day.delay)
		.filter((metric): metric is HistoricDelayMetric => metric != null);
	const status = coverageStatus(coverages, 'delay', window, metrics.length > 0);
	if (status === 'no_data') return noData();

	let observationCount = 0;
	let inClampObservationCount = 0;
	let onTimeCount = 0;
	let severeCount = 0;
	let sumDelaySeconds = 0;
	for (const metric of metrics) {
		observationCount = exactAdd(observationCount, metric.observation_count, path);
		inClampObservationCount = exactAdd(
			inClampObservationCount,
			metric.in_clamp_observation_count ?? 0,
			path,
		);
		onTimeCount = exactAdd(onTimeCount, metric.on_time_count!, path);
		severeCount = exactAdd(severeCount, metric.severe_count!, path);
		if (metric.sum_delay_seconds != null) {
			sumDelaySeconds = exactAdd(sumDelaySeconds, metric.sum_delay_seconds, path);
		}
	}
	const hasAverage = inClampObservationCount > 0;

	return statusValue(status, {
		observationCount,
		inClampObservationCount: hasAverage ? inClampObservationCount : null,
		onTimeCount,
		severeCount,
		sumDelaySeconds: hasAverage ? sumDelaySeconds : null,
		otpPct: (100 * onTimeCount) / observationCount,
		severePct: (100 * severeCount) / observationCount,
		averageDelaySeconds: hasAverage ? sumDelaySeconds / inClampObservationCount : null,
	});
}

function reduceStopDelay(
	days: readonly HistoryDay[],
	coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>,
	window: DateWindow,
	path: string,
): HistoryValue<StopDelayHistoryAggregate> {
	const metrics = days
		.map((day) => day.delay)
		.filter((metric): metric is HistoricDelayMetric => metric != null);
	const status = coverageStatus(coverages, 'delay', window, metrics.length > 0);
	if (status === 'no_data') return noData();

	let observationCount = 0;
	let inClampObservationCount = 0;
	let severeCount = 0;
	let sumDelaySeconds = 0;
	for (const metric of metrics) {
		observationCount = exactAdd(observationCount, metric.observation_count, path);
		inClampObservationCount = exactAdd(
			inClampObservationCount,
			metric.in_clamp_observation_count!,
			path,
		);
		severeCount = exactAdd(severeCount, metric.severe_count!, path);
		sumDelaySeconds = exactAdd(sumDelaySeconds, metric.sum_delay_seconds!, path);
	}

	return statusValue(status, {
		observationCount,
		inClampObservationCount,
		severeCount,
		sumDelaySeconds,
		severePct: (100 * severeCount) / inClampObservationCount,
		averageDelaySeconds: sumDelaySeconds / inClampObservationCount,
	});
}

function reduceCancellation(
	days: readonly HistoryDay[],
	coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>,
	window: DateWindow,
	path: string,
): HistoryValue<CancellationHistoryAggregate> {
	const metrics = days
		.filter((day): day is NetworkHistoryDay | LineHistoryDay => 'cancellation' in day)
		.map((day) => day.cancellation)
		.filter((metric): metric is HistoricCancellationMetric => metric != null);
	let status = coverageStatus(coverages, 'cancellation', window, metrics.length > 0);
	if (status === 'no_data') return noData();

	let canceledTripDays = 0;
	let totalTripDays = 0;
	for (const metric of metrics) {
		if (metric.total_trip_days > 0) {
			canceledTripDays = exactAdd(canceledTripDays, metric.canceled_trip_days, path);
			totalTripDays = exactAdd(totalTripDays, metric.total_trip_days, path);
		}
	}

	const scheduledMetrics = metrics.filter((metric) => metric.scheduled_trip_days != null);
	const scheduleComplete = scheduledMetrics.length === metrics.length;
	const deliveredKnown =
		scheduledMetrics.length > 0 &&
		scheduledMetrics.every((metric) => metric.delivered_trip_days != null);
	const silentKnown =
		scheduledMetrics.length > 0 &&
		scheduledMetrics.every((metric) => metric.silent_trip_days != null);
	let scheduledTripDays: number | null = scheduledMetrics.length > 0 ? 0 : null;
	let deliveredTripDays: number | null = deliveredKnown ? 0 : null;
	let silentTripDays: number | null = silentKnown ? 0 : null;
	for (const metric of scheduledMetrics) {
		if (scheduledTripDays != null) {
			scheduledTripDays = exactAdd(scheduledTripDays, metric.scheduled_trip_days!, path);
		}
		if (deliveredTripDays != null) {
			deliveredTripDays = exactAdd(deliveredTripDays, metric.delivered_trip_days!, path);
		}
		if (silentTripDays != null) {
			silentTripDays = exactAdd(silentTripDays, metric.silent_trip_days!, path);
		}
	}

	const completenessPct =
		scheduledTripDays != null && scheduledTripDays > 0 && deliveredTripDays != null
			? (100 * deliveredTripDays) / scheduledTripDays
			: null;
	if (
		status === 'complete' &&
		(!scheduleComplete || !deliveredKnown || !silentKnown || scheduledTripDays === 0)
	) {
		status = 'partial';
	}

	return statusValue(status, {
		canceledTripDays,
		totalTripDays,
		cancellationRatePct: totalTripDays > 0 ? (100 * canceledTripDays) / totalTripDays : null,
		scheduledTripDays,
		deliveredTripDays,
		silentTripDays,
		completenessPct,
	});
}

function reduceOccupancy(
	days: readonly HistoryDay[],
	coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>,
	window: DateWindow,
	path: string,
): HistoryValue<OccupancyHistoryAggregate> {
	const metrics = days
		.map((day) => day.occupancy)
		.filter((metric): metric is HistoricOccupancyMetric => metric != null);
	const status = coverageStatus(coverages, 'occupancy', window, metrics.length > 0);
	if (status === 'no_data') return noData();

	const counts: HistoricOccupancyMetric = {
		empty: 0,
		many_seats: 0,
		few_seats: 0,
		standing: 0,
		full: 0,
	};
	let totalCount = 0;
	for (const metric of metrics) {
		for (const field of ['empty', 'many_seats', 'few_seats', 'standing', 'full'] as const) {
			counts[field] = exactAdd(counts[field], metric[field], path);
		}
	}
	for (const value of Object.values(counts)) totalCount = exactAdd(totalCount, value, path);
	if (totalCount === 0) return noData();

	const mix: HistoricOccupancyMetric = {
		empty: counts.empty / totalCount,
		many_seats: counts.many_seats / totalCount,
		few_seats: counts.few_seats / totalCount,
		standing: counts.standing / totalCount,
		full: counts.full / totalCount,
	};
	return statusValue(status, { counts, totalCount, mix });
}

function reduceDaily<T>(
	days: readonly HistoryDay[],
	coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>,
	window: DateWindow,
	metric: HistoricMetricCoverage['metric'],
	read: (day: HistoryDay) => T | null | undefined,
): HistoryValue<readonly DatedHistoryValue<T>[]> {
	const values = days.flatMap((day) => {
		const value = read(day);
		return value == null ? [] : [{ date: day.date, value }];
	});
	return statusValue(coverageStatus(coverages, metric, window, values.length > 0), values);
}

function reduceSkippedStops(
	days: readonly HistoryDay[],
	coverages: Map<HistoricMetricCoverage['metric'], HistoricMetricCoverage>,
	window: DateWindow,
	path: string,
): HistoryValue<SkippedStopsHistoryAggregate> {
	const metrics = days
		.filter((day): day is LineHistoryDay => 'skipped_stops' in day)
		.map((day) => day.skipped_stops)
		.filter((metric): metric is NonNullable<LineHistoryDay['skipped_stops']> => metric != null);
	const status = coverageStatus(coverages, 'skipped_stops', window, metrics.length > 0);
	if (status === 'no_data') return noData();

	let skippedStopCount = 0;
	let stopTimeUpdateCount = 0;
	for (const metric of metrics) {
		skippedStopCount = exactAdd(skippedStopCount, metric.skipped_stop_count, path);
		stopTimeUpdateCount = exactAdd(stopTimeUpdateCount, metric.stop_time_update_count, path);
	}
	return statusValue(status, {
		skippedStopCount,
		stopTimeUpdateCount,
		skippedStopRatePct: (100 * skippedStopCount) / stopTimeUpdateCount,
	});
}

function currentOnly<TSections extends readonly string[]>(
	sections: TSections,
): CurrentOnlyMap<TSections> {
	return Object.fromEntries(
		sections.map((section) => [section, { status: 'current_only', value: null }]),
	) as CurrentOnlyMap<TSections>;
}

export function mergeNetworkHistory(
	index: HistoricCollectionIndex,
	partitions: readonly NetworkHistoryPartition[],
	window: DateWindow,
): NetworkHistoryRange {
	const { days, coverages } = reducerDays('network', null, index, partitions, window);
	const path = indexPath('network', null);
	return {
		family: 'network',
		window,
		delay: reduceDelay(days, coverages, window, path),
		delayPercentiles: reduceDaily(
			days,
			coverages,
			window,
			'delay_percentiles',
			(day) => day.delay_percentiles,
		),
		vehicles: reduceDaily(days, coverages, window, 'vehicles', (day) =>
			'vehicles' in day ? day.vehicles : undefined,
		),
		cancellation: reduceCancellation(days, coverages, window, path),
		occupancy: reduceOccupancy(days, coverages, window, path),
		currentOnly: currentOnly(NETWORK_CURRENT_ONLY_SECTIONS),
	};
}

export function mergeLineHistory(
	entityId: string,
	index: HistoricCollectionIndex,
	partitions: readonly LineHistoryPartition[],
	window: DateWindow,
): LineHistoryRange {
	const { days, coverages } = reducerDays('lines', entityId, index, partitions, window);
	const path = indexPath('lines', entityId);
	return {
		family: 'lines',
		entityId,
		window,
		delay: reduceDelay(days, coverages, window, path),
		delayPercentiles: reduceDaily(
			days,
			coverages,
			window,
			'delay_percentiles',
			(day) => day.delay_percentiles,
		),
		cancellation: reduceCancellation(days, coverages, window, path),
		occupancy: reduceOccupancy(days, coverages, window, path),
		serviceSpan: reduceDaily(days, coverages, window, 'service_span', (day) =>
			'service_span' in day ? day.service_span : undefined,
		),
		skippedStops: reduceSkippedStops(days, coverages, window, path),
		currentOnly: currentOnly(LINE_CURRENT_ONLY_SECTIONS),
	};
}

export function mergeStopHistory(
	entityId: string,
	index: HistoricCollectionIndex,
	partitions: readonly StopHistoryPartition[],
	window: DateWindow,
): StopHistoryRange {
	const { days, coverages } = reducerDays('stops', entityId, index, partitions, window);
	const path = indexPath('stops', entityId);
	return {
		family: 'stops',
		entityId,
		window,
		delay: reduceStopDelay(days, coverages, window, path),
		delayPercentiles: reduceDaily(
			days,
			coverages,
			window,
			'delay_percentiles',
			(day) => day.delay_percentiles,
		),
		occupancy: reduceOccupancy(days, coverages, window, path),
		currentOnly: currentOnly(STOP_CURRENT_ONLY_SECTIONS),
	};
}
