<!--
  MapHero — the citizen-first live vehicle map (Family A, slice-9.3 hero).

  ENCODING DOCTRINE (one colour per entity, state→filter): buses render in ONE
  calm colour (white) with directional arrows; stops are a single recessive grey,
  zoom-gated so the 8,986-stop catalogue never blankets the city. No status/
  crowding colour by default — that lives in the combinable filter (next step),
  which lights matched subsets up in their state colour. Routes draw on-demand
  (per-route shape geometry; no bulk file) when filtered/selected — also next.

  Composes the map kit + live store: MapStage owns the GL canvas; once ready we
  bake sprites and add the stops layer (under) + the vehicle layers (over). A
  live store polls every 30s; an $effect feeds vehicles + the stop catalogue into
  the layers and dims on stale.

  DOCTRINE: orange --primary stays interactive-only. The basemap rides the brand
  surface palette; every mark rides a token, no hardcoded hex.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto, afterNavigate } from '$app/navigation';
	import type { Map as MapLibreMap } from 'maplibre-gl';
	import { getLocale, type Locale } from '$lib/i18n';
	import { createLiveStore, getV1Context, getBasemap, getStopsIndex } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { createFilterStore, fromSearchParams } from '$lib/filters';
	import {
		MapStage,
		bakeVehicleSprites,
		addVehicleSource,
		addVehicleLayers,
		setVehicles,
		setStale,
		addStopsSource,
		addStopsLayer,
		setStops,
	} from '$lib/components/map';
	import { LiveFreshness } from '$lib/components/surface';
	import MapFilters from './MapFilters.svelte';
	import { copy as MAP_COPY } from './map.copy';

	const locale: Locale = getLocale();
	const t = $derived(MAP_COPY[locale]);

	// URL-DRIVEN filter state — the reusable spine. Seeded from the URL so a reload
	// (or a deep-link like /map?status=late) restores the exact view; every toggle
	// pushes the canonical query via goto (replaceState so the map view isn't
	// disrupted + back/forward stay clean). One map, deep-linkable from anywhere.
	const filters = createFilterStore(fromSearchParams($page.url.searchParams), (search) => {
		void goto(search ? `?${search}` : $page.url.pathname, {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	});

	// External navigation ONLY (browser back/forward = popstate) → re-seed the
	// store from the URL. We scope to popstate so our OWN replaceState pushes (a
	// chip toggle) never bounce back through here and clobber the just-set state.
	afterNavigate((nav) => {
		if (nav.type === 'popstate') {
			filters.replace(fromSearchParams($page.url.searchParams));
		}
	});

	// Basemap pointer (hosted Montréal PMTiles), or null → minimal-dark fallback.
	const basemap = createResource(() => getBasemap());
	// Static stop catalogue (8,986 stops) for the stops layer + (later) near-me.
	const stops = createResource(() => getStopsIndex());

	// Live tier — one store for this surface (v1 context booted before mount).
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	let map = $state<MapLibreMap | null>(null);

	function onMapReady(m: MapLibreMap): void {
		bakeVehicleSprites(m);
		// Stops UNDER buses (added first = lower z); buses ride on top.
		addStopsSource(m);
		addStopsLayer(m);
		addVehicleSource(m);
		addVehicleLayers(m);
		map = m;
	}

	// Feed the layers: vehicles coloured/dimmed under the active filter + the stop
	// catalogue; dim on stale. Reactive to filters.state so a chip toggle re-paints.
	$effect(() => {
		const m = map;
		if (!m) return;
		setVehicles(m, live.vehicles?.vehicles ?? [], filters.state);
		setStops(m, stops.data?.stops ?? []);
		setStale(m, live.isStale);
	});
</script>

<div class="map-hero">
	<!-- Gate the map's creation on the basemap pointer resolving (data or null),
	     so MapStage builds with its FINAL style once. -->
	{#if basemap.settled}
		<MapStage
			class="map-hero-stage"
			basemap={basemap.data}
			onready={onMapReady}
			label={t.mapLabel}
		/>
	{/if}

	<!-- Top-left: heading. -->
	<div class="map-overlay map-head">
		<p class="map-kicker">{t.kicker}</p>
		<h1 class="map-heading">{t.heading}<span class="map-dot">.</span></h1>
	</div>

	<!-- Left: the combinable state filter (URL-driven). -->
	<div class="map-overlay map-filter-panel">
		<MapFilters store={filters} {locale} />
	</div>

	<!-- Top-right: live freshness chip (once a build is loaded). -->
	{#if live.generatedUtc || live.ageSeconds != null}
		<div class="map-overlay map-fresh">
			<LiveFreshness
				generatedUtc={live.generatedUtc}
				ageSeconds={live.ageSeconds}
				isStale={live.isStale}
				{locale}
			/>
		</div>
	{/if}

	<!-- Bottom-left: the SHAPE key. Shape encodes entity + heading (colour is the
	     filter's job, so every glyph here is the same calm brand orange). -->
	<div class="map-overlay map-legend" aria-hidden="true">
		<span class="map-legend-title">{t.legendTitle}</span>
		<span class="map-legend-item">
			<span class="map-legend-glyph">▲</span>{t.entityBusHeading}
		</span>
		<span class="map-legend-item">
			<span class="map-legend-glyph">■</span>{t.entityBusNoHeading}
		</span>
		<span class="map-legend-item">
			<span class="map-legend-glyph map-legend-stop">◆</span>{t.entityStop}
		</span>
	</div>
</div>

<style>
	.map-hero {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}
	.map-hero :global(.map-stage) {
		border-radius: 0;
	}

	.map-overlay {
		position: absolute;
		z-index: 10;
	}
	.map-head {
		top: 1rem;
		left: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-width: calc(100% - 2rem);
	}
	.map-kicker {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.map-heading {
		margin: 0;
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-subheading);
		line-height: 1;
		color: var(--foreground);
	}
	.map-dot {
		color: var(--primary);
	}

	.map-filter-panel {
		top: 5.25rem;
		left: 1rem;
		max-height: calc(100% - 8rem);
		overflow-y: auto;
	}

	.map-fresh {
		top: 1rem;
		right: 1rem;
		padding: 0.4rem 0.7rem;
		background: color-mix(in srgb, var(--card) 88%, transparent);
		border: 1px solid var(--border);
		border-radius: 999px;
		backdrop-filter: blur(6px);
	}

	.map-legend {
		bottom: 1rem;
		left: 1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.9rem;
		max-width: calc(100% - 2rem);
		padding: 0.55rem 0.8rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--card) 88%, transparent);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		backdrop-filter: blur(6px);
	}
	.map-legend-title {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent-text);
		width: 100%;
	}
	.map-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
	}
	/* Every shape rides the same brand orange — colour belongs to the filter,
	   only the SHAPE distinguishes entities here. Stops sit dimmer (map mirror). */
	.map-legend-glyph {
		font-size: var(--text-small);
		line-height: 1;
		color: var(--primary);
	}
	.map-legend-stop {
		opacity: 0.7;
	}
</style>
