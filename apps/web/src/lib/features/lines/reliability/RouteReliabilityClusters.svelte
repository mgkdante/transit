<script lang="ts">
	import { cn } from '#lib/utils/index.ts';
	import { selectDailyPercentiles } from '#lib/site/dailyPercentiles.ts';
	import { createReliabilityViewState } from '#lib/reliability/viewState.svelte.ts';
	import { selectVerdictWindow } from '#lib/v1/verdict.ts';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import type { Locale } from '#lib/i18n/index.ts';
	import { absenceSentence, describeAbsence } from '#lib/site/absence.ts';
	import type { RouteReliability } from '#lib/v1/index.ts';
	import type { Snippet } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import {
		ArticleControlStack,
		GrainPicker,
		HistoryNavigator,
	} from '#lib/components/surface/index.ts';
	import { ArticleSectionStack, ReliabilityRailLayout } from '#lib/components/layout/index.ts';
	import { type SurfaceRailContext } from '@yesid/ui/layout';
	import { CollapsibleSection, useSectionJump, TocNav, type TocEntry } from '@yesid/ui/brand';
	import { Button } from '@yesid/ui/button';
	import { StateNotice } from '@yesid/ui/feedback';
	import { toReliabilityClusters } from './clusters';
	import { retainedDelayHeadline } from '#lib/v1/verdict.ts';
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

	const view = createReliabilityViewState({
		snapshot: () => data,
		retained: {
			resource: () => history,
			copy: () => ({ ...copy.history, noData: absenceSentence('no-retained-data', locale) }),
		},
		grains: {
			keys: ['day', 'week', 'month', 'range'] as const,
			labels: () => ({
				day: copy.controls.latestDay,
				week: copy.controls.thisWeek,
				month: copy.controls.thisMonth,
				range: copy.controls.dateRange,
			}),
		},
		apply: (current, retained) =>
			retained ? applyRetainedLineHistory(current, retained) : clearRetainedLineHistory(current),
		locale: () => locale,
		verdict: {
			file: (data) => data,
			headline: (retained) => retainedDelayHeadline(retained.aggregate.delay.value),
		},
	});
	const mode = $derived(view.grain);
	const rangeWindow = $derived(view.navigator?.value);
	const normalizedRange = $derived(
		mode === 'range' && rangeWindow ? { start: rangeWindow.from, end: rangeWindow.to } : undefined,
	);
	const explicitHistory = $derived(view.history.active);
	const retainedReady = $derived(view.history.ready);
	const historyAnnouncement = $derived(view.announcements.correction);
	const historyLiveAnnouncement = $derived(view.announcements.live);
	const selectedData = $derived(view.data);
	const mapperOpts = $derived(
		mode === 'range'
			? {
					grain: 'day',
					dateRange: normalizedRange,
					...(retainedReady && view.history.value != null ? { retained: view.history.value } : {}),
				}
			: { grain: mode, automaticHeadline: view.verdictWindow.grain == null },
	);

	const clusters = $derived(
		toReliabilityClusters(selectedData, { ...mapperOpts, verdict: view.verdict }),
	);
	const dailyPercentiles = $derived(
		explicitHistory && retainedReady && mode === 'range'
			? selectDailyPercentiles(view.history.value?.aggregate ?? null)
			: null,
	);

	const retainedDataAbsence = $derived(describeAbsence('no-retained-data', locale));

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
		const latest = selectVerdictWindow(selectedData.periods ?? [], 'day');
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

	const navigation = useSectionJump(afterNavigate);
	let sectionRoot = $state<HTMLElement>();
	$effect(() => {
		if (sectionRoot)
			return navigation.register(tocEntries, { root: sectionRoot, landFragments: true });
	});
	const navigate = (id: string) =>
		navigation.jump(id, { behavior: $prefersReducedMotion ? 'auto' : 'smooth' });
</script>

<div
	bind:this={sectionRoot}
	class={cn('reliability-clusters', className)}
	data-slot="reliability-clusters"
>
	<div data-slot="reliability-sections">
		{#snippet rangeControls()}
			{#if mode === 'range'}
				<HistoryNavigator {...view.navigator!} />
			{/if}
		{/snippet}

		{#snippet railContent({ closeSheet }: SurfaceRailContext)}
			{#snippet primaryControls()}
				<GrainPicker
					segments={view.segments}
					value={view.grain}
					onSelect={view.selectGrain}
					label={copy.controls.grainLabel}
					variant="time-grid"
				/>
			{/snippet}
			{#snippet activeWindowCaptionControl()}
				<p class="reliability-window" data-slot="active-window" aria-live="polite">
					{activeWindowCaption}
				</p>
			{/snippet}

			<CollapsibleSection independent title={copy.controls.viewLabel}>
				<ArticleControlStack
					primary={primaryControls}
					secondary={mode === 'range' ? rangeControls : undefined}
					caption={activeWindowCaptionControl}
				/>
			</CollapsibleSection>

			<div class="rail-toc" data-slot="section-toc">
				<TocNav
					entries={tocEntries}
					{navigation}
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
				class="reliability-history-announcement sr-only"
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
					{#if view.history.state === 'no-data'}
						<StateNotice
							title={retainedDataAbsence.label}
							body={`${retainedDataAbsence.why}. ${copy.history.currentOnly}`}
							presentation="responsive"
							data-slot="history-no-data"
						/>
					{:else}
						<div class="reliability-history-state" data-slot="history-state">
							<div class="reliability-history-status">
								{#if view.history.state === 'loading-index' || view.history.state === 'loading-range'}
									<p data-slot="history-loading">{copy.history.loading}</p>
								{:else if view.history.state === 'partial'}
									<p data-slot="history-partial">{copy.history.partial}</p>
								{:else if view.history.state === 'error'}
									<p data-slot="history-error">{copy.history.error}</p>
									<Button variant="outline" size="sm" onclick={() => view.history.retry()}>
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

	.reliability-window {
		margin: 0;
		flex-basis: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--muted-foreground);
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
</style>
