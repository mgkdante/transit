<script lang="ts">
	import type { Manifest } from '#lib/v1/schemas/index.ts';
	import { createRecordStamp } from '#lib/v1/recordStamp.svelte.ts';
	import ArticleHeader from '#lib/components/layout/TransitArticleHeader.svelte';
	import { transitDisplay } from '#lib/site/transitDisplayContext.ts';
	import { createReliabilityViewState } from '#lib/reliability/viewState.svelte.ts';
	import { createArticleNavigation } from '#lib/site/articleNavigation.svelte.ts';
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { getLocale, getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import { routeFor, type SurfaceKind } from '#lib/nav/index.ts';
	import {
		fromSearchParams,
		toSearchParams,
		emptyFilterState,
		type WorstN,
	} from '#lib/filters/index.ts';
	import { availabilityFromPointCollectionIndex } from '#lib/v1/history/selection.ts';
	import { createHistoryCorrectionPresentation } from '#lib/v1/history/datePresentation.svelte.ts';
	import {
		createHistoryDateResource,
		historyDateRequestFromSearchParams,
	} from '#lib/v1/history/dateResource.svelte.ts';
	import {
		getHotspots,
		getHotspotsHistoryDay,
		getHotspotsHistoryIndex,
	} from '#lib/v1/repositories/historic.ts';
	import type { HistoricCollectionIndex, HotspotEntry, Hotspots } from '#lib/v1/schemas/index.ts';
	import type { ChartDatumPopoverModel } from '#lib/components/dataviz/chart/index.ts';
	import {
		ArticleControlStack,
		HistoryNavigator,
		ResourceBoundary,
		GrainPicker,
		type GrainSegment,
	} from '#lib/components/surface/index.ts';
	import { ArticleSectionStack, type ArticleMetaEntry } from '#lib/components/layout/index.ts';
	import { DetailFrame, SurfaceRail, type SurfaceRailContext } from '@yesid/ui/layout';
	import { AbsentValue } from '#lib/components/edge/index.ts';
	import { CollapsibleSection, TocNav } from '@yesid/ui/brand';
	import { TypedInformationCard } from '#lib/components/shared/index.ts';
	import SectionsToggle from '#lib/components/shared/SectionsToggle.svelte';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import { fmtCount, fmtDelayMin, fmtPct } from '#lib/utils/index.ts';
	import { formatDateKey } from '#lib/utils/time.ts';

	import {
		ladderGrains,
		HOTSPOT_GRAINS,
		type HotspotGrainKey,
	} from '#lib/reliability/ladderGrains.ts';
	import {
		worstNCap,
		DEFAULT_WORST_N,
		worstNSegments as buildWorstNSegments,
		SMALLEST_WORST_N,
	} from '#lib/reliability/ladderCap.ts';
	import { selectHotspotLadder, type HotspotPopoverEvidence } from './selectors/hotspotLadder';
	import HotspotSection from './sections/HotspotSection.svelte';
	import { copy as COPY } from './hotspots.copy';

	let { manifest = null }: { manifest?: Manifest | null } = $props();
	const display = transitDisplay();
	const localizeHref = getLocalizeHref();

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	const hotspots = createHistoryDateResource<HistoricCollectionIndex, Hotspots>(
		{
			loadIndex: (signal) => getHotspotsHistoryIndex({ signal }),
			availability: (index) => availabilityFromPointCollectionIndex(index),
			loadCurrent: (signal) => getHotspots({ signal }),
			loadDate: (date, index, signal) => getHotspotsHistoryDay(date, index, { signal }),
		},
		{
			initialRequest: historyDateRequestFromSearchParams(new URLSearchParams(page.url.search)),
		},
	);
	onDestroy(() => hotspots.destroy());
	const generatedUtc = $derived(hotspots.data?.generated_utc ?? null);
	const grains = $derived(ladderGrains(hotspots.data?.by_grain, HOTSPOT_GRAINS));
	const ladders = $derived(grains.ladders);
	const present = $derived(grains.present);
	const availableDates = $derived(hotspots.availableDates);
	const dateOptions = $derived(availableDates.map((date) => ({ date })));
	const hasHistoryNavigator = $derived(availableDates.length > 0);
	const historyCoverageText = $derived(
		availableDates.length === 0
			? null
			: t.history.coverage(
					formatDateKey(availableDates[0], locale),
					formatDateKey(availableDates[availableDates.length - 1], locale),
				),
	);
	const historySelectionText = $derived(
		hotspots.selectedDate == null
			? null
			: t.history.selection(formatDateKey(hotspots.selectedDate, locale)),
	);
	const historyCorrection = createHistoryCorrectionPresentation(
		hotspots,
		() => t.history.correction,
	);
	function selectHistoryDate(date: string | undefined): void {
		historyCorrection.clear();
		hotspots.setRequest({
			hasDate: date !== undefined,
			rawDate: date ?? null,
		});
	}

	const grainLabels = $derived({
		day: t.grain.day,
		week: t.grain.week,
		month: t.grain.month,
		shift: { label: t.grain.shift, compactLabel: t.grain.shiftCompact },
	});
	const view = createReliabilityViewState({
		snapshot: () => hotspots.data,
		grains: { keys: HOTSPOT_GRAINS, labels: () => grainLabels, present: () => present },
		locale: () => locale,
		url: () => {
			const state = emptyFilterState();
			if (worstN !== DEFAULT_WORST_N) state.worstN = worstN;
			const date =
				hotspots.request.hasDate && hotspots.resolved == null
					? hotspots.request.rawDate
					: hotspots.canonicalDate;
			return { date, n: toSearchParams(state).get('n') };
		},
	});
	const grainKey = $derived<HotspotGrainKey>(view.grain);
	const showGrainPicker = $derived(present.size > 1);

	let worstN = $state<WorstN>(
		fromSearchParams(new URLSearchParams(page.url.search)).worstN ?? DEFAULT_WORST_N,
	);
	const cap = $derived(worstNCap(worstN));
	const worstSegments = $derived<GrainSegment<WorstN>[]>(buildWorstNSegments(t.worstN.all));

	function navKindFor(type: string): SurfaceKind | null {
		const kind = type.toLowerCase();
		if (kind === 'route' || kind === 'line') return 'line';
		if (kind === 'stop') return 'stop';
		return null;
	}
	function hrefFor(entry: HotspotEntry): string | null {
		const kind = navKindFor(entry.type);
		return kind ? localizeHref(routeFor({ kind, id: entry.id }), locale) : null;
	}
	function typeTag(type: string): string | null {
		const kind = navKindFor(type);
		if (kind === 'line') return t.type.route;
		if (kind === 'stop') return t.type.stop;
		return null;
	}
	function tapPopoverFor(
		entry: HotspotEntry,
		href: string | null,
		evidence: HotspotPopoverEvidence,
	): ChartDatumPopoverModel {
		const heading = nameFor(entry);
		const rows: Array<{ label: string; value: string }> = [];
		const severe = fmtPct(entry.severe_pct, { locale, suffix: t.units.pct });
		if (severe != null) rows.push({ label: t.ladder.severeRateLabel, value: severe });
		if (evidence.wilsonLo != null && evidence.wilsonHi != null) {
			const lower = fmtPct(evidence.wilsonLo, { locale, suffix: t.units.pct });
			const upper = fmtPct(evidence.wilsonHi, { locale, suffix: t.units.pct });
			if (lower != null && upper != null) {
				rows.push({ label: t.ladder.ci, value: `${lower}–${upper}` });
			}
		}
		const averageDelay = fmtDelayMin(entry.avg_delay_min, {
			rounding: 'auto',
			locale,
			suffix: t.units.min,
		});
		if (averageDelay != null) {
			rows.push({ label: t.chart.popover.averageDelay, value: averageDelay });
		}
		const readings = fmtCount(entry.observation_count, { locale });
		if (readings != null) rows.push({ label: t.chart.popover.readings, value: readings });

		const kind = navKindFor(entry.type);
		const actionLabel =
			kind === 'line'
				? t.chart.popover.viewLine
				: kind === 'stop'
					? t.chart.popover.viewStop
					: null;
		return {
			key: `${entry.type}-${entry.id}`,
			heading,
			meta: typeTag(entry.type) ?? entry.type,
			rows,
			...(actionLabel && href ? { action: { href, label: actionLabel } } : {}),
		};
	}
	function ladderNote(entry: HotspotEntry): string {
		const parts: string[] = [];
		if (entry.severe_pct != null) {
			parts.push(`${t.note.severe} ${Math.round(entry.severe_pct)}${t.units.pct}`);
		}
		if (entry.avg_delay_min != null) {
			parts.push(`${t.note.avg} ${Math.round(entry.avg_delay_min * 10) / 10}${t.units.min}`);
		}
		if (entry.observation_count != null) parts.push(`${t.note.samples}=${entry.observation_count}`);
		return parts.join(' · ');
	}

	const activeLadder = $derived(ladders.get(grainKey));
	const nameFor = (entry: HotspotEntry, spoken = false): string =>
		navKindFor(entry.type) === 'line'
			? display.lineName(entry.id, entry.name)[spoken ? 'spoken' : 'label']
			: (entry.name ?? t.unnamed(entry.id));
	const topHotspot = $derived<HotspotEntry | null>(activeLadder?.entries?.[0] ?? null);
	const topHotspotName = $derived(topHotspot ? nameFor(topHotspot) : null);
	const verdictParts = $derived.by(() => {
		if (!topHotspot || topHotspotName == null) {
			const before = hotspots.mode === 'history' ? t.history.retainedVerdictNone : t.verdict.none;
			return { before, after: '' };
		}
		const severe = fmtPct(topHotspot.severe_pct, { rounding: 'auto', locale, suffix: t.units.pct });
		return { before: t.verdict.beforeName(), after: t.verdict.afterName(severe) };
	});
	const topHotspotHref = $derived(topHotspot ? hrefFor(topHotspot) : null);

	function ladderFor(kind: 'route' | 'stop', total: number | null | undefined) {
		const entries = (activeLadder?.entries ?? []).filter((entry) => entry.type === kind);
		const result = selectHotspotLadder(entries, cap, locale, {
			directory: display.directory,
			title: t.ladder.heading,
			rowLabel: kind === 'route' ? t.type.route : t.type.stop,
			xLabel: t.ladder.severeRateLabel,
			unit: t.units.pct,
			ciLabel: t.ladder.ci,
			note: ladderNote,
			unnamed: t.unnamed,
			href: hrefFor,
			tapPopover: tapPopoverFor,
		});
		return { ...result, total: total ?? result.total };
	}
	const routeLadder = $derived(ladderFor('route', activeLadder?.total_ranked_routes));
	const stopLadder = $derived(ladderFor('stop', activeLadder?.total_ranked_stops));

	interface TrayRow {
		readonly key: string;
		readonly title: string;
		readonly type: string;
		readonly id: string;
		readonly observationCount: number | null;
		readonly href: string | null;
		readonly ariaLabel: string;
	}
	function trayFor(kind: 'route' | 'stop'): TrayRow[] {
		return (activeLadder?.tray ?? [])
			.filter((entry) => entry.type === kind)
			.map((entry) => {
				const title = nameFor(entry);
				return {
					key: `${entry.type}-${entry.id}`,
					title,
					type: typeTag(entry.type) ?? entry.type,
					id: entry.id,
					observationCount: entry.observation_count ?? null,
					href: hrefFor(entry),
					ariaLabel: nameFor(entry, true),
				};
			});
	}
	const routeTray = $derived(trayFor('route'));
	const stopTray = $derived(trayFor('stop'));
	const windowCaption = $derived(
		hotspots.mode === 'history' && hotspots.selectedDate != null
			? t.history.retainedWindow(formatDateKey(hotspots.selectedDate, locale))
			: t.window[grainKey],
	);
	const controlsSummary = $derived(
		view.segments.find((segment) => segment.key === grainKey)?.label ?? '',
	);
	const isEmpty = $derived(present.size === 0);
	const showCombinedRail = $derived(
		(hotspots.data != null && present.size > 0) ||
			(hotspots.mode === 'history' && hasHistoryNavigator),
	);
	const showWorstN = $derived(
		routeLadder.total > SMALLEST_WORST_N || stopLadder.total > SMALLEST_WORST_N,
	);

	const sectionDefs = $derived([
		{
			id: 'hotspots-top',
			number: 1,
			title: t.cards.top.title,
			subtitle: hotspots.mode === 'history' ? t.history.retainedTopSubtitle : t.cards.top.subtitle,
			present: hotspots.data != null && !isEmpty,
		},
		{
			id: 'hotspots-lines',
			number: 2,
			title: t.cards.lines.title,
			subtitle: t.cards.lines.subtitle,
			present: routeLadder.shown > 0 || routeTray.length > 0,
		},
		{
			id: 'hotspots-stops',
			number: 3,
			title: t.cards.stops.title,
			subtitle: t.cards.stops.subtitle,
			present: stopLadder.shown > 0 || stopTray.length > 0,
		},
	]);
	const navigation = createArticleNavigation(() => sectionDefs, {
		behavior: () => ($prefersReducedMotion ? 'auto' : 'smooth'),
	});
	const tocEntries = $derived(navigation.entries);
	const { navigate } = navigation;
	const record = createRecordStamp(
		() => manifest,
		() => generatedUtc,
	);
	const articleMeta = $derived.by((): readonly ArticleMetaEntry[] => {
		const entries: ArticleMetaEntry[] = [];
		const stamp = record.meta(locale);
		if (stamp) entries.push(stamp);
		if (tocEntries.length > 0) entries.push(t.article.sections(tocEntries.length));
		return entries;
	});
</script>

{#snippet combinedRail({ closeSheet }: SurfaceRailContext)}
	{#snippet historyControls()}
		{#key historyCorrection.revision}
			<HistoryNavigator
				mode="date"
				date={hotspots.selectedDate ?? undefined}
				{dateOptions}
				previousDate={hotspots.previousDate}
				nextDate={hotspots.nextDate}
				coverageText={historyCoverageText}
				selectionText={historySelectionText}
				announcement={historyCorrection.announcement}
				liveAnnouncement={false}
				{locale}
				labels={t.history.navigator}
				onDateChange={selectHistoryDate}
			/>
		{/key}
	{/snippet}
	{#snippet primaryControls()}
		<GrainPicker
			segments={view.segments}
			value={view.grain}
			onSelect={view.selectGrain}
			label={t.grain.label}
			variant="time-grid"
		/>
	{/snippet}
	{#snippet secondaryControls()}
		<GrainPicker segments={worstSegments} bind:value={worstN} label={t.worstN.label} />
	{/snippet}
	{#snippet windowCaptionControl()}
		<p class="hotspots-window" data-slot="active-window" aria-live="polite">
			{windowCaption}
		</p>
	{/snippet}

	<CollapsibleSection independent title={t.rail.controls}>
		<ArticleControlStack
			history={hasHistoryNavigator ? historyControls : undefined}
			primary={showGrainPicker ? primaryControls : undefined}
			secondary={showWorstN ? secondaryControls : undefined}
			caption={windowCaptionControl}
		/>
	</CollapsibleSection>
	{#if tocEntries.length > 0}
		<div class="hotspots-rail-toc" data-slot="section-toc">
			<TocNav
				entries={tocEntries}
				navigation={navigation.navigation}
				heading={t.rail.toc}
				counterPrefix={t.rail.counterPrefix}
				onNavigate={(id) => {
					closeSheet();
					void navigate(id);
				}}
			/>
		</div>
	{/if}
{/snippet}

{#snippet railCell()}
	<SurfaceRail
		rail={combinedRail}
		label={t.rail.label}
		summary={controlsSummary}
		openAria={t.rail.open}
		closeAria={t.rail.close}
	/>
{/snippet}

<DetailFrame
	class="hotspots-detail"
	railScroll
	rail={showCombinedRail ? railCell : undefined}
	toc={{
		navigation: navigation.navigation,
		landFragments: true,
		entries: navigation.registeredEntries,
	}}
>
	{#snippet header()}
		<ArticleHeader
			watermark={t.article.watermark}
			category={t.kicker}
			title={t.heading}
			highlight={t.article.tags[0]}
			backHref={localizeHref('/', locale)}
			backLabel={t.article.back}
			meta={articleMeta}
			metaPending={hotspots.loading || !hotspots.settled || record.pending}
			titleId="hotspots-title"
		>
			{#snippet controls()}
				<SectionsToggle />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	<p
		class="hotspots-history-live sr-only"
		data-slot="history-page-announcement"
		role="status"
		aria-live="polite"
		aria-atomic="true"
	>
		{historyCorrection.announcement ?? ''}
	</p>
	<ResourceBoundary resource={hotspots} lang={locale}>
		{#if isEmpty}
			<div class="hotspots-note" data-slot="hotspots-empty">
				<AbsentValue variant="block" reason="no-observations" {locale} />
			</div>
		{:else}
			<ArticleSectionStack data-slot="hotspots-sections">
				{#each sectionDefs as section (section.id)}
					{#if section.present}
						<CollapsibleSection
							title={section.title}
							subtitle={section.subtitle}
							headerVariant="article-summary"
							anchor={section.id}
							index={section.number - 1}
							open={true}
						>
							{#if section.id === 'hotspots-top'}
								<div class="hotspots-article-prose">
									<p class="hotspots-lede">{t.lede}</p>
									<div
										class="hotspots-verdict"
										data-slot="hotspots-verdict"
										aria-label={t.verdict.label}
									>
										<p class="hotspots-verdict-line">
											{verdictParts.before}
											{#if topHotspotHref && topHotspot}
												<a
													class="hotspots-verdict-line"
													href={topHotspotHref}
													aria-label={nameFor(topHotspot, true)}>{topHotspotName}</a
												>{:else}{topHotspotName}{/if}{verdictParts.after}
										</p>
									</div>
									<p class="hotspots-window hotspots-window--article">{windowCaption}</p>
									<TypedInformationCard kind="caveat" label={t.caveatLabel}>
										<p>{t.caveat}</p>
									</TypedInformationCard>
								</div>
							{:else if section.id === 'hotspots-lines'}
								<HotspotSection
									heading={t.ladder.heading}
									ladder={routeLadder}
									tray={routeTray}
									{windowCaption}
									chartScrollLabel={t.chart.scroll(t.cards.lines.title)}
									{locale}
									copy={t}
								/>
							{:else}
								<HotspotSection
									heading={t.ladder.heading}
									ladder={stopLadder}
									tray={stopTray}
									{windowCaption}
									chartScrollLabel={t.chart.scroll(t.cards.stops.title)}
									{locale}
									copy={t}
								/>
							{/if}
						</CollapsibleSection>
					{/if}
				{/each}
			</ArticleSectionStack>
		{/if}
	</ResourceBoundary>
</DetailFrame>

<style>
	.hotspots-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.hotspots-rail-toc {
		margin-top: 0.25rem;
	}
	.hotspots-article-prose {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
		color: var(--foreground);
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
	}
	.hotspots-lede {
		margin: 0;
		font-size: var(--text-detail-lede-mobile);
		line-height: 1.65;
	}
	.hotspots-verdict-line {
		display: inline-block;
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-subheading);
		font-weight: 700;
		line-height: 1.45;
		color: var(--foreground);
		text-decoration: none;
	}
	a.hotspots-verdict-line {
		display: inline;
		padding-block: 0.75em;
		border-bottom: 1px solid transparent;
		transition: border-color var(--duration-fast) var(--ease-default);
	}
	a.hotspots-verdict-line:hover,
	a.hotspots-verdict-line:focus-visible {
		border-bottom-color: var(--primary);
	}
	a.hotspots-verdict-line:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.hotspots-window--article {
		font-size: var(--text-detail-body-mobile);
		color: var(--foreground);
	}
	.hotspots-note {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0;
	}
	@media (--desktop-min) {
		.hotspots-article-prose {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
		.hotspots-lede {
			font-size: var(--text-detail-lede-desktop);
		}
		.hotspots-window--article {
			font-size: var(--text-detail-body-desktop);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		a.hotspots-verdict-line {
			transition: none;
		}
	}
</style>
