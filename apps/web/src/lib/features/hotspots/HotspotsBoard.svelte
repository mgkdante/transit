<!--
  HotspotsBoard — the /hotspots accountability article.

  The page owns the published resource, URL-backed grain and worst-N state, the
  conditional article-card model, and one combined controls/contents rail. The
  category presenter below receives one already-built ladder at a time; no tabs
  or category-local filter state remain.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { routeFor, type SurfaceKind } from '$lib/nav';
	import { fromSearchParams, toSearchParams, emptyFilterState, type WorstN } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { describeAbsence } from '$lib/site/absence';
	import { getHotspots } from '$lib/v1';
	import type { HotspotEntry } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import { ResourceBoundary, GrainPicker, type GrainSegment } from '$lib/components/surface';
	import { ArticleHeader, DetailShell, type ArticleMetaEntry } from '$lib/components/layout';
	import { AbsentValue } from '$lib/components/edge';
	import {
		CollapsibleSection,
		TocNav,
		TypedInformationCard,
		reconcileActiveToc,
		revealTocTarget,
		type TocEntry,
	} from '$lib/components/shared';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { persisted } from '$lib/stores';
	import { prefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import { formatUtc } from '$lib/utils/time';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type {
		SurfaceRailContext,
		SurfaceRailPresentation,
	} from '$lib/components/surface/SurfaceRail.svelte';

	import {
		presentGrains,
		defaultHotspotGrain,
		ladderByGrain,
		HOTSPOT_GRAINS,
		type HotspotGrainKey,
	} from './data/presentGrains';
	import {
		worstNCap,
		DEFAULT_WORST_N,
		worstNSegments as buildWorstNSegments,
		SMALLEST_WORST_N,
	} from './data/ladderCap';
	import { selectHotspotLadder } from './selectors/hotspotLadder';
	import HotspotSection from './sections/HotspotSection.svelte';
	import { copy as COPY } from './hotspots.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);
	const railOpen = {
		controls: persisted('hotspots-controls', true),
		toc: persisted('hotspots-toc', true),
	};
	function setRailOpen(key: keyof typeof railOpen, next: boolean): void {
		railOpen[key].value = next;
	}

	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const metric = metricInfoFor(key, locale);
		return {
			...metric,
			label: explainerCopy.info.trigger(name),
			linkLabel: explainerCopy.info.link,
		};
	});
	const severeInfo = $derived(info('severe', t.ladder.severeRateLabel));

	const hotspots = createResource(() => getHotspots(), { freshness: true });
	const generatedUtc = $derived(hotspots.data?.generated_utc ?? null);
	const ladders = $derived(ladderByGrain(hotspots.data?.by_grain));
	const present = $derived(presentGrains(hotspots.data?.by_grain));

	let grainKey = $state<HotspotGrainKey>(
		(() => {
			const raw = page.url.searchParams.get('grain');
			if (raw === 'shift') return 'shift';
			const seeded = fromSearchParams(page.url.searchParams).grain;
			return seeded === 'week' || seeded === 'month' ? seeded : 'day';
		})(),
	);

	const grainLabels = $derived<Partial<Record<HotspotGrainKey, string>>>({
		day: t.grain.day,
		week: t.grain.week,
		month: t.grain.month,
		shift: t.grain.shift,
	});
	const showGrainPicker = $derived(present.size > 1);
	const uid = $props.id();
	const disabledReason = $derived(describeAbsence('no-observations', locale).why);
	const grainSegments = $derived<GrainSegment<HotspotGrainKey>[]>(
		HOTSPOT_GRAINS.map((key) => {
			const available = present.has(key);
			return {
				key,
				label: grainLabels[key] ?? key,
				...(key === 'shift' ? { compactLabel: t.grain.shiftCompact } : {}),
				available,
				...(available ? {} : { describedById: `${uid}-reason-${key}`, title: disabledReason }),
			};
		}),
	);
	function grainSegmentsFor(
		presentation: SurfaceRailPresentation,
	): GrainSegment<HotspotGrainKey>[] {
		return grainSegments.map((segment) =>
			segment.describedById
				? { ...segment, describedById: `${segment.describedById}-${presentation}` }
				: segment,
		);
	}

	$effect(() => {
		if (present.size > 0 && !present.has(grainKey)) grainKey = defaultHotspotGrain(present);
	});

	let worstN = $state<WorstN>(fromSearchParams(page.url.searchParams).worstN ?? DEFAULT_WORST_N);
	const cap = $derived(worstNCap(worstN));
	const worstSegments = $derived<GrainSegment<WorstN>[]>(buildWorstNSegments(t.worstN.all));

	const wire = $derived.by<{ grain: string | null; n: string | null }>(() => {
		const state = emptyFilterState();
		if (worstN !== DEFAULT_WORST_N) state.worstN = worstN;
		const grainParam =
			grainKey === 'day'
				? null
				: grainKey === 'shift'
					? 'shift'
					: ((): string | null => {
							state.grain = grainKey;
							return toSearchParams(state).get('grain');
						})();
		return { grain: grainParam, n: toSearchParams(state).get('n') };
	});
	$effect(() => mirrorSearchParams(wire));

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
	const topHotspot = $derived<HotspotEntry | null>(activeLadder?.entries?.[0] ?? null);
	const topHotspotName = $derived(
		topHotspot ? (topHotspot.name ?? t.unnamed(topHotspot.id)) : null,
	);
	const verdictLine = $derived.by<string>(() => {
		if (!topHotspot || topHotspotName == null) return t.verdict.none;
		if (topHotspot.otp_delta_pts == null) return t.verdict.topNoDelta(topHotspotName);
		const points = `${Math.abs(Math.round(topHotspot.otp_delta_pts))}${t.units.pts}`;
		return t.verdict.topWithDelta(topHotspotName, points);
	});
	const topHotspotHref = $derived(topHotspot ? hrefFor(topHotspot) : null);

	function ladderFor(kind: 'route' | 'stop', total: number | null | undefined) {
		const entries = (activeLadder?.entries ?? []).filter((entry) => entry.type === kind);
		const result = selectHotspotLadder(entries, cap, locale, {
			title: t.ladder.heading,
			xLabel: t.ladder.severeRateLabel,
			unit: t.units.pct,
			ciLabel: t.ladder.ci,
			note: ladderNote,
			unnamed: t.unnamed,
			href: hrefFor,
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
				const title = entry.name ?? t.unnamed(entry.id);
				return {
					key: `${entry.type}-${entry.id}`,
					title,
					type: typeTag(entry.type) ?? entry.type,
					id: entry.id,
					observationCount: entry.observation_count ?? null,
					href: hrefFor(entry),
					ariaLabel: t.viewDetail(title),
				};
			});
	}
	const routeTray = $derived(trayFor('route'));
	const stopTray = $derived(trayFor('stop'));
	const windowCaption = $derived(t.window[grainKey]);
	const controlsSummary = $derived(grainLabels[grainKey] ?? '');
	const isEmpty = $derived(present.size === 0);
	const showWorstN = $derived(
		routeLadder.total > SMALLEST_WORST_N || stopLadder.total > SMALLEST_WORST_N,
	);

	const sectionDefs = $derived([
		{
			id: 'hotspots-top',
			sectionKey: 'hotspots-card-top',
			number: 1,
			title: t.cards.top.title,
			subtitle: t.cards.top.subtitle,
			present: hotspots.data != null && !isEmpty,
		},
		{
			id: 'hotspots-lines',
			sectionKey: 'hotspots-card-lines',
			number: 2,
			title: t.cards.lines.title,
			subtitle: t.cards.lines.subtitle,
			present: routeLadder.shown > 0 || routeTray.length > 0,
		},
		{
			id: 'hotspots-stops',
			sectionKey: 'hotspots-card-stops',
			number: 3,
			title: t.cards.stops.title,
			subtitle: t.cards.stops.subtitle,
			present: stopLadder.shown > 0 || stopTray.length > 0,
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
		const entries: ArticleMetaEntry[] = [];
		if (generatedUtc) {
			entries.push({
				text: formatUtc(generatedUtc, locale),
				datetime: generatedUtc,
				label: t.asOf,
			});
		}
		if (tocEntries.length > 0) entries.push(t.article.sections(tocEntries.length));
		return entries;
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
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
		});
	}
	$effect(() => {
		const next = tocEntries.map((entry) => entry.id);
		activeId = reconcileActiveToc(activeId, previousTocIds, next);
		previousTocIds = next;
	});
</script>

<DetailShell
	class="hotspots-detail"
	bind:activeId
	{tocEntries}
	combinedRailConfig={{
		label: t.rail.label,
		summary: controlsSummary,
		openAria: t.rail.open,
		closeAria: t.rail.close,
	}}
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
			metaPending={hotspots.loading || !hotspots.settled}
			titleId="hotspots-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet combinedRail({ closeSheet, presentation }: SurfaceRailContext)}
		{@const presentedGrainSegments = grainSegmentsFor(presentation)}
		<CollapsibleSection
			title={t.rail.controls}
			bind:open={() => railOpen.controls.value, (next) => setRailOpen('controls', next)}
			closeSignal={quietModeStore.closeSignal}
			openSignal={quietModeStore.openSignal}
			bulkCollapsed={presentation === 'desktop' ? quietModeStore.enabled : null}
		>
			<div class="hotspots-control-body" data-slot="controls-body">
				{#if showGrainPicker}
					<GrainPicker
						segments={presentedGrainSegments}
						bind:value={grainKey}
						label={t.grain.label}
						variant="time-row"
					/>
					{#each presentedGrainSegments as segment (segment.key)}
						{#if segment.describedById}
							<span id={segment.describedById} class="hotspots-reason" data-slot="controls-reason">
								{disabledReason}
							</span>
						{/if}
					{/each}
				{/if}
				{#if showWorstN}
					<GrainPicker segments={worstSegments} bind:value={worstN} label={t.worstN.label} />
				{/if}
				<p class="hotspots-window" data-slot="active-window" aria-live="polite">
					{windowCaption}
				</p>
			</div>
		</CollapsibleSection>
		{#if tocEntries.length > 0}
			<div class="hotspots-rail-toc" data-slot="section-toc">
				<TocNav
					entries={tocEntries}
					{activeId}
					heading={t.rail.toc}
					counterPrefix={t.rail.counterPrefix}
					bind:open={() => railOpen.toc.value, (next) => setRailOpen('toc', next)}
					closeSignal={quietModeStore.closeSignal}
					openSignal={quietModeStore.openSignal}
					bulkCollapsed={presentation === 'desktop' ? quietModeStore.enabled : null}
					onNavigate={(id) => {
						closeSheet();
						void navigate(id);
					}}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet center()}
		<ResourceBoundary resource={hotspots} lang={locale}>
			{#if isEmpty}
				<div class="hotspots-note" data-slot="hotspots-empty">
					<AbsentValue variant="block" reason="no-observations" {locale} />
				</div>
			{:else}
				<div class="hotspots-sections" data-slot="hotspots-sections">
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
								{#if section.id === 'hotspots-top'}
									<div class="hotspots-article-prose">
										<p class="hotspots-lede">{t.lede}</p>
										<div
											class="hotspots-verdict"
											data-slot="hotspots-verdict"
											aria-label={t.verdict.label}
										>
											{#if topHotspotHref}
												<a class="hotspots-verdict-line" href={topHotspotHref}>{verdictLine}</a>
											{:else}
												<p class="hotspots-verdict-line">{verdictLine}</p>
											{/if}
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
										info={severeInfo}
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
										info={severeInfo}
										{locale}
										copy={t}
									/>
								{/if}
							</CollapsibleSection>
						{/if}
					{/each}
				</div>
			{/if}
		</ResourceBoundary>
	{/snippet}
</DetailShell>

<style>
	.hotspots-control-body {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.75rem;
		min-width: 0;
	}
	.hotspots-control-body :global([data-slot='grain-picker']) {
		min-width: 0;
		flex-wrap: wrap;
	}
	.hotspots-reason {
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
	.hotspots-sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
		min-width: 0;
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
		max-width: 60ch;
		font-family: var(--font-heading);
		font-size: var(--text-subheading);
		font-weight: 700;
		line-height: 1.45;
		color: var(--foreground);
		text-decoration: none;
	}
	a.hotspots-verdict-line {
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
	@media (min-width: 1024px) {
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
