<!--
  LinesIndex — the Lines index screen (slice-9.3).

  Composes the surface spine: a SurfaceHeader over a filterable EntityList of
  every route from the static routes_index. Routes are sorted by short name
  (numeric-aware) and rendered as linkable EntityRows targeting the line detail
  surface; a leading mono glyph encodes the GTFS route_type.

  Data: static routes_index via createResource(getRoutesIndex) — wrapped in a
  ResourceBoundary so skeleton / error / empty render without bespoke plumbing.
  Locale comes from getLocale() context; non-intrinsic copy is co-located.
  Tokens, no hex; --primary stays interactive-only.
-->
<script lang="ts">
	import { getLocale } from '$lib/i18n';
	import { getRoutesIndex } from '$lib/v1';
	import type { RouteIndexEntry } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { ResourceBoundary, SurfaceHeader, EntityList, EntityRow } from '$lib/components/surface';
	import { indexCopy } from './lines.copy';

	const locale = getLocale();
	const t = $derived(indexCopy[locale]);

	const routes = createResource(() => getRoutesIndex());

	// GTFS route_type → decorative mono glyph (0 tram · 1 metro · 2 rail ·
	// 3 bus · 4 ferry); bus is the network default for anything unmapped.
	const TYPE_GLYPH: Record<number, string> = {
		0: '╤',
		1: '◉',
		2: '╪',
		3: '═',
		4: '≈',
	};
	const glyphFor = (type: number): string => TYPE_GLYPH[type] ?? '═';

	// Filter query (mono input); empty ⇒ the full catalogue.
	let query = $state('');

	// Numeric-aware sort by short name, then case-insensitive filter on
	// short/long. Derived from the loaded value (null before first success).
	const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });

	const visible = $derived.by<RouteIndexEntry[]>(() => {
		const all = routes.data?.routes ?? [];
		const sorted = [...all].sort((a, b) => collator.compare(a.short, b.short));
		const q = query.trim().toLowerCase();
		if (!q) return sorted;
		return sorted.filter(
			(r) => r.short.toLowerCase().includes(q) || (r.long ?? '').toLowerCase().includes(q),
		);
	});
</script>

<section class="lines-index">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} lede={t.lede}>
		<div class="lines-filter">
			<label class="label-metric" for="lines-filter-input">{t.filterLabel}</label>
			<input
				id="lines-filter-input"
				type="search"
				class="lines-filter-input"
				placeholder={t.filterPlaceholder}
				bind:value={query}
				autocomplete="off"
				spellcheck="false"
			/>
		</div>
	</SurfaceHeader>

	<ResourceBoundary resource={routes} lang={locale} isEmpty={(d) => d.routes.length === 0}>
		<EntityList items={visible} key={(r) => r.id}>
			{#snippet row(r)}
				<EntityRow
					target={{ kind: 'line', id: r.id }}
					{locale}
					glyph={glyphFor(r.type)}
					title={r.short}
					subtitle={r.long ?? undefined}
				/>
			{/snippet}
		</EntityList>
	</ResourceBoundary>
</section>

<style>
	.lines-index {
		max-width: var(--width-content);
		margin-inline: auto;
		padding: clamp(2rem, 6vw, 4rem) var(--space-page-x, 1.5rem);
		display: flex;
		flex-direction: column;
		gap: clamp(1.5rem, 4vw, 2.5rem);
	}
	.lines-filter {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: 28rem;
	}
	.lines-filter-input {
		width: 100%;
		padding: 0.6rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		transition: border-color 150ms ease;
	}
	.lines-filter-input::placeholder {
		color: var(--muted-foreground);
	}
	.lines-filter-input:focus-visible {
		outline: none;
		border-color: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.lines-filter-input {
			transition: none;
		}
	}
</style>
