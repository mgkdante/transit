<!--
  StopsIndex — the Stops search surface (slice-9.3 · S8C redesign).

  Three combinable ways to reach a stop, plus an at-a-glance reliability read:

    (a) FIND BY TYPING — a diacritics-insensitive, word-order-free token match
        over name/code/id (foldSearchText + tokenMatchScore), deduped by logical
        stop, capped at 100 rendered rows (the catalogue is ~9k stops / ~847KB, so
        we NEVER list it whole; the cap bounds the DOM, not the match set). The
        typed query stays EPHEMERAL local state — it is a keystroke stream, not
        shareable view state, so it is never mirrored to the URL.

    (b) FIND BY LINE — a bits-ui typeahead combobox of every route. Picking a line
        loads that route's LOSSLESS static stop list (getRoute → directions[].stops)
        rather than the stops_index `routes[]` reverse index, which is CAPPED AT 5
        route-ids per stop and would silently drop stops for busy lines. The result
        is stop-sequence ordered + direction-grouped (DECISION C1). The pick is
        codec-owned: it seeds from / mirrors to the existing `route` filter axis
        (?route=<id>), so a by-line view is shareable + round-trips. When a line has
        no published stop list, we say so honestly.

    (c) RELIABILITY BADGES — the shared lazy loader (createReliabilityLoader('stop'))
        gives each rendered row a headline OTP% + status verdict. Stops carry NO
        published availability flag (unlike routes), so this is the HONEST PROBE
        pattern: a bare, viewport-gated id that fail-softs on 404 — a stop with no
        history simply shows no badge (never a spinner storm, never a fabricated 0%).
        An optional worst-first sort keys off the LOADED verdict; unloaded rows sink.

  Composes the surface spine (SurfaceHeader + ControlsRail + ResourceBoundary +
  EntityList/EntityRow). Locale via getLocale(); all copy in stops.copy.ts. Tokens
  only, no hex; --primary stays interactive-only.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { mapHrefFor } from '$lib/nav';
	import {
		getStopsIndex,
		getRoutesIndex,
		getRoute,
		createReliabilityLoader,
		type StopIndexEntry,
		type RouteIndexEntry,
	} from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		ResourceBoundary,
		SurfaceHeader,
		EntityList,
		EntityRow,
		SearchInput,
		ReliabilityBadge,
		GrainPicker,
		MapDrilldownLink,
	} from '$lib/components/surface';
	import { Surface, ControlsRail } from '$lib/components/layout';
	import { LineCombobox, type LineComboboxOption } from '$lib/components/ui/line-combobox';
	import { Separator } from '$lib/components/ui/separator';
	import { fromSearchParams } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { dedupeBy, foldSearchText, tokenMatchScore } from '$lib/search/normalize';
	import { stopGroupKey, stopModeHint, routeModeHint } from '$lib/search/stopMode';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { indexCopy } from './stops.copy';

	const locale: Locale = getLocale();
	const t = $derived(indexCopy[locale]);

	// The OTP explainer (i) on the surface header (§C5.5 / §C6): a one-line tip +
	// a localized deep link to /metrics#otp, the same `info()` shape every surface uses.
	const explainerCopy = $derived(metricsCopy[locale]);
	const otpInfo = $derived.by(() => {
		const i = metricInfoFor('otp', locale);
		return { ...i, label: explainerCopy.info.trigger('OTP'), linkLabel: explainerCopy.info.link };
	});

	const index = createResource(() => getStopsIndex());
	const routesIndex = createResource(() => getRoutesIndex());

	// The SHARED lazy reliability loader, scoped to this surface (one cache +
	// concurrency budget, torn down with the page). Stops have NO discovery index,
	// so this is the honest per-row probe: viewport-gated, fail-soft on 404.
	const reliability = createReliabilityLoader('stop');
	const observeReliability = reliability.reliability;

	/** Max rows rendered at once — the catalogue is far too large to list whole. */
	const CAP = 100;

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
	const lineOptions = $derived.by<LineComboboxOption[]>(() => {
		const all = routesIndex.data?.routes ?? [];
		const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
		return [...all]
			.sort((a, b) => collator.compare(a.short, b.short))
			.map((r) => ({
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
	const lineRoute = createResource(() => {
		const id = selectedLineId;
		return id ? getRoute(id) : Promise.resolve(null);
	});

	// Join a route's directions[].stops back to the stops_index (for code/mode/route
	// chips), preserving stop-sequence order and grouping BY DIRECTION (DECISION C1).
	// A stop present in the route file but absent from the index still renders (id +
	// seq name) so the list is never silently short.
	interface LineStopGroup {
		readonly dir: number;
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
			.map((d) => {
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
				return { dir: d.dir, stops };
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

	const overflow = $derived(Math.max(0, matches.length - CAP));

	// ── (c) reliability sort (worst-first) — keys off the LOADED verdict ────────
	type SortKey = 'default' | 'worst';
	let sort = $state<SortKey>('default');
	const sortSegments = $derived([
		{ key: 'default', label: t.sortDefault },
		{ key: 'worst', label: t.sortWorst },
	]);
	const VERDICT_RANK: Record<string, number> = { severe: 0, late: 1, on_time: 2 };
	function worstRank(id: string): number {
		const v = reliability.get(id).verdict;
		return v == null ? 99 : (VERDICT_RANK[v] ?? 99);
	}
	// Apply worst-first to a list while keeping the source order as the stable
	// tiebreak (so rows don't reshuffle violently as badges stream in). Honest: an
	// unloaded / no-data row is NOT treated as "good" — it just lacks a rank.
	function applySort(list: readonly StopIndexEntry[]): readonly StopIndexEntry[] {
		if (sort === 'default') return list;
		return list
			.map((s, i) => ({ s, i }))
			.sort((a, b) => worstRank(a.s.id) - worstRank(b.s.id) || a.i - b.i)
			.map((x) => x.s);
	}

	// When a line is picked, its (direction-grouped, sequence-ordered) stops drive
	// the result — optionally further narrowed by the free-text box (compose both).
	// Otherwise the text-match set drives it.
	const lineActive = $derived(selectedLineId != null);
	function narrowByText(stops: readonly StopIndexEntry[]): readonly StopIndexEntry[] {
		if (!folded) return stops;
		return stops.filter((s) => tokenMatchScore([s.name, s.code, s.id], folded) != null);
	}
	const visibleGroups = $derived.by<LineStopGroup[]>(() =>
		lineStopGroups
			.map((g) => ({ dir: g.dir, stops: applySort(narrowByText(g.stops)) }))
			.filter((g) => g.stops.length > 0),
	);
	const sortedMatches = $derived(applySort(matches));

	// ── Idle-state census (§C5.5) ───────────────────────────────────────────────
	// Turn the dead "start typing" prompt into a live network stop-picture, entirely
	// from the two already-fetched indices — total stops + total lines — plus a
	// worst-stop teaser into /repeat-offenders and tappable example queries. No new
	// fetch: the counts are the length of the payloads the surface already loaded.
	const stopCount = $derived(index.data?.stops?.length ?? null);
	const lineCount = $derived(routesIndex.data?.routes?.length ?? null);
	const repeatOffendersHref = $derived(localizeHref('/repeat-offenders', locale));
	const numberFmt = $derived(new Intl.NumberFormat(locale));
</script>

{#snippet otpHeaderInfo()}
	<MetricInfo
		tip={otpInfo.tip}
		href={otpInfo.href}
		label={otpInfo.label}
		linkLabel={otpInfo.linkLabel}
		side="bottom"
	/>
{/snippet}

<Surface class="stops-index">
	<SurfaceHeader
		kicker={t.kicker}
		heading={t.heading}
		subheading={t.subheading}
		lede={t.lede}
		explainer={otpHeaderInfo}
	>
		<!-- All controls collected into ONE ControlsRail: the free-text search, the
		     by-line combobox, and the reliability sort. --primary lives only on the
		     active sort segment / highlighted combobox option; the rail is quiet. -->
		<ControlsRail label={t.controlsLabel} class="stops-controls-rail" sticky>
			<SearchInput
				id="stops-filter-input"
				label={t.searchLabel}
				placeholder={t.searchPlaceholder}
				bind:value={query}
			/>
			<div class="stops-controls">
				<div class="stops-control stops-control--line">
					<!-- Visible caption only; the combobox self-labels via its aria-label,
					     so this span is decorative (aria-hidden) — no dangling labelledby. -->
					<span class="stops-control-label" aria-hidden="true">{t.lineLabel}</span>
					<LineCombobox
						options={lineOptions}
						bind:value={selectedLineId}
						label={t.lineLabel}
						placeholder={t.linePlaceholder}
						clearLabel={t.lineClear}
						emptyLabel={t.lineEmpty}
						fold={foldSearchText}
					/>
				</div>
				<div class="stops-control">
					<span class="stops-control-label" aria-hidden="true">{t.sortLabel}</span>
					<GrainPicker segments={sortSegments} bind:value={sort} label={t.sortLabel} />
				</div>
			</div>
		</ControlsRail>
	</SurfaceHeader>

	<Separator variant="hazard" />

	<ResourceBoundary resource={index} lang={locale}>
		{#if lineActive}
			<!-- BY-LINE view. We gate on the per-route fetch MANUALLY (not a nested
			     ResourceBoundary) so a 404 / empty list states the SPECIFIC honest
			     reason ("no published stop list for this line") rather than a generic
			     no-data edge. While it loads, we simply hold the previous frame. -->
			{#if visibleGroups.length === 0}
				{#if lineRoute.settled}
					<p class="stops-note">{folded ? t.noMatches : t.noLineStops}</p>
				{/if}
			{:else}
				{#if selectedLine}
					<h2 class="stops-line-heading">{t.onLineHeading(selectedLine.short)}</h2>
				{/if}
				{#each visibleGroups as group (group.dir)}
					<section class="stops-line-group" aria-label={t.direction(group.dir)}>
						<h3 class="stops-line-dir">{t.direction(group.dir)}</h3>
						<EntityList items={group.stops} key={(s) => s.id} max={CAP}>
							{#snippet row(stop)}
								{@render stopRow(stop)}
							{/snippet}
						</EntityList>
					</section>
				{/each}
			{/if}
		{:else if !folded}
			<!-- IDLE (§C5.5): a network stop-picture band instead of a dead prompt —
			     live counts from the two fetched indices + a worst-stop teaser into
			     /repeat-offenders + tappable example queries that fill the search box. -->
			<div class="stops-census" data-slot="stops-census">
				<span class="stops-census__label">{t.census.label}</span>
				<p class="stops-census__counts">
					{#if stopCount != null}
						<span class="stops-census__stat">{t.census.stops(numberFmt.format(stopCount))}</span>
					{/if}
					{#if lineCount != null}
						<span class="stops-census__dot" aria-hidden="true">·</span>
						<span class="stops-census__stat">{t.census.lines(numberFmt.format(lineCount))}</span>
					{/if}
				</p>
				<a class="stops-census__teaser" href={repeatOffendersHref}>{t.census.worstTeaser}</a>
				<div class="stops-census__examples">
					<span class="stops-census__examples-label">{t.census.examplesLabel}</span>
					<div class="stops-census__chips">
						{#each t.census.examples as example (example)}
							<button type="button" class="stops-census__chip" onclick={() => (query = example)}>
								{example}
							</button>
						{/each}
					</div>
				</div>
				<p class="stops-note stops-census__prompt">{t.searchPrompt}</p>
			</div>
		{:else if matches.length === 0}
			<p class="stops-note">{t.noMatches}</p>
		{:else}
			<EntityList
				items={sortedMatches}
				key={(s) => s.id}
				max={CAP}
				truncatedLabel={overflow > 0 ? t.more(overflow) : undefined}
			>
				{#snippet row(stop)}
					{@render stopRow(stop)}
				{/snippet}
			</EntityList>
		{/if}
	</ResourceBoundary>
</Surface>

{#snippet stopRow(stop: StopIndexEntry)}
	{@const hint = stopModeHint(stop)}
	<div class="stop-result" use:observeReliability={stop.id}>
		<EntityRow
			target={{ kind: 'stop', id: stop.id }}
			{locale}
			glyph={hint.glyph}
			title={stop.name}
			subtitle={stop.code ?? undefined}
			meta={hint.label ?? undefined}
			routes={stop.routes}
			class="stop-result-main"
		/>
		<ReliabilityBadge snapshot={reliability.get(stop.id)} {locale} class="stop-result-badge" />
		<MapDrilldownLink
			href={mapHrefFor({ stop: stop.id }, locale)}
			label={t.mapAction}
			ariaLabel={t.viewStopOnMap(stop.code ?? stop.name)}
		/>
	</div>
{/snippet}

<style>
	.stops-note {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
		padding: 0.5rem 0.875rem;
	}
	/* Idle census band (§C5.5): a quiet card of live network counts + a way in. Not
	   a data mark; the teaser + chips are interactive affordances (--primary). */
	.stops-census {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	.stops-census__label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.stops-census__counts {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
	}
	.stops-census__stat {
		font-family: var(--font-heading);
		font-size: 1.5rem;
		font-weight: 800;
		line-height: 1.1;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.stops-census__dot {
		color: var(--muted-foreground);
	}
	.stops-census__teaser {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--primary);
		text-decoration: none;
	}
	.stops-census__teaser:hover,
	.stops-census__teaser:focus-visible {
		text-decoration: underline;
	}
	.stops-census__teaser:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}
	.stops-census__examples {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.stops-census__examples-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.stops-census__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.stops-census__chip {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--muted);
		color: var(--foreground);
		font-size: var(--text-caption);
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}
	.stops-census__chip:hover,
	.stops-census__chip:focus-visible {
		border-color: var(--primary);
		color: var(--primary);
	}
	.stops-census__chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.stops-census__prompt {
		padding: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		.stops-census__chip {
			transition: none;
		}
	}
	/* The control panel fills the header measure; its body lays the search box
	   across the top with the line filter + sort beneath. */
	:global(.stops-controls-rail) {
		width: 100%;
	}
	:global(.stops-controls-rail [data-slot='controls-rail-body']) {
		flex-direction: column;
		align-items: stretch;
		gap: 0.875rem;
	}
	.stops-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}
	.stops-control {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	/* The line combobox wants room to breathe (typeahead + long line names). */
	.stops-control--line {
		flex: 1 1 18rem;
		min-width: 0;
	}
	.stops-control-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.stops-line-heading {
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
	.stop-result {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.5rem;
		padding-right: 0.5rem;
	}
	.stop-result :global(.stop-result-main) {
		min-width: 0;
	}
	.stop-result :global(.stop-result-badge) {
		flex: none;
	}
	@media (max-width: 32rem) {
		/* On a narrow phone the badge tucks under the row body so the name + map
		   action keep their room. */
		.stop-result {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'main map'
				'badge map';
			row-gap: 0.25rem;
		}
		.stop-result :global(.stop-result-main) {
			grid-area: main;
		}
		.stop-result :global(.stop-result-badge) {
			grid-area: badge;
			padding-left: 0.5rem;
		}
		.stop-result :global(.map-drilldown-link) {
			grid-area: map;
		}
	}
</style>
