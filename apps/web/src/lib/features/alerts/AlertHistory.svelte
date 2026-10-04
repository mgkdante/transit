<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { getLocale, getLocalizeHref, type Locale } from '$lib/i18n';
	import {
		getAlertArchiveIndex,
		getAlertArchiveRange,
		getAlertHistory,
	} from '$lib/v1/repositories/historic';
	import type { AlertArchiveEntry } from '$lib/v1/schemas/alert_archive';
	import type { AlertHistory, AlertHistoryEntry } from '$lib/v1/schemas/alert_history';
	import type { SeverityCode } from '$lib/v1/schemas/types';
	import { createResource, type Resource } from '$lib/v1/resource.svelte';
	import {
		availabilityFromAlertIndex,
		datesForAvailability,
		type HistoryAvailability,
		type HistoryCorrection,
	} from '$lib/v1/history/selection';
	import { formatDateKey, formatUtc } from '$lib/utils/time';
	import { fromSearchParams, type AlertAffects, type DateWindow } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import {
		ArticleControlDisclosure,
		createRailDisclosureController,
		ResourceBoundary,
	} from '$lib/components/surface';
	import {
		ArticleHeader,
		ArticleSectionStack,
		DetailShell,
		type ArticleMetaEntry,
	} from '$lib/components/layout';
	import { StateNotice } from '$lib/components/edge';
	import {
		CollapsibleSection,
		TocNav,
		reconcileActiveToc,
		revealTocTarget,
		type TocEntry,
	} from '$lib/components/shared';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import type { SurfaceRailContext } from '$lib/components/surface/SurfaceRail.svelte';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { alertDisplayText } from '$lib/v1/alertDisplay';
	import { causeLabel, effectLabel } from '$lib/v1/gtfsAlertLabels';
	import { foldSearchText } from '$lib/search/normalize';

	import {
		sortNewestFirst,
		filterAlertLog,
		buildAlertRow,
		summarizeAlertBreakdown,
		toBreakdownRows,
		medianOf,
		type BreakdownKind,
		type AlertRowVM,
	} from './selectors/alertLog';
	import { buildLineOptions, buildStopOptions } from './selectors/entityOptions';
	import AlertFilters from './sections/AlertFilters.svelte';
	import AlertLog from './sections/AlertLog.svelte';
	import AlertBreakdown from './sections/AlertBreakdown.svelte';
	import { alertHistoryCopy } from './alerts.copy';
	import {
		currentAlertWindow,
		resolveAlertHistoryRange,
		sameHistoryWindow,
	} from './data/historySelection';

	const localizeHref = getLocalizeHref();

	const locale: Locale = getLocale();
	const t = $derived(alertHistoryCopy[locale]);
	const provider = $derived(page.data?.provider);
	const alertsAvailable = $derived(
		!(provider?.inputs.i3_alerts === false && provider.inputs.service_alerts === false),
	);
	const officialAlertsUrl = $derived(provider?.alert_links[locale]);
	const railDisclosures = createRailDisclosureController({
		filters: 'alerts-filters',
		toc: 'alerts-toc',
	});

	const history = createResource((signal) => getAlertHistory({ signal }), {
		enabled: () => alertsAvailable,
	});
	const alertArchiveIndex = createResource((signal) => getAlertArchiveIndex({ signal }), {
		enabled: () => alertsAvailable,
	});

	const VISIBLE_CAP = 25;
	let expanded = $state(false);

	const rawHistoryFrom = page.url.searchParams.get('from');
	const rawHistoryTo = page.url.searchParams.get('to');
	const hasExplicitHistoryWindow = rawHistoryFrom !== null || rawHistoryTo !== null;
	const seed = fromSearchParams(page.url.searchParams);
	let affects = $state<'all' | AlertAffects>(seed.alertAffects ?? 'all');
	let severity = $state<'all' | SeverityCode>(seed.alertSeverity ?? 'all');
	let route = $state<string | null>([...seed.routes][0] ?? null);
	let stop = $state<string | null>([...seed.stops][0] ?? null);
	let pickedWindow = $state<DateWindow | undefined>();
	let defaultWindow = $state<DateWindow | null>(null);
	let historyCorrection = $state<HistoryCorrection | null>(null);
	let windowSettled = $state(false);
	$effect(() => {
		if (windowSettled) return;
		if (!history.settled || !alertArchiveIndex.settled) return;
		if (history.error != null || alertArchiveIndex.error != null || history.data == null) return;

		defaultWindow = currentAlertWindow(history.data, alertArchiveIndex.data);
		const resolved = resolveAlertHistoryRange(
			history.data,
			alertArchiveIndex.data,
			rawHistoryFrom,
			rawHistoryTo,
		);
		pickedWindow = resolved.selection ?? undefined;
		historyCorrection = resolved.correction;
		windowSettled = true;
	});

	const historyAvailability = $derived.by<HistoryAvailability>(() => {
		const indexed = availabilityFromAlertIndex(alertArchiveIndex.data);
		if (indexed != null) return indexed;
		if (defaultWindow != null) {
			return {
				kind: 'continuous',
				firstDate: defaultWindow.from,
				lastDate: defaultWindow.to,
				gaps: [],
			};
		}
		return { kind: 'empty' };
	});
	const availableDates = $derived<readonly string[]>(datesForAvailability(historyAvailability));

	function windowKey(window: DateWindow): string {
		return `${window.from}:${window.to}`;
	}

	const RANGE_CHANGE_DEBOUNCE_MS = 120;
	let archiveLoadWindow = $state<DateWindow | null>(null);
	let archiveLoadPrimed = false;
	$effect(() => {
		const selection = pickedWindow;
		if (!windowSettled || alertArchiveIndex.data == null || selection == null) {
			archiveLoadWindow = null;
			return;
		}

		const next = { from: selection.from, to: selection.to };
		if (!archiveLoadPrimed) {
			archiveLoadPrimed = true;
			archiveLoadWindow = next;
			return;
		}
		if (
			sameHistoryWindow(
				untrack(() => archiveLoadWindow),
				next,
			)
		)
			return;

		archiveLoadWindow = null;
		const timer = window.setTimeout(() => {
			archiveLoadWindow = next;
		}, RANGE_CHANGE_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	});

	interface SelectedAlertRange {
		readonly window: DateWindow;
		readonly entries: readonly AlertArchiveEntry[];
		readonly generated_utc?: AlertHistory['generated_utc'] | null;
	}
	let rangeAttemptKey: string | null = null;
	const archiveRange = createResource<SelectedAlertRange | null>(async (signal) => {
		const index = alertArchiveIndex.data;
		const selection = archiveLoadWindow;
		if (!windowSettled || index == null || selection == null) {
			rangeAttemptKey = null;
			return null;
		}

		const requestedWindow = { from: selection.from, to: selection.to };
		rangeAttemptKey = windowKey(requestedWindow);
		const rangeEntries = await getAlertArchiveRange(index, requestedWindow, { signal });
		return {
			window: requestedWindow,
			entries: rangeEntries,
			generated_utc: history.data?.generated_utc ?? null,
		};
	});

	const selectedRangeData = $derived.by<SelectedAlertRange | null>(() => {
		if (alertArchiveIndex.data == null || pickedWindow == null) return null;
		const value = archiveRange.data;
		return value != null && sameHistoryWindow(value.window, pickedWindow) ? value : null;
	});
	const catalogLoading = $derived(
		history.loading ||
			alertArchiveIndex.loading ||
			!history.settled ||
			!alertArchiveIndex.settled ||
			!windowSettled,
	);
	const useCompatibilityPayload = $derived.by(() => {
		if (history.data == null || history.error != null) return false;
		if (alertArchiveIndex.error != null) return false;
		if (alertArchiveIndex.settled && alertArchiveIndex.data == null) return true;
		if ((history.data.alerts?.length ?? 0) === 0) return false;
		if (hasExplicitHistoryWindow) return false;
		if (!alertArchiveIndex.settled) return true;
		if (
			!windowSettled ||
			pickedWindow == null ||
			defaultWindow == null ||
			!sameHistoryWindow(pickedWindow, defaultWindow)
		) {
			return false;
		}
		const rangeError = archiveRange.error;
		if (rangeAttemptKey === windowKey(pickedWindow) && rangeError != null) return false;
		return selectedRangeData == null;
	});
	const previewingArchive = $derived(
		useCompatibilityPayload &&
			history.data?.truncated === true &&
			alertArchiveIndex.data != null &&
			selectedRangeData == null,
	);
	const displayError = $derived.by<Error | null>(() => {
		const rangeError = archiveRange.error;
		if (history.error != null) return history.error;
		if (alertArchiveIndex.error != null) return alertArchiveIndex.error;
		if (catalogLoading || alertArchiveIndex.data == null || pickedWindow == null) return null;
		return rangeAttemptKey === windowKey(pickedWindow) ? rangeError : null;
	});
	const displayLoading = $derived.by(() => {
		if (displayError != null) return false;
		if (useCompatibilityPayload) return false;
		if (catalogLoading) return true;
		if (alertArchiveIndex.data == null || pickedWindow == null) return false;
		const matchingRange = selectedRangeData;
		return (
			archiveRange.loading ||
			!archiveRange.settled ||
			rangeAttemptKey !== windowKey(pickedWindow) ||
			matchingRange == null
		);
	});

	interface AlertHistoryView {
		readonly entries: readonly AlertHistoryEntry[];
	}
	const displayData = $derived.by<AlertHistoryView | null>(() => {
		if (displayError != null || history.data == null) return null;
		if (useCompatibilityPayload) return { entries: history.data.alerts ?? [] };
		if (displayLoading) return null;
		if (alertArchiveIndex.data == null) return { entries: history.data.alerts ?? [] };
		if (pickedWindow == null) return { entries: [] };
		return selectedRangeData == null ? null : { entries: selectedRangeData.entries };
	});
	const displayResource: Resource<AlertHistoryView> = {
		get data() {
			return displayData;
		},
		get error() {
			return displayError;
		},
		get loading() {
			return displayLoading;
		},
		get settled() {
			return !displayLoading;
		},
		reload() {
			if (
				history.error != null ||
				alertArchiveIndex.error != null ||
				!history.settled ||
				!alertArchiveIndex.settled
			) {
				history.reload();
				alertArchiveIndex.reload();
				return;
			}
			if (alertArchiveIndex.data != null && pickedWindow != null) archiveRange.reload();
			else {
				history.reload();
				alertArchiveIndex.reload();
			}
		},
	};

	const entries = $derived<readonly AlertHistoryEntry[]>(displayData?.entries ?? []);
	const sorted = $derived(sortNewestFirst(entries));
	const historyCoverageText = $derived.by<string | null>(() => {
		if (historyAvailability.kind !== 'continuous') return null;
		return t.filters.history.coverage(
			formatDateKey(historyAvailability.firstDate, locale),
			formatDateKey(historyAvailability.lastDate, locale),
		);
	});
	const historySelectionText = $derived(
		pickedWindow == null
			? null
			: t.filters.history.selection(
					formatDateKey(pickedWindow.from, locale),
					formatDateKey(pickedWindow.to, locale),
				),
	);
	const historyAnnouncement = $derived(
		historyCorrection == null ? null : t.filters.history.correction[historyCorrection.reason],
	);

	function selectHistoryWindow(next: DateWindow | undefined): void {
		historyCorrection = null;
		if (!windowSettled) return;
		if (next == null) {
			pickedWindow = defaultWindow ?? undefined;
			return;
		}
		if (history.data == null) return;
		const resolved = resolveAlertHistoryRange(
			history.data,
			alertArchiveIndex.data,
			next.from,
			next.to,
		);
		pickedWindow = resolved.selection ?? defaultWindow ?? undefined;
		historyCorrection = resolved.correction;
	}

	$effect(() => {
		if (!windowSettled) return;
		const mirroredWindow =
			pickedWindow != null && !sameHistoryWindow(pickedWindow, defaultWindow) ? pickedWindow : null;
		mirrorSearchParams({
			affects: affects === 'all' ? null : affects,
			severity: severity === 'all' ? null : severity,
			route: route,
			stop: stop,
			from: mirroredWindow?.from ?? null,
			to: mirroredWindow?.to ?? null,
		});
	});

	function headline(entry: AlertHistoryEntry) {
		return alertDisplayText(entry, locale);
	}
	function windowTime(iso: string | null | undefined): string | null {
		if (iso == null) return null;
		const text = formatUtc(iso, locale);
		return text === '·' ? null : text;
	}

	const filtered = $derived<readonly AlertHistoryEntry[]>(
		filterAlertLog(sorted, {
			window: pickedWindow ?? null,
			affects: affects === 'all' ? null : affects,
			severity: severity === 'all' ? null : severity,
			route,
			stop,
		}),
	);
	const readyMatchCount = $derived(displayData == null ? null : filtered.length);
	const hasMatches = $derived(filtered.length > 0);
	const overflow = $derived(Math.max(0, filtered.length - VISIBLE_CAP));
	const visibleEntries = $derived(
		expanded || overflow === 0 ? filtered : filtered.slice(0, VISIBLE_CAP),
	);
	const visibleRows = $derived<readonly AlertRowVM[]>(
		visibleEntries.map((e) => buildAlertRow(e, { locale, headline, windowTime })),
	);

	const lineOptions = $derived(buildLineOptions(sorted, foldSearchText));
	const stopOptions = $derived(buildStopOptions(sorted, foldSearchText));

	const filtersActive = $derived(
		affects !== 'all' ||
			severity !== 'all' ||
			route != null ||
			stop != null ||
			!sameHistoryWindow(pickedWindow, defaultWindow),
	);
	function clearFilters(): void {
		affects = 'all';
		severity = 'all';
		route = null;
		stop = null;
		pickedWindow = defaultWindow ?? undefined;
		historyCorrection = null;
	}

	const headlineCount = $derived(filtered.length);
	const headlineMedian = $derived.by<number | null>(() => {
		const durations = filtered
			.map((e) => e.duration_min)
			.filter((d): d is number => d != null && Number.isFinite(d));
		return medianOf(durations);
	});
	const headlineSublabel = $derived(
		headlineMedian != null ? t.headline.median(Math.round(headlineMedian)) : undefined,
	);

	const generatedUtc = $derived(history.data?.generated_utc ?? null);

	const truncated = $derived(
		useCompatibilityPayload && history.data?.truncated === true && !previewingArchive,
	);
	const totalInWindow = $derived(
		useCompatibilityPayload ? (history.data?.total_in_window ?? null) : null,
	);

	const SEVERITY_WORD_SET = new Set<string>(['critical', 'high', 'watch']);
	function bucketTitle(key: string, kind: BreakdownKind): string {
		if (kind === 'severity') {
			return SEVERITY_WORD_SET.has(key) ? t.severity[key as SeverityCode] : key;
		}
		if (key.trim().toLowerCase() === 'unknown') return t.breakdown.unspecified;
		const resolved = kind === 'cause' ? causeLabel(key, locale) : effectLabel(key, locale);
		return resolved ?? t.breakdown.unspecified;
	}
	const breakdownResolvers = $derived({
		bucketTitle,
		countDisplay: (n: number) => t.breakdown.buckets(n),
		medianSubtitle: (min: number) => t.breakdown.median(min),
	});
	const breakdownPublished = $derived(
		alertArchiveIndex.data != null
			? entries.length > 0
			: history.data?.breakdown != null &&
					((history.data.breakdown.by_cause?.length ?? 0) > 0 ||
						(history.data.breakdown.by_effect?.length ?? 0) > 0 ||
						(history.data.breakdown.by_severity?.length ?? 0) > 0),
	);
	const filteredBreakdown = $derived(summarizeAlertBreakdown(filtered));
	const causeRows = $derived(
		toBreakdownRows(filteredBreakdown.by_cause, 'cause', breakdownResolvers),
	);
	const effectRows = $derived(
		toBreakdownRows(filteredBreakdown.by_effect, 'effect', breakdownResolvers),
	);
	const severityRows = $derived(
		toBreakdownRows(filteredBreakdown.by_severity, 'severity', breakdownResolvers),
	);
	const hasBreakdown = $derived(
		causeRows.length > 0 || effectRows.length > 0 || severityRows.length > 0,
	);
	const archiveReady = $derived(displayData != null && entries.length > 0);
	const controlsReady = $derived(
		windowSettled && (availableDates.length > 0 || entries.length > 0),
	);
	const sectionDefs = $derived([
		{
			id: 'alerts-window',
			sectionKey: 'alerts-card-window',
			number: 1,
			title: t.cards.window.title,
			subtitle: t.cards.window.subtitle,
			present: archiveReady,
		},
		{
			id: 'alerts-breakdown',
			sectionKey: 'alerts-card-breakdown',
			number: 2,
			title: t.cards.breakdown.title,
			subtitle: t.cards.breakdown.subtitle,
			present: archiveReady && breakdownPublished,
		},
		{
			id: 'alerts-log',
			sectionKey: 'alerts-card-log',
			number: 3,
			title: t.cards.log.title,
			subtitle: t.cards.log.subtitle,
			present: archiveReady,
		},
	]);
	const tocEntries = $derived<TocEntry[]>(
		sectionDefs
			.filter((section) => section.present)
			.map((section) => ({
				id: section.id,
				title: section.title,
				level: 2,
				badge: { kind: 'number' as const, value: section.number },
				children: [],
			})),
	);
	const openableAnchors = $derived(new Set(tocEntries.map((entry) => entry.id)));
	const articleMeta = $derived.by((): readonly ArticleMetaEntry[] => {
		const meta: ArticleMetaEntry[] = [];
		if (generatedUtc) {
			meta.push({
				text: formatUtc(generatedUtc, locale),
				datetime: generatedUtc,
				label: t.asOf,
			});
		}
		if (displayData != null) {
			meta.push(t.article.matches(filtered.length));
			meta.push(t.article.sections(tocEntries.length));
		}
		return meta;
	});

	let activeId = $state('');
	let cardOpenSignals = $state<Record<string, number>>({});
	let navigationGeneration = 0;
	let previousTocIds: string[] = [];
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
	$effect(() => {
		const next = tocEntries.map((entry) => entry.id);
		activeId = reconcileActiveToc(activeId, previousTocIds, next);
		previousTocIds = next;
	});

	const uid = $props.id();
	const logId = `alert-history-log-${uid}`;
</script>

{#snippet headlineInfo()}
	<MetricInfo metricKey="alertDuration" {locale} name={t.headline.label} side="bottom" />
{/snippet}

{#snippet causeInfo()}
	<MetricInfo metricKey="alertCause" {locale} name={t.breakdown.byCause} side="bottom" />
{/snippet}
{#snippet effectInfo()}
	<MetricInfo metricKey="alertEffect" {locale} name={t.breakdown.byEffect} side="bottom" />
{/snippet}
{#snippet severityInfo()}
	<MetricInfo metricKey="alertSeverity" {locale} name={t.breakdown.bySeverity} side="bottom" />
{/snippet}
{#snippet reachInfo()}
	<MetricInfo metricKey="alertReach" {locale} name={t.meta.routes} side="bottom" />
{/snippet}

<p
	class="sr-only"
	data-slot="history-page-announcement"
	role="status"
	aria-live="polite"
	aria-atomic="true"
>
	{historyAnnouncement ?? ''}
</p>

<DetailShell
	class="alert-history-detail"
	bind:activeId
	{tocEntries}
	combinedRailConfig={controlsReady
		? {
				label: t.rail.label,
				summary: readyMatchCount == null ? undefined : t.filters.pillSummary(readyMatchCount),
				openAria: t.rail.open,
				closeAria: t.rail.close,
			}
		: undefined}
>
	{#snippet articleHeader()}
		<ArticleHeader
			watermark={t.article.watermark}
			category={t.kicker}
			title={t.heading}
			tags={t.article.tags}
			tagsAria={t.article.tagsAria}
			backHref={localizeHref('/', locale)}
			backLabel={t.article.back}
			meta={articleMeta}
			metaPending={alertsAvailable && (displayResource.loading || !displayResource.settled)}
			titleId="alerts-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet combinedRail({ closeSheet }: SurfaceRailContext)}
		<ArticleControlDisclosure
			title={t.filters.railLabel}
			bind:open={
				() => railDisclosures.isOpen('filters'), (next) => railDisclosures.set('filters', next)
			}
		>
			<AlertFilters
				bind:affects
				bind:severity
				bind:route
				window={pickedWindow}
				bind:stop
				{lineOptions}
				{stopOptions}
				{availableDates}
				{filtersActive}
				matchCount={readyMatchCount}
				copy={t}
				{locale}
				{historyCoverageText}
				{historySelectionText}
				{historyAnnouncement}
				onWindowChange={selectHistoryWindow}
				onClear={clearFilters}
			/>
		</ArticleControlDisclosure>
		{#if tocEntries.length > 0}
			<div class="alert-history-rail-toc" data-slot="section-toc">
				<TocNav
					entries={tocEntries}
					{activeId}
					heading={t.rail.toc}
					counterPrefix={t.rail.counterPrefix}
					bind:open={
						() => railDisclosures.isOpen('toc'), (next) => railDisclosures.set('toc', next)
					}
					onNavigate={(id) => {
						closeSheet();
						void navigate(id);
					}}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet center()}
		{#if !alertsAvailable}
			<StateNotice
				title={t.unavailable.title}
				body={t.unavailable.body(provider?.labels[locale].operator ?? '')}
				presentation="silo"
				role="status"
			>
				{#snippet action()}
					{#if officialAlertsUrl}<a href={officialAlertsUrl}>{t.unavailable.link}</a>{/if}
				{/snippet}
			</StateNotice>
		{:else}
			<ResourceBoundary
				resource={displayResource}
				lang={locale}
				isEmpty={(d: AlertHistoryView) => d.entries.length === 0}
				emptyVariant="empty-avis"
			>
				<ArticleSectionStack data-slot="alert-sections">
					{#if previewingArchive}
						<p class="alert-history-preview" data-slot="alert-archive-preview" role="status">
							{t.archivePreviewNote(entries.length)}
						</p>
					{/if}
					{#each sectionDefs as section (section.id)}
						{#if section.present}
							<CollapsibleSection
								title={section.title}
								subtitle={section.subtitle}
								headerVariant="article-summary"
								anchor={section.id}
								sectionKey={section.sectionKey}
								index={section.number - 1}
								open={true}
								closeSignal={quietModeStore.closeSignal}
								openSignal={cardOpenSignal(section.id)}
								bulkCollapsed={quietModeStore.enabled}
							>
								{#if section.id === 'alerts-window'}
									<div class="alert-history-headline" data-slot="alert-headline">
										<ExplainedMetricCard
											label={t.headline.label}
											value={t.headline.value(headlineCount)}
											explanation={t.headline.explanation}
											sublabel={headlineSublabel}
											info={headlineInfo}
											{locale}
										/>
									</div>
								{:else if section.id === 'alerts-breakdown'}
									<AlertBreakdown
										{causeRows}
										{effectRows}
										{severityRows}
										{hasBreakdown}
										copy={t}
										{locale}
										{causeInfo}
										{effectInfo}
										{severityInfo}
									/>
								{:else}
									<div class="alert-history-content" data-slot="alert-log-content">
										<div class="alert-history-head">
											<SectionHeading level={3} overline={t.logSection} explainer={reachInfo} />
											<span class="alert-history-count" data-slot="alert-count">
												{t.count(visibleRows.length, filtered.length)}
											</span>
										</div>

										{#if truncated && totalInWindow != null}
											<p class="alert-history-truncated" data-slot="alert-truncated">
												{t.truncatedNote(entries.length, totalInWindow)}
											</p>
										{/if}

										{#if !hasMatches}
											<StateNotice
												title={t.filters.noMatch}
												presentation="silo"
												role="status"
												ariaLive="polite"
												data-slot="alert-no-match"
											/>
										{:else}
											<AlertLog
												rows={visibleRows}
												total={filtered.length}
												{expanded}
												{overflow}
												{logId}
												copy={t}
												{locale}
												onToggle={() => (expanded = !expanded)}
											/>
										{/if}
									</div>
								{/if}
							</CollapsibleSection>
						{/if}
					{/each}
				</ArticleSectionStack>
			</ResourceBoundary>
		{/if}
	{/snippet}
</DetailShell>

<style>
	.alert-history-rail-toc {
		margin-top: 0.25rem;
	}
	.alert-history-headline {
		margin-bottom: 0.25rem;
	}
	.alert-history-preview {
		margin: 0;
		padding: 0.75rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--secondary-foreground);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
		border-radius: var(--radius-sm);
	}
	.alert-history-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	.alert-history-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.25rem 1rem;
	}
	.alert-history-count {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.alert-history-truncated {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
