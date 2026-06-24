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
	CrowdingDelayCell,
	CrosstabCell,
} from '$lib/v1';
import { SHIFT_GRAINS, DAY_TYPE_GRAINS } from '$lib/features/reliability/shiftGrains';

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
	 * The GRAIN-AWARE headline aggregate for the selected window (today / this week /
	 * this month / range) — the SAME values the snapshot strip shows. §01's headline
	 * tiles, the typical→worst-case Distribution, and the severe-share bar read this so
	 * they answer for the picked grain; the trend (below) carries the daily detail.
	 */
	readonly headline: {
		readonly otpPct: number | null;
		readonly avgDelayMin: number | null;
		readonly p50Min: number | null;
		readonly p90Min: number | null;
		readonly severePct: number | null;
	};
	/**
	 * The dated DAY-grain series, WINDOWED to a DISTINCT recent window per grain (day →
	 * last 14 days of context, week → last 7, month → last 30, range → the range),
	 * chronological ascending. Daily detail at every grain (a true time axis), never the
	 * coarse weekly/monthly aggregate dots — and the windows differ so day ≠ month.
	 */
	readonly trend: ReliabilityPeriod[];
	/** Weekday seasonality rows, sorted Mon→Sun (ISO 1..7). Carries severe_pct + observation_count. */
	readonly dayOfWeek: RouteDayOfWeek[];
	/** Weakest stops by mean delay (contract order; only rows with a delay). */
	readonly weakStops: WeakStop[];
	/** Peak vs off-peak comparison (shift + day-type), surfaced from the granular grains. */
	readonly peakOffPeak: PeakOffPeakVM;
	/**
	 * Tier-3 shift × day_type OTP/delay crosstab — kept VERBATIM from the contract
	 * (SPARSE: only cells with observations are present). The band lays them out on
	 * a fixed 5-shift × 2-day-type grid; an absent (shift, day_type) cell renders an
	 * explicit no-data message, never a fake 0. Empty array → the band omits the
	 * crosstab (its honest-empty path), never a fabricated grid.
	 */
	readonly byShiftDaytype: CrosstabCell[];
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
	/**
	 * Per-occupancy-band avg delay over the trailing window — the "does crowding
	 * correlate with delay?" sub-block, kept VERBATIM from the contract (SPARSE:
	 * only bands whose dominant-day occupancy was that band are present). The band
	 * orders these by the natural occupancy order (empty→full); a present band with
	 * a null delay renders an explicit no-data message, never a fake 0. Empty array
	 * → the sub-block shows one honest no-data note (or is omitted).
	 */
	readonly delayByCrowding: CrowdingDelayCell[];
	/**
	 * S7: the occupancy mix at the SELECTED grain (day/week/month) from
	 * occupancy_by_grain, or null when that grain has no telemetry / the field is
	 * absent. The band prefers this over `mix` when present (grain-aware crowding),
	 * falling back to the scalar trailing-window `mix`.
	 */
	readonly mixByGrain: OccupancyMix | null;
	/**
	 * S7: weekday (ISO 1-5) vs weekend (ISO 6-7) occupancy mix for the 2-col split,
	 * each the unweighted mean of the per-weekday shares from occupancy_by_dow. null
	 * when occupancy_by_dow is absent/empty; each side null when that side has no
	 * telemetry. (Mean-of-shares is an approximation — the contract carries per-day
	 * shares, not raw counts — honest for a "typical weekday/weekend" display.)
	 */
	readonly weekdayWeekend: {
		readonly weekday: OccupancyMix | null;
		readonly weekend: OccupancyMix | null;
	} | null;
	/**
	 * P11: the RAW per-ISO-weekday occupancy mix kept VERBATIM from occupancy_by_dow,
	 * for the Mon→Sun small-multiple. Always the full 7-day frame (iso 1..7), ASC, so
	 * the band can render one strip per weekday with a fixed Mon→Sun axis: a weekday
	 * the contract omits, OR a present weekday with mix:null, both carry `mix: null`
	 * (honest absence — that day renders the no-telemetry chip, never a fabricated bar
	 * or a silently dropped strip). null only when occupancy_by_dow is absent/empty
	 * (then the small-multiple is omitted, same gate as weekdayWeekend).
	 */
	readonly byWeekday:
		| readonly {
				readonly iso: number;
				readonly mix: OccupancyMix | null;
		  }[]
		| null;
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

// The SHIFT + DAY-TYPE grain token sets are the shared reliability vocabulary
// (imported above) so the lines + stops surfaces partition on identical tokens.

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

/** A delay×crowding cell carries a signal if any of its numeric fields is present. */
const crowdingDelayHasSignal = (c: CrowdingDelayCell): boolean =>
	c.avg_delay_min != null ||
	c.p50_min != null ||
	c.observation_count != null ||
	c.day_count != null;

/** A shift×day_type crosstab cell carries a signal if any of its numeric fields is present. */
const crosstabHasSignal = (c: CrosstabCell): boolean =>
	c.otp_pct != null ||
	c.avg_delay_min != null ||
	c.severe_pct != null ||
	c.observation_count != null;

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

/**
 * Chronological-ascending day-grain dated series — the trend source (oldest→newest),
 * DEDUPED by date. The contract can emit two rows for the same local day (a late
 * re-publish); without this collapse that day would draw twice on the trend chart
 * AND count twice in the date-range mean. Last occurrence wins (the contract tail
 * is the most-recent write for a date). This is the single source of truth for both
 * the trend and the range aggregate, so deduping here fixes both at once.
 */
function dayTrend(dayPeriods: readonly ReliabilityPeriod[]): ReliabilityPeriod[] {
	const byDate = new Map<string, ReliabilityPeriod>();
	for (const p of dayPeriods) {
		if (p.date != null && periodHasSignal(p)) byDate.set(p.date, p);
	}
	return [...byDate.values()].sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
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

/** ISO date (YYYY-MM-DD) minus `n` days, in UTC. */
function isoMinusDays(iso: string, n: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

/**
 * Filter a dated ramp-in history (cancellations / skipped / spans) to the window the
 * grain rail selects, so §03 Service-delivered RESPONDS to the filter like §01 does:
 *   - explicit dateRange → rows inside [start, end];
 *   - day (+ selectedDate) → that one day; day (no date) → the latest dated row;
 *   - week / month → the last 7 / 30 days ending at the latest dated row.
 * Undated rows (no `date`) pass through unchanged — there is nothing to window them by.
 */
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

/**
 * The dated rows within the last `n` days (ending at the latest dated row). The TREND
 * window primitive: each grain maps to a DISTINCT recent window so the day / week / month
 * trends never look identical (the bug where day = the full ~30-day history collided with
 * month = the last 30 days). Undated rows pass through.
 */
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

/**
 * Unweighted mean of the present band-share mixes (each share vector sums to ~1, so
 * the mean also sums to ~1 — no re-normalization). null when no present mix. Used to
 * fold the per-ISO-weekday occupancy_by_dow shares into a typical weekday/weekend mix.
 */
function meanMix(mixes: readonly (OccupancyMix | null)[]): OccupancyMix | null {
	const present = mixes.filter((m): m is OccupancyMix => m != null);
	if (present.length === 0) return null;
	const avg = (pick: (m: OccupancyMix) => number): number =>
		present.reduce((acc, m) => acc + pick(m), 0) / present.length;
	return {
		empty: avg((m) => m.empty),
		many_seats: avg((m) => m.many_seats),
		few_seats: avg((m) => m.few_seats),
		standing: avg((m) => m.standing),
		full: avg((m) => m.full),
	};
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
	// S7 (systematic grain): the §01 trend ALWAYS shows the DAILY series; week/month just
	// WINDOW it (the last 7 / 30 days) via the SAME windowByGrain helper §03 uses — they
	// no longer switch to the coarse weekly/monthly aggregate periods, which collapsed the
	// month to two dots and made "this week" span a whole month on the x-axis. So every
	// grain keeps daily detail folded in, on a window that matches the picked grain.
	// Each grain maps to a DISTINCT recent daily window so day / week / month never render
	// the same trend: Today shows the recent 2-week context (14d — a single day is not a
	// trend), This week the last 7d, This month the last 30d. (Was: day = the FULL history,
	// which equalled month on a route with only ~a month of data — the "broken" the
	// operator saw.) §03's "day" stays the single latest day — a count, not a time series.
	const TREND_DAYS_DAY = 14;
	const TREND_DAYS_WEEK = 7;
	const TREND_DAYS_MONTH = 30;
	const grainTrendAsc =
		grain === 'week'
			? [...lastNDays(dayTrendAsc, TREND_DAYS_WEEK)]
			: grain === 'month'
				? [...lastNDays(dayTrendAsc, TREND_DAYS_MONTH)]
				: [...lastNDays(dayTrendAsc, TREND_DAYS_DAY)];

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
	let severePct: number | null;
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
		// Severe share is averageable across the in-range days (a share, not a percentile).
		severePct = singleDay
			? num(rangeDays[0].severe_pct)
			: meanOf(rangeDays, (p) => p.severe_pct, 1);
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
		severePct = stripPeriod ? num(stripPeriod.severe_pct) : null;
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
	const trend = hasRange ? rangeDays : grainTrendAsc;
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
	// Tier-3 shift × day_type crosstab — kept VERBATIM (sparse), filtered to cells
	// that carry a real signal so an all-null cell never reads as present-but-blank.
	// The band lays them on a fixed 5×2 grid; absent cells show an honest no-data
	// message (the per-empty-cell honesty the operator requires).
	const byShiftDaytype = (data.by_shift_daytype ?? []).filter(crosstabHasSignal);
	const punctuality: PunctualityVM = {
		// The GRAIN-AWARE headline aggregate (the same selected-grain values the strip
		// computes): §01's headline tiles + the typical→worst-case Distribution + the
		// severe-share bar read THIS, so they answer for the picked window (today / this
		// week / this month / range), while the trend shows the daily detail. Systematic:
		// one aggregate, not the trend tail.
		headline: { otpPct, avgDelayMin, p50Min, p90Min, severePct },
		trend,
		dayOfWeek,
		weakStops,
		peakOffPeak,
		byShiftDaytype,
		isEmpty:
			trend.length === 0 &&
			dayOfWeek.length === 0 &&
			weakStops.length === 0 &&
			peakOffPeak.isEmpty &&
			byShiftDaytype.length === 0,
	};

	/* 02 Wait regularity. */
	const headway = allHeadway.filter(headwayHasSignal);
	const waitRegularity: WaitRegularityVM = {
		headway,
		isEmpty: headway.length === 0,
	};

	/* 03 Service delivered — windowed to the grain the rail selects (the §03 completeness
	   read then aggregates over that window, so the section RESPONDS to the filter). */
	const serviceSpans = windowByGrain(allSpans, grain, selectedDate, dateRange).filter(
		spanHasSignal,
	);
	const cancellations = windowByGrain(allCancellations, grain, selectedDate, dateRange).filter(
		cancellationHasSignal,
	);
	const skippedStops = windowByGrain(allSkipped, grain, selectedDate, dateRange).filter(
		skippedHasSignal,
	);
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
	// Per-band delay×crowding cells — kept VERBATIM (sparse), filtered to cells that
	// carry a real signal so an all-null band never reads as present-but-blank. The
	// band orders these by the natural occupancy order; a present band with a null
	// delay shows an honest no-data message (never a fake 0).
	const delayByCrowding = (data.delay_by_crowding ?? []).filter(crowdingDelayHasSignal);
	// S7: grain-aware mix (the occupancy_by_grain entry for the selected grain) +
	// weekday/weekend split (means of the per-ISO-weekday occupancy_by_dow shares).
	const occByGrain = data.occupancy_by_grain ?? [];
	const occByDow = data.occupancy_by_dow ?? [];
	const mixByGrain = occByGrain.find((g) => g.grain === grain)?.mix ?? null;
	const weekdayWeekend =
		occByDow.length > 0
			? {
					weekday: meanMix(
						occByDow
							.filter((d) => d.day_of_week_iso >= 1 && d.day_of_week_iso <= 5)
							.map((d) => d.mix ?? null),
					),
					weekend: meanMix(
						occByDow
							.filter((d) => d.day_of_week_iso >= 6 && d.day_of_week_iso <= 7)
							.map((d) => d.mix ?? null),
					),
				}
			: null;
	// P11: the RAW per-ISO-weekday mix on a FIXED Mon→Sun frame (iso 1..7). Index the
	// sparse contract rows by their ISO weekday (last write wins for a dup), then walk
	// the full 1..7 frame so every weekday gets a strip — a missing weekday OR a
	// present-but-null mix both resolve to `mix: null` (honest absence). Gated on the
	// same occByDow presence as weekdayWeekend so the small-multiple omits cleanly.
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
		// The mix drives the headline + stacked bar; the delay×crowding sub-block has
		// its OWN empty path. `isEmpty` stays mix-driven so a route WITH delay data but
		// no occupancy mix still surfaces the delay sub-block under the band.
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
