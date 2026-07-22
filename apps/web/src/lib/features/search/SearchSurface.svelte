<!--
  SearchSurface — the Search screen (slice-9.3 · data-depth batch 4).

  Was a bare navigational index over the two static discovery indexes; now a
  signal-rich finder over THREE result families:
    · getRoutesIndex() → RouteIndexEntry[]  (lines)
    · getStopsIndex()  → StopIndexEntry[]   (stops)
    · the live vehicles store               (buses — exact unit-id match)

  Every result row carries at-a-glance depth:
    · LINE rows  — a guarded GTFS colour swatch + a mode glyph/tag (Métro/Tram/
      Bus…) + an inline RELIABILITY badge (status verdict + OTP%) via the SHARED
      lazy loader (per-id cache + concurrency cap + viewport-gated fetch).
    · STOP rows  — a visible mode tag for EVERY mode (today only metro/rail tagged)
      + the same inline reliability badge.
    · BUS rows   — a status chip, a crowding indicator, the signed delay, a
      'next: <stop>' subtitle (resolved against the stops index) + a heading arrow.

  Two combinable controls sit above the results:
    · an entity-type SCOPE segmented filter (All / Lines / Stops / Buses) with
      per-group counts — exposing the chrome's ChromeSearchScope concept as a
      visible radiogroup.
    · a transit-MODE chip filter (Métro / Tram / Bus / Train / Ferry), reusing the
      map's combinable-facet chip pattern.

  DOCTRINE: Svelte 5 runes; tokens, no hex (the route GTFS colour is DATA, guarded
  via routeColor + an inline style — the one allowed dynamic colour); --primary
  interactive-only; bilingual via getLocale + co-located copy; keyed {#each};
  fail-soft — never invent data, never crash.

  Near-me / distance sort is intentionally NOT offered here: search is a finder,
  flat by design (§C5.14) — ranking is by match quality, not geography. The
  near-me affordance lives on /map ("Stops near me", the amber conversion CTA),
  the one surface where proximity is the story. (P5.3d resolved the former
  near-me DEFER: no orphan scaffold, no dead follow-up.)

  DEFER (DB-blocked, owned by S16 data work): per-row reliability grain
  selection; accessible-only filter (needs a DB field).
-->
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
		GrainPicker,
	} from '$lib/components/surface';
	import { Masthead } from '$lib/components/brand';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Surface } from '$lib/components/layout';
	import { EdgeState } from '$lib/components/edge';
	import { FreshnessStamp } from '$lib/components/surface';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		metricInfoFor,
		metricName,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { dedupeBy, foldSearchText, tokenMatchScore } from '$lib/search/normalize';
	import {
		stopGroupKey,
		stopModeHint,
		stopModeTag,
		routeModeHint,
		modeKeyForTag,
	} from '$lib/search/stopMode';
	import { routeColor } from '$lib/search/routeColor';
	import { STATUS_LABELS, OCCUPANCY_LABELS } from '$lib/v1/enumLabels';
	import VehicleResultRow from './VehicleResultRow.svelte';
	import { copy } from './search.copy';

	const locale: Locale = getLocale();
	const t = $derived(copy[locale]);
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	// The metric-explainer (i) affordance on result-group headings (§C5.14): a
	// one-line tip + a deep link into /metrics#<anchor>, the same `info()` shape every
	// surface uses. OTP rides the Lines group; crowding + delay ride the Live-buses group.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey | SupplementalMetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});
	// The three result-group (i) payloads, hoisted to script level (an {@const} can't
	// sit directly inside a plain element in the group headings below).
	const otpInfo = $derived(info('otp', 'OTP'));
	const crowdingInfo = $derived(info('occupancy', metricName('occupancy', locale)));
	const delayInfo = $derived(info('avgDelay', metricName('avgDelay', locale)));

	// Static discovery indexes — loaded client-side, gated by ResourceBoundary.
	const routes = createResource(() => getRoutesIndex());
	const stops = createResource(() => getStopsIndex());

	// Live tier: one store for this surface (the v1 context is booted before mount
	// in the root layout). Polls vehicles on the live ttl; an exact unit-id query
	// surfaces the matching bus. start()/stop() are browser-only + idempotent.
	const live = createLiveStore(getV1Context().manifest, { families: ['vehicles'] });
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// One shared lazy reliability loader per kind (per-id cache + concurrency cap +
	// viewport-gated fetch — never a fan-out across the whole catalogue).
	const routeReliability = createReliabilityLoader('route');
	const stopReliability = createReliabilityLoader('stop');
	const observeRouteReliability = routeReliability.reliability;
	const observeStopReliability = stopReliability.reliability;

	// Max rows rendered per group — a broad query can't flood the surface.
	const MAX_RESULTS = 50;

	// Seed the query from the URL `q` param once (deep-link hydration).
	let query = $state($page.url.searchParams.get('q') ?? '');
	const normalized = $derived(foldSearchText(query));
	const hasQuery = $derived(normalized.length > 0);

	// ── Scope (entity-type) segmented filter ────────────────────────────────────
	type Scope = 'all' | 'route' | 'stop' | 'vehicle';
	let scope = $state<Scope>('all');

	// ── Transit-mode combinable chip filter (reuses the map's facet toggle model) ─
	const MODE_KEYS = ['metro', 'tram', 'bus', 'rail', 'ferry'] as const;
	type ModeKey = (typeof MODE_KEYS)[number];
	// A reactive Set of selected modes — mutated in place (SvelteSet is reactive,
	// so the derived results recompute on toggle without a fresh-Set reassign).
	const modes = new SvelteSet<ModeKey>();
	function toggleMode(m: ModeKey): void {
		if (modes.has(m)) modes.delete(m);
		else modes.add(m);
	}
	const modeActive = $derived(modes.size > 0);

	// Map a GTFS route_type / a stop mode tag to a ModeKey for the mode filter.
	const ROUTE_TYPE_MODE: Record<number, ModeKey> = {
		0: 'tram',
		1: 'metro',
		2: 'rail',
		3: 'bus',
		4: 'ferry',
	};
	function routeModeKey(r: RouteIndexEntry): ModeKey | null {
		return ROUTE_TYPE_MODE[r.type] ?? null;
	}
	// A stop's mode key comes straight from its visible tag via stopMode.ts's
	// single-source reverse lookup — no local tag→mode map that could drift.
	function stopModeKey(s: StopIndexEntry): ModeKey | null {
		return modeKeyForTag(stopModeTag(s));
	}

	// ── Matching (accent-blind, word-order-free, token-AND, tier-ranked) ─────────
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
		// One row per logical stop — métro/station names collapse to a single station.
		return dedupeBy(ranked, stopGroupKey);
	});
	// Vehicles match ONLY on an exact unit-id (the id is the precise thing a rider
	// knows), mirroring the chrome blend — never a fuzzy bus flood.
	const matchedVehiclesAll = $derived.by<Vehicle[]>(() => {
		if (!hasQuery) return [];
		const all = live.vehicles?.vehicles ?? [];
		return all.filter((v) => foldSearchText(v.id) === normalized);
	});

	// Mode filter narrows each family (combinable, OR within the mode set). A row
	// whose mode is unknown is kept only when no mode is selected (honest: we don't
	// guess its mode to include or exclude it).
	const matchedRoutes = $derived(
		modeActive
			? matchedRoutesAll.filter((r) => {
					const m = routeModeKey(r);
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
	// A vehicle has no mode field — it's always a bus, so the mode filter keeps
	// buses only when 'bus' is among the selected modes (else hides them).
	const matchedVehicles = $derived(
		modeActive ? (modes.has('bus') ? matchedVehiclesAll : []) : matchedVehiclesAll,
	);

	// Per-scope visibility (the scope control RESTRICTS which families render).
	const showRoutes = $derived((scope === 'all' || scope === 'route') && matchedRoutes.length > 0);
	const showStops = $derived((scope === 'all' || scope === 'stop') && matchedStops.length > 0);
	const showVehicles = $derived(
		(scope === 'all' || scope === 'vehicle') && matchedVehicles.length > 0,
	);
	const hasResults = $derived(showRoutes || showStops || showVehicles);

	// Scope segments carry per-family counts (post mode-filter) so the rider sees
	// where the matches live before narrowing.
	const scopeSegments = $derived([
		{ key: 'all', label: t.scopeAll },
		{ key: 'route', label: t.scopeCount(t.linesLabel, matchedRoutes.length) },
		{ key: 'stop', label: t.scopeCount(t.stopsLabel, matchedStops.length) },
		{ key: 'vehicle', label: t.scopeCount(t.vehiclesLabel, matchedVehicles.length) },
	]);

	// In-memory stop-name lookup for resolving a vehicle's next_stop id → a name.
	const stopNameById = $derived.by<SvelteMap<string, string>>(() => {
		const m = new SvelteMap<string, string>();
		for (const s of stops.data?.stops ?? []) m.set(s.id, s.name);
		return m;
	});
	function nextStopName(v: Vehicle): string | null {
		return v.next_stop ? (stopNameById.get(v.next_stop) ?? null) : null;
	}

	// A line's title is its short name; the long name (when present) is subtitle.
	function routeTitle(r: RouteIndexEntry): string {
		return r.short || r.id;
	}

	// Mode chip definitions (reuses the map facet chip pattern: combinable toggles).
	const modeChips = $derived(MODE_KEYS.map((key) => ({ key, label: t.modes[key] })));

	const statusLabelFor = (s: StatusCode): string => STATUS_LABELS[locale][s];
	const occupancyLabelFor = (o: OccupancyCode | null | undefined): string | null =>
		o ? OCCUPANCY_LABELS[locale][o] : null;

	// ── Idle-state census (§C5.14) ──────────────────────────────────────────────
	// Live network counts from the already-fetched indices + a live freshness stamp
	// + tappable example queries — turning the dead prompt into a live way in.
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

		{#if hasQuery}
			<div class="search-controls">
				<div class="search-control">
					<span class="search-control-label">{t.scopeLabel}</span>
					<GrainPicker segments={scopeSegments} bind:value={scope} label={t.scopeLabel} />
				</div>
				<div class="search-control">
					<span class="search-control-label" id="search-mode-label">{t.modeLabel}</span>
					<div class="search-mode-chips" role="group" aria-labelledby="search-mode-label">
						{#each modeChips as chip (chip.key)}
							<button
								type="button"
								class="search-mode-chip"
								data-on={modes.has(chip.key)}
								aria-pressed={modes.has(chip.key)}
								onclick={() => toggleMode(chip.key)}
							>
								{chip.label}
							</button>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	</Masthead>

	<ResourceBoundary resource={routes} lang={locale}>
		<ResourceBoundary resource={stops} lang={locale}>
			{#if !hasQuery}
				<!-- IDLE (§C5.14): a network census band instead of a dead prompt — live
				     counts from the fetched indices + a live freshness stamp + tappable
				     example queries that fill the search box. -->
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
									<MetricInfo
										tip={otpInfo.tip}
										href={otpInfo.href}
										label={otpInfo.label}
										linkLabel={otpInfo.linkLabel}
										side="bottom"
									/>
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
										tip={crowdingInfo.tip}
										href={crowdingInfo.href}
										label={crowdingInfo.label}
										linkLabel={crowdingInfo.linkLabel}
										side="bottom"
									/>
									<MetricInfo
										tip={delayInfo.tip}
										href={delayInfo.href}
										label={delayInfo.label}
										linkLabel={delayInfo.linkLabel}
										side="bottom"
									/>
								</span>
								<span class="search-group-count">{t.resultCount(matchedVehicles.length)}</span>
							</h2>
							<!-- No max/truncatedLabel: vehicles match on an EXACT unit-id, so this
							     group caps at one row — the truncation affordance would be inert. -->
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
	.search-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem 2rem;
		margin-top: 0.875rem;
	}
	/* Desktop: keep the scope + mode controls in reach while results scroll (§C5.14).
	   The single --chrome-offset knob clears the floating pill; mobile drops the
	   sticky (a sticky control bar would eat scarce phone viewport). */
	@media (min-width: 1024px) {
		.search-controls {
			position: sticky;
			top: var(--chrome-offset);
			z-index: var(--z-rail);
			background: color-mix(in srgb, var(--background) 92%, transparent);
			backdrop-filter: blur(16px) saturate(1.1);
			padding-block: 0.5rem;
			margin-top: 0;
		}
	}
	/* Group heading label + its (i) affordance sit inline. */
	.search-group-labelrow {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	/* Idle census band — live counts + freshness + example chips. Not a data mark;
	   the chips are interactive affordances (--primary on hover/focus). */
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
	.search-control {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.search-control-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	/* Combinable mode chips — the map's facet toggle pattern: a tinted "on" state,
	   --primary as the interaction accent (never a data mark). */
	.search-mode-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.search-mode-chip {
		appearance: none;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		padding: 0.375rem 0.75rem;
		color: var(--muted-foreground);
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.search-mode-chip:hover {
		color: var(--foreground);
		border-color: color-mix(in srgb, var(--primary) 45%, var(--border) 55%);
	}
	.search-mode-chip[data-on='true'] {
		color: var(--primary-foreground);
		background: var(--primary);
		border-color: var(--primary);
	}
	.search-mode-chip:focus-visible {
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
	@media (prefers-reduced-motion: reduce) {
		.search-mode-chip,
		.search-census__chip {
			transition: none;
		}
	}
</style>
