<script lang="ts">
	import { localizeHref, type Locale } from '$lib/i18n';
	import { routeFor } from '$lib/nav';
	import { FilterGroup, FilterSummary } from '$lib/components/filter';
	import { observeViewportPresence } from '$lib/components/shared';
	import { SurfaceRail } from '$lib/components/surface';
	import { StateNotice } from '$lib/components/edge';
	import {
		HOME_FILTER_COUNT_LABEL,
		homeGroups,
		type HomeCopy,
		type HomeEntry,
		type HomeGroup,
		type HomeTempo,
	} from './home.copy';

	interface Props {
		readonly locale: Locale;
		readonly copy: HomeCopy;
	}

	let { locale, copy: t }: Props = $props();

	function entryHref(entry: HomeEntry): string {
		const href = entry.kind === 'surface' ? routeFor(entry.target) : entry.href;
		return localizeHref(href, locale);
	}

	const groups = $derived(homeGroups(t));

	// ── EXPLORE filters (wayfinding v2) ─────────────────────────────────────────
	// Two single-select facets over the destination cards: the rider QUESTION
	// (one group) and the KIND of answer (tempo). null = "All". Plain page state,
	// no URL mirror — the home is a launchpad, not a shareable filtered view; the
	// four question groups are the default. Groups keep their heading while any
	// card in them matches; a group with no matching card hides whole.
	let activeQuestion = $state<HomeGroup['key'] | null>(null);
	let activeTempo = $state<HomeTempo | null>(null);
	let exploreVisible = $state(false);
	function setExploreVisible(visible: boolean): void {
		exploreVisible = visible;
	}

	const filtersActive = $derived(activeQuestion != null || activeTempo != null);
	const visibleGroups = $derived(
		groups
			.map((group) => ({
				group,
				entries:
					activeQuestion != null && group.key !== activeQuestion
						? []
						: group.entries.filter((entry) => activeTempo == null || entry.tempo === activeTempo),
			}))
			.filter(({ entries }) => entries.length > 0),
	);
	const matchCount = $derived(
		visibleGroups.reduce((count, group) => count + group.entries.length, 0),
	);
	function clearFilters(): void {
		activeQuestion = null;
		activeTempo = null;
	}

	const questionItems = $derived(
		groups.map((group) => ({ key: group.key, label: group.question() })),
	);
	const tempoItems = $derived([
		{ key: 'now', label: t.tempoNow },
		{ key: 'record', label: t.tempoRecord },
		{ key: 'method', label: t.tempoMethod },
	]);
	const tempoTag = $derived<Record<HomeTempo, string>>({
		now: t.tempoNow,
		record: t.tempoRecord,
		method: t.tempoMethod,
	});

	// The FilterSummary count phrasing + the mobile pill summary share one
	// per-locale plural rule (FR: 0 and 1 are singular; EN: only 1 is).
	const pillSummary = $derived.by(() => {
		const template = HOME_FILTER_COUNT_LABEL[locale];
		const isPlural = locale === 'fr' ? matchCount >= 2 : matchCount !== 1;
		return (isPlural ? template.plural : template.singular).replace('{count}', String(matchCount));
	});
</script>

<!-- 3. EXPLORE — the LEFT FILTER RAIL beside the destination cards. The rail is
     the site's ONE rail grammar (SurfaceRail: sticky glass panel ≥1024, pill→sheet
     below) carrying the two facets + the match summary; the four rider-question
     groups stay the default view, and a group hides whole when nothing in it
     matches. -->
<div class="hub-launch" data-slot="home-explore" use:observeViewportPresence={setExploreVisible}>
	{#snippet exploreRail()}
		<div class="explore-filters" role="group" aria-label={t.filterLabel}>
			<FilterGroup
				label={t.filterByQuestion}
				items={questionItems}
				activeKey={activeQuestion}
				density="spacious"
				onSelect={(key) => (activeQuestion = key as HomeGroup['key'] | null)}
				testIdPrefix="hub-filter-question"
			/>
			<FilterGroup
				label={t.filterByKind}
				items={tempoItems}
				activeKey={activeTempo}
				density="spacious"
				onSelect={(key) => (activeTempo = key as HomeTempo | null)}
				testIdPrefix="hub-filter-kind"
			/>
			{#if filtersActive}
				<FilterSummary
					count={matchCount}
					countLabel={HOME_FILTER_COUNT_LABEL}
					onClear={clearFilters}
				/>
			{/if}
		</div>
	{/snippet}
	<SurfaceRail
		rail={exploreRail}
		label={t.filterLabel}
		summary={pillSummary}
		openAria={t.filterOpen}
		closeAria={t.filterClose}
		mobileVisible={exploreVisible}
	/>

	<nav class="launch-content" aria-label={t.exploreNav}>
		{#each visibleGroups as { group, entries } (group.key)}
			{@render launchGroup(group, entries)}
		{/each}
		{#if matchCount === 0}
			<StateNotice
				title={t.filterEmpty}
				glyph="○"
				presentation="silo"
				role="status"
				ariaLive="polite"
			/>
		{/if}
	</nav>
</div>

<!-- A wayfinding group = a RIDER QUESTION as the heading + one plain sentence of
     scope (research 2026-07-09: task/question-led IA beats taxonomy labels like
     "Explore"/"Accountability"; a scope line under every section label tells the
     reader what's behind the click). ONE uniform tile grid; every group shares
     the SAME chassis + column template, rows equalized. `entries` arrives already
     facet-filtered (the group hides upstream when it empties). -->
{#snippet launchGroup(group: HomeGroup, entries: readonly HomeEntry[])}
	<section class="launch-group" aria-labelledby={`group-${group.key}`}>
		<div class="launch-group-head">
			<h2 class="launch-group-question" id={`group-${group.key}`}>{group.question()}</h2>
			<p class="launch-group-scope">{group.scope()}</p>
		</div>
		<ul class="launch-grid">
			{#each entries as entry (entry.glyph + entry.title.en)}
				<li>
					<a class="hub-tile" href={entryHref(entry)}>
						{@render tileBody(entry)}
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<!-- ONE card interior (wayfinding v2): big amber glyph + the KIND tag on the top
     row (the tag echoes the rail's second facet, so a card tells you what sort of
     answer it opens), heading-scale title, body-scale description that fills the
     width, and the Open CTA seated on a hairline footer. Real content mass in
     every corner — no left-stacked dead space. -->
{#snippet tileBody(entry: HomeEntry)}
	<span class="hub-tile-top">
		<span class="hub-tile-glyph" aria-hidden="true">{entry.glyph}</span>
		<span class="hub-tile-tag label-metric">{tempoTag[entry.tempo]}</span>
	</span>
	<span class="hub-tile-title">{entry.title[locale]}</span>
	<span class="hub-tile-desc">{entry.desc[locale]}</span>
	<span class="hub-tile-cta label-metric" aria-hidden="true">{t.enter} →</span>
{/snippet}

<style>
	/* ══ EXPLORE — [ FILTER RAIL | destination groups ] ══════════════════════════
	   The alerts-page grid grammar: one column below 1024 (the rail collapses to
	   SurfaceRail's pill→sheet), [15rem | content] at ≥1024 with the rail sticky.
	   The rail track is RESERVED — it holds its lane whether or not a filter is
	   active. */
	.hub-launch {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(1.5rem, 4vw, 2rem);
		width: 100%;
	}
	@media (min-width: 1024px) {
		.hub-launch {
			/* Wider rail (operator: filters need FULL legibility) — the chips get
			   room to breathe and never truncate a rider question. */
			grid-template-columns: 19rem minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}
	}
	/* The rail body: the two facet groups + the match summary in one column. */
	.explore-filters {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	.launch-content {
		display: flex;
		flex-direction: column;
		gap: 2.5rem;
		min-width: 0;
	}
	.launch-group {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	/* The rider QUESTION as a readable heading (plain language, not mono-caps
	   taxonomy) + one muted sentence of scope: the reader knows what a group
	   holds before scanning a single card. */
	.launch-group-head {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.launch-group-question {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-heading);
		font-weight: 800;
		letter-spacing: var(--tracking-tight);
		color: var(--foreground);
	}
	.launch-group-scope {
		margin: 0;
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	/* Every group shares the SAME column template + auto-rows:1fr — tiles are the
	   same width and every row is level, across all three groups. */
	.launch-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1.25rem;
		/* auto-FIT (not fill): empty tracks collapse so each question's tiles span
		   the full row edge-to-edge — no dead right half (felt symmetry). Rows stay
		   uniform WITHIN a group; the 2-tile method row breathes wider by design.
		   17rem floor: the v2 interiors carry heading-scale titles + body-scale
		   descriptions, which need the wider lane to read. */
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		grid-auto-rows: 1fr;
	}
	.launch-grid > li {
		min-width: 0;
		display: flex;
	}
	/* ONE tile chassis (wayfinding v2): big glyph + kind tag on the top row,
	   heading-scale title, body-scale description, Open CTA on a hairline footer.
	   Content fills the card — the interior earns its area instead of stacking
	   small type in the top-left corner. */
	.hub-tile {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 1.5rem 1.625rem 1.25rem;
		text-align: left;
		text-decoration: none;
		background-color: var(--card);
		color: var(--foreground);
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-out),
			box-shadow var(--duration-fast) var(--ease-out);
	}
	.hub-tile:hover {
		border-color: var(--border-brand-active);
		transform: translateY(-2px);
		box-shadow: var(--shadow-section);
	}
	.hub-tile:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	/* Top row: the glyph anchors the left, the KIND tag seats the top-right
	   corner — the same words as the rail's second facet, so filter and card
	   speak one language. */
	.hub-tile-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	/* The glyph rides the amber TEXT accent (station wayfinding) — distinct from
	   the reserved amber GROUND conversion CTA. */
	.hub-tile-glyph {
		font-family: var(--font-mono);
		font-size: clamp(1.75rem, 2vw, 2.25rem);
		line-height: 1;
		color: var(--accent-text);
	}
	.hub-tile-tag {
		color: var(--muted-foreground);
		white-space: nowrap;
		padding-top: 0.25rem;
	}
	.hub-tile-title {
		font-family: var(--font-heading);
		font-weight: 800;
		font-size: var(--text-heading);
		line-height: 1.15;
		letter-spacing: var(--tracking-tight);
	}
	.hub-tile-desc {
		color: var(--muted-foreground);
		font-size: var(--text-body);
		line-height: 1.6;
	}
	.hub-tile-cta {
		margin-top: auto;
		padding-top: 0.875rem;
		border-top: 1px solid var(--border-subtle);
		align-self: stretch;
		text-align: right;
		color: var(--primary);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.hub-tile {
			transition: none;
		}
		.hub-tile:hover {
			transform: none;
		}
	}
</style>
