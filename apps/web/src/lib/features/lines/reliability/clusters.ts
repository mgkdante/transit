import type {
	RouteReliability,
	ReliabilityPeriod,
	HeadwayPeriod,
	ServiceSpanPeriod,
	CancellationPeriod,
	SkippedStopPeriod,
	RouteDayOfWeek,
	WeakStop,
	OccupancyMix,
	CrowdingDelayCell,
	CrosstabCell,
	RouteDelayHistogramBin,
} from '$lib/v1';
import { SHIFT_GRAINS, DAY_TYPE_GRAINS } from '$lib/features/reliability/shiftGrains';
import { roundHalfAwayFromZero } from '$lib/utils';
import type { RetainedLineHistory } from './data/retainedHistory';
import { selectHeadlinePeriod } from './selectors/dayVerdictHeadline';

export interface SnapshotStripVM {
	readonly grain: string;
	readonly otpPct: number | null;
	readonly avgDelayMin: number | null;
	readonly p50Min: number | null;
	readonly p90Min: number | null;
	readonly headwayRegularityCov: number | null;
	readonly cancellationRatePct: number | null;
	readonly skippedStopRatePct: number | null;
	readonly perMetric: {
		readonly cancellationRatePct: boolean;
		readonly skippedStopRatePct: boolean;
	};
	readonly rangeAggregate: {
		readonly days: number;
		readonly start: string;
		readonly end: string;
	} | null;
	readonly isEmpty: boolean;
}

export interface PeriodComparisonRow {
	readonly grain: string;
	readonly otpPct: number | null;
	readonly avgDelayMin: number | null;
	readonly severePct: number | null;
	readonly observationCount: number | null;
	readonly onTime: number | null;
	readonly priorOtpPct: number | null;
	readonly priorObservationCount: number | null;
	readonly priorOnTime: number | null;
}

export interface PeakOffPeakVM {
	readonly byShift: PeriodComparisonRow[];
	readonly byDayType: PeriodComparisonRow[];
	readonly isEmpty: boolean;
}

export interface PunctualityVM {
	readonly headline: {
		readonly otpPct: number | null;
		readonly avgDelayMin: number | null;
		readonly p50Min: number | null;
		readonly p90Min: number | null;
		readonly severePct: number | null;
		readonly delayHistogram: RouteDelayHistogramBin[] | null;
		readonly observationCount: number | null;
		readonly onTime: number | null;
	};
	readonly trend: ReliabilityPeriod[];
	readonly dayOfWeek: RouteDayOfWeek[];
	readonly weakStops: WeakStop[];
	readonly peakOffPeak: PeakOffPeakVM;
	readonly byShiftDaytype: CrosstabCell[];
	readonly windowed: boolean;
	readonly weakStopsWindowed: boolean;
	readonly isEmpty: boolean;
}

export interface WaitRegularityVM {
	readonly headway: HeadwayPeriod[];
	readonly windowed: boolean;
	readonly isEmpty: boolean;
}

export interface ServiceDeliveredVM {
	readonly serviceSpans: ServiceSpanPeriod[];
	readonly cancellations: CancellationPeriod[];
	readonly skippedStops: SkippedStopPeriod[];
	readonly cancellationRatePct: number | null;
	readonly skippedStopRatePct: number | null;
	readonly serviceCompletenessPct: number | null;
	readonly scheduledService: {
		readonly scheduled: number;
		readonly delivered: number;
		readonly silent: number | null;
	} | null;
	readonly isRampIn: boolean;
	readonly isEmpty: boolean;
}

export interface CrowdingVM {
	readonly mix: OccupancyMix | null;
	readonly delayByCrowding: CrowdingDelayCell[];
	readonly mixByGrain: OccupancyMix | null;
	readonly weekdayWeekend: {
		readonly weekday: OccupancyMix | null;
		readonly weekend: OccupancyMix | null;
	} | null;
	readonly byWeekday:
		| readonly {
				readonly iso: number;
				readonly mix: OccupancyMix | null;
		  }[]
		| null;
	readonly isEmpty: boolean;
}

export interface HabitsVM {
	readonly scale: string | null;
	readonly matrix: (number | null)[][];
	readonly isEmpty: boolean;
}

export interface ReliabilityClusters {
	readonly strip: SnapshotStripVM;
	readonly punctuality: PunctualityVM;
	readonly waitRegularity: WaitRegularityVM;
	readonly serviceDelivered: ServiceDeliveredVM;
	readonly crowding: CrowdingVM;
	readonly habits: HabitsVM;
}

export interface ToReliabilityClustersOpts {
	readonly grain?: string;
	readonly selectedDate?: string;
	readonly dateRange?: { readonly start: string; readonly end: string };
	readonly retained?: Pick<RetainedLineHistory, 'aggregate' | 'retainedDayCount'>;
}

export interface PartitionedPeriods {
	readonly calendar: {
		day: ReliabilityPeriod[];
		week: ReliabilityPeriod[];
		month: ReliabilityPeriod[];
	};
	readonly byShift: ReliabilityPeriod[];
	readonly byDayType: ReliabilityPeriod[];
}

const num = (v: number | null | undefined): number | null => (v == null ? null : v);

const periodHasSignal = (p: ReliabilityPeriod): boolean =>
	p.otp_pct != null ||
	p.avg_delay_min != null ||
	p.p50_min != null ||
	p.p90_min != null ||
	p.severe_pct != null;

const headwayHasSignal = (h: HeadwayPeriod): boolean =>
	h.scheduled_min != null ||
	h.observed_min != null ||
	h.excess_wait_min != null ||
	h.cov != null ||
	h.bunched_pct != null;

const spanHasSignal = (s: ServiceSpanPeriod): boolean =>
	s.service_span_min != null ||
	s.first_trip_delay_min != null ||
	s.last_trip_delay_min != null ||
	s.trip_count != null ||
	s.first_trip_utc != null ||
	s.last_trip_utc != null;

const cancellationHasSignal = (c: CancellationPeriod): boolean =>
	c.cancellation_rate_pct != null || c.canceled_trip_days != null || c.total_trip_days != null;

const skippedHasSignal = (s: SkippedStopPeriod): boolean =>
	s.skipped_stop_rate_pct != null ||
	s.skipped_stop_count != null ||
	s.stop_time_update_count != null;

const dayOfWeekHasSignal = (d: RouteDayOfWeek): boolean =>
	d.avg_delay_min != null || d.severe_pct != null || d.observation_count != null;

const crowdingDelayHasSignal = (c: CrowdingDelayCell): boolean =>
	c.avg_delay_min != null ||
	c.p50_min != null ||
	c.observation_count != null ||
	c.day_count != null;

const crosstabHasSignal = (c: CrosstabCell): boolean =>
	c.otp_pct != null ||
	c.avg_delay_min != null ||
	c.severe_pct != null ||
	c.observation_count != null;

function partitionPeriods(periods: readonly ReliabilityPeriod[]): PartitionedPeriods {
	const day: ReliabilityPeriod[] = [];
	const week: ReliabilityPeriod[] = [];
	const month: ReliabilityPeriod[] = [];
	const byShift: ReliabilityPeriod[] = [];
	const byDayType: ReliabilityPeriod[] = [];
	for (const p of periods) {
		if (p.grain === 'day') day.push(p);
		else if (p.grain === 'week') week.push(p);
		else if (p.grain === 'month') month.push(p);
		else if (SHIFT_GRAINS.has(p.grain)) byShift.push(p);
		else if (DAY_TYPE_GRAINS.has(p.grain)) byDayType.push(p);
	}
	return { calendar: { day, week, month }, byShift, byDayType };
}

const toComparisonRow = (p: ReliabilityPeriod): PeriodComparisonRow => ({
	grain: p.grain,
	otpPct: num(p.otp_pct),
	avgDelayMin: num(p.avg_delay_min),
	severePct: num(p.severe_pct),
	observationCount: num(p.observation_count),
	onTime: num(p.on_time),
	priorOtpPct: num(p.prior_otp_pct),
	priorObservationCount: num(p.prior_observation_count),
	priorOnTime: num(p.prior_on_time),
});

function dayTrend(dayPeriods: readonly ReliabilityPeriod[]): ReliabilityPeriod[] {
	const byDate = new Map<string, ReliabilityPeriod>();
	for (const p of dayPeriods) {
		if (p.date != null && periodHasSignal(p)) byDate.set(p.date, p);
	}
	return [...byDate.values()].sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
}

function daysInRange(
	dayTrendAsc: readonly ReliabilityPeriod[],
	range: { start: string; end: string },
): ReliabilityPeriod[] {
	const lo = range.start <= range.end ? range.start : range.end;
	const hi = range.start <= range.end ? range.end : range.start;
	return dayTrendAsc.filter((p) => p.date != null && p.date >= lo && p.date <= hi);
}

function isoMinusDays(iso: string, n: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

function windowByGrain<T extends { date?: string | null }>(
	rows: readonly T[],
	grain: string,
	selectedDate: string | undefined,
	dateRange: { readonly start: string; readonly end: string } | undefined,
): readonly T[] {
	const dated = rows.filter((r): r is T & { date: string } => r.date != null);
	if (dated.length === 0) return rows;
	if (dateRange) {
		const lo = dateRange.start <= dateRange.end ? dateRange.start : dateRange.end;
		const hi = dateRange.start <= dateRange.end ? dateRange.end : dateRange.start;
		return dated.filter((r) => r.date >= lo && r.date <= hi);
	}
	const latest = dated.reduce((m, r) => (r.date > m ? r.date : m), dated[0].date);
	if (grain === 'day') {
		const target = selectedDate ?? latest;
		return dated.filter((r) => r.date === target);
	}
	const cutoff = isoMinusDays(latest, (grain === 'week' ? 7 : 30) - 1);
	return dated.filter((r) => r.date >= cutoff);
}

function lastNDays<T extends { date?: string | null }>(
	rows: readonly T[],
	n: number,
): readonly T[] {
	const dated = rows.filter((r): r is T & { date: string } => r.date != null);
	if (dated.length === 0) return rows;
	const latest = dated.reduce((m, r) => (r.date > m ? r.date : m), dated[0].date);
	const cutoff = isoMinusDays(latest, n - 1);
	return dated.filter((r) => r.date >= cutoff);
}

function meanOf<T>(
	rows: readonly T[],
	pick: (row: T) => number | null | undefined,
	dp: number,
): number | null {
	let sum = 0;
	let n = 0;
	for (const row of rows) {
		const v = pick(row);
		if (v != null && !Number.isNaN(v)) {
			sum += v;
			n += 1;
		}
	}
	if (n === 0) return null;
	const factor = 10 ** dp;
	return Math.round((sum / n) * factor) / factor;
}

function weightedMean<T>(
	rows: readonly T[],
	value: (row: T) => number | null | undefined,
	weight: (row: T) => number | null | undefined,
	dp: number,
): number | null {
	let wSum = 0;
	let wNum = 0;
	let hasWeighted = false;
	for (const row of rows) {
		const v = value(row);
		const w = weight(row);
		if (v == null || Number.isNaN(v)) continue;
		if (w != null && w > 0) {
			wNum += v * w;
			wSum += w;
			hasWeighted = true;
		}
	}
	if (hasWeighted) {
		const factor = 10 ** dp;
		return Math.round((wNum / wSum) * factor) / factor;
	}
	return meanOf(rows, value, dp);
}

function pooledRate<T>(
	rows: readonly T[],
	numer: (row: T) => number | null | undefined,
	denom: (row: T) => number | null | undefined,
	dp: number,
): number | null {
	let nSum = 0;
	let dSum = 0;
	for (const row of rows) {
		const d = denom(row);
		const nu = numer(row);
		if (d == null || d <= 0 || nu == null || Number.isNaN(nu)) continue;
		dSum += d;
		nSum += nu;
	}
	if (dSum === 0) return null;
	const factor = 10 ** dp;
	return Math.round((nSum / dSum) * 100 * factor) / factor;
}

function meanMix(
	rows: readonly { mix: OccupancyMix | null; n?: number | null }[],
): OccupancyMix | null {
	const present = rows.filter((r): r is { mix: OccupancyMix; n?: number | null } => r.mix != null);
	if (present.length === 0) return null;
	const weighted = present.every((r) => r.n != null && Number.isFinite(r.n) && r.n > 0);
	const denom = weighted ? present.reduce((acc, r) => acc + (r.n as number), 0) : present.length;
	const wOf = (r: { n?: number | null }): number => (weighted ? (r.n as number) : 1);
	const avg = (pick: (m: OccupancyMix) => number): number =>
		present.reduce((acc, r) => acc + pick(r.mix) * wOf(r), 0) / denom;
	return {
		empty: avg((m) => m.empty),
		many_seats: avg((m) => m.many_seats),
		few_seats: avg((m) => m.few_seats),
		standing: avg((m) => m.standing),
		full: avg((m) => m.full),
	};
}

function selectHeadwayCov(headway: readonly HeadwayPeriod[]): number | null {
	const row = headway.find((h) => h.cov != null);
	return row ? num(row.cov) : null;
}

function mostRecentRate<T>(
	rows: readonly T[],
	pick: (row: T) => number | null | undefined,
): number | null {
	for (let i = rows.length - 1; i >= 0; i--) {
		const v = pick(rows[i]);
		if (v != null) return v;
	}
	return null;
}

function scheduledServiceSummary(rows: readonly CancellationPeriod[]): {
	readonly scheduled: number;
	readonly delivered: number;
	readonly silent: number | null;
} | null {
	let scheduled = 0;
	let delivered = 0;
	let silent = 0;
	let hasScheduled = false;
	let hasSilent = false;
	for (const row of rows) {
		if (row.scheduled_trip_days == null || row.scheduled_trip_days <= 0) continue;
		if (row.delivered_trip_days == null) continue;
		hasScheduled = true;
		scheduled += row.scheduled_trip_days;
		delivered += row.delivered_trip_days;
		if (row.silent_trip_days != null) {
			hasSilent = true;
			silent += row.silent_trip_days;
		}
	}
	return hasScheduled ? { scheduled, delivered, silent: hasSilent ? silent : null } : null;
}

export function toReliabilityClusters(
	data: RouteReliability,
	opts?: ToReliabilityClustersOpts,
): ReliabilityClusters {
	const grain = opts?.grain ?? 'day';
	const selectedDate = opts?.selectedDate;
	const dateRange = opts?.dateRange;
	const retained = opts?.retained;

	const allPeriods = data.periods ?? [];
	const allHeadway = data.headway ?? [];
	const allSpans = data.service_spans ?? [];
	const allCancellations = data.cancellations ?? [];
	const allSkipped = data.skipped_stops ?? [];
	const allDayOfWeek = data.day_of_week ?? [];
	const allWeakStops = data.weak_stops ?? [];

	const periodsGrain = (data.periods_by_grain ?? []).find((g) => g.grain === grain) ?? null;
	const headwayGrain = (data.headway_by_grain ?? []).find((g) => g.grain === grain) ?? null;
	const weakStopsGrain = (data.weak_stops_by_grain ?? []).find((g) => g.grain === grain) ?? null;

	const partition = partitionPeriods(allPeriods);
	const calendarPeriods = [
		...partition.calendar.day,
		...partition.calendar.week,
		...partition.calendar.month,
	];

	const dayTrendAsc = dayTrend(partition.calendar.day);
	const rangeDays = grain === 'day' && dateRange ? daysInRange(dayTrendAsc, dateRange) : [];
	const hasRange = rangeDays.length > 0;
	const TREND_DAYS_DAY = 14;
	const TREND_DAYS_WEEK = 7;
	const TREND_DAYS_MONTH = 30;
	const grainTrendAsc =
		grain === 'week'
			? [...lastNDays(dayTrendAsc, TREND_DAYS_WEEK)]
			: grain === 'month'
				? [...lastNDays(dayTrendAsc, TREND_DAYS_MONTH)]
				: [...lastNDays(dayTrendAsc, TREND_DAYS_DAY)];

	const exactCancellation = retained?.aggregate.cancellation.value ?? null;
	const exactSkippedStops = retained?.aggregate.skippedStops.value ?? null;
	const cancellationRatePct =
		exactCancellation?.cancellationRatePct == null
			? (pooledRate(
					windowByGrain(allCancellations, grain, selectedDate, dateRange),
					(c) => c.canceled_trip_days,
					(c) => c.total_trip_days,
					1,
				) ?? mostRecentRate(allCancellations, (c) => c.cancellation_rate_pct))
			: roundHalfAwayFromZero(exactCancellation.cancellationRatePct, 1);
	const skippedStopRatePct =
		exactSkippedStops == null
			? (pooledRate(
					windowByGrain(allSkipped, grain, selectedDate, dateRange),
					(s) => s.skipped_stop_count,
					(s) => s.stop_time_update_count,
					1,
				) ?? mostRecentRate(allSkipped, (s) => s.skipped_stop_rate_pct))
			: roundHalfAwayFromZero(exactSkippedStops.skippedStopRatePct, 1);
	const headwayRegularityCov = selectHeadwayCov(allHeadway);

	let otpPct: number | null;
	let avgDelayMin: number | null;
	let p50Min: number | null;
	let p90Min: number | null;
	let severePct: number | null;
	let delayHistogram: RouteDelayHistogramBin[] | null = null;
	let rangeAggregate: SnapshotStripVM['rangeAggregate'] = null;
	let observationCount: number | null;
	let onTime: number | null;

	if (hasRange) {
		const singleDay = rangeDays.length === 1;
		observationCount = rangeDays.reduce<number | null>(
			(s, p) => (p.observation_count != null ? (s ?? 0) + p.observation_count : s),
			null,
		);
		onTime = rangeDays.reduce<number | null>(
			(s, p) => (p.on_time != null ? (s ?? 0) + p.on_time : s),
			null,
		);
		otpPct = singleDay
			? num(rangeDays[0].otp_pct)
			: observationCount != null && observationCount > 0 && onTime != null
				? Math.round((onTime / observationCount) * 100)
				: meanOf(rangeDays, (p) => p.otp_pct, 0);
		avgDelayMin = singleDay
			? num(rangeDays[0].avg_delay_min)
			: weightedMean(
					rangeDays,
					(p) => p.avg_delay_min,
					(p) => p.observation_count,
					1,
				);
		severePct = singleDay
			? num(rangeDays[0].severe_pct)
			: weightedMean(
					rangeDays,
					(p) => p.severe_pct,
					(p) => p.observation_count,
					1,
				);
		p50Min = singleDay ? num(rangeDays[0].p50_min) : null;
		p90Min = singleDay ? num(rangeDays[0].p90_min) : null;
		rangeAggregate = singleDay
			? null
			: {
					days: rangeDays.length,
					start: rangeDays[0].date!,
					end: rangeDays[rangeDays.length - 1].date!,
				};
		const exactDelay = retained?.aggregate.delay.value;
		if (exactDelay != null) {
			observationCount = exactDelay.observationCount;
			onTime = exactDelay.onTimeCount;
			otpPct = roundHalfAwayFromZero(exactDelay.otpPct, 0);
			avgDelayMin =
				exactDelay.averageDelaySeconds == null
					? null
					: roundHalfAwayFromZero(exactDelay.averageDelaySeconds / 60, 1);
			severePct = roundHalfAwayFromZero(exactDelay.severePct, 1);
		}
		if (retained != null && dateRange != null) {
			rangeAggregate =
				dateRange.start === dateRange.end
					? null
					: {
							days: retained.retainedDayCount,
							start: dateRange.start,
							end: dateRange.end,
						};
		}
	} else {
		const stripPeriod = selectHeadlinePeriod(calendarPeriods, grain, selectedDate);
		otpPct = stripPeriod ? num(stripPeriod.otp_pct) : null;
		avgDelayMin = stripPeriod ? num(stripPeriod.avg_delay_min) : null;
		p50Min = stripPeriod ? num(stripPeriod.p50_min) : null;
		p90Min = stripPeriod ? num(stripPeriod.p90_min) : null;
		severePct = stripPeriod ? num(stripPeriod.severe_pct) : null;
		delayHistogram = stripPeriod?.delay_histogram ?? null;
		observationCount = stripPeriod ? num(stripPeriod.observation_count) : null;
		onTime = stripPeriod ? num(stripPeriod.on_time) : null;
	}

	const strip: SnapshotStripVM = {
		grain,
		otpPct,
		avgDelayMin,
		p50Min,
		p90Min,
		headwayRegularityCov,
		cancellationRatePct,
		skippedStopRatePct,
		perMetric: { cancellationRatePct: true, skippedStopRatePct: true },
		rangeAggregate,
		isEmpty:
			otpPct == null &&
			avgDelayMin == null &&
			p50Min == null &&
			p90Min == null &&
			headwayRegularityCov == null &&
			cancellationRatePct == null &&
			skippedStopRatePct == null,
	};

	const trend = hasRange ? rangeDays : grainTrendAsc;
	const dayOfWeek = (periodsGrain?.day_of_week ?? allDayOfWeek)
		.filter(dayOfWeekHasSignal)
		.slice()
		.sort((a, b) => a.day_of_week_iso - b.day_of_week_iso);
	const weakStops = weakStopsGrain
		? (weakStopsGrain.stops ?? []).filter((w) => w.observation_count != null)
		: allWeakStops.filter((w) => w.avg_delay_min != null);
	const byShift = (periodsGrain?.by_shift ?? partition.byShift)
		.filter(periodHasSignal)
		.map(toComparisonRow);
	const byDayType = (periodsGrain?.by_daytype ?? partition.byDayType)
		.filter(periodHasSignal)
		.map(toComparisonRow);
	const peakOffPeak: PeakOffPeakVM = {
		byShift,
		byDayType,
		isEmpty: byShift.length === 0 && byDayType.length === 0,
	};
	const byShiftDaytype = (periodsGrain?.by_shift_daytype ?? data.by_shift_daytype ?? []).filter(
		crosstabHasSignal,
	);
	const punctuality: PunctualityVM = {
		headline: {
			otpPct,
			avgDelayMin,
			p50Min,
			p90Min,
			severePct,
			delayHistogram,
			observationCount,
			onTime,
		},
		trend,
		dayOfWeek,
		weakStops,
		peakOffPeak,
		byShiftDaytype,
		windowed: periodsGrain != null,
		weakStopsWindowed: weakStopsGrain != null,
		isEmpty:
			trend.length === 0 &&
			dayOfWeek.length === 0 &&
			weakStops.length === 0 &&
			peakOffPeak.isEmpty &&
			byShiftDaytype.length === 0,
	};

	const headway = (headwayGrain?.headway ?? allHeadway).filter(headwayHasSignal);
	const waitRegularity: WaitRegularityVM = {
		headway,
		windowed: headwayGrain != null,
		isEmpty: headway.length === 0,
	};

	const serviceSpans = windowByGrain(allSpans, grain, selectedDate, dateRange).filter(
		spanHasSignal,
	);
	const cancellations = windowByGrain(allCancellations, grain, selectedDate, dateRange).filter(
		cancellationHasSignal,
	);
	const skippedStops = windowByGrain(allSkipped, grain, selectedDate, dateRange).filter(
		skippedHasSignal,
	);
	const exactScheduledService =
		exactCancellation?.scheduledTripDays != null &&
		exactCancellation.scheduledTripDays > 0 &&
		exactCancellation.deliveredTripDays != null
			? {
					scheduled: exactCancellation.scheduledTripDays,
					delivered: exactCancellation.deliveredTripDays,
					silent: exactCancellation.silentTripDays,
				}
			: null;
	const scheduledService =
		retained == null ? scheduledServiceSummary(cancellations) : exactScheduledService;
	const serviceCompletenessPct =
		retained != null
			? exactCancellation?.completenessPct == null
				? null
				: roundHalfAwayFromZero(exactCancellation.completenessPct, 1)
			: scheduledService == null
				? null
				: roundHalfAwayFromZero((100 * scheduledService.delivered) / scheduledService.scheduled, 1);
	const serviceDelivered: ServiceDeliveredVM = {
		serviceSpans,
		cancellations,
		skippedStops,
		cancellationRatePct,
		skippedStopRatePct,
		serviceCompletenessPct,
		scheduledService,
		isRampIn: true,
		isEmpty:
			serviceSpans.length === 0 &&
			cancellations.length === 0 &&
			skippedStops.length === 0 &&
			!(retained != null && serviceCompletenessPct != null),
	};

	const rawMix = data.occupancy_mix ?? null;
	const mixHasShare =
		rawMix != null &&
		(rawMix.empty > 0 ||
			rawMix.many_seats > 0 ||
			rawMix.few_seats > 0 ||
			rawMix.standing > 0 ||
			rawMix.full > 0);
	const delayByCrowding = (data.delay_by_crowding ?? []).filter(crowdingDelayHasSignal);
	const occByGrain = data.occupancy_by_grain ?? [];
	const occByDow = data.occupancy_by_dow ?? [];
	const mixByGrain = occByGrain.find((g) => g.grain === grain)?.mix ?? null;
	const weekdayWeekend =
		occByDow.length > 0
			? {
					weekday: meanMix(
						occByDow
							.filter((d) => d.day_of_week_iso >= 1 && d.day_of_week_iso <= 5)
							.map((d) => ({ mix: d.mix ?? null, n: d.n })),
					),
					weekend: meanMix(
						occByDow
							.filter((d) => d.day_of_week_iso >= 6 && d.day_of_week_iso <= 7)
							.map((d) => ({ mix: d.mix ?? null, n: d.n })),
					),
				}
			: null;
	const byWeekday =
		occByDow.length > 0
			? (() => {
					const byIso = new Map<number, OccupancyMix | null>();
					for (const d of occByDow) byIso.set(d.day_of_week_iso, d.mix ?? null);
					return [1, 2, 3, 4, 5, 6, 7].map((iso) => ({ iso, mix: byIso.get(iso) ?? null }));
				})()
			: null;
	const crowding: CrowdingVM = {
		mix: mixHasShare ? rawMix : null,
		delayByCrowding,
		mixByGrain,
		weekdayWeekend,
		byWeekday,
		isEmpty: !mixHasShare,
	};

	const rawHabits = data.habits ?? null;
	const matrix = rawHabits?.matrix ?? [];
	const matrixHasCell = matrix.some((row) => row.some((cell) => cell != null));
	const habits: HabitsVM = {
		scale: rawHabits?.scale ?? null,
		matrix,
		isEmpty: !matrixHasCell,
	};

	return { strip, punctuality, waitRegularity, serviceDelivered, crowding, habits };
}
