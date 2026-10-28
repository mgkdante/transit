<script lang="ts">
	import { clock } from '@yesid/ui/state';
	import './sections/health-sections.css';

	import { onMount, tick } from 'svelte';
	import { getLocale, getLocalizeHref, type Locale } from '$lib/i18n';
	import { freshnessRelative } from '$lib/v1/freshness';
	import { getDataHealth } from '$lib/v1/repositories/dataHealth';
	import { getHistoricAvailability } from '$lib/v1/repositories/historic';
	import { getProvenance } from '$lib/v1/repositories/provenance';
	import type { DataHealth } from '$lib/v1/schemas/data_health';
	import type { HistoricAvailabilityIndex } from '$lib/v1/schemas/history';
	import type { Provenance } from '$lib/v1/schemas/provenance';
	import { createResource, type ResourceSeed } from '$lib/v1/resource.svelte';
	import { formatRelativeSeconds, formatUtc } from '$lib/utils/time';
	import { METHODOLOGY_METRIC_KEY } from '$lib/features/metrics/metrics.content';
	import {
		ArticleKeywords,
		ArticleSectionStack,
		type ArticleMetaEntry,
	} from '$lib/components/layout';
	import { ArticleHeader, DetailFrame } from '@yesid/ui/layout';
	import ManifestoCanvas from '$lib/components/brand/ManifestoCanvas.svelte';
	import { ResourceBoundary } from '$lib/components/surface';
	import {
		SectionLabel,
		CollapsibleSection,
		SectionIcon,
		TocNav,
		tocElement,
		settleLayout,
		type TocEntry,
	} from '@yesid/ui/brand';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';

	import { copy as COPY } from './health.copy';
	import {
		verdictFor as verdictForRaw,
		freshnessOf,
		sourcesOf,
		gapsOf,
		pipelineNotesOf,
		retentionOf,
	} from './selectors/provenanceViews';
	import { selectLaneRows, type LaneLabels, type LaneRow } from './selectors/laneHealth';
	import { selectEnvelope } from './selectors/envelope';
	import { selectHistoryCoverage } from './selectors/historyCoverage';
	import SectionLanes from './sections/SectionLanes.svelte';
	import SectionFreshness from './sections/SectionFreshness.svelte';
	import SectionSources from './sections/SectionSources.svelte';
	import SectionGaps from './sections/SectionGaps.svelte';
	import SectionNotes from './sections/SectionNotes.svelte';
	import SectionRetention from './sections/SectionRetention.svelte';
	import SectionConformance from './sections/SectionConformance.svelte';
	import SectionEnvelope from './sections/SectionEnvelope.svelte';
	import SectionHistoryCoverage from './sections/SectionHistoryCoverage.svelte';

	const localizeHref = getLocalizeHref();

	interface Props {
		provenanceSeed?: ResourceSeed<Provenance>;
		dataHealthSeed?: ResourceSeed<DataHealth>;
		historicAvailabilitySeed?: ResourceSeed<HistoricAvailabilityIndex>;
	}

	let { provenanceSeed, dataHealthSeed, historicAvailabilitySeed }: Props = $props();

	const PIPELINE_NOTE_KINDS = {
		history_freeze: 'pipeline-note',
		service_time_conversion: 'math',
		alert_text_en: 'definition',
		network_no_data: 'caveat',
		alert_breakdown: 'definition',
		rounding: 'math',
		min_n_rate: 'math',
		wilson_z: 'math',
		service_span: 'definition',
		alert_history_window: 'caveat',
	} as const;

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	const provenance = createResource(() => getProvenance(), {
		key: () => 'provenance',
		seed: () => provenanceSeed,
	});
	const dataHealth = createResource(() => getDataHealth(), {
		key: () => 'data-health',
		seed: () => dataHealthSeed,
	});
	const historicAvailability = createResource(() => getHistoricAvailability(), {
		key: () => 'historic-availability',
		seed: () => historicAvailabilitySeed,
	});

	function verdictFor(status: string | null | undefined) {
		return verdictForRaw(status, t.statusVerdict);
	}
	function humanizeAge(ageS: number | null | undefined): string {
		return ageS == null ? t.freshness.noAge : formatRelativeSeconds(ageS, locale);
	}
	function lastLoaded(iso: string | null | undefined): string {
		return freshnessRelative(iso, locale, clock.serverNow) ?? t.sources.neverLoaded;
	}
	function humanizeGap(token: string): string {
		return t.gaps.tokens[token] ?? token.replace(/_/g, ' ');
	}
	function fmtDays(v: number | null): string | null {
		return v == null ? null : `${v}${t.retention.daysUnit}`;
	}

	function provenanceIsEmpty(value: Provenance): boolean {
		const windows = retentionOf(value);
		return (
			freshnessOf(value).length === 0 &&
			sourcesOf(value).length === 0 &&
			gapsOf(value).length === 0 &&
			pipelineNotesOf(value, METHODOLOGY_METRIC_KEY, t.pipelineNotes.labels, PIPELINE_NOTE_KINDS)
				.length === 0 &&
			windows.detail == null &&
			windows.aggregate == null &&
			value.conformance == null &&
			value.publish_generation_id == null &&
			value.schema_version == null &&
			value.methodology_version == null
		);
	}

	function dataHealthIsEmpty(value: DataHealth): boolean {
		return (value.lanes?.length ?? 0) === 0 && (value.feeds?.length ?? 0) === 0;
	}

	function historyAvailabilityIsEmpty(value: HistoricAvailabilityIndex): boolean {
		return (value.families?.length ?? 0) === 0;
	}

	const laneLabels = $derived<LaneLabels>({
		laneLabel: (key) => t.lanes.laneLabel[key] ?? key,
		cadence: (key) => t.lanes.cadence[key] ?? '',
		gateVerdict: t.lanes.gateVerdict,
		maintenanceReason: t.lanes.maintenanceReason,
		maintenanceLabel: t.lanes.laneLabel.maintenance,
		maintenanceCadence: t.lanes.maintenanceCadence,
	});

	const prov = $derived(provenance.data ?? null);
	const dh = $derived(dataHealth.data ?? null);
	const historyRoot = $derived(historicAvailability.data ?? null);
	const historyCoverageRows = $derived(selectHistoryCoverage(historyRoot));
	const freshness = $derived(prov ? freshnessOf(prov) : []);
	const sources = $derived(prov ? sourcesOf(prov) : []);
	const gaps = $derived(prov ? gapsOf(prov) : []);
	const retention = $derived(prov ? retentionOf(prov) : { detail: null, aggregate: null });
	const conformance = $derived(prov?.conformance ?? null);
	const pipelineNotes = $derived(
		prov
			? pipelineNotesOf(prov, METHODOLOGY_METRIC_KEY, t.pipelineNotes.labels, PIPELINE_NOTE_KINDS)
			: [],
	);
	const hasRetention = $derived(retention.detail != null || retention.aggregate != null);
	const laneRows = $derived(dh ? selectLaneRows(dh, laneLabels) : []);
	const envelope = $derived(
		prov
			? selectEnvelope(prov as Provenance, dh)
			: { generationId: null, schemaVersion: null, methodologyVersion: null },
	);
	const hasEnvelope = $derived(
		envelope.generationId != null ||
			envelope.schemaVersion != null ||
			envelope.methodologyVersion != null,
	);

	const sectionDefs = $derived([
		{ id: 'health-lanes', number: 1, title: t.lanes.section, present: laneRows.length > 0 },
		{
			id: 'health-freshness',
			number: 2,
			title: t.freshness.section,
			present: freshness.length > 0,
		},
		{ id: 'health-sources', number: 3, title: t.sources.section, present: sources.length > 0 },
		{ id: 'health-gaps', number: 4, title: t.gaps.section, present: gaps.length > 0 },
		{
			id: 'health-pipeline-notes',
			number: 5,
			title: t.pipelineNotes.section,
			present: pipelineNotes.length > 0,
		},
		{ id: 'health-retention', number: 6, title: t.retention.section, present: hasRetention },
		{
			id: 'health-conformance',
			number: 7,
			title: t.conformance.section,
			present: conformance != null,
		},
		{ id: 'health-envelope', number: 8, title: t.envelope.section, present: hasEnvelope },
		{
			id: 'health-history-coverage',
			number: 9,
			title: t.historyCoverage.section,
			present: historyCoverageRows.length > 0,
		},
	]);

	const tocEntries = $derived.by((): TocEntry[] =>
		sectionDefs
			.filter((s) => s.present)
			.map((s) => ({
				id: s.id,
				title: s.title,
				level: 2,
				badge: { kind: 'number' as const, value: s.number },
				children: [],
			})),
	);

	const dailyGeneratedMeta = $derived(
		prov?.generated_utc
			? { text: formatUtc(prov.generated_utc, locale), datetime: prov.generated_utc }
			: null,
	);
	const liveGeneratedMeta = $derived(
		dh?.generated_utc
			? { text: formatUtc(dh.generated_utc, locale), datetime: dh.generated_utc }
			: null,
	);
	const articleMeta = $derived.by((): readonly ArticleMetaEntry[] => {
		const entries: ArticleMetaEntry[] = [];
		if (
			dailyGeneratedMeta &&
			liveGeneratedMeta &&
			dailyGeneratedMeta.datetime !== liveGeneratedMeta.datetime
		) {
			entries.push(
				{ ...dailyGeneratedMeta, label: t.article.dailyAsOf },
				{ ...liveGeneratedMeta, label: t.article.liveAsOf },
			);
		} else {
			const sharedGeneratedMeta = dailyGeneratedMeta ?? liveGeneratedMeta;
			if (sharedGeneratedMeta) entries.push({ ...sharedGeneratedMeta, label: t.asOf });
		}
		if (tocEntries.length > 0) entries.push(t.article.sections(tocEntries.length));
		return entries;
	});
	const laneStat = $derived.by(() => {
		const applicable = laneRows.filter((r: LaneRow) => r.applicable && r.gate != null);
		const passing = applicable.filter((r) => r.gate?.aspect === 'on_time');
		const worst = applicable.find((r) => r.gate?.aspect !== 'on_time') ?? null;
		return { total: applicable.length, passing: passing.length, worst };
	});
	const feedStat = $derived.by(() => {
		const total = freshness.length;
		const ok = freshness.filter((f) => verdictFor(f.status).aspect === 'on_time').length;
		return { total, ok };
	});
	let activeId = $state('');
	let cardOpenSignals = $state<Record<string, number>>({});
	const cardOpenSignal = (id: string): number => cardOpenSignals[id] ?? 0;

	function openCard(id: string): void {
		cardOpenSignals = { ...cardOpenSignals, [id]: cardOpenSignal(id) + 1 };
	}

	const openableAnchors = $derived(new Set(tocEntries.map((entry) => entry.id)));
	let pendingHash = $state<string | null>(null);
	let consumingHash = false;
	let requestedHash: string | null = null;
	let navigationGeneration = 0;

	function decodedHash(): string | null {
		const raw = window.location.hash.replace(/^#/, '');
		if (!raw) return null;
		try {
			return decodeURIComponent(raw);
		} catch {
			return null;
		}
	}

	function queueHash(id: string | null): void {
		if (id === requestedHash) return;
		requestedHash = id;
		navigationGeneration += 1;
		pendingHash = id;
	}

	async function reveal(id: string, generation = ++navigationGeneration): Promise<boolean> {
		if (!openableAnchors.has(id)) return false;
		openCard(id);
		await tick();
		const target = tocElement(id);
		await settleLayout(target);
		if (generation !== navigationGeneration) return false;
		target?.scrollIntoView({
			behavior: $prefersReducedMotion ? 'auto' : 'smooth',
			block: 'start',
		});
		return true;
	}

	async function consumePendingHash(): Promise<void> {
		const id = pendingHash;
		if (consumingHash || !id || !openableAnchors.has(id)) return;
		consumingHash = true;
		try {
			await tick();
			if (pendingHash !== id || !openableAnchors.has(id)) return;
			if ((await reveal(id, navigationGeneration)) && pendingHash === id) pendingHash = null;
		} finally {
			consumingHash = false;
			if (pendingHash && pendingHash !== id && openableAnchors.has(pendingHash)) {
				void consumePendingHash();
			}
		}
	}

	$effect(() => {
		const signature = tocEntries.map((entry) => entry.id).join('|');
		const id = pendingHash;
		void signature;
		void id;
		void consumePendingHash();
	});

	onMount(() => {
		let cancelled = false;
		void (async () => {
			await tick();
			if (!cancelled) queueHash(decodedHash());
		})();
		const onHashChange = () => {
			queueHash(decodedHash());
		};
		window.addEventListener('hashchange', onHashChange);
		return () => {
			cancelled = true;
			navigationGeneration += 1;
			window.removeEventListener('hashchange', onHashChange);
		};
	});

	async function navigate(id: string): Promise<void> {
		pendingHash = null;
		await reveal(id);
	}
</script>

<DetailFrame
	class="health-detail"
	railScroll
	bind:activeId
	toc={{
		entries: tocEntries,
		openAria: t.toc.pill.open,
		closeAria: t.toc.pill.close,
		onNavigate: navigate,
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
			metaPending={provenance.loading || dataHealth.loading || historicAvailability.loading}
			titleId="status-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
			{#snippet canvas(el)}
				<ManifestoCanvas containerEl={el} />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet left()}
		<div class="health-left-rail">
			<div class="health-toc-rail">
				{#if tocEntries.length > 0}
					<TocNav
						entries={tocEntries}
						{activeId}
						onNavigate={navigate}
						heading={t.toc.label}
						counterPrefix={t.toc.counterPrefix}
						sectionKey="status-toc"
					/>
				{/if}
			</div>
			<section
				class="health-at-a-glance"
				data-slot="health-at-a-glance"
				aria-label={t.statRail.label}
			>
				{@render statCards()}
			</section>
			<ArticleKeywords label={t.article.tagsAria} keywords={t.article.tags} />
		</div>
	{/snippet}

	<ArticleSectionStack class="health-sections" data-testid="health-sections">
		<CollapsibleSection
			title={t.overview.title}
			headerVariant="article-summary"
			sectionKey="status-overview"
			open={true}
		>
			<div class="health-overview">
				<p class="health-lede">{t.lede}</p>
				{#if !prov || provenanceIsEmpty(prov)}
					<div class="health-resource-state" aria-label={t.overview.dailyRecord}>
						<SectionLabel text={t.overview.dailyRecord} variant="metric" />
						<ResourceBoundary resource={provenance} lang={locale} isEmpty={provenanceIsEmpty}>
							{#snippet children(_value)}{/snippet}
						</ResourceBoundary>
					</div>
				{/if}
				{#if !dh || dataHealthIsEmpty(dh)}
					<div class="health-resource-state" aria-label={t.overview.liveFeeds}>
						<SectionLabel text={t.overview.liveFeeds} variant="metric" />
						<ResourceBoundary resource={dataHealth} lang={locale} isEmpty={dataHealthIsEmpty}>
							{#snippet children(_value)}{/snippet}
						</ResourceBoundary>
					</div>
				{:else if laneStat.total > 0}
					<div class="health-aggregate" data-slot="health-aggregate">
						<TerminalPanel title={t.aggregate.title}>
							<p class="health-aggregate__verdict">
								<span class="health-aggregate__summary">
									{t.aggregate.summary(String(laneStat.passing), String(laneStat.total))}
								</span>
								<span class="health-aggregate__worst">
									{#if laneStat.worst}
										{t.aggregate.worst(laneStat.worst.label)}
									{:else}
										{t.aggregate.allClear}
									{/if}
								</span>
							</p>
						</TerminalPanel>
					</div>
				{/if}
				{#if !historyRoot || historyAvailabilityIsEmpty(historyRoot)}
					<div class="health-resource-state" aria-label={t.overview.retainedHistory}>
						<SectionLabel text={t.overview.retainedHistory} variant="metric" />
						<ResourceBoundary
							resource={historicAvailability}
							lang={locale}
							isEmpty={historyAvailabilityIsEmpty}
						>
							{#snippet children(_value)}{/snippet}
						</ResourceBoundary>
					</div>
				{/if}
			</div>
		</CollapsibleSection>

		{#each sectionDefs as section (section.id)}
			{section.number === 1 ? '' : ' '}{#if section.present}
				<CollapsibleSection
					title={section.title}
					headerVariant="article-summary"
					index={section.number - 1}
					anchor={section.id}
					sectionKey={`status-card-${section.id}`}
					open={true}
					openSignal={cardOpenSignal(section.id)}
				>
					{#if section.id === 'health-lanes'}
						<SectionLanes rows={laneRows} copy={t} {locale} />
					{:else if section.id === 'health-freshness'}
						<SectionFreshness items={freshness} {verdictFor} {humanizeAge} copy={t} />
					{:else if section.id === 'health-sources'}
						<SectionSources items={sources} {lastLoaded} copy={t} />
					{:else if section.id === 'health-gaps'}
						<SectionGaps {gaps} {humanizeGap} copy={t} />
					{:else if section.id === 'health-pipeline-notes'}
						<SectionNotes notes={pipelineNotes} copy={t} />
					{:else if section.id === 'health-retention'}
						<SectionRetention
							detail={retention.detail}
							aggregate={retention.aggregate}
							{fmtDays}
							copy={t}
							{locale}
						/>
					{:else if section.id === 'health-conformance' && conformance}
						<SectionConformance {conformance} copy={t} {locale} />
					{:else if section.id === 'health-envelope'}
						<SectionEnvelope {envelope} copy={t} {locale} />
					{:else if section.id === 'health-history-coverage'}
						<SectionHistoryCoverage rows={historyCoverageRows} copy={t} {locale} />
					{/if}
				</CollapsibleSection>
			{/if}
		{/each}
	</ArticleSectionStack>

	{#snippet after()}
		<ArticleKeywords
			class="px-[var(--space-page-x)] pb-8 lg:hidden"
			label={t.article.tagsAria}
			keywords={t.article.tags}
		/>
	{/snippet}
</DetailFrame>

{#snippet statCards()}
	<div class="health-stat-rail">
		{#if laneStat.total > 0}
			<CollapsibleSection
				title={t.statRail.lanes.title}
				headerVariant="article-summary"
				sectionKey="status-rail-lanes"
			>
				{#snippet icon()}
					<SectionIcon name="grid" class="h-4 w-4 shrink-0 text-primary" />
				{/snippet}
				<div class="health-stat__body" data-slot="stat-lanes">
					<p class="health-stat__count">
						{t.statRail.lanes.passing(String(laneStat.passing), String(laneStat.total))}
					</p>
					<p class="health-stat__sub">
						{#if laneStat.worst}
							{t.statRail.lanes.worst(laneStat.worst.label)}
						{:else}
							{t.statRail.lanes.allClear}
						{/if}
					</p>
				</div>
			</CollapsibleSection>
		{/if}
		{#if feedStat.total > 0}
			<CollapsibleSection
				title={t.statRail.feeds.title}
				headerVariant="article-summary"
				sectionKey="status-rail-feeds"
			>
				{#snippet icon()}
					<SectionIcon name="list" class="h-4 w-4 shrink-0 text-primary" />
				{/snippet}
				<div class="health-stat__body" data-slot="stat-feeds">
					<p class="health-stat__count">
						{t.statRail.feeds.fresh(String(feedStat.ok), String(feedStat.total))}
					</p>
				</div>
			</CollapsibleSection>
		{/if}
	</div>
{/snippet}

<style>
	.health-overview {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}
	.health-lede {
		margin: 0;
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
		color: var(--secondary-foreground);
	}
	.health-resource-state {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	.health-aggregate {
		min-width: 0;
	}

	.health-left-rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
		min-width: 0;
	}
	.health-toc-rail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	.health-at-a-glance {
		min-width: 0;
	}
	.health-aggregate__verdict {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem 0.75rem;
		margin: 0;
	}
	.health-aggregate__summary {
		font-family: var(--font-heading);
		font-size: var(--text-subheading);
		font-weight: 700;
		line-height: 1.2;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.health-aggregate__worst {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}

	.health-stat-rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
	}
	.health-stat__body {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
	}
	.health-stat__count {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-subheading);
		font-weight: 700;
		line-height: 1.2;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.health-stat__sub {
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.45;
		color: var(--muted-foreground);
	}

	@media (--desktop-min) {
		.health-lede {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}
</style>
