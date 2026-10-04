<script lang="ts">
	import { page } from '$app/state';
	import { getLocalizeHref, type Locale } from '$lib/i18n';
	import { routeFor } from '$lib/nav';
	import { fmtDelayMin } from '$lib/utils';
	import { formatDateKey } from '$lib/utils/time';
	import { fromSearchParams, resolveWindow, type DateWindow } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { absenceSentence, absenceShort, describeAbsence } from '$lib/site/absence';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import type { StopReliability } from '$lib/v1';
	import type { OccupancyCode } from '$lib/v1/schemas';
	import {
		ArticleControlDisclosure,
		ArticleControlStack,
		createRailDisclosureController,
		createRetainedHistoryUi,
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
	import type { MetricKey, SupplementalMetricKey } from '$lib/metrics';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { weekdayLabel, shiftLabel, dayTypeLabel } from '$lib/features/reliability/shiftGrains';
	import { detailCopy as linesDetailCopy } from '$lib/features/lines/lines.copy';

	import {
		presentGrains,
		defaultStopGrain,
		STOP_GRAINS,
		type StopGrain,
	} from '../data/presentGrains';
	import { selectDailyPercentiles } from '$lib/site/dailyPercentiles';
	import { applyRetainedStopHistory, clearRetainedStopHistory } from '../data/retainedHistory';
	import type { StopHistoryResource } from '../data/stopHistoryResource.svelte';
	import { selectGradedPeriods, selectDayPercentiles } from '../selectors/gradedPeriods';
	import { selectRankedRoutes } from '../selectors/rankedRoutes';
	import { selectWeekdaySeasonality } from '../selectors/weekdaySeasonality';
	import { selectTimeOfDay } from '../selectors/timeOfDay';
	import { hasHabits } from '$lib/reliability/habitsHeatmap';
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

	const localizeHref = getLocalizeHref();

	interface StopReliabilitySurfaceProps {
		data: StopReliability;
		locale: Locale;
		window?: DateWindow | null;
		history?: StopHistoryResource;
		articleSummary?: Snippet;
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
	const noObservationLabel = $derived(absenceShort('no-observations', locale));
	const retainedDataAbsence = $derived(describeAbsence('no-retained-data', locale));
	const retainedDataBody = $derived(`${retainedDataAbsence.why}. ${copy.history.currentOnly}`);
	const railDisclosures = createRailDisclosureController({
		controls: 'stop-reliability-controls',
		toc: 'stop-reliability-toc',
	});

	const present = $derived(presentGrains(data.periods));
	const dfltGrain = $derived(defaultStopGrain(present));

	const seed = fromSearchParams(page.url.searchParams);
	let grain = $state<StopGrain>(
		seed.grain === 'week' || seed.grain === 'month' ? seed.grain : 'day',
	);

	let settled = $state(false);
	$effect(() => {
		if (settled) return;
		settled = true;
		if (!present.has(grain)) grain = dfltGrain;
	});
	$effect(() => {
		if (settled && !present.has(grain)) grain = dfltGrain;
	});

	const currentHistoryDates = $derived(
		[...new Set((data.daily ?? []).map((point) => point.date))].sort(),
	);
	const historyUi = createRetainedHistoryUi({
		resource: () => history,
		currentDates: () => currentHistoryDates,
		copy: () => ({
			...copy.history,
			noData: absenceSentence('no-retained-data', locale),
		}),
		formatDate: (date) => formatDateKey(date, locale),
	});
	const historyRequested = $derived(historyUi.requested);
	const explicitHistory = $derived(historyUi.explicit);
	const retainedReady = $derived(historyUi.ready);
	const availableHistoryDates = $derived(historyUi.availableDates);
	const currentHistoryWindow = $derived.by<DateWindow | undefined>(() => {
		if (
			history == null ||
			!historyRequested ||
			history.state !== 'current' ||
			history.index != null ||
			historyUi.requestWindow == null
		)
			return undefined;
		return resolveWindow(historyUi.requestWindow, new Set(currentHistoryDates));
	});
	const historyWindow = $derived<DateWindow | undefined>(
		explicitHistory ? historyUi.resolvedWindow : currentHistoryWindow,
	);
	const effectiveWindow = $derived<DateWindow | null>(
		windowOverride !== undefined ? windowOverride : (historyWindow ?? null),
	);
	const historyCoverageText = $derived(historyUi.coverageText);
	const historySelectionText = $derived(
		historyRequested ? historyUi.selectionText(historyWindow) : null,
	);
	const historyAnnouncement = $derived(historyUi.announcement);
	const historyLiveAnnouncement = $derived(historyUi.liveAnnouncement);
	const historyWire = $derived.by<Record<string, string | null>>(() => {
		const grainValue = grain === 'day' ? null : grain;
		if (history == null || windowOverride !== undefined)
			return { grain: grainValue } as Record<string, string | null>;
		return { grain: grainValue, ...historyUi.wireWindow(currentHistoryWindow) };
	});
	$effect(() => {
		if (syncUrl) mirrorSearchParams(historyWire);
	});

	const grainLabels = $derived<Partial<Record<StopGrain, string>>>({
		day: copy.grain.day,
		week: copy.grain.week,
		month: copy.grain.month,
	});
	const grainSegments = $derived<GrainSegment<StopGrain>[]>(
		STOP_GRAINS.map((g) => ({ key: g, label: grainLabels[g] ?? g, available: present.has(g) })),
	);
	const windowCaption = $derived(copy.grain.window(grain));
	const grainSummary = $derived(grainLabels[grain] ?? grain);

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
	const retainedPercentiles = $derived(
		explicitHistory && retainedReady
			? selectDailyPercentiles(history?.value?.aggregate ?? null)
			: null,
	);
	const dayPercentiles = $derived(
		explicitHistory ? retainedPercentiles : selectDayPercentiles(data.periods, grain),
	);

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
		fmtDelayMin(v, { rounding: 'fixed1', noData: noObservationLabel });
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

	const habitsMatrix = $derived(data.habits?.matrix ?? []);
	const habitsPresent = $derived(hasHabits(habitsMatrix));

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

	const sectionNav = $derived(
		[
			{ id: 'stop-rel-trend', label: copy.trend.heading, present: true },
			{
				id: 'stop-rel-percentiles',
				label: copy.percentiles.heading,
				present: dayPercentiles != null,
			},
			{ id: 'stop-rel-pane', label: copy.paneHeading, present: gradedPeriods.length > 0 },
			{ id: 'stop-rel-habits', label: copy.habits.heading, present: habitsPresent },
			{ id: 'stop-rel-weekday', label: copy.weekday.heading, present: hasWeekday },
			{ id: 'stop-rel-time', label: copy.timeOfDay.heading, present: timeOfDay.hasTimeOfDay },
			{ id: 'stop-rel-crowding', label: copy.crowding.heading, present: true },
			{ id: 'stop-rel-by-route', label: copy.byRoute, present: true },
		].filter((s) => s.present),
	);

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

	async function navigate(id: string): Promise<void> {
		const generation = ++navigationGeneration;
		await revealTocTarget(id, {
			beforeReveal: openableAnchors.has(id) ? openCard : undefined,
			isCurrent: () => generation === navigationGeneration,
			behavior: $prefersReducedMotion ? 'auto' : 'smooth',
		});
	}
</script>

{#snippet metricInfo(key: MetricKey | SupplementalMetricKey, name: string)}
	<MetricInfo class="stop-metric-info" metricKey={key} {locale} {name} side="bottom" />
{/snippet}

<div class="stop-reliability">
	<div data-slot="stop-reliability-sections">
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
					onRangeChange={historyUi.selectRange}
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

			<div class="stop-reliability-content">
				{#if historyAnnouncement}
					<p class="stop-history-correction" data-slot="history-correction">
						{historyAnnouncement}
					</p>
				{/if}
				{#if explicitHistory}
					{#if history?.state === 'no-data'}
						<StateNotice
							title={retainedDataAbsence.label}
							body={retainedDataBody}
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
				<ArticleSectionStack>
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
								<MetricInfo
									class="stop-metric-info"
									metricKey="severe"
									{locale}
									name={copy.trend.heading}
									side="bottom"
								/>
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
									<MetricInfo
										class="stop-metric-info"
										metricKey="p50p90"
										{locale}
										name={copy.percentiles.heading}
										side="bottom"
									/>
								{/snippet}
								<SectionPercentiles
									percentiles={dayPercentiles}
									dailyPercentiles={retainedPercentiles}
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
								<div class="stop-reliability-pane-body" data-slot="stop-reliability-pane">
									{#if explicitHistory}
										<p class="stop-prediction-scope" data-slot="prediction-scope">
											{copy.history.predictionScope}
										</p>
									{/if}
									<VerdictBanner result={stopVerdict} />
									<ReliabilityPane periods={gradedPeriods} {locale} {metricInfo} />
								</div>
							</CollapsibleSection>
						</div>
					{/if}

					{#if habitsPresent}
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
									<MetricInfo
										class="stop-metric-info"
										metricKey="habits"
										{locale}
										name={copy.habits.heading}
										side="bottom"
									/>
								{/snippet}
								<SectionHabits matrix={habitsMatrix} {locale} {copy} presentation="article-body" />
							</CollapsibleSection>
						</div>
					{/if}

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
									<MetricInfo
										class="stop-metric-info"
										metricKey="seasonality"
										{locale}
										name={copy.weekday.heading}
										side="bottom"
									/>
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
									<MetricInfo
										class="stop-metric-info"
										metricKey="severe"
										{locale}
										name={copy.timeOfDay.heading}
										side="bottom"
									/>
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
								<MetricInfo
									class="stop-metric-info"
									metricKey="occupancy"
									{locale}
									name={copy.crowding.heading}
									side="bottom"
								/>
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
								<MetricInfo
									class="stop-metric-info"
									metricKey="avgDelay"
									{locale}
									name={copy.byRoute}
									side="bottom"
								/>
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

	.stop-reliability-window,
	.stop-prediction-scope {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--muted-foreground);
	}

	.rail-toc {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	.stop-anchor {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.stop-anchor > :global([data-slot='card'].section-card) {
		flex: 1;
		min-width: 0;
	}
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
