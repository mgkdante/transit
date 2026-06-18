<!--
  SearchSurface — the Search screen (slice-9.3).

  Composes the surface spine over the two static discovery indexes:
    - getRoutesIndex() → RoutesIndex { routes: RouteIndexEntry[] }
    - getStopsIndex()  → StopsIndex  { stops:  StopIndexEntry[] }
  Both are STATIC-tier reads, so they go through createResource (client-side,
  reactive) and are gated by <ResourceBoundary> (skeleton while the indexes
  load, error+retry if /v1 is unreachable).

  A single <input> drives a `query` $state; the matches are $derived,
  case-insensitive, over (line id/short/long) and (stop id/name/code), each
  capped so a broad query can't render thousands of rows. The result region
  branches three ways:
    - empty query     → an instructional idle state (copy.idleTitle/Body)
    - zero matches    → <EdgeState variant="no-results">
    - matches         → two grouped <EntityList> sections (Lines / Stops)

  Each row is a linkable <EntityRow> resolving target {kind:'line'|'stop', id}
  through the nav layer (deep-link on mobile, panel-swap on desktop).

  DOCTRINE: Svelte 5 runes; tokens, no hex; --primary interactive-only (used on
  the focus ring + idle glyph stays on the dataviz-unknown scale via EdgeState);
  bilingual via getLocale + co-located copy; keyed {#each}; fail-soft — never
  invent data, never crash. Mirrors the hub head + surface padding.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { getLocale, type Locale } from '$lib/i18n';
	import { layout } from '$lib/nav';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		getRoutesIndex,
		getStopsIndex,
		type RouteIndexEntry,
		type StopIndexEntry,
	} from '$lib/v1';
	import {
		ResourceBoundary,
		SurfaceHeader,
		EntityList,
		EntityRow,
		SearchInput,
	} from '$lib/components/surface';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { EdgeState } from '$lib/components/edge';
	import { copy } from './search.copy';

	const locale: Locale = getLocale();
	const t = $derived(copy[locale]);
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	// Static discovery indexes — loaded client-side, gated by ResourceBoundary.
	const routes = createResource(() => getRoutesIndex());
	const stops = createResource(() => getStopsIndex());

	// Max rows rendered per group — a broad query can't flood the surface.
	const MAX_RESULTS = 50;

	// Seed the query from the URL `q` param once, so /search?q=berri deep-links
	// hydrate the input + results on load. Read at init only (not reactive) — the
	// input owns the value from here on; the empty state still owns the no-`q` case.
	let query = $state($page.url.searchParams.get('q') ?? '');
	const normalized = $derived(query.trim().toLowerCase());
	const hasQuery = $derived(normalized.length > 0);

	function matchRoute(r: RouteIndexEntry, q: string): boolean {
		return (
			r.id.toLowerCase().includes(q) ||
			r.short.toLowerCase().includes(q) ||
			(r.long?.toLowerCase().includes(q) ?? false)
		);
	}

	function matchStop(s: StopIndexEntry, q: string): boolean {
		return (
			s.id.toLowerCase().includes(q) ||
			s.name.toLowerCase().includes(q) ||
			(s.code?.toLowerCase().includes(q) ?? false)
		);
	}

	// Filtered, capped matches. Derived from the loaded indexes + the live query;
	// empty when nothing is typed (the idle state owns that case).
	const matchedRoutes = $derived(
		hasQuery && routes.data ? routes.data.routes.filter((r) => matchRoute(r, normalized)) : [],
	);
	const matchedStops = $derived(
		hasQuery && stops.data ? stops.data.stops.filter((s) => matchStop(s, normalized)) : [],
	);

	const hasResults = $derived(matchedRoutes.length > 0 || matchedStops.length > 0);

	// A line's title is its short name; the long name (when present) is subtitle.
	function routeTitle(r: RouteIndexEntry): string {
		return r.short || r.id;
	}
	// A stop's code (pole number) is a useful right-aligned meta when present.
	function stopMeta(s: StopIndexEntry): string | undefined {
		return s.code ?? undefined;
	}
</script>

<Surface width="bleed" class="surface">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} lede={t.lede} />

	<SearchInput
		id="surface-search-input"
		label={t.inputLabel}
		placeholder={t.inputPlaceholder}
		bind:value={query}
	/>

	<Separator variant="hazard" />

	<!--
	  Gate on BOTH indexes via a single boundary (routes is the gating resource;
	  the stops boundary nests so its own skeleton/error shows independently).
	  Empty query short-circuits to the idle state before any list renders.
	-->
	<ResourceBoundary resource={routes} lang={locale}>
		<ResourceBoundary resource={stops} lang={locale}>
			{#if !hasQuery}
				<!-- Idle — instructional, before the rider types anything. -->
				<div class="search-idle" role="note">
					<span class="search-idle-glyph" aria-hidden="true">⌕</span>
					<p class="search-idle-title">{t.idleTitle}</p>
					<p class="search-idle-body">{t.idleBody}</p>
				</div>
			{:else if !hasResults}
				<EdgeState variant="no-results" lang={locale} layout={edgeLayout} />
			{:else}
				<div class="search-results">
					{#if matchedRoutes.length > 0}
						<section class="search-group" aria-label={t.linesLabel}>
							<h2 class="search-group-head">
								<span class="search-group-label">{t.linesLabel}</span>
								<span class="search-group-count">{t.resultCount(matchedRoutes.length)}</span>
							</h2>
							<EntityList
								items={matchedRoutes}
								key={(r) => r.id}
								max={MAX_RESULTS}
								truncatedLabel={t.more(matchedRoutes.length - MAX_RESULTS)}
							>
								{#snippet row(r)}
									<EntityRow
										target={{ kind: 'line', id: r.id }}
										{locale}
										glyph="═"
										title={routeTitle(r)}
										subtitle={r.long ?? undefined}
									/>
								{/snippet}
							</EntityList>
						</section>
					{/if}

					{#if matchedStops.length > 0}
						<section class="search-group" aria-label={t.stopsLabel}>
							<h2 class="search-group-head">
								<span class="search-group-label">{t.stopsLabel}</span>
								<span class="search-group-count">{t.resultCount(matchedStops.length)}</span>
							</h2>
							<EntityList
								items={matchedStops}
								key={(s) => s.id}
								max={MAX_RESULTS}
								truncatedLabel={t.more(matchedStops.length - MAX_RESULTS)}
							>
								{#snippet row(s)}
									<EntityRow
										target={{ kind: 'stop', id: s.id }}
										{locale}
										glyph="■"
										title={s.name}
										meta={stopMeta(s)}
									/>
								{/snippet}
							</EntityList>
						</section>
					{/if}
				</div>
			{/if}
		</ResourceBoundary>
	</ResourceBoundary>
</Surface>

<style>
	.search-idle {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
		padding: clamp(2rem, 6vw, 3.5rem) 1.5rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
		box-shadow: var(--shadow-card);
	}
	.search-idle-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-heading);
		line-height: 1;
		color: var(--accent-text);
	}
	.search-idle-title {
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-subheading);
		color: var(--foreground);
	}
	.search-idle-body {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
		max-width: 40ch;
	}

	.search-results {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
	.search-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.search-group-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin: 0;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid var(--border);
	}
	.search-group-label {
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-subheading);
		color: var(--foreground);
	}
	.search-group-count {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
</style>
