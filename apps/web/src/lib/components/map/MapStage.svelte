<script module lang="ts">
	import type { addProtocol } from 'maplibre-gl';

	export interface MapStageImporters {
		maplibre: () => Promise<
			Pick<typeof import('maplibre-gl'), 'Map' | 'AttributionControl' | 'addProtocol'>
		>;
		css: () => Promise<unknown>;
		pmtiles: () => Promise<typeof import('pmtiles')>;
	}

	const DEFAULT_IMPORTERS: MapStageImporters = {
		maplibre: async () => {
			const [maplibre, { default: workerUrl }] = await Promise.all([
				import('maplibre-gl'),
				import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
			]);
			maplibre.setWorkerUrl(workerUrl);
			return maplibre;
		},
		css: () => import('maplibre-gl/dist/maplibre-gl.css'),
		pmtiles: () => import('pmtiles'),
	};

	export type MapStageFailureKind = 'importer' | 'protocol' | 'style' | 'construct' | 'setup';
	export interface MapStageFailure {
		readonly kind: MapStageFailureKind;
		readonly retry: () => Promise<void>;
	}

	let pmtilesRegistration: Promise<void> | null = null;

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
	import { constructRecoverableMap } from './maplibreConstructorCleanup';
	import { mapViewportOptions, type MapFitPadding } from './viewport';
	import type { Map as MapLibreMap, MapEventType, StyleSpecification } from 'maplibre-gl';

	interface MapStageProps {
		center?: [number, number];
		zoom?: number;
		basemap?: BasemapFile | null | undefined;
		basemapLoader?: (ctx: { signal: AbortSignal }) => Promise<BasemapFile | null>;
		importers?: MapStageImporters;
		theme?: BasemapTheme;
		bounds?: readonly number[];
		maxBounds?: readonly number[];
		fitPadding?: MapFitPadding;
		label?: string;
		onready?: (map: MapLibreMap, reportSetupFailure: () => void) => void;
		onrecovering?: () => void;
		onidle?: (map: MapLibreMap) => void;
		onstyleload?: (map: MapLibreMap) => void;
		onthemerepaint?: (map: MapLibreMap) => void;
		onerror?: (failure: MapStageFailure | null) => void;
		onbeforeremove?: (map: MapLibreMap) => void | PromiseLike<unknown>;
		oncleanupfailure?: (error: unknown) => unknown;
		customAttribution?: string | null;
		locale?: Record<string, string>;
		class?: string;
	}

	let {
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
		onrecovering,
		onidle,
		onstyleload,
		onthemerepaint,
		onerror,
		onbeforeremove,
		oncleanupfailure,
		customAttribution = null,
		locale,
		class: className,
	}: MapStageProps = $props();

	let container = $state<HTMLDivElement | null>(null);
	let map = $state.raw<MapLibreMap | null>(null);

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
		runtimeContainer: HTMLDivElement | null;
		map: MapLibreMap | null;
		observer: ResizeObserver | null;
		disposers: Array<() => void>;
		initializing: boolean;
		cleaned: boolean;
		recoveryQueued: boolean;
		consumerReleaseStarted: boolean;
		consumerReleasePromise: Promise<void> | null;
	}

	type CameraOwner = 'fit' | 'user' | 'focus';
	type RecoveryFocus =
		| { kind: 'canvas' }
		| { kind: 'attribution'; href: string | null; expanded: boolean }
		| null;
	interface RecoveryView {
		center: [number, number];
		zoom: number;
		bearing: number;
		pitch: number;
		roll: number;
		padding: ReturnType<MapLibreMap['getPadding']>;
		owner: CameraOwner;
		fitInputsKey: string;
		layoutInputsKey: string;
		cameraInputsKey: string;
		focus: RecoveryFocus;
	}

	let attemptKey = $state(0);
	let mounted = false;
	let retryPending = false;
	let activeFailure: { kind: MapStageFailureKind; generation: number } | null = null;
	let activeAttempt: BootAttempt | null = null;
	let activeRecoveryView: RecoveryView | null = null;

	function isCurrentAttempt(attempt: BootAttempt): boolean {
		return (
			mounted &&
			activeAttempt === attempt &&
			attempt.generation === attemptKey &&
			!attempt.controller.signal.aborted
		);
	}

	function reportLastResort(error: unknown): void {
		try {
			globalThis.reportError?.(error);
		} catch {
			// A broken platform reporter cannot reopen a disposal path.
		}
	}

	function reportCleanupReporterFailure(cleanupError: unknown, reporterError: unknown): void {
		const failure = new AggregateError(
			[cleanupError, reporterError],
			'MapStage cleanup reporter failed',
		);
		try {
			console.error('MapStage cleanup reporter failed', failure);
		} catch {
			reportLastResort(failure);
		}
	}

	function reportCleanupFailure(error: unknown): void {
		if (!oncleanupfailure) {
			try {
				console.error('MapStage cleanup failed', error);
			} catch {
				reportLastResort(error);
			}
			return;
		}
		try {
			const reported = oncleanupfailure(error);
			if (reported && typeof (reported as PromiseLike<unknown>).then === 'function') {
				void Promise.resolve(reported).catch((reporterError) =>
					reportCleanupReporterFailure(error, reporterError),
				);
			}
		} catch (reporterError) {
			reportCleanupReporterFailure(error, reporterError);
		}
	}

	function releaseWithoutEscape(dispose: () => void): void {
		try {
			dispose();
		} catch (error) {
			reportCleanupFailure(error);
		}
	}

	function cleanupAttempt(attempt: BootAttempt): boolean {
		if (attempt.cleaned) return true;
		attempt.cleaned = true;
		attempt.initializing = false;
		const ownedMap = attempt.map;
		attempt.map = null;
		const runtimeContainer = attempt.runtimeContainer;
		attempt.runtimeContainer = null;
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
		if (ownedMap && onbeforeremove && !attempt.consumerReleaseStarted) {
			attempt.consumerReleaseStarted = true;
			release(() => {
				void Promise.resolve(onbeforeremove(ownedMap)).catch(reportCleanupFailure);
			});
		}
		let pendingDisposers = disposers;
		for (let pass = 0; pass < 2 && pendingDisposers.length > 0; pass += 1) {
			const retainedDisposers: Array<() => void> = [];
			for (const dispose of pendingDisposers) {
				try {
					dispose();
				} catch (error) {
					cleanupErrors.push(error);
					retainedDisposers.push(dispose);
				}
			}
			pendingDisposers = retainedDisposers;
		}
		if (ownedMap) release(() => ownedMap.setStyle(null));
		if (ownedMap) release(() => ownedMap.remove());
		if (runtimeContainer) release(() => runtimeContainer.remove());
		for (const error of cleanupErrors) reportCleanupFailure(error);
		return cleanupErrors.length === 0 && pendingDisposers.length === 0;
	}

	function releaseConsumerForRecovery(attempt: BootAttempt): Promise<void> {
		if (attempt.consumerReleasePromise) return attempt.consumerReleasePromise;
		const ownedMap = attempt.map;
		if (!ownedMap || !onbeforeremove) return Promise.resolve();
		attempt.consumerReleaseStarted = true;
		try {
			attempt.consumerReleasePromise = Promise.resolve(onbeforeremove(ownedMap)).then(() => {});
		} catch (error) {
			attempt.consumerReleasePromise = Promise.reject(error);
		}
		return attempt.consumerReleasePromise;
	}

	function ownMapListener(
		attempt: BootAttempt,
		instance: MapLibreMap,
		type: keyof MapEventType,
		listener: (event: unknown) => void,
	): () => void {
		let active = true;
		const dispose = () => {
			if (!active) return;
			instance.off(type, listener);
			active = false;
		};
		attempt.disposers.push(dispose);
		try {
			instance.on(type, listener);
		} catch (error) {
			try {
				dispose();
			} catch {
				// The attempt ledger keeps the disposer active for the teardown retry.
			}
			throw error;
		}
		return dispose;
	}

	function ownMapControl(
		attempt: BootAttempt,
		instance: MapLibreMap,
		control: Parameters<MapLibreMap['addControl']>[0],
	): void {
		let active = true;
		const dispose = () => {
			if (!active) return;
			instance.removeControl(control);
			active = false;
		};
		attempt.disposers.push(dispose);
		try {
			instance.addControl(control);
		} catch (error) {
			try {
				dispose();
			} catch {
				// The attempt ledger retains the exact partial-control receipt.
			}
			throw error;
		}
	}

	function preflightWebgl(): void {
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('webgl2');
		if (!context) throw new Error('WebGL2 is unavailable');
		context.getExtension('WEBGL_lose_context')?.loseContext();
	}

	function loseRuntimeContexts(runtimeContainer: HTMLElement): void {
		for (const canvas of runtimeContainer.querySelectorAll('canvas')) {
			const context = canvas.getContext('webgl2');
			context?.getExtension('WEBGL_lose_context')?.loseContext();
		}
	}

	function failAttempt(attempt: BootAttempt, kind: MapStageFailureKind): void {
		if (!isCurrentAttempt(attempt)) return;
		activeFailure = { kind, generation: attempt.generation };
		cleanupAttempt(attempt);
		onerror?.({ kind, retry: () => retry(attempt.generation, kind) });
	}

	function reportRecoveryFailure(attempt: BootAttempt): void {
		activeFailure = { kind: 'setup', generation: attempt.generation };
		onerror?.({ kind: 'setup', retry: () => retry(attempt.generation, 'setup') });
	}

	function captureRecoveryFocus(attempt: BootAttempt, instance: MapLibreMap): RecoveryFocus {
		const focused = document.activeElement;
		if (focused === instance.getCanvas()) return { kind: 'canvas' };
		if (!(focused instanceof HTMLElement) || !attempt.runtimeContainer?.contains(focused))
			return null;
		const attribution = focused.closest<HTMLDetailsElement>('.maplibregl-ctrl-attrib');
		if (!attribution) return null;
		return {
			kind: 'attribution',
			href: focused.closest('a[href]')?.getAttribute('href') ?? null,
			expanded: attribution.open,
		};
	}

	function restoreRecoveryFocus(
		attempt: BootAttempt,
		instance: MapLibreMap,
		focus: RecoveryFocus,
	): void {
		if (!focus || !isCurrentAttempt(attempt) || document.activeElement !== document.body) return;
		let target: HTMLElement | null = instance.getCanvas();
		if (focus.kind === 'attribution') {
			const attribution =
				attempt.runtimeContainer?.querySelector<HTMLDetailsElement>('.maplibregl-ctrl-attrib');
			if (attribution) {
				attribution.open = focus.expanded;
				attribution.classList.toggle('maplibregl-compact-show', focus.expanded);
				target =
					(focus.href
						? Array.from(attribution.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
								(link) => link.getAttribute('href') === focus.href,
							)
						: null) ?? attribution.querySelector<HTMLElement>('.maplibregl-ctrl-attrib-button');
			}
		}
		if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
	}

	async function recoverAttempt(attempt: BootAttempt, instance: MapLibreMap): Promise<void> {
		if (!isCurrentAttempt(attempt) || attempt.map !== instance) return;
		const position = instance.getCenter();
		const view: RecoveryView = {
			center: [position.lng, position.lat],
			zoom: instance.getZoom(),
			bearing: instance.getBearing(),
			pitch: instance.getPitch(),
			roll: instance.getRoll(),
			padding: { ...instance.getPadding() },
			owner: cameraOwner,
			fitInputsKey: `${fitKey(bounds, fitPadding)}|${maxBounds?.join(',') ?? ''}`,
			layoutInputsKey: fitPaddingKey(fitPadding),
			cameraInputsKey: cameraKey(center, zoom),
			focus: captureRecoveryFocus(attempt, instance),
		};
		activeRecoveryView = view;
		try {
			onrecovering?.();
		} catch (error) {
			reportCleanupFailure(error);
			failAttempt(attempt, 'setup');
			return;
		}
		try {
			await releaseConsumerForRecovery(attempt);
		} catch (error) {
			reportCleanupFailure(error);
			if (isCurrentAttempt(attempt)) failAttempt(attempt, 'setup');
			return;
		}
		if (!isCurrentAttempt(attempt)) return;
		if (!cleanupAttempt(attempt)) {
			reportRecoveryFailure(attempt);
			return;
		}
		const nextGeneration = ++attemptKey;
		await tick();
		if (mounted && attemptKey === nextGeneration) await startAttempt(nextGeneration, view);
	}

	function queueRecovery(attempt: BootAttempt, instance: MapLibreMap, value: unknown): void {
		if (!isCurrentAttempt(attempt) || attempt.map !== instance || attempt.recoveryQueued) return;
		const original = (value as { originalEvent?: WebGLContextEvent } | null)?.originalEvent;
		if (!original?.isTrusted) return;
		const canvas = instance.getCanvas();
		if (original.target !== canvas) return;
		const context = canvas.getContext('webgl2');
		if (!context || context.isContextLost()) return;
		attempt.recoveryQueued = true;
		queueMicrotask(() => {
			void recoverAttempt(attempt, instance).catch((error) => {
				reportCleanupFailure(error);
				if (isCurrentAttempt(attempt)) failAttempt(attempt, 'setup');
			});
		});
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
			if (mounted) await startAttempt(attemptKey, activeRecoveryView ?? undefined);
		} finally {
			retryPending = false;
		}
	}

	async function startAttempt(generation: number, recoveryView?: RecoveryView): Promise<void> {
		if (!mounted || !container || activeAttempt?.initializing) return;
		const attempt: BootAttempt = {
			generation,
			container,
			controller: new AbortController(),
			runtimeContainer: null,
			map: null,
			observer: null,
			disposers: [],
			initializing: true,
			cleaned: false,
			recoveryQueued: false,
			consumerReleaseStarted: false,
			consumerReleasePromise: null,
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
			const runtimeContainer = document.createElement('div');
			runtimeContainer.style.width = '100%';
			runtimeContainer.style.height = '100%';
			runtimeContainer.dataset.mapRuntime = '';
			attempt.runtimeContainer = runtimeContainer;
			attempt.container.append(runtimeContainer);
			let instance: MapLibreMap;
			try {
				instance = constructRecoverableMap(
					maplibregl.Map,
					{
						container: runtimeContainer,
						style,
						center,
						zoom,
						...viewport,
						canvasContextAttributes: { desynchronized: true },
						locale,
						attributionControl: false,
					},
					reportCleanupFailure,
				);
			} catch (error) {
				releaseWithoutEscape(() => loseRuntimeContexts(runtimeContainer));
				throw error;
			}
			attempt.map = instance;
			const currentFitKey = `${fitKey(bounds, fitPadding)}|${maxBounds?.join(',') ?? ''}`;
			const currentCameraKey = cameraKey(center, zoom);
			const fitInputsChanged =
				recoveryView?.owner === 'fit' &&
				(recoveryView.fitInputsKey !== currentFitKey ||
					recoveryView.cameraInputsKey !== currentCameraKey);
			if (recoveryView && !fitInputsChanged) {
				instance.jumpTo({
					center: recoveryView.center,
					zoom: recoveryView.zoom,
					bearing: recoveryView.bearing,
					pitch: recoveryView.pitch,
					roll: recoveryView.roll,
					padding: recoveryView.padding,
				});
			} else if (recoveryView && fitInputsChanged) {
				instance.jumpTo({
					...(recoveryView.cameraInputsKey !== currentCameraKey ? { center, zoom } : {}),
					bearing: recoveryView.bearing,
					pitch: recoveryView.pitch,
					roll: recoveryView.roll,
					...(recoveryView.layoutInputsKey === fitPaddingKey(fitPadding)
						? { padding: recoveryView.padding }
						: {}),
				});
			}
			ownMapControl(
				attempt,
				instance,
				new maplibregl.AttributionControl({
					compact: true,
					...(customAttribution ? { customAttribution } : {}),
				}),
			);
			activeLayoutSig = fitPaddingKey(fitPadding);
			activeBoundsSig = `${bounds?.join(',') ?? 'fallback'}|${maxBounds?.join(',') ?? ''}`;
			activeCameraKey = currentCameraKey;
			cameraOwner = recoveryView?.owner ?? 'fit';
			if (recoveryView) activeFitKey = currentFitKey;
			map = instance;

			failureKind = 'setup';
			const handleLoad = () => {
				if (!isCurrentAttempt(attempt)) return;
				const reportSetupFailure = () => {
					if (isCurrentAttempt(attempt)) failAttempt(attempt, 'setup');
				};
				try {
					instance.resize();
					ownMapListener(attempt, instance, 'webglcontextrestored', (event) =>
						queueRecovery(attempt, instance, event),
					);
					onready?.(instance, reportSetupFailure);
					if (!isCurrentAttempt(attempt)) return;
				} catch {
					reportSetupFailure();
				}
			};
			ownMapListener(attempt, instance, 'load', handleLoad);
			let releaseIdle = () => {};
			let idleDelivered = false;
			const handleIdle = () => {
				releaseWithoutEscape(releaseIdle);
				if (idleDelivered || attempt.recoveryQueued || !isCurrentAttempt(attempt)) return;
				idleDelivered = true;
				onidle?.(instance);
				if (recoveryView && activeRecoveryView === recoveryView) activeRecoveryView = null;
				if (recoveryView?.focus) {
					void tick().then(() => restoreRecoveryFocus(attempt, instance, recoveryView.focus));
				}
			};
			releaseIdle = ownMapListener(attempt, instance, 'idle', handleIdle);
			let releaseStyleData = () => {};
			let releaseSourceData = () => {};
			const collapseAttribution = () => {
				if (recoveryView?.focus?.kind === 'attribution') return;
				if (!isCurrentAttempt(attempt) || !collapsePopulatedAttribution(attempt.container)) return;
				releaseWithoutEscape(releaseStyleData);
				releaseWithoutEscape(releaseSourceData);
			};
			releaseStyleData = ownMapListener(attempt, instance, 'styledata', collapseAttribution);
			releaseSourceData = ownMapListener(attempt, instance, 'sourcedata', collapseAttribution);
			const claimCamera = (value: unknown) => {
				const event = value as { originalEvent?: unknown; cameraIntent?: unknown };
				if (event.cameraIntent === 'focus') cameraOwner = 'focus';
				else if (event.originalEvent) cameraOwner = 'user';
			};
			const claimBoxZoom = () => {
				cameraOwner = 'user';
			};
			ownMapListener(attempt, instance, 'movestart', claimCamera);
			ownMapListener(attempt, instance, 'boxzoomend', claimBoxZoom);
			attempt.observer = new ResizeObserver(() => {
				if (isCurrentAttempt(attempt)) instance.resize();
			});
			attempt.observer.observe(attempt.container);
			attempt.initializing = false;
		} catch {
			failAttempt(attempt, failureKind);
		}
	}

	onMount(() => {
		if (!browser) return;
		mounted = true;
		void startAttempt(attemptKey);

		return () => {
			mounted = false;
			if (activeAttempt) cleanupAttempt(activeAttempt);
			activeRecoveryView = null;
		};
	});

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

	$effect(() => {
		const m = map;
		const b = basemap;
		const t = theme;
		if (!m) return;
		if (b === undefined) {
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
		const attempt = activeAttempt;
		if (!attempt || attempt.map !== m) return;
		let releaseStyleLoad = () => {};
		const handleStyleLoad = () => {
			releaseWithoutEscape(releaseStyleLoad);
			if (!isCurrentAttempt(attempt)) return;
			try {
				onstyleload?.(m);
			} catch {
				failAttempt(attempt, 'setup');
			}
		};
		releaseStyleLoad = ownMapListener(attempt, m, 'style.load', handleStyleLoad);
		try {
			m.setStyle(resolveBasemapStyle({ basemap: b ? '' : null }, b, t));
		} catch (error) {
			releaseWithoutEscape(releaseStyleLoad);
			throw error;
		}
		return () => releaseWithoutEscape(releaseStyleLoad);
	});
</script>

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
		background-color: var(--background);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.map-stage:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.map-stage :global(.maplibregl-ctrl-bottom-right) {
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		bottom: 1rem;
		max-width: calc(100% - var(--map-detail-offset, 0rem) - 2rem);
		z-index: 12;
		transition: right var(--duration-normal) var(--ease-out);
	}

	.map-stage :global(.maplibregl-ctrl-bottom-right .maplibregl-ctrl) {
		margin: 0;
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

	.map-stage :global(.maplibregl-ctrl-attrib-button)::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}

	@media (prefers-reduced-motion: reduce) {
		.map-stage :global(.maplibregl-ctrl-bottom-right) {
			transition: none;
		}
	}

	@media (max-width: 1023.98px) {
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
			padding: 0.25rem 1.85rem 0.25rem 0.55rem;
		}

		.map-stage :global(.maplibregl-ctrl-attrib.maplibregl-compact-show) {
			max-width: 100%;
		}
	}
</style>
