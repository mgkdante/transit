<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { getLocale, type Locale } from '$lib/i18n';
	import { layout } from '$lib/nav';
	import { createResource } from '$lib/v1/resource.svelte';
	import { getRoutesIndex, getStopsIndex } from '$lib/v1/repositories/static';
	import { getV1Context } from '$lib/v1/boot';
	import { createLiveStore } from '$lib/v1/live/store.svelte';
	import { createReliabilityLoader } from '$lib/v1/reliabilitySnapshot.svelte';
	import type {
		RouteIndexEntry,
		StopIndexEntry,
		Vehicle,
		StatusCode,
		OccupancyCode,
	} from '$lib/v1';
	import {
		ResourceBoundary,
		EntityList,
		EntityRow,
		SearchInput,
		ReliabilityBadge,
		SearchControls,
		type SearchScopeKey,
	} from '$lib/components/surface';
	import { Masthead } from '$lib/components/brand';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Surface } from '$lib/components/layout';
	import { EdgeState } from '$lib/components/edge';
	import { FreshnessStamp } from '$lib/components/surface';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricName } from '$lib/metrics';
	import { dedupeBy, foldSearchText, tokenMatchScore } from '$lib/search/normalize';
	import {
		stopGroupKey,
		stopModeHint,
		stopModeKey,
		stopModeTag,
		routeModeHint,
		routeModeKey,
		type TransitModeKey,
	} from '$lib/search/stopMode';
	import { routeColor } from '$lib/search/routeColor';
	import { STATUS_LABELS, OCCUPANCY_LABELS } from '$lib/v1/enumLabels';
	import VehicleResultRow from './VehicleResultRow.svelte';
	import { copy } from './search.copy';

	const locale: Locale = getLocale();
	const t = $derived(copy[locale]);
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	const routes = createResource(() => getRoutesIndex());
	const stops = createResource(() => getStopsIndex());

	const live = createLiveStore(getV1Context().manifest, { families: ['vehicles'] });
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	const routeReliability = createReliabilityLoader('route');
	const stopReliability = createReliabilityLoader('stop');
	const observeRouteReliability = routeReliability.reliability;
	const observeStopReliability = stopReliability.reliability;

	const MAX_RESULTS = 50;

	let query = $state($page.url.searchParams.get('q') ?? '');
	const normalized = $derived(foldSearchText(query));
	const hasQuery = $derived(normalized.length > 0);

	let scope = $state<SearchScopeKey>('all');
	const modes = new SvelteSet<TransitModeKey>();
	const modeActive = $derived(modes.size > 0);

	const matchedRoutesAll = $derived.by<RouteIndexEntry[]>(() => {
		if (!hasQuery || !routes.data) return [];
		return routes.data.routes
			.map((r) => ({ r, score: tokenMatchScore([r.id, r.short, r.long], normalized) }))
			.filter((m): m is { r: RouteIndexEntry; score: number } => m.score != null)
			.sort((a, b) => a.score - b.score)
			.map((m) => m.r);
	});
	const matchedStopsAll = $derived.by<StopIndexEntry[]>(() => {
		if (!hasQuery || !stops.data) return [];
		const ranked = stops.data.stops
			.map((s) => ({ s, score: tokenMatchScore([s.id, s.name, s.code], normalized) }))
			.filter((m): m is { s: StopIndexEntry; score: number } => m.score != null)
			.sort((a, b) => a.score - b.score)
			.map((m) => m.s);
		return dedupeBy(ranked, stopGroupKey);
	});
	const matchedVehiclesAll = $derived.by<Vehicle[]>(() => {
		if (!hasQuery) return [];
		const all = live.vehicles?.vehicles ?? [];
		return all.filter((v) => foldSearchText(v.id) === normalized);
	});

	const matchedRoutes = $derived(
		modeActive
			? matchedRoutesAll.filter((r) => {
					const m = routeModeKey(r.type);
					return m != null && modes.has(m);
				})
			: matchedRoutesAll,
	);
	const matchedStops = $derived(
		modeActive
			? matchedStopsAll.filter((s) => {
					const m = stopModeKey(s);
					return m != null && modes.has(m);
				})
			: matchedStopsAll,
	);
	const matchedVehicles = $derived(
		modeActive ? (modes.has('bus') ? matchedVehiclesAll : []) : matchedVehiclesAll,
	);

	const showRoutes = $derived((scope === 'all' || scope === 'route') && matchedRoutes.length > 0);
	const showStops = $derived((scope === 'all' || scope === 'stop') && matchedStops.length > 0);
	const showVehicles = $derived(
		(scope === 'all' || scope === 'vehicle') && matchedVehicles.length > 0,
	);
	const hasResults = $derived(showRoutes || showStops || showVehicles);

	const scopeSegments = $derived([
		{ key: 'all' as const, label: t.scopeAll },
		{ key: 'route' as const, label: t.scopeCount(t.linesLabel, matchedRoutes.length) },
		{ key: 'stop' as const, label: t.scopeCount(t.stopsLabel, matchedStops.length) },
		{ key: 'vehicle' as const, label: t.scopeCount(t.vehiclesLabel, matchedVehicles.length) },
	]);

	const stopNameById = $derived.by<SvelteMap<string, string>>(() => {
		const m = new SvelteMap<string, string>();
		for (const s of stops.data?.stops ?? []) m.set(s.id, s.name);
		return m;
	});
	function nextStopName(v: Vehicle): string | null {
		return v.next_stop ? (stopNameById.get(v.next_stop) ?? null) : null;
	}

	function routeTitle(r: RouteIndexEntry): string {
		return r.short || r.id;
	}

	const statusLabelFor = (s: StatusCode): string => STATUS_LABELS[locale][s];
	const occupancyLabelFor = (o: OccupancyCode | null | undefined): string | null =>
		o ? OCCUPANCY_LABELS[locale][o] : null;

	const lineCount = $derived(routes.data?.routes?.length ?? null);
	const stopCount = $derived(stops.data?.stops?.length ?? null);
	const numberFmt = $derived(new Intl.NumberFormat(locale));
</script>

<Surface class="surface">
	<Masthead kicker={t.kicker} heading={t.heading} lede={t.lede}>
		<SearchInput
			id="surface-search-input"
			label={t.inputLabel}
			placeholder={t.inputPlaceholder}
			bind:value={query}
		/>

		<SearchControls
			notice={t.collectionNotice}
			filters={hasQuery}
			scopeLabel={t.scopeLabel}
			{scopeSegments}
			bind:scope
			modeLabel={t.modeLabel}
			{modes}
		/>
	</Masthead>

	<ResourceBoundary resource={routes} lang={locale}>
		<ResourceBoundary resource={stops} lang={locale}>
			{#if !hasQuery}
				<div class="search-idle" role="note">
					<span class="search-idle-glyph" aria-hidden="true">⌕</span>
					<p class="search-idle-title">{t.idleTitle}</p>
					<p class="search-idle-body">{t.idleBody}</p>
					<div class="search-census" data-slot="search-census">
						<span class="search-census__label">{t.census.label}</span>
						<p class="search-census__counts">
							{#if lineCount != null}
								<span class="search-census__stat"
									>{t.census.lines(numberFmt.format(lineCount))}</span
								>
							{/if}
							{#if stopCount != null}
								<span class="search-census__dot" aria-hidden="true">·</span>
								<span class="search-census__stat"
									>{t.census.stops(numberFmt.format(stopCount))}</span
								>
							{/if}
						</p>
						<FreshnessStamp
							variant="live"
							generatedUtc={live.generatedUtc}
							ageSeconds={live.ageSeconds}
							isStale={live.isStale}
							{locale}
						/>
						<div class="search-census__examples">
							<span class="search-census__examples-label">{t.census.examplesLabel}</span>
							<div class="search-census__chips">
								{#each t.census.examples as example (example)}
									<button
										type="button"
										class="search-census__chip"
										onclick={() => (query = example)}
									>
										{example}
									</button>
								{/each}
							</div>
						</div>
					</div>
				</div>
			{:else if !hasResults}
				<EdgeState variant="no-results" lang={locale} layout={edgeLayout} />
			{:else}
				<div class="search-results">
					{#if showRoutes}
						<section class="search-group" aria-label={t.linesLabel}>
							<h2 class="search-group-head">
								<span class="search-group-labelrow">
									<span class="search-group-label">{t.linesLabel}</span>
									<MetricInfo metricKey="otp" {locale} name="OTP" side="bottom" />
								</span>
								<span class="search-group-count">{t.resultCount(matchedRoutes.length)}</span>
							</h2>
							<EntityList
								items={matchedRoutes}
								key={(r) => r.id}
								max={MAX_RESULTS}
								truncatedLabel={t.more(matchedRoutes.length - MAX_RESULTS)}
							>
								{#snippet row(r)}
									{@const hint = routeModeHint(r.type)}
									<div use:observeRouteReliability={{ id: r.id, known: r.reliability }}>
										<EntityRow
											target={{ kind: 'line', id: r.id }}
											{locale}
											glyph={hint.glyph}
											swatch={routeColor(r.color)}
											tag={hint.tag ?? undefined}
											title={routeTitle(r)}
											subtitle={r.long ?? undefined}
										>
											{#snippet metaSlot()}
												<ReliabilityBadge snapshot={routeReliability.get(r.id)} {locale} />
											{/snippet}
										</EntityRow>
									</div>
								{/snippet}
							</EntityList>
						</section>
					{/if}

					{#if showStops}
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
									{@const hint = stopModeHint(s)}
									{@const tag = stopModeTag(s)}
									<div use:observeStopReliability={s.id}>
										<EntityRow
											target={{ kind: 'stop', id: s.id }}
											{locale}
											glyph={hint.glyph}
											tag={tag ?? undefined}
											title={s.name}
											subtitle={s.code ?? undefined}
											routes={s.routes}
										>
											{#snippet metaSlot()}
												<ReliabilityBadge snapshot={stopReliability.get(s.id)} {locale} />
											{/snippet}
										</EntityRow>
									</div>
								{/snippet}
							</EntityList>
						</section>
					{/if}

					{#if showVehicles}
						<section class="search-group" aria-label={t.vehiclesLabel}>
							<h2 class="search-group-head">
								<span class="search-group-labelrow">
									<span class="search-group-label">{t.vehiclesLabel}</span>
									<MetricInfo
										metricKey="occupancy"
										{locale}
										name={metricName('occupancy', locale)}
										side="bottom"
									/>
									<MetricInfo
										metricKey="avgDelay"
										{locale}
										name={metricName('avgDelay', locale)}
										side="bottom"
									/>
								</span>
								<span class="search-group-count">{t.resultCount(matchedVehicles.length)}</span>
							</h2>
							<EntityList items={matchedVehicles} key={(v) => v.id}>
								{#snippet row(v)}
									<VehicleResultRow
										vehicle={v}
										{locale}
										nextStopName={nextStopName(v)}
										copy={t.vehicle}
										statusLabel={statusLabelFor(v.status)}
										occupancyLabel={occupancyLabelFor(v.occupancy)}
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
	.search-group-labelrow {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.search-census {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
		width: 100%;
	}
	.search-census__label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.search-census__counts {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: center;
		gap: 0.5rem;
		margin: 0;
	}
	.search-census__stat {
		font-family: var(--font-heading);
		font-size: 1.375rem;
		font-weight: 800;
		line-height: 1.1;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.search-census__dot {
		color: var(--muted-foreground);
	}
	.search-census__examples {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}
	.search-census__examples-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.search-census__chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}
	.search-census__chip {
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
	.search-census__chip:hover,
	.search-census__chip:focus-visible {
		border-color: var(--primary);
		color: var(--primary);
	}
	.search-census__chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.search-idle {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
		padding: clamp(2rem, 6vw, 3.5rem) 1.5rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
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
		max-width: var(--measure-notice);
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
	@media (prefers-reduced-motion: reduce) {
		.search-census__chip {
			transition: none;
		}
	}
</style>
