<script lang="ts">
	import type { Manifest } from '#lib/v1/schemas/index.ts';
	import { createRecordStamp } from '#lib/v1/recordStamp.svelte.ts';
	import ArticleHeader from '#lib/components/layout/TransitArticleHeader.svelte';
	import { desktop } from '@yesid/ui/state';
	import { Badge } from '@yesid/ui/badge';
	import { useAvailableSectionJump } from '#lib/site/availableSectionJump.svelte.ts';
	import { intl, getLocale, getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import { getProvenance } from '#lib/v1/repositories/provenance.ts';
	import { createResource } from '#lib/v1/resource.svelte.ts';
	import ConformanceBadge from '#lib/components/surface/ConformanceBadge.svelte';
	import { ArticleSectionStack } from '#lib/components/layout/index.ts';
	import { DetailFrame } from '@yesid/ui/layout';
	import { StateNotice } from '@yesid/ui/feedback';
	import {
		SectionLabel,
		SectionHeading,
		CollapsibleSection,
		SectionIcon,
		TocNav,
		type TocEntry,
	} from '@yesid/ui/brand';
	import SectionsToggle from '#lib/components/shared/SectionsToggle.svelte';
	import { TypedInformationCard } from '#lib/components/shared/index.ts';
	import {
		METRICS,
		METRIC_CLUSTER_ORDER,
		methodologyNoteFor,
		type MetricEntry,
	} from './metrics.content';
	import { metricsCopy } from './metrics.copy';
	import MetricBody, { type MetricSqlHtml } from './MetricBody.svelte';

	const localizeHref = getLocalizeHref();

	let { sqlHtml, manifest = null }: { sqlHtml?: MetricSqlHtml; manifest?: Manifest | null } =
		$props();

	const locale: Locale = getLocale();
	const t = $derived(metricsCopy[locale]);

	const LACUNES_ANCHOR = 'structural-gaps';

	const LIVE_POSITIONS_ANCHOR = 'live-positions';

	const provenance = createResource(() => getProvenance());
	let desktopRailVisited = $state(false);
	$effect(() => {
		if (desktop.current) desktopRailVisited = true;
	});

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
			minN: intl.number(locale).format(minN),
			wilsonZ: intl.number(locale).format(wilsonZ),
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

	const record = createRecordStamp(
		() => manifest,
		() => provenance.data?.generated_utc ?? null,
	);
	const articleMeta = $derived(
		[
			record.meta(locale),
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

	const { navigation, navigate } = useAvailableSectionJump(
		() => tocEntries,
		(id) => id === CONFIDENCE_INTERVALS_ANCHOR,
	);
</script>

{#snippet statCards()}
	<div class="metrics-stat-rail">
		{#if desktopRailVisited && (provenance.data?.conformance || provenanceUnavailable)}
			<CollapsibleSection title={t.statRail.provenance.title} headerVariant="article-summary">
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
							aria-live="polite"
						/>
					{/if}
				</div>
			</CollapsibleSection>
		{/if}

		<CollapsibleSection title={t.statRail.coverage.title} headerVariant="article-summary">
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
						<li><Badge variant="tag">{info.chip}</Badge></li>
					{/each}
				</ul>
			</div>
		</CollapsibleSection>
	</div>
{/snippet}

<DetailFrame
	class="metrics-detail"
	railScroll
	toc={{
		entries: tocEntries,
		navigation,
		landFragments: true,
		onNavigate: (id) => {
			void navigate(id);
		},
		openAria: t.tocPill.open,
		closeAria: t.tocPill.close,
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
			metaPending={provenance.loading || !provenance.settled || record.pending}
			titleId="metrics-title"
		>
			{#snippet controls()}
				<SectionsToggle />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet left()}
		<div class="metrics-toc-rail">
			<TocNav
				entries={tocEntries}
				{navigation}
				onNavigate={(id) => {
					void navigate(id);
				}}
				heading={t.tocLabel}
				counterPrefix={t.tocCounterPrefix}
			/>

			<aside class="metrics-stat-aside" aria-label={t.statRail.label}>
				{@render statCards()}
			</aside>
		</div>
	{/snippet}

	<ArticleSectionStack data-testid="metrics-sections">
		<div class="section-block" id={PROVENANCE_ANCHOR}>
			<CollapsibleSection
				title={t.provenance.label}
				headerVariant="article-summary"
				subtitle={t.questions.provenance}
				anchor={PROVENANCE_ANCHOR}
				open={true}
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
							aria-live="polite"
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
								<p class="metric__prose" role="status" data-testid="metrics-doctrine-absent">
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
									<Badge variant="tag">{info.chip}</Badge>
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
								open={true}
							>
								<div class="metric__body">
									<p class="metric__meta">
										<code class="metric__sci">{entry.sciName}</code>
										<Badge variant="tag">{confidenceMeaning(entry)}</Badge>
									</p>

									<div class="metric__information-stack">
										<MetricBody {entry} {locale} sqlHtml={sqlHtml?.[entry.key]} />

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
				subtitle={t.questions.positions}
				anchor={LIVE_POSITIONS_ANCHOR}
				open={true}
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
				subtitle={t.questions.gaps}
				anchor={LACUNES_ANCHOR}
				open={true}
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
</DetailFrame>

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
	.metrics-measure__heading,
	.metrics-lacunes__heading,
	.metrics-live__heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-reading-heading);
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
		font-size: var(--text-reading-support);
		line-height: 1.7;
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
	.metrics-lacunes__lede,
	.metrics-live__lede {
		color: var(--muted-foreground);
	}
	.metrics-lacunes__list,
	.metrics-live__list {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.metrics-lacunes__gap,
	.metrics-live__point {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-block-start: 1.25rem;
		border-block-start: 1px solid var(--border-hairline, var(--border));
	}
	.metrics-lacunes__gap:first-child,
	.metrics-live__point:first-child {
		padding-block-start: 0;
		border-block-start: none;
	}
	.metric__top {
		display: inline-flex;
		min-block-size: var(--size-tap-min);
		align-items: center;
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
		font-size: var(--text-reading);
		line-height: 1.7;
	}

	@media (--desktop-min) {
		.metrics-article-prose,
		.metrics-live__lede,
		.metrics-live__point p,
		.metrics-lacunes__lede,
		.metrics-lacunes__gap p {
			font-size: var(--text-reading-desktop);
		}
		.metrics-measure__heading,
		.metrics-lacunes__heading,
		.metrics-live__heading {
			font-size: var(--text-reading-heading-desktop);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.metric__top {
			transition: none;
		}
	}
</style>
