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
	/** True when EVERY headline value above is null. */
	readonly isEmpty: boolean;
}

/** 01 Punctuality — OTP / delay / percentiles per grain period + weekday seasonality + weak stops. */
export interface PunctualityVM {
	/** Periods carrying at least one punctuality signal, in contract order. */
	readonly periods: ReliabilityPeriod[];
	/** Weekday seasonality rows, sorted Mon→Sun (ISO 1..7). */
	readonly dayOfWeek: RouteDayOfWeek[];
	/** Weakest stops by mean delay (contract order; only rows with a delay). */
	readonly weakStops: WeakStop[];
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
}

/* ── helpers (pure) ──────────────────────────────────────────────────────── */

const num = (v: number | null | undefined): number | null => (v == null ? null : v);

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

/** Pick the period answering the selected grain; else the first period; else null. */
function selectStripPeriod(
	periods: readonly ReliabilityPeriod[],
	grain: string,
): ReliabilityPeriod | null {
	if (periods.length === 0) return null;
	return periods.find((p) => p.grain === grain) ?? periods[0];
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

	const allPeriods = data.periods ?? [];
	const allHeadway = data.headway ?? [];
	const allSpans = data.service_spans ?? [];
	const allCancellations = data.cancellations ?? [];
	const allSkipped = data.skipped_stops ?? [];
	const allDayOfWeek = data.day_of_week ?? [];
	const allWeakStops = data.weak_stops ?? [];

	/* 01-strip — the selected-grain headline. */
	const stripPeriod = selectStripPeriod(allPeriods, grain);
	const cancellationRatePct = mostRecentRate(allCancellations, (c) => c.cancellation_rate_pct);
	const skippedStopRatePct = mostRecentRate(allSkipped, (s) => s.skipped_stop_rate_pct);
	const otpPct = stripPeriod ? num(stripPeriod.otp_pct) : null;
	const avgDelayMin = stripPeriod ? num(stripPeriod.avg_delay_min) : null;
	const p90Min = stripPeriod ? num(stripPeriod.p90_min) : null;
	const headwayRegularityCov = selectHeadwayCov(allHeadway);
	const strip: SnapshotStripVM = {
		grain,
		otpPct,
		avgDelayMin,
		p90Min,
		headwayRegularityCov,
		cancellationRatePct,
		skippedStopRatePct,
		perMetric: { cancellationRatePct: true, skippedStopRatePct: true },
		isEmpty:
			otpPct == null &&
			avgDelayMin == null &&
			p90Min == null &&
			headwayRegularityCov == null &&
			cancellationRatePct == null &&
			skippedStopRatePct == null,
	};

	/* 01 Punctuality. */
	const periods = allPeriods.filter(periodHasSignal);
	const dayOfWeek = allDayOfWeek
		.filter(dayOfWeekHasSignal)
		.slice()
		.sort((a, b) => a.day_of_week_iso - b.day_of_week_iso);
	const weakStops = allWeakStops.filter((w) => w.avg_delay_min != null);
	const punctuality: PunctualityVM = {
		periods,
		dayOfWeek,
		weakStops,
		isEmpty: periods.length === 0 && dayOfWeek.length === 0 && weakStops.length === 0,
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
