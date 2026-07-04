<!--
  StopReliabilitySurface — the composed Stops RELIABILITY surface (S8A re-seat).

  The single component StopDetail mounts in its reliability pane (mirroring how
  RouteDetail mounts RouteReliabilityClusters). It owns:
    - the map-style GLASS LEFT RAIL (SurfaceRail) + $lib/filters codec: grain is
      seeded ONCE from ?grain (ENUM-GUARDED to day|week|month — never a cast),
      mirrored back via mirrorSearchParam (day default omitted), and availability =
      EXPLICIT `available` flags per grain (a stop has ONE snapshot per grain, not an
      N-bucket series, so NOT the MIN_POINTS bucket clamp — that would wrongly disable
      every stop grain). The rail holds the grain picker + a vertical section ToC of
      the PRESENT sections (active-highlighted via observeActiveToc); it renders in a
      sticky glass panel on desktop and ONE pill→sheet on mobile (single source);
    - ONE mapping pass through the pure selectors, each section a pure presenter;
    - the operator 2-col board (dow + time-of-day on one row, crowding + by-route
      next; percentiles + habits full-width heroes) + the daily-trend hero, all in the
      content column beside the rail;
    - the S8B seam: a {from,to} DateWindow prop that clips the daily trend + verdict
      (default = full window). This surface owns NO date picker — the window is
      section-local, INSIDE SectionDailyTrend (it clips only that trend, not the rail).

  DATE-RANGE HONESTY: grain is a day|week|month trailing-window RADIOGROUP; the ONLY
  thing S8B's picker ranges over is the dated daily[] series (SectionDailyTrend) —
  the periods[] grains are single snapshots, never a fabricated span.

  Two-rail note: StopDetail's `next` tab keeps its own ControlsRail (status/route
  chips). The grain radiogroup here binds ONE `grain` state; SurfaceRail is a layout
  composer only, so the two rails never collide. --primary lives only on the active
  grain chip.
-->
<script lang="ts">
	import { page } from '$app/state';
	import type { Locale } from '$lib/i18n';
	import { fmtDelayMin } from '$lib/utils';
	import { fromSearchParams, resolveWindow, type DateWindow } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import type { StopReliability } from '$lib/v1';
	import type { OccupancyCode } from '$lib/v1/schemas';
	import {
		ReliabilityPane,
		SurfaceRail,
		GrainPicker,
		DateRangePicker,
		type GrainSegment,
	} from '$lib/components/surface';
	import { observeActiveToc } from '$lib/components/shared';
	import { onMount } from 'svelte';
	import { DashboardGrid } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { VerdictBanner } from '$lib/components/brand';
	import { selectVerdict, type VerdictHeadline } from '$lib/v1/verdict';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { weekdayLabel, shiftLabel, dayTypeLabel } from '$lib/features/reliability/shiftGrains';
	// The shared occupancy band vocabulary (the SAME labels the lines surface renders).
	// The only sanctioned stops→lines import (crossFeatureImports EXEMPTION).
	import { detailCopy as linesDetailCopy } from '$lib/features/lines/lines.copy';

	import {
		presentGrains,
		defaultStopGrain,
		STOP_GRAINS,
		type StopGrain,
	} from '../data/presentGrains';
	import { selectGradedPeriods, selectDayPercentiles } from '../selectors/gradedPeriods';
	import { selectRankedRoutes } from '../selectors/rankedRoutes';
	import { selectWeekdaySeasonality } from '../selectors/weekdaySeasonality';
	import { selectTimeOfDay } from '../selectors/timeOfDay';
	import { selectHabitsHeatmap } from '../selectors/habitsHeatmap';
	import { selectCrowdingMix } from '../selectors/crowdingMix';
	import { stopReliabilityCopy } from '../stops-reliability.copy';

	import SectionPercentiles from './SectionPercentiles.svelte';
	import SectionByRoute from './SectionByRoute.svelte';
	import SectionWeekday from './SectionWeekday.svelte';
	import SectionTimeOfDay from './SectionTimeOfDay.svelte';
	import SectionHabits from './SectionHabits.svelte';
	import SectionCrowding from './SectionCrowding.svelte';
	import SectionDailyTrend from './SectionDailyTrend.svelte';

	interface StopReliabilitySurfaceProps {
		/** The stop's historic reliability archive. */
		data: StopReliability;
		/** Active locale (FR canonical). */
		locale: Locale;
		/**
		 * S8B SEAM (test/override): a {from,to} window forced from OUTSIDE, bypassing
		 * the internal codec-driven picker. `undefined` (default) = the surface owns
		 * the window itself (seeded from ?from/?to, driven by its DateRangePicker);
		 * `null` = force the full window. Production mounts pass nothing.
		 */
		window?: DateWindow | null;
	}
	let { data, locale, window: windowOverride = undefined }: StopReliabilitySurfaceProps = $props();

	const copy = $derived(stopReliabilityCopy[locale]);

	/* ── grain: codec-seeded, SurfaceRail-driven ──────────────────────────────── */
	// The set of calendar grains this stop's periods[] actually carry (availability).
	const present = $derived(presentGrains(data.periods));
	const dfltGrain = $derived(defaultStopGrain(present));

	// Seed grain ONCE from the shared codec. ENUM-GUARD (not a cast): seed.grain is a
	// codec Grain (may be 'live'/'day'/undefined) — only the two coarse calendar grains
	// this surface serves pass through; anything else falls to 'day'. The availability
	// $effect below then clamps a day-default that the stop lacks to its richest grain.
	const seed = fromSearchParams(page.url.searchParams);
	let grain = $state<StopGrain>(
		seed.grain === 'week' || seed.grain === 'month' ? seed.grain : 'day',
	);

	// Availability clamp (one-shot): a URL-seeded grain the stop can't serve falls back
	// to its richest available grain so the rail never resolves to an empty grain. The
	// URL is a hint, never a data source.
	let settled = $state(false);
	$effect(() => {
		if (settled) return;
		settled = true;
		if (!present.has(grain)) grain = dfltGrain;
	});
	// Keep the selection on a grain that has data if the stop changes under us (the
	// keyed re-mount usually handles this, but a defensive clamp costs nothing).
	$effect(() => {
		if (settled && !present.has(grain)) grain = dfltGrain;
	});

	/* ── date-range window (B1): codec-seeded, DateRangePicker-driven ──────────────
	   The ONLY thing the S8B picker ranges over is the dated daily[] series. The
	   surface OWNS the window (seeded from ?from/?to via the shared codec, validated
	   against the real daily dates by resolveWindow, then mirrored back so a windowed
	   view is deep-linkable). An external `window` prop (tests) overrides this. */

	// The real dated days the daily series carries, ascending — the picker's coverage
	// source (options are these ONLY, so an out-of-window pick is impossible). Dedupe
	// defensively (filter → findIndex, NOT a mutable Set — a Set held in a $derived trips
	// svelte/prefer-svelte-reactivity, matching the RRC datedPeriods pattern) so the
	// option keys stay unique.
	const availableDates = $derived(
		(data.daily ?? [])
			.map((p) => p.date)
			.filter((d): d is string => !!d)
			.filter((d, i, arr) => arr.indexOf(d) === i)
			.slice()
			.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
	);

	// The picked window (undefined = full series). Seeded ONCE from the codec's
	// shape-valid {from,to}; the availability clamp below validates it against the real
	// dated days (an out-of-coverage bound is dropped — the URL is a hint, never data).
	let pickedWindow = $state<DateWindow | undefined>(seed.window);
	// One-shot availability clamp: drop a seeded window whose bounds the series has no
	// day for (resolveWindow returns undefined unless BOTH bounds are real dates).
	let windowSettled = $state(false);
	$effect(() => {
		if (windowSettled) return;
		windowSettled = true;
		pickedWindow = resolveWindow(pickedWindow, new Set(availableDates));
	});

	// The effective window driving the daily trend + verdict: an external prop
	// (undefined = not passed) hands control to the internal picker; otherwise the
	// prop wins (test/override, incl. an explicit null = force the full window).
	const effectiveWindow = $derived<DateWindow | null>(
		windowOverride !== undefined ? windowOverride : (pickedWindow ?? null),
	);

	// Mirror grain + the picked window (?grain / ?from / ?to) in ONE batched call:
	// replaceState updates page.url async, so back-to-back single writes clobber each
	// other. mirrorSearchParams MERGES — it preserves StopDetail's ?tab. The 'day'
	// default is omitted for a clean canonical URL; an absent window nulls from/to.
	// When the window is externally overridden the surface owns NO from/to (the picker
	// is not mounted), so we only mirror grain.
	$effect(() => {
		if (windowOverride !== undefined) {
			mirrorSearchParams({ grain: grain === 'day' ? null : grain });
			return;
		}
		mirrorSearchParams({
			grain: grain === 'day' ? null : grain,
			from: pickedWindow?.from ?? null,
			to: pickedWindow?.to ?? null,
		});
	});

	// Grain radiogroup wiring: EXPLICIT `available` flags (NOT the bucket clamp) — one
	// snapshot per grain, so a grain is enabled iff the stop carries that grain. The
	// SAME segments + `grain` binding drive the ONE GrainPicker SurfaceRail renders in
	// both the desktop glass panel AND the mobile sheet (single source, no divergence).
	const grainLabels = $derived<Partial<Record<StopGrain, string>>>({
		day: copy.grain.day,
		week: copy.grain.week,
		month: copy.grain.month,
	});
	const grainSegments = $derived<GrainSegment<StopGrain>[]>(
		STOP_GRAINS.map((g) => ({ key: g, label: grainLabels[g] ?? g, available: present.has(g) })),
	);
	const windowCaption = $derived(copy.grain.window(grain));
	// The mobile rail pill's collapsed summary — the active grain label.
	const grainSummary = $derived(grainLabels[grain] ?? grain);

	/* ── ONE mapping pass — each section reads its pure VM slice ────────────────── */
	const gradedPeriods = $derived(
		selectGradedPeriods(data.periods, grain, (g) => copy.grain[g as StopGrain] ?? g),
	);
	const dayPercentiles = $derived(selectDayPercentiles(data.periods, grain));

	// §C5.6 one-line reliability verdict at the TOP of the Reliability pane — the SHARED
	// VerdictBanner + selectVerdict at stop scope, off the selected-grain period's own
	// otp_pct + observation_count (the Wilson hedge rides the real n; selectVerdict
	// derives the numerator from otp×n honestly when no explicit on_time is served). The
	// pipeline emits one period per grain → read the last matching row; a null otp stands
	// the band down to "still measuring" (never a fabricated verdict).
	const gradedPeriodRaw = $derived.by(() => {
		const rows = (data.periods ?? []).filter((p) => p.grain === grain);
		return rows.length > 0 ? rows[rows.length - 1] : null;
	});
	const stopVerdictHeadline = $derived<VerdictHeadline>({
		otpPct: gradedPeriodRaw?.otp_pct ?? null,
		observationCount: gradedPeriodRaw?.observation_count ?? null,
		onTime: null,
	});
	const stopVerdict = $derived(selectVerdict(stopVerdictHeadline, grain, locale, copy.verdict));

	const fmtMin = (v: number | null): string =>
		fmtDelayMin(v, { rounding: 'fixed1', noData: copy.noDelay });
	const rankedRoutes = $derived(selectRankedRoutes(data.by_route, fmtMin));
	const hasByRouteAssoc = $derived((data.by_route?.length ?? 0) > 0);

	const rankedWeekdays = $derived(
		selectWeekdaySeasonality(data.day_of_week, {
			severeShare: copy.weekday.severeShare,
			avgDelay: copy.weekday.avgDelay,
			weekdayLabel: (iso) => weekdayLabel(iso, locale),
		}),
	);
	const hasWeekday = $derived(rankedWeekdays.length > 0);

	const timeOfDay = $derived(
		selectTimeOfDay(data.periods, {
			shiftLabel: (g) => shiftLabel(g, locale),
			dayTypeLabel: (g) => dayTypeLabel(g, locale),
		}),
	);

	const habits = $derived(selectHabitsHeatmap(data.habits?.matrix));

	const occupancyBands = $derived(linesDetailCopy[locale].occupancyBands);
	const crowding = $derived(
		selectCrowdingMix(data.occupancy_mix, (code: OccupancyCode) => occupancyBands[code], {
			title: copy.crowding.barLabel,
			locale,
		}),
	);

	// The reliability resource has always loaded by the time this surface mounts
	// (StopDetail guards on it), so crowding's no-telemetry chip may render.
	const crowdingSettled = true;

	// The (i) affordance for the ReliabilityPane heading (its intrinsic OTP/delay/severe).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	/* ── section ToC (P5.4 GLASS LEFT RAIL wayfinding) ──────────────────────────
	   A vertical jump list of the PRESENT sections (built off the SAME conditions
	   that mount each tile below, so the ToC never lists a stood-down section). No
	   ↻/∞ scope glyph here: this surface has no page-level window (the daily-trend
	   date range is section-local, INSIDE SectionDailyTrend — it clips only that
	   trend, not the other sections), so every section reads its own scope. The
	   observer keys on each tile's [data-toc] anchor (minted below, locale-free). */
	const sectionNav = $derived(
		[
			{ id: 'stop-rel-trend', label: copy.trend.heading, present: true },
			{
				id: 'stop-rel-percentiles',
				label: copy.percentiles.heading,
				present: dayPercentiles != null,
			},
			{ id: 'stop-rel-pane', label: copy.paneHeading, present: gradedPeriods.length > 0 },
			{ id: 'stop-rel-habits', label: copy.habits.heading, present: habits.hasHabits },
			{ id: 'stop-rel-weekday', label: copy.weekday.heading, present: hasWeekday },
			{ id: 'stop-rel-time', label: copy.timeOfDay.heading, present: timeOfDay.hasTimeOfDay },
			{ id: 'stop-rel-crowding', label: copy.crowding.heading, present: true },
			{ id: 'stop-rel-by-route', label: copy.byRoute, present: true },
		].filter((s) => s.present),
	);

	// One IntersectionObserver over the present tiles' [data-toc] anchors owns the
	// active section the rail ToC highlights (client-only).
	let activeId = $state('');
	onMount(() => observeActiveToc((id) => (activeId = id)));

	// "SEC n/m" position readout for the rail ToC: the active section's 1-based index
	// over the total present sections. Falls back to section 1 before the observer
	// resolves (or if it points off-list).
	const sectionReadout = $derived.by(() => {
		const idx = sectionNav.findIndex((s) => s.id === activeId);
		const n = idx >= 0 ? idx + 1 : 1;
		return copy.nav.sectionReadout(n, sectionNav.length);
	});
</script>

{#snippet metricInfo(key: MetricKey, name: string)}
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

<div class="stop-reliability">
	<!-- P5.4: the grain picker + the section ToC live in a map-style GLASS LEFT RAIL
	     (SurfaceRail) — a sticky floating panel beside the sections on desktop, and ONE
	     merged pill→sheet menu (grain + ToC together) on mobile. --primary lives only on
	     the active grain chip. The daily-trend date range stays SECTION-LOCAL (inside
	     SectionDailyTrend) — it is NOT hoisted into the rail. -->
	<div class="stop-reliability-layout">
		<!-- The rail content — the grain radiogroup (+ resolved-window caption) + the
		     section ToC. ONE definition, rendered by SurfaceRail in BOTH the desktop glass
		     panel AND the mobile sheet (single source; both bind the same grain + track
		     activeId). -->
		{#snippet railContent()}
			<div class="stop-reliability-control-body" data-slot="controls-body">
				<span class="stop-reliability-view" data-slot="controls-rail-label"
					>{copy.controlsLabel}</span
				>
				<GrainPicker segments={grainSegments} bind:value={grain} label={copy.grain.label} />
				<p class="stop-reliability-window" data-slot="active-window" aria-live="polite">
					{windowCaption}
				</p>
			</div>

			<!-- Section ToC (wayfinding): a vertical jump list of the PRESENT sections; the
			     active one is highlighted. No ↻/∞ scope glyph — this surface has no page-level
			     window (the daily-trend range is section-local). -->
			<nav class="stop-reliability-toc" data-slot="section-toc" aria-label={copy.nav.toc}>
				<span class="stop-reliability-toc__head">
					<span class="stop-reliability-toc__label">{copy.nav.toc}</span>
					<span
						class="stop-reliability-toc__readout"
						data-slot="section-readout"
						aria-live="polite"
						aria-atomic="true">{sectionReadout}</span
					>
				</span>
				<ul class="stop-reliability-toc__list">
					{#each sectionNav as s (s.id)}
						<li>
							<a
								class="stop-reliability-toc__link"
								class:active={activeId === s.id}
								aria-current={activeId === s.id ? 'location' : undefined}
								href={`#${s.id}`}
							>
								<span class="stop-reliability-toc__text">{s.label}</span>
							</a>
						</li>
					{/each}
				</ul>
			</nav>
		{/snippet}

		<!-- The map-style GLASS LEFT RAIL: a sticky floating panel beside the sections on
		     desktop; ONE pill→sheet (grain + ToC merged into one menu) on mobile. -->
		<SurfaceRail
			rail={railContent}
			label={copy.controlsLabel}
			summary={grainSummary}
			openAria={copy.nav.pillOpen}
			closeAria={copy.nav.pillClose}
		/>

		<!-- The sections — the content column beside the rail. -->
		<div class="stop-reliability-content">
			<!-- Daily-trend + range-verdict section (full-width hero): the dated series the
			     S8B picker ranges over. The ONLY stop surface with a real date window (kept
			     SECTION-LOCAL). The picker seats in the section's window-slot seam and drives
			     `pickedWindow`; an external `window` prop overrides it (tests). -->
			<div class="stop-anchor stop-anchor--wide" id="stop-rel-trend" data-toc="stop-rel-trend">
				<SectionDailyTrend daily={data.daily} {locale} {copy} window={effectiveWindow}>
					{#snippet picker()}
						<!-- B1: the SHARED DateRangePicker over the REAL dated daily days. Bound to
						     the surface's own window state; hidden when the window is externally
						     overridden (the owner drives it). Empty coverage → honest absence. -->
						{#if windowOverride === undefined}
							<DateRangePicker
								bind:value={pickedWindow}
								{availableDates}
								{locale}
								labels={copy.trend.range}
							/>
						{/if}
					{/snippet}
				</SectionDailyTrend>
			</div>

			<!-- Hazard tape discerns the trend hero from the readouts board. -->
			<Separator variant="hazard" hazardSize="sm" />

			<!-- The readouts board. Operator layout: dow + time-of-day on ONE row, crowding +
			     by-route on the NEXT (explicit 2-tile pairing); percentiles + habits are
			     full-width heroes. Each {#if} stand-down keeps a readout out of the grid
			     entirely; an absent pair-mate lets its survivor span the row (the grid
			     reflows). Each present tile is wrapped in a locale-free [id]/[data-toc] anchor
			     so the rail ToC can jump to + highlight it. -->
			<DashboardGrid minTile="340px" gutter={false}>
				{#if dayPercentiles != null}
					<div class="stop-anchor" id="stop-rel-percentiles" data-toc="stop-rel-percentiles">
						<SectionPercentiles percentiles={dayPercentiles} {locale} {copy} />
					</div>
				{/if}

				{#if gradedPeriods.length > 0}
					<div class="stop-anchor" id="stop-rel-pane" data-toc="stop-rel-pane">
						<div class="stop-tile" data-slot="stop-reliability-pane">
							<SectionHeading
								level={2}
								overline={copy.paneHeading}
								class="stop-tile-heading stop-tile-heading--metrics"
							>
								{#snippet explainer()}
									{@render metricInfo('otp', copy.metrics.otp)}
									{@render metricInfo('avgDelay', copy.metrics.avgDelay)}
									{@render metricInfo('severe', copy.metrics.severe)}
								{/snippet}
							</SectionHeading>
							<!-- §C5.6: the one-line reliability verdict at the top of the pane. -->
							<VerdictBanner result={stopVerdict} />
							<ReliabilityPane periods={gradedPeriods} {locale} />
						</div>
					</div>
				{/if}

				<!-- ROW 1: habits (full-width hero). -->
				{#if habits.hasHabits}
					<div
						class="stop-anchor stop-anchor--wide"
						id="stop-rel-habits"
						data-toc="stop-rel-habits"
					>
						<SectionHabits matrix={habits.matrix} {locale} {copy} />
					</div>
				{/if}

				<!-- ROW: dow + time-of-day (operator pairing). An absent mate lets the survivor span. -->
				{#if hasWeekday}
					<div class="stop-anchor" id="stop-rel-weekday" data-toc="stop-rel-weekday">
						<SectionWeekday rows={rankedWeekdays} {locale} {copy} />
					</div>
				{/if}
				{#if timeOfDay.hasTimeOfDay}
					<div class="stop-anchor" id="stop-rel-time" data-toc="stop-rel-time">
						<SectionTimeOfDay
							shiftRows={timeOfDay.shiftRows}
							dayTypeRows={timeOfDay.dayTypeRows}
							{locale}
							{copy}
						/>
					</div>
				{/if}

				<!-- ROW: crowding + by-route (operator pairing). -->
				<div class="stop-anchor" id="stop-rel-crowding" data-toc="stop-rel-crowding">
					<SectionCrowding vm={crowding} settled={crowdingSettled} {locale} {copy} />
				</div>
				<div class="stop-anchor" id="stop-rel-by-route" data-toc="stop-rel-by-route">
					<SectionByRoute rows={rankedRoutes} hasAssociations={hasByRouteAssoc} {locale} {copy} />
				</div>
			</DashboardGrid>
		</div>
	</div>
</div>

<style>
	.stop-reliability {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	/* The 2-col layout (P5.4): the map-style GLASS LEFT RAIL (SurfaceRail) + the content
	   column at ≥1024; a single column below, where the rail collapses to the mobile
	   pill→sheet. The content column is the rail's sticky CONTAINING BLOCK, so the glass
	   rail stays pinned over the sections. */
	.stop-reliability-layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(1.5rem, 4vw, 2rem);
		width: 100%;
	}
	@media (min-width: 1024px) {
		.stop-reliability-layout {
			grid-template-columns: minmax(13rem, 15rem) minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}
	}
	/* The content column — the daily-trend hero + the readouts board. */
	.stop-reliability-content {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}

	/* The grain controls (View overline + GrainPicker + window caption), stacked in the
	   rail. Rendered by railContent in BOTH the desktop glass rail and the mobile sheet. */
	.stop-reliability-control-body {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
		min-width: 0;
	}
	/* The "View" overline — the quiet mono rail label. */
	.stop-reliability-view {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	/* The grain radiogroup wraps so a long localized segment never overflows the narrow
	   rail; the active-chip accent lives in GrainPicker. */
	.stop-reliability :global([data-slot='grain-picker']) {
		min-width: 0;
		flex-wrap: wrap;
	}
	/* Resolved-window caption — quiet mono, on its own row beneath the grain chips. */
	.stop-reliability-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--muted-foreground);
	}

	/* Section ToC (wayfinding): a VERTICAL jump list in the rail — one full-width link per
	   present section, the active one highlighted. */
	.stop-reliability-toc {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.stop-reliability-toc__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.stop-reliability-toc__label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	/* SEC n/m position readout — the amber wayfinding voice (station numbering). */
	.stop-reliability-toc__readout {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.stop-reliability-toc__list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.stop-reliability-toc__link {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
		min-height: 44px;
		padding: 0.375rem 0.625rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		text-decoration: none;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}
	.stop-reliability-toc__link:hover {
		border-color: var(--primary);
		color: var(--primary);
	}
	/* The active section: the amber-bordered wayfinding highlight (like the map's selected
	   entity), so the reader always sees where they are in the rail. */
	.stop-reliability-toc__link.active {
		border-color: var(--border-brand);
		background: color-mix(in srgb, var(--primary) 8%, transparent);
		color: var(--primary);
	}
	.stop-reliability-toc__text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Section anchor wrapper: the locale-free [id]/[data-toc] jump target the rail ToC +
	   the IntersectionObserver key on. Inside the DashboardGrid it IS the grid cell, so it
	   fills the stretched row height and its inner .stop-tile fills it (equal-height rows).
	   The daily-trend anchor sits in the flex content column (no grid parent) — the wide
	   grid-column rule there is inert. */
	.stop-anchor {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.stop-anchor > :global(.stop-tile) {
		flex: 1;
	}
	/* Smooth jump-to from the ToC (reduced-motion users get the instant default). */
	@media (prefers-reduced-motion: no-preference) {
		.stop-reliability-layout {
			scroll-behavior: smooth;
		}
	}

	/* Shared tile chrome — the section components render `.stop-tile` roots, so the chrome
	   is declared :global here (the orchestrator owns the board's card frame in one place).
	   Chrome only (--card bg, --border); the dataviz marks inside bring their own scale. */
	.stop-reliability :global(.stop-tile) {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	.stop-reliability :global(.stop-tile-heading) {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}
	/* The 7×24 habits matrix is a wide readout — its anchor wrapper spans the whole board
	   on desktop, collapsing to a single column on mobile (auto-fit reflow handles <lg).
	   The span rides the ANCHOR (the grid cell), not the inner .stop-tile--wide. */
	@media (min-width: 1024px) {
		.stop-reliability .stop-anchor--wide {
			grid-column: 1 / -1;
		}
	}
</style>
