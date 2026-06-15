<!--
  MapHero — the citizen-first live vehicle map (Family A, slice-9.3 hero).

  Composes the map kit + the live store into a full-bleed map: MapStage owns the
  GL canvas; once it's ready we bake the puck sprites and add the vehicle source
  + the two symbol layers (rotating body under upright glyph). A live store polls
  every 30s; an $effect feeds its vehicles + the active mode into the layer and
  dims it when the feed goes stale.

  Honesty is baked into the layer (bearing-null disc, occupancy-null ◌ glyph;
  never a fabricated heading or the 'empty' band). DOCTRINE: orange --primary is
  interactive-only — it lights the active toggle segment, nothing else; every
  vehicle mark rides the dataviz scale + a glyph.

  This build ships the map + Statut|Crowding toggle + mode-mirroring legend +
  freshness over the minimal-dark basemap fallback. Smooth interpolation, the
  peek→select panel, and 'Arrêts près de moi' land in the next build steps.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Map as MapLibreMap } from 'maplibre-gl';
	import { getLocale, type Locale } from '$lib/i18n';
	import { createLiveStore, getV1Context, STATUS_CODES, OCCUPANCY_CODES } from '$lib/v1';
	import {
		MapStage,
		bakeVehicleSprites,
		addVehicleSource,
		addVehicleLayers,
		setVehicles,
		setStale,
		type VehicleMode,
	} from '$lib/components/map';
	import { LiveFreshness } from '$lib/components/surface';
	import { statusVar, occupancyVar, STATUS_GLYPH, OCCUPANCY_GLYPH } from '$lib/components/dataviz';
	import { copy as MAP_COPY, STATUS_LABELS, OCCUPANCY_LABELS } from './map.copy';

	const locale: Locale = getLocale();
	const t = $derived(MAP_COPY[locale]);

	// Live tier — one store for this surface; the v1 context is booted by the time
	// the page tree renders, so getV1Context() is safe here.
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	let mode = $state<VehicleMode>('status');
	let map = $state<MapLibreMap | null>(null);

	function onMapReady(m: MapLibreMap): void {
		bakeVehicleSprites(m);
		addVehicleSource(m);
		addVehicleLayers(m);
		map = m;
	}

	// Feed live vehicles + mode into the layer; dim on stale. Re-runs when the
	// map is wired, on each poll (live.vehicles), and on a mode toggle.
	$effect(() => {
		const m = map;
		if (!m) return;
		setVehicles(m, live.vehicles?.vehicles ?? [], mode);
		setStale(m, live.isStale);
	});
</script>

<div class="map-hero">
	<MapStage class="map-hero-stage" onready={onMapReady} label={t.mapLabel} />

	<!-- Top-left: heading + the Statut|Crowding mode toggle. -->
	<div class="map-overlay map-head">
		<p class="map-kicker">{t.kicker}</p>
		<h1 class="map-heading">{t.heading}<span class="map-dot">.</span></h1>
		<div class="map-toggle" role="group" aria-label={t.modeAria}>
			<button
				type="button"
				class="map-toggle-btn"
				data-active={mode === 'status'}
				aria-pressed={mode === 'status'}
				onclick={() => (mode = 'status')}
			>
				{t.modeStatus}
			</button>
			<button
				type="button"
				class="map-toggle-btn"
				data-active={mode === 'occupancy'}
				aria-pressed={mode === 'occupancy'}
				onclick={() => (mode = 'occupancy')}
			>
				{t.modeOccupancy}
			</button>
		</div>
	</div>

	<!-- Top-right: live freshness chip (only once a build is loaded). -->
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

	<!-- Bottom-left: mode-mirroring legend (glyph + colour, colourblind-safe). -->
	<div class="map-overlay map-legend" aria-hidden="true">
		{#if mode === 'status'}
			{#each STATUS_CODES as code (code)}
				<span class="map-legend-item">
					<span class="map-legend-glyph" style="color:{statusVar(code)}">{STATUS_GLYPH[code]}</span>
					{STATUS_LABELS[locale][code]}
				</span>
			{/each}
		{:else}
			{#each OCCUPANCY_CODES as code (code)}
				<span class="map-legend-item">
					<span class="map-legend-glyph" style="color:{occupancyVar(code)}">{OCCUPANCY_GLYPH[code]}</span>
					{OCCUPANCY_LABELS[locale][code]}
				</span>
			{/each}
		{/if}
	</div>
</div>

<style>
	.map-hero {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}
	/* Full-bleed: drop MapStage's card radius so the map reaches every edge. */
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
		gap: 0.6rem;
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

	.map-toggle {
		display: inline-flex;
		align-self: flex-start;
		padding: 3px;
		gap: 2px;
		background: color-mix(in srgb, var(--card) 88%, transparent);
		border: 1px solid var(--border);
		border-radius: 999px;
		backdrop-filter: blur(6px);
	}
	.map-toggle-btn {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		padding: 0.3rem 0.85rem;
		border: none;
		background: none;
		color: var(--muted-foreground);
		border-radius: 999px;
		cursor: pointer;
		transition: color 120ms ease;
	}
	.map-toggle-btn:hover {
		color: var(--foreground);
	}
	.map-toggle-btn:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	/* doctrine-allow: interactive — the ACTIVE toggle segment is a control state
	   (which mode is selected), not a data mark. The lone --primary touch here. */
	.map-toggle-btn[data-active='true'] {
		background: var(--primary);
		color: var(--primary-foreground);
		font-weight: 500;
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

	@media (prefers-reduced-motion: reduce) {
		.map-toggle-btn {
			transition: none;
		}
	}
</style>
