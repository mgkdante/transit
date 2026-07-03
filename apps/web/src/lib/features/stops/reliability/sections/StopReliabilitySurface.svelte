<!--
  StopReliabilitySurface — the composed Stops RELIABILITY surface (S8A re-seat).

  The single component StopDetail mounts in its reliability pane (mirroring how
  RouteDetail mounts RouteReliabilityClusters). It owns:
    - the SHARED SurfaceControls rail + $lib/filters codec: grain is seeded ONCE
      from ?grain (ENUM-GUARDED to day|week|month — never a cast), mirrored back via
      mirrorSearchParam (day default omitted), and availability = EXPLICIT `available`
      flags per grain (a stop has ONE snapshot per grain, not an N-bucket series, so
      NOT the MIN_POINTS bucket clamp — that would wrongly disable every stop grain);
    - ONE mapping pass through the pure selectors, each section a pure presenter;
    - the operator 2-col layout (dow + time-of-day on one row, crowding + by-route
      next; percentiles + habits full-width heroes) + the NEW daily-trend section;
    - the S8B seam: a {from,to} DateWindow prop that clips the daily trend + verdict
      (default = full window). This surface owns NO date picker.

  DATE-RANGE HONESTY: grain is a day|week|month trailing-window RADIOGROUP; the ONLY
  thing S8B's picker ranges over is the NEW dated daily[] series (SectionDailyTrend) —
  the periods[] grains are single snapshots, never a fabricated span.

  Two-rail note: StopDetail's `next` tab keeps its own ControlsRail (status/route
  chips); SurfaceControls' $props.id() uid namespaces its disabled-reason ids, so the
  two rails never collide. --primary lives only on the active grain chip.
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
		SurfaceControls,
		GrainPicker,
		DateRangePicker,
		type GrainSegment,
	} from '$lib/components/surface';
	import { DashboardGrid, ControlsRail } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
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

	/* ── grain: codec-seeded, SurfaceControls-driven ──────────────────────────── */
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

	// SurfaceControls wiring: EXPLICIT `available` flags (NOT the bucket clamp) — one
	// snapshot per grain, so a grain is enabled iff the stop carries that grain.
	// SurfaceControls owns its OWN $props.id() uid for the disabled-reason aria ids, so
	// the two-rail (next-filters + grain) case never collides — no hand-rolled ids here.
	const grainOffered: readonly StopGrain[] = STOP_GRAINS;
	const grainAvailability = $derived<Partial<Record<StopGrain, { available: boolean }>>>({
		day: { available: present.has('day') },
		week: { available: present.has('week') },
		month: { available: present.has('month') },
	});
	const grainLabels = $derived<Partial<Record<StopGrain, string>>>({
		day: copy.grain.day,
		week: copy.grain.week,
		month: copy.grain.month,
	});
	// The MOBILE pill's segments (GrainPicker), mirroring the desktop availability.
	const grainSegments = $derived<GrainSegment<StopGrain>[]>(
		STOP_GRAINS.map((g) => ({ key: g, label: grainLabels[g] ?? g, available: present.has(g) })),
	);
	const windowCaption = $derived(copy.grain.window(grain));

	/* ── ONE mapping pass — each section reads its pure VM slice ────────────────── */
	const gradedPeriods = $derived(
		selectGradedPeriods(data.periods, grain, (g) => copy.grain[g as StopGrain] ?? g),
	);
	const dayPercentiles = $derived(selectDayPercentiles(data.periods, grain));

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
	<!-- Grain rail: the SHARED SurfaceControls (desktop) — day|week|month radiogroup,
	     explicit availability, the resolved-window caption. The mobile pill's GrainPicker
	     shares the SAME grain binding + availability (no divergence). --primary lives only
	     on the active chip. -->
	<SurfaceControls
		class="stop-reliability-rail-desktop"
		offered={grainOffered}
		availability={grainAvailability}
		bind:value={grain}
		labels={grainLabels}
		grainLabel={copy.grain.label}
		railLabel={copy.controlsLabel}
		{locale}
		{windowCaption}
		role="group"
		aria-label={copy.controlsLabel}
	/>

	<!-- MOBILE (<lg): the grain radiogroup in a plain ControlsRail (the /stop next-tab
	     ControlsRail pattern). Shares the same binding + availability as the desktop rail. -->
	<ControlsRail label={copy.controlsLabel} class="stop-reliability-rail-mobile">
		<GrainPicker segments={grainSegments} bind:value={grain} label={copy.grain.label} />
		<p class="stop-reliability-window" aria-live="polite">{windowCaption}</p>
	</ControlsRail>

	<!-- Hazard tape discerns the controls zone from the data canvas. -->
	<Separator variant="hazard" hazardSize="sm" />

	<!-- NEW daily-trend + range-verdict section (full-width hero): the dated series the
	     S8B picker ranges over. The ONLY stop surface with a real date window. The
	     picker (below) seats in the section's window-slot seam and drives `pickedWindow`;
	     an external `window` prop overrides it (tests). -->
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

	<!-- The readouts board. Operator layout: dow + time-of-day on ONE row, crowding +
	     by-route on the NEXT (explicit 2-tile pairing); percentiles + habits are
	     full-width heroes. Each {#if} stand-down keeps a readout out of the grid entirely;
	     an absent pair-mate lets its survivor span the row (the grid reflows). -->
	<DashboardGrid minTile="340px" gutter={false}>
		{#if dayPercentiles != null}
			<SectionPercentiles percentiles={dayPercentiles} {locale} {copy} />
		{/if}

		{#if gradedPeriods.length > 0}
			<div class="stop-tile" data-slot="stop-reliability-pane">
				<span class="stop-tile-heading stop-tile-heading--metrics">
					<SectionLabel text={copy.paneHeading} variant="station" />
					{@render metricInfo('otp', copy.metrics.otp)}
					{@render metricInfo('avgDelay', copy.metrics.avgDelay)}
					{@render metricInfo('severe', copy.metrics.severe)}
				</span>
				<ReliabilityPane periods={gradedPeriods} {locale} />
			</div>
		{/if}

		<!-- ROW 1: habits (full-width hero). -->
		{#if habits.hasHabits}
			<SectionHabits matrix={habits.matrix} {locale} {copy} />
		{/if}

		<!-- ROW: dow + time-of-day (operator pairing). An absent mate lets the survivor span. -->
		{#if hasWeekday}
			<SectionWeekday rows={rankedWeekdays} {locale} {copy} />
		{/if}
		{#if timeOfDay.hasTimeOfDay}
			<SectionTimeOfDay
				shiftRows={timeOfDay.shiftRows}
				dayTypeRows={timeOfDay.dayTypeRows}
				{locale}
				{copy}
			/>
		{/if}

		<!-- ROW: crowding + by-route (operator pairing). -->
		<SectionCrowding vm={crowding} settled={crowdingSettled} {locale} {copy} />
		<SectionByRoute rows={rankedRoutes} hasAssociations={hasByRouteAssoc} {locale} {copy} />
	</DashboardGrid>
</div>

<style>
	.stop-reliability {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.stop-reliability-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}

	/* EXACTLY ONE grain rail shows at every width: the SurfaceControls rail on desktop,
	   the plain ControlsRail on mobile. Below lg the desktop rail hides; at/above lg the
	   mobile rail hides. */
	@media (max-width: 1023.98px) {
		.stop-reliability :global(.stop-reliability-rail-desktop) {
			display: none;
		}
	}
	@media (min-width: 1024px) {
		.stop-reliability :global(.stop-reliability-rail-mobile) {
			display: none;
		}
	}

	/* Shared tile chrome — the section components render `.stop-tile` roots, so the chrome
	   is declared :global here (the orchestrator owns the board's card frame in one place).
	   Chrome only (--card bg, --border); the dataviz marks inside bring their own scale. */
	.stop-reliability :global(.stop-tile) {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
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
		gap: 0.35rem;
	}
	/* The 7×24 habits matrix + the daily trend are wide readouts — span the whole board
	   on desktop, collapse to a single column on mobile (auto-fit reflow handles <lg). */
	@media (min-width: 1024px) {
		.stop-reliability :global(.stop-tile--wide) {
			grid-column: 1 / -1;
		}
	}
</style>
