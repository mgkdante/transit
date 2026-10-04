<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { getLocale, getLocalizeHref, type Locale } from '$lib/i18n';
	import { getProvenance } from '$lib/v1/repositories/provenance';
	import { createResource } from '$lib/v1/resource.svelte';
	import ConformanceBadge from '$lib/components/surface/ConformanceBadge.svelte';
	import FreshnessStamp from '$lib/components/surface/FreshnessStamp.svelte';
	import { ArticleHeader, ArticleSectionStack, DetailShell } from '$lib/components/layout';
	import { StateNotice } from '$lib/components/edge';
	import { SectionLabel } from '@yesid/ui/brand';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { persisted } from '$lib/stores';
	import { layout } from '$lib/nav/layout.svelte';
	import { formatUtc } from '$lib/utils/time';
	import {
		CollapsibleSection,
		SectionIcon,
		TocNav,
		TypedInformationCard,
		tocElement,
		settleLayout,
		type TocEntry,
	} from '$lib/components/shared';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import {
		METRICS,
		METRIC_CLUSTER_ORDER,
		methodologyNoteFor,
		type MetricEntry,
	} from './metrics.content';
	import { metricsCopy } from './metrics.copy';
	import MetricBody, { type MetricBodies } from './MetricBody.svelte';

	const localizeHref = getLocalizeHref();

	let { metricBodies }: { metricBodies?: MetricBodies } = $props();

	const locale: Locale = getLocale();
	const t = $derived(metricsCopy[locale]);

	const LACUNES_ANCHOR = 'structural-gaps';

	const LIVE_POSITIONS_ANCHOR = 'live-positions';

	const provenance = createResource(() => getProvenance());

	let desktopRailVisited = $state(false);
	$effect(() => {
		if (layout.isDesktop) desktopRailVisited = true;
	});

	const generatedMeta = $derived(
		provenance.data?.generated_utc != null
			? {
					text: formatUtc(provenance.data.generated_utc, locale),
					datetime: provenance.data.generated_utc,
				}
			: null,
	);
	const provenanceUnavailable = $derived(
		provenance.settled && !provenance.data?.conformance && provenance.error != null,
	);

	const methodologyNumber = (key: string): number | null => {
		const raw = provenance.data?.methodology?.[key];
		return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
	};
	const doctrineConstants = $derived.by(() => {
		const minN = methodologyNumber('min_n_rate');
		const wilsonZ = methodologyNumber('wilson_z');
		if (minN == null || wilsonZ == null) return null;
		return {
			minN: minN.toLocaleString(locale),
			wilsonZ: wilsonZ.toLocaleString(locale),
		};
	});

	const groups = $derived(
		METRIC_CLUSTER_ORDER.map((cluster) => ({
			cluster,
			label: t.clusters[cluster],
			entries: METRICS.filter((m) => m.cluster === cluster),
		})).filter((g) => g.entries.length > 0),
	);

	const orderedMetrics = $derived(groups.flatMap((g) => g.entries));

	const articleMeta = $derived(
		[
			generatedMeta,
			`${orderedMetrics.length} ${t.statRail.coverage.metrics}`,
			`${groups.length} ${t.statRail.coverage.families}`,
		].filter((x) => x != null),
	);
	const confidenceMeaning = $derived(
		(entry: MetricEntry) => t.confidence.levels[entry.confidence].chip,
	);

	const methodologyNote = $derived((entry: MetricEntry): string | null =>
		methodologyNoteFor(entry.key, provenance.data?.methodology),
	);

	const PROVENANCE_ANCHOR = 'metrics-provenance';
	const CONFIDENCE_INTERVALS_ANCHOR = 'confidence-intervals';

	const tocEntries = $derived.by((): TocEntry[] => [
		{
			id: PROVENANCE_ANCHOR,
			title: t.provenance.label,
			level: 2,
			badge: { kind: 'icon' as const, name: 'layers' },
			children: [],
		},
		...orderedMetrics.map((entry, i) => ({
			id: entry.anchor,
			title: entry.name[locale],
			level: 2,
			badge: { kind: 'number' as const, value: i + 1 },
			children: [],
		})),
		{
			id: LIVE_POSITIONS_ANCHOR,
			title: t.livePositions.title,
			level: 2,
			badge: { kind: 'icon' as const, name: 'chart' },
			children: [],
		},
		{
			id: LACUNES_ANCHOR,
			title: t.lacunes.title,
			level: 2,
			badge: { kind: 'icon' as const, name: 'eye' },
			children: [],
		},
	]);

	const cardCloseSignal = $derived(quietModeStore.closeSignal);

	const cardKey = (anchor: string): string => `metrics-card-${anchor}`;

	let cardOpenSignals = $state<Record<string, number>>({});
	const cardOpenSignal = (anchor: string): number =>
		(cardOpenSignals[anchor] ?? 0) + quietModeStore.openSignal;

	const railOpen = {
		provenance: persisted('metrics-rail-provenance', true),
		coverage: persisted('metrics-rail-coverage', true),
		freshness: persisted('metrics-rail-freshness', true),
	};

	function setRailOpen(key: keyof typeof railOpen, next: boolean): void {
		railOpen[key].value = next;
	}

	function openCard(anchor: string): void {
		cardOpenSignals = { ...cardOpenSignals, [anchor]: (cardOpenSignals[anchor] ?? 0) + 1 };
	}

	const openableAnchors = $derived(
		new Set<string>([
			PROVENANCE_ANCHOR,
			...orderedMetrics.map((m) => m.anchor),
			LIVE_POSITIONS_ANCHOR,
			LACUNES_ANCHOR,
		]),
	);

	let requestedHash: string | null = null;
	let navigationGeneration = 0;

	function openFromHash(): void {
		const raw = window.location.hash.replace(/^#/, '');
		let anchor: string | null = null;
		if (raw) {
			try {
				anchor = decodeURIComponent(raw);
			} catch {
				anchor = null;
			}
		}
		if (anchor === requestedHash) return;
		requestedHash = anchor;
		const generation = ++navigationGeneration;
		if (anchor && (openableAnchors.has(anchor) || anchor === CONFIDENCE_INTERVALS_ANCHOR))
			void navigate(anchor, generation);
	}

	onMount(() => {
		let cancelled = false;
		void (async () => {
			await tick();
			if (!cancelled) openFromHash();
		})();
		window.addEventListener('hashchange', openFromHash);
		return () => {
			cancelled = true;
			navigationGeneration += 1;
			window.removeEventListener('hashchange', openFromHash);
		};
	});

	let activeId = $state('');

	async function navigate(id: string, generation = ++navigationGeneration): Promise<void> {
		const card = id === CONFIDENCE_INTERVALS_ANCHOR ? PROVENANCE_ANCHOR : id;
		if (openableAnchors.has(card)) openCard(card);
		await tick();
		const target = tocElement(id);
		await settleLayout(target);
		if (generation !== navigationGeneration) return;
		target?.scrollIntoView({
			behavior: $prefersReducedMotion ? 'auto' : 'smooth',
			block: 'start',
		});
	}
</script>

{#snippet statCards()}
	<div class="metrics-stat-rail">
		{#if desktopRailVisited && (provenance.data?.conformance || provenanceUnavailable)}
			<CollapsibleSection
				title={t.statRail.provenance.title}
				headerVariant="article-summary"
				bind:open={() => railOpen.provenance.value, (next) => setRailOpen('provenance', next)}
				closeSignal={quietModeStore.closeSignal}
				openSignal={quietModeStore.openSignal}
				bulkCollapsed={quietModeStore.enabled}
			>
				{#snippet icon()}
					<SectionIcon name="layers" class="h-4 w-4 shrink-0 text-primary" />
				{/snippet}
				<div class="metrics-stat__body" data-slot="stat-provenance">
					{#if provenance.data?.conformance}
						<ConformanceBadge conformance={provenance.data.conformance} {locale} />
					{:else}
						<StateNotice
							title={t.statRail.provenance.unavailable}
							presentation="silo"
							role="status"
							ariaLive="polite"
						/>
					{/if}
				</div>
			</CollapsibleSection>
		{/if}

		<CollapsibleSection
			title={t.statRail.coverage.title}
			headerVariant="article-summary"
			bind:open={() => railOpen.coverage.value, (next) => setRailOpen('coverage', next)}
			closeSignal={quietModeStore.closeSignal}
			openSignal={quietModeStore.openSignal}
			bulkCollapsed={quietModeStore.enabled}
		>
			{#snippet icon()}
				<SectionIcon name="chart" class="h-4 w-4 shrink-0 text-primary" />
			{/snippet}
			<div class="metrics-stat__body" data-slot="stat-coverage">
				<p class="metrics-stat__count">
					<span class="metrics-stat__big">{orderedMetrics.length}</span>
					<span class="metrics-stat__unit">{t.statRail.coverage.metrics}</span>
				</p>
				<p class="metrics-stat__sub">
					{groups.length}
					{t.statRail.coverage.families}
				</p>
				<ul class="metrics-stat__chips">
					{#each Object.entries(t.confidence.levels) as [level, info] (level)}
						<li><span class="metrics-chip">{info.chip}</span></li>
					{/each}
				</ul>
			</div>
		</CollapsibleSection>

		{#if desktopRailVisited && provenance.data?.generated_utc}
			<CollapsibleSection
				title={t.statRail.freshness.title}
				headerVariant="article-summary"
				bind:open={() => railOpen.freshness.value, (next) => setRailOpen('freshness', next)}
				closeSignal={quietModeStore.closeSignal}
				openSignal={quietModeStore.openSignal}
				bulkCollapsed={quietModeStore.enabled}
			>
				{#snippet icon()}
					<SectionIcon name="eye" class="h-4 w-4 shrink-0 text-primary" />
				{/snippet}
				<div class="metrics-stat__body" data-slot="stat-freshness">
					<FreshnessStamp
						class="metrics-freshness-stamp"
						variant="updated"
						generatedUtc={provenance.data.generated_utc}
						{locale}
					/>
				</div>
			</CollapsibleSection>
		{/if}
	</div>
{/snippet}

<DetailShell
	class="metrics-detail"
	bind:activeId
	{tocEntries}
	onNavigate={navigate}
	tocOpenAria={t.tocPill.open}
	tocCloseAria={t.tocPill.close}
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
			titleId="metrics-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet left()}
		<div class="metrics-toc-rail">
			<TocNav
				entries={tocEntries}
				{activeId}
				onNavigate={navigate}
				heading={t.tocLabel}
				counterPrefix={t.tocCounterPrefix}
				sectionKey="metrics-toc"
				closeSignal={quietModeStore.closeSignal}
				openSignal={quietModeStore.openSignal}
				bulkCollapsed={quietModeStore.enabled}
			/>

			<aside class="metrics-stat-aside" aria-label={t.statRail.label}>
				{@render statCards()}
			</aside>
		</div>
	{/snippet}

	{#snippet center()}
		<ArticleSectionStack data-testid="metrics-sections">
			<div class="section-block" id={PROVENANCE_ANCHOR}>
				<CollapsibleSection
					title={t.provenance.label}
					headerVariant="article-summary"
					anchor={PROVENANCE_ANCHOR}
					sectionKey={cardKey(PROVENANCE_ANCHOR)}
					open={true}
					closeSignal={cardCloseSignal}
					openSignal={cardOpenSignal(PROVENANCE_ANCHOR)}
					bulkCollapsed={quietModeStore.enabled}
				>
					{#snippet icon()}
						<SectionIcon name="layers" class="h-4 w-4 shrink-0 text-primary" />
					{/snippet}
					<div class="metrics-article-prose">
						<p class="metrics-lede">{t.lede}</p>
						<p class="metrics-preamble">{t.provenance.body}</p>
						{#if provenance.data?.conformance}
							<div class="metrics-conformance">
								<ConformanceBadge conformance={provenance.data.conformance} {locale} />
							</div>
						{:else if provenanceUnavailable}
							<StateNotice
								title={t.provenance.unavailable}
								presentation="silo"
								role="status"
								ariaLive="polite"
							/>
						{/if}

						<div class="metrics-measure">
							<SectionLabel text={t.provenance.howWeMeasure.label} variant="metric" />
							<div class="metrics-measure__item">
								<h3 class="metrics-measure__heading">
									{t.provenance.howWeMeasure.serviceDay.heading}
								</h3>
								<p class="metric__prose">{t.provenance.howWeMeasure.serviceDay.body}</p>
							</div>
							<div class="metrics-measure__item" id={CONFIDENCE_INTERVALS_ANCHOR}>
								<h3 class="metrics-measure__heading">
									{t.provenance.howWeMeasure.confidenceInterval.heading}
								</h3>
								<p class="metric__prose">{t.provenance.howWeMeasure.confidenceInterval.body}</p>
								<a
									class="metric__top"
									href="https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm"
									>{t.provenance.howWeMeasure.confidenceInterval.reference}</a
								>
							</div>
							<div class="metrics-measure__item">
								<h3 class="metrics-measure__heading">
									{t.provenance.howWeMeasure.rounding.heading}
								</h3>
								<p class="metric__prose">{t.provenance.howWeMeasure.rounding.body}</p>
							</div>
							<div class="metrics-measure__item">
								<h3 class="metrics-measure__heading">
									{t.provenance.howWeMeasure.constants.heading}
								</h3>
								{#if doctrineConstants}
									<p class="metric__prose" data-testid="metrics-doctrine-constants">
										{t.provenance.howWeMeasure.constants.body(
											doctrineConstants.minN,
											doctrineConstants.wilsonZ,
										)}
									</p>
								{:else}
									<p
										class="metric__prose metric__not"
										role="status"
										data-testid="metrics-doctrine-absent"
									>
										{t.provenance.howWeMeasure.constants.absent}
									</p>
								{/if}
							</div>
						</div>

						<div class="metrics-legend">
							<SectionLabel text={t.confidence.label} variant="metric" />
							<ul class="metrics-legend__list">
								{#each Object.entries(t.confidence.levels) as [level, info] (level)}
									<li class="metrics-legend__item">
										<span class="metrics-chip">{info.chip}</span>
										<span class="metrics-legend__meaning">{info.meaning}</span>
									</li>
								{/each}
							</ul>
						</div>
					</div>
				</CollapsibleSection>
			</div>

			{#each groups as group (group.cluster)}
				<div class="metrics-cluster">
					<SectionHeading level={2} overline={group.label} class="metrics-cluster__overline" />
					<ArticleSectionStack class="metrics-cluster__cards" data-slot-variant="metric-cluster">
						{#each group.entries as entry (entry.key)}
							{@const metricIndex = orderedMetrics.findIndex((m) => m.key === entry.key)}
							{@const note = methodologyNote(entry)}
							<div class="section-block" id={entry.anchor}>
								<CollapsibleSection
									title={entry.name[locale]}
									subtitle={entry.oneLiner[locale]}
									headerVariant="article-summary"
									anchor={entry.anchor}
									index={metricIndex}
									sectionKey={cardKey(entry.anchor)}
									open={true}
									closeSignal={cardCloseSignal}
									openSignal={cardOpenSignal(entry.anchor)}
									bulkCollapsed={quietModeStore.enabled}
								>
									<div class="metric__body">
										<p class="metric__meta">
											<code class="metric__sci">{entry.sciName}</code>
											<span class="metrics-chip metrics-chip--meta">{confidenceMeaning(entry)}</span
											>
										</p>

										<div class="metric__information-stack">
											<MetricBody {entry} {locale} serverHtml={metricBodies?.[entry.key]} />

											{#if note}
												<TypedInformationCard kind="pipeline-note" label={t.sections.pipelineNote}>
													<p class="metric__prose metric__pipeline-note" data-slot="pipeline-note">
														{note}
													</p>
												</TypedInformationCard>
											{/if}
										</div>

										<a class="metric__top" href="#metrics-provenance">{t.backToTop}</a>
									</div>
								</CollapsibleSection>
							</div>
						{/each}
					</ArticleSectionStack>
				</div>
			{/each}

			<div class="section-block metrics-live" id={LIVE_POSITIONS_ANCHOR}>
				<CollapsibleSection
					title={t.livePositions.title}
					headerVariant="article-summary"
					anchor={LIVE_POSITIONS_ANCHOR}
					sectionKey={cardKey(LIVE_POSITIONS_ANCHOR)}
					open={true}
					closeSignal={cardCloseSignal}
					openSignal={cardOpenSignal(LIVE_POSITIONS_ANCHOR)}
					bulkCollapsed={quietModeStore.enabled}
				>
					{#snippet icon()}
						<SectionIcon name="chart" class="h-4 w-4 shrink-0 text-primary" />
					{/snippet}
					<div class="metric__body">
						<p class="metric__prose metrics-live__lede">{t.livePositions.lede}</p>
						<ul class="metrics-live__list">
							{#each t.livePositions.points as point (point.heading)}
								<li class="metrics-live__point">
									<h3 class="metrics-live__heading">{point.heading}</h3>
									<p class="metric__prose">{point.body}</p>
								</li>
							{/each}
						</ul>
						<a class="metric__top" href="#metrics-provenance">{t.backToTop}</a>
					</div>
				</CollapsibleSection>
			</div>

			<div class="section-block metrics-lacunes" id={LACUNES_ANCHOR}>
				<CollapsibleSection
					title={t.lacunes.title}
					headerVariant="article-summary"
					anchor={LACUNES_ANCHOR}
					sectionKey={cardKey(LACUNES_ANCHOR)}
					open={true}
					closeSignal={cardCloseSignal}
					openSignal={cardOpenSignal(LACUNES_ANCHOR)}
					bulkCollapsed={quietModeStore.enabled}
				>
					{#snippet icon()}
						<SectionIcon name="eye" class="h-4 w-4 shrink-0 text-primary" />
					{/snippet}
					<div class="metric__body">
						<p class="metric__prose metrics-lacunes__lede">{t.lacunes.lede}</p>
						<ul class="metrics-lacunes__list">
							{#each t.lacunes.gaps as gap (gap.heading)}
								<li class="metrics-lacunes__gap">
									<h3 class="metrics-lacunes__heading">{gap.heading}</h3>
									<p class="metric__prose">{gap.body}</p>
								</li>
							{/each}
						</ul>
						<a class="metric__top" href="#metrics-provenance">{t.backToTop}</a>
					</div>
				</CollapsibleSection>
			</div>
		</ArticleSectionStack>
	{/snippet}
</DetailShell>

<style>
	.metrics-lede {
		margin: 0;
		color: var(--secondary-foreground);
	}

	.metrics-toc-rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
		min-width: 0;
	}

	.metrics-stat-aside {
		min-width: 0;
	}
	.metrics-stat-rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
	}
	.metrics-stat__body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.metrics-stat__body[data-slot='stat-freshness'] :global(.freshness-stamp-label) {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.metrics-stat__body[data-slot='stat-freshness']
		:global(.freshness-stamp--updated.metrics-freshness-stamp) {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 0.5rem;
		row-gap: 0.25rem;
		align-items: center;
		justify-items: start;
	}
	.metrics-stat__body[data-slot='stat-freshness']
		:global(.metrics-freshness-stamp .freshness-stamp-label),
	.metrics-stat__body[data-slot='stat-freshness']
		:global(.metrics-freshness-stamp .freshness-stamp-age) {
		grid-column: 2;
	}
	.metrics-stat__count {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		margin: 0;
	}
	.metrics-stat__big {
		font-family: var(--font-heading);
		font-size: var(--text-stat-value);
		font-weight: 800;
		line-height: 1;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.metrics-stat__unit {
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	.metrics-stat__sub {
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.45;
		color: var(--muted-foreground);
	}
	.metrics-stat__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.metrics-article-prose {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.metrics-preamble {
		margin: 0;
		color: var(--muted-foreground);
	}
	.metrics-conformance {
		display: flex;
	}
	.metrics-measure {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.metrics-measure__item {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.metrics-measure__heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-small);
		font-weight: 600;
		line-height: 1.4;
		color: var(--foreground);
	}
	.metrics-legend {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.metrics-legend__list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.metrics-legend__item {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
	}
	.metrics-legend__meaning {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
	}
	.metrics-chip {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--muted);
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		white-space: nowrap;
	}
	.metrics-chip--meta {
		font-size: var(--text-micro);
	}

	.metrics-cluster {
		min-width: 0;
	}
	:global(.metrics-cluster__overline) {
		margin-block-end: var(--space-card-gap);
	}

	.metric__body {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.metric__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin: 0;
	}
	.metric__sci {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	.metric__information-stack {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	.metric__prose {
		margin: 0;
		color: var(--foreground);
	}
	.metric__prose,
	.metric__pipeline-note {
		font-size: inherit;
		line-height: inherit;
	}
	.metrics-lacunes__lede {
		color: var(--muted-foreground);
	}
	.metrics-lacunes__list {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.metrics-lacunes__gap {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-block-start: 1.25rem;
		border-block-start: 1px solid var(--border-hairline, var(--border));
	}
	.metrics-lacunes__gap:first-child {
		padding-block-start: 0;
		border-block-start: none;
	}
	.metrics-lacunes__heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-small);
		font-weight: 600;
		line-height: 1.4;
		color: var(--foreground);
	}

	.metrics-live__lede {
		color: var(--muted-foreground);
	}
	.metrics-live__list {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.metrics-live__point {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-block-start: 1.25rem;
		border-block-start: 1px solid var(--border-hairline, var(--border));
	}
	.metrics-live__point:first-child {
		padding-block-start: 0;
		border-block-start: none;
	}
	.metrics-live__heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-small);
		font-weight: 600;
		line-height: 1.4;
		color: var(--foreground);
	}

	.metric__top {
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--primary);
		text-decoration: none;
		transition: opacity var(--duration-normal) var(--ease-default);
	}
	.metric__top:hover,
	.metric__top:focus-visible {
		text-decoration: underline;
	}
	.metric__top:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.metrics-article-prose,
	.metrics-live__lede,
	.metrics-live__point p,
	.metrics-lacunes__lede,
	.metrics-lacunes__gap p {
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
	}

	@media (min-width: 1024px) {
		.metrics-article-prose,
		.metrics-live__lede,
		.metrics-live__point p,
		.metrics-lacunes__lede,
		.metrics-lacunes__gap p {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.metric__top {
			transition: none;
		}
	}
</style>
