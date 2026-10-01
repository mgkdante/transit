<script lang="ts">
	import { cn } from '$lib/utils';
	import { selectDailyPercentiles } from '$lib/site/dailyPercentiles';
	import { formatDateKey } from '$lib/utils/time';
	import { selectHeadlinePeriod } from './selectors/dayVerdictHeadline';
	import { page } from '$app/state';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import { fromSearchParams, toSearchParams, emptyFilterState, resolveWindow } from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import { absenceSentence, describeAbsence } from '$lib/site/absence';
	import { historyRangeRequestFromSearchParams } from '$lib/v1/history/rangeResource.svelte';
	import type { RouteReliability } from '$lib/v1';
	import { SvelteSet } from 'svelte/reactivity';
	import { onMount, type Snippet } from 'svelte';
	import {
		ArticleControlDisclosure,
		ArticleControlStack,
		createRailDisclosureController,
		createRetainedHistoryUi,
		GrainPicker,
		HistoryNavigator,
		type GrainSegment,
	} from '$lib/components/surface';
	import { ArticleSectionStack, ReliabilityRailLayout } from '$lib/components/layout';
	import type {
		SurfaceRailContext,
		SurfaceRailPresentation,
	} from '$lib/components/surface/SurfaceRail.svelte';
	import {
		observeActiveToc,
		openCollapsedTocTarget,
		revealTocTarget,
		TocNav,
		type TocEntry,
	} from '$lib/components/shared';
	import { Button } from '@yesid/ui/button';
	import { StateNotice } from '$lib/components/edge';
	import { toReliabilityClusters } from './clusters';
	import { reliabilityCopy } from './reliability.copy';
	import { applyRetainedLineHistory, clearRetainedLineHistory } from './data/retainedHistory';
	import type { LineHistoryResource } from './data/lineHistoryResource.svelte';
	import Section0Verdict from './sections/Section0Verdict.svelte';
	import Section1WhenToRide from './sections/Section1WhenToRide.svelte';
	import Section2TheWait from './sections/Section2TheWait.svelte';
	import Section3RunAndFit from './sections/Section3RunAndFit.svelte';
	import Section4WorstStops from './sections/Section4WorstStops.svelte';

	interface RouteReliabilityClustersProps {
		data: RouteReliability;
		locale: Locale;
		directionHeadsigns?: Record<number, string>;
		class?: string;
		history?: LineHistoryResource;
		articleSummary?: Snippet;
	}

	let {
		data,
		locale,
		directionHeadsigns = {},
		class: className,
		history,
		articleSummary,
	}: RouteReliabilityClustersProps = $props();

	const copy = $derived(reliabilityCopy[locale]);
	const railDisclosures = createRailDisclosureController({
		controls: 'reliability-controls',
		toc: 'reliability-toc',
	});

	type GrainMode = 'day' | 'week' | 'month' | 'range';
	const seed = fromSearchParams(page.url.searchParams);
	const explicitRangeToken = page.url.searchParams.get('grain') === 'range';
	const initialHistoryRequest = historyRangeRequestFromSearchParams(page.url.searchParams);
	const seededRange =
		seed.window != null ||
		explicitRangeToken ||
		initialHistoryRequest.hasFrom ||
		initialHistoryRequest.hasTo;
	let viewKey = $state<GrainMode>(
		seededRange ? 'range' : seed.grain === 'week' || seed.grain === 'month' ? seed.grain : 'day',
	);
	const mode = $derived<GrainMode>(viewKey);

	const datedPeriods = $derived(
		(data.periods ?? [])
			.filter((p): p is typeof p & { date: string } => p.grain === 'day' && !!p.date)
			.filter((p, i, arr) => arr.findIndex((q) => q.date === p.date) === i)
			.slice()
			.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
	);
	const currentAvailableDates = $derived(datedPeriods.map((period) => period.date));
	const historyUi = createRetainedHistoryUi({
		resource: () => history,
		initialRequest: initialHistoryRequest,
		currentDates: () => currentAvailableDates,
		copy: () => ({
			...copy.history,
			noData: absenceSentence('no-retained-data', locale),
		}),
		formatDate: (date) => formatDateKey(date, locale),
		isCompleteRequest: ({ rawFrom, rawTo }) => Boolean(rawFrom && rawTo),
		onCorrection: () => {
			if (!explicitRangeToken) viewKey = 'day';
		},
	});
	const availableDates = $derived(historyUi.availableDates);
	const hasDatedPeriods = $derived(availableDates.length > 0);

	const availableGrains = $derived.by<Set<string>>(() => {
		const set = new SvelteSet<string>();
		for (const p of data.periods ?? []) {
			if (p.grain === 'day' || p.grain === 'week' || p.grain === 'month') set.add(p.grain);
		}
		return set;
	});

	let settled = false;
	$effect(() => {
		if (settled) return;
		settled = true;
		if (history == null) {
			const window = resolveWindow(seed.window, new Set(currentAvailableDates));
			historyUi.selectRange(window ?? undefined);
			if (window) viewKey = 'range';
			else if (viewKey === 'range' && !explicitRangeToken) viewKey = 'day';
		}
		if ((viewKey === 'week' || viewKey === 'month') && !availableGrains.has(viewKey))
			viewKey = 'day';
		else if (viewKey === 'range' && !hasDatedPeriods && history == null) viewKey = 'day';
	});

	const rangeWindow = $derived(historyUi.requestWindow);
	const hasRangePick = $derived(mode === 'range' && rangeWindow != null);
	const normalizedRange = $derived<{ start: string; end: string } | undefined>(
		hasRangePick && rangeWindow ? { start: rangeWindow.from, end: rangeWindow.to } : undefined,
	);
	const historyRequested = $derived(historyUi.requested);
	const explicitHistory = $derived(historyUi.explicit);
	const retainedReady = $derived(historyUi.ready);
	const historyAnnouncement = $derived(historyUi.announcement);
	const historyLiveAnnouncement = $derived(historyUi.liveAnnouncement);

	$effect(() => {
		if (mode === 'range' || !historyRequested) return;
		historyUi.clearRequest();
	});

	$effect(() => {
		if (
			history == null ||
			!historyRequested ||
			history.state !== 'current' ||
			history.index != null
		)
			return;
		if (resolveWindow(rangeWindow, new Set(currentAvailableDates)) != null) return;
		historyUi.clearRequest();
		if (!explicitRangeToken) viewKey = 'day';
	});

	const historyCoverageText = $derived(historyUi.coverageText);
	const historySelectionText = $derived(
		normalizedRange == null
			? null
			: historyUi.selectionText({ from: normalizedRange.start, to: normalizedRange.end }),
	);

	const wireParams = $derived.by<{ grain: string | null; from: string | null; to: string | null }>(
		() => {
			const state = emptyFilterState();
			if (mode === 'range') {
				if (normalizedRange)
					state.window = { from: normalizedRange.start, to: normalizedRange.end };
			} else if (mode !== 'day') {
				state.grain = mode;
			}
			const sp = toSearchParams(state);
			return {
				grain: mode === 'range' && !normalizedRange ? 'range' : sp.get('grain'),
				from: sp.get('from'),
				to: sp.get('to'),
			};
		},
	);
	$effect(() => mirrorSearchParams(wireParams));

	const selectedData = $derived.by<RouteReliability>(() => {
		if (!explicitHistory) return data;
		if (retainedReady && history?.value != null) {
			return applyRetainedLineHistory(data, history.value);
		}
		return clearRetainedLineHistory(data);
	});
	const mapperOpts = $derived(
		mode === 'range'
			? {
					grain: 'day',
					dateRange: normalizedRange,
					...(retainedReady && history?.value != null ? { retained: history.value } : {}),
				}
			: { grain: mode },
	);

	const clusters = $derived(toReliabilityClusters(selectedData, mapperOpts));
	const dailyPercentiles = $derived(
		explicitHistory && retainedReady && mode === 'range'
			? selectDailyPercentiles(history?.value?.aggregate ?? null)
			: null,
	);

	const uid = $props.id();
	const segmentAvailable = $derived<Record<GrainMode, boolean>>({
		day: availableGrains.has('day'),
		week: availableGrains.has('week'),
		month: availableGrains.has('month'),
		range: hasDatedPeriods,
	});
	const disabledReason = $derived(absenceSentence('no-observations', locale));
	const retainedDataAbsence = $derived(describeAbsence('no-retained-data', locale));
	const segments = $derived<GrainSegment<GrainMode>[]>(
		(['day', 'week', 'month', 'range'] as const).map((key) => {
			const label =
				key === 'day'
					? copy.controls.latestDay
					: key === 'week'
						? copy.controls.thisWeek
						: key === 'month'
							? copy.controls.thisMonth
							: copy.controls.dateRange;
			const available = segmentAvailable[key];
			return {
				key,
				label,
				available,
				...(available ? {} : { describedById: `${uid}-reason-${key}`, title: disabledReason }),
			};
		}),
	);
	function segmentsFor(presentation: SurfaceRailPresentation): GrainSegment<GrainMode>[] {
		return segments.map((segment) =>
			segment.describedById
				? { ...segment, describedById: `${segment.describedById}-${presentation}` }
				: segment,
		);
	}

	const activeWindowCaption = $derived.by<string>(() => {
		const aw = copy.controls.activeWindow;
		if (mode === 'range') {
			if (!normalizedRange) return aw.rangePrompt;
			if (normalizedRange.start === normalizedRange.end) return aw.singleDay(normalizedRange.start);
			const agg = clusters.strip.rangeAggregate;
			if (agg && agg.days > 0) return aw.range(agg.days, agg.start, agg.end);
			return aw.rangeSelection(normalizedRange.start, normalizedRange.end);
		}
		if (mode === 'week') return aw.week;
		if (mode === 'month') return aw.month;
		const latest = selectHeadlinePeriod(selectedData.periods ?? [], 'day');
		return aw.day(latest?.grain === 'day' ? (latest.date ?? null) : null);
	});

	const controlsSummary = $derived(
		mode === 'range'
			? copy.controls.dateRange
			: mode === 'week'
				? copy.controls.thisWeek
				: mode === 'month'
					? copy.controls.thisMonth
					: copy.controls.latestDay,
	);

	const sectionNav = $derived([
		{ id: 'rel-verdict', label: copy.sections.verdict.label },
		{ id: 'rel-when-to-ride', label: copy.sections.whenToRide.label },
		{ id: 'rel-the-wait', label: copy.sections.theWait.label },
		{ id: 'rel-run-and-fit', label: copy.sections.runAndFit.label },
		{ id: 'rel-worst-stops', label: copy.sections.worstStops.label },
	]);

	const tocEntries: TocEntry[] = $derived(
		sectionNav.map((s, i) => ({
			id: s.id,
			title: s.label,
			level: 2,
			badge: { kind: 'number' as const, value: i + 1 },
			children: [],
		})),
	);

	let activeId = $state('');
	onMount(() => observeActiveToc((id) => (activeId = id)));

	async function navigate(id: string): Promise<void> {
		await revealTocTarget(id, {
			beforeReveal: openCollapsedTocTarget,
			behavior: $prefersReducedMotion ? 'auto' : 'smooth',
		});
	}
</script>

<div class={cn('reliability-clusters', className)} data-slot="reliability-clusters">
	<div data-slot="reliability-sections">
		{#snippet rangeControls()}
			{#if mode === 'range'}
				<HistoryNavigator
					mode="range"
					{availableDates}
					{locale}
					labels={copy.history.navigator}
					value={rangeWindow}
					coverageText={historyCoverageText}
					selectionText={historySelectionText}
					liveAnnouncement={false}
					onRangeChange={historyUi.selectRange}
				/>
			{/if}
		{/snippet}

		{#snippet railContent({ closeSheet, presentation }: SurfaceRailContext)}
			{@const presentedSegments = segmentsFor(presentation)}
			{#snippet primaryControls()}
				<GrainPicker
					segments={presentedSegments}
					bind:value={viewKey}
					label={copy.controls.grainLabel}
					variant="time-grid"
				/>
				{#each presentedSegments as seg (seg.key)}
					{#if seg.describedById}
						<span id={seg.describedById} class="reliability-reason" data-slot="controls-reason"
							>{disabledReason}</span
						>
					{/if}
				{/each}
			{/snippet}
			{#snippet activeWindowCaptionControl()}
				<p class="reliability-window" data-slot="active-window" aria-live="polite">
					{activeWindowCaption}
				</p>
			{/snippet}

			<ArticleControlDisclosure
				title={copy.controls.viewLabel}
				bind:open={
					() => railDisclosures.isOpen('controls'), (next) => railDisclosures.set('controls', next)
				}
			>
				<ArticleControlStack
					primary={primaryControls}
					secondary={mode === 'range' ? rangeControls : undefined}
					caption={activeWindowCaptionControl}
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
						void navigate(id);
						closeSheet();
					}}
					heading={copy.controls.toc}
				/>
			</div>
		{/snippet}

		{#snippet reliabilityContent()}
			<p
				class="reliability-history-announcement"
				data-slot="history-page-announcement"
				role="status"
				aria-live="polite"
				aria-atomic="true"
			>
				{historyLiveAnnouncement}
			</p>

			<div class="reliability-content">
				{#if historyAnnouncement}
					<p class="reliability-history-correction" data-slot="history-correction">
						{historyAnnouncement}
					</p>
				{/if}
				{#if explicitHistory}
					{#if history?.state === 'no-data'}
						<StateNotice
							title={retainedDataAbsence.label}
							body={`${retainedDataAbsence.why}. ${copy.history.currentOnly}`}
							presentation="responsive"
							data-slot="history-no-data"
						/>
					{:else}
						<div class="reliability-history-state" data-slot="history-state">
							<div class="reliability-history-status">
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
							</div>
							<p data-slot="history-current-only">{copy.history.currentOnly}</p>
						</div>
					{/if}
				{/if}
				<ArticleSectionStack>
					<div class="reliability-band" id="rel-verdict" data-toc="rel-verdict" data-band="verdict">
						<Section0Verdict vm={clusters.punctuality} {locale} {copy} {mode} {dailyPercentiles} />
					</div>

					<div
						class="reliability-band"
						id="rel-when-to-ride"
						data-toc="rel-when-to-ride"
						data-band="when-to-ride"
					>
						<Section1WhenToRide
							punctuality={clusters.punctuality}
							habits={clusters.habits}
							{locale}
							{copy}
							{mode}
						/>
					</div>

					<div
						class="reliability-band"
						id="rel-the-wait"
						data-toc="rel-the-wait"
						data-band="the-wait"
					>
						<Section2TheWait
							wait={clusters.waitRegularity}
							serviceSpans={clusters.serviceDelivered.serviceSpans}
							{locale}
							{copy}
							{directionHeadsigns}
							{mode}
						/>
					</div>

					<div
						class="reliability-band"
						id="rel-run-and-fit"
						data-toc="rel-run-and-fit"
						data-band="run-and-fit"
					>
						<Section3RunAndFit
							service={clusters.serviceDelivered}
							crowding={clusters.crowding}
							{locale}
							{copy}
							windowLabel={controlsSummary}
							showServiceCompleteness={explicitHistory && retainedReady}
						/>
					</div>

					<div
						class="reliability-band"
						id="rel-worst-stops"
						data-toc="rel-worst-stops"
						data-band="worst-stops"
					>
						<Section4WorstStops punctuality={clusters.punctuality} {locale} {copy} />
					</div>
				</ArticleSectionStack>
			</div>
		{/snippet}

		<ReliabilityRailLayout
			rail={railContent}
			content={reliabilityContent}
			{articleSummary}
			label={copy.controls.viewLabel}
			summary={controlsSummary}
			openAria={copy.controls.filterPillOpen}
			closeAria={copy.controls.filterPillClose}
		/>
	</div>
</div>

<style>
	.reliability-clusters {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.reliability-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
		min-width: 0;
	}

	.reliability-reason {
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

	.reliability-window {
		margin: 0;
		flex-basis: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--muted-foreground);
	}
	.reliability-history-announcement {
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
	.reliability-history-state {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.75rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.reliability-history-state p {
		margin: 0;
	}
	.reliability-history-status {
		min-block-size: 1lh;
	}
	.reliability-history-correction {
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

	.rail-toc {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	.reliability-clusters :global([data-surface-controls] [data-slot='controls-nav']) {
		justify-content: space-between;
	}
	.reliability-band {
		min-width: 0;
	}
	@media (prefers-reduced-motion: no-preference) {
		:global([data-slot='reliability-rail-layout']) {
			scroll-behavior: smooth;
		}
	}
	:global(.reliability-band [data-card]) {
		border: 1px solid var(--border);
		background: var(--surface-2);
		border-radius: var(--radius-lg);
		padding: clamp(0.9rem, 2.2vw, 1.35rem);
	}
	:global(.reliability-band [data-card='primary']) {
		border-color: var(--border-rule);
	}
	:global(.reliability-band [data-card] [data-slot='section-label']) {
		color: var(--accent-text);
		font-weight: 600;
	}

	:global(.reliability-band .section-subtitle__text) {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-title);
		font-weight: 700;
		line-height: 1.12;
		letter-spacing: var(--tracking-tight);
		color: var(--foreground);
		max-inline-size: var(--measure-display);
		text-wrap: balance;
	}
</style>
