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
      camera props actually change (jumpTo for camera, setStyle for basemap).
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
	import { applyBasemapTheme, resolveBasemapStyle, type BasemapTheme } from './basemap';
	import { mapViewportOptions, type MapFitPadding } from './viewport';
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
		/** Active app theme. Rebuilds the MapLibre style when dark/light changes. */
		theme?: BasemapTheme;
		/** Provider bbox as [minLon, minLat, maxLon, maxLat]. */
		bounds?: readonly number[];
		/** Fit padding used when the provider bbox seeds the initial camera. */
		fitPadding?: MapFitPadding;
		/** Accessible name for the map region (icon-/canvas-only control). */
		label?: string;
		/**
		 * Fired ONCE with the Map after its style `load` event — the safe point to
		 * `addImage`/`addSource`/`addLayer` (e.g. the live vehicle layer). Browser-
		 * only; never invoked under SSR.
		 */
		onready?: (map: MapLibreMap) => void;
		/**
		 * Fired after a later style swap caused by a theme/basemap change. Consumers
		 * must re-add custom images/sources/layers because MapLibre clears them when
		 * `setStyle` runs.
		 */
		onstyleload?: (map: MapLibreMap) => void;
		/** Consumer styling on the host wrapper. */
		class?: string;
	}

	let {
		// Default centre: STM service area (downtown Montréal).
		center = [-73.5673, 45.5017],
		zoom = 11,
		basemap = null,
		theme = 'dark',
		bounds,
		fitPadding = 40,
		label = 'Transit map',
		onready,
		onstyleload,
		class: className,
	}: MapStageProps = $props();

	/** The host <div> MapLibre attaches its canvas to. */
	let container = $state<HTMLDivElement | null>(null);
	/** The live Map instance (browser-only; null until mounted / after teardown). */
	let map = $state<MapLibreMap | null>(null);

	function styleKey(file: BasemapFile | null): string {
		return file?.url ?? 'minimal';
	}

	function cameraKey(nextCenter: [number, number], nextZoom: number): string {
		return `${nextCenter[0]},${nextCenter[1]},${nextZoom}`;
	}

	function fitPaddingKey(nextPadding: MapFitPadding): string {
		if (typeof nextPadding === 'number') return `${nextPadding}`;
		return [
			nextPadding.top ?? '',
			nextPadding.right ?? '',
			nextPadding.bottom ?? '',
			nextPadding.left ?? '',
		].join(',');
	}

	function fitKey(nextBounds: readonly number[] | undefined, nextPadding: MapFitPadding): string {
		return `${nextBounds?.join(',') ?? 'fallback'}:${fitPaddingKey(nextPadding)}`;
	}

	onMount(() => {
		// Hard SSR guard: never instantiate WebGL on the server. (onMount already
		// only runs client-side, but the explicit guard documents the contract and
		// keeps the dynamic import dead-code on the server.)
		if (!browser) return;

		let disposed = false;
		let resizeObserver: ResizeObserver | null = null;

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
				theme,
			);

			const instance = new maplibregl.Map({
				container,
				style,
				center,
				zoom,
				...mapViewportOptions(bounds, fitPadding),
				// Honest chrome: attribution is owned by the basemap/snapshot, not us.
				attributionControl: { compact: true },
			});

			// Notify the consumer once the style is ready, so it can add images /
			// sources / layers (the live vehicle layer) without racing the load.
			// A resize() on load is idiomatic insurance: if the container's final
			// size wasn't settled when the GL context was created, this forces the
			// drawing buffer + first frame to match the laid-out container.
			instance.on('load', () => {
				if (disposed) return;
				instance.resize();
				onready?.(instance);
			});

			// MapLibre measures the container at construction. In a flex/grid parent
			// (and after panel transitions / the rail collapsing) layout often hasn't
			// settled yet, so the GL canvas mounts at the wrong size and paints BLANK
			// until some later event fires a resize. Observing the container keeps the
			// viewport in sync — the ResizeObserver fires once immediately, which
			// repaints the initial frame, and again on every later size change.
			resizeObserver = new ResizeObserver(() => instance.resize());
			resizeObserver.observe(container);

			map = instance;
		})();

		// Teardown — release the GL context, event listeners, and DOM nodes.
		return () => {
			disposed = true;
			resizeObserver?.disconnect();
			resizeObserver = null;
			map?.remove();
			map = null;
		};
	});

	// Keep the camera in sync when center/zoom props change after creation. The
	// constructor already applies the first camera, and chrome-only re-renders
	// must not re-issue jumpTo because that can make the visible map twitch.
	let activeFitKey: string | null = null;
	$effect(() => {
		const m = map;
		if (!m) return;
		const nextFitKey = fitKey(bounds, fitPadding);
		if (activeFitKey === nextFitKey) return;
		activeFitKey = nextFitKey;
		const viewport = mapViewportOptions(bounds, fitPadding);
		m.fitBounds(viewport.bounds, { ...viewport.fitBoundsOptions, duration: 0 });
	});

	let activeCameraKey: string | null = null;
	$effect(() => {
		const m = map;
		if (!m) return;
		const nextCenter = center;
		const nextZoom = zoom;
		const nextCameraKey = cameraKey(nextCenter, nextZoom);
		if (activeCameraKey === nextCameraKey) return;
		if (activeCameraKey === null) {
			activeCameraKey = nextCameraKey;
			return;
		}
		activeCameraKey = nextCameraKey;
		m.jumpTo({ center: nextCenter, zoom: nextZoom });
	});

	// Swap the basemap style ONLY when the basemap pointer or theme changes after
	// the initial render. The constructor already applied the first style, so skip
	// the mount run — a redundant setStyle would wipe any layers a consumer added
	// via `onready` (e.g. the vehicle layer). Later swaps intentionally re-fire
	// onstyleload so the consumer can re-add images/sources/layers.
	let styleInited = false;
	let activeStyleKey: string | null = null;
	let activeTheme: BasemapTheme | null = null;
	$effect(() => {
		const m = map;
		const b = basemap;
		const t = theme;
		if (!m) return;
		const nextStyleKey = styleKey(b);
		if (!styleInited) {
			styleInited = true;
			activeStyleKey = nextStyleKey;
			activeTheme = t;
			return;
		}
		if (activeStyleKey === nextStyleKey) {
			if (activeTheme !== t) {
				applyBasemapTheme(m, t);
				activeTheme = t;
				onstyleload?.(m);
			}
			return;
		}
		activeStyleKey = nextStyleKey;
		activeTheme = t;
		m.once('style.load', () => onstyleload?.(m));
		m.setStyle(resolveBasemapStyle({ basemap: b ? '' : null }, b, t));
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
	.map-stage :global(.maplibregl-ctrl-bottom-right) {
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		bottom: 1rem;
		z-index: 12;
		transition: right 180ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.map-stage :global(.maplibregl-ctrl-attrib) {
		background-color: var(--card);
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		max-width: min(22rem, calc(100vw - var(--map-detail-offset, 0rem) - 2rem));
	}

	.map-stage :global(.maplibregl-ctrl-attrib-inner) {
		white-space: normal;
		overflow-wrap: anywhere;
	}

	.map-stage :global(.maplibregl-ctrl-attrib a) {
		color: var(--accent-text);
	}

	@media (prefers-reduced-motion: reduce) {
		.map-stage :global(.maplibregl-ctrl-bottom-right) {
			transition: none;
		}
	}

	@media (max-width: 760px) {
		.map-stage :global(.maplibregl-ctrl-bottom-right) {
			right: 0.75rem;
			bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
			max-width: calc(100vw - 5.25rem);
		}

		.map-stage :global(.maplibregl-ctrl-attrib) {
			max-width: calc(100vw - 5.25rem);
			line-height: 1.25;
		}

		.map-stage :global(.maplibregl-ctrl-attrib.maplibregl-compact) {
			box-sizing: border-box;
			min-height: 1.75rem;
			margin: 0;
			padding: 0.25rem 1.85rem 0.25rem 0.55rem;
		}

		.map-stage :global(.maplibregl-ctrl-attrib.maplibregl-compact-show) {
			max-width: calc(100vw - 5.25rem);
		}
	}
</style>
