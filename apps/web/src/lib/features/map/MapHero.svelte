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
	import type { Map as MapLibreMap } from 'maplibre-gl';
	import { getLocale, type Locale } from '$lib/i18n';
	import { createLiveStore, getV1Context, getBasemap, getStopsIndex } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
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
	import { copy as MAP_COPY } from './map.copy';

	const locale: Locale = getLocale();
	const t = $derived(MAP_COPY[locale]);

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

	// Feed the layers: single-colour buses + the stop catalogue; dim on stale.
	$effect(() => {
		const m = map;
		if (!m) return;
		setVehicles(m, live.vehicles?.vehicles ?? [], 'single');
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

	<!-- Bottom-left: entity legend (one colour per type; state lives in the filter). -->
	<div class="map-overlay map-legend" aria-hidden="true">
		<span class="map-legend-item"><span class="map-legend-glyph map-legend-bus">▲</span>{t.entityBuses}</span>
		<span class="map-legend-item"><span class="map-legend-dot"></span>{t.entityStops}</span>
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
	.map-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
	}
	.map-legend-glyph {
		font-size: var(--text-small);
		line-height: 1;
	}
	.map-legend-bus {
		color: var(--foreground);
	}
	.map-legend-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--muted-foreground);
	}
</style>
