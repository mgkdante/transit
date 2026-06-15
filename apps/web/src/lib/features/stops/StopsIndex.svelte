<!--
  StopsIndex — the Stops search surface (slice-9.3).

  The stops index is large (thousands of stops / ~847KB), so we NEVER render the
  whole catalogue: a search field filters by name or code and only the filtered,
  capped (100) set renders as linkable EntityRows. Before the rider types, we
  show a prompt rather than a wall of stops.

  Composes the surface spine: createResource(getStopsIndex) → ResourceBoundary
  for skeleton/error/empty, SurfaceHeader for the head, EntityList/EntityRow for
  the results. Reads locale via getLocale(); all copy is co-located in
  stops.copy.ts. Tokens only, no hex; --primary stays interactive-only.
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { getStopsIndex, type StopIndexEntry } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { ResourceBoundary, SurfaceHeader, EntityList, EntityRow } from '$lib/components/surface';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { indexCopy } from './stops.copy';

	const locale: Locale = getLocale();
	const t = $derived(indexCopy[locale]);

	const index = createResource(() => getStopsIndex());

	/** Max rows rendered at once — the catalogue is far too large to list whole. */
	const CAP = 100;

	let query = $state('');
	const trimmed = $derived(query.trim().toLowerCase());

	// Filtered set: name OR code substring match. Empty query ⇒ no rows (we show a
	// prompt instead of the full catalogue). Match count drives the "+N more" note.
	const matches = $derived.by<readonly StopIndexEntry[]>(() => {
		const stops = index.data?.stops ?? [];
		if (!trimmed) return [];
		return stops.filter(
			(s) =>
				s.name.toLowerCase().includes(trimmed) ||
				(s.code ?? '').toLowerCase().includes(trimmed) ||
				s.id.toLowerCase().includes(trimmed),
		);
	});

	const overflow = $derived(Math.max(0, matches.length - CAP));
</script>

<Surface width="bleed" class="stops-index">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede} />

	<div class="stops-search">
		<input
			type="search"
			class="stops-search-input"
			bind:value={query}
			placeholder={t.searchPlaceholder}
			aria-label={t.searchLabel}
			autocomplete="off"
			spellcheck="false"
		/>
	</div>

	<Separator variant="hazard" />

	<ResourceBoundary resource={index} lang={locale}>
		{#if !trimmed}
			<p class="stops-note">{t.searchPrompt}</p>
		{:else if matches.length === 0}
			<p class="stops-note">{t.noMatches}</p>
		{:else}
			<EntityList
				items={matches}
				key={(s) => s.id}
				max={CAP}
				truncatedLabel={overflow > 0 ? t.more(overflow) : undefined}
			>
				{#snippet row(stop)}
					<EntityRow
						target={{ kind: 'stop', id: stop.id }}
						{locale}
						glyph="■"
						title={stop.name}
						subtitle={stop.code ?? stop.id}
					/>
				{/snippet}
			</EntityList>
		{/if}
	</ResourceBoundary>
</Surface>

<style>
	.stops-search {
		max-width: 28rem;
	}
	.stops-search-input {
		width: 100%;
		padding: 0.75rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		transition: border-color 150ms ease;
	}
	.stops-search-input::placeholder {
		color: var(--muted-foreground);
	}
	.stops-search-input:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-color: var(--primary);
	}
	.stops-note {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
		padding: 0.5rem 0.875rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.stops-search-input {
			transition: none;
		}
	}
</style>
