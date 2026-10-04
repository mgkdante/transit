<script lang="ts">
	import { getLocalizeHref, getLocale } from '$lib/i18n';
	import { mapHrefFor } from '$lib/nav';
	import { getRoutesIndex } from '$lib/v1/repositories/static';
	import { createReliabilityLoader } from '$lib/v1/reliabilitySnapshot.svelte';
	import { isProblemVerdict } from '$lib/v1/reliabilityVerdict';
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

	const localizeHref = getLocalizeHref();
	const locale = getLocale();
	const t = $derived(indexCopy[locale]);

	const routes = createResource(() => getRoutesIndex());

	const reliability = createReliabilityLoader('route');
	const observeReliability = reliability.reliability;

	let query = $state('');

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
		...Object.entries(modeCounts).map(([key, { label, count }]) => ({
			label: key === 'metro' ? t.inventory.metro : label,
			value: numberFmt.format(count),
		})),
		{
			label: t.inventory.modes,
			value: routeModesComplete ? numberFmt.format(Object.keys(modeCounts).length) : null,
		},
	]);

	const filtered = $derived.by<RouteIndexEntry[]>(() => {
		const all = routes.data?.routes ?? [];
		const sorted = [...all]
			.filter((route) => mode === 'all' || routeModeKey(route.type) === mode)
			.sort((a, b) => collator.compare(a.short, b.short));
		const q = foldSearchText(query);
		if (!q) return sorted;
		return sorted.filter((r) => tokenMatchScore([r.id, r.short, r.long], q) != null);
	});

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

	const visible = $derived.by<readonly RouteIndexEntry[]>(() => {
		if (status === 'all') return sorted;
		return sorted.filter((r) => {
			const snapshot = reliability.get(r.id);
			return isReliabilitySnapshotPending(snapshot) || isProblemVerdict(snapshot.verdict);
		});
	});

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
							href={localizeHref(mapHrefFor({ route: r.id }, locale), locale)}
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
