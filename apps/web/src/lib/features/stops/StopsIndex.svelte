<!--
  StopsIndex — the Stops search surface (slice-9.3 · S8C redesign).

  Three combinable ways to reach a stop, plus an at-a-glance reliability read:

    (a) FIND BY TYPING — a diacritics-insensitive, word-order-free token match
        over name/code/id (foldSearchText + tokenMatchScore), deduped by logical
        stop, capped at 100 rendered rows (the catalogue is ~9k stops / ~847KB, so
        we NEVER list it whole; the cap bounds the DOM, not the match set). The
        typed query stays EPHEMERAL local state — it is a keystroke stream, not
        shareable view state, so it is never mirrored to the URL.

    (b) FIND BY LINE — a bits-ui typeahead combobox and browsable route catalogue.
        Picking a line
        loads that route's LOSSLESS static stop list (getRoute → directions[].stops)
        rather than the stops_index `routes[]` reverse index, which is CAPPED AT 5
        route-ids per stop and would silently drop stops for busy lines. The result
        is stop-sequence ordered + direction-grouped (DECISION C1), with every
        published direction represented in each 50-stop batch. The pick is
        codec-owned: it seeds from / mirrors to the existing `route` filter axis
        (?route=<id>), so a by-line view is shareable + round-trips. When a line has
        no published stop list, we say so honestly.

    (c) RELIABILITY BADGES — the shared lazy loader (createReliabilityLoader('stop'))
        gives each rendered row a headline OTP% + status verdict. Stops carry NO
        published availability flag (unlike routes), so this is the HONEST PROBE
        pattern: a bare, viewport-gated id that fail-softs on 404 — a stop with no
        history simply shows no badge (never a spinner storm, never a fabricated 0%).
        An optional worst-first sort keys off the LOADED verdict; unloaded rows sink.

  Composes the listing spine (BlueprintListingHeader + ListingPageShell +
  ResourceBoundary + EntityList/EntityResultRow). Locale via getLocale(); all copy
  in stops.copy.ts. Tokens
  only, no hex; --primary stays interactive-only.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, type Locale } from '$lib/i18n';
	import { layout, mapHrefFor } from '$lib/nav';
	import { createReliabilityLoader } from '$lib/v1/reliabilitySnapshot.svelte';
	import { getRoute, getRoutesIndex, getStopsIndex } from '$lib/v1/repositories/static';
	import type { RouteIndexEntry } from '$lib/v1/schemas/routes_index';
	import type { StopIndexEntry } from '$lib/v1/schemas/stops_index';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		ResourceBoundary,
		EntityList,
		EntityRow,
		EntityResultRow,
		ReliabilityBadge,
		MapDrilldownLink,
		createReliabilityListingController,
	} from '$lib/components/surface';
	import { BlueprintListingHeader, ListingPageShell } from '$lib/components/layout';
	import { EdgeState, StateNotice } from '$lib/components/edge';
	import {
		FilterGroup,
		ListingFilterPanel,
		ListingFilterSection,
		ListingSearchField,
	} from '$lib/components/filter';
	import { Combobox, type ComboboxOption } from '@yesid/ui/combobox';
	import { fromSearchParams } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { dedupeBy, foldSearchText, tokenMatchScore } from '$lib/search/normalize';
	import { stopGroupKey, stopModeHint, stopModeTag, routeModeHint } from '$lib/search/stopMode';
	import { indexCopy } from './stops.copy';
	import StopsBlueprint from './StopsBlueprint.svelte';

	const locale: Locale = getLocale();
	const t = $derived(indexCopy[locale]);
	const listingSubtitle = $derived([t.kicker, t.subheading].filter(Boolean).join(' '));
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	const index = createResource(() => getStopsIndex());
	const routesIndex = createResource(() => getRoutesIndex());

	// The SHARED lazy reliability loader, scoped to this surface (one cache +
	// concurrency budget, torn down with the page). Stops have NO discovery index,
	// so this is the honest per-row probe: viewport-gated, fail-soft on 404.
	const reliability = createReliabilityLoader('stop');
	const observeReliability = reliability.reliability;

	/** Shared incremental batch — bounds both the stop DOM and the line chooser. */
	const PAGE_SIZE = 50;
	const SEARCH_CAP = 100;

	// ── (a) find-by-typing — ephemeral, never mirrored ──────────────────────────
	let query = $state('');
	const folded = $derived(foldSearchText(query));

	// ── (b) find-by-line — codec-owned via the `route` axis ─────────────────────
	// Seed the selected line from ?route= (the codec's existing route id set — we
	// take the FIRST id; the picker is single-select). SSR-safe: page.url exists on
	// both sides, the codec is pure. The typed line query lives inside the combobox.
	function seedLineFromUrl(): string | null {
		const state = fromSearchParams(page.url.searchParams);
		const first = [...state.routes][0];
		return first ?? null;
	}
	let selectedLineId = $state<string | null>(seedLineFromUrl());

	// Mirror the pick back to the URL on change (reuse the `route` wire key, NOT a
	// bespoke ?line — stop/route ids are already FilterState axes). Free text is
	// NOT mirrored. `null` drops the key for a clean canonical URL.
	$effect(() => {
		mirrorSearchParams({ route: selectedLineId });
	});

	// The combobox options: every route, tagged with its mode glyph + long name,
	// with a precomputed folded search haystack (id + short + long) so typing is
	// diacritics-insensitive without re-folding per keystroke.
	const routeCollator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
	const sortedRoutes = $derived.by<RouteIndexEntry[]>(() =>
		[...(routesIndex.data?.routes ?? [])].sort((a, b) => routeCollator.compare(a.short, b.short)),
	);
	const lineOptions = $derived.by<ComboboxOption[]>(() => {
		return sortedRoutes.map((r) => ({
			value: r.id,
			label: r.short,
			sublabel: r.long ?? undefined,
			glyph: routeModeHint(r.type).glyph,
			search: foldSearchText([r.id, r.short, r.long].filter(Boolean).join(' ')),
		}));
	});
	const selectedLine = $derived<RouteIndexEntry | undefined>(
		(routesIndex.data?.routes ?? []).find((r) => r.id === selectedLineId),
	);

	// The picked line's LOSSLESS static stop list. createResource re-runs when the
	// id it reads changes; null id ⇒ no fetch (returns null). getRoute 404 ⇒ null
	// ⇒ honest "no published stop list" state (never an error).
	const lineRoute = createResource(
		() => {
			const id = selectedLineId;
			return id ? getRoute(id) : Promise.resolve(null);
		},
		{ key: () => selectedLineId },
	);

	// Join a route's directions[].stops back to the stops_index (for code/mode/route
	// chips), preserving stop-sequence order and grouping BY DIRECTION (DECISION C1).
	// A stop present in the route file but absent from the index still renders (id +
	// seq name) so the list is never silently short.
	interface LineStopGroup {
		readonly key: string;
		readonly dir: number;
		readonly headsign?: string | null;
		readonly stops: readonly StopIndexEntry[];
	}
	const lineStopGroups = $derived.by<LineStopGroup[]>(() => {
		const route = lineRoute.data;
		if (!route?.directions) return [];
		// Plain object maps for a transient id→entry lookup (not reactive state — this
		// whole value is a pure $derived recomputation, so SvelteMap/SvelteSet buy
		// nothing; the lint rule just forbids the built-ins here).
		const byId: Record<string, StopIndexEntry> = {};
		for (const s of index.data?.stops ?? []) byId[s.id] = s;
		return route.directions
			.map((d, directionIndex) => {
				const seen: Record<string, true> = {};
				const stops: StopIndexEntry[] = [];
				// stops are published in sequence order; dedupe within a direction only.
				for (const rs of [...(d.stops ?? [])].sort((a, b) => a.seq - b.seq)) {
					if (seen[rs.id]) continue;
					seen[rs.id] = true;
					stops.push(
						byId[rs.id] ?? {
							id: rs.id,
							name: rs.name ?? rs.id,
							lat: 0,
							lon: 0,
						},
					);
				}
				return {
					key: `${d.dir}:${directionIndex}:${d.headsign ?? ''}`,
					dir: d.dir,
					headsign: d.headsign,
					stops,
				};
			})
			.filter((g) => g.stops.length > 0);
	});

	// ── (a) text-match set (used only when NO line is selected) ─────────────────
	const matches = $derived.by<readonly StopIndexEntry[]>(() => {
		const stops = index.data?.stops ?? [];
		if (!folded) return [];
		const ranked = stops
			.map((s) => ({ s, score: tokenMatchScore([s.name, s.code, s.id], folded) }))
			.filter((m): m is { s: StopIndexEntry; score: number } => m.score != null)
			.sort((a, b) => a.score - b.score)
			.map((m) => m.s);
		// One row per logical stop — métro/station names collapse to a single station.
		return dedupeBy(ranked, stopGroupKey);
	});

	const overflow = $derived(Math.max(0, matches.length - SEARCH_CAP));

	// When a line is picked, its (direction-grouped, sequence-ordered) stops drive
	// the result — optionally further narrowed by the free-text box (compose both).
	// Otherwise the text-match set drives it.
	const lineActive = $derived(selectedLineId != null);
	function narrowByText(stops: readonly StopIndexEntry[]): readonly StopIndexEntry[] {
		if (!folded) return stops;
		return stops.filter((s) => tokenMatchScore([s.name, s.code, s.id], folded) != null);
	}

	// ── (c) reliability sort (worst-first) ─────────────────────────────────────
	type SortKey = 'default' | 'worst';
	let sort = $state<SortKey>('default');
	const sortAllLabel = { en: indexCopy.en.sortDefault, fr: indexCopy.fr.sortDefault };
	const VERDICT_RANK: Record<string, number> = { severe: 0, late: 1, on_time: 2 };
	// The complete active result set is eligible: every stop on a picked line, or
	// every text match that the catalogue may rank before its existing render cap.
	// Requesting enters the loader's existing four-wide queue, so this fills coverage
	// without bypassing cache/concurrency. Source order remains frozen until every
	// eligible snapshot is terminal, then one ranking is committed.
	const reliabilityCandidates = $derived.by<readonly StopIndexEntry[]>(() =>
		lineActive ? lineStopGroups.flatMap((group) => narrowByText(group.stops)) : matches,
	);
	const reliabilityListing = createReliabilityListingController({
		loader: reliability,
		candidates: () => reliabilityCandidates,
		id: (stop) => stop.id,
		requestWhen: () => sort === 'worst',
		rankWhen: () => sort === 'worst',
		rank: (snapshot) => (snapshot.verdict == null ? 99 : (VERDICT_RANK[snapshot.verdict] ?? 99)),
	});
	const visibleGroups = $derived.by<LineStopGroup[]>(() =>
		lineStopGroups
			.map((g) => ({ ...g, stops: reliabilityListing.order(narrowByText(g.stops)) }))
			.filter((g) => g.stops.length > 0),
	);
	const sortedMatches = $derived(reliabilityListing.order(matches));

	let visibleStopLimit = $state(PAGE_SIZE);
	let stopPageKey = $state('');
	$effect(() => {
		const nextKey = `${selectedLineId ?? ''}|${folded}|${sort}`;
		if (nextKey === stopPageKey) return;
		stopPageKey = nextKey;
		visibleStopLimit = PAGE_SIZE;
	});
	const lineStopTotal = $derived(
		visibleGroups.reduce((total, group) => total + group.stops.length, 0),
	);
	const shownStopCount = $derived(Math.min(visibleStopLimit, lineStopTotal));
	const nextStopBatch = $derived(Math.min(PAGE_SIZE, Math.max(0, lineStopTotal - shownStopCount)));
	const pagedGroups = $derived.by<LineStopGroup[]>(() => {
		const quotas = visibleGroups.map(() => 0);
		let remaining = shownStopCount;
		while (remaining > 0) {
			let progressed = false;
			for (let index = 0; index < visibleGroups.length && remaining > 0; index += 1) {
				if (quotas[index] >= visibleGroups[index].stops.length) continue;
				quotas[index] += 1;
				remaining -= 1;
				progressed = true;
			}
			if (!progressed) break;
		}
		return visibleGroups
			.map((group, index) => ({ ...group, stops: group.stops.slice(0, quotas[index]) }))
			.filter((group) => group.stops.length > 0);
	});

	const stopCount = $derived(index.data?.stops?.length ?? null);
	const lineCount = $derived(routesIndex.data?.routes?.length ?? null);
	const stopModesComplete = $derived(
		index.data != null && index.data.stops.every((stop) => stop.mode != null),
	);
	const busStopCount = $derived(
		!stopModesComplete || index.data == null
			? null
			: index.data.stops.filter((stop) => stop.mode === 'bus').length,
	);
	const metroStopCount = $derived(
		!stopModesComplete || index.data == null
			? null
			: index.data.stops.filter((stop) => stop.mode === 'metro').length,
	);
	const numberFmt = $derived(new Intl.NumberFormat(locale));
	const inventoryStats = $derived([
		{
			label: t.inventory.stops,
			value: stopCount == null ? null : numberFmt.format(stopCount),
		},
		{
			label: t.inventory.bus,
			value: busStopCount == null ? null : numberFmt.format(busStopCount),
		},
		{
			label: t.inventory.metro,
			value: metroStopCount == null ? null : numberFmt.format(metroStopCount),
		},
		{
			label: t.inventory.lines,
			value: lineCount == null ? null : numberFmt.format(lineCount),
		},
	]);
	let visibleLineLimit = $state(PAGE_SIZE);
	const visibleBrowseLines = $derived(sortedRoutes.slice(0, visibleLineLimit));
	const nextLineBatch = $derived(
		Math.min(PAGE_SIZE, Math.max(0, sortedRoutes.length - visibleBrowseLines.length)),
	);
</script>

{#snippet listingBlueprint()}
	<StopsBlueprint />
{/snippet}

{#snippet listingHeader()}
	<BlueprintListingHeader
		heading={t.heading}
		subtitle={listingSubtitle}
		description={t.lede}
		statsLabel={t.inventory.label}
		statsUnknownLabel={t.inventory.unavailable}
		stats={inventoryStats}
		blueprint={listingBlueprint}
	/>
{/snippet}

{#snippet listingSearch()}
	<ListingSearchField
		label={t.searchLabel}
		placeholder={t.searchPlaceholder}
		testId="stops-filter-input"
		bind:value={query}
	/>
{/snippet}

{#snippet listingFilters()}
	<ListingFilterPanel showSearch={false}>
		<ListingFilterSection>
			<div class="stops-line-filter">
				<span class="label-section text-sm font-semibold">{t.lineLabel}</span>
				<Combobox
					options={lineOptions}
					bind:value={selectedLineId}
					label={t.lineLabel}
					placeholder={t.linePlaceholder}
					clearLabel={t.lineClear}
					emptyLabel={t.lineEmpty}
					fold={foldSearchText}
				/>
			</div>
		</ListingFilterSection>

		<ListingFilterSection>
			<FilterGroup
				label={t.sortLabel}
				items={[{ key: 'worst', label: t.sortWorst }]}
				activeKey={sort === 'default' ? null : sort}
				allLabel={sortAllLabel}
				allowDeselect={false}
				collapsible
				persistKey="stops-filter-sort-group"
				testIdPrefix="stops-sort"
				onSelect={(key) => (sort = key === 'worst' ? 'worst' : 'default')}
			/>
		</ListingFilterSection>
	</ListingFilterPanel>
{/snippet}

<ListingPageShell
	heading={t.heading}
	filterLabel={t.controlsLabel}
	filterPersistKey="stops-listing-filters"
	header={listingHeader}
	search={listingSearch}
	filters={listingFilters}
>
	<ResourceBoundary resource={routesIndex} lang={locale}>
		<ResourceBoundary resource={index} lang={locale}>
			<p class="sr-only" role="status" aria-live="polite" data-testid="stops-ranking-status">
				{reliabilityListing.rankingPending ? t.rankingPending : ''}
			</p>
			{#if lineActive}
				<!-- BY-LINE view. We gate on the per-route fetch MANUALLY (not a nested
			     ResourceBoundary) so a 404 / empty list states the SPECIFIC honest
			     reason ("no published stop list for this line") rather than a generic
			     no-data edge. A route transition never leaks the previous line or flashes
			     that empty verdict: the shared delayed skeleton owns the pending frame. -->
				{#if lineRoute.loading}
					<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
				{:else if visibleGroups.length === 0}
					{#if lineRoute.settled}
						<StateNotice
							title={folded ? t.noMatches : t.noLineStops}
							presentation="silo"
							role="status"
							ariaLive="polite"
						/>
					{/if}
				{:else}
					{#if selectedLine}
						<h2 class="stops-line-heading">{t.onLineHeading(selectedLine.short)}</h2>
					{/if}
					{#each pagedGroups as group (group.key)}
						<section class="stops-line-group" aria-label={t.direction(group.dir, group.headsign)}>
							<h3 class="stops-line-dir">{t.direction(group.dir, group.headsign)}</h3>
							<EntityList items={group.stops} key={(s) => s.id} cards>
								{#snippet row(stop)}
									{@render stopRow(stop)}
								{/snippet}
							</EntityList>
						</section>
					{/each}
					<div class="stops-batch-controls">
						<p role="status" aria-label={t.browse.progressLabel}>
							{t.browse.progress(shownStopCount, lineStopTotal)}
						</p>
						{#if nextStopBatch > 0}
							<button
								type="button"
								class="stops-load-more tap-press"
								onclick={() => (visibleStopLimit += PAGE_SIZE)}
							>
								{t.browse.loadMore(nextStopBatch)}
							</button>
						{/if}
					</div>
				{/if}
			{:else if !folded}
				<section class="stops-browse" aria-labelledby="stops-browse-heading">
					<div class="stops-browse-head">
						<h2 id="stops-browse-heading">{t.browse.heading}</h2>
						<p>{t.browse.lede}</p>
					</div>
					<EntityList
						items={visibleBrowseLines}
						key={(route) => route.id}
						grid
						cards
						minTile="360px"
					>
						{#snippet row(route)}
							{@const modeHint = routeModeHint(route.type)}
							{@const accessibleLineName = [modeHint.tag, route.long].filter(Boolean).join(' ')}
							<EntityRow
								onSelect={() => (selectedLineId = route.id)}
								ariaLabel={t.browse.chooseLine(route.short, accessibleLineName)}
								glyph={modeHint.glyph}
								tag={modeHint.tag ?? undefined}
								title={route.short}
								subtitle={route.long ?? undefined}
								meta="→"
							/>
						{/snippet}
					</EntityList>
					{#if nextLineBatch > 0}
						<div class="stops-browse-more">
							<button
								type="button"
								class="stops-load-more tap-press"
								onclick={() => (visibleLineLimit += PAGE_SIZE)}
							>
								{t.browse.showMoreLines(nextLineBatch)}
							</button>
						</div>
					{/if}
				</section>
			{:else if matches.length === 0}
				<StateNotice title={t.noMatches} presentation="silo" role="status" ariaLive="polite" />
			{:else}
				<EntityList
					items={sortedMatches}
					key={(s) => s.id}
					max={SEARCH_CAP}
					cards
					truncatedLabel={overflow > 0 ? t.more(overflow) : undefined}
				>
					{#snippet row(stop)}
						{@render stopRow(stop)}
					{/snippet}
				</EntityList>
			{/if}
		</ResourceBoundary>
	</ResourceBoundary>
</ListingPageShell>

{#snippet stopRow(stop: StopIndexEntry)}
	{@const hint = stopModeHint(stop)}
	{@const stopSnapshot = reliability.get(stop.id)}
	<div use:observeReliability={stop.id}>
		{#snippet stopMain()}
			<EntityRow
				target={{ kind: 'stop', id: stop.id }}
				{locale}
				glyph={hint.glyph}
				tag={stopModeTag(stop) ?? undefined}
				title={stop.name}
				subtitle={stop.code ?? undefined}
				routes={stop.routes}
			/>
		{/snippet}
		{#snippet stopStatus()}
			<ReliabilityBadge snapshot={stopSnapshot} {locale} />
		{/snippet}
		{#snippet stopAction()}
			<MapDrilldownLink
				href={mapHrefFor({ stop: stop.id }, locale)}
				label={t.mapAction}
				ariaLabel={t.viewStopOnMap(stop.code ?? stop.name)}
			/>
		{/snippet}
		<EntityResultRow
			children={stopMain}
			status={stopSnapshot.otpPct == null ? undefined : stopStatus}
			action={stopAction}
		/>
	</div>
{/snippet}

<style>
	.stops-browse {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.stops-browse-head {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.stops-browse-head h2,
	.stops-browse-head p {
		margin: 0;
	}
	.stops-browse-head h2 {
		font-size: var(--text-heading);
		color: var(--foreground);
	}
	.stops-browse-head p {
		max-width: 65ch;
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.stops-load-more:hover,
	.stops-load-more:focus-visible {
		border-color: var(--primary);
		color: var(--primary);
		outline: none;
	}
	.stops-browse-more,
	.stops-batch-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
	}
	.stops-batch-controls {
		margin-top: var(--space-card-gap);
	}
	.stops-batch-controls p {
		margin: 0;
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.stops-load-more {
		min-height: var(--size-tap-min);
		padding: 0.625rem 1rem;
		border: 1px solid var(--border-brand);
		border-radius: var(--radius-pill);
		background: var(--surface-1);
		color: var(--foreground);
		font-family: var(--font-mono);
		font-size: var(--text-control);
		font-weight: 700;
		cursor: pointer;
	}
	.stops-line-filter {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.stops-line-filter :global([data-slot='combobox']) {
		width: 100%;
	}
	.stops-line-heading {
		margin: 0;
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--foreground);
		padding: 0.75rem 0.875rem 0;
	}
	.stops-line-group {
		margin-top: 0.5rem;
	}
	.stops-line-dir {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
		padding: 0.5rem 0.875rem 0.25rem;
	}
</style>
