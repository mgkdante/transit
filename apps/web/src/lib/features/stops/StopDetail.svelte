<!--
  StopDetail — tabbed detail for one stop (slice-9.3).

  Composes the surface spine's EntityDetail scaffold over four canonical tabs:

    next         LIVE  — the live store's per-stop departures board
                         (live.index.byStopId.get(id)), with a freshness chip.
    schedule    STATIC — the static stop's scheduled[] (route + headsign + times).
    info        STATIC — position, code, accessibility + routes served.
    reliability HISTORIC— per-period OTP/delay (→ ReliabilityPane) + by-route
                         avg-delay breakdown.

  Static + historic reads use createResource (browser-side, reactive to `id`);
  the live tier uses createLiveStore (start on mount, stop on destroy). Each pane
  fail-soft via ResourceBoundary / EdgeState — never invent data, never crash.

  Reads locale via getLocale(); copy is co-located in stops.copy.ts. Domain
  vocabulary inside the spine (OTP / delay / LIVE) lives in the primitives.
  Tokens only; --primary interactive-only.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import {
		getStop,
		getStopReliability,
		createLiveStore,
		getV1Context,
		alertsForStop,
		type StopFile,
		type StopReliability,
		type StopDeparture,
	} from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		EntityDetail,
		ResourceBoundary,
		ReliabilityPane,
		GrainPicker,
		LiveFreshness,
		MapDrilldownLink,
		AffectedAlerts,
		type ReliabilityPeriodVM,
		type GrainSegment,
	} from '$lib/components/surface';
	import {
		Heatmap,
		RankedRow,
		ChartLegend,
		StackedBar,
		type StackedSegment,
		HEATMAP_RAMP,
		HEATMAP_NODATA,
	} from '$lib/components/dataviz';
	import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas';
	import type { SeverityCode } from '$lib/v1/schemas';
	// Reuse the SHARED occupancy band vocabulary (the same labels the lines surface
	// renders via detailCopy[locale].occupancyBands) — never a new stop-local table.
	import { detailCopy as linesDetailCopy } from '$lib/features/lines/lines.copy';
	import { availableGrains } from '$lib/filters/grain';
	import {
		SHIFT_GRAIN_ORDER,
		DAY_TYPE_GRAIN_ORDER,
		isShiftGrain,
		isDayTypeGrain,
		shiftLabel,
		dayTypeLabel,
		weekdayLabel,
		severeShareToSeverity,
	} from '$lib/features/reliability/shiftGrains';
	import { EdgeState } from '$lib/components/edge';
	import { ControlsRail, DashboardGrid } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { layout, mapHrefFor } from '$lib/nav';
	import StopLabel from '$lib/components/brand/StopLabel.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		metricInfoFor,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { formatUtc } from '$lib/utils/time';
	import { detailCopy } from './stops.copy';

	interface StopDetailProps {
		/** The stop id from the route param. */
		id: string;
	}

	let { id }: StopDetailProps = $props();

	const locale: Locale = getLocale();
	const t = $derived(detailCopy[locale]);
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	// The in-app metric-explainer (i) affordance, same wiring as the reliability
	// clusters: a one-line tip + a localized deep link to /metrics#<anchor>. An
	// INTERACTIVE control beside each reliability section heading, never a data mark.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey | SupplementalMetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	type TabKey = 'next' | 'schedule' | 'info' | 'reliability';
	const tabs = $derived([
		{ key: 'next', label: t.tabs.next },
		{ key: 'schedule', label: t.tabs.schedule },
		{ key: 'info', label: t.tabs.info },
		{ key: 'reliability', label: t.tabs.reliability },
	] as const satisfies readonly { key: TabKey; label: string }[]);
	let active = $state<TabKey>('next');

	// --- live tier: per-stop departures board --------------------------------
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});
	// Departures for THIS stop from the authoritative per-stop board. null before
	// the first tick (skeleton); [] is a real "no upcoming departures" verdict.
	const departures = $derived<readonly StopDeparture[] | null>(
		live.departures ? (live.index.byStopId.get(id) ?? []) : null,
	);

	// --- static tier: stop detail (info + schedule) --------------------------
	const stop = createResource(() => getStop(id));

	// --- live tier: service alerts affecting THIS stop ------------------------
	// An alert affects this stop if it lists the stop id OR its public code in
	// stops[] (the live feed targets stops by CODE, which differs from the static
	// index id for metro stations), OR lists a route (in routes[]) that SERVES
	// this stop (routes_served from the static file). Reuses the live store's
	// already-loaded alerts — no second fetch. Empty -> the AffectedAlerts section
	// stands down. Honest: never fabricated.
	const stopAlerts = $derived(
		alertsForStop(live.alerts?.alerts, id, stop.data?.code, stop.data?.routes_served),
	);

	// --- historic tier: stop reliability -------------------------------------
	const reliability = createResource(() => getStopReliability(id));

	/* ── Reliability: grain (roll-up) picker ──────────────────────────────────
	   The historic tier offers day|week|month (availableGrains('historic')). We
	   gate the OFFERED segments further on which grains this stop's periods[]
	   actually carry, so an empty grain is never selectable. The default is the
	   richest available grain (day first — it carries the real percentiles). */
	type HistoricGrain = 'day' | 'week' | 'month';
	const HISTORIC_GRAINS = availableGrains('historic') as HistoricGrain[];

	/** The set of grains this stop's periods[] actually carry a row for. */
	const presentGrains = $derived.by<Set<string>>(() => {
		const set = new SvelteSet<string>();
		for (const p of reliability.data?.periods ?? []) set.add(p.grain);
		return set;
	});

	/** The offered grain segments — only grains with data are available. */
	const grainSegments = $derived<GrainSegment<HistoricGrain>[]>(
		HISTORIC_GRAINS.map((g) => ({
			key: g,
			label: t.reliability.grain[g],
			available: presentGrains.has(g),
		})),
	);

	/** The richest available grain (finest present, day→week→month). */
	const defaultGrain = $derived<HistoricGrain>(
		HISTORIC_GRAINS.find((g) => presentGrains.has(g)) ?? 'day',
	);

	let grain = $state<HistoricGrain>('day');
	// Keep the selection on a grain that actually has data — if the current grain
	// carries no period for this stop, fall back to the richest available grain.
	$effect(() => {
		if (!presentGrains.has(grain)) grain = defaultGrain;
	});

	/**
	 * The selected-grain periods → the shared ReliabilityPane view-model.
	 *
	 * The day grain carries a real p50/p90 from the percentile rollup; the
	 * week/month grains carry only an observation-weighted mean. Surface the
	 * true percentile where we have it (captioned "median") and the mean
	 * otherwise (captioned "avg") — never a mean wearing a "median" label.
	 */
	const gradedPeriods = $derived<ReliabilityPeriodVM[]>(
		(reliability.data?.periods ?? [])
			.filter((p) => p.grain === grain)
			.map((p) => {
				const hasRealP50 = p.p50_min != null;
				return {
					// The card heading shows the LOCALIZED grain (Day/Jour…), sourced from
					// copy — never the raw contract string ('day'), which a FR reader would
					// otherwise see while the GrainPicker above reads "Jour".
					grain: t.reliability.grain[p.grain as HistoricGrain] ?? p.grain,
					otpPct: p.otp_pct ?? null,
					delayMin: hasRealP50 ? p.p50_min! : (p.avg_delay_min ?? null),
					delayKind: hasRealP50 ? ('median' as const) : ('avg' as const),
					p90Min: p.p90_min ?? null,
					severePct: p.severe_pct ?? null,
				};
			}),
	);

	/**
	 * Day-grain percentile clarity — the day period's typical (p50) vs worst-case
	 * (p90). The pipeline emits at most one day period, so we read that single row.
	 * Surfaced as its own prominent pair when the day grain is selected; null
	 * fields render the localized no-data string, never 0.
	 */
	const dayPercentiles = $derived.by<{ p50: number | null; p90: number | null } | null>(() => {
		if (grain !== 'day') return null;
		const days = (reliability.data?.periods ?? []).filter((p) => p.grain === 'day');
		if (days.length === 0) return null;
		const last = days[days.length - 1];
		if (last.p50_min == null && last.p90_min == null) return null;
		return { p50: last.p50_min ?? null, p90: last.p90_min ?? null };
	});

	const fmtMin = (v: number | null): string =>
		v == null ? t.reliability.noDelay : `${v.toFixed(1)} min`;

	/* ── Reliability: per-route ranked severity bars ──────────────────────────
	   Rank the by_route breakdown worst-delay first, each bar banded off its
	   avg_delay_min on the dataviz severity scale + normalized against the worst
	   route at this stop. Rows with no delay are dropped (no fake-0 ranking). */
	const rankedRoutes = $derived.by(() => {
		const rows = (reliability.data?.by_route ?? [])
			.filter((br): br is typeof br & { avg_delay_min: number } => br.avg_delay_min != null)
			.slice()
			.sort((a, b) => b.avg_delay_min - a.avg_delay_min);
		const worst = rows.length ? rows[0].avg_delay_min : 0;
		return rows.map((br, i) => {
			const delay = br.avg_delay_min;
			const severity: SeverityCode = delay >= 10 ? 'critical' : delay >= 5 ? 'high' : 'watch';
			return {
				key: br.route,
				rank: i + 1,
				title: br.route,
				severity,
				value: worst > 0 ? Math.min(1, Math.max(0, delay / worst)) : null,
				display: fmtMin(delay),
			};
		});
	});

	/* ── Reliability: weekday seasonality (day_of_week) ───────────────────────
	   The pipeline emits, alongside the calendar/shift grains, a per-stop weekday
	   series (ISO 1=Mon..7=Sun): each row carries a mean delay + a severe share +
	   an observation count for that weekday across the trailing window. We rank it
	   worst-first by mean delay (mirroring the lines surface's Cluster05 weekday
	   list) on the dataviz severity scale.

	   Honesty: a weekday earns a row ONLY when it carries a real mean delay — a
	   null-avg or zero-observation weekday is dropped (never a fabricated 0-delay
	   bar). The severe share is shown as a second reading ONLY when enough
	   observations back it (a 1–2-observation bucket keeps the plain avg caption,
	   never a severe number on thin air). The whole section stands down when
	   day_of_week is empty/absent. */

	// A weekday severe share resting on too few observations is withheld (the mean
	// delay still ranks, but the severe reading would over-claim from a thin sample).
	const MIN_WEEKDAY_SEVERE_OBSERVATIONS = 5;

	const rankedWeekdays = $derived.by(() => {
		const rows = (reliability.data?.day_of_week ?? [])
			.filter((d): d is typeof d & { avg_delay_min: number } => d.avg_delay_min != null)
			.map((d) => ({
				iso: d.day_of_week_iso,
				delay: d.avg_delay_min,
				severePct: d.severe_pct ?? null,
				observationCount: d.observation_count ?? null,
			}));
		const worst = rows.reduce((m, r) => Math.max(m, r.delay), 0);
		return rows
			.slice()
			.sort((a, b) => b.delay - a.delay)
			.map((r, i) => {
				// Normalize against the busiest weekday so the bar reads relative.
				const norm = worst > 0 ? r.delay / worst : 0;
				const severity: SeverityCode = norm >= 0.66 ? 'critical' : norm >= 0.33 ? 'high' : 'watch';
				const severeTrusted =
					r.severePct != null &&
					r.observationCount != null &&
					r.observationCount >= MIN_WEEKDAY_SEVERE_OBSERVATIONS;
				return {
					key: r.iso,
					rank: i + 1,
					title: weekdayLabel(r.iso, locale),
					subtitle: severeTrusted
						? `${t.reliability.weekday.severeShare} ${r.severePct!.toFixed(1)}%`
						: t.reliability.weekday.avgDelay,
					severity,
					value: norm,
					display: `${r.delay.toFixed(1)} min`,
				};
			});
	});
	/** The weekday-seasonality section stands down unless a real-delay weekday survived. */
	const hasWeekday = $derived(rankedWeekdays.length > 0);

	/* ── Reliability: by time of day (shift + day-type grains) ────────────────
	   The pipeline emits, alongside the calendar grains (day/week/month), two
	   extra grain families on the SAME periods[] array — SHIFT grains
	   (am_peak…night) and DAY-TYPE grains (weekday/weekend). We partition them
	   out HERE (the calendar grains keep feeding the GrainPicker + ReliabilityPane
	   untouched) and surface them the way the lines surface does:
	     - SHIFT grains → a "By time of day" ranked list (worst severe share first);
	     - DAY-TYPE grains → a weekday-vs-weekend 2-row ranked comparison.
	   Honesty: a grain with no severe + no avg signal is DROPPED (never a fake-0
	   bar); the whole section stands down when the stop carries none of them. */
	type ShiftRow = { grain: string; severePct: number | null; avgDelayMin: number | null };

	/** Split this stop's periods into clean shift / day-type groups (calendar grains stay out). */
	const partitionedToD = $derived.by<{ byShift: ShiftRow[]; byDayType: ShiftRow[] }>(() => {
		const byShift: ShiftRow[] = [];
		const byDayType: ShiftRow[] = [];
		for (const p of reliability.data?.periods ?? []) {
			// These sections RANK by severe share (the bar + the "% severe" display),
			// so a period earns a row only when it carries a real severe share. A
			// period with only an avg delay has no place in a severe-share ranking —
			// dropping it here keeps the partition and the ranker in lock-step (an
			// avg-only period would otherwise survive the partition yet vanish from
			// the list). Its avg delay still surfaces in the by-route / calendar panes;
			// we never fabricate a severe share (or a 0) to keep it.
			if (p.severe_pct == null) continue;
			const row: ShiftRow = {
				grain: p.grain,
				severePct: p.severe_pct ?? null,
				avgDelayMin: p.avg_delay_min ?? null,
			};
			if (isShiftGrain(p.grain)) byShift.push(row);
			else if (isDayTypeGrain(p.grain)) byDayType.push(row);
		}
		return { byShift, byDayType };
	});

	/**
	 * Rank a group of shift/day-type rows worst-first by severe share, banding each
	 * bar on the dataviz severity scale + normalizing against the worst row in the
	 * SAME group (mirroring Cluster01Punctuality.rankBySevere). A row with a null
	 * severe share is dropped (no fake-0 ranking); `order` keeps a stable secondary
	 * sort so equal-severe rows read in canonical chronological token order.
	 */
	function rankBySevere(
		rows: readonly ShiftRow[],
		order: readonly string[],
		label: (g: string) => string,
	) {
		const real = rows.filter((r) => r.severePct != null);
		const worst = real.reduce((m, r) => Math.max(m, r.severePct ?? 0), 0);
		const rank = (g: string) => {
			const i = order.indexOf(g);
			return i === -1 ? order.length : i;
		};
		return real
			.slice()
			.sort((a, b) => (b.severePct ?? 0) - (a.severePct ?? 0) || rank(a.grain) - rank(b.grain))
			.map((r, i) => {
				const sev = r.severePct ?? 0;
				return {
					key: r.grain,
					rank: i + 1,
					title: label(r.grain),
					severity: severeShareToSeverity(r.severePct),
					value: worst > 0 ? Math.min(1, Math.max(0, sev / worst)) : null,
					display: `${sev.toFixed(1)}%`,
				};
			});
	}

	const shiftRows = $derived(
		rankBySevere(partitionedToD.byShift, SHIFT_GRAIN_ORDER, (g) => shiftLabel(g, locale)),
	);
	const dayTypeRows = $derived(
		rankBySevere(partitionedToD.byDayType, DAY_TYPE_GRAIN_ORDER, (g) => dayTypeLabel(g, locale)),
	);
	/** The whole "By time of day" section stands down unless a shift OR day-type row survived. */
	const hasTimeOfDay = $derived(shiftRows.length > 0 || dayTypeRows.length > 0);

	/* ── Reliability: time-of-day habits heatmap ──────────────────────────────
	   The per-stop habits matrix (7×24, cells number|null) reuses the Heatmap +
	   ChartLegend dataviz primitives directly (same encoding the lines surface
	   uses). A null cell is "no data" — the Heatmap paints the dedicated nodata
	   token. When NO cell carries a real value the whole subsection stands down
	   (we never draw a fabricated empty grid). */
	const habitsMatrix = $derived<(number | null)[][]>(reliability.data?.habits?.matrix ?? []);
	const hasHabits = $derived(habitsMatrix.some((row) => row.some((cell) => cell != null)));

	/** Heatmap scale legend — three ramp buckets (low→high) + the no-data swatch. */
	const habitsLegend = $derived([
		{
			colorVar: HEATMAP_RAMP[0],
			label: t.reliability.habits.legend.low,
			swatch: 'square' as const,
		},
		{
			colorVar: HEATMAP_RAMP[2],
			label: t.reliability.habits.legend.medium,
			swatch: 'square' as const,
		},
		{
			colorVar: HEATMAP_RAMP[HEATMAP_RAMP.length - 1],
			label: t.reliability.habits.legend.high,
			swatch: 'square' as const,
		},
		{
			colorVar: HEATMAP_NODATA,
			label: t.reliability.habits.legend.noData,
			swatch: 'square' as const,
		},
	]);

	const habitsFullDays = $derived(t.reliability.habits.weekdays.slice(1));

	/** A cell's plain-language intensity word (bucketed on the same ramp the colour uses). */
	function habitsCellText(value: number | null, norm: number | null): string {
		if (value == null || norm == null) return t.reliability.habits.legend.noData;
		const bucket = Math.min(4, Math.floor(Math.min(1, Math.max(0, norm)) * 5));
		return [
			t.reliability.habits.legend.low,
			t.reliability.habits.legend.low,
			t.reliability.habits.legend.medium,
			t.reliability.habits.legend.high,
			t.reliability.habits.legend.high,
		][bucket];
	}

	/* ── Reliability: crowding (occupancy_mix) ────────────────────────────────
	   The trailing-window occupancy band-shares of buses OBSERVED AT this stop
	   (GTFS-RT VehiclePosition stop_id) — NOT a stop attribute. Rendered as a
	   100%-stacked proportion bar (StackedBar, scale='occupancy'), reusing the
	   dataviz occupancy scale + the SHARED lines band vocabulary, mirroring the
	   lines Cluster04Crowding pattern.

	   Honesty (Cluster04 doctrine): occupancy_mix is null when no telemetry was
	   attributed to this stop. An all-zero mix is ALSO treated as empty. In both
	   cases the bar stands down; once the reliability resource HAS loaded but
	   carries no crowding telemetry, an explicit bilingual "no telemetry" note
	   renders in its place (template {:else} branch) — NEVER a fabricated bar and
	   never an even/all-empty split. Every band is a data mark on the dataviz
	   occupancy scale; --primary never colours a band. */

	/** The shared occupancy band labels (legend + a11y + headline), keyed by code. */
	const occupancyBands = $derived(linesDetailCopy[locale].occupancyBands);

	/** The raw mix, treated as empty unless at least one band carries a real share. */
	const crowdingMix = $derived.by(() => {
		const mix = reliability.data?.occupancy_mix ?? null;
		if (mix == null) return null;
		const hasShare = OCCUPANCY_CODES.some((c: OccupancyCode) => (mix[c] ?? 0) > 0);
		return hasShare ? mix : null;
	});
	/** The whole crowding section stands down when there is no real telemetry. */
	const hasCrowding = $derived(crowdingMix != null);

	/**
	 * Honest no-telemetry note: shown when the reliability resource HAS loaded
	 * (reliability.data != null) but no crowding telemetry was attributed to this
	 * stop (occupancy_mix null/absent, or an all-zero mix that crowdingMix treats
	 * as empty). This is crowding-specific — a stop with reliability data but no
	 * observed-bus loading earns an explicit note rather than silently nothing.
	 * Before the resource settles we render neither (the bar's skeleton owns that).
	 */
	const showCrowdingNoTelemetry = $derived(reliability.data != null && !hasCrowding);

	/** The five occupancy bands as StackedBar segments (fractions 0..1). */
	const crowdingSegments = $derived.by<StackedSegment[]>(() =>
		OCCUPANCY_CODES.map((code: OccupancyCode) => ({
			code,
			value: crowdingMix ? (crowdingMix[code] ?? null) : null,
			label: occupancyBands[code],
		})),
	);

	/** Total band share — guards the dominant-band headline + its share math. */
	const crowdingTotal = $derived(
		crowdingSegments.reduce((sum, s) => sum + (s.value != null && s.value > 0 ? s.value : 0), 0),
	);

	/** The largest band — lifted to a MetricDisplay as the single-glance read. */
	const crowdingDominant = $derived.by(() => {
		if (!hasCrowding || crowdingTotal <= 0) return null;
		let best: { code: OccupancyCode; label: string; share: number } | null = null;
		for (const code of OCCUPANCY_CODES) {
			const v = crowdingMix ? (crowdingMix[code] ?? null) : null;
			if (v == null || v <= 0) continue;
			if (best == null || v > best.share) best = { code, label: occupancyBands[code], share: v };
		}
		return best;
	});

	/** Dominant-band share as a whole-percent string (e.g. "62%"). */
	const crowdingDominantPct = $derived(
		crowdingDominant ? `${Math.round((crowdingDominant.share / crowdingTotal) * 100)}%` : null,
	);

	/* ── Live departures: status + route filters ──────────────────────────────
	   The live board carries a delay_min per departure; the reader narrows it
	   with combinable status chips (on-time / late / early) + an optional
	   by-route chip. Both default to "off" (everything shown); an empty result
	   after filtering shows a localized empty state, never a crash. */
	type DepartureStatus = 'on-time' | 'late' | 'early';

	/** A departure's status, banded off its delay (0 / null = on time). */
	function departureStatus(delayMin: number | null | undefined): DepartureStatus {
		if (delayMin == null || delayMin === 0) return 'on-time';
		return delayMin > 0 ? 'late' : 'early';
	}

	const statusFilter = new SvelteSet<DepartureStatus>();
	let routeFilter = $state<string | null>(null);

	// ONE StopDetail instance is reused across /stop/A → /stop/B param changes, so
	// per-stop view state (departure filters, grain, active tab) would otherwise
	// carry over stale. Reading `id` registers the dependency: on each stop change
	// we reset to a clean default for the new stop.
	$effect(() => {
		void id;
		statusFilter.clear();
		routeFilter = null;
		grain = defaultGrain;
		active = 'next';
	});

	function toggleStatus(s: DepartureStatus): void {
		if (statusFilter.has(s)) statusFilter.delete(s);
		else statusFilter.add(s);
	}

	// Distinct routes on the current board (stable, board order), for the chips.
	const departureRoutes = $derived.by<string[]>(() => {
		const seen = new SvelteSet<string>();
		const out: string[] = [];
		for (const d of departures ?? []) {
			if (d.route != null && !seen.has(d.route)) {
				seen.add(d.route);
				out.push(d.route);
			}
		}
		return out;
	});

	// A route that leaves the board (filter narrowed away) is cleared so the view
	// never pins to a route with no departures.
	$effect(() => {
		if (routeFilter != null && !departureRoutes.includes(routeFilter)) routeFilter = null;
	});

	const filteredDepartures = $derived.by<readonly StopDeparture[] | null>(() => {
		if (departures == null) return null;
		return departures.filter((d) => {
			if (statusFilter.size > 0 && !statusFilter.has(departureStatus(d.delay_min))) return false;
			if (routeFilter != null && d.route !== routeFilter) return false;
			return true;
		});
	});

	/** A departure's delay caption — fail-soft when delay is absent. */
	function delayLabel(delayMin: number | null | undefined): string {
		if (delayMin == null || delayMin === 0) return t.next.onTime;
		return delayMin > 0 ? t.next.late(delayMin) : t.next.early(Math.abs(delayMin));
	}
</script>

<!-- The (i) metric-explainer affordance, reused beside each reliability section
     heading. Declared at the top level so the pane snippets (passed to
     EntityDetail) can render it; mirrors RouteDetail's scheduleInfo. -->
{#snippet metricInfo(key: MetricKey | SupplementalMetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo
		class="stop-metric-info"
		tip={i.tip}
		href={i.href}
		label={i.label}
		linkLabel={i.linkLabel}
		side="bottom"
	/>
{/snippet}

<EntityDetail
	kicker={t.kicker}
	back={{ href: localizeHref('/stops', locale), label: t.back }}
	{tabs}
	bind:active
>
	{#snippet header()}
		<div class="stop-detail-head">
			<StopLabel stop={id} label={stop.data?.name ?? `#${id}`} />
			<MapDrilldownLink
				href={mapHrefFor({ stop: id }, locale)}
				label={t.viewOnMap}
				ariaLabel={t.viewStopOnMap(id)}
			/>
		</div>
	{/snippet}

	{#snippet pane(key)}
		{#if key === 'next'}
			<!-- LIVE: per-stop departures board. Skeleton until the first tick. -->
			{#if departures == null}
				<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
			{:else}
				<div class="stop-next">
					<div class="stop-next-head">
						<SectionLabel text={t.next.heading} variant="station" />
						<LiveFreshness
							generatedUtc={live.generatedUtc}
							ageSeconds={live.ageSeconds}
							isStale={live.isStale}
							{locale}
						/>
					</div>
					{#if departures.length === 0}
						<EdgeState variant="empty" lang={locale} layout={edgeLayout} />
					{:else}
						<!-- Combinable status chips + an optional by-route chip narrow the
						     board, collected into ONE ControlsRail (quiet infra chrome,
						     discerned from the data canvas). Both default off (everything
						     shown); the data marks are unchanged — these are INTERACTION
						     controls, so --primary lives only on the active chip. -->
						<ControlsRail label={t.next.controlsLabel}>
							<div class="stop-chip-group" role="group" aria-label={t.next.filter.statusLabel}>
								{#each ['on-time', 'late', 'early'] as const as s (s)}
									<button
										type="button"
										class="stop-chip"
										class:stop-chip--active={statusFilter.has(s)}
										aria-pressed={statusFilter.has(s)}
										onclick={() => toggleStatus(s)}
									>
										{s === 'on-time'
											? t.next.filter.onTime
											: s === 'late'
												? t.next.filter.late
												: t.next.filter.early}
									</button>
								{/each}
							</div>
							{#if departureRoutes.length > 1}
								<div class="stop-chip-group" role="group" aria-label={t.next.filter.routeLabel}>
									<button
										type="button"
										class="stop-chip"
										class:stop-chip--active={routeFilter == null}
										aria-pressed={routeFilter == null}
										onclick={() => (routeFilter = null)}
									>
										{t.next.filter.allRoutes}
									</button>
									{#each departureRoutes as route (route)}
										<button
											type="button"
											class="stop-chip"
											class:stop-chip--active={routeFilter === route}
											aria-pressed={routeFilter === route}
											onclick={() => (routeFilter = routeFilter === route ? null : route)}
										>
											{route}
										</button>
									{/each}
								</div>
							{/if}
							<p class="stop-departures-count" aria-live="polite">
								{t.next.filter.showing(filteredDepartures?.length ?? 0, departures.length)}
							</p>
						</ControlsRail>

						<!-- Hazard tape discerns the controls zone from the data canvas. -->
						<Separator variant="hazard" hazardSize="sm" />

						{#if (filteredDepartures?.length ?? 0) === 0}
							<p class="stop-departures-empty" data-testid="departures-filter-empty">
								{t.next.filter.noMatches}
							</p>
						{:else}
							<ul class="stop-departures">
								{#each filteredDepartures ?? [] as d, i (`${d.trip ?? d.route ?? 'dep'}-${d.eta_utc}-${i}`)}
									<li class="stop-departure">
										<span class="stop-departure-route">{d.route ?? t.next.route}</span>
										<span class="stop-departure-eta">{formatUtc(d.eta_utc, locale)}</span>
										<span class="stop-departure-delay">{delayLabel(d.delay_min)}</span>
									</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</div>
			{/if}
		{:else if key === 'schedule'}
			<!-- STATIC: scheduled service grouped by route. -->
			<ResourceBoundary
				resource={stop}
				lang={locale}
				isEmpty={(s: StopFile | null) => (s?.scheduled?.length ?? 0) === 0}
			>
				{#snippet children(s: StopFile | null)}
					<div class="stop-schedule">
						<SectionLabel text={t.schedule.heading} variant="station" />
						{#each s?.scheduled ?? [] as entry, i (`${entry.route}-${entry.headsign ?? i}`)}
							<div class="stop-schedule-route">
								<div class="stop-schedule-route-head">
									<span class="stop-schedule-route-code">{entry.route}</span>
									{#if entry.headsign}
										<span class="stop-schedule-headsign">{entry.headsign}</span>
									{/if}
								</div>
								{#if (entry.times?.length ?? 0) > 0}
									<ul class="stop-schedule-times">
										{#each (entry.times ?? []).slice(0, 24) as time, ti (`${time}-${ti}`)}
											<li class="stop-schedule-time">{time}</li>
										{/each}
										{#if (entry.times?.length ?? 0) > 24}
											<li class="stop-schedule-time-more" aria-hidden="true">
												{t.schedule.moreTimes((entry.times?.length ?? 0) - 24)}
											</li>
										{/if}
									</ul>
								{/if}
							</div>
						{/each}
					</div>
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'info'}
			<!-- STATIC: position, code, accessibility + routes served. -->
			<ResourceBoundary resource={stop} lang={locale}>
				{#snippet children(s: StopFile | null)}
					{#if s == null}
						<EdgeState variant="empty" lang={locale} layout={edgeLayout} />
					{:else}
						<div class="stop-info">
							<!-- LIVE: service alerts affecting this stop (stands down when none). -->
							<AffectedAlerts alerts={stopAlerts} {locale} copy={t.alerts} testId="stop-alerts" />
							<div class="stop-info-metrics">
								<MetricDisplay
									value={`${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`}
									label={t.info.position}
									size="sm"
								/>
								{#if s.code}
									<MetricDisplay value={s.code} label={t.info.code} size="sm" />
								{/if}
								{#if s.wheelchair != null}
									<MetricDisplay
										value={s.wheelchair ? t.info.wheelchairYes : t.info.wheelchairNo}
										label={t.info.wheelchair}
										size="sm"
									/>
								{/if}
							</div>
							{#if (s.routes_served?.length ?? 0) > 0}
								<div class="stop-info-routes">
									<SectionLabel text={t.info.routesServed} variant="metric" />
									<ul class="stop-info-route-chips">
										{#each s.routes_served ?? [] as route (route)}
											<li><Badge variant="tag" size="sm">{route}</Badge></li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					{/if}
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'reliability'}
			<!-- HISTORIC: per-period OTP/delay + by-route avg-delay breakdown. -->
			<ResourceBoundary
				resource={reliability}
				lang={locale}
				isEmpty={(r: StopReliability | null) =>
					r == null ||
					((r.periods?.length ?? 0) === 0 &&
						r.occupancy_mix == null &&
						(r.day_of_week?.length ?? 0) === 0 &&
						(r.by_route?.length ?? 0) === 0)}
			>
				{#snippet children(r: StopReliability | null)}
					{#if r != null}
						<div class="stop-reliability">
							<!-- Grain (roll-up) picker + window caption, collected into ONE
							     ControlsRail (quiet infra chrome): the reader chooses day|week|month
							     instead of all three dumped as undifferentiated cards. Only grains
							     with data are offered; default = the richest available grain. The
							     radiogroup role stays inside the rail. -->
							<ControlsRail label={t.reliability.controlsLabel}>
								<GrainPicker
									segments={grainSegments}
									bind:value={grain}
									label={t.reliability.grain.label}
								/>
								<p class="stop-reliability-window" aria-live="polite">
									{t.reliability.grain.window(grain)}
								</p>
							</ControlsRail>

							<!-- Hazard tape discerns the controls zone from the data canvas. -->
							<Separator variant="hazard" hazardSize="sm" />

							<!-- The seven readouts tile into a fluid board: multi-column on
							     desktop, one column on mobile. Each {#if has...} stand-down keeps a
							     readout out of the grid entirely (the grid reflows; never a
							     fabricated tile). The habits heatmap spans the full board width since
							     it is a 7x24 matrix. -->
							<DashboardGrid minTile="340px" gutter={false}>
								<!-- Day-grain percentile clarity: typical (p50) vs worst-case (p90),
							     surfaced prominently rather than buried with a placeholder. -->
								{#if dayPercentiles != null}
									<div class="stop-tile stop-reliability-percentiles">
										<span class="stop-tile-heading">
											<SectionLabel text={t.reliability.percentiles.heading} variant="station" />
											{@render metricInfo('p50p90', t.reliability.percentiles.heading)}
										</span>
										<div class="stop-reliability-percentile-tiles">
											<MetricDisplay
												value={fmtMin(dayPercentiles.p50)}
												label={t.reliability.percentiles.typical}
												sublabel={t.reliability.percentiles.typicalCaption}
												size="md"
											/>
											<MetricDisplay
												value={fmtMin(dayPercentiles.p90)}
												label={t.reliability.percentiles.worstCase}
												sublabel={t.reliability.percentiles.worstCaseCaption}
												size="md"
											/>
										</div>
									</div>
								{/if}

								<!-- ReliabilityPane self-guards on a non-empty `periods`, so guard its
							     wrapping tile on the SAME condition — otherwise an empty bordered
							     card (a fabricated tile) lingers in the grid when the selected grain
							     carries no periods. Standing the tile down lets the auto-fit grid
							     reflow past it, exactly like every sibling readout. -->
								{#if gradedPeriods.length > 0}
									<div class="stop-tile" data-slot="stop-reliability-pane">
										<!-- The shared ReliabilityPane owns the OTP / delay / severe data marks;
									     its three intrinsic metrics each get an (i) here at the section
									     heading, never inside the primitive's internals. -->
										<span class="stop-tile-heading stop-tile-heading--metrics">
											<SectionLabel text={t.reliability.paneHeading} variant="station" />
											{@render metricInfo('otp', t.reliability.metrics.otp)}
											{@render metricInfo('avgDelay', t.reliability.metrics.avgDelay)}
											{@render metricInfo('severe', t.reliability.metrics.severe)}
										</span>
										<ReliabilityPane periods={gradedPeriods} {locale} />
									</div>
								{/if}

								<!-- Time-of-day habits heatmap (per-stop 7×24 severe-delay grid).
							     Stands down entirely when no cell carries data. -->
								{#if hasHabits}
									<div
										class="stop-tile stop-tile--wide stop-reliability-habits"
										data-slot="stop-habits"
									>
										<span class="stop-tile-heading">
											<SectionLabel text={t.reliability.habits.heading} variant="station" />
											{@render metricInfo('habits', t.reliability.habits.heading)}
										</span>
										<Heatmap
											grid={habitsMatrix}
											dayLabels={[...t.reliability.habits.weekdaysShort]}
											fullDayLabels={[...habitsFullDays]}
											label={t.reliability.habits.label}
											hourAxisLabel={t.reliability.habits.hourAxisLabel}
											dayAxisLabel={t.reliability.habits.dayAxisLabel}
											valueLabel={t.reliability.habits.cellValueLabel}
											noDataText={t.reliability.habits.legend.noData}
											hourTicks={[0, 3, 6, 9, 12, 15, 18, 21]}
											clockTicks
											valueFormat={habitsCellText}
											interactive
										/>
										<ChartLegend items={habitsLegend} />
										<p class="stop-reliability-habits-caption">
											{t.reliability.habits.caption}
										</p>
									</div>
								{/if}

								<!-- Crowding (occupancy_mix): how full the buses OBSERVED AT this stop
							     ran over the trailing window — a property of the buses seen here,
							     NOT of the stop. A 100%-stacked occupancy proportion bar reusing the
							     dataviz occupancy scale + the shared lines band vocabulary. When no
							     occupancy data was attributed (mix null/absent or all-zero), the bar
							     stands down and — once the reliability resource has loaded — an
							     explicit bilingual "no telemetry" note renders in its place; never a
							     fabricated bar, never an even/all-empty split. -->
								{#if hasCrowding && crowdingDominant != null}
									<div class="stop-tile stop-reliability-crowding" data-slot="stop-crowding">
										<span class="stop-tile-heading">
											<SectionLabel text={t.reliability.crowding.heading} variant="station" />
											{@render metricInfo('occupancy', t.reliability.crowding.heading)}
										</span>
										<p class="stop-reliability-window">{t.reliability.crowding.window}</p>
										<MetricDisplay
											value={crowdingDominantPct ?? t.reliability.noDelay}
											label={crowdingDominant.label}
											sublabel={t.reliability.crowding.dominantLabel}
											size="md"
										/>
										<StackedBar
											scale="occupancy"
											segments={crowdingSegments}
											label={t.reliability.crowding.barLabel}
											size="sm"
											legend
											interactive
											class="stop-crowding-bar"
										/>
									</div>
								{:else if showCrowdingNoTelemetry}
									<!-- Reliability loaded, but no crowding telemetry was attributed to
								     this stop: an honest note rather than silently nothing. Keeps the
								     "buses observed here, not a stop attribute" framing via the heading. -->
									<div class="stop-tile stop-reliability-crowding" data-slot="stop-crowding-empty">
										<span class="stop-tile-heading">
											<SectionLabel text={t.reliability.crowding.heading} variant="station" />
											{@render metricInfo('occupancy', t.reliability.crowding.heading)}
										</span>
										<p class="stop-reliability-window">{t.reliability.crowding.noTelemetry}</p>
									</div>
								{/if}

								<!-- Weekday seasonality (day_of_week): which weekday drags this stop
							     down most, ranked worst-first by mean delay on the dataviz severity
							     scale. A weekday with no mean delay is dropped (never a fake-0 bar);
							     the severe share rides as a second reading only when enough
							     observations back it. Stands down when day_of_week is empty/absent. -->
								{#if hasWeekday}
									<div class="stop-tile stop-reliability-weekday" data-slot="stop-weekday">
										<span class="stop-tile-heading">
											<SectionLabel text={t.reliability.weekday.heading} variant="station" />
											{@render metricInfo('seasonality', t.reliability.weekday.heading)}
										</span>
										<div
											class="stop-reliability-route-list"
											role="list"
											aria-label={t.reliability.weekday.heading}
										>
											{#each rankedWeekdays as row (row.key)}
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
										<p class="stop-reliability-weekday-caveat">{t.reliability.weekday.caveat}</p>
									</div>
								{/if}

								<!-- By time of day: SHIFT buckets (ranked by severe share) + a
							     weekday-vs-weekend day-type comparison. Surfaced from the granular
							     grains the pipeline emits alongside the calendar ones; these never
							     enter the GrainPicker above. Stands down entirely when the stop
							     carries no shift/day-type grain. A trailing-window proxy. -->
								{#if hasTimeOfDay}
									<div class="stop-tile stop-reliability-tod" data-slot="stop-time-of-day">
										<span class="stop-tile-heading">
											<SectionLabel text={t.reliability.timeOfDay.heading} variant="station" />
											{@render metricInfo('severe', t.reliability.timeOfDay.heading)}
										</span>
										{#if shiftRows.length > 0}
											<div
												class="stop-reliability-route-list"
												role="list"
												aria-label={t.reliability.timeOfDay.heading}
											>
												{#each shiftRows as row (row.key)}
													<RankedRow
														rank={row.rank}
														title={row.title}
														subtitle={t.reliability.timeOfDay.severeShare}
														severity={row.severity}
														value={row.value}
														display={row.display}
													/>
												{/each}
											</div>
										{/if}

										{#if dayTypeRows.length > 0}
											<div class="stop-reliability-tod-daytype" data-slot="stop-day-type">
												<SectionLabel text={t.reliability.timeOfDay.dayType} variant="metric" />
												<div
													class="stop-reliability-route-list"
													role="list"
													aria-label={t.reliability.timeOfDay.dayType}
												>
													{#each dayTypeRows as row (row.key)}
														<RankedRow
															rank={row.rank}
															title={row.title}
															subtitle={t.reliability.timeOfDay.severeShare}
															severity={row.severity}
															value={row.value}
															display={row.display}
														/>
													{/each}
												</div>
											</div>
										{/if}

										<p class="stop-reliability-tod-caveat">{t.reliability.timeOfDay.caveat}</p>
									</div>
								{/if}

								<!-- By-route ranked severity bars: worst line first, banded off its
							     avg delay so the reader sees WHICH line drags this stop down. -->
								{#if rankedRoutes.length > 0}
									<div class="stop-tile stop-reliability-routes">
										<span class="stop-tile-heading">
											<SectionLabel text={t.reliability.byRoute} variant="station" />
											{@render metricInfo('avgDelay', t.reliability.byRoute)}
										</span>
										<div class="stop-reliability-route-list" role="list">
											{#each rankedRoutes as row (row.key)}
												<RankedRow
													rank={row.rank}
													title={row.title}
													severity={row.severity}
													value={row.value}
													display={row.display}
												/>
											{/each}
										</div>
									</div>
								{:else if (reliability.data?.by_route?.length ?? 0) > 0}
									<!-- Stop HAS by-route associations but every one carries a null delay,
								     so the ranked list is empty. Say so rather than vanishing the
								     section silently. -->
									<div class="stop-tile stop-reliability-routes">
										<span class="stop-tile-heading">
											<SectionLabel text={t.reliability.byRoute} variant="station" />
											{@render metricInfo('avgDelay', t.reliability.byRoute)}
										</span>
										<p class="stop-reliability-window">{t.reliability.noRouteBreakdown}</p>
									</div>
								{/if}
							</DashboardGrid>
						</div>
					{/if}
				{/snippet}
			</ResourceBoundary>
		{/if}
	{/snippet}
</EntityDetail>

<style>
	.stop-detail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.stop-next {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.stop-next-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.stop-departures {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.stop-departure {
		display: flex;
		align-items: baseline;
		gap: 0.875rem;
		padding: 0.75rem 0.875rem;
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.stop-departure:last-child {
		border-bottom: none;
	}
	.stop-departure-route {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: var(--text-body);
		color: var(--accent-text);
		flex-shrink: 0;
		min-width: 3ch;
	}
	.stop-departure-eta {
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--foreground);
		flex: 1 1 auto;
	}
	.stop-departure-delay {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		flex-shrink: 0;
	}

	.stop-schedule,
	.stop-info,
	.stop-reliability {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* Reliability readout tile: a quiet bordered card that fills its grid cell,
	   so each readout uses the desktop real estate instead of being capped narrow.
	   Chrome only (--card bg, --border) — never a data mark; the dataviz marks
	   inside bring their own scale colour. */
	.stop-tile {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	/* A reliability tile heading + its explainer (i)s, kept on the label's baseline.
	   Wraps so several (i)s (e.g. the OTP / delay / severe trio) never overflow a
	   narrow tile. */
	.stop-tile-heading {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	/* The 7x24 habits matrix is a wide readout — span the whole board on desktop,
	   collapse to a single column on mobile (auto-fit reflow handles <lg). */
	@media (min-width: 1024px) {
		.stop-tile--wide {
			grid-column: 1 / -1;
		}
	}
	.stop-schedule-route {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-schedule-route-head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	.stop-schedule-route-code {
		font-family: var(--font-mono);
		font-weight: 700;
		color: var(--accent-text);
	}
	.stop-schedule-headsign {
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.stop-schedule-times {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.75rem;
	}
	.stop-schedule-time {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}
	.stop-schedule-time-more {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}

	.stop-info-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
	}
	.stop-info-routes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-info-route-chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	/* Roll-up window caption — quiet mono, AA both themes. */
	.stop-reliability-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.stop-reliability-percentiles {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-reliability-percentile-tiles {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2rem;
	}
	.stop-reliability-habits {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.stop-reliability-habits-caption {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.stop-reliability-routes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-reliability-route-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-reliability-crowding {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.stop-reliability-weekday {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	/* Honest caveat: trailing-window observation-weighted proxy, AA both themes. */
	.stop-reliability-weekday-caveat {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.stop-reliability-tod {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.stop-reliability-tod-daytype {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	/* Honest caveat: trailing-window observation-weighted proxy, AA both themes. */
	.stop-reliability-tod-caveat {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}

	/* Live-departures filter chips + count (laid out inside the ControlsRail body). */
	.stop-chip-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.stop-chip {
		appearance: none;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--muted-foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill, 999px);
		padding: 0.35rem 0.75rem;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}
	.stop-chip:hover {
		color: var(--foreground);
	}
	/* Active chip is an INTERACTION accent — --primary belongs here, never a data mark. */
	.stop-chip--active {
		color: var(--primary-foreground);
		background-color: var(--primary);
		border-color: var(--primary);
	}
	.stop-chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.stop-departures-count {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.stop-departures-empty {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	@media (prefers-reduced-motion: reduce) {
		.stop-chip {
			transition: none;
		}
	}

	@media (max-width: 48rem) {
		.stop-detail-head {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
