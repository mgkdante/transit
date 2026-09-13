<script lang="ts">
	import { localizeHref, type Locale } from '$lib/i18n';
	import { routeFor } from '$lib/nav';
	import { FilterGroup, FilterSummary } from '$lib/components/filter';
	import { layout } from '$lib/nav/layout.svelte';
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
	let filtersOpen = $state(false);
	let filterDisclosure = $state<HTMLDetailsElement>();
	function closeFilters(event: KeyboardEvent): void {
		if (
			event.key !== 'Escape' ||
			layout.isDesktop ||
			!filterDisclosure?.contains(document.activeElement)
		)
			return;
		filtersOpen = false;
		filterDisclosure.querySelector('summary')?.focus();
	}

	$effect(() => {
		if (layout.isDesktop) filtersOpen = true;
	});

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
	const primaryEntries = $derived(
		['network-health', 'map'].flatMap((kind) =>
			groups
				.flatMap(({ entries }) => entries)
				.filter((entry) => entry.kind === 'surface' && entry.target.kind === kind),
		),
	);
	const directoryGroups = $derived(
		visibleGroups
			.map(({ group, entries }) => ({
				group,
				entries: filtersActive
					? entries
					: entries.filter((entry) => !primaryEntries.includes(entry)),
			}))
			.filter(({ entries }) => entries.length > 0),
	);

	const matchSummary = $derived.by(() => {
		const template = HOME_FILTER_COUNT_LABEL[locale];
		const isPlural = locale === 'fr' ? matchCount >= 2 : matchCount !== 1;
		return (isPlural ? template.plural : template.singular).replace('{count}', String(matchCount));
	});
</script>

<svelte:window onkeydown={closeFilters} />
<section class="home-explore" data-slot="home-explore" aria-labelledby="home-explore-title">
	<header class="home-intro" data-slot="home-audit-brief">
		<p class="home-kicker label-metric">{t.auditKicker}</p>
		<h1 id="home-explore-title">{t.headline} <span>{t.headlineAccent}</span></h1>
		<p class="home-lede">{t.auditBody}</p>
	</header>
	<nav aria-label={t.exploreNav}>
		{#if !filtersActive}
			<ul class="home-primary" data-slot="home-primary">
				{#each primaryEntries as entry (entryHref(entry))}
					<li>
						<a class="home-entry home-entry--primary" href={entryHref(entry)}
							>{@render entryBody(entry)}</a
						>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="directory-head">
			<h2>{t.exploreNav}</h2>
			<span class="label-metric" aria-live="polite">{matchSummary}</span>
		</div>
		<div class="hub-launch">
			<details class="home-filters" bind:this={filterDisclosure} bind:open={filtersOpen}>
				<summary>{t.filterLabel}<span aria-hidden="true">+</span></summary>
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
					{#if filtersActive}<FilterSummary
							count={matchCount}
							countLabel={HOME_FILTER_COUNT_LABEL}
							onClear={clearFilters}
						/>{/if}
				</div>
			</details>
			<div class="launch-content">
				{#each directoryGroups as { group, entries } (group.key)}
					<section class="launch-group" aria-labelledby={`group-${group.key}`}>
						<h3 class="launch-group-question" id={`group-${group.key}`}>{group.question()}</h3>
						<ul class="launch-grid">
							{#each entries as entry (entryHref(entry))}
								<li>
									<a class="home-entry" href={entryHref(entry)}>{@render entryBody(entry)}</a>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
				{#if matchCount === 0}
					<StateNotice
						class="home-empty"
						title={t.filterEmpty}
						glyph="○"
						presentation="silo"
						role="status"
						ariaLive="polite"
					>
						{#snippet action()}<button class="home-clear" type="button" onclick={clearFilters}
								>{t.clearFilters}</button
							>{/snippet}
					</StateNotice>
				{/if}
			</div>
		</div>
	</nav>
</section>

{#snippet entryBody(entry: HomeEntry)}
	<span class="home-entry-copy"
		><span class="home-entry-title">{entry.title[locale]}</span><span class="home-entry-description"
			>{entry.desc[locale]}</span
		></span
	>
	<span class="home-entry-arrow" aria-hidden="true">↗</span>
{/snippet}

<style>
	.home-explore {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 3rem);
		width: 100%;
		padding-bottom: 3rem;
	}
	.home-kicker {
		margin: 0 0 1rem;
		color: var(--accent-text);
	}
	.home-intro h1 {
		margin: 0;
		font-family: var(--font-heading);
		font-size: clamp(2.5rem, 5.6vw, 5.5rem);
		font-weight: 800;
		line-height: 1.05;
		letter-spacing: var(--tracking-tight);
		text-wrap: balance;
	}
	.home-intro h1 span {
		display: block;
		color: var(--accent-text);
	}
	.home-lede {
		max-width: var(--measure-body);
		margin: 1.25rem 0 0;
		font-size: var(--text-body);
		line-height: 1.6;
		color: var(--secondary-foreground);
	}
	.home-primary,
	.launch-grid {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.home-primary {
		display: grid;
		gap: 1px;
		background: var(--border-brand);
		border: 1px solid var(--border-brand);
	}
	.home-primary li {
		min-width: 0;
		display: flex;
	}
	.home-entry {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1.5rem;
		width: 100%;
		min-height: 44px;
		padding: 1.25rem 0;
		border-bottom: 1px solid var(--border-subtle);
		text-decoration: none;
		color: var(--foreground);
		transition: color var(--duration-fast) var(--ease-default);
	}
	.home-entry--primary {
		padding: clamp(1.25rem, 3vw, 2rem);
		background: var(--card);
		border: 0;
	}
	.home-entry-copy {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.home-entry-title {
		font-family: var(--font-heading);
		font-size: var(--text-body);
		font-weight: 800;
		line-height: 1.25;
		letter-spacing: var(--tracking-tight);
	}
	.home-entry--primary .home-entry-title {
		font-size: var(--text-heading);
	}
	.home-entry-description {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.6;
		max-width: var(--measure-lede);
	}
	.home-entry-arrow {
		color: var(--accent-text);
		font-family: var(--font-mono);
		font-size: 1.25rem;
		line-height: 1.25;
		transition: transform var(--duration-fast) var(--ease-out);
	}
	.home-entry:hover {
		color: var(--accent-text);
	}
	.home-entry:hover .home-entry-arrow {
		transform: translate(2px, -2px);
	}
	.home-entry:focus-visible,
	.home-clear:focus-visible {
		outline: 2px solid var(--accent-text);
		outline-offset: 4px;
	}
	.home-entry--primary:focus-visible {
		outline-offset: -5px;
	}
	.directory-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		margin: 2.5rem 0 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-brand);
	}
	.directory-head h2 {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-heading);
		font-weight: 800;
		letter-spacing: var(--tracking-tight);
	}
	.directory-head > span {
		color: var(--muted-foreground);
	}
	.hub-launch {
		display: grid;
		grid-template-columns: 1fr;
		gap: 2rem;
	}
	.home-filters {
		min-width: 0;
	}
	.home-filters summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 48px;
		padding: 0.75rem 0;
		color: var(--accent-text);
		font-family: var(--font-mono);
		cursor: pointer;
		border-bottom: 1px solid var(--border-brand);
		list-style: none;
	}
	.home-filters summary::-webkit-details-marker {
		display: none;
	}
	.home-filters[open] summary span {
		transform: rotate(45deg);
	}
	.home-filters summary:focus-visible {
		outline: 2px solid var(--accent-text);
		outline-offset: 4px;
	}
	.explore-filters {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
		padding-top: 1rem;
	}
	.launch-content {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		min-width: 0;
	}
	.launch-group-question {
		margin: 0;
		color: var(--accent-text);
		font-family: var(--font-heading);
		font-size: var(--text-body);
		font-weight: 800;
		line-height: 1.4;
	}
	.home-clear {
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		color: var(--accent-text);
		text-decoration: underline;
		cursor: pointer;
	}
	.home-explore :global(.home-empty [data-part='surface']) {
		flex-wrap: wrap;
	}
	.home-explore :global(.home-empty [data-slot='state-notice-action']) {
		flex-basis: 100%;
	}
	@media (min-width: 640px) {
		.home-primary {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.launch-grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: 2rem;
		}
	}
	@media (min-width: 1024px) {
		.hub-launch {
			grid-template-columns: 17rem minmax(0, 1fr);
			gap: 3rem;
			align-items: start;
		}
		.home-filters {
			position: sticky;
			top: var(--chrome-offset);
			max-height: calc(100dvh - var(--chrome-offset) - 1rem);
			overflow-y: auto;
			overscroll-behavior: contain;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.home-entry,
		.home-entry-arrow {
			transition: none;
		}
		.home-entry:hover .home-entry-arrow {
			transform: none;
		}
	}
</style>
