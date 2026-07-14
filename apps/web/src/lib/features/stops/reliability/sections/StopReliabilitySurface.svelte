<!--
  StopReliabilitySurface — the composed Stops RELIABILITY surface (S8A re-seat).

  The single component StopDetail mounts in its reliability pane (mirroring how
  RouteDetail mounts RouteReliabilityClusters). It owns:
    - the map-style GLASS LEFT RAIL (SurfaceRail) + $lib/filters codec: grain is
      seeded ONCE from ?grain (ENUM-GUARDED to day|week|month — never a cast),
      mirrored back via mirrorSearchParam (day default omitted), and availability =
      EXPLICIT `available` flags per grain (a stop has ONE snapshot per grain, not an
      N-bucket series, so NOT the MIN_POINTS bucket clamp — that would wrongly disable
      every stop grain). The rail holds the grain picker, the shared retained-history
      navigator, and a vertical section ToC of the PRESENT sections
      (active-highlighted via observeActiveToc); it renders in a sticky glass panel on
      desktop and ONE pill→sheet on mobile (single source);
    - ONE mapping pass through the pure selectors, each section a pure presenter;
    - the operator 2-col board (dow + time-of-day on one row, crowding + by-route
      next; percentiles + habits full-width heroes) + the daily-trend hero, all in the
      content column beside the rail;
    - a test-only {from,to} DateWindow override for the daily trend + verdict. In
      production the shared navigator owns the retained range; that range also drives
      crowding when retained occupancy is available.

  DATE-RANGE HONESTY: grain is a day|week|month current-snapshot RADIOGROUP. Retained
  ranges replace only the dated daily[] and occupancy views; periods[], habits,
  weekday, time-of-day, and by-line data stay explicitly labelled current-only.

  Two-rail note: StopDetail's `next` tab keeps its own ControlsRail (status/route
  chips). The grain radiogroup here binds ONE `grain` state; SurfaceRail is a layout
  composer only, so the two rails never collide. --primary lives only on the active
  grain chip.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { localizeHref, type Locale } from '$lib/i18n';
	import { routeFor } from '$lib/nav';
	import { fmtDelayMin } from '$lib/utils';
	import { formatDateKey } from '$lib/utils/time';
	import { fromSearchParams, type DateWindow } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import {
		availabilityFromCollectionIndex,
		datesForAvailability,
		type RawHistoryRangeRequest,
		type StopReliability,
	} from '$lib/v1';
	import type { OccupancyCode } from '$lib/v1/schemas';
	import {
		ReliabilityPane,
		SurfaceRail,
		GrainPicker,
		HistoryNavigator,
		type GrainSegment,
	} from '$lib/components/surface';
	import { observeActiveToc, TocNav, type TocEntry } from '$lib/components/shared';
	import { onMount } from 'svelte';
	import { DashboardGrid } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { Button } from '$lib/components/ui/button';
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
	import { applyRetainedStopHistory, clearRetainedStopHistory } from '../data/retainedHistory';
	import type { StopHistoryResource } from '../data/stopHistoryResource.svelte';
	import { selectGradedPeriods, selectDayPercentiles } from '../selectors/gradedPeriods';
	import { selectRankedRoutes } from '../selectors/rankedRoutes';
	import { selectWeekdaySeasonality } from '../selectors/weekdaySeasonality';
	import { selectTimeOfDay } from '../selectors/timeOfDay';
	import { selectHabitsHeatmap } from '../selectors/habitsHeatmap';
	import { selectCrowdingMix } from '../selectors/crowdingMix';
	import type { ExactDailyRangeIngredients } from '../selectors/dailyRange';
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
		/** Test-only daily verdict/chart override; production uses the history resource. */
		window?: DateWindow | null;
		/** Stop-keyed retained range resource, owned by StopDetail. */
		history?: StopHistoryResource;
	}
	let {
		data,
		locale,
		window: windowOverride = undefined,
		history,
	}: StopReliabilitySurfaceProps = $props();

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

	/* ── retained date-range ownership ─────────────────────────────────────────── */
	const emptyHistoryRequest = (): RawHistoryRangeRequest => ({
		hasFrom: false,
		hasTo: false,
		rawFrom: null,
		rawTo: null,
	});
	const historyRequested = $derived(
		history != null && (history.request.hasFrom || history.request.hasTo),
	);
	const explicitHistory = $derived(
		history != null && historyRequested && history.state !== 'current',
	);
	const retainedReady = $derived(history?.state === 'ready' || history?.state === 'partial');
	const historyAvailability = $derived(
		history?.index == null ? null : availabilityFromCollectionIndex(history.index),
	);
	const historyDates = $derived(
		historyAvailability == null ? [] : datesForAvailability(historyAvailability),
	);
	const historyWindow = $derived<DateWindow | undefined>(
		explicitHistory ? (history?.resolved?.selection ?? undefined) : undefined,
	);
	const effectiveWindow = $derived<DateWindow | null>(
		windowOverride !== undefined ? windowOverride : (historyWindow ?? null),
	);
	const historyCoverageText = $derived.by<string | null>(() => {
		if (historyAvailability?.kind !== 'continuous') return null;
		return copy.history.coverage(
			formatDateKey(historyAvailability.firstDate, locale),
			formatDateKey(historyAvailability.lastDate, locale),
		);
	});
	const historySelectionText = $derived.by<string | null>(() => {
		if (!explicitHistory || historyWindow == null) return null;
		return copy.history.selection(
			formatDateKey(historyWindow.from, locale),
			formatDateKey(historyWindow.to, locale),
		);
	});
	let historyAnnouncement = $state<string | null>(null);
	let handledHistoryCorrection = '';
	$effect(() => {
		const correction = history?.resolved?.correction;
		if (correction == null || correction.key === handledHistoryCorrection) return;
		handledHistoryCorrection = correction.key;
		historyAnnouncement = copy.history.correction[correction.reason];
		history?.setRequest(emptyHistoryRequest());
	});
	const historyLiveAnnouncement = $derived.by(() => {
		if (historyAnnouncement != null) return historyAnnouncement;
		if (!explicitHistory) return '';
		if (history?.state === 'loading-index' || history?.state === 'loading-range')
			return copy.history.loading;
		if (history?.state === 'partial') return copy.history.partial;
		if (history?.state === 'no-data') return copy.history.noData;
		if (history?.state === 'error') return copy.history.error;
		if (history?.state === 'ready') return copy.history.ready;
		return '';
	});
	function selectHistoryRange(value: DateWindow | undefined): void {
		historyAnnouncement = null;
		handledHistoryCorrection = '';
		history?.setRequest(
			value == null
				? emptyHistoryRequest()
				: { hasFrom: true, hasTo: true, rawFrom: value.from, rawTo: value.to },
		);
	}
	const historyWire = $derived.by<Record<string, string | null>>(() => {
		const grainValue = grain === 'day' ? null : grain;
		if (history == null || windowOverride !== undefined)
			return { grain: grainValue } as Record<string, string | null>;
		const canonical = history.resolved?.canonicalWindow;
		const pendingExplicit = explicitHistory && history.resolved == null;
		return {
			grain: grainValue,
			from:
				canonical?.from ??
				(pendingExplicit && history.request.hasFrom ? history.request.rawFrom : null),
			to:
				canonical?.to ?? (pendingExplicit && history.request.hasTo ? history.request.rawTo : null),
		};
	});
	$effect(() => mirrorSearchParams(historyWire));

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
	const selectedData = $derived.by<StopReliability>(() => {
		if (!explicitHistory) return data;
		if (retainedReady && history?.value != null) {
			return applyRetainedStopHistory(data, history.value);
		}
		return clearRetainedStopHistory(data);
	});
	const exactDailyRange = $derived.by<ExactDailyRangeIngredients | null>(() => {
		if (!retainedReady || history?.value == null || historyWindow == null) return null;
		const delay = history.value.aggregate.delay.value;
		if (delay == null) return null;
		return {
			daysWithData: history.value.retainedDayCount,
			from: historyWindow.from,
			to: historyWindow.to,
			observationCount: delay.observationCount,
			inClampObservationCount: delay.inClampObservationCount,
			severeCount: delay.severeCount,
			sumDelaySeconds: delay.sumDelaySeconds,
		};
	});
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
	const rankedRoutes = $derived(
		selectRankedRoutes(data.by_route, fmtMin, {
			href: (routeId) => localizeHref(routeFor({ kind: 'line', id: routeId }), locale),
			ariaLabel: copy.viewLine,
		}),
	);
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
		selectCrowdingMix(selectedData.occupancy_mix, (code: OccupancyCode) => occupancyBands[code], {
			title: copy.crowding.barLabel,
			locale,
		}),
	);
	const crowdingSettled = $derived(!explicitHistory || retainedReady);
	const crowdingWindowText = $derived(
		explicitHistory && historySelectionText != null ? historySelectionText : copy.crowding.window,
	);

	// The (i) affordance for the ReliabilityPane heading (its intrinsic OTP/delay/severe).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	/* ── section ToC (P5.4 GLASS LEFT RAIL wayfinding) ──────────────────────────
	   A vertical jump list of the PRESENT sections (built off the SAME conditions
	   that mount each tile below, so the ToC never lists a stood-down section).
	   Retained selection applies only to the trend and crowding sections; all other
	   sections keep their explicit current-only scope. The observer keys on each
	   tile's [data-toc] anchor (minted below, locale-free). */
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

	// Map the present sections to numbered TocEntry rows for the shared TocNav (badge =
	// station-style SEC number; flat list, no children) — the SAME jump-list every other
	// surface's rail renders, so wayfinding looks identical site-wide.
	const tocEntries: TocEntry[] = $derived(
		sectionNav.map((s, i) => ({
			id: s.id,
			title: s.label,
			level: 2,
			badge: { kind: 'number' as const, value: i + 1 },
			children: [],
		})),
	);

	// One IntersectionObserver over the present tiles' [data-toc] anchors owns the
	// active section the rail ToC highlights (client-only).
	let activeId = $state('');
	onMount(() => observeActiveToc((id) => (activeId = id)));

	// Smooth-scroll to a section when its TocNav row is tapped (TocNav is button-driven).
	function navigate(id: string): void {
		document
			.querySelector(`[data-toc="${id}"]`)
			?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
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
	<!-- P5.4: the grain picker + retained-history navigator + section ToC live in a
	     map-style GLASS LEFT RAIL (SurfaceRail) — a sticky floating panel beside the
	     sections on desktop, and ONE merged pill→sheet menu on mobile. -->
	<div class="stop-reliability-layout">
		<!-- The rail content — the grain radiogroup (+ resolved-window caption) + the
		     section ToC. ONE definition, rendered by SurfaceRail in BOTH the desktop glass
		     panel AND the mobile sheet (single source; both bind the same grain + track
		     activeId). -->
		{#snippet railContent({ closeSheet }: { closeSheet: () => void })}
			<div class="stop-reliability-control-body" data-slot="controls-body">
				<span class="stop-reliability-view" data-slot="controls-rail-label"
					>{copy.controlsLabel}</span
				>
				<GrainPicker segments={grainSegments} bind:value={grain} label={copy.grain.label} />
				{#if history?.index != null}
					<HistoryNavigator
						mode="range"
						{locale}
						labels={copy.history.navigator}
						value={historyWindow}
						availableDates={historyDates}
						coverageText={historyCoverageText}
						selectionText={historySelectionText}
						liveAnnouncement={false}
						onRangeChange={selectHistoryRange}
					/>
				{/if}
				<p class="stop-reliability-window" data-slot="active-window" aria-live="polite">
					{windowCaption}
				</p>
			</div>

			<!-- Section ToC (wayfinding) — the ONE shared TocNav, identical to the metrics /
			     status / network / lines rails: a numbered jump list of the PRESENT sections
			     with TocNav's own "SEC n/m" readout (the rail's ONLY position counter), the
			     active one amber-highlighted. Picking a section also dismisses the mobile
			     sheet through SurfaceRail's explicit closeSheet seam. -->
			<div class="rail-toc" data-slot="section-toc">
				<TocNav
					entries={tocEntries}
					{activeId}
					onNavigate={(id) => {
						navigate(id);
						closeSheet();
					}}
					heading={copy.nav.toc}
					sectionKey="stop-reliability-toc"
				/>
			</div>
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
		<p
			class="stop-history-announcement"
			data-slot="history-page-announcement"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			{historyLiveAnnouncement}
		</p>

		<!-- The sections — the content column beside the rail. -->
		<div class="stop-reliability-content">
			{#if historyAnnouncement}
				<p class="stop-history-correction" data-slot="history-correction">
					{historyAnnouncement}
				</p>
			{/if}
			{#if explicitHistory}
				<div class="stop-history-state" data-slot="history-state">
					{#if history?.state === 'loading-index' || history?.state === 'loading-range'}
						<p data-slot="history-loading">{copy.history.loading}</p>
					{:else if history?.state === 'partial'}
						<p data-slot="history-partial">{copy.history.partial}</p>
					{:else if history?.state === 'no-data'}
						<p data-slot="history-no-data">{copy.history.noData}</p>
					{:else if history?.state === 'error'}
						<p data-slot="history-error">{copy.history.error}</p>
						<Button variant="outline" size="sm" onclick={() => history?.retry()}>
							{copy.history.retry}
						</Button>
					{/if}
					<p data-slot="history-current-only">{copy.history.currentOnly}</p>
				</div>
			{/if}
			<!-- Daily-trend + range-verdict section (full-width hero): the dated retained
			     series selected by the rail navigator. A `window` prop exists only for
			     presenter-level tests. -->
			<div class="stop-anchor stop-anchor--wide" id="stop-rel-trend" data-toc="stop-rel-trend">
				<SectionDailyTrend
					daily={selectedData.daily}
					{locale}
					{copy}
					window={effectiveWindow}
					exact={exactDailyRange}
				/>
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
					<SectionCrowding
						vm={crowding}
						settled={crowdingSettled}
						{locale}
						{copy}
						windowText={crowdingWindowText}
					/>
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
			grid-template-columns: 15rem minmax(0, 1fr);
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
	.stop-history-announcement {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	.stop-history-state,
	.stop-history-correction {
		margin: 0;
		padding: 0.75rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--foreground);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.stop-history-state {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		color: var(--muted-foreground);
	}
	.stop-history-state p {
		margin: 0;
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

	/* The rail section jump-list rides the ONE shared TocNav (same component the metrics /
	   status / network / lines rails use), so every surface's wayfinding looks identical.
	   Only this thin flex wrapper is local; TocNav owns the rest. */
	.rail-toc {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
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
