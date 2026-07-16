<!--
  LinesIndex — the Lines index screen (slice-9.3 · data-depth batch 4).

  Composes the surface spine: a BlueprintListingHeader over a filterable EntityList of
  every route from the static routes_index. Each row now carries an at-a-glance
  RELIABILITY BADGE (status verdict + OTP%) lazily loaded per-route, plus two
  combinable controls: a SORT toggle (alphabetical | worst reliability first) and
  a reliability STATUS filter (all | late/severe only). The search-to-filter box
  is unchanged.

  Data:
    · static routes_index via createResource(getRoutesIndex) — gated by a
      ResourceBoundary so skeleton / error / empty render without bespoke plumbing.
    · per-route headline reliability via the SHARED lazy loader
      (createReliabilityLoader): a per-id cache + a concurrency cap + viewport-gated
      fetches (the `reliability` action), so the catalogue never fans out hundreds
      of /v1 requests. Rows still loading / with no data show the name + glyph as
      before (no badge, no spinner) — fail-soft + honest.

  Locale comes from getLocale(); non-intrinsic copy is co-located. Tokens, no hex
  (the route GTFS colour is not surfaced here — that is the search swatch's job);
  --primary stays interactive-only (the active sort/filter segment).

  Near-me / distance sort is intentionally NOT offered here: a line is a whole
  route (a polyline across the network), not a single point, so "nearest line"
  has no honest single-distance definition — the near-me affordance lives on /map
  ("Stops near me", the amber conversion CTA) where a stop IS a point. (P5.3d
  resolved the former near-me DEFER: no orphan scaffold, no dead follow-up.)

  DEFER (DB-blocked, owned by S16 data work): no per-row reliability grain
  selection (always the latest day); no accessible-only filter (needs a DB field).
-->
<script lang="ts">
	import { getLocale } from '$lib/i18n';
	import { mapHrefFor } from '$lib/nav';
	import { getRoutesIndex, createReliabilityLoader, isProblemVerdict } from '$lib/v1';
	import type { RouteIndexEntry } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		ResourceBoundary,
		EntityList,
		EntityRow,
		EntityResultRow,
		MapDrilldownLink,
		ReliabilityBadge,
		createReliabilityListingController,
		isReliabilitySnapshotPending,
	} from '$lib/components/surface';
	import { BlueprintListingHeader, ListingPageShell } from '$lib/components/layout';
	import {
		FilterGroup,
		ListingFilterPanel,
		ListingFilterSection,
		ListingSearchField,
	} from '$lib/components/filter';
	import { foldSearchText, tokenMatchScore } from '$lib/search/normalize';
	import { routeModeHint, routeModeKey } from '$lib/search/stopMode';
	import { indexCopy } from './lines.copy';
	import LinesBlueprint from './LinesBlueprint.svelte';

	const locale = getLocale();
	const t = $derived(indexCopy[locale]);

	const routes = createResource(() => getRoutesIndex());

	// The SHARED lazy reliability loader, scoped to this surface (one cache +
	// concurrency budget, torn down with the page). Rows request their id through
	// the `observeReliability` action so only on-screen rows fetch.
	const reliability = createReliabilityLoader('route');
	const observeReliability = reliability.reliability;

	// Filter query (mono input); empty ⇒ the full catalogue.
	let query = $state('');

	// Sort + reliability-status controls (both WAI-ARIA radiogroups via GrainPicker).
	type SortKey = 'alpha' | 'worst';
	let sort = $state<SortKey>('alpha');
	const sortAllLabel = { en: indexCopy.en.sortAlpha, fr: indexCopy.fr.sortAlpha };

	type StatusKey = 'all' | 'problem';
	let status = $state<StatusKey>('all');
	const statusAllLabel = { en: indexCopy.en.statusAll, fr: indexCopy.fr.statusAll };

	let mode = $state('all');
	const modeAllLabel = { en: indexCopy.en.modeAll, fr: indexCopy.fr.modeAll };

	const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
	const numberFmt = $derived(new Intl.NumberFormat(locale));
	const modeCounts = $derived.by<Record<string, { count: number; label: string }>>(() => {
		const counts: Record<string, { count: number; label: string }> = {};
		for (const route of routes.data?.routes ?? []) {
			const key = routeModeKey(route.type);
			const label = routeModeHint(route.type).tag;
			if (key == null || label == null) continue;
			counts[key] = { count: (counts[key]?.count ?? 0) + 1, label };
		}
		return counts;
	});
	const routeModesComplete = $derived(
		routes.data != null && routes.data.routes.every((route) => routeModeKey(route.type) != null),
	);
	const modeItems = $derived(
		Object.entries(modeCounts)
			.sort((a, b) => collator.compare(a[1].label, b[1].label))
			.map(([key, item]) => ({ key, label: `${item.label} (${numberFmt.format(item.count)})` })),
	);
	const inventoryStats = $derived([
		{
			label: t.inventory.lines,
			value: routes.data ? numberFmt.format(routes.data.routes.length) : null,
		},
		{
			label: t.inventory.bus,
			value: routes.data ? numberFmt.format(modeCounts.bus?.count ?? 0) : null,
		},
		{
			label: t.inventory.metro,
			value: routes.data ? numberFmt.format(modeCounts.metro?.count ?? 0) : null,
		},
		{
			label: t.inventory.modes,
			value: routeModesComplete ? numberFmt.format(Object.keys(modeCounts).length) : null,
		},
	]);

	// The text-filtered, alphabetical base set (numeric-aware on short name).
	const filtered = $derived.by<RouteIndexEntry[]>(() => {
		const all = routes.data?.routes ?? [];
		const sorted = [...all]
			.filter((route) => mode === 'all' || routeModeKey(route.type) === mode)
			.sort((a, b) => collator.compare(a.short, b.short));
		const q = foldSearchText(query);
		if (!q) return sorted;
		// Accent-blind, word-order-free match over id/short/long; numeric short-name
		// order is preserved within the filtered set.
		return sorted.filter((r) => tokenMatchScore([r.id, r.short, r.long], q) != null);
	});

	// Reliability-dependent controls request every filtered candidate through the
	// shared loader's existing capped queue. A least-reliable ranking is committed
	// once, only after every candidate reaches ready or empty; until then source
	// order is stable. The Late filter shares the same full-coverage request so an
	// off-screen idle row can never keep its checking state alive forever.
	const VERDICT_RANK: Record<string, number> = { severe: 0, late: 1, on_time: 2 };
	const reliabilityListing = createReliabilityListingController({
		loader: reliability,
		candidates: () => filtered,
		id: (route) => route.id,
		requestWhen: () => sort === 'worst' || status === 'problem',
		rankWhen: () => sort === 'worst',
		rank: (snapshot) => (snapshot.verdict == null ? 99 : (VERDICT_RANK[snapshot.verdict] ?? 99)),
	});
	const worstPending = $derived(reliabilityListing.rankingPending);
	const sorted = $derived(reliabilityListing.order(filtered));

	// The reliability-status filter includes only explicit problem verdicts once a
	// row is terminal. Idle/loading candidates remain temporarily while the shared
	// full-coverage probe runs; terminal empty/unknown and healthy rows stand down.
	const visible = $derived.by<readonly RouteIndexEntry[]>(() => {
		if (status === 'all') return sorted;
		return sorted.filter((r) => {
			const snapshot = reliability.get(r.id);
			return isReliabilitySnapshotPending(snapshot) || isProblemVerdict(snapshot.verdict);
		});
	});

	// With the problem filter on, idle/loading candidates remain temporarily while
	// the complete filtered set is checked. Announce that work until every candidate
	// is terminal; empty/unknown terminal rows cannot leave the message running.
	const statusPending = $derived(status === 'problem' && reliabilityListing.coveragePending);
</script>

{#snippet listingBlueprint()}
	<LinesBlueprint />
{/snippet}

{#snippet listingHeader()}
	<BlueprintListingHeader
		heading={t.heading}
		subtitle={t.kicker}
		description={t.directionsNote}
		statsLabel={t.inventory.label}
		statsUnknownLabel={t.inventory.unavailable}
		stats={inventoryStats}
		blueprint={listingBlueprint}
	/>
{/snippet}

{#snippet listingSearch()}
	<ListingSearchField
		label={t.filterLabel}
		placeholder={t.filterPlaceholder}
		testId="lines-filter-input"
		bind:value={query}
	/>
{/snippet}

{#snippet listingFilters()}
	<ListingFilterPanel showSearch={false}>
		<ListingFilterSection>
			<FilterGroup
				label={t.sortLabel}
				items={[{ key: 'worst', label: t.sortWorst }]}
				activeKey={sort === 'alpha' ? null : sort}
				allLabel={sortAllLabel}
				allowDeselect={false}
				collapsible
				persistKey="lines-filter-sort-group"
				testIdPrefix="lines-sort"
				onSelect={(key) => (sort = key === 'worst' ? 'worst' : 'alpha')}
			/>
		</ListingFilterSection>

		<ListingFilterSection>
			<FilterGroup
				label={t.statusFilterLabel}
				items={[{ key: 'problem', label: t.statusProblem }]}
				activeKey={status === 'all' ? null : status}
				allLabel={statusAllLabel}
				allowDeselect={false}
				collapsible
				persistKey="lines-filter-status-group"
				testIdPrefix="lines-status"
				onSelect={(key) => (status = key === 'problem' ? 'problem' : 'all')}
			/>
		</ListingFilterSection>

		<ListingFilterSection>
			<FilterGroup
				label={t.modeFilterLabel}
				items={modeItems}
				activeKey={mode === 'all' ? null : mode}
				allLabel={modeAllLabel}
				allowDeselect={false}
				collapsible
				persistKey="lines-filter-mode-group"
				testIdPrefix="lines-mode"
				onSelect={(key) => (mode = key ?? 'all')}
			/>
		</ListingFilterSection>
	</ListingFilterPanel>
{/snippet}

<ListingPageShell
	heading={t.heading}
	filterLabel={t.controlsLabel}
	filterPersistKey="lines-listing-filters"
	header={listingHeader}
	search={listingSearch}
	filters={listingFilters}
>
	<ResourceBoundary resource={routes} lang={locale} isEmpty={(d) => d.routes.length === 0}>
		<!-- Polite SR caption: while the problem filter waits on verdicts to stream
		     in, a screen-reader user hears that the visible list is still loading
		     rather than meeting an apparently-empty result set in silence. -->
		<p class="sr-only" role="status" aria-live="polite">
			{statusPending ? t.statusPending : worstPending ? t.rankingPending : ''}
		</p>
		<!-- The catalogue lays out as a 2-up auto-fit board on desktop (each line
		     result fills its grid cell), reflowing to a single column on a phone —
		     EntityList's `grid` mode renders its rows through the SHARED DashboardGrid
		     auto-fit recipe, so the list>listitem semantics (and the lazy reliability
		     action per row) stay intact and the grid track lives ONLY in DashboardGrid. -->
		<EntityList items={visible} key={(r) => r.id} grid cards minTile="360px">
			{#snippet row(r)}
				{@const routeSnapshot = reliability.get(r.id)}
				<!-- Bare id (no `known` flag): availability is decided by the always-current
			     route_reliability discovery index in the loader, NOT the lag-prone
			     routes_index `reliability` flag — so a stale flag never drops a badge. -->
				<div use:observeReliability={r.id}>
					{#snippet lineMain()}
						<EntityRow
							target={{ kind: 'line', id: r.id }}
							{locale}
							glyph={routeModeHint(r.type).glyph}
							tag={routeModeHint(r.type).tag ?? undefined}
							title={r.short}
							subtitle={r.long ? t.routeName(r.long) : undefined}
						/>
					{/snippet}
					{#snippet lineStatus()}
						<ReliabilityBadge snapshot={routeSnapshot} {locale} />
					{/snippet}
					{#snippet lineAction()}
						<MapDrilldownLink
							href={mapHrefFor({ route: r.id }, locale)}
							label={t.mapAction}
							ariaLabel={t.viewRouteOnMap(r.short)}
						/>
					{/snippet}
					<EntityResultRow
						children={lineMain}
						status={routeSnapshot.otpPct == null ? undefined : lineStatus}
						action={lineAction}
					/>
				</div>
			{/snippet}
		</EntityList>
	</ResourceBoundary>
</ListingPageShell>

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
