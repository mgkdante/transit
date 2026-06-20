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
		type ReliabilityPeriodVM,
		type GrainSegment,
	} from '$lib/components/surface';
	import {
		Heatmap,
		RankedRow,
		ChartLegend,
		HEATMAP_RAMP,
		HEATMAP_NODATA,
	} from '$lib/components/dataviz';
	import type { SeverityCode } from '$lib/v1/schemas';
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
	import { layout, mapHrefFor } from '$lib/nav';
	import StopLabel from '$lib/components/brand/StopLabel.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { Badge } from '$lib/components/ui/badge';
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
						     board. Both default off (everything shown); the data marks are
						     unchanged — these are INTERACTION controls. -->
						<div class="stop-departures-filters">
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
						</div>

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
				isEmpty={(r: StopReliability | null) => r == null || (r.periods?.length ?? 0) === 0}
			>
				{#snippet children(r: StopReliability | null)}
					{#if r != null}
						<div class="stop-reliability">
							<!-- Grain (roll-up) picker: the reader chooses day|week|month instead
							     of all three dumped as undifferentiated cards. Only grains with
							     data are offered; default = the richest available grain. -->
							<GrainPicker
								segments={grainSegments}
								bind:value={grain}
								label={t.reliability.grain.label}
							/>
							<p class="stop-reliability-window" aria-live="polite">
								{t.reliability.grain.window(grain)}
							</p>

							<!-- Day-grain percentile clarity: typical (p50) vs worst-case (p90),
							     surfaced prominently rather than buried with a placeholder. -->
							{#if dayPercentiles != null}
								<div class="stop-reliability-percentiles">
									<SectionLabel text={t.reliability.percentiles.heading} variant="metric" />
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

							<ReliabilityPane periods={gradedPeriods} {locale} />

							<!-- Time-of-day habits heatmap (per-stop 7×24 severe-delay grid).
							     Stands down entirely when no cell carries data. -->
							{#if hasHabits}
								<div class="stop-reliability-habits" data-slot="stop-habits">
									<SectionLabel text={t.reliability.habits.heading} variant="metric" />
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

							<!-- Weekday seasonality (day_of_week): which weekday drags this stop
							     down most, ranked worst-first by mean delay on the dataviz severity
							     scale. A weekday with no mean delay is dropped (never a fake-0 bar);
							     the severe share rides as a second reading only when enough
							     observations back it. Stands down when day_of_week is empty/absent. -->
							{#if hasWeekday}
								<div class="stop-reliability-weekday" data-slot="stop-weekday">
									<SectionLabel text={t.reliability.weekday.heading} variant="metric" />
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
								<div class="stop-reliability-tod" data-slot="stop-time-of-day">
									<SectionLabel text={t.reliability.timeOfDay.heading} variant="metric" />
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
								<div class="stop-reliability-routes">
									<SectionLabel text={t.reliability.byRoute} variant="metric" />
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
								<div class="stop-reliability-routes">
									<SectionLabel text={t.reliability.byRoute} variant="metric" />
									<p class="stop-reliability-window">{t.reliability.noRouteBreakdown}</p>
								</div>
							{/if}
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
		max-width: 52ch;
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
	.stop-reliability-weekday {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	/* Honest caveat: trailing-window observation-weighted proxy, AA both themes. */
	.stop-reliability-weekday-caveat {
		margin: 0;
		max-width: 52ch;
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
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}

	/* Live-departures filter chips + count. */
	.stop-departures-filters {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
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
