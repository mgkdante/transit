// clusters.ts — pure view-model mapper for the slice-9.6 historic Reliability
// surface (approach B: a clustered surface, one band per cluster).
//
// Maps the raw `RouteReliability` /v1 contract into six small, band-shaped
// view-models. Each VM carries ONLY the data its band needs plus the honest-
// state booleans the doctrine demands:
//   - `isEmpty`   — the band has nothing to draw → render an explicit "no data"
//                   note, NEVER a fake 0 or a silently dropped section.
//   - `isRampIn`  — the metric has no historical backfill (cancellations,
//                   skipped_stops) → label it so the reader doesn't read a low
//                   early number as "good".
//
// DOCTRINE this mapper upholds (the bands consume the result verbatim):
//   - Every numeric headline is `number | null`; null means "no data", never 0.
//   - cancellations + skipped_stops are RAMP-IN (no backfill) — flagged.
//   - occupancy_mix is null when there is no telemetry — the crowding VM is then
//     empty (and the band must say so), not a zeroed bar.
//   - habits matrix cells are `number | null` (null = no data, not zero) — kept
//     verbatim for the Heatmap primitive.
//   - PURE + DETERMINISTIC: no Date.now(), no Math.random(); ordering is the
//     contract's array order or an explicit stable comparator.

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
} from '$lib/v1';

/* ── VM types ────────────────────────────────────────────────────────────── */

/**
 * 01-strip headline — the single-glance answer for the SELECTED grain. Every
 * value is `number | null` (null = no data this grain). `perMetric.rampIn`
 * flags the two ramp-in metrics so the strip can mark them inline.
 */
export interface SnapshotStripVM {
	/** The grain these values were selected for (e.g. 'day'). */
	readonly grain: string;
	readonly otpPct: number | null;
	readonly avgDelayMin: number | null;
	/** Typical (median) delay, minutes — daily grain only; null otherwise. */
	readonly p50Min: number | null;
	/** Worst-case (p90) delay, minutes — daily grain only; null otherwise. */
	readonly p90Min: number | null;
	/** Busiest-direction headway CoV (first headway row carrying `cov`). */
	readonly headwayRegularityCov: number | null;
	/** Most-recent cancellation rate, % (ramp-in). */
	readonly cancellationRatePct: number | null;
	/** Most-recent skipped-stop rate, % (ramp-in). */
	readonly skippedStopRatePct: number | null;
	/** Per-metric ramp-in flags — only the no-backfill metrics are true. */
	readonly perMetric: {
		readonly cancellationRatePct: boolean;
		readonly skippedStopRatePct: boolean;
	};
	/**
	 * Set ONLY when the strip answers for a multi-day date range (an AGGREGATE of
	 * several closed days). Carries the in-range day count + bounds so the band can
	 * caption the headline honestly ("Average across N days, start to end"). null
	 * for a single day / week / month grain (those are an exact, not-averaged read).
	 * When set, `otpPct` + `avgDelayMin` are the MEAN across the in-range days, and
	 * `p50Min` / `p90Min` are null (percentiles are not averageable across days).
	 */
	readonly rangeAggregate: {
		readonly days: number;
		readonly start: string;
		readonly end: string;
	} | null;
	/** True when EVERY headline value above is null. */
	readonly isEmpty: boolean;
}

/**
 * A single time-of-day / day-type comparison row for the peak vs off-peak block.
 * Each carries the SELECTED-grain punctuality signal for that bucket; `label` is
 * the RAW grain string (e.g. 'am_peak', 'weekday') — the band resolves the human
 * label so this VM stays i18n-free. Every value is `number | null` (no fake 0).
 */
export interface PeriodComparisonRow {
	/** Raw grain string (e.g. 'am_peak' / 'pm_peak' / 'weekday' / 'weekend'). */
	readonly grain: string;
	readonly otpPct: number | null;
	readonly avgDelayMin: number | null;
	readonly severePct: number | null;
}

/**
 * Peak vs off-peak punctuality — time-of-day shift buckets + weekday/weekend
 * day-type buckets, surfaced from the granular grains the contract already
 * carries (am_peak/pm_peak/midday/evening/night + weekday/weekend). These are a
 * trailing-window observation-weighted proxy (date:null), NOT certified OTP.
 */
export interface PeakOffPeakVM {
	/** Time-of-day shift rows (am_peak/midday/pm_peak/evening/night), contract order. */
	readonly byShift: PeriodComparisonRow[];
	/** Day-type rows (weekday/weekend), contract order. */
	readonly byDayType: PeriodComparisonRow[];
	readonly isEmpty: boolean;
}

/** 01 Punctuality — OTP / delay / percentiles per grain period + weekday seasonality + weak stops. */
export interface PunctualityVM {
	/**
	 * The dated DAY-grain series ONLY, chronological ascending (oldest→newest),
	 * each row carrying its ISO `date`. This is the trend source — a true time
	 * axis, never the mixed-grain bag. Week/month/shift/daytype live elsewhere.
	 */
	readonly trend: ReliabilityPeriod[];
	/** Weekday seasonality rows, sorted Mon→Sun (ISO 1..7). Carries severe_pct + observation_count. */
	readonly dayOfWeek: RouteDayOfWeek[];
	/** Weakest stops by mean delay (contract order; only rows with a delay). */
	readonly weakStops: WeakStop[];
	/** Peak vs off-peak comparison (shift + day-type), surfaced from the granular grains. */
	readonly peakOffPeak: PeakOffPeakVM;
	readonly isEmpty: boolean;
}

/** 02 Wait regularity — scheduled-vs-observed headway + excess wait + CoV/bunching by shift. */
export interface WaitRegularityVM {
	/** Headway rows carrying at least one signal, in contract order. */
	readonly headway: HeadwayPeriod[];
	readonly isEmpty: boolean;
}

/** 03 Service delivered — span / first-last punctuality history + ramp-in cancellations. */
export interface ServiceDeliveredVM {
	/** Per-day service-span rows carrying at least one signal, in contract order. */
	readonly serviceSpans: ServiceSpanPeriod[];
	/** Per-day/grain cancellation history (ramp-in), in contract order. */
	readonly cancellations: CancellationPeriod[];
	/** Per-day skipped-stop history (ramp-in), in contract order. */
	readonly skippedStops: SkippedStopPeriod[];
	/** True for the cancellations + skipped-stop slices (no historical backfill). */
	readonly isRampIn: boolean;
	readonly isEmpty: boolean;
}

/** 04 Crowding — trailing-window occupancy band-shares; null when no telemetry. */
export interface CrowdingVM {
	/** The raw band-share record, or null when there is no occupancy telemetry. */
	readonly mix: OccupancyMix | null;
	/** True when `mix` is null OR every band share is zero/absent. */
	readonly isEmpty: boolean;
}

/** 05 Time-of-day habits — the heatmap matrix kept verbatim (cells number|null). */
export interface HabitsVM {
	/** Raw normalization scale string (e.g. 'repeat_problem_relative'); never resolveLabel. */
	readonly scale: string | null;
	/** 2-D heatmap; each cell number|null (null = no data, not zero). */
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
	/** The selected grain the snapshot strip answers for. Defaults to 'day'. */
	readonly grain?: string;
	/**
	 * When set (and `grain` resolves to 'day'), the strip/headline resolves to the
	 * dated day-grain period matching this ISO date — so the specific-date picker
	 * selects THAT day, not merely the most-recent one. No match → falls back to
	 * the normal grain selection (an absent date fabricates nothing).
	 */
	readonly selectedDate?: string;
	/**
	 * A closed date RANGE (inclusive, ISO `YYYY-MM-DD`) over the dated day-grain
	 * series. When set (with `grain` resolving to 'day') it overrides `selectedDate`
	 * and drives BOTH the strip and the trend:
	 *   - the strip's on-time % + avg delay become the MEAN across the in-range
	 *     days (an aggregate, captioned as such by the band);
	 *   - percentiles (p50/p90) are NOT averageable across days, so a MULTI-day
	 *     range nulls them (the band shows the no-data mark), while a SINGLE-day
	 *     range (`start === end`, or only one in-range day) keeps that day's exact
	 *     percentiles;
	 *   - the punctuality trend is ZOOMED to the in-range days only.
	 * `start > end`, an empty range, or no in-range days fabricates nothing — the
	 * strip falls back to the normal day selection and the trend stays full.
	 */
	readonly dateRange?: { readonly start: string; readonly end: string };
}

/**
 * Periods partitioned by grain GROUP so each consumer reads a clean grain:
 *   - `calendar`  — day / week / month (the dated headline grains)
 *   - `byShift`   — am_peak / pm_peak / midday / evening / night (date:null)
 *   - `byDayType` — weekday / weekend (date:null)
 * The mixed-grain contract array is split ONCE; nothing downstream re-mixes them.
 */
export interface PartitionedPeriods {
	readonly calendar: {
		day: ReliabilityPeriod[];
		week: ReliabilityPeriod[];
		month: ReliabilityPeriod[];
	};
	readonly byShift: ReliabilityPeriod[];
	readonly byDayType: ReliabilityPeriod[];
}

/* ── helpers (pure) ──────────────────────────────────────────────────────── */

const num = (v: number | null | undefined): number | null => (v == null ? null : v);

/** The time-of-day shift grains the contract emits (gold.route_delay_by_shift). */
const SHIFT_GRAINS = new Set(['am_peak', 'midday', 'pm_peak', 'evening', 'night']);
/** The day-type grains the contract emits (gold.route_delay_by_daytype). */
const DAY_TYPE_GRAINS = new Set(['weekday', 'weekend']);
/** The dated calendar grains the headline strip selects against. */
const CALENDAR_GRAINS = new Set(['day', 'week', 'month']);

/** A reliability period carries a signal if any of its numeric fields is present. */
const periodHasSignal = (p: ReliabilityPeriod): boolean =>
	p.otp_pct != null ||
	p.avg_delay_min != null ||
	p.p50_min != null ||
	p.p90_min != null ||
	p.severe_pct != null;

/** A headway row carries a signal if any of its numeric fields is present. */
const headwayHasSignal = (h: HeadwayPeriod): boolean =>
	h.scheduled_min != null ||
	h.observed_min != null ||
	h.excess_wait_min != null ||
	h.cov != null ||
	h.bunched_pct != null;

/** A service-span row carries a signal if any of its numeric fields is present. */
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

/**
 * Pick the headline period for the selected grain.
 *
 * F1 FIX: week/month rows arrive ASC (oldest→newest), so a naive `.find` would
 * surface the STALEST week/month. We instead pick the MOST-RECENT matching row
 * (max `date`; rows without a date keep array order as a tiebreak — daily/dateless
 * grains fall back to the last match). When `selectedDate` is set and a day-grain
 * row matches it, that exact day wins (the specific-date picker fix). Falls back
 * to the first period when the grain is absent, so an unknown grain fabricates
 * nothing.
 */
function selectStripPeriod(
	periods: readonly ReliabilityPeriod[],
	grain: string,
	selectedDate?: string,
): ReliabilityPeriod | null {
	if (periods.length === 0) return null;
	const matches = periods.filter((p) => p.grain === grain);
	if (matches.length === 0) return periods[0];
	// Specific-date pick: honour an exact dated match when asked.
	if (selectedDate) {
		const exact = matches.find((p) => p.date === selectedDate);
		if (exact) return exact;
	}
	// Most-recent matching row: pick the max `date`; if no row carries a date,
	// keep the LAST array position (contract tail = most-recent for dateless grains).
	return matches.reduce((best, p) => {
		if (p.date == null) return best.date == null ? p : best;
		if (best.date == null) return p;
		return p.date >= best.date ? p : best;
	}, matches[0]);
}

/** Split the mixed-grain contract array into clean grain groups (F4). */
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
		// Any unrecognised grain is intentionally dropped from every clean group.
	}
	return { calendar: { day, week, month }, byShift, byDayType };
}

/** Project a period to a peak/off-peak comparison row (raw grain + the punctuality triple). */
const toComparisonRow = (p: ReliabilityPeriod): PeriodComparisonRow => ({
	grain: p.grain,
	otpPct: num(p.otp_pct),
	avgDelayMin: num(p.avg_delay_min),
	severePct: num(p.severe_pct),
});

/** Chronological-ascending day-grain dated series — the trend source (oldest→newest). */
function dayTrend(dayPeriods: readonly ReliabilityPeriod[]): ReliabilityPeriod[] {
	return dayPeriods
		.filter((p) => p.date != null)
		.filter(periodHasSignal)
		.slice()
		.sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
}

/**
 * The dated day-grain rows whose `date` falls inside the inclusive [start, end]
 * range (ISO `YYYY-MM-DD` string ordering = chronological). An inverted or empty
 * range yields no rows (the caller then falls back to the full series — never a
 * fabricated window).
 */
function daysInRange(
	dayTrendAsc: readonly ReliabilityPeriod[],
	range: { start: string; end: string },
): ReliabilityPeriod[] {
	const lo = range.start <= range.end ? range.start : range.end;
	const hi = range.start <= range.end ? range.end : range.start;
	return dayTrendAsc.filter((p) => p.date != null && p.date >= lo && p.date <= hi);
}

/** Arithmetic mean of the non-null values `pick` returns, rounded to `dp`. null when none. */
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

/** First headway row carrying a CoV (the busiest-direction regularity row). */
function selectHeadwayCov(headway: readonly HeadwayPeriod[]): number | null {
	const row = headway.find((h) => h.cov != null);
	return row ? num(row.cov) : null;
}

/** Most-recent (last) entry carrying the named rate, scanning from the array tail. */
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

/* ── mapper ──────────────────────────────────────────────────────────────── */

/**
 * Shape a `RouteReliability` contract into the six cluster view-models. Pure +
 * deterministic; guards every nullable/optional field so a sparse or empty
 * contract never throws and resolves each band to an honest empty state.
 */
export function toReliabilityClusters(
	data: RouteReliability,
	opts?: ToReliabilityClustersOpts,
): ReliabilityClusters {
	const grain = opts?.grain ?? 'day';
	const selectedDate = opts?.selectedDate;
	const dateRange = opts?.dateRange;

	const allPeriods = data.periods ?? [];
	const allHeadway = data.headway ?? [];
	const allSpans = data.service_spans ?? [];
	const allCancellations = data.cancellations ?? [];
	const allSkipped = data.skipped_stops ?? [];
	const allDayOfWeek = data.day_of_week ?? [];
	const allWeakStops = data.weak_stops ?? [];

	// Split the mixed-grain bag ONCE so every consumer reads a clean grain (F4).
	const partition = partitionPeriods(allPeriods);
	// The strip selects only against the calendar (dated headline) grains.
	const calendarPeriods = [
		...partition.calendar.day,
		...partition.calendar.week,
		...partition.calendar.month,
	];

	// The dated day-grain series (ascending) — the source for BOTH the trend and
	// the date-range aggregate. Resolve the in-range day rows ONCE (empty when no
	// range is set, the range is inverted/empty, or no day falls inside it — the
	// strip + trend then fall back to their normal full-series behaviour).
	const dayTrendAsc = dayTrend(partition.calendar.day);
	const rangeDays = grain === 'day' && dateRange ? daysInRange(dayTrendAsc, dateRange) : [];
	const hasRange = rangeDays.length > 0;

	/* 01-strip — the selected-grain headline (F1: most-recent week/month). When a
	   date range is active the strip AGGREGATES the in-range days: on-time % + avg
	   delay are the MEAN across them; percentiles are NOT averageable, so a multi-
	   day range nulls them while a single in-range day keeps that day's exact ones. */
	const cancellationRatePct = mostRecentRate(allCancellations, (c) => c.cancellation_rate_pct);
	const skippedStopRatePct = mostRecentRate(allSkipped, (s) => s.skipped_stop_rate_pct);
	const headwayRegularityCov = selectHeadwayCov(allHeadway);

	let otpPct: number | null;
	let avgDelayMin: number | null;
	let p50Min: number | null;
	let p90Min: number | null;
	let rangeAggregate: SnapshotStripVM['rangeAggregate'] = null;

	if (hasRange) {
		const singleDay = rangeDays.length === 1;
		otpPct = singleDay ? num(rangeDays[0].otp_pct) : meanOf(rangeDays, (p) => p.otp_pct, 0);
		avgDelayMin = singleDay
			? num(rangeDays[0].avg_delay_min)
			: meanOf(rangeDays, (p) => p.avg_delay_min, 1);
		// Percentiles are not averageable across days: only a single in-range day
		// carries them; a multi-day range shows the honest no-data mark.
		p50Min = singleDay ? num(rangeDays[0].p50_min) : null;
		p90Min = singleDay ? num(rangeDays[0].p90_min) : null;
		// A single in-range day reads as an exact day (no "average" caption); a
		// multi-day range carries the aggregate metadata for an honest caption.
		rangeAggregate = singleDay
			? null
			: {
					days: rangeDays.length,
					start: rangeDays[0].date!,
					end: rangeDays[rangeDays.length - 1].date!,
				};
	} else {
		const stripPeriod = selectStripPeriod(calendarPeriods, grain, selectedDate);
		otpPct = stripPeriod ? num(stripPeriod.otp_pct) : null;
		avgDelayMin = stripPeriod ? num(stripPeriod.avg_delay_min) : null;
		p50Min = stripPeriod ? num(stripPeriod.p50_min) : null;
		p90Min = stripPeriod ? num(stripPeriod.p90_min) : null;
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

	/* 01 Punctuality. */
	// Trend source = ONLY the dated day-grain series, chronological ascending (F1/F4).
	// A date range ZOOMS the trend to the in-range days (otherwise the full series).
	const trend = hasRange ? rangeDays : dayTrendAsc;
	const dayOfWeek = allDayOfWeek
		.filter(dayOfWeekHasSignal)
		.slice()
		.sort((a, b) => a.day_of_week_iso - b.day_of_week_iso);
	const weakStops = allWeakStops.filter((w) => w.avg_delay_min != null);
	// Peak vs off-peak: surface the granular shift + day-type grains (A1/A2).
	const byShift = partition.byShift.filter(periodHasSignal).map(toComparisonRow);
	const byDayType = partition.byDayType.filter(periodHasSignal).map(toComparisonRow);
	const peakOffPeak: PeakOffPeakVM = {
		byShift,
		byDayType,
		isEmpty: byShift.length === 0 && byDayType.length === 0,
	};
	const punctuality: PunctualityVM = {
		trend,
		dayOfWeek,
		weakStops,
		peakOffPeak,
		isEmpty:
			trend.length === 0 && dayOfWeek.length === 0 && weakStops.length === 0 && peakOffPeak.isEmpty,
	};

	/* 02 Wait regularity. */
	const headway = allHeadway.filter(headwayHasSignal);
	const waitRegularity: WaitRegularityVM = {
		headway,
		isEmpty: headway.length === 0,
	};

	/* 03 Service delivered. */
	const serviceSpans = allSpans.filter(spanHasSignal);
	const cancellations = allCancellations.filter(cancellationHasSignal);
	const skippedStops = allSkipped.filter(skippedHasSignal);
	const serviceDelivered: ServiceDeliveredVM = {
		serviceSpans,
		cancellations,
		skippedStops,
		isRampIn: true,
		isEmpty: serviceSpans.length === 0 && cancellations.length === 0 && skippedStops.length === 0,
	};

	/* 04 Crowding. */
	const rawMix = data.occupancy_mix ?? null;
	const mixHasShare =
		rawMix != null &&
		(rawMix.empty > 0 ||
			rawMix.many_seats > 0 ||
			rawMix.few_seats > 0 ||
			rawMix.standing > 0 ||
			rawMix.full > 0);
	const crowding: CrowdingVM = {
		mix: mixHasShare ? rawMix : null,
		isEmpty: !mixHasShare,
	};

	/* 05 Time-of-day habits. */
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
