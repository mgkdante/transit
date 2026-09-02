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

	const pillSummary = $derived.by(() => {
		const template = HOME_FILTER_COUNT_LABEL[locale];
		const isPlural = locale === 'fr' ? matchCount >= 2 : matchCount !== 1;
		return (isPlural ? template.plural : template.singular).replace('{count}', String(matchCount));
	});
</script>

<section
	class="home-explore"
	data-slot="home-explore"
	aria-labelledby="home-explore-title"
	use:observeViewportPresence={setExploreVisible}
>
	<h1 id="home-explore-title" class="explore-title">{t.exploreNav}</h1>
	<div class="hub-launch">
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
</section>

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
	.home-explore {
		display: flex;
		flex-direction: column;
		gap: clamp(1.5rem, 4vw, 2rem);
		width: 100%;
	}
	.explore-title {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-title);
		font-weight: 800;
		line-height: 1.1;
		letter-spacing: var(--tracking-tight);
		color: var(--foreground);
	}
	.hub-launch {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(1.5rem, 4vw, 2rem);
		width: 100%;
	}
	@media (min-width: 1024px) {
		.hub-launch {
			grid-template-columns: 19rem minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}
	}
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
	.launch-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1.25rem;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		grid-auto-rows: 1fr;
	}
	.launch-grid > li {
		min-width: 0;
		display: flex;
	}
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
	.hub-tile-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
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
