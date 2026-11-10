<script lang="ts">
	import { verdictCopy } from '#lib/v1/verdict.copy.ts';
	import { intl, getLocalizeHref, getLocale } from '#lib/i18n/index.ts';
	import { mapHrefFor } from '#lib/nav/index.ts';
	import { getRoutesIndex } from '#lib/v1/repositories/static.ts';
	import { createReliabilityLoader } from '#lib/v1/reliabilitySnapshot.svelte.ts';
	import { isProblemVerdict, verdictRank } from '#lib/v1/verdict.ts';
	import type { RouteIndexEntry } from '#lib/v1/index.ts';
	import { createResource } from '#lib/v1/resource.svelte.ts';
	import {
		ResourceBoundary,
		EntityList,
		LineStopResult,
		MapDrilldownLink,
		ReliabilityBadge,
		createReliabilityListingController,
		isReliabilitySnapshotPending,
	} from '#lib/components/surface/index.ts';
	import { ListingHeaderStats } from '#lib/components/layout/index.ts';
	import { ListingFrame } from '@yesid/ui/layout';
	import { FilterGroup, FilterSection, SearchInput } from '@yesid/ui/brand';
	import { blueprintScrub } from '@yesid/motion/utils/blueprintScrub';
	import { foldSearchText, tokenMatchScore } from '#lib/search/normalize.ts';
	import { routeModeHint, routeModeKey } from '#lib/search/stopMode.ts';
	import { indexCopy } from './lines.copy';
	import LinesBlueprint from './LinesBlueprint.svelte';

	const localizeHref = getLocalizeHref();
	const locale = getLocale();
	const t = $derived(indexCopy[locale]);

	const routes = createResource(() => getRoutesIndex());

	const reliability = createReliabilityLoader('route', verdictCopy[locale]);
	const observeReliability = reliability.reliability;

	let query = $state('');

	type SortKey = 'alpha' | 'worst';
	let sort = $state<SortKey>('alpha');

	type StatusKey = 'all' | 'problem';
	let status = $state<StatusKey>('all');

	let mode = $state('all');

	const collator = intl.collator(locale, { numeric: true, sensitivity: 'base' });
	const numberFmt = $derived(intl.number(locale));
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

	const reliabilityListing = createReliabilityListingController({
		loader: reliability,
		candidates: () => filtered,
		id: (route) => route.id,
		requestWhen: () => sort === 'worst' || status === 'problem',
		rankWhen: () => sort === 'worst',
		rank: (snapshot) => verdictRank(snapshot.verdict),
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

{#snippet listingStats()}
	<ListingHeaderStats
		label={t.inventory.label}
		unknownLabel={t.inventory.unavailable}
		stats={inventoryStats}
	/>
{/snippet}

{#snippet listingSearch()}
	<SearchInput
		label={t.filterLabel}
		placeholder={t.filterPlaceholder}
		testId="lines-filter-input"
		bind:value={query}
	/>
{/snippet}

{#snippet listingFilters()}
	<FilterSection>
		<FilterGroup
			label={t.sortLabel}
			items={[{ key: 'worst', label: t.sortWorst }]}
			activeKey={sort === 'alpha' ? null : sort}
			allLabel={t.sortAlpha}
			allowDeselect={false}
			collapsible
			testIdPrefix="lines-sort"
			onSelect={(key) => (sort = key === 'worst' ? 'worst' : 'alpha')}
		/>
	</FilterSection>

	<FilterSection>
		<FilterGroup
			label={t.statusFilterLabel}
			items={[{ key: 'problem', label: t.statusProblem }]}
			activeKey={status === 'all' ? null : status}
			allLabel={t.statusAll}
			allowDeselect={false}
			collapsible
			testIdPrefix="lines-status"
			onSelect={(key) => (status = key === 'problem' ? 'problem' : 'all')}
		/>
	</FilterSection>

	<FilterSection>
		<FilterGroup
			label={t.modeFilterLabel}
			items={modeItems}
			activeKey={mode === 'all' ? null : mode}
			allLabel={t.modeAll}
			allowDeselect={false}
			collapsible
			testIdPrefix="lines-mode"
			onSelect={(key) => (mode = key ?? 'all')}
		/>
	</FilterSection>
{/snippet}

<ListingFrame
	heading={t.heading}
	subtitle={t.kicker}
	description={t.directionsNote}
	blueprint={listingBlueprint}
	aside={listingStats}
	onHeaderMount={blueprintScrub}
	filterLabel={t.controlsLabel}
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
		<EntityList items={visible} key={(r) => r.id} grid cards>
			{#snippet row(r)}
				{@const routeSnapshot = reliability.get(r.id)}
				<!-- Bare id (no `known` flag): availability is decided by the always-current
			     route_reliability discovery index in the loader, NOT the lag-prone
			     routes_index `reliability` flag — so a stale flag never drops a badge. -->
				<div use:observeReliability={r.id}>
					{#snippet lineStatus()}
						<ReliabilityBadge snapshot={routeSnapshot} {locale} />
					{/snippet}
					{#snippet lineAction()}
						<MapDrilldownLink
							href={localizeHref(mapHrefFor({ route: r.id }, locale), locale)}
							context={t.viewRouteOnMap(r.short)}
							label={t.mapAction}
						/>
					{/snippet}
					<LineStopResult
						presentation="legacy-listing"
						target={{ kind: 'line', id: r.id }}
						{locale}
						glyph={routeModeHint(r.type).glyph}
						tag={routeModeHint(r.type).tag ?? undefined}
						title={r.short}
						subtitle={r.long ? t.routeName(r.long) : undefined}
						status={routeSnapshot.otpPct == null ? undefined : lineStatus}
						action={lineAction}
					/>
				</div>
			{/snippet}
		</EntityList>
	</ResourceBoundary>
</ListingFrame>
