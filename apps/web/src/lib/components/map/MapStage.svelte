<!--
  MapStage — the browser-only MapLibre GL canvas host.

  SSR DISCIPLINE (critical): this component renders NOTHING server-side and
  touches NO browser globals at module scope. `maplibre-gl`, its CSS, and the
  `pmtiles` protocol are ALL pulled in via dynamic `await import(...)` inside
  `onMount`, behind an `if (browser)` guard — so the server bundle never loads
  WebGL/canvas code and prerender/SSR never sees `window`.

  Pattern: a hand-rolled `new maplibregl.Map({...})` in onMount (NOT a Svelte
  wrapper lib). The style comes from the pure, null-safe `resolveBasemapStyle`
  resolver, so the "no PMTiles archive yet" state degrades to a self-contained
  minimal dark style with zero external fetches.

  Lifecycle:
    - onMount → dynamic import, register pmtiles protocol ONCE globally, create
      the Map, wire it to the container div.
    - $effect → after the map exists, keep center/zoom/basemap in sync when the
      props change (jumpTo for camera, setStyle for a basemap swap).
    - teardown → `map.remove()` to release the GL context + listeners.
-->
<script module lang="ts">
	// Module-scoped (shared across every MapStage instance). The pmtiles protocol
	// "must be added once globally" (per the pmtiles docs), so we guard it with a
	// module-level flag rather than a per-instance one. Type-only imports here are
	// erased and never reach the server bundle.
	import type { addProtocol } from 'maplibre-gl';

	let pmtilesRegistered = false;

	/**
	 * Register the pmtiles `Protocol` with MapLibre exactly once, process-wide.
	 * Dynamically imports `pmtiles` so it stays out of the server bundle. Takes
	 * the already-dynamically-imported maplibre `addProtocol` to avoid a second
	 * import of the (large) maplibre module.
	 */
	async function registerPmtilesProtocol(add: typeof addProtocol): Promise<void> {
		if (pmtilesRegistered) return;
		const { Protocol } = await import('pmtiles');
		const protocol = new Protocol();
		add('pmtiles', protocol.tile);
		pmtilesRegistered = true;
	}
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { cn } from '$lib/utils';
	import type { BasemapFile } from '$lib/v1/schemas';
	import { resolveBasemapStyle } from './basemap';
	// Type-only import — erased at compile time, so it never pulls maplibre-gl
	// into the server bundle. The RUNTIME import happens dynamically in onMount.
	import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';

	interface MapStageProps {
		/** Initial map centre as [lng, lat] (GeoJSON/MapLibre order). */
		center?: [number, number];
		/** Initial zoom level. */
		zoom?: number;
		/**
		 * Resolved BasemapFile pointer for the current snapshot, or null when the
		 * manifest ships no hosted PMTiles archive. null → self-contained minimal
		 * dark style (no external glyphs/tiles).
		 */
		basemap?: BasemapFile | null;
		/** Accessible name for the map region (icon-/canvas-only control). */
		label?: string;
		/**
		 * Fired ONCE with the Map after its style `load` event — the safe point to
		 * `addImage`/`addSource`/`addLayer` (e.g. the live vehicle layer). Browser-
		 * only; never invoked under SSR.
		 */
		onready?: (map: MapLibreMap) => void;
		/** Consumer styling on the host wrapper. */
		class?: string;
	}

	let {
		// Default centre: STM service area (downtown Montréal).
		center = [-73.5673, 45.5017],
		zoom = 11,
		basemap = null,
		label = 'Transit map',
		onready,
		class: className,
	}: MapStageProps = $props();

	/** The host <div> MapLibre attaches its canvas to. */
	let container = $state<HTMLDivElement | null>(null);
	/** The live Map instance (browser-only; null until mounted / after teardown). */
	let map = $state<MapLibreMap | null>(null);

	onMount(() => {
		// Hard SSR guard: never instantiate WebGL on the server. (onMount already
		// only runs client-side, but the explicit guard documents the contract and
		// keeps the dynamic import dead-code on the server.)
		if (!browser) return;

		let disposed = false;

		(async () => {
			// Dynamic imports — keep maplibre-gl + pmtiles OUT of the server bundle.
			const maplibregl = (await import('maplibre-gl')).default;
			await import('maplibre-gl/dist/maplibre-gl.css');
			await registerPmtilesProtocol(maplibregl.addProtocol);

			// If the component was torn down mid-import, bail before creating a map.
			if (disposed || !container) return;

			const style: StyleSpecification = resolveBasemapStyle(
				{ basemap: basemap ? '' : null },
				basemap,
			);

			const instance = new maplibregl.Map({
				container,
				style,
				center,
				zoom,
				// Honest chrome: attribution is owned by the basemap/snapshot, not us.
				attributionControl: { compact: true },
			});

			// Notify the consumer once the style is ready, so it can add images /
			// sources / layers (the live vehicle layer) without racing the load.
			instance.on('load', () => {
				if (!disposed) onready?.(instance);
			});

			map = instance;
		})();

		// Teardown — release the GL context, event listeners, and DOM nodes.
		return () => {
			disposed = true;
			map?.remove();
			map = null;
		};
	});

	// Keep the camera in sync when center/zoom props change after creation.
	$effect(() => {
		const m = map;
		if (!m) return;
		// Read the reactive props so this effect re-runs on change.
		m.jumpTo({ center, zoom });
	});

	// Swap the basemap style ONLY when the basemap pointer changes after the
	// initial render. The constructor already applied the first style, so skip
	// the mount run — a redundant setStyle would wipe any layers a consumer added
	// via `onready` (e.g. the vehicle layer). A genuine later swap re-fires this;
	// the consumer re-adds its layers on the map's `styledata` if it must.
	let styleInited = false;
	$effect(() => {
		const m = map;
		const b = basemap;
		if (!m) return;
		if (!styleInited) {
			styleInited = true;
			return;
		}
		m.setStyle(resolveBasemapStyle({ basemap: b ? '' : null }, b));
	});
</script>

<!--
  Server render: nothing. The host div only exists in the browser, so the SSR
  payload carries no empty map shell that would flash before hydration.
-->
{#if browser}
	<div
		bind:this={container}
		class={cn('map-stage', className)}
		role="region"
		aria-label={label}
		data-slot="map-stage"
	></div>
{/if}

<style>
	.map-stage {
		position: relative;
		width: 100%;
		height: 100%;
		/* Solid surface (no alpha) — matches the minimal dark style background so
		   the container reads as one piece before the GL canvas paints. */
		background-color: var(--background);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	/* Visible focus for keyboard users landing on the map region. */
	.map-stage:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	/* Re-theme MapLibre's default control chrome to brand surfaces. These are
	   the only places we reach into maplibre-gl's own class names; scoped via
	   :global so Svelte doesn't tree-shake them as unused selectors. */
	.map-stage :global(.maplibregl-ctrl-attrib) {
		background-color: var(--card);
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}

	.map-stage :global(.maplibregl-ctrl-attrib a) {
		color: var(--accent-text);
	}
</style>
