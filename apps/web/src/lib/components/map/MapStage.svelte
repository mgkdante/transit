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

  Lifecycle (attempt-based since M2d):
    - onMount → the FIRST boot attempt: basemap fetch starts up front (abort-
      aware, fail-soft), vendor+CSS imports overlap it, pmtiles registers ONCE
      globally, then the Map constructs against the resolved basemap.
    - a FAILED attempt (importer/protocol/style/construct/setup) cleans up its
      own map/observer/abort scope and signals `onerror`; Retry bumps the keyed
      host (MapLibre needs an empty container) and re-boots — except importer
      failures, which reload the document (module-import failures cache).
    - $effect → after the map exists, keep center/zoom/basemap in sync when the
      camera props actually change (jumpTo for camera, setStyle for basemap);
      theme-only changes repaint via `onthemerepaint`, never setStyle.
    - teardown → the active attempt's cleanup releases the GL context.
-->
<script module lang="ts">
	// Module-scoped (shared across every MapStage instance). The pmtiles protocol
	// "must be added once globally" (per the pmtiles docs), so registration is one
	// shared promise — reset only on ITS OWN rejection (identity-guarded) so a
	// retry can re-attempt while a concurrent success is never clobbered.
	// Type-only imports here are erased and never reach the server bundle.
	import type { addProtocol } from 'maplibre-gl';

	export interface MapStageImporters {
		maplibre: () => Promise<Pick<typeof import('maplibre-gl'), 'Map' | 'addProtocol'>>;
		css: () => Promise<unknown>;
		pmtiles: () => Promise<typeof import('pmtiles')>;
	}

	const DEFAULT_IMPORTERS: MapStageImporters = {
		maplibre: () => import('maplibre-gl'),
		css: () => import('maplibre-gl/dist/maplibre-gl.css'),
		pmtiles: () => import('pmtiles'),
	};

	export type MapStageFailureKind = 'importer' | 'protocol' | 'style' | 'construct' | 'setup';
	export interface MapStageFailure {
		readonly kind: MapStageFailureKind;
		readonly retry: () => Promise<void>;
	}

	let pmtilesRegistration: Promise<void> | null = null;

	/**
	 * Register the pmtiles `Protocol` with MapLibre exactly once, process-wide.
	 * Dynamically imports `pmtiles` so it stays out of the server bundle. Takes
	 * the already-dynamically-imported maplibre `addProtocol` to avoid a second
	 * import of the (large) maplibre module.
	 */
	export async function registerPmtilesProtocol(
		add: typeof addProtocol,
		loadPmtiles: MapStageImporters['pmtiles'],
	): Promise<void> {
		if (pmtilesRegistration) return pmtilesRegistration;
		const thisAttemptsPromise = (async () => {
			const { Protocol } = await loadPmtiles();
			const protocol = new Protocol();
			add('pmtiles', protocol.tile);
		})();
		pmtilesRegistration = thisAttemptsPromise;
		try {
			await thisAttemptsPromise;
		} catch (error) {
			if (pmtilesRegistration === thisAttemptsPromise) pmtilesRegistration = null;
			throw error;
		}
	}

	export function collapsePopulatedAttribution(container: HTMLElement): boolean {
		const attribution = container.querySelector<HTMLDetailsElement>(
			'.maplibregl-ctrl-attrib.maplibregl-compact',
		);
		if (
			!attribution?.classList.contains('maplibregl-compact-show') ||
			attribution.classList.contains('maplibregl-attrib-empty')
		) {
			return false;
		}
		attribution.classList.remove('maplibregl-compact-show');
		attribution.removeAttribute('open');
		return true;
	}
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
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
		 *
		 * This prop drives GENUINE LATER style swaps (theme/pointer change). For the
		 * FIRST paint, prefer `basemapLoader` so the resolved basemap is present at
		 * construction and the map paints hot, with no post-mount `setStyle` wipe.
		 *
		 * `undefined` means "deferred to `basemapLoader`": the swap effect ignores it
		 * so the transient `null` of a not-yet-settled resource never triggers a
		 * downgrade-to-minimal `setStyle` after the loader already painted the real
		 * basemap. Pass an explicit `BasemapFile`/`null` only to drive a real swap.
		 */
		basemap?: BasemapFile | null | undefined;
		/**
		 * Optional async resolver for the basemap, awaited ONCE inside onMount before
		 * the Map is constructed — so the very first paint already carries the hosted
		 * basemap (or null) and never suffers a post-mount `setStyle` rebuild/flicker.
		 * Its resolved value seeds the style key, so the basemap-arrival `$effect`
		 * below treats it as the initial style and only swaps on a genuine LATER
		 * theme/pointer change. When omitted, MapStage falls back to the `basemap`
		 * prop value at construction (the legacy behaviour).
		 */
		basemapLoader?: (ctx: { signal: AbortSignal }) => Promise<BasemapFile | null>;
		/** Import indirection used by the behavioral boot harness; defaults are the production chunks. */
		importers?: MapStageImporters;
		/** Active app theme. Rebuilds the MapLibre style when dark/light changes. */
		theme?: BasemapTheme;
		/** Bbox the initial camera FITS to, as [minLon, minLat, maxLon, maxLat]. */
		bounds?: readonly number[];
		/**
		 * Optional pan limit, LOOSER than `bounds`, so a left fit-padding can reveal
		 * map west of the fit window without MapLibre clamping. Defaults to `bounds`.
		 */
		maxBounds?: readonly number[];
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
		/** Fired after a theme-only token repaint; sources and data remain installed. */
		onthemerepaint?: (map: MapLibreMap) => void;
		/** Fatal initialization state. null clears the state before an in-place retry. */
		onerror?: (failure: MapStageFailure | null) => void;
		/** Release consumer-owned map state while MapLibre's style is still live. */
		onbeforeremove?: (map: MapLibreMap) => void;
		/** Partial MapLibre locale table applied at construction. */
		locale?: Record<string, string>;
		/** Consumer styling on the host wrapper. */
		class?: string;
	}

	let {
		// Default centre: STM service area (downtown Montréal).
		center = [-73.5673, 45.5017],
		zoom = 11,
		basemap = undefined,
		basemapLoader,
		importers = DEFAULT_IMPORTERS,
		theme = 'dark',
		bounds,
		maxBounds,
		fitPadding = 40,
		label = 'Transit map',
		onready,
		onstyleload,
		onthemerepaint,
		onerror,
		onbeforeremove,
		locale,
		class: className,
	}: MapStageProps = $props();

	/** The host <div> MapLibre attaches its canvas to. */
	let container = $state<HTMLDivElement | null>(null);
	/** The live Map instance (browser-only; null until mounted / after teardown). */
	let map = $state<MapLibreMap | null>(null);

	// Basemap-swap baseline. Declared up here (not beside the effect) because onMount
	// SEEDS them at construction to the basemap it paints — so the swap effect treats
	// the first hot paint as the initial style and only fires `setStyle` on a genuine
	// LATER theme/pointer change (the B2 hot-load + no-flicker contract).
	let styleInited = false;
	let activeStyleKey: string | null = null;
	let activeTheme: BasemapTheme | null = null;

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

	interface BootAttempt {
		readonly generation: number;
		readonly container: HTMLDivElement;
		readonly controller: AbortController;
		map: MapLibreMap | null;
		observer: ResizeObserver | null;
		disposers: Array<() => void>;
		initializing: boolean;
		cleaned: boolean;
	}

	let attemptKey = $state(0);
	let mounted = false;
	let retryPending = false;
	let activeFailure: { kind: MapStageFailureKind; generation: number } | null = null;
	let activeAttempt: BootAttempt | null = null;

	function isCurrentAttempt(attempt: BootAttempt): boolean {
		return (
			mounted &&
			activeAttempt === attempt &&
			attempt.generation === attemptKey &&
			!attempt.controller.signal.aborted
		);
	}

	function cleanupAttempt(attempt: BootAttempt): void {
		if (attempt.cleaned) return;
		attempt.cleaned = true;
		attempt.initializing = false;
		const ownedMap = attempt.map;
		attempt.map = null;
		const disposers = attempt.disposers.splice(0);
		const observer = attempt.observer;
		attempt.observer = null;
		if (activeAttempt === attempt) activeAttempt = null;
		if (map === ownedMap) map = null;

		const cleanupErrors: unknown[] = [];
		const release = (dispose: () => void): void => {
			try {
				dispose();
			} catch (error) {
				cleanupErrors.push(error);
			}
		};
		release(() => attempt.controller.abort());
		if (observer) release(() => observer.disconnect());
		if (ownedMap && onbeforeremove) release(() => onbeforeremove(ownedMap));
		for (const dispose of disposers) release(dispose);
		if (ownedMap) release(() => ownedMap.remove());
		if (cleanupErrors.length > 0) {
			throw cleanupErrors[0];
		}
	}

	function preflightWebgl(): void {
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
		if (!context) throw new Error('WebGL is unavailable');
		context.getExtension('WEBGL_lose_context')?.loseContext();
	}

	function failAttempt(attempt: BootAttempt, kind: MapStageFailureKind): void {
		if (!isCurrentAttempt(attempt)) return;
		activeFailure = { kind, generation: attempt.generation };
		cleanupAttempt(attempt);
		onerror?.({ kind, retry: () => retry(attempt.generation, kind) });
	}

	async function retry(generation: number, kind: MapStageFailureKind): Promise<void> {
		if (
			!mounted ||
			retryPending ||
			activeFailure?.generation !== generation ||
			activeFailure.kind !== kind
		) {
			return;
		}
		retryPending = true;
		if (kind === 'importer') {
			window.location.reload();
			return;
		}
		activeFailure = null;
		onerror?.(null);
		attemptKey += 1;
		await tick();
		try {
			if (mounted) await startAttempt(attemptKey);
		} finally {
			retryPending = false;
		}
	}

	// One boot attempt, end to end. Ordering is the protect-#5 contract: the
	// basemap promise starts FIRST (network-bound, abort-aware, fail-soft → null
	// → the self-contained fallback), the vendor+CSS imports overlap it, pmtiles
	// registers after maplibre, and construction waits for ALL of them so the
	// first paint is hot — no post-mount setStyle rebuild. `failureKind` advances
	// stage by stage so the single catch classifies honestly.
	async function startAttempt(generation: number): Promise<void> {
		if (!mounted || !container || activeAttempt?.initializing) return;
		const attempt: BootAttempt = {
			generation,
			container,
			controller: new AbortController(),
			map: null,
			observer: null,
			disposers: [],
			initializing: true,
			cleaned: false,
		};
		activeAttempt = attempt;
		const basemapPromise = Promise.resolve()
			.then(() =>
				basemapLoader ? basemapLoader({ signal: attempt.controller.signal }) : (basemap ?? null),
			)
			.catch(() => null);
		let failureKind: MapStageFailureKind = 'importer';
		try {
			const [maplibreModule] = await Promise.all([importers.maplibre(), importers.css()]);
			if (!isCurrentAttempt(attempt)) return;
			const maplibregl = maplibreModule;
			failureKind = 'protocol';
			await registerPmtilesProtocol(maplibregl.addProtocol, importers.pmtiles);
			if (!isCurrentAttempt(attempt)) return;
			const initialBasemap = await basemapPromise;
			if (!isCurrentAttempt(attempt)) return;

			styleInited = true;
			activeStyleKey = styleKey(initialBasemap);
			activeTheme = theme;
			failureKind = 'style';
			const style: StyleSpecification = resolveBasemapStyle(
				{ basemap: initialBasemap ? '' : null },
				initialBasemap,
				theme,
			);

			failureKind = 'construct';
			preflightWebgl();
			const viewport = mapViewportOptions(bounds, fitPadding, maxBounds);
			const instance = new maplibregl.Map({
				container: attempt.container,
				style,
				center,
				zoom,
				...viewport,
				locale,
				// Honest chrome: attribution is owned by the basemap/snapshot, not us.
				attributionControl: { compact: true },
			});
			attempt.map = instance;
			activeLayoutSig = fitPaddingKey(fitPadding);
			activeBoundsSig = `${bounds?.join(',') ?? 'fallback'}|${maxBounds?.join(',') ?? ''}`;
			activeCameraKey = cameraKey(center, zoom);
			cameraOwner = 'fit';
			map = instance;

			failureKind = 'setup';
			// resize() on load is idiomatic insurance: if the container's final size
			// wasn't settled when the GL context was created, this forces the drawing
			// buffer + first frame to match the laid-out container.
			instance.on('load', () => {
				if (!isCurrentAttempt(attempt)) return;
				instance.resize();
				onready?.(instance);
			});
			// One-shot attribution collapse: maplibre's compact control still STARTS
			// expanded; once attribution populates (never on the empty fallback), we
			// land the exact end state a user click produces, then detach.
			const collapseAttribution = () => {
				if (!isCurrentAttempt(attempt) || !collapsePopulatedAttribution(attempt.container)) return;
				instance.off('styledata', collapseAttribution);
				instance.off('sourcedata', collapseAttribution);
			};
			instance.on('styledata', collapseAttribution);
			instance.on('sourcedata', collapseAttribution);
			const claimCamera = (event: { originalEvent?: unknown; cameraIntent?: unknown }) => {
				if (event.cameraIntent === 'focus') cameraOwner = 'focus';
				else if (event.originalEvent) cameraOwner = 'user';
			};
			const claimBoxZoom = () => {
				cameraOwner = 'user';
			};
			instance.on('movestart', claimCamera);
			attempt.disposers.push(() => instance.off('movestart', claimCamera));
			instance.on('boxzoomend', claimBoxZoom);
			attempt.disposers.push(() => instance.off('boxzoomend', claimBoxZoom));
			// MapLibre measures the container at construction; in a flex/grid parent
			// layout may not have settled, so observing keeps the viewport in sync
			// (fires once immediately, repainting the initial frame).
			attempt.observer = new ResizeObserver(() => instance.resize());
			attempt.observer.observe(attempt.container);
			attempt.initializing = false;
		} catch {
			failAttempt(attempt, failureKind);
		}
	}

	onMount(() => {
		// Hard SSR guard: never instantiate WebGL on the server. (onMount already
		// only runs client-side, but the explicit guard documents the contract and
		// keeps the dynamic import dead-code on the server.)
		if (!browser) return;
		mounted = true;
		void startAttempt(attemptKey);

		// Teardown — release the GL context, event listeners, and DOM nodes.
		return () => {
			mounted = false;
			if (activeAttempt) cleanupAttempt(activeAttempt);
		};
	});

	// Constructor framing owns boot/retry. Later HMR/prop-driven camera changes
	// apply only while framing still owns the camera; user and focus moves persist.
	type CameraOwner = 'fit' | 'user' | 'focus';
	let cameraOwner: CameraOwner = 'fit';
	let activeFitKey: string | null = null;
	let activeLayoutSig: string | null = null;
	let activeBoundsSig: string | null = null;
	let activeCameraKey: string | null = null;

	$effect(() => {
		const m = map;
		if (!m) return;
		const nextFitKey = `${fitKey(bounds, fitPadding)}|${maxBounds?.join(',') ?? ''}`;
		if (activeFitKey === nextFitKey) return;
		activeFitKey = nextFitKey;
		const nextLayoutSig = fitPaddingKey(fitPadding);
		const nextBoundsSig = `${bounds?.join(',') ?? 'fallback'}|${maxBounds?.join(',') ?? ''}`;
		const layoutChanged = activeLayoutSig !== nextLayoutSig;
		const boundsChanged = activeBoundsSig !== nextBoundsSig;
		if (!layoutChanged && !boundsChanged) return;
		activeLayoutSig = nextLayoutSig;
		activeBoundsSig = nextBoundsSig;
		const viewport = mapViewportOptions(bounds, fitPadding, maxBounds);
		if (boundsChanged) m.setMaxBounds(viewport.maxBounds);
		if (cameraOwner === 'fit') {
			m.fitBounds(viewport.bounds, { ...viewport.fitBoundsOptions, duration: 0 });
		}
	});

	$effect(() => {
		const m = map;
		if (!m) return;
		const nextCenter = center;
		const nextZoom = zoom;
		const nextCameraKey = cameraKey(nextCenter, nextZoom);
		if (activeCameraKey === nextCameraKey) return;
		activeCameraKey = nextCameraKey;
		if (cameraOwner === 'fit') m.jumpTo({ center: nextCenter, zoom: nextZoom });
	});

	// Swap the basemap style ONLY when the basemap pointer or theme changes after
	// the initial render. The constructor already applied the first style (seeding
	// the baseline above), so skip the mount run — a redundant setStyle would wipe
	// any layers a consumer added via `onready` (e.g. the vehicle layer). Later
	// swaps intentionally re-fire onstyleload so the consumer can re-add layers.
	$effect(() => {
		const m = map;
		const b = basemap;
		const t = theme;
		if (!m) return;
		// `undefined` = deferred to the loader: never act on it for a style swap. This
		// keeps the transient `null` of a not-yet-settled basemap resource (passed as
		// the prop alongside the loader) from downgrading the already-painted basemap
		// to minimal. A real pointer swap passes an explicit BasemapFile or null.
		if (b === undefined) {
			// Still honour a pure theme change while the basemap stays deferred.
			if (activeTheme !== t) {
				applyBasemapTheme(m, t);
				activeTheme = t;
				onthemerepaint?.(m);
			}
			return;
		}
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
				onthemerepaint?.(m);
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
	{#key attemptKey}
		<div
			bind:this={container}
			class={cn('map-stage', className)}
			role="region"
			aria-label={label}
			data-ripple-exempt
			data-slot="map-stage"
		></div>
	{/key}
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
		max-width: calc(100% - var(--map-detail-offset, 0rem) - 2rem);
		z-index: 12;
		transition: right var(--duration-normal) var(--ease-out);
	}

	.map-stage :global(.maplibregl-ctrl-attrib) {
		background-color: var(--card);
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		box-sizing: border-box;
		max-width: min(32rem, 100%);
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

	@media (max-width: 768px) {
		.map-stage :global(.maplibregl-ctrl-bottom-right) {
			right: 0.75rem;
			bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
			max-width: calc(100% - 1.5rem);
		}

		.map-stage :global(.maplibregl-ctrl-attrib) {
			max-width: 100%;
			line-height: 1.25;
		}

		.map-stage :global(.maplibregl-ctrl-attrib.maplibregl-compact) {
			box-sizing: border-box;
			min-height: 1.75rem;
			margin: 0;
			padding: 0.25rem 1.85rem 0.25rem 0.55rem;
		}

		.map-stage :global(.maplibregl-ctrl-attrib.maplibregl-compact-show) {
			max-width: 100%;
		}
	}
</style>
