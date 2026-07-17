<!--
  StopReliabilitySurface — the composed Stops RELIABILITY surface (S8A re-seat).

  The single component StopDetail mounts in its reliability pane (mirroring how
  RouteDetail mounts RouteReliabilityClusters). It owns:
    - the shared responsive left rail (SurfaceRail) + $lib/filters codec: grain is
      seeded ONCE from ?grain (ENUM-GUARDED to day|week|month — never a cast),
      mirrored back via mirrorSearchParam (day default omitted), and availability =
      EXPLICIT `available` flags per grain (a stop has ONE snapshot per grain, not an
      N-bucket series, so NOT the MIN_POINTS bucket clamp — that would wrongly disable
      every stop grain). The rail holds the grain picker, the shared retained-history
      navigator, and a vertical section ToC of the PRESENT sections
      (active-highlighted via observeActiveToc); it renders as a sticky bare rail on
      desktop and ONE glass pill→sheet on mobile (single source);
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
	import { fromSearchParams, resolveWindow, type DateWindow } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { prefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import {
		availabilityFromCollectionIndex,
		datesForAvailability,
		type RawHistoryRangeRequest,
		type StopReliability,
	} from '$lib/v1';
	import type { OccupancyCode } from '$lib/v1/schemas';
	import {
		ArticleControlDisclosure,
		ArticleControlStack,
		createRailDisclosureController,
		ReliabilityPane,
		GrainPicker,
		HistoryNavigator,
		type GrainSegment,
	} from '$lib/components/surface';
	import {
		CollapsibleSection,
		observeActiveToc,
		revealTocTarget,
		TocNav,
		type TocEntry,
	} from '$lib/components/shared';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { onMount, type Snippet } from 'svelte';
	import { ArticleSectionStack, ReliabilityRailLayout } from '$lib/components/layout';
	import { Button } from '@yesid/ui/button';
	import { StateNotice } from '$lib/components/edge';
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
		/** Shared detail-page summary, aligned above the article cards beside the rail. */
		articleSummary?: Snippet;
		/** Only the visible reliability pane owns grain and retained-range URL state. */
		syncUrl?: boolean;
	}
	let {
		data,
		locale,
		window: windowOverride = undefined,
		history,
		articleSummary,
		syncUrl = true,
	}: StopReliabilitySurfaceProps = $props();

	const copy = $derived(stopReliabilityCopy[locale]);
	const railDisclosures = createRailDisclosureController({
		controls: 'stop-reliability-controls',
		toc: 'stop-reliability-toc',
	});

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
	const currentHistoryDates = $derived(
		[...new Set((data.daily ?? []).map((point) => point.date))].sort(),
	);
	const availableHistoryDates = $derived(
		historyDates.length > 0 ? historyDates : currentHistoryDates,
	);
	const currentHistoryWindow = $derived.by<DateWindow | undefined>(() => {
		if (
			history == null ||
			!historyRequested ||
			history.state !== 'current' ||
			history.index != null ||
			!history.request.hasFrom ||
			!history.request.hasTo ||
			history.request.rawFrom == null ||
			history.request.rawTo == null
		)
			return undefined;

		const candidate: DateWindow =
			history.request.rawFrom <= history.request.rawTo
				? { from: history.request.rawFrom, to: history.request.rawTo }
				: { from: history.request.rawTo, to: history.request.rawFrom };
		return resolveWindow(candidate, new Set(currentHistoryDates));
	});
	const historyWindow = $derived<DateWindow | undefined>(
		explicitHistory ? (history?.resolved?.selection ?? undefined) : currentHistoryWindow,
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
		if (!historyRequested || historyWindow == null) return null;
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
		const canonical = history.resolved?.canonicalWindow ?? currentHistoryWindow;
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
	$effect(() => {
		if (syncUrl) mirrorSearchParams(historyWire);
	});

	// Grain radiogroup wiring: EXPLICIT `available` flags (NOT the bucket clamp) — one
	// snapshot per grain, so a grain is enabled iff the stop carries that grain. The
	// SAME segments + `grain` binding drive the ONE GrainPicker SurfaceRail renders in
	// both the bare desktop rail AND the mobile sheet (single source, no divergence).
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

	/* ── section ToC (P5.4 responsive left-rail wayfinding) ─────────────────────
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
	const openableAnchors = $derived(new Set(tocEntries.map((entry) => entry.id)));
	const sectionIndex = (id: string): number => sectionNav.findIndex((section) => section.id === id);
	const sectionKey = (id: string): string => `stop-reliability-card-${id}`;

	// One IntersectionObserver over the present tiles' [data-toc] anchors owns the
	// active section the rail ToC highlights (client-only).
	let activeId = $state('');
	let cardOpenSignals = $state<Record<string, number>>({});
	let navigationGeneration = 0;
	onMount(() => observeActiveToc((id) => (activeId = id)));

	function openCard(id: string): void {
		cardOpenSignals = {
			...cardOpenSignals,
			[id]: (cardOpenSignals[id] ?? 0) + 1,
		};
	}
	function cardOpenSignal(id: string): number {
		return quietModeStore.openSignal + (cardOpenSignals[id] ?? 0);
	}

	// A ToC jump first opens its data disclosure, waits for its layout to settle,
	// then scrolls. Filters and the ToC itself remain visible in the independent rail.
	async function navigate(id: string): Promise<void> {
		const generation = ++navigationGeneration;
		await revealTocTarget(id, {
			beforeReveal: openableAnchors.has(id) ? openCard : undefined,
			isCurrent: () => generation === navigationGeneration,
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
		});
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
	<!-- P5.4: the grain picker + retained-history navigator + section ToC live in the
	     shared SurfaceRail — a sticky bare rail beside the sections on desktop, and
	     ONE merged glass pill→sheet menu on mobile. -->
	<div data-slot="stop-reliability-sections">
		<!-- The rail content — the grain radiogroup (+ resolved-window caption) + the
		     section ToC. ONE definition, rendered by SurfaceRail in BOTH the bare desktop
		     rail AND the mobile sheet (single source; both bind the same grain + track
		     activeId). -->
		{#snippet railContent({ closeSheet }: { closeSheet: () => void })}
			{#snippet historyControls()}
				<HistoryNavigator
					mode="range"
					{locale}
					labels={copy.history.navigator}
					value={historyWindow}
					availableDates={availableHistoryDates}
					coverageText={historyCoverageText}
					selectionText={historySelectionText}
					liveAnnouncement={false}
					onRangeChange={selectHistoryRange}
				/>
			{/snippet}
			{#snippet primaryControls()}
				<GrainPicker
					segments={grainSegments}
					bind:value={grain}
					label={copy.grain.label}
					variant="time-grid"
				/>
			{/snippet}
			{#snippet windowCaptionControl()}
				<p class="stop-reliability-window" data-slot="active-window" aria-live="polite">
					{windowCaption}
				</p>
			{/snippet}

			<ArticleControlDisclosure
				title={copy.controlsLabel}
				bind:open={
					() => railDisclosures.isOpen('controls'), (next) => railDisclosures.set('controls', next)
				}
			>
				<ArticleControlStack
					history={availableHistoryDates.length > 0 ? historyControls : undefined}
					primary={primaryControls}
					caption={windowCaptionControl}
				/>
			</ArticleControlDisclosure>

			<!-- Section ToC (wayfinding) — the ONE shared TocNav, identical to the metrics /
			     status / network / lines rails: a numbered jump list of the PRESENT sections
			     with TocNav's own "SEC n/m" readout (the rail's ONLY position counter), the
			     active one amber-highlighted. Picking a section also dismisses the mobile
			     sheet through SurfaceRail's explicit closeSheet seam. -->
			<div class="rail-toc" data-slot="section-toc">
				<TocNav
					entries={tocEntries}
					{activeId}
					bind:open={
						() => railDisclosures.isOpen('toc'), (next) => railDisclosures.set('toc', next)
					}
					onNavigate={(id) => {
						closeSheet();
						void navigate(id);
					}}
					heading={copy.nav.toc}
				/>
			</div>
		{/snippet}

		{#snippet reliabilityContent()}
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
					{#if history?.state === 'no-data'}
						<StateNotice
							title={copy.history.noData}
							body={copy.history.currentOnly}
							presentation="responsive"
							data-slot="history-no-data"
						/>
					{:else}
						<div class="stop-history-state" data-slot="history-state">
							{#if history?.state === 'loading-index' || history?.state === 'loading-range'}
								<p data-slot="history-loading">{copy.history.loading}</p>
							{:else if history?.state === 'partial'}
								<p data-slot="history-partial">{copy.history.partial}</p>
							{:else if history?.state === 'error'}
								<p data-slot="history-error">{copy.history.error}</p>
								<Button variant="outline" size="sm" onclick={() => history?.retry()}>
									{copy.history.retry}
								</Button>
							{/if}
							<p data-slot="history-current-only">{copy.history.currentOnly}</p>
						</div>
					{/if}
				{/if}
				<!-- Every present reliability disclosure follows one connected, source-ordered
			     article sequence. Conditional cards stand down without leaving a grid hole. -->
				<ArticleSectionStack>
					<!-- Daily-trend + range-verdict section: the dated retained series selected by
				     the rail navigator. A `window` prop exists only for presenter-level tests. -->
					<div class="stop-anchor" id="stop-rel-trend">
						<CollapsibleSection
							title={copy.trend.heading}
							headerVariant="article-summary"
							anchor="stop-rel-trend"
							index={sectionIndex('stop-rel-trend')}
							sectionKey={sectionKey('stop-rel-trend')}
							open={true}
							closeSignal={quietModeStore.closeSignal}
							openSignal={cardOpenSignal('stop-rel-trend')}
							bulkCollapsed={quietModeStore.enabled}
						>
							{#snippet headerActions()}
								{@render metricInfo('severe', copy.trend.heading)}
							{/snippet}
							<SectionDailyTrend
								daily={selectedData.daily}
								{locale}
								{copy}
								window={effectiveWindow}
								exact={exactDailyRange}
								presentation="article-body"
							/>
						</CollapsibleSection>
					</div>

					<!-- Each present tile keeps its locale-free id/data-toc anchor so the rail ToC
				     can jump to and highlight it. -->
					{#if dayPercentiles != null}
						<div class="stop-anchor" id="stop-rel-percentiles">
							<CollapsibleSection
								title={copy.percentiles.heading}
								headerVariant="article-summary"
								anchor="stop-rel-percentiles"
								index={sectionIndex('stop-rel-percentiles')}
								sectionKey={sectionKey('stop-rel-percentiles')}
								open={true}
								closeSignal={quietModeStore.closeSignal}
								openSignal={cardOpenSignal('stop-rel-percentiles')}
								bulkCollapsed={quietModeStore.enabled}
							>
								{#snippet headerActions()}
									{@render metricInfo('p50p90', copy.percentiles.heading)}
								{/snippet}
								<SectionPercentiles
									percentiles={dayPercentiles}
									{locale}
									{copy}
									presentation="article-body"
								/>
							</CollapsibleSection>
						</div>
					{/if}

					{#if gradedPeriods.length > 0}
						<div class="stop-anchor" id="stop-rel-pane">
							<CollapsibleSection
								title={copy.paneHeading}
								headerVariant="article-summary"
								anchor="stop-rel-pane"
								index={sectionIndex('stop-rel-pane')}
								sectionKey={sectionKey('stop-rel-pane')}
								open={true}
								closeSignal={quietModeStore.closeSignal}
								openSignal={cardOpenSignal('stop-rel-pane')}
								bulkCollapsed={quietModeStore.enabled}
							>
								{#snippet headerActions()}
									{@render metricInfo('otp', copy.metrics.otp)}
									{@render metricInfo('avgDelay', copy.metrics.avgDelay)}
									{@render metricInfo('severe', copy.metrics.severe)}
								{/snippet}
								<div class="stop-reliability-pane-body" data-slot="stop-reliability-pane">
									<!-- §C5.6: the one-line reliability verdict at the top of the pane. -->
									<VerdictBanner result={stopVerdict} />
									<ReliabilityPane periods={gradedPeriods} {locale} />
								</div>
							</CollapsibleSection>
						</div>
					{/if}

					<!-- ROW 1: habits (full-width hero). -->
					{#if habits.hasHabits}
						<div class="stop-anchor" id="stop-rel-habits">
							<CollapsibleSection
								title={copy.habits.heading}
								headerVariant="article-summary"
								anchor="stop-rel-habits"
								index={sectionIndex('stop-rel-habits')}
								sectionKey={sectionKey('stop-rel-habits')}
								open={true}
								closeSignal={quietModeStore.closeSignal}
								openSignal={cardOpenSignal('stop-rel-habits')}
								bulkCollapsed={quietModeStore.enabled}
							>
								{#snippet headerActions()}
									{@render metricInfo('habits', copy.habits.heading)}
								{/snippet}
								<SectionHabits matrix={habits.matrix} {locale} {copy} presentation="article-body" />
							</CollapsibleSection>
						</div>
					{/if}

					<!-- ROW: dow + time-of-day (operator pairing). An absent mate lets the survivor span. -->
					{#if hasWeekday}
						<div class="stop-anchor" id="stop-rel-weekday">
							<CollapsibleSection
								title={copy.weekday.heading}
								headerVariant="article-summary"
								anchor="stop-rel-weekday"
								index={sectionIndex('stop-rel-weekday')}
								sectionKey={sectionKey('stop-rel-weekday')}
								open={true}
								closeSignal={quietModeStore.closeSignal}
								openSignal={cardOpenSignal('stop-rel-weekday')}
								bulkCollapsed={quietModeStore.enabled}
							>
								{#snippet headerActions()}
									{@render metricInfo('seasonality', copy.weekday.heading)}
								{/snippet}
								<SectionWeekday rows={rankedWeekdays} {locale} {copy} presentation="article-body" />
							</CollapsibleSection>
						</div>
					{/if}
					{#if timeOfDay.hasTimeOfDay}
						<div class="stop-anchor" id="stop-rel-time">
							<CollapsibleSection
								title={copy.timeOfDay.heading}
								headerVariant="article-summary"
								anchor="stop-rel-time"
								index={sectionIndex('stop-rel-time')}
								sectionKey={sectionKey('stop-rel-time')}
								open={true}
								closeSignal={quietModeStore.closeSignal}
								openSignal={cardOpenSignal('stop-rel-time')}
								bulkCollapsed={quietModeStore.enabled}
							>
								{#snippet headerActions()}
									{@render metricInfo('severe', copy.timeOfDay.heading)}
								{/snippet}
								<SectionTimeOfDay
									shiftRows={timeOfDay.shiftRows}
									dayTypeRows={timeOfDay.dayTypeRows}
									{locale}
									{copy}
									presentation="article-body"
								/>
							</CollapsibleSection>
						</div>
					{/if}

					<!-- ROW: crowding + by-route (operator pairing). -->
					<div class="stop-anchor" id="stop-rel-crowding">
						<CollapsibleSection
							title={copy.crowding.heading}
							headerVariant="article-summary"
							anchor="stop-rel-crowding"
							index={sectionIndex('stop-rel-crowding')}
							sectionKey={sectionKey('stop-rel-crowding')}
							open={true}
							closeSignal={quietModeStore.closeSignal}
							openSignal={cardOpenSignal('stop-rel-crowding')}
							bulkCollapsed={quietModeStore.enabled}
						>
							{#snippet headerActions()}
								{@render metricInfo('occupancy', copy.crowding.heading)}
							{/snippet}
							<SectionCrowding
								vm={crowding}
								settled={crowdingSettled}
								{locale}
								{copy}
								windowText={crowdingWindowText}
								presentation="article-body"
							/>
						</CollapsibleSection>
					</div>
					<div class="stop-anchor" id="stop-rel-by-route">
						<CollapsibleSection
							title={copy.byRoute}
							headerVariant="article-summary"
							anchor="stop-rel-by-route"
							index={sectionIndex('stop-rel-by-route')}
							sectionKey={sectionKey('stop-rel-by-route')}
							open={true}
							closeSignal={quietModeStore.closeSignal}
							openSignal={cardOpenSignal('stop-rel-by-route')}
							bulkCollapsed={quietModeStore.enabled}
						>
							{#snippet headerActions()}
								{@render metricInfo('avgDelay', copy.byRoute)}
							{/snippet}
							<SectionByRoute
								rows={rankedRoutes}
								hasAssociations={hasByRouteAssoc}
								{locale}
								{copy}
								presentation="article-body"
							/>
						</CollapsibleSection>
					</div>
				</ArticleSectionStack>
			</div>
		{/snippet}

		<ReliabilityRailLayout
			rail={railContent}
			content={reliabilityContent}
			{articleSummary}
			label={copy.controlsLabel}
			summary={grainSummary}
			openAria={copy.nav.pillOpen}
			closeAria={copy.nav.pillClose}
		/>
	</div>
</div>

<style>
	.stop-reliability {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	/* The content column — the daily-trend hero + the readouts board. */
	.stop-reliability-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
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

	/* Section anchor wrapper: the locale-free id complements the card's data-toc target. */
	.stop-anchor {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.stop-anchor > :global([data-slot='card'].section-card) {
		flex: 1;
		min-width: 0;
	}
	/* Smooth jump-to from the ToC (reduced-motion users get the instant default). */
	@media (prefers-reduced-motion: no-preference) {
		:global([data-slot='reliability-rail-layout']) {
			scroll-behavior: smooth;
		}
	}

	.stop-reliability-pane-body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
</style>
