<!--
  NetworkHealth — the /network surface screen (slice-9.3).

  Composes the surface spine + dataviz kit into the network-wide health readout:
    · live tier  — createLiveStore polls network.json; we render the headline
      MetricDisplay grid (on-time %, vehicles in service, not-reporting count,
      coverage %, p50/p90 delay), a worker-feed-age chip beside LiveFreshness, a
      status-mix StackedBar (5 StatusCodes by count) and an occupancy-mix
      StackedBar (5 OccupancyCodes by fraction, null-guarded).
    · historic   — createResource(getNetworkTrend) feeds, over a 7/30/90-day
      window the rider chooses: a TrendLine (on-time % vs a selectable delay
      series — p90 or avg), a vehicles-in-service context Sparkline, a
      cancellation-rate TrendLine (stood down when the series carries none), and
      a per-day crowding small-multiple (one 100% StackedBar per day with data).

    · the historic trend reads at a day / week / month GRAIN the rider picks:
      day uses the daily `series` (the 7/30/90 window still applies); week uses
      the additive `weekly` series (week-start dated); month uses `monthly`
      (month-start dated). p90 + vehicles are null on week/month (14d-daily-only),
      so on those grains the retard channel reads the avg-delay series and the
      vehicles sparkline + per-day crowding small-multiple stand down. A grain is
      offered ONLY when its series carries data; the picker stands down (one
      grain) when only the daily series exists.

  DOCTRINE: every data mark rides the dataviz scale (StackedBar/TrendLine/
  Sparkline own that); --primary stays interactive-only (the grain + window +
  delay-series pickers are interactive affordances). Honesty rule — a null
  headline shows the localized "no data" string, never a fabricated 0; null trend
  points are gaps (never zero); a day with no occupancy telemetry is SKIPPED
  (never an even split). Before the first live tick we show a skeleton EdgeState;
  a live-store error shows error-v1. All user-facing prose comes from
  ./network.copy; band labels are localized there.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { layout, openSurface, routeFor } from '$lib/nav';
	import { mapSearchFor } from '$lib/filters';
	import { formatDateKey, formatRelativeSeconds } from '$lib/utils/time';
	import {
		createLiveStore,
		getNetworkTrend,
		getProvenance,
		getV1Context,
		STATUS_CODES,
		OCCUPANCY_CODES,
		type NetworkFile,
		type NetworkShift,
		type OccupancyCode,
		type StatusCode,
		type TrendPoint,
	} from '$lib/v1';
	import type { SeverityCode } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		shiftLabel,
		dayTypeLabel,
		severeShareToSeverity,
	} from '$lib/features/reliability/shiftGrains';
	import {
		SurfaceHeader,
		LiveFreshness,
		ConformanceBadge,
		ResourceBoundary,
		GrainPicker,
		type GrainSegment,
	} from '$lib/components/surface';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import {
		RankedRow,
		Sparkline,
		StackedBar,
		TrendLine,
		type StackedSegment,
	} from '$lib/components/dataviz';
	import { EdgeState } from '$lib/components/edge';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { copy as COPY, OCCUPANCY_LABELS, STATUS_LABELS } from './network.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// Live tier — one store instance for this surface; the v1 context is booted
	// by the time the page tree renders, so getV1Context() is safe here.
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// Historic tier — the daily network trend (createResource, browser-only).
	const trend = createResource(() => getNetworkTrend());

	// Honesty layer — the provider's feed-conformance verdict (provenance.json).
	// Supplementary, not core: if this fetch errors or `conformance` is null (a
	// provider with no current static dataset), the badge renders nothing and the
	// surface is unaffected — never a blocking boundary.
	const provenance = createResource(() => getProvenance());

	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	/** Format a nullable integer percent as "82%" or the honest "no data". */
	function fmtPct(v: number | null): string {
		return v == null ? t.noData : `${v}${t.units.pct}`;
	}
	/** Format a nullable integer-minute delay as "3 min" or "no data". */
	function fmtMin(v: number | null): string {
		return v == null ? t.noData : `${v}${t.units.min}`;
	}
	/** A required count → plain integer (localized thousands separators). */
	function fmtCount(v: number): string {
		return v.toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA');
	}

	// Worker-cycle feed staleness, distinct from the snapshot-publish age that
	// LiveFreshness shows. `feed_freshness_s` is the seconds since the worker last
	// refreshed the realtime feed; null → no signal → the honest "no data".
	const feedAge = $derived.by<string | null>(() => {
		const s = live.network?.feed_freshness_s ?? null;
		return s == null ? null : formatRelativeSeconds(s, locale);
	});

	// Status-mix segments: the 5 StatusCodes by count (StackedBar drops zeros).
	const statusSegments = $derived.by<StackedSegment[]>(() => {
		const net: NetworkFile | null = live.network;
		const dist = net?.status_dist ?? null;
		return STATUS_CODES.map((code: StatusCode) => ({
			code,
			value: dist ? dist[code] : null,
			label: STATUS_LABELS[locale][code],
		}));
	});

	// Occupancy-mix segments: the 5 OccupancyCodes by fraction (0..1). Null-guard:
	// occupancy_mix may be null/absent when no telemetry was received this cycle —
	// skip the whole bar rather than fabricate an even split.
	const hasOccupancy = $derived(live.network?.occupancy_mix != null);
	const occupancySegments = $derived.by<StackedSegment[]>(() => {
		const mix = live.network?.occupancy_mix ?? null;
		return OCCUPANCY_CODES.map((code: OccupancyCode) => ({
			code,
			value: mix ? mix[code] : null,
			label: OCCUPANCY_LABELS[locale][code],
		}));
	});

	// --- Delay distribution (live histogram) ---------------------------------
	// The 8 fixed signed-minute buckets of `delay_histogram` — the DISTRIBUTION of
	// the SAME trip-level delays that power p50/p90. The contract emits all 8
	// buckets (zeros included) whenever there ARE observations, and null ONLY when
	// there are none (same guard as the percentiles), so we stand the whole
	// section down on null. Bars encode COUNT by length; their colour reads the
	// early/late SENSE off the status scale (early/ahead = on-time green, the
	// on-time band stays green, late bands climb amber→severe), never --primary.
	type DelayBar = {
		readonly key: number;
		readonly label: string;
		readonly count: number;
		readonly pct: number;
		readonly colorVar: string;
		readonly a11y: string;
	};
	const hasDelayHistogram = $derived((live.network?.delay_histogram?.length ?? 0) > 0);
	// Colour each bucket by its delay sense (index 0..7 over the fixed edges):
	// the two early buckets (<-2) read on-time green, the [-2,2) on-time band
	// stays green, [2,10) is amber (late), [10,inf) is severe. Length = count.
	const DELAY_BAR_COLORS: readonly string[] = [
		'var(--dataviz-status-on-time)', // < -5  (very early)
		'var(--dataviz-status-on-time)', // -5..-2 (early)
		'var(--dataviz-status-on-time)', // -2..0 (on time)
		'var(--dataviz-status-on-time)', // 0..2  (on time)
		'var(--dataviz-severity-high)', // 2..5  (late)
		'var(--dataviz-severity-high)', // 5..10 (late)
		'var(--dataviz-severity-critical)', // 10..15 (severe)
		'var(--dataviz-severity-critical)', // 15+    (severe)
	];
	const delayBars = $derived.by<DelayBar[]>(() => {
		const buckets = live.network?.delay_histogram ?? [];
		if (buckets.length === 0) return [];
		const labels = t.delayHistogram.buckets;
		const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
		return buckets.map((b, i) => {
			const label = labels[i] ?? '';
			return {
				key: i,
				label,
				count: b.count,
				// Bar fill proportion of the tallest bucket; max 0 → all-zero bars
				// render as a flat baseline (never a divide-by-zero).
				pct: max > 0 ? (b.count / max) * 100 : 0,
				colorVar: DELAY_BAR_COLORS[i] ?? 'var(--dataviz-status-unknown)',
				a11y: t.delayHistogram.barValue(label, b.count),
			};
		});
	});

	// --- Non-responding (silent) trips by route ------------------------------
	// `non_responding_by_route` is per-ROUTE counts of scheduled trips running NOW
	// with no live vehicle (already ordered count DESC, route_id ASC by the
	// builder). Honest: silent trips have no vehicle id, so this is a per-line
	// silent-trip tally, NOT vehicle ids. null/empty → the section stands down
	// (the scalar `non_responding` tile still carries the total). Each row is a
	// ranked link to /route/[id] via the shared routeFor → localizeHref pattern.
	type SilentRow = {
		readonly key: string;
		readonly rank: number;
		readonly title: string;
		readonly subtitle: string;
		readonly severity: SeverityCode;
		readonly value: number | null;
		readonly display: string;
		readonly href: string;
		readonly ariaLabel: string;
	};
	const silentRows = $derived.by<SilentRow[]>(() => {
		const rows = live.network?.non_responding_by_route ?? null;
		if (rows == null || rows.length === 0) return [];
		const worst = rows.reduce((m, r) => Math.max(m, r.count), 0);
		return rows.map((r, i) => ({
			key: r.route_id,
			rank: i + 1,
			title: r.route_id,
			subtitle: t.nonResponding.rowLabel,
			// A silent scheduled trip is a service gap → the bar reads on the
			// critical severity band (never --primary); length encodes the count.
			severity: 'critical' as SeverityCode,
			// Magnitude bar normalized against the worst line (always severity-
			// scaled; a silent trip is a service gap). null only if worst is 0,
			// which the empty-guard above already excludes.
			value: worst > 0 ? Math.min(1, Math.max(0, r.count / worst)) : null,
			display: `${fmtCount(r.count)} ${t.nonResponding.tripsUnit(r.count)}`,
			href: localizeHref(routeFor({ kind: 'line', id: r.route_id }), locale),
			ariaLabel: t.nonResponding.viewDetail(r.route_id),
		}));
	});
	const hasSilentRows = $derived(silentRows.length > 0);

	// --- Trend grain (day / week / month) ------------------------------------
	// The historic trend reads at a calendar grain the rider chooses: day uses the
	// daily `series` (the 7/30/90 window below still applies), week uses the
	// additive `weekly` series (week-start dated), month uses `monthly`
	// (month-start dated). On week/month, p90_min + vehicles are null (those are
	// 14d-daily-only) → the retard channel reads avg-delay and the vehicles
	// sparkline + per-day crowding small-multiple stand down. A grain is offered
	// ONLY when its series carries data; the picker stands down to a single chip
	// when no coarser series was published.
	type Grain = 'day' | 'week' | 'month';

	const dailySeries = $derived<TrendPoint[]>(trend.data?.series ?? []);
	const weeklySeries = $derived<TrendPoint[]>(trend.data?.weekly ?? []);
	const monthlySeries = $derived<TrendPoint[]>(trend.data?.monthly ?? []);

	const hasDaily = $derived(dailySeries.length > 0);
	const hasWeekly = $derived(weeklySeries.length > 0);
	const hasMonthly = $derived(monthlySeries.length > 0);

	let grainKey = $state('day');
	const grain = $derived<Grain>(
		grainKey === 'week' || grainKey === 'month' ? (grainKey as Grain) : 'day',
	);
	// Coarse grains carry no p90 / no per-day crowding / no daily vehicles spark.
	const isDailyGrain = $derived(grain === 'day');

	const grainSegments = $derived.by<GrainSegment<string>[]>(() => [
		// `day` is the always-present base WHEN the daily series carries data; a
		// snapshot with an empty `series` but populated coarse grains must not offer
		// (or default to) an empty day grain.
		{ key: 'day', label: t.grain.day, available: hasDaily },
		{ key: 'week', label: t.grain.week, available: hasWeekly },
		{ key: 'month', label: t.grain.month, available: hasMonthly },
	]);
	// Offer the picker whenever MORE THAN ONE grain carries data — a lone enabled
	// grain is a dead control, so the picker stands down to nothing then.
	const showGrainPicker = $derived([hasDaily, hasWeekly, hasMonthly].filter(Boolean).length > 1);

	// Keep `grainKey` on an AVAILABLE grain. Clamp a chosen coarse grain back when
	// its series is absent (e.g. an older snapshot with no weekly/monthly); and when
	// the daily series itself is empty, fall the day grain forward to the first
	// populated coarse grain — never a dead/empty grain.
	$effect(() => {
		if (grainKey === 'week' && !hasWeekly)
			grainKey = hasDaily ? 'day' : hasMonthly ? 'month' : 'day';
		else if (grainKey === 'month' && !hasMonthly)
			grainKey = hasDaily ? 'day' : hasWeekly ? 'week' : 'day';
		else if (grainKey === 'day' && !hasDaily)
			grainKey = hasWeekly ? 'week' : hasMonthly ? 'month' : 'day';
	});

	// --- Trend window (7/30/90-day) ------------------------------------------
	// build_network_trend publishes the full series (~90d OTP/avg-delay, ~14d
	// p90/vehicles). We slice the TAIL (most recent N days) and offer only windows
	// that fit the data: a window longer than the series is disabled (never a
	// dead control). Default to the richest ENABLED window that fits the loaded
	// series (the largest WINDOW ≤ the data length), falling back to 7. The window
	// applies to the DAY grain only; week/month render their full (short) series.
	const WINDOWS = [7, 30, 90] as const;
	type WindowDays = (typeof WINDOWS)[number];

	const fullSeries = $derived<TrendPoint[]>(dailySeries);

	/** The richest WINDOW that fits the loaded series (largest ≤ n), else 7. */
	const bestFitWindow = $derived.by<WindowDays>(() => {
		const n = fullSeries.length;
		return [...WINDOWS].reverse().find((d) => d <= n) ?? 7;
	});

	// The picker binds a string key (GrainPicker is string-keyed); `windowDays` is
	// the numeric projection. Seed it at the smallest (always-valid) window; the
	// effect below raises it to the richest-fit default once the data settles
	// (unless the rider has already picked), and clamps it back down if the series
	// later shrinks past the chosen window.
	let windowKey = $state('7');
	// Set once the rider picks a window OR the auto-default has been applied, so we
	// never stomp a deliberate choice with the best-fit default.
	let windowSeeded = $state(false);
	const windowDays = $derived.by<WindowDays>(() => {
		const d = Number(windowKey);
		return (WINDOWS as readonly number[]).includes(d) ? (d as WindowDays) : bestFitWindow;
	});

	const windowSegments = $derived.by<GrainSegment<string>[]>(() => {
		const n = fullSeries.length;
		const labels: Record<WindowDays, string> = {
			7: t.window.d7,
			30: t.window.d30,
			90: t.window.d90,
		};
		// A window is offered when ANY data exists; it is DISABLED (never picked)
		// when it would exceed the available length — except the smallest window,
		// which is always offered so there is at least one enabled segment.
		return WINDOWS.map((d, i) => ({
			key: String(d),
			label: labels[d],
			available: n > 0 && (i === 0 || d <= n),
		}));
	});

	// Default to the richest-fit window the first time the data settles, then clamp
	// DOWN if a later (smaller) series no longer fits the chosen window. The 7-day
	// window always fits, so this never loops. The best-fit DEFAULT is applied only
	// ONCE (windowSeeded); afterwards a rider's pick (always ≤ an enabled window)
	// sticks — the clamp branch only fires if a SHRINKING series leaves the chosen
	// window over-long, which a deliberate pick of an enabled segment cannot be.
	$effect(() => {
		const n = fullSeries.length;
		if (n === 0) return;
		if (!windowSeeded) {
			windowKey = String(bestFitWindow);
			windowSeeded = true;
		} else if (windowDays > n && windowDays !== 7) {
			windowKey = String(bestFitWindow);
		}
	});

	// The points the trend renders. On the DAY grain this is the most-recent
	// `windowDays` daily points (clamped to the available length); on week/month it
	// is the FULL (short) coarse series — the 7/30/90 window has no meaning there.
	const windowedSeries = $derived.by<TrendPoint[]>(() => {
		if (grain === 'week') return weeklySeries;
		if (grain === 'month') return monthlySeries;
		return fullSeries.slice(Math.max(0, fullSeries.length - windowDays));
	});

	// --- Delay series toggle (p90 "slowest 10%" vs avg "typical") ------------
	// The retard line can read either the p90 or the avg-delay series; the toggle
	// re-feeds TrendLine's retard series + its own y-domain + axis label. p90 is
	// null on week/month (14d-daily-only), so on a coarse grain the p90 segment is
	// DISABLED and the channel reads avg-delay regardless of the rider's pick.
	let retardKey = $state('p90');

	const retardSegments = $derived.by<GrainSegment<string>[]>(() => [
		// p90 has no week/month data → disabled on a coarse grain (never a flat-null line).
		{ key: 'p90', label: t.trend.retardP90, available: isDailyGrain },
		{ key: 'avg', label: t.trend.retardAvg },
	]);

	// The EFFECTIVE retard series: the rider's pick on the day grain, forced to avg
	// on week/month (where p90 carries no data). A null-safe fallback, never a gap.
	const effectiveRetard = $derived<'p90' | 'avg'>(
		isDailyGrain && retardKey === 'p90' ? 'p90' : 'avg',
	);

	// Clamp the picker's SELECTION (not just the effective series) to 'avg' on a
	// coarse grain. p90 is disabled on week/month, so leaving retardKey='p90' would
	// render the p90 chip BOTH active (value===key) AND disabled while the chart
	// plots avg — a contradictory control. Snapping the key to 'avg' keeps the
	// highlighted chip in lockstep with the plotted series.
	$effect(() => {
		if (!isDailyGrain && retardKey === 'p90') retardKey = 'avg';
	});

	const retardLabel = $derived(
		effectiveRetard === 'avg' ? t.metrics.delayP50 : t.trend.retardLabel,
	);

	// Trend series: on-time % (green, 0–100 axis) vs the chosen delay series
	// (amber, MINUTES). The two carry different units, so the delay series gets its
	// own y-domain [0, niceCeil(max)] — plotting minutes on the percentage axis
	// would squash the delay line flat against the floor. null points are gaps.
	// Consumes the ALREADY-windowed series (one slice, shared with every other
	// mark); the retard channel follows the delay-series toggle (p90 vs avg).
	function buildTrendChart(points: readonly TrendPoint[]) {
		const onTime = points.map((p) => p.otp_pct ?? null);
		const retard = points.map((p) =>
			effectiveRetard === 'avg' ? (p.avg_delay_min ?? null) : (p.p90_min ?? null),
		);
		const maxRetard = retard.reduce<number>((m, v) => (v != null && v > m ? v : m), 0);
		// Round the ceiling up to the nearest 5 min (floor of 10) so the delay
		// trend uses the plot height without hugging the very top edge.
		const retardCeil = Math.max(10, Math.ceil(maxRetard / 5) * 5);
		return {
			onTime,
			retard,
			retardDomain: [0, retardCeil] as [number, number],
			xLabels: points.map((p) => p.date),
		};
	}

	// --- Vehicles-in-service context sparkline -------------------------------
	const vehiclesSeries = $derived<Array<number | null>>(
		windowedSeries.map((p) => p.vehicles ?? null),
	);

	// --- Cancellation-rate trend ---------------------------------------------
	// Stand the whole block DOWN when the series carries no cancellation data
	// (every day null) — never plot a flat zero line.
	const cancelSeries = $derived<Array<number | null>>(
		windowedSeries.map((p) => p.cancellation_rate ?? null),
	);
	const hasCancel = $derived(cancelSeries.some((v) => v != null));
	const cancelLatest = $derived.by<number | null>(() => {
		for (let i = cancelSeries.length - 1; i >= 0; i--) {
			const v = cancelSeries[i];
			if (v != null) return v;
		}
		return null;
	});
	// 0..ceil(max%) domain for the single-series cancellation TrendLine. The
	// onTime channel carries the data; retard is empty (all-null gaps).
	const cancelDomain = $derived.by<[number, number]>(() => {
		const max = cancelSeries.reduce<number>((m, v) => (v != null && v > m ? v : m), 0);
		return [0, Math.max(1, Math.ceil(max))];
	});
	const cancelXLabels = $derived(windowedSeries.map((p) => p.date));
	const cancelEmpty = $derived(cancelSeries.map(() => null) as Array<number | null>);
	/** Format a fractional/percent cancellation value as "2.6%" or "no data". */
	function fmtCancel(v: number | null): string {
		return v == null ? t.noData : `${v.toFixed(1)}${t.units.pct}`;
	}

	// --- Per-day crowding small-multiple -------------------------------------
	// One 100% StackedBar(scale='occupancy') per day THAT HAS occupancy telemetry.
	// A day whose occupancy_mix is null/absent is SKIPPED entirely (never an even
	// split). Each kept day's segments null-guard the same way the live bar does.
	type OccupancyDay = { date: string; dateLabel: string; segments: StackedSegment[] };
	const occupancyDays = $derived.by<OccupancyDay[]>(() =>
		windowedSeries
			.filter(
				(p): p is TrendPoint & { occupancy_mix: NonNullable<TrendPoint['occupancy_mix']> } =>
					p.occupancy_mix != null,
			)
			.map((p) => ({
				date: p.date,
				// Localized short date (e.g. "Jun 15" / "15 juin") — the raw key is a
				// calendar day, so formatDateKey renders it in UTC (never shifting the
				// day). Shared by the visible label + the StackedBar a11y label.
				dateLabel: formatDateKey(p.date, locale),
				segments: OCCUPANCY_CODES.map((code: OccupancyCode) => ({
					code,
					value: p.occupancy_mix[code] ?? null,
					label: OCCUPANCY_LABELS[locale][code],
				})),
			})),
	);
	// Per-day crowding is a DAILY artifact (week/month carry no per-point occupancy
	// mix) → it only shows on the day grain, and only when a day carries telemetry.
	const hasOccupancyTrend = $derived(isDailyGrain && occupancyDays.length > 0);

	// --- By time of day + weekday/weekend (network-wide by_shift / by_daytype) --
	// The historic trend additionally carries network-wide reliability per
	// time-of-day shift (am_peak…night) and day-type (weekday/weekend). The
	// HEADLINE per grain is the REAL on-time % (otp_pct = on-time/known over the
	// trailing window), ranked worst-PUNCTUALITY first (lowest OTP first); a grain
	// with no OTP reading falls back to its severe-delay share for ordering and
	// sorts AFTER every OTP-known grain (worst severe-share first among those). The
	// magnitude bar still encodes the SEVERE-delay share as a [0,1] mark on the
	// dataviz severity scale (NEVER --primary), and avg delay + severe share read
	// as the row subtitle. Honesty: a grain with NO otp AND no severe reading is
	// DROPPED (never a fabricated 0); a null-OTP grain shows the localized no-data
	// string in its headline, never a fake 0%. Each group's section stands down
	// when nothing carries data. Labels come from the SHARED reliability vocabulary
	// (shiftGrains). These grains are a trailing-window proxy → the caveat below.
	type ShiftRow = {
		readonly key: string;
		readonly rank: number;
		readonly title: string;
		readonly severity: SeverityCode;
		readonly value: number | null;
		readonly display: string;
		readonly subtitle: string;
	};

	/** Subtitle: avg delay + severe share, each honest no-data when null. */
	function shiftSubtitle(avg: number | null, severe: number | null): string {
		const avgText = `${t.shift.avgLabel} ${fmtMin(avg)}`;
		const sevText = `${t.shift.severeLabel} ${severe == null ? t.noData : `${severe.toFixed(1)}${t.units.pct}`}`;
		return `${avgText} · ${sevText}`;
	}

	// Rank worst-punctuality first: lowest OTP first; grains with no OTP fall back
	// to severe-share for ordering and sort AFTER every OTP-known grain (worst
	// severe-share first). A grain carrying NEITHER otp NOR severe is dropped (no
	// fabricated 0). The severity bar always encodes the severe share (banded via
	// the shared severeShareToSeverity), so a null-severe grain reads as a quiet
	// no-data bar while its OTP headline still leads.
	function rankByPunctuality(
		rows: readonly NetworkShift[],
		label: (g: string) => string,
	): ShiftRow[] {
		const real = rows.filter((r) => r.otp_pct != null || r.severe_pct != null);
		const worstSevere = real.reduce((m, r) => Math.max(m, r.severe_pct ?? 0), 0);
		return real
			.slice()
			.sort((a, b) => {
				// OTP-known grains always sort before OTP-unknown grains.
				const aHas = a.otp_pct != null;
				const bHas = b.otp_pct != null;
				if (aHas !== bHas) return aHas ? -1 : 1;
				// Both OTP-known: lowest OTP (worst punctuality) first.
				if (aHas && bHas) return (a.otp_pct ?? 0) - (b.otp_pct ?? 0);
				// Both OTP-unknown: worst severe-share first.
				return (b.severe_pct ?? 0) - (a.severe_pct ?? 0);
			})
			.map((r, i) => {
				const sev = r.severe_pct ?? null;
				return {
					key: r.grain,
					rank: i + 1,
					title: label(r.grain),
					// The bar encodes the severe share; null severe → quiet no-data bar.
					severity: severeShareToSeverity(sev),
					value:
						sev != null && worstSevere > 0 ? Math.min(1, Math.max(0, sev / worstSevere)) : null,
					// HEADLINE: the real OTP % (or honest no-data when null).
					display: fmtPct(r.otp_pct ?? null),
					subtitle: shiftSubtitle(r.avg_delay_min ?? null, sev),
				};
			});
	}

	const shiftRows = $derived.by<ShiftRow[]>(() =>
		rankByPunctuality(trend.data?.by_shift ?? [], (g) => shiftLabel(g, locale)),
	);
	const dayTypeRows = $derived.by<ShiftRow[]>(() =>
		rankByPunctuality(trend.data?.by_daytype ?? [], (g) => dayTypeLabel(g, locale)),
	);
	const hasShift = $derived(shiftRows.length > 0);
	const hasDayType = $derived(dayTypeRows.length > 0);

	function openStatusOnMap(code: StatusCode | OccupancyCode): void {
		if (!STATUS_CODES.includes(code as StatusCode)) return;
		openSurface({ kind: 'map', search: mapSearchFor({ status: [code as StatusCode] }) });
	}

	// Wire the crowding bar to the map: the map's vehicle layer consumes an
	// occupancy filter (matchesFilter hides non-matching bands + repaints matches),
	// so selecting a band opens /map pre-filtered to it — a real cross-filter.
	function openOccupancyOnMap(code: StatusCode | OccupancyCode): void {
		if (!OCCUPANCY_CODES.includes(code as OccupancyCode)) return;
		openSurface({ kind: 'map', search: mapSearchFor({ occupancy: [code as OccupancyCode] }) });
	}
</script>

<Surface width="bleed" class="network">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} lede={t.lede}>
		<div class="network-feed-health">
			<LiveFreshness
				generatedUtc={live.generatedUtc}
				ageSeconds={live.ageSeconds}
				isStale={live.isStale}
				{locale}
			/>
			<!-- Worker-cycle feed age — a SECOND freshness signal, distinct from the
			     snapshot-publish age in LiveFreshness. Null → honest no-data. -->
			{#if feedAge != null}
				<span
					class="network-feed-age"
					data-slot="feed-age"
					aria-label={`${t.feedAge.a11yPrefix} ${feedAge}`}
				>
					<span class="network-feed-age-label">{t.feedAge.label}</span>
					<span class="network-feed-age-value">{feedAge}</span>
				</span>
			{/if}
			<ConformanceBadge conformance={provenance.data?.conformance} {locale} />
		</div>
	</SurfaceHeader>

	<Separator variant="hazard" />

	{#if live.network}
		{@const net = live.network}
		<!-- Live headline grid -->
		<div class="network-block">
			<SectionLabel text={t.liveSection} variant="station" />
			<div class="network-metrics">
				<MetricDisplay value={fmtPct(net.on_time_pct)} label={t.metrics.onTime} size="lg" />
				<MetricDisplay
					value={fmtCount(net.vehicles_in_service)}
					label={t.metrics.vehicles}
					size="lg"
				/>
				<!-- Silent vehicles this cycle — an honest denominator for coverage.
				     `non_responding` is a contract-required int, so a plain count is
				     correct here (it is never null → no no-data branch to guard). -->
				<MetricDisplay
					value={fmtCount(net.non_responding)}
					label={t.metrics.notReporting}
					size="lg"
				/>
				<MetricDisplay value={fmtPct(net.coverage_pct)} label={t.metrics.coverage} size="lg" />
				<MetricDisplay value={fmtMin(net.delay_p50_min)} label={t.metrics.delayP50} size="md" />
				<MetricDisplay value={fmtMin(net.delay_p90_min)} label={t.metrics.delayP90} size="md" />
			</div>
		</div>

		<Separator variant="hazard" />

		<!-- Status mix -->
		<div class="network-block">
			<SectionLabel text={t.statusSection} variant="station" />
			<StackedBar
				scale="status"
				segments={statusSegments}
				label={t.statusBarLabel}
				interactive
				legend
				onSelect={openStatusOnMap}
			/>
		</div>

		<!-- Crowding (occupancy) — only when telemetry was received this cycle -->
		{#if hasOccupancy}
			<div class="network-block">
				<SectionLabel text={t.occupancySection} variant="station" />
				<StackedBar
					scale="occupancy"
					segments={occupancySegments}
					label={t.occupancyBarLabel}
					interactive
					legend
					onSelect={openOccupancyOnMap}
				/>
			</div>
		{/if}

		<!-- Delay distribution — the 8 fixed signed-minute buckets of the SAME
		     trip-level delays that power p50/p90. Stands DOWN entirely when
		     `delay_histogram` is null (zero delay observations this cycle); when it
		     is present the contract emits all 8 buckets (zeros included) so we draw
		     the full shape. A token-only bar list (role=list): length encodes the
		     COUNT, colour reads the early/late sense off the status scale. -->
		{#if hasDelayHistogram}
			<Separator variant="hazard" />
			<div class="network-block">
				<SectionLabel text={t.delayHistogramSection} variant="station" />
				<p class="network-hist-caption">{t.delayHistogram.caption}</p>
				<ul
					class="network-hist"
					role="list"
					aria-label={t.delayHistogram.summary}
					data-slot="delay-histogram"
				>
					{#each delayBars as bar (bar.key)}
						<li class="network-hist-row" aria-label={bar.a11y}>
							<span class="network-hist-label" aria-hidden="true">{bar.label}</span>
							<span class="network-hist-track" aria-hidden="true">
								<span
									class="network-hist-fill"
									style="width: {bar.pct}%; background: {bar.colorVar};"
								></span>
							</span>
							<span class="network-hist-count" aria-hidden="true">{fmtCount(bar.count)}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- Non-responding (silent) scheduled trips, by line — a ranked list (worst
		     first) of lines running scheduled trips with NO live vehicle. Placed
		     beside the `non_responding` total tile above; stands DOWN when
		     `non_responding_by_route` is null/empty (the scalar total still shows).
		     list > listitem > link: the <li> owns the listitem role, the anchor owns
		     the interactivity + accessible name, the inner RankedRow is `bare`. -->
		{#if hasSilentRows}
			<Separator variant="hazard" />
			<div class="network-block">
				<SectionLabel text={t.nonRespondingSection} variant="station" />
				<p class="network-silent-caption">{t.nonResponding.caption}</p>
				<ul
					class="network-silent"
					role="list"
					aria-label={t.nonResponding.summary}
					data-slot="non-responding-by-route"
				>
					{#each silentRows as row (row.key)}
						<li class="network-silent-item">
							<a
								class="network-silent-link"
								href={row.href}
								data-sveltekit-preload-data="hover"
								data-slot="silent-link"
								aria-label={row.ariaLabel}
							>
								<RankedRow
									bare
									rank={row.rank}
									title={row.title}
									subtitle={row.subtitle}
									severity={row.severity}
									value={row.value}
									display={row.display}
								/>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{:else if live.error}
		<EdgeState
			variant="error-v1"
			lang={locale}
			layout={edgeLayout}
			onRetry={() => live.refresh()}
		/>
	{:else}
		<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
	{/if}

	<!-- Historic daily trend -->
	<div class="network-block">
		<div class="network-trend-head">
			<SectionLabel text={t.trendSection} variant="station" />
			<div class="network-trend-controls">
				<!-- Trend grain (day / week / month). Offered ONLY when a coarser series
				     carries data — a lone "day" chip is a dead control, so the picker
				     stands down then. p90 / vehicles / per-day crowding are daily-only. -->
				{#if showGrainPicker}
					<GrainPicker
						segments={grainSegments}
						bind:value={grainKey}
						label={t.grain.label}
						class="network-grain"
					/>
				{/if}
				<!-- Trend window (7/30/90-day) — DAY grain only; slices the tail of the
				     daily series. A window longer than the data is disabled (never a dead
				     control). Week/month render their full short series → no window. -->
				{#if isDailyGrain}
					<GrainPicker
						segments={windowSegments}
						bind:value={windowKey}
						label={t.window.label}
						class="network-window"
					/>
				{/if}
			</div>
		</div>
		<ResourceBoundary
			resource={trend}
			lang={locale}
			isEmpty={(d) =>
				(d.series?.length ?? 0) === 0 &&
				(d.weekly?.length ?? 0) === 0 &&
				(d.monthly?.length ?? 0) === 0}
		>
			<!-- The trend chart reads the module-level windowed series (not the
			     boundary payload), so the gated content needs no snippet param —
			     render it as default children. ONE window slice for every mark:
			     buildTrendChart consumes the same `windowedSeries` that the sparkline,
			     cancellation and crowding marks read — the tail is sliced exactly once. -->
			{@const chart = buildTrendChart(windowedSeries)}
			<div class="network-trend">
				<!-- Delay-series toggle: p90 "slowest 10%" vs avg "typical". Re-feeds
				     the retard channel + its y-domain + axis label below. -->
				<GrainPicker
					segments={retardSegments}
					bind:value={retardKey}
					label={t.trend.retardToggleLabel}
					class="network-retard-toggle"
				/>
				<TrendLine
					onTime={chart.onTime}
					retard={chart.retard}
					retardDomain={chart.retardDomain}
					xLabels={chart.xLabels}
					onTimeLabel={t.trend.onTimeLabel}
					{retardLabel}
					yAxis={{ label: t.trend.onTimeLabel, unit: t.units.pct, domain: [0, 100] }}
					retardAxis={{
						label: retardLabel,
						unit: t.units.min,
						domain: chart.retardDomain,
					}}
					showYTicks
					label={t.trend.summary}
					interactive
				/>
				<!-- Vehicles-in-service context: how much fleet reported each day, so
				     OTP/delay reads against its denominator. Null → gap. DAY grain only —
				     vehicles is null on week/month (14d-daily-only). -->
				{#if isDailyGrain}
					<div class="network-vehicles-context">
						<Sparkline
							values={vehiclesSeries}
							label={t.trend.vehiclesSpark}
							xLabels={chart.xLabels}
							colorVar="var(--dataviz-status-unknown)"
							interactive
							showLast
						/>
						<span class="network-context-caption">{t.trend.vehiclesContext}</span>
					</div>
				{/if}
			</div>
		</ResourceBoundary>
	</div>

	<!-- Network-wide cancellation-rate trend — stood DOWN entirely when the series
	     carries no cancellation data (never a flat zero line). -->
	{#if hasCancel}
		<Separator variant="hazard" />
		<div class="network-block">
			<SectionLabel text={t.cancelSection} variant="station" />
			<div class="network-trend">
				<MetricDisplay value={fmtCancel(cancelLatest)} label={t.cancel.metric} size="md" />
				<!-- Single-series: only the cancellation rate is plotted. `singleSeries`
				     suppresses the empty retard legend swatch + its y-tick gutter, so the
				     legend renders ONE line, not a phantom second swatch. -->
				<TrendLine
					onTime={cancelSeries}
					retard={cancelEmpty}
					domain={cancelDomain}
					xLabels={cancelXLabels}
					onTimeLabel={t.cancel.seriesLabel}
					yAxis={{ label: t.cancel.seriesLabel, unit: t.units.pct, domain: cancelDomain }}
					showYTicks
					singleSeries
					label={t.cancel.summary}
					interactive
				/>
			</div>
		</div>
	{/if}

	<!-- Per-day crowding small-multiple — one 100% StackedBar per day WITH
	     occupancy telemetry. Days with no telemetry are skipped (never an even
	     split); the whole block stands down when no day carries crowding data. -->
	{#if hasOccupancyTrend}
		<Separator variant="hazard" />
		<div class="network-block">
			<SectionLabel text={t.occupancyTrendSection} variant="station" />
			<ul
				class="network-occupancy-days"
				aria-label={t.occupancyTrend.summary}
				data-slot="occupancy-trend"
			>
				{#each occupancyDays as day (day.date)}
					<li class="network-occupancy-day">
						<span class="network-occupancy-date">{day.dateLabel}</span>
						<StackedBar
							scale="occupancy"
							segments={day.segments}
							size="sm"
							label={`${t.occupancySection} · ${day.dateLabel}`}
						/>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- By time of day + weekday/weekend — network-wide reliability ranked by
	     PUNCTUALITY (lowest on-time % first). Each row leads with the real OTP %
	     (avg delay + severe share read as the subtitle); the magnitude bar encodes
	     the severe-delay share on the severity scale. Each section stands down when
	     its group carries no data; a grain with no OTP shows honest no-data and a
	     grain with neither OTP nor severe is dropped (never a fake 0). The
	     shift/day-type labels are the SHARED reliability vocabulary. -->
	{#if hasShift || hasDayType}
		<Separator variant="hazard" />
		<div class="network-block" data-slot="network-shift">
			{#if hasShift}
				<div class="network-block">
					<SectionLabel text={t.shiftSection} variant="station" />
					<p class="network-shift-caption">{t.shift.rowCaption}</p>
					<div class="network-ranked" role="list" aria-label={t.shift.shiftSummary}>
						{#each shiftRows as row (row.key)}
							<RankedRow
								rank={row.rank}
								title={row.title}
								subtitle={row.subtitle}
								severity={row.severity}
								value={row.value}
								display={row.display}
							/>
						{/each}
					</div>
				</div>
			{/if}

			{#if hasDayType}
				<div class="network-block network-daytype">
					<SectionLabel text={t.dayTypeSection} variant="station" />
					<p class="network-shift-caption">{t.shift.rowCaption}</p>
					<div class="network-ranked" role="list" aria-label={t.shift.dayTypeSummary}>
						{#each dayTypeRows as row (row.key)}
							<RankedRow
								rank={row.rank}
								title={row.title}
								subtitle={row.subtitle}
								severity={row.severity}
								value={row.value}
								display={row.display}
							/>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Honest caveat: trailing-window observation-weighted proxy, not certified OTP. -->
			<p class="network-shift-caveat" data-slot="shift-caveat">{t.shift.caveat}</p>
		</div>
	{/if}
</Surface>

<style>
	.network-feed-health {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1.25rem;
	}
	.network-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.network-metrics {
		margin: 0;
		display: grid;
		gap: 1.25rem 2rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	@media (min-width: 640px) {
		.network-metrics {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.network-trend {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 40rem;
	}

	/* Worker-feed-age chip — a quiet mono badge beside the LIVE freshness chip. */
	.network-feed-age {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.network-feed-age-label {
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.network-feed-age-value {
		color: var(--foreground);
	}

	/* Trend header: the section label + the grain/window selectors on one row. */
	.network-trend-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	/* The grain + window pickers sit together at the trailing edge of the header. */
	.network-trend-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}

	/* Vehicles-in-service context line under the trend. */
	.network-vehicles-context {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.network-context-caption {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}

	/* Per-day crowding small-multiple — a stacked column of dated mini-bars. */
	.network-occupancy-days {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: 40rem;
	}
	.network-occupancy-day {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
	}
	.network-occupancy-date {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}

	/* By time of day + weekday/weekend ranked lists (worst severe-share first). */
	.network-ranked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 40rem;
	}
	.network-daytype {
		margin-top: 0.5rem;
	}
	/* Quiet mono caption (what the bar encodes) + the honest trailing-window caveat. */
	.network-shift-caption,
	.network-shift-caveat {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.network-shift-caveat {
		max-width: 52ch;
	}

	/* Delay-distribution histogram — a token-only horizontal bar list. Length
	   encodes the bucket count; colour reads the early/late sense (status scale). */
	.network-hist {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: 40rem;
	}
	.network-hist-row {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr) 3rem;
		align-items: center;
		gap: 0.75rem;
	}
	.network-hist-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		text-align: right;
	}
	.network-hist-track {
		display: block;
		height: 0.75rem;
		border-radius: var(--radius-sm);
		background: var(--muted);
		overflow: hidden;
	}
	.network-hist-fill {
		display: block;
		height: 100%;
		min-width: 2px;
		border-radius: var(--radius-sm);
	}
	.network-hist-count {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		text-align: right;
	}
	.network-hist-caption,
	.network-silent-caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
		max-width: 52ch;
	}

	/* Non-responding-by-route ranked list — list > listitem > link; the whole
	   row is a link, strip anchor chrome so RankedRow owns the visuals. */
	.network-silent {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 40rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.network-silent-item {
		display: block;
	}
	.network-silent-link {
		display: block;
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius-lg);
	}
	.network-silent-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
