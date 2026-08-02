import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	setStopException as setRealStopException,
	toStopFeatures,
} from '$lib/components/map/stopsLayer';
import MapHero from './MapHero.svelte';
import MapHeroNavigationHarness from '../../../routes/__fixtures__/MapHeroNavigationHarness.svelte';
import { mapHeroReceiptSignals } from './__fixtures__/MapHeroReceiptSignals.svelte';

const harness = vi.hoisted(() => {
	const identityReceivers: unknown[] = [];
	const bakeVehicleSprites = vi.fn();
	const bakeLocationPinSprite = vi.fn();
	const sourceInstaller = (id: string) =>
		vi.fn(
			(map: { addSource: (sourceId: string, source: { setData(data: unknown): void }) => void }) =>
				map.addSource(id, { setData: vi.fn() }),
		);
	const addVehicleSource = sourceInstaller('vehicles');
	const addVehicleLayers = vi.fn();
	const addStopsSource = sourceInstaller('stops');
	const addStopsLayer = vi.fn();
	const addStopExceptionSource = sourceInstaller('stop-exception');
	const addStopExceptionLayer = vi.fn();
	const addRouteLineSource = sourceInstaller('route-lines');
	const addRouteLineLayers = vi.fn();
	const addNearTargetSource = sourceInstaller('near-target');
	const addNearTargetLayer = vi.fn();
	const setRouteLines = vi.fn();
	const setStops = vi.fn();
	const stopExceptionSourceSetData = vi.fn();
	const setStopException = vi.fn(
		(
			_map: unknown,
			stopsById: Readonly<Record<string, { id: string }>>,
			selectedStopId: string | null,
			hoveredStopId: string | null,
		) => {
			const ids = [selectedStopId, hoveredStopId].filter(
				(id, index, all): id is string =>
					id != null && all.indexOf(id) === index && Object.hasOwn(stopsById, id),
			);
			stopExceptionSourceSetData({
				type: 'FeatureCollection',
				features: ids.map((id) => ({ properties: { id } })),
			});
		},
	);
	const setNearTarget = vi.fn();
	const setStale = vi.fn();
	const vehicleSourceSetData = vi.fn();
	let reducedMotion = false;
	const reducedMotionSubscribers = new Set<(value: boolean) => void>();
	const prefersReducedMotion = {
		subscribe(subscriber: (value: boolean) => void) {
			subscriber(reducedMotion);
			reducedMotionSubscribers.add(subscriber);
			return () => reducedMotionSubscribers.delete(subscriber);
		},
	};
	const setReducedMotion = (next: boolean) => {
		reducedMotion = next;
		for (const subscriber of reducedMotionSubscribers) subscriber(next);
	};
	let vehicleMotionFrame: number | null = null;
	let vehicleMotionFeatures: unknown = null;
	const stopVehicleUploads = () => {
		if (vehicleMotionFrame == null || typeof cancelAnimationFrame !== 'function') return;
		cancelAnimationFrame(vehicleMotionFrame);
		vehicleMotionFrame = null;
	};
	const uploadVehicleFrame = () => {
		if (vehicleMotionFrame == null) return;
		vehicleSourceSetData(vehicleMotionFeatures);
		vehicleMotionFrame = requestAnimationFrame(uploadVehicleFrame);
	};
	const runMotionSet = (
		features: unknown,
		options?: { animate?: boolean; serverNowFn?: () => number },
	) => {
		options?.serverNowFn?.();
		vehicleMotionFeatures = features;
		if (options?.animate && typeof requestAnimationFrame === 'function') {
			if (vehicleMotionFrame == null) {
				vehicleMotionFrame = requestAnimationFrame(uploadVehicleFrame);
			}
		} else {
			stopVehicleUploads();
			vehicleSourceSetData(features);
		}
	};
	const motionSet = vi.fn(runMotionSet);
	const motionDestroy = vi.fn(stopVehicleUploads);
	const releaseLease = vi.fn();
	const urlCoordinators: Array<{
		dispose(): void;
		pendingRequestCount(): number;
	}> = [];
	const stops = [
		{
			id: 'stop-1',
			name: 'Sherbrooke / Saint-Denis',
			code: '52618',
			lat: 45.51,
			lon: -73.57,
		},
		{
			id: 'stop-2',
			name: 'Temporary stop / Clark',
			code: '52619',
			lat: 45.512,
			lon: -73.572,
		},
	];
	type StopsIndex = { generated_utc: string; stops: typeof stops };
	const defaultStopsIndex = (): StopsIndex => ({
		generated_utc: '2026-06-20T12:00:00Z',
		stops,
	});
	let stopsIndexResult: StopsIndex | Promise<StopsIndex> = defaultStopsIndex();
	const getStopsIndexSlim = vi.fn(() => stopsIndexResult);
	const deferStopsIndex = () => {
		let resolve!: (value: StopsIndex) => void;
		stopsIndexResult = new Promise<StopsIndex>((done) => {
			resolve = done;
		});
		return { resolve, value: defaultStopsIndex() };
	};
	const resetStopsIndex = () => {
		stopsIndexResult = defaultStopsIndex();
	};
	const getRoute = vi.fn(async (_id?: string, _options?: unknown) => null);
	const getStop = vi.fn(() => null);
	const focusCoordinate = vi.fn(() => true);
	const fitRouteBounds = vi.fn(() => true);
	const toVehicleFeatures = vi.fn(
		(
			_items: unknown,
			filter: { vehicles: ReadonlySet<string> },
			_alertIds: unknown,
			selectedId: string | null,
		) => ({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [-73.57, 45.51] },
					properties: {
						id: 'bus-1',
						selected: selectedId === 'bus-1' || filter.vehicles.has('bus-1') ? 1 : 0,
					},
				},
			],
		}),
	);
	const createVehicleMotionController = vi.fn(() => ({
		set: motionSet,
		destroy: motionDestroy,
	}));
	const alertSource = {
		id: 'mobile-orchestrator-alert',
		severity: 'high',
		header_key: 'Your stop',
		description_en: '<p>Board at the temporary stop &amp; follow signs.</p>',
		routes: ['24'],
		// The alert belongs to the picked stop, but its first affected stop is a
		// different one. That makes the real orchestrator perform an observable
		// in-sheet selection swap while preserving stop-1 on its Back stack.
		stops: ['stop-2', 'stop-1'],
	};
	const alert = new Proxy(alertSource, {
		get(target, property, receiver) {
			if (property === 'routes' || property === 'stops') identityReceivers.push(receiver);
			return Reflect.get(target, property, receiver);
		},
	});
	const vehicle = {
		id: 'bus-1',
		lat: 45.51,
		lon: -73.57,
		status: 'on_time' as const,
		updated_utc: '2026-06-20T12:00:00Z',
		route: '24',
		next_stop: 'stop-1',
	};
	let liveVehicleVisible = true;
	let detailFilter: ((chip: unknown) => void) | null = null;
	const liveStore = {
		vehicles: { generated_utc: '2026-06-20T12:00:00Z', vehicles: [vehicle] },
		trips: null,
		departures: null,
		alerts: { generated_utc: '2026-06-20T12:00:00Z', alerts: [alert] },
		network: null,
		index: {
			byVehicleId: new Map([[vehicle.id, vehicle]]),
			byTripId: new Map(),
			byStopId: new Map(),
			vehiclesByRoute: new Map(),
			vehiclesByStop: new Map([['stop-1', new Set([vehicle.id])]]),
		},
		generatedUtc: '2026-06-20T12:00:00Z',
		ageSeconds: 30,
		isStale: false,
		vehiclesGeneratedUtc: '2026-06-20T12:00:00Z',
		vehiclesAgeSeconds: 30,
		vehiclesIsStale: false,
		familyStates: {
			vehicles: {
				phase: 'ready',
				active: true,
				lastGoodAt: Date.parse('2026-06-20T12:00:30Z'),
				retainedGeneration: '2026-06-20T12:00:00Z',
				consecutiveFailures: 0,
				error: null,
				successRevision: 1,
			},
			trips: {
				phase: 'idle',
				active: false,
				lastGoodAt: null,
				retainedGeneration: null,
				consecutiveFailures: 0,
				error: null,
				successRevision: 0,
			},
			departures: {
				phase: 'idle',
				active: false,
				lastGoodAt: null,
				retainedGeneration: null,
				consecutiveFailures: 0,
				error: null,
				successRevision: 0,
			},
			alerts: {
				phase: 'ready',
				active: true,
				lastGoodAt: Date.parse('2026-06-20T12:00:30Z'),
				retainedGeneration: '2026-06-20T12:00:00Z',
				consecutiveFailures: 0,
				error: null,
				successRevision: 1,
			},
			network: {
				phase: 'idle',
				active: false,
				lastGoodAt: null,
				retainedGeneration: null,
				consecutiveFailures: 0,
				error: null,
				successRevision: 0,
			},
		},
		loading: false,
		error: null,
		start: vi.fn(),
		stop: vi.fn(),
		refresh: vi.fn(),
		subscribeFamilies: vi.fn(() => releaseLease),
	};
	type HarnessNavigation = {
		from: { url: URL } | null;
		to: { url: URL } | null;
		type: 'goto' | 'link' | 'popstate';
		delta?: number;
	};
	const beforeNavigateCallbacks: Array<(navigation: HarnessNavigation) => void> = [];
	const afterNavigateCallbacks: Array<(navigation: HarnessNavigation) => void> = [];
	let activeNavigation: HarnessNavigation | null = null;
	let publishNavigating = (_navigation: HarnessNavigation | null): void => {
		throw new Error('navigation publisher used before the $app/stores mock factory ran');
	};
	const beforeNavigate = vi.fn((callback: (navigation: HarnessNavigation) => void) => {
		beforeNavigateCallbacks.push(callback);
	});
	const afterNavigate = vi.fn((callback: (navigation: HarnessNavigation) => void) => {
		afterNavigateCallbacks.push(callback);
	});
	function unregisterNavigationCallback(
		callbacks: Array<(navigation: HarnessNavigation) => void>,
		callback: (navigation: HarnessNavigation) => void,
	): void {
		const index = callbacks.indexOf(callback);
		if (index !== -1) callbacks.splice(index, 1);
	}

	return {
		alert,
		locale: 'en' as 'en' | 'fr',
		isDesktop: false,
		// reassigned by the $app/stores mock factory below
		setPageUrl: (_href: string, _state: Readonly<Record<string, unknown>> = {}): void => {
			throw new Error('setPageUrl used before the $app/stores mock factory ran');
		},
		bindNavigatingStore(publish: (navigation: HarnessNavigation | null) => void): void {
			publishNavigating = publish;
		},
		get activeNavigationTarget(): URL | null {
			return activeNavigation?.to?.url ?? null;
		},
		get navigationActive(): boolean {
			return activeNavigation != null;
		},
		resetNavigation(): void {
			activeNavigation = null;
			publishNavigating(null);
		},
		createLiveStore: vi.fn((_manifest: unknown, _options?: unknown) => liveStore),
		liveStore,
		identityReceivers,
		urlCoordinators,
		captureUrlCoordinator(coordinator: (typeof urlCoordinators)[number]) {
			urlCoordinators.push(coordinator);
		},
		goto: vi.fn(async (_target: string, _options?: Record<string, unknown>) => {}),
		afterNavigate,
		afterNavigateCallbacks,
		beforeNavigate,
		beforeNavigateCallbacks,
		unregisterAfterNavigate: (callback: (navigation: HarnessNavigation) => void) =>
			unregisterNavigationCallback(afterNavigateCallbacks, callback),
		unregisterBeforeNavigate: (callback: (navigation: HarnessNavigation) => void) =>
			unregisterNavigationCallback(beforeNavigateCallbacks, callback),
		startNavigation(
			href: string,
			from = 'http://localhost/map',
			options: { accepted?: boolean; type?: HarnessNavigation['type']; delta?: number } = {},
		) {
			const navigation: HarnessNavigation = {
				from: { url: new URL(from) },
				to: { url: new URL(href) },
				type: options.type ?? 'goto',
				...(options.delta == null ? {} : { delta: options.delta }),
			};
			const beforeNavigateDelivered = activeNavigation == null;
			if (beforeNavigateDelivered) {
				for (const callback of beforeNavigateCallbacks) callback(navigation);
			}
			if (options.accepted !== false) {
				activeNavigation = navigation;
				publishNavigating(navigation);
			}
			return { beforeNavigateDelivered, navigation };
		},
		runAfterNavigate(href: string, from = 'http://localhost/map') {
			const completedNavigation = activeNavigation;
			const navigation: HarnessNavigation = {
				from: { url: new URL(from) },
				to: { url: new URL(href) },
				type: completedNavigation?.type ?? 'goto',
				...(completedNavigation?.delta == null ? {} : { delta: completedNavigation.delta }),
			};
			activeNavigation = null;
			for (const callback of afterNavigateCallbacks) callback(navigation);
			publishNavigating(null);
		},
		bakeVehicleSprites,
		bakeLocationPinSprite,
		addVehicleSource,
		addVehicleLayers,
		addStopsSource,
		addStopsLayer,
		addStopExceptionSource,
		addStopExceptionLayer,
		addRouteLineSource,
		addRouteLineLayers,
		addNearTargetSource,
		addNearTargetLayer,
		setRouteLines,
		setStops,
		setStopException,
		stopExceptionSourceSetData,
		setNearTarget,
		setStale,
		prefersReducedMotion,
		setReducedMotion,
		isPrefersReducedMotion: () => reducedMotion,
		motionSet,
		resetMotionSetImplementation: () => motionSet.mockImplementation(runMotionSet),
		resetGetRouteImplementation: () => getRoute.mockImplementation(async () => null),
		getStopsIndexSlim,
		deferStopsIndex,
		resetStopsIndex,
		vehicleSourceSetData,
		motionDestroy,
		releaseLease,
		createVehicleMotionController,
		getRoute,
		getStop,
		focusCoordinate,
		fitRouteBounds,
		toVehicleFeatures,
		vehicle,
		stops,
		get detailFilter() {
			return detailFilter;
		},
		captureDetailFilter(next: ((chip: unknown) => void) | null) {
			detailFilter = next;
		},
		get liveVehicleVisible() {
			return liveVehicleVisible;
		},
		setLiveVehicleVisible(next: boolean) {
			liveVehicleVisible = next;
			if (next) liveStore.index.byVehicleId.set(vehicle.id, vehicle);
			else liveStore.index.byVehicleId.delete(vehicle.id);
		},
	};
});

const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

vi.mock('$app/stores', async () => {
	const { writable } = await import('svelte/store');
	const pageValue = (url: URL, state: Readonly<Record<string, unknown>> = {}) => ({
		url,
		params: {},
		route: { id: '/map' },
		status: 200,
		error: null,
		data: {},
		form: null,
		state,
	});
	const store = writable(pageValue(new URL('http://localhost/map')));
	const navigatingStore = writable<{
		from: { url: URL } | null;
		to: { url: URL } | null;
	} | null>(null);
	harness.setPageUrl = (href: string, state: Readonly<Record<string, unknown>> = {}) =>
		store.set(pageValue(new URL(href), state));
	harness.bindNavigatingStore((navigation) => navigatingStore.set(navigation));
	return { page: store, navigating: navigatingStore };
});

vi.mock('$app/navigation', async () => {
	const { onMount } = await import('svelte');
	type Callback = (navigation: { from: { url: URL } | null; to: { url: URL } | null }) => void;
	function lifecycleRegistration(
		register: (callback: Callback) => void,
		unregister: (callback: Callback) => void,
	) {
		return (callback: Callback) => {
			register(callback);
			onMount(() => () => unregister(callback));
		};
	}
	return {
		goto: harness.goto,
		afterNavigate: lifecycleRegistration(harness.afterNavigate, harness.unregisterAfterNavigate),
		beforeNavigate: lifecycleRegistration(harness.beforeNavigate, harness.unregisterBeforeNavigate),
	};
});

vi.mock('./mapUrlCoordinator', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./mapUrlCoordinator')>();
	return {
		...actual,
		createMapUrlCoordinator: (...args: Parameters<typeof actual.createMapUrlCoordinator>) => {
			const coordinator = actual.createMapUrlCoordinator(...args);
			harness.captureUrlCoordinator(coordinator);
			return coordinator;
		},
	};
});

vi.mock('$env/dynamic/public', () => ({ env: {} }));

vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => harness.locale };
});

vi.mock('$lib/nav', () => ({
	layout: {
		get isDesktop() {
			return harness.isDesktop;
		},
	},
	isDesktopViewport: () => false,
	routeFor: (target: { kind: string; id: string }) => {
		if (target.kind === 'stop') return `/stop/${target.id}`;
		if (target.kind === 'line') return `/lines/${target.id}`;
		if (target.kind === 'trip') return `/trip/${target.id}`;
		return '/map';
	},
}));

vi.mock('$lib/stores', async () => {
	const { mapHeroReceiptSignals: signals } =
		await import('./__fixtures__/MapHeroReceiptSignals.svelte');
	return {
		themeStore: {
			current: 'dark',
			isDark: true,
			toggle: vi.fn(),
			apply: vi.fn(),
			init: vi.fn(),
		},
		sharedClock: signals.clock,
		motionMode: {
			get current() {
				return signals.motionMode;
			},
			set: signals.setMotionMode,
		},
		persisted: <T>(_key: string, initial: T) => ({ value: initial }),
		dataRefresh: {},
	};
});

vi.mock('$lib/v1/boot', () => ({
	getV1Context: () => ({
		manifest: {
			provider: 'stm',
			files: { live: { ttl_s: 30 } },
		},
		labels: {},
		lang: 'en',
	}),
}));
vi.mock('$lib/v1/repositories/basemap', () => ({
	getBasemap: () => null,
}));
vi.mock('$lib/v1/repositories/static', () => ({
	getRoutesIndex: () => ({ generated_utc: '2026-06-20T12:00:00Z', routes: [] }),
	getStopsIndexSlim: harness.getStopsIndexSlim,
	getRoute: harness.getRoute,
	getStop: harness.getStop,
}));
vi.mock('$lib/v1/live/store.svelte', async () => {
	const { mapHeroReceiptSignals: signals } =
		await import('./__fixtures__/MapHeroReceiptSignals.svelte');
	const liveIndex = harness.liveStore.index;
	Object.defineProperty(harness.liveStore, 'index', {
		configurable: true,
		get: () => {
			void signals.vehiclesGeneration;
			return liveIndex;
		},
	});
	Object.defineProperty(harness.liveStore, 'vehicles', {
		configurable: true,
		get: () => {
			const generation = signals.vehiclesGeneration;
			return {
				generated_utc: generation,
				vehicles: harness.liveVehicleVisible
					? [
							{
								...harness.vehicle,
								route: generation === '2026-06-20T12:00:00Z' ? '24' : '55',
							},
						]
					: [],
			};
		},
	});
	Object.defineProperty(harness.liveStore, 'vehiclesGeneratedUtc', {
		configurable: true,
		get: () => signals.vehiclesGeneration,
	});
	Object.defineProperty(harness.liveStore.familyStates.vehicles, 'successRevision', {
		configurable: true,
		get: () => Number(signals.vehiclesGeneration.slice(17, 19)),
	});
	return { createLiveStore: harness.createLiveStore };
});

vi.mock('$lib/v1/resource.svelte', async () => {
	const { createMapHeroResourceStub } = await import('./__fixtures__/MapHeroResourceStub.svelte');
	return { createResource: createMapHeroResourceStub };
});

vi.mock('./MapSelectionDetail.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./MapSelectionDetail.svelte')>();
	return {
		default: new Proxy(actual.default, {
			apply(target, thisArg, args) {
				const props = args[1] as { onfilter?: (chip: unknown) => void } | undefined;
				harness.captureDetailFilter(props?.onfilter ?? null);
				return Reflect.apply(target, thisArg, args);
			},
		}),
	};
});

vi.mock('$lib/components/map', async () => {
	const { default: MapStage } = await import('./__fixtures__/MapStageStub.svelte');
	return {
		MapStage,
		STOPS_LAYER: 'stops',
		STOPS_SOURCE: 'stops',
		STOP_EXCEPTION_LAYER: 'stop-exception',
		STOP_EXCEPTION_SOURCE: 'stop-exception',
		VEHICLE_BODY_LAYER: 'vehicle-body',
		VEHICLE_SOURCE: 'vehicles',
		ROUTE_LINE_HIT_LAYER: 'route-lines-hit',
		bakeVehicleSprites: harness.bakeVehicleSprites,
		bakeLocationPinSprite: harness.bakeLocationPinSprite,
		addVehicleSource: harness.addVehicleSource,
		addVehicleLayers: harness.addVehicleLayers,
		setStale: harness.setStale,
		toVehicleFeatures: harness.toVehicleFeatures,
		createVehicleMotionController: harness.createVehicleMotionController,
		addStopsSource: harness.addStopsSource,
		addStopsLayer: harness.addStopsLayer,
		addStopExceptionSource: harness.addStopExceptionSource,
		addStopExceptionLayer: harness.addStopExceptionLayer,
		setStops: harness.setStops,
		setStopException: harness.setStopException,
		addRouteLineSource: harness.addRouteLineSource,
		addRouteLineLayers: harness.addRouteLineLayers,
		setRouteLines: harness.setRouteLines,
		addNearTargetSource: harness.addNearTargetSource,
		addNearTargetLayer: harness.addNearTargetLayer,
		setNearTarget: harness.setNearTarget,
		nearestStops: () => [{ ...harness.stops[0], distanceM: 100 }],
		centerFromProviderBbox: () => [-73.72, 45.52],
		liveTtlS: (ttl: number | null | undefined) => Math.max(1, ttl ?? 30),
		routeDirectionVariants: () => [],
		routeShapes: () => [],
		bestShapeForPoint: () => null,
		fixAgeS: () => 0,
		isVehicleStale: () => false,
	};
});

vi.mock('./mapCamera', () => ({
	focusCoordinate: harness.focusCoordinate,
	fitRouteBounds: harness.fitRouteBounds,
}));

vi.mock('@yesid/motion/stores/reducedMotion', () => ({
	prefersReducedMotion: harness.prefersReducedMotion,
	isPrefersReducedMotion: harness.isPrefersReducedMotion,
}));

afterEach(() => {
	cleanup();
	document.body.innerHTML = '';
	vi.clearAllMocks();
	harness.resetMotionSetImplementation();
	harness.resetGetRouteImplementation();
	harness.resetStopsIndex();
	harness.setLiveVehicleVisible(true);
	harness.captureDetailFilter(null);
	harness.beforeNavigateCallbacks.length = 0;
	harness.afterNavigateCallbacks.length = 0;
	harness.resetNavigation();
	harness.identityReceivers.length = 0;
	harness.urlCoordinators.length = 0;
	harness.locale = 'en';
	harness.isDesktop = false;
	harness.setPageUrl('http://localhost/map');
	mapHeroReceiptSignals.reset();
	harness.setReducedMotion(false);
	localStorage.removeItem('transit:detail-rail');
	vi.unstubAllGlobals();
	if (originalSecureContext) {
		Object.defineProperty(window, 'isSecureContext', originalSecureContext);
	} else {
		Reflect.deleteProperty(window, 'isSecureContext');
	}
	if (originalGeolocation) {
		Object.defineProperty(navigator, 'geolocation', originalGeolocation);
	} else {
		Reflect.deleteProperty(navigator, 'geolocation');
	}
});

function bulkCounts() {
	return {
		routes: harness.setRouteLines.mock.calls.length,
		motion: harness.motionSet.mock.calls.length,
		stops: harness.setStops.mock.calls.length,
		nearTarget: harness.setNearTarget.mock.calls.length,
	};
}

async function settleAnimationFrames(count = 2): Promise<void> {
	for (let frame = 0; frame < count; frame += 1) {
		await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
	}
	await tick();
}

function peekText(container: HTMLElement): string {
	return container.querySelector('.map-peek')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
}

describe('MapHero stage lifecycle', () => {
	it('passes the exact English MapLibre locale dictionary to the stage', () => {
		render(MapHero);

		expect(screen.getByTestId('map-stage-stub').getAttribute('data-locale')).toBe(
			JSON.stringify({
				'Map.Title': 'Interactive map',
				'AttributionControl.ToggleAttribution': 'Toggle attribution',
			}),
		);
	});

	it('retints every token surface on theme repaint without feed, motion, or emphasis replay', async () => {
		const installSpies = [
			harness.bakeVehicleSprites,
			harness.bakeLocationPinSprite,
			harness.addRouteLineSource,
			harness.addRouteLineLayers,
			harness.addStopsSource,
			harness.addStopExceptionSource,
			harness.addStopsLayer,
			harness.addStopExceptionLayer,
			harness.addVehicleSource,
			harness.addVehicleLayers,
			harness.addNearTargetSource,
			harness.addNearTargetLayer,
		];
		render(MapHero);
		await tick();
		await fireEvent.click(screen.getByTestId('map-stage-stub-hover-vehicle'));
		await tick();
		const stage = screen.getByTestId('map-stage-stub');
		const before = {
			installs: installSpies.map((spy) => spy.mock.calls.length),
			feeds: bulkCounts(),
			stale: harness.setStale.mock.calls.length,
			setData: harness.vehicleSourceSetData.mock.calls.length,
			featureState: Number(stage.getAttribute('data-feature-state-set-count')),
		};

		await fireEvent.click(screen.getByTestId('map-stage-stub-theme-repaint'));
		await tick();

		expect(installSpies.map((spy) => spy.mock.calls.length)).toEqual(
			before.installs.map((count) => count + 1),
		);
		expect(bulkCounts()).toEqual(before.feeds);
		expect(harness.setStale).toHaveBeenCalledTimes(before.stale);
		expect(harness.vehicleSourceSetData).toHaveBeenCalledTimes(before.setData);
		expect(Number(stage.getAttribute('data-feature-state-set-count'))).toBe(before.featureState);
	});

	it('replaces dead map chrome with an English full-surface retry notice', async () => {
		const view = render(MapHero);
		expect(screen.queryByRole('alert')).toBeNull();

		await fireEvent.click(screen.getByTestId('map-stage-stub-error'));

		expect(await screen.findByRole('alert')).toHaveTextContent('Map unavailable');
		expect(screen.getByRole('alert')).toHaveTextContent('The map could not start. Try again.');
		expect(screen.queryByRole('button', { name: 'Stops near me' })).toBeNull();
		expect(view.container.querySelector('.map-stage-error')).not.toBeNull();
		const focusable = view.container.querySelectorAll(
			'.map-surface button:not([hidden]), .map-surface a[href], .map-surface input:not([disabled]), .map-surface [tabindex]:not([tabindex="-1"])',
		);
		expect(focusable).toHaveLength(1);
		expect(focusable[0]).toBe(screen.getByRole('button', { name: 'Retry map' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Retry map' }));

		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
		expect(screen.getByRole('button', { name: 'Stops near me' })).toBeTruthy();
		expect(screen.getByTestId('map-stage-stub')).toHaveAttribute('data-retry-count', '1');
	});

	it('renders the same stage failure contract in French', async () => {
		harness.locale = 'fr';
		render(MapHero);

		await fireEvent.click(screen.getByTestId('map-stage-stub-error'));

		expect(await screen.findByRole('alert')).toHaveTextContent('Carte indisponible');
		expect(screen.getByRole('button', { name: 'Réessayer la carte' })).toBeTruthy();
		expect(screen.getByTestId('map-stage-stub').getAttribute('data-locale')).toBe(
			JSON.stringify({
				'Map.Title': 'Carte interactive',
				'AttributionControl.ToggleAttribution': 'Afficher ou masquer les attributions',
			}),
		);
	});
});

describe('MapHero near-me device location', () => {
	it('pins a successful device fix without writing its coordinates or label to the URL', async () => {
		const position: GeolocationPosition = {
			coords: {
				latitude: 45.525686,
				longitude: -73.594764,
				accuracy: 12,
				altitude: null,
				altitudeAccuracy: null,
				heading: null,
				speed: null,
				toJSON: () => ({}),
			},
			timestamp: Date.parse('2026-06-20T12:00:30Z'),
			toJSON: () => ({}),
		};
		const getCurrentPosition = vi.fn((success: PositionCallback) => success(position));
		Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
		Object.defineProperty(navigator, 'geolocation', {
			configurable: true,
			value: { getCurrentPosition },
		});

		render(MapHero);
		await fireEvent.click(screen.getByRole('button', { name: 'Stops near me' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));

		await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
		for (const [target] of harness.goto.mock.calls) {
			const search = new URL(String(target), 'http://localhost/map').searchParams;
			expect(search.has('near')).toBe(false);
			expect(search.has('nearLabel')).toBe(false);
			expect(search.has('nearPrecision')).toBe(false);
		}
		await waitFor(() =>
			expect(harness.setNearTarget).toHaveBeenLastCalledWith(expect.anything(), {
				lat: 45.525686,
				lon: -73.594764,
				label: 'Use my location',
				precision: 'place',
			}),
		);
	});

	it('keeps the device fix alive when a later navigation drops the near params (S5-377 B1)', async () => {
		const position: GeolocationPosition = {
			coords: {
				latitude: 45.525686,
				longitude: -73.594764,
				accuracy: 12,
				altitude: null,
				altitudeAccuracy: null,
				heading: null,
				speed: null,
				toJSON: () => ({}),
			},
			timestamp: Date.parse('2026-06-20T12:00:30Z'),
			toJSON: () => ({}),
		};
		Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
		Object.defineProperty(navigator, 'geolocation', {
			configurable: true,
			value: { getCurrentPosition: vi.fn((success: PositionCallback) => success(position)) },
		});

		render(MapHero);
		await fireEvent.click(screen.getByRole('button', { name: 'Stops near me' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Clear location' })).toBeTruthy(),
		);

		// A filter toggle rewrites the query string; the device origin is not
		// URL-backed, so the URL sync-from must not destroy it.
		harness.setPageUrl('http://localhost/map?routes=55');
		// tick() flushes the URL-sync effect AND its DOM fallout before the
		// assertion — a waitFor here would pass on its first pre-flush check and
		// green-light a build that destroys the fix a microtask later.
		await tick();
		expect(screen.getByRole('button', { name: 'Clear location' })).toBeTruthy();

		harness.setPageUrl('http://localhost/map');
	});

	it('promotes a nearby-stop pick through the same filter and selection path as a map pick', async () => {
		const position: GeolocationPosition = {
			coords: {
				latitude: 45.525686,
				longitude: -73.594764,
				accuracy: 12,
				altitude: null,
				altitudeAccuracy: null,
				heading: null,
				speed: null,
				toJSON: () => ({}),
			},
			timestamp: Date.parse('2026-06-20T12:00:30Z'),
			toJSON: () => ({}),
		};
		Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
		Object.defineProperty(navigator, 'geolocation', {
			configurable: true,
			value: { getCurrentPosition: vi.fn((success: PositionCallback) => success(position)) },
		});

		render(MapHero);
		await fireEvent.click(screen.getByRole('button', { name: 'Stops near me' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
		await fireEvent.click(
			await screen.findByRole('button', { name: /Sherbrooke \/ Saint-Denis/u }),
		);

		await waitFor(() => {
			const target = String(harness.goto.mock.calls.at(-1)?.[0]);
			expect(new URL(target, 'http://localhost/map').searchParams.get('stop')).toBe('stop-1');
		});
	});

	it('retires a URL-adopted origin when the URL drops the near params (S5-377 B1 inverse)', async () => {
		// A shared deep-link seeds the origin FROM the URL. That origin is owned
		// by the URL (urlBacked) even though adopting it must not echo a write
		// back — so when navigation drops the near params, the pin retires.
		harness.setPageUrl('http://localhost/map?near=45.525686,-73.594764&nearLabel=Place+des+Arts');
		render(MapHero);
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Clear location' })).toBeTruthy(),
		);

		harness.setPageUrl('http://localhost/map');
		await tick();
		expect(screen.queryByRole('button', { name: 'Clear location' })).toBeNull();
	});
});

describe('MapHero one-shot focus readiness', () => {
	it('waits for the stop index before one camera call and one replacement strip', async () => {
		const deferred = harness.deferStopsIndex();
		harness.setPageUrl('http://localhost/map?focus=stop:stop-1');
		render(MapHero);
		await tick();

		expect(harness.focusCoordinate).not.toHaveBeenCalled();
		expect(harness.goto).not.toHaveBeenCalled();

		deferred.resolve(deferred.value);
		await waitFor(() => expect(harness.focusCoordinate).toHaveBeenCalledOnce());
		expect(harness.goto).toHaveBeenCalledOnce();
		expect(new URL(String(harness.goto.mock.lastCall?.[0]), 'http://localhost').search).toBe('');
		expect(harness.goto.mock.lastCall?.[1]).toMatchObject({ replaceState: true });

		await tick();
		expect(harness.focusCoordinate).toHaveBeenCalledOnce();
		expect(harness.goto).toHaveBeenCalledOnce();
	});
});

describe('MapHero detail-panel camera isolation (protect #11)', () => {
	// The ONE orchestrator-excepted behavioral test (fable-plan-m3-FROZEN.md,
	// ORCHESTRATOR EXCEPTION): panel drag, keyboard resize, and collapse must
	// produce ZERO camera calls — on the live map handle (stub counters) AND
	// through the mapCamera module (mocked call counts).
	it('drag, keyboard resize, and collapse never touch the camera', async () => {
		harness.isDesktop = true;
		const { container } = render(MapHero);
		await tick();
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
		await tick();

		const stub = () => screen.getByTestId('map-stage-stub');
		const cameraCounts = () =>
			['fit-bounds', 'ease-to', 'fly-to', 'set-max-bounds'].map(
				(k) => stub().getAttribute(`data-${k}-count`) ?? '0',
			);
		const mapCameraMocks = await import('./mapCamera');
		const focusCalls = () => vi.mocked(mapCameraMocks.focusCoordinate).mock.calls.length;
		const fitCalls = () => vi.mocked(mapCameraMocks.fitRouteBounds).mock.calls.length;

		const baselineStub = cameraCounts();
		const baselineFocus = focusCalls();
		const baselineFit = fitCalls();

		const separator = container.querySelector('[role="separator"]') as HTMLElement;
		expect(separator).not.toBeNull();
		await fireEvent.pointerDown(separator, { clientX: 900 });
		await fireEvent.pointerMove(separator, { clientX: 780 });
		await fireEvent.pointerUp(separator, { clientX: 780 });
		await fireEvent.keyDown(separator, { key: 'ArrowLeft' });
		await fireEvent.keyDown(separator, { key: 'ArrowRight' });
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
		await tick();

		expect(cameraCounts()).toEqual(baselineStub);
		expect(focusCalls()).toBe(baselineFocus);
		expect(fitCalls()).toBe(baselineFit);
	});
});

describe('MapHero route-exit detail teardown (M6H)', () => {
	function startLastGotoNavigation(from = 'http://localhost/map') {
		const [target, options] = harness.goto.mock.lastCall ?? [];
		if (target == null) throw new Error('expected a queued map goto');
		const url = new URL(String(target), from);
		return {
			...harness.startNavigation(url.href, from, { type: 'goto' }),
			state: options?.state as Readonly<Record<string, unknown>> | undefined,
			url,
		};
	}

	async function settleLastGotoNavigation(from = 'http://localhost/map') {
		const started = startLastGotoNavigation(from);
		expect(started.beforeNavigateDelivered).toBe(true);
		await tick();
		harness.setPageUrl(started.url.href, started.state);
		await tick();
		harness.runAfterNavigate(started.url.href, from);
		await tick();
		return started.url;
	}

	async function commitSuppressedLastGotoNavigation(from: string) {
		const started = startLastGotoNavigation(from);
		expect(started.beforeNavigateDelivered).toBe(false);
		await tick();
		expect(harness.activeNavigationTarget?.href).toBe(started.url.href);
		harness.setPageUrl(started.url.href, started.state);
		await tick();
		harness.runAfterNavigate(started.url.href, from);
		await tick();
		return started.url;
	}

	it('marks the router idle before after-navigation callbacks run', () => {
		const activeStates: boolean[] = [];
		harness.afterNavigateCallbacks.push(() => activeStates.push(harness.navigationActive));
		const started = harness.startNavigation('http://localhost/map?status=late');
		expect(started.beforeNavigateDelivered).toBe(true);

		harness.runAfterNavigate('http://localhost/map?status=late');

		expect(activeStates).toEqual([false]);
	});

	async function openStackedDetail(
		isDesktop: boolean,
		options: { settleSelectionUrl?: boolean } = {},
	) {
		harness.isDesktop = isDesktop;
		render(MapHero);
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick'));
		await screen.findByRole('heading', { level: 2, name: 'Sherbrooke / Saint-Denis' });
		await settleLastGotoNavigation();
		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Select alert Board at the temporary stop & follow signs.',
			}),
		);
		await screen.findByRole('heading', { level: 2, name: 'Temporary stop / Clark' });

		const selectionStart = startLastGotoNavigation();
		const settledSelectionUrl = selectionStart.url;
		expect(selectionStart.beforeNavigateDelivered).toBe(true);
		await tick();
		if (options.settleSelectionUrl !== false) {
			harness.setPageUrl(settledSelectionUrl.href, selectionStart.state);
			await tick();
			harness.runAfterNavigate(settledSelectionUrl.href, 'http://localhost/map');
			await tick();
		}

		const surfaceSelector = isDesktop
			? '[data-slot="map-detail-overlay"]'
			: '[data-slot="bottom-sheet"]';
		const closeLabel = isDesktop ? 'Close panel' : 'Close details';
		const surface = document.querySelector<HTMLElement>(surfaceSelector);
		const close = screen.getByRole('button', { name: closeLabel });
		const back = screen.getByRole('button', { name: 'Back' });
		const stopFeed = harness.setStops.mock.lastCall;
		const state = {
			bulk: bulkCounts(),
			bodyOverflow: document.body.style.overflow,
			gotoCalls: harness.goto.mock.calls.length,
			releaseCalls: harness.releaseLease.mock.calls.length,
			selectedStop: stopFeed?.[4],
			selectionOwnedStops: [...(stopFeed?.[2].stops ?? [])],
		};
		close.focus();
		expect(document.activeElement).toBe(close);

		return {
			back,
			close,
			closeLabel,
			settledSelectionUrl,
			state,
			surface,
			surfaceSelector,
		};
	}

	async function expectStackedDetailPreserved(
		before: Awaited<ReturnType<typeof openStackedDetail>>,
		options: { gotoCalls?: number } = {},
	) {
		expect(document.querySelector(before.surfaceSelector)).toBe(before.surface);
		expect(screen.getByRole('heading', { level: 2, name: 'Temporary stop / Clark' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Back' })).toBe(before.back);
		expect(screen.getByRole('button', { name: before.closeLabel })).toBe(before.close);
		expect(document.activeElement).toBe(before.close);
		expect(document.body.style.overflow).toBe(before.state.bodyOverflow);
		expect(bulkCounts()).toEqual(before.state.bulk);
		expect(harness.goto).toHaveBeenCalledTimes(options.gotoCalls ?? before.state.gotoCalls);
		expect(harness.releaseLease).toHaveBeenCalledTimes(before.state.releaseCalls);
		expect(harness.setStops.mock.lastCall?.[4]).toBe(before.state.selectedStop);
		expect([...(harness.setStops.mock.lastCall?.[2].stops ?? [])]).toEqual(
			before.state.selectionOwnedStops,
		);
	}

	it.each([
		['desktop', true],
		['mobile', false],
	] as const)(
		'preserves panel, selection, stack, filters, and focus when a non-map navigation is cancelled on %s',
		async (_viewport, isDesktop) => {
			const before = await openStackedDetail(isDesktop);

			const attempt = harness.startNavigation(
				'http://localhost/lines',
				before.settledSelectionUrl.href,
				{ accepted: false, type: 'link' },
			);
			expect(attempt.beforeNavigateDelivered).toBe(true);
			await tick();

			await expectStackedDetailPreserved(before);
			await fireEvent.click(before.back);
			await screen.findByRole('heading', { level: 2, name: 'Sherbrooke / Saint-Denis' });
		},
	);

	it('does not treat a same-URL invalidation after cancellation as a redirect settlement', async () => {
		const before = await openStackedDetail(true);

		harness.startNavigation('http://localhost/lines', before.settledSelectionUrl.href, {
			accepted: false,
			type: 'link',
		});
		harness.setPageUrl(before.settledSelectionUrl.href);
		await tick();

		await expectStackedDetailPreserved(before);
	});

	it('clears a cancelled exit marker before a later intentional plain-map adoption', async () => {
		const before = await openStackedDetail(true);

		harness.startNavigation('http://localhost/lines', before.settledSelectionUrl.href, {
			accepted: false,
			type: 'link',
		});
		await tick();

		// A later navigation gets a fresh beforeNavigate callback because the exit was
		// cancelled. That fresh attempt must retire the reversible recovery marker so
		// an intentional plain /map adoption keeps its normal URL-driven semantics.
		harness.startNavigation('http://localhost/map', before.settledSelectionUrl.href, {
			type: 'goto',
		});
		harness.setPageUrl('http://localhost/map');
		await tick();

		expect(document.querySelector(before.surfaceSelector)).toBe(before.surface);
		expect(harness.goto).toHaveBeenCalledTimes(before.state.gotoCalls);
		expect([...(harness.setStops.mock.lastCall?.[2].stops ?? [])]).toEqual([]);
		await fireEvent.click(before.close);
		await tick();
		expect(harness.goto).toHaveBeenCalledTimes(before.state.gotoCalls);
	});

	it('preserves a newer coordinator echo while a non-map attempt is in flight', async () => {
		const before = await openStackedDetail(true);
		const attemptedExit = {
			from: { url: before.settledSelectionUrl },
			to: { url: new URL('http://localhost/lines') },
		};
		const exitStart = harness.startNavigation(
			attemptedExit.to.url.href,
			attemptedExit.from.url.href,
			{ type: 'link' },
		);
		expect(exitStart.beforeNavigateDelivered).toBe(true);
		await tick();

		expect(harness.detailFilter).not.toBeNull();
		harness.detailFilter?.({ kind: 'route', value: '55' });
		await tick();
		const echoUrl = new URL(String(harness.goto.mock.lastCall?.[0]), 'http://localhost/map');
		expect(echoUrl.searchParams.get('route')?.split(',')).toContain('55');
		const echoNavigationState = harness.goto.mock.lastCall?.[1]?.state as
			| Readonly<Record<string, unknown>>
			| undefined;
		const echoState = {
			gotoCalls: harness.goto.mock.calls.length,
			releaseCalls: harness.releaseLease.mock.calls.length,
			selectedStop: harness.setStops.mock.lastCall?.[4],
			selectionOwnedStops: [...(harness.setStops.mock.lastCall?.[2].stops ?? [])],
		};

		// The newer coordinator-owned map intent wins without another before callback.
		const echoStart = harness.startNavigation(echoUrl.href, attemptedExit.from.url.href, {
			type: 'goto',
		});
		expect(echoStart.beforeNavigateDelivered).toBe(false);
		harness.setPageUrl(echoUrl.href, echoNavigationState);
		await tick();

		expect(document.querySelector(before.surfaceSelector)).toBe(before.surface);
		expect(document.activeElement).toBe(before.close);
		expect(harness.goto).toHaveBeenCalledTimes(echoState.gotoCalls);
		expect(harness.goto.mock.lastCall?.[0]).toBe(`${echoUrl.pathname}${echoUrl.search}`);
		expect(harness.releaseLease).toHaveBeenCalledTimes(echoState.releaseCalls);
		expect(harness.setStops.mock.lastCall?.[4]).toBe(echoState.selectedStop);
		expect([...(harness.setStops.mock.lastCall?.[2].stops ?? [])]).toEqual(
			echoState.selectionOwnedStops,
		);
	});

	it.each([
		['desktop', true],
		['mobile', false],
	] as const)(
		'preserves panel, selection, stack, filters, and focus when a non-map navigation is superseded or redirected back to plain /map on %s',
		async (_viewport, isDesktop) => {
			const before = await openStackedDetail(isDesktop);
			const attemptedExit = {
				from: { url: before.settledSelectionUrl },
				to: { url: new URL('http://localhost/lines') },
			};

			const exitStart = harness.startNavigation(
				attemptedExit.to.url.href,
				attemptedExit.from.url.href,
				{ type: 'link' },
			);
			expect(exitStart.beforeNavigateDelivered).toBe(true);
			await tick();
			// Kit suppresses another before-navigation callback for an in-flight
			// supersession or redirect. The winning commit carries a plain /map URL.
			const winnerStart = harness.startNavigation(
				'http://localhost/map',
				attemptedExit.from.url.href,
				{ type: 'goto' },
			);
			expect(winnerStart.beforeNavigateDelivered).toBe(false);
			harness.setPageUrl('http://localhost/map');
			await tick();

			const recoverySupersededOriginal =
				harness.goto.mock.calls.length === before.state.gotoCalls + 1;
			if (recoverySupersededOriginal) {
				// A recovery rewrite starts during the plain-map commit. Kit observes the
				// new token before its focus-reset branch, aborts the original settlement,
				// and commits this keepFocus URL instead.
				await commitSuppressedLastGotoNavigation('http://localhost/map');
			} else {
				// Without the recovery rewrite, Kit reaches its default focus reset. The
				// mobile sheet trap retains focus; desktop exposes the shipped body falloff.
				if (isDesktop) {
					document.body.tabIndex = -1;
					document.body.focus();
					document.body.removeAttribute('tabindex');
					expect(document.activeElement).toBe(document.body);
				}
				harness.runAfterNavigate('http://localhost/map', before.settledSelectionUrl.href);
			}
			harness.resetNavigation();
			await tick();

			await expectStackedDetailPreserved(before, {
				gotoCalls: before.state.gotoCalls + 1,
			});
			expect(harness.goto.mock.lastCall?.[0]).toBe(
				`${before.settledSelectionUrl.pathname}${before.settledSelectionUrl.search}`,
			);
			expect(harness.goto.mock.lastCall?.[1]).toMatchObject({
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
		},
	);

	it('preserves the exact focused Close node for a callback-suppressed back navigation behind a queued rewrite', async () => {
		const before = await openStackedDetail(true, { settleSelectionUrl: false });
		const currentMapUrl = 'http://localhost/map';
		const queuedSelectionUrl = new URL(before.settledSelectionUrl.href);
		const redirectedMapUrl = new URL(queuedSelectionUrl.href);
		redirectedMapUrl.searchParams.set('history-redirected', '1');

		const historyExit = harness.startNavigation('http://localhost/lines', currentMapUrl, {
			type: 'popstate',
			delta: -1,
		});
		expect(historyExit.beforeNavigateDelivered).toBe(false);
		await tick();
		const winnerStart = harness.startNavigation(redirectedMapUrl.href, currentMapUrl, {
			type: 'goto',
		});
		expect(winnerStart.beforeNavigateDelivered).toBe(false);
		harness.setPageUrl(redirectedMapUrl.href);
		await tick();

		const recoverySupersededOriginal =
			harness.goto.mock.calls.length === before.state.gotoCalls + 1;
		if (recoverySupersededOriginal) {
			await commitSuppressedLastGotoNavigation(redirectedMapUrl.href);
		} else {
			document.body.tabIndex = -1;
			document.body.focus();
			document.body.removeAttribute('tabindex');
			expect(document.activeElement).toBe(document.body);
			harness.runAfterNavigate(redirectedMapUrl.href, currentMapUrl);
		}
		harness.resetNavigation();
		await tick();

		await expectStackedDetailPreserved(before, {
			gotoCalls: before.state.gotoCalls + 1,
		});
		expect(harness.goto.mock.lastCall?.[0]).toBe(
			`${queuedSelectionUrl.pathname}${queuedSelectionUrl.search}`,
		);
		expect(harness.goto.mock.lastCall?.[1]).toMatchObject({
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	});

	it.each([
		['desktop', true],
		['mobile', false],
	] as const)(
		'preserves the exact focused Close node when a redirect settles the byte-identical selection URL on %s',
		async (_viewport, isDesktop) => {
			const before = await openStackedDetail(isDesktop);
			const attemptedExit = {
				from: { url: before.settledSelectionUrl },
				to: { url: new URL('http://localhost/lines') },
			};
			const exactSelectionUrl = new URL(before.settledSelectionUrl.href);
			expect(exactSelectionUrl.search).not.toBe('');

			const exitStart = harness.startNavigation(
				attemptedExit.to.url.href,
				attemptedExit.from.url.href,
				{ type: 'link' },
			);
			expect(exitStart.beforeNavigateDelivered).toBe(true);
			await tick();
			// Kit preserves the original false keepfocus through redirect recursion and
			// suppresses a second before-navigation callback for this winning settlement.
			const winnerStart = harness.startNavigation(
				exactSelectionUrl.href,
				attemptedExit.from.url.href,
				{ type: 'goto' },
			);
			expect(winnerStart.beforeNavigateDelivered).toBe(false);
			harness.setPageUrl(exactSelectionUrl.href);
			await tick();

			const recoverySupersededOriginal =
				harness.goto.mock.calls.length === before.state.gotoCalls + 1;
			if (recoverySupersededOriginal) {
				// The corrective keepFocus rewrite uses the same URL bytes but a newer Kit
				// token, aborting the original settlement before its default focus reset.
				await commitSuppressedLastGotoNavigation(exactSelectionUrl.href);
			} else {
				document.body.tabIndex = -1;
				document.body.focus();
				document.body.removeAttribute('tabindex');
				if (isDesktop) expect(document.activeElement).toBe(document.body);
				harness.runAfterNavigate(exactSelectionUrl.href, before.settledSelectionUrl.href);
			}
			harness.resetNavigation();
			await tick();

			await expectStackedDetailPreserved(before, {
				gotoCalls: before.state.gotoCalls + 1,
			});
			expect(harness.goto.mock.lastCall?.[0]).toBe(
				`${exactSelectionUrl.pathname}${exactSelectionUrl.search}`,
			);
			expect(harness.goto.mock.lastCall?.[1]).toMatchObject({
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
		},
	);

	it.each([
		['desktop', true],
		['mobile', false],
	] as const)(
		'preserves the exact focused Close node when a queued pre-exit selection rewrite is echoed by a redirect on %s',
		async (_viewport, isDesktop) => {
			const before = await openStackedDetail(isDesktop, { settleSelectionUrl: false });
			const attemptedExit = {
				from: { url: new URL('http://localhost/map') },
				to: { url: new URL('http://localhost/lines') },
			};
			const exactQueuedSelectionUrl = new URL(before.settledSelectionUrl.href);

			const exitStart = harness.startNavigation(
				attemptedExit.to.url.href,
				attemptedExit.from.url.href,
				{ type: 'link' },
			);
			expect(exitStart.beforeNavigateDelivered).toBe(false);
			await tick();
			// The winning non-map navigation redirects to the still-queued selection URL.
			// URL ownership is therefore an old `echo`, but the winner itself has keepFocus false.
			const winnerStart = harness.startNavigation(
				exactQueuedSelectionUrl.href,
				attemptedExit.from.url.href,
				{ type: 'goto' },
			);
			expect(winnerStart.beforeNavigateDelivered).toBe(false);
			harness.setPageUrl(exactQueuedSelectionUrl.href);
			await tick();

			const recoverySupersededOriginal =
				harness.goto.mock.calls.length === before.state.gotoCalls + 1;
			if (recoverySupersededOriginal) {
				await commitSuppressedLastGotoNavigation(exactQueuedSelectionUrl.href);
			} else {
				document.body.tabIndex = -1;
				document.body.focus();
				document.body.removeAttribute('tabindex');
				if (isDesktop) expect(document.activeElement).toBe(document.body);
				harness.runAfterNavigate(exactQueuedSelectionUrl.href, attemptedExit.from.url.href);
			}
			harness.resetNavigation();
			await tick();

			await expectStackedDetailPreserved(before, {
				gotoCalls: before.state.gotoCalls + 1,
			});
			expect(harness.goto.mock.lastCall?.[0]).toBe(
				`${exactQueuedSelectionUrl.pathname}${exactQueuedSelectionUrl.search}`,
			);
			expect(harness.goto.mock.lastCall?.[1]).toMatchObject({
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
		},
	);

	it.each([
		['desktop', true],
		['mobile', false],
	] as const)(
		'preserves the exact focused Close node for a callback-suppressed arbitrary map adoption on %s',
		async (_viewport, isDesktop) => {
			const before = await openStackedDetail(isDesktop, { settleSelectionUrl: false });
			const attemptedExit = {
				from: { url: new URL('http://localhost/map') },
				to: { url: new URL('http://localhost/lines') },
			};
			const redirectedMapUrl = new URL(before.settledSelectionUrl.href);
			redirectedMapUrl.searchParams.set('redirected', '1');

			const exitStart = harness.startNavigation(
				attemptedExit.to.url.href,
				attemptedExit.from.url.href,
				{ type: 'link' },
			);
			expect(exitStart.beforeNavigateDelivered).toBe(false);
			await tick();
			const winnerStart = harness.startNavigation(
				redirectedMapUrl.href,
				attemptedExit.from.url.href,
				{ type: 'goto' },
			);
			expect(winnerStart.beforeNavigateDelivered).toBe(false);
			harness.setPageUrl(redirectedMapUrl.href);
			await tick();

			const recoverySupersededOriginal =
				harness.goto.mock.calls.length === before.state.gotoCalls + 1;
			if (recoverySupersededOriginal) {
				await commitSuppressedLastGotoNavigation(redirectedMapUrl.href);
			} else {
				document.body.tabIndex = -1;
				document.body.focus();
				document.body.removeAttribute('tabindex');
				if (isDesktop) expect(document.activeElement).toBe(document.body);
				harness.runAfterNavigate(redirectedMapUrl.href, attemptedExit.from.url.href);
			}
			harness.resetNavigation();
			await tick();

			await expectStackedDetailPreserved(before, {
				gotoCalls: before.state.gotoCalls + 1,
			});
			expect(harness.goto.mock.lastCall?.[0]).toBe(
				`${before.settledSelectionUrl.pathname}${before.settledSelectionUrl.search}`,
			);
			expect(harness.goto.mock.lastCall?.[1]).toMatchObject({
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
		},
	);

	it('retains callback-independent focus intent through a non-winning map invalidation', async () => {
		const before = await openStackedDetail(true, { settleSelectionUrl: false });
		const currentMapUrl = 'http://localhost/map';
		const queuedSelectionUrl = new URL(before.settledSelectionUrl.href);
		const redirectedMapUrl = new URL(queuedSelectionUrl.href);
		redirectedMapUrl.searchParams.set('redirected', 'winner');

		const exitStart = harness.startNavigation('http://localhost/lines', currentMapUrl, {
			type: 'link',
		});
		expect(exitStart.beforeNavigateDelivered).toBe(false);
		await tick();

		// A page-store invalidation can settle map bytes while the accepted live target
		// is still off-map. It is not the winner and must not consume the obligation.
		harness.setPageUrl(queuedSelectionUrl.href);
		await tick();
		expect(harness.goto).toHaveBeenCalledTimes(before.state.gotoCalls);

		const winnerStart = harness.startNavigation(redirectedMapUrl.href, currentMapUrl, {
			type: 'goto',
		});
		expect(winnerStart.beforeNavigateDelivered).toBe(false);
		harness.setPageUrl(redirectedMapUrl.href);
		await tick();

		expect(harness.goto).toHaveBeenCalledTimes(before.state.gotoCalls + 1);
		expect(harness.goto.mock.lastCall?.[0]).toBe(
			`${queuedSelectionUrl.pathname}${queuedSelectionUrl.search}`,
		);
		expect(document.activeElement).toBe(before.close);
	});

	it.each([
		['desktop', true, '[data-slot="map-detail-overlay"]'],
		['mobile', false, '[data-slot="bottom-sheet"]'],
	] as const)(
		'commits the real /lines surface with zero uncaught errors after a panel-open %s map exit',
		async (_viewport, isDesktop, panelSelector) => {
			harness.isDesktop = isDesktop;
			const defaultSetStopException = harness.setStopException.getMockImplementation();
			harness.setStopException.mockImplementation(
				setRealStopException as unknown as NonNullable<typeof defaultSetStopException>,
			);
			const pageErrors: unknown[] = [];
			const recordError = (event: ErrorEvent) => pageErrors.push(event.error ?? event.message);
			const recordRejection = (event: PromiseRejectionEvent) => pageErrors.push(event.reason);
			window.addEventListener('error', recordError);
			window.addEventListener('unhandledrejection', recordRejection);

			try {
				const view = render(MapHeroNavigationHarness, { props: { route: 'map' } });
				await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
				await waitFor(() => expect(document.querySelector(panelSelector)).toBeInTheDocument());
				await settleLastGotoNavigation();

				const exitStart = harness.startNavigation(
					'http://localhost/lines',
					'http://localhost/map',
					{
						type: 'link',
					},
				);
				expect(exitStart.beforeNavigateDelivered).toBe(true);
				await tick();
				try {
					await view.rerender({ route: 'lines' });
					await tick();
				} catch (error) {
					// Happy DOM has no Playwright `pageerror`; a rejected route commit is the
					// equivalent uncaught browser error and belongs in the same receipt.
					pageErrors.push(error);
				}

				expect.soft(pageErrors).toEqual([]);
				const destinationHeading = screen.queryByRole('heading', { level: 1, name: 'Lines' });
				const destinationShell = document.querySelector('[data-slot="listing-page-shell"]');
				expect.soft(destinationHeading).toBeInTheDocument();
				expect.soft(destinationShell).toBeInTheDocument();
				expect.soft(document.querySelector('.map-hero')).not.toBeInTheDocument();
				if (!isDesktop) {
					const destinationDisclosure = document.querySelector(
						'[data-slot="listing-filter-body"].collapsible-content[data-state="closed"]',
					);
					expect.soft(destinationDisclosure).toHaveAttribute('inert');
					expect.soft(destinationDisclosure).toHaveAttribute('aria-hidden', 'true');
					expect.soft([...document.querySelectorAll('[inert]')]).toEqual([destinationDisclosure]);
					expect.soft(destinationHeading?.closest('[inert], [aria-hidden="true"]')).toBeNull();
					expect.soft(destinationShell?.closest('[inert], [aria-hidden="true"]')).toBeNull();
				}
			} finally {
				window.removeEventListener('error', recordError);
				window.removeEventListener('unhandledrejection', recordRejection);
				if (defaultSetStopException) {
					harness.setStopException.mockImplementation(defaultSetStopException);
				}
			}
		},
	);

	it('continues releasing later map owners when an earlier cleanup throws', async () => {
		harness.isDesktop = true;
		const view = render(MapHeroNavigationHarness, { props: { route: 'map' } });
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
		await waitFor(() =>
			expect(document.querySelector('[data-slot="map-detail-overlay"]')).toBeInTheDocument(),
		);
		await settleLastGotoNavigation();
		const exitStart = harness.startNavigation('http://localhost/lines', 'http://localhost/map', {
			type: 'link',
		});
		expect(exitStart.beforeNavigateDelivered).toBe(true);
		await tick();

		const teardownError = new Error('motion cleanup failed');
		const exceptionCallsBeforeTeardown = harness.setStopException.mock.calls.length;
		harness.motionDestroy.mockImplementationOnce(() => {
			throw teardownError;
		});
		let receivedError: unknown;
		try {
			await view.rerender({ route: 'lines' });
			await tick();
		} catch (error) {
			receivedError = error;
		}

		expect(receivedError).toBe(teardownError);
		expect(harness.setStopException.mock.calls.length).toBe(exceptionCallsBeforeTeardown + 1);
	});

	it('releases listeners and URL intent across a whole-component map to lines to map to lines loop', async () => {
		harness.isDesktop = true;
		const mountedListenerCounts = {
			load: 1,
			styledata: 1,
			sourcedata: 1,
			movestart: 1,
			boxzoomend: 1,
			click: 1,
			mousemove: 1,
			'canvas:mouseleave': 1,
		};
		const releasedListenerCounts = Object.fromEntries(
			Object.keys(mountedListenerCounts).map((type) => [type, 0]),
		);
		const mountedSourceCounts = {
			'route-lines': 1,
			stops: 1,
			'stop-exception': 1,
			vehicles: 1,
			'near-target': 1,
		};
		const pageErrors: unknown[] = [];
		const recordError = (event: ErrorEvent) => pageErrors.push(event.error ?? event.message);
		const recordRejection = (event: PromiseRejectionEvent) => pageErrors.push(event.reason);
		window.addEventListener('error', recordError);
		window.addEventListener('unhandledrejection', recordRejection);

		try {
			const view = render(MapHeroNavigationHarness, { props: { route: 'map' } });
			await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
			await screen.findByRole('button', { name: 'Close panel' });
			expect(harness.urlCoordinators).toHaveLength(1);
			expect(harness.urlCoordinators[0]?.pendingRequestCount()).toBe(1);
			const firstRewriteStart = startLastGotoNavigation();
			expect(firstRewriteStart.beforeNavigateDelivered).toBe(true);
			await tick();
			const firstMountListeners = mapHeroReceiptSignals.mapStageListenerCounts;
			expect(firstMountListeners).toEqual(mountedListenerCounts);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual(mountedSourceCounts);
			const firstSelectionTarget = harness.goto.mock.lastCall?.[0];
			const firstMountGotoCalls = harness.goto.mock.calls.length;
			const firstNavigationRegistrations = {
				after: harness.afterNavigateCallbacks.length,
				before: harness.beforeNavigateCallbacks.length,
			};

			const firstExitStart = harness.startNavigation(
				'http://localhost/lines',
				'http://localhost/map',
				{ type: 'link' },
			);
			expect(firstExitStart.beforeNavigateDelivered).toBe(false);
			await view.rerender({ route: 'lines' });
			await tick();
			harness.runAfterNavigate('http://localhost/lines');
			expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListenerCounts);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
			expect(harness.beforeNavigateCallbacks).toHaveLength(0);
			expect(harness.afterNavigateCallbacks).toHaveLength(0);
			expect(harness.liveStore.stop).toHaveBeenCalledTimes(1);
			expect(harness.releaseLease).toHaveBeenCalledTimes(1);
			expect(harness.urlCoordinators[0]?.pendingRequestCount()).toBe(0);
			expect(document.querySelector('.map-hero')).not.toBeInTheDocument();
			expect(screen.getByRole('heading', { level: 1, name: 'Lines' })).toBeInTheDocument();

			harness.setPageUrl('http://localhost/map');
			await view.rerender({ route: 'map' });
			await tick();
			expect(harness.urlCoordinators).toHaveLength(2);
			expect(
				harness.urlCoordinators.map((coordinator) => coordinator.pendingRequestCount()),
			).toEqual([0, 0]);
			expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(firstMountListeners);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual(mountedSourceCounts);
			expect({
				after: harness.afterNavigateCallbacks.length,
				before: harness.beforeNavigateCallbacks.length,
			}).toEqual(firstNavigationRegistrations);
			await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
			await screen.findByRole('button', { name: 'Close panel' });
			expect(
				harness.urlCoordinators.map((coordinator) => coordinator.pendingRequestCount()),
			).toEqual([0, 1]);
			const secondRewriteStart = startLastGotoNavigation();
			expect(secondRewriteStart.beforeNavigateDelivered).toBe(true);
			await tick();
			expect(harness.goto).toHaveBeenCalledTimes(firstMountGotoCalls + 1);
			expect(harness.goto.mock.lastCall?.[0]).toBe(firstSelectionTarget);
			expect(
				new URL(String(harness.goto.mock.lastCall?.[0]), 'http://localhost/map').searchParams.get(
					'vehicle',
				),
			).toBe('bus-1');
			expect(harness.goto.mock.lastCall?.[1]).toMatchObject({
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
			const secondMountGotoCalls = harness.goto.mock.calls.length;

			const secondExitStart = harness.startNavigation(
				'http://localhost/lines',
				'http://localhost/map',
				{ type: 'link' },
			);
			expect(secondExitStart.beforeNavigateDelivered).toBe(false);
			await view.rerender({ route: 'lines' });
			await tick();
			harness.runAfterNavigate('http://localhost/lines');
			expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListenerCounts);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
			expect(harness.beforeNavigateCallbacks).toHaveLength(0);
			expect(harness.afterNavigateCallbacks).toHaveLength(0);
			expect(harness.liveStore.start).toHaveBeenCalledTimes(2);
			expect(harness.liveStore.stop).toHaveBeenCalledTimes(2);
			expect(harness.releaseLease).toHaveBeenCalledTimes(2);
			expect(
				harness.urlCoordinators.map((coordinator) => coordinator.pendingRequestCount()),
			).toEqual([0, 0]);
			expect(harness.goto).toHaveBeenCalledTimes(secondMountGotoCalls);
			expect(document.querySelector('.map-hero')).not.toBeInTheDocument();
			expect(screen.getByRole('heading', { level: 1, name: 'Lines' })).toBeInTheDocument();
			expect(pageErrors).toEqual([]);
		} finally {
			window.removeEventListener('error', recordError);
			window.removeEventListener('unhandledrejection', recordRejection);
		}
	});

	it('keeps the desktop panel until commit, then clears its published rail offset', async () => {
		harness.isDesktop = true;
		const view = render(MapHeroNavigationHarness, { props: { route: 'map' } });
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));

		await waitFor(() => {
			expect(document.querySelector('[data-slot="map-detail-overlay"]')).toBeInTheDocument();
			expect(
				document.documentElement.style.getPropertyValue('--app-effective-rail-offset'),
			).not.toBe('0px');
		});
		const publishedOffset = document.documentElement.style.getPropertyValue(
			'--app-effective-rail-offset',
		);
		const gotoCalls = harness.goto.mock.calls.length;

		// Same-route filter rewrites are part of opening/using the map, not an exit.
		const rewriteStart = harness.startNavigation(
			'http://localhost/map?route=24&vehicle=bus-1',
			'http://localhost/map',
			{ type: 'goto' },
		);
		expect(rewriteStart.beforeNavigateDelivered).toBe(true);
		await tick();
		expect(document.querySelector('[data-slot="map-detail-overlay"]')).toBeInTheDocument();
		expect(document.documentElement.style.getPropertyValue('--app-effective-rail-offset')).toBe(
			publishedOffset,
		);

		const exitStart = harness.startNavigation('http://localhost/lines', 'http://localhost/map', {
			type: 'link',
		});
		expect(exitStart.beforeNavigateDelivered).toBe(false);
		await tick();

		expect(document.querySelector('[data-slot="map-detail-overlay"]')).toBeInTheDocument();
		expect(document.documentElement.style.getPropertyValue('--app-effective-rail-offset')).toBe(
			publishedOffset,
		);

		await view.rerender({ route: 'lines' });
		await tick();

		expect.soft(document.querySelector('[data-slot="map-detail-overlay"]')).toBeNull();
		expect
			.soft(document.documentElement.style.getPropertyValue('--app-effective-rail-offset'))
			.toBe('0px');
		expect.soft(screen.getByRole('heading', { level: 1, name: 'Lines' })).toBeInTheDocument();
		expect(harness.goto).toHaveBeenCalledTimes(gotoCalls);
	});

	it('keeps the mobile sheet lock until commit, then leaves no map-owned inert residue', async () => {
		const view = render(MapHeroNavigationHarness, { props: { route: 'map' } });
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
		await waitFor(() =>
			expect(document.querySelector('[data-slot="bottom-sheet"]')).toBeInTheDocument(),
		);
		const sheet = document.querySelector('[data-slot="bottom-sheet"]');

		const rewriteStart = startLastGotoNavigation();
		expect(rewriteStart.beforeNavigateDelivered).toBe(true);
		await tick();
		const exitStart = harness.startNavigation('http://localhost/lines', 'http://localhost/map', {
			type: 'link',
		});
		expect(exitStart.beforeNavigateDelivered).toBe(false);
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 80));

		expect(document.querySelector('[data-slot="bottom-sheet"]')).toBe(sheet);
		expect(document.body.style.overflow).toBe('hidden');
		expect(harness.goto).toHaveBeenCalledOnce();

		await view.rerender({ route: 'lines' });
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 80));

		expect.soft(document.querySelector('[data-slot="bottom-sheet"]')).toBeNull();
		expect.soft(document.body.style.overflow).not.toBe('hidden');
		const destinationDisclosure = document.querySelector(
			'[data-slot="listing-filter-body"].collapsible-content[data-state="closed"]',
		);
		expect.soft(destinationDisclosure).toHaveAttribute('inert');
		expect.soft(destinationDisclosure).toHaveAttribute('aria-hidden', 'true');
		expect([...document.querySelectorAll('[inert]')]).toEqual([destinationDisclosure]);
	});
});

describe('MapHero map-layer feed lifecycle', () => {
	it('keeps a cold raw map from prefetching shapes for a non-empty routed fleet', async () => {
		render(MapHero);
		await tick();

		expect(harness.getRoute).not.toHaveBeenCalled();
	});

	it('prefetches immediately when raw toggles to smooth without a vehicle poll', async () => {
		render(MapHero);
		await tick();
		expect(harness.getRoute).not.toHaveBeenCalled();

		mapHeroReceiptSignals.setMotionMode('smooth');
		await tick();

		expect(harness.getRoute).toHaveBeenCalledExactlyOnceWith('24');
	});

	it('prefetches a newly polled route while smooth mode is active', async () => {
		mapHeroReceiptSignals.setMotionMode('smooth');
		render(MapHero);
		await waitFor(() => expect(harness.getRoute).toHaveBeenCalledExactlyOnceWith('24'));

		mapHeroReceiptSignals.setVehiclesGeneration('2026-06-20T12:00:30Z');

		await waitFor(() => expect(harness.getRoute).toHaveBeenCalledWith('55'));
		expect(harness.getRoute).toHaveBeenCalledTimes(2);
	});

	it('keeps selected-route linework fetching independently in raw mode', async () => {
		render(MapHero);
		await tick();
		expect(harness.getRoute).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));

		await waitFor(() =>
			expect(harness.getRoute).toHaveBeenCalledWith(
				'24',
				expect.objectContaining({ signal: expect.anything() }),
			),
		);
		expect(harness.getRoute.mock.calls.some((call) => call.length === 1)).toBe(false);
	});

	it('creates one motion controller across ready and two style loads', async () => {
		render(MapHero);
		await tick();
		expect(harness.createVehicleMotionController).toHaveBeenCalledTimes(1);

		await fireEvent.click(screen.getByTestId('map-stage-stub-style-load'));
		await tick();
		await fireEvent.click(screen.getByTestId('map-stage-stub-style-load'));
		await tick();

		expect(harness.createVehicleMotionController).toHaveBeenCalledTimes(1);
	});

	it('reinstalls and re-feeds after style load, then re-feeds after a filter mutation', async () => {
		const prepareSpies = [harness.bakeVehicleSprites, harness.bakeLocationPinSprite];
		const layerInstallSpies = [
			harness.addRouteLineSource,
			harness.addRouteLineLayers,
			harness.addStopsSource,
			harness.addStopExceptionSource,
			harness.addStopsLayer,
			harness.addStopExceptionLayer,
			harness.addVehicleSource,
			harness.addVehicleLayers,
			harness.addNearTargetSource,
			harness.addNearTargetLayer,
		];
		const installSpies = [
			harness.bakeVehicleSprites,
			harness.bakeLocationPinSprite,
			...layerInstallSpies,
		];
		const feedSpies = [
			harness.setRouteLines,
			harness.motionSet,
			harness.setStops,
			harness.setNearTarget,
			harness.setStale,
		];

		render(MapHero);
		await tick();
		for (const install of installSpies) expect(install).toHaveBeenCalledTimes(1);
		for (const feed of feedSpies) expect(feed).toHaveBeenCalledTimes(1);
		const lastPrepare = Math.max(
			...prepareSpies.map((spy) => spy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY),
		);
		const layerInstallOrder = layerInstallSpies.map(
			(spy) => spy.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
		);
		expect(lastPrepare).toBeLessThan(layerInstallOrder[0]);
		for (let i = 1; i < layerInstallOrder.length; i += 1) {
			expect(layerInstallOrder[i]).toBeGreaterThan(layerInstallOrder[i - 1]);
		}
		const motionReadyOrder =
			harness.createVehicleMotionController.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY;
		expect(layerInstallOrder.at(-1)).toBeLessThan(motionReadyOrder);
		for (const feed of feedSpies) {
			expect(feed.mock.invocationCallOrder[0]).toBeGreaterThan(motionReadyOrder);
		}
		expect(harness.addRouteLineLayers).toHaveBeenNthCalledWith(1, expect.anything(), undefined);

		await fireEvent.click(screen.getByTestId('map-stage-stub-style-load'));
		await tick();
		for (const install of installSpies) expect(install).toHaveBeenCalledTimes(2);
		for (const feed of feedSpies) expect(feed).toHaveBeenCalledTimes(2);

		await fireEvent.click(screen.getByRole('button', { name: 'Late' }));
		await tick();
		for (const install of installSpies) expect(install).toHaveBeenCalledTimes(2);
		for (const feed of feedSpies) expect(feed).toHaveBeenCalledTimes(3);
		expect(harness.setStops.mock.lastCall?.[2]).toMatchObject({ status: ['late'] });
	});

	it('keeps a settled hover storm off every bulk feed and live-family lease', async () => {
		mapHeroReceiptSignals.setMotionMode('smooth');
		render(MapHero);
		await tick();
		await settleAnimationFrames();
		const controlUploadStart = harness.vehicleSourceSetData.mock.calls.length;
		await settleAnimationFrames(4);
		const controlUploadDelta = harness.vehicleSourceSetData.mock.calls.length - controlUploadStart;
		harness.getRoute.mockClear();
		harness.getStop.mockClear();
		const before = {
			...bulkCounts(),
			getRoute: harness.getRoute.mock.calls.length,
			getStop: harness.getStop.mock.calls.length,
			leases: harness.liveStore.subscribeFamilies.mock.calls.length,
		};
		const exceptionBefore = harness.stopExceptionSourceSetData.mock.calls.length;

		for (let i = 0; i < 4; i += 1) {
			await fireEvent.click(screen.getByTestId('map-stage-stub-hover-vehicle'));
			await fireEvent.click(screen.getByTestId('map-stage-stub-hover-stop'));
		}
		await fireEvent.click(screen.getByTestId('map-stage-stub-mouseleave'));
		const stormUploadStart = harness.vehicleSourceSetData.mock.calls.length;
		await settleAnimationFrames(4);
		const stormUploadDelta = harness.vehicleSourceSetData.mock.calls.length - stormUploadStart;

		expect({
			...bulkCounts(),
			getRoute: harness.getRoute.mock.calls.length,
			getStop: harness.getStop.mock.calls.length,
			leases: harness.liveStore.subscribeFamilies.mock.calls.length,
		}).toEqual(before);
		expect(stormUploadDelta).toBe(controlUploadDelta);
		const exceptionCalls = harness.stopExceptionSourceSetData.mock.calls.slice(exceptionBefore);
		expect(exceptionCalls.length).toBeGreaterThan(0);
		for (const [collection] of exceptionCalls) {
			expect((collection as { features: unknown[] }).features.length).toBeLessThanOrEqual(2);
		}
	});

	it('commits and closes a selection-owned vehicle with one bulk mutation each', async () => {
		// Hold the newly selected route resource pending so this spy window measures
		// only the selection/filter mutation, not a later independent network settle.
		harness.getRoute.mockImplementation(() => new Promise<null>(() => {}) as never);
		render(MapHero);
		await tick();
		const beforeCommit = bulkCounts();

		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
		await waitFor(() =>
			expect(bulkCounts()).toEqual({
				routes: beforeCommit.routes + 1,
				motion: beforeCommit.motion + 1,
				stops: beforeCommit.stops + 1,
				nearTarget: beforeCommit.nearTarget + 1,
			}),
		);
		expect(
			(
				harness.motionSet.mock.lastCall?.[0] as {
					features: Array<{ properties: { selected: number } }>;
				}
			).features[0]?.properties.selected,
		).toBe(1);

		const beforeClose = bulkCounts();
		await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
		await waitFor(() =>
			expect(bulkCounts()).toEqual({
				routes: beforeClose.routes + 1,
				motion: beforeClose.motion + 1,
				stops: beforeClose.stops + 1,
				nearTarget: beforeClose.nearTarget + 1,
			}),
		);

		const vehicleFeed = harness.toVehicleFeatures.mock.lastCall;
		expect(vehicleFeed?.[1].vehicles.has('bus-1')).toBe(false);
		expect(vehicleFeed?.[3]).toBeNull();
		expect(
			(
				harness.motionSet.mock.lastCall?.[0] as {
					features: Array<{ properties: { selected: number } }>;
				}
			).features[0]?.properties.selected,
		).toBe(0);
	});

	it('releases an already selection-owned route through applyDetailFilter with zero rebuilds or goto', async () => {
		harness.getRoute.mockImplementation(() => new Promise<null>(() => {}) as never);
		render(MapHero);
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
		await screen.findByRole('button', { name: 'Close details' });
		await waitFor(() => expect(harness.goto).toHaveBeenCalledOnce());
		const detailFilter = await waitFor(() => {
			expect(harness.detailFilter).not.toBeNull();
			return harness.detailFilter!;
		});
		const beforeTouch = bulkCounts();
		const navigationCount = harness.goto.mock.calls.length;

		detailFilter({ kind: 'route', value: '24' });
		await tick();

		expect(bulkCounts()).toEqual(beforeTouch);
		expect(harness.goto).toHaveBeenCalledTimes(navigationCount);

		await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
		await waitFor(() => expect(harness.goto).toHaveBeenCalledTimes(navigationCount + 1));
		const closed = new URL(String(harness.goto.mock.lastCall?.[0]), 'http://localhost');
		expect(closed.searchParams.get('route')).toBe('24');
		expect(closed.searchParams.has('vehicle')).toBe(false);
	});

	it('commits and closes a selection-owned stop with one bulk mutation each', async () => {
		render(MapHero);
		await tick();
		const beforeCommit = bulkCounts();

		await fireEvent.click(screen.getByTestId('map-stage-stub-pick'));
		await waitFor(() =>
			expect(bulkCounts()).toEqual({
				routes: beforeCommit.routes + 1,
				motion: beforeCommit.motion + 1,
				stops: beforeCommit.stops + 1,
				nearTarget: beforeCommit.nearTarget + 1,
			}),
		);

		const beforeClose = bulkCounts();
		await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
		await waitFor(() =>
			expect(bulkCounts()).toEqual({
				routes: beforeClose.routes + 1,
				motion: beforeClose.motion + 1,
				stops: beforeClose.stops + 1,
				nearTarget: beforeClose.nearTarget + 1,
			}),
		);

		const stopFeed = harness.setStops.mock.lastCall;
		expect(stopFeed?.[2].stops.has('stop-1')).toBe(false);
		expect(stopFeed?.[4]).toBeNull();
		expect(
			toStopFeatures(stopFeed?.[1] ?? [], stopFeed?.[2], stopFeed?.[3], stopFeed?.[4]).features[0]
				?.properties.selected,
		).toBe(0);
	});

	it('keeps a pre-existing URL route while an echoed picked vehicle retires on close', async () => {
		harness.setPageUrl('http://localhost/map?route=24');
		render(MapHero);
		await tick();

		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
		await waitFor(() => expect(harness.goto).toHaveBeenCalledOnce());
		const pickedTarget = String(harness.goto.mock.lastCall?.[0]);
		expect(new URL(pickedTarget, 'http://localhost').searchParams.get('vehicle')).toBe('bus-1');

		const beforeEchoFeed = bulkCounts();
		harness.setPageUrl(new URL(pickedTarget, 'http://localhost').href);
		await tick();
		expect(bulkCounts()).toEqual(beforeEchoFeed);
		expect(harness.goto).toHaveBeenCalledOnce();

		await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
		await waitFor(() => expect(harness.goto).toHaveBeenCalledTimes(2));
		const closed = new URL(String(harness.goto.mock.lastCall?.[0]), 'http://localhost');
		expect(closed.searchParams.get('route')).toBe('24');
		expect(closed.searchParams.has('vehicle')).toBe(false);
	});

	it('keeps equal filters after a genuine URL adoption reclassifies them as user-owned', async () => {
		render(MapHero);
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick'));
		await waitFor(() => expect(harness.goto).toHaveBeenCalledOnce());
		const pickedTarget = String(harness.goto.mock.lastCall?.[0]);

		harness.setPageUrl(new URL(pickedTarget, 'http://localhost').href);
		await tick();
		harness.setPageUrl(`${new URL(pickedTarget, 'http://localhost').href}&x=1`);
		await tick();
		const navigationCount = harness.goto.mock.calls.length;

		await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
		await tick();
		expect(harness.goto).toHaveBeenCalledTimes(navigationCount);
		expect(harness.setStops.mock.lastCall?.[2].stops.has('stop-1')).toBe(true);
	});

	it('auto-close of a vanished vehicle clears its selection-owned URL filters', async () => {
		render(MapHero);
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
		await screen.findByRole('button', { name: 'Close details' });

		harness.setLiveVehicleVisible(false);
		for (let revision = 2; revision <= 4; revision += 1) {
			const generation = `2026-06-20T12:00:0${revision}Z`;
			mapHeroReceiptSignals.setVehiclesGeneration(generation);
			await waitFor(() =>
				expect(document.querySelector('.map-hero')).toHaveAttribute(
					'data-motion-tick-key',
					generation,
				),
			);
			await tick();
		}

		await waitFor(() => expect(screen.queryByRole('button', { name: 'Close details' })).toBeNull());
		const closed = new URL(String(harness.goto.mock.lastCall?.[0]), 'http://localhost');
		expect(closed.searchParams.has('route')).toBe(false);
		expect(closed.searchParams.has('vehicle')).toBe(false);
	});

	it('drives hover, mouseleave, detail swap, Back, and close through rendered feature state', async () => {
		render(MapHero);
		await tick();
		mapHeroReceiptSignals.clearFeatureStateEvents();

		await fireEvent.click(screen.getByTestId('map-stage-stub-hover-vehicle'));
		await waitFor(() =>
			expect(mapHeroReceiptSignals.featureStateEvents).toContainEqual({
				operation: 'set',
				target: { source: 'vehicles', id: 'bus-1' },
				state: { hovered: true },
			}),
		);

		mapHeroReceiptSignals.clearFeatureStateEvents();
		await fireEvent.click(screen.getByTestId('map-stage-stub-mouseleave'));
		await waitFor(() =>
			expect(mapHeroReceiptSignals.featureStateEvents).toContainEqual({
				operation: 'remove',
				target: { source: 'vehicles', id: 'bus-1' },
				property: 'hovered',
			}),
		);

		mapHeroReceiptSignals.clearFeatureStateEvents();
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick'));
		await waitFor(() =>
			expect(mapHeroReceiptSignals.featureStateEvents).toContainEqual({
				operation: 'set',
				target: { source: 'stops', id: 'stop-1' },
				state: { selected: true },
			}),
		);

		mapHeroReceiptSignals.clearFeatureStateEvents();
		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Select alert Board at the temporary stop & follow signs.',
			}),
		);
		await waitFor(() => {
			expect(mapHeroReceiptSignals.featureStateEvents).toEqual(
				expect.arrayContaining([
					{
						operation: 'remove',
						target: { source: 'stops', id: 'stop-1' },
						property: 'selected',
					},
					{
						operation: 'set',
						target: { source: 'stops', id: 'stop-2' },
						state: { selected: true },
					},
				]),
			);
		});

		mapHeroReceiptSignals.clearFeatureStateEvents();
		await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		await waitFor(() => {
			expect(mapHeroReceiptSignals.featureStateEvents).toEqual(
				expect.arrayContaining([
					{
						operation: 'remove',
						target: { source: 'stops', id: 'stop-2' },
						property: 'selected',
					},
					{
						operation: 'set',
						target: { source: 'stops', id: 'stop-1' },
						state: { selected: true },
					},
				]),
			);
		});

		mapHeroReceiptSignals.clearFeatureStateEvents();
		await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
		await waitFor(() =>
			expect(mapHeroReceiptSignals.featureStateEvents).toContainEqual({
				operation: 'remove',
				target: { source: 'stops', id: 'stop-1' },
				property: 'selected',
			}),
		);
	});

	it('keeps vehicle leases and route reads unchanged during hover without fetching a stop', async () => {
		const bulkCounts = () => ({
			routes: harness.setRouteLines.mock.calls.length,
			motion: harness.motionSet.mock.calls.length,
			stops: harness.setStops.mock.calls.length,
		});

		render(MapHero);
		await tick();
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
		await waitFor(() => {
			expect(harness.liveStore.subscribeFamilies).toHaveBeenCalledWith(['trips']);
			expect(harness.getRoute).toHaveBeenCalledWith('24', expect.any(Object));
		});
		expect(harness.getStop).not.toHaveBeenCalled();
		await tick();

		const bulkBefore = bulkCounts();
		const routeCallsBefore = harness.getRoute.mock.calls.length;
		const stopCallsBefore = harness.getStop.mock.calls.length;
		const leasesBefore = [...harness.liveStore.subscribeFamilies.mock.calls];

		await fireEvent.click(screen.getByTestId('map-stage-stub-hover-stop'));
		await fireEvent.click(screen.getByTestId('map-stage-stub-hover-vehicle'));
		await fireEvent.click(screen.getByTestId('map-stage-stub-mouseleave'));
		await tick();

		expect(bulkCounts()).toEqual(bulkBefore);
		expect(harness.getRoute).toHaveBeenCalledTimes(routeCallsBefore);
		expect(harness.getStop).toHaveBeenCalledTimes(stopCallsBefore);
		expect(harness.liveStore.subscribeFamilies.mock.calls).toEqual(leasesBefore);
	});

	it('fetches the selected stop resource exactly once for a stop pick', async () => {
		render(MapHero);
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick'));

		await waitFor(() => expect(harness.getStop).toHaveBeenCalledWith('stop-1', expect.any(Object)));
		expect(harness.getStop).toHaveBeenCalledOnce();
	});

	it.each([
		{
			entity: 'vehicle',
			hoverTrigger: 'map-stage-stub-hover-vehicle',
			pickTrigger: 'map-stage-stub-pick-vehicle',
			family: 'trips',
		},
		{
			entity: 'stop',
			hoverTrigger: 'map-stage-stub-hover-stop',
			pickTrigger: 'map-stage-stub-pick',
			family: 'departures',
		},
	])(
		'keeps the $entity peek byte-equal before, during, and after its committed lease',
		async ({ hoverTrigger, pickTrigger, family }) => {
			harness.isDesktop = true;
			const { container } = render(MapHero);
			await tick();

			await fireEvent.click(screen.getByTestId(hoverTrigger));
			await tick();
			const before = peekText(container);
			expect(before).not.toBe('');
			expect(harness.liveStore.subscribeFamilies).not.toHaveBeenCalled();

			await fireEvent.click(screen.getByTestId(pickTrigger));
			await waitFor(() =>
				expect(harness.liveStore.subscribeFamilies).toHaveBeenCalledExactlyOnceWith([family]),
			);
			const during = peekText(container);

			await fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
			await waitFor(() => expect(harness.releaseLease).toHaveBeenCalledTimes(1));
			const after = peekText(container);

			expect({ before, during, after }).toEqual({
				before,
				during: before,
				after: before,
			});
			expect(harness.liveStore.subscribeFamilies).toHaveBeenCalledTimes(1);
			expect(harness.releaseLease).toHaveBeenCalledTimes(1);
		},
	);

	it('replays current emphasis once after a same-map style reinstall', async () => {
		const order: string[] = [];
		harness.setRouteLines.mockImplementation(() => order.push('routes'));
		harness.setStops.mockImplementation(() => order.push('stops'));
		harness.motionSet.mockImplementation(() => order.push('motion'));
		harness.setNearTarget.mockImplementation(() => order.push('near-target'));
		harness.setStopException.mockImplementation(() => order.push('exception'));
		mapHeroReceiptSignals.observeFeatureState((event) => {
			if (event.operation === 'set') order.push('feature-state');
		});

		render(MapHero);
		await tick();
		const stage = screen.getByTestId('map-stage-stub');

		await fireEvent.click(screen.getByTestId('map-stage-stub-hover-vehicle'));
		await tick();
		const beforeStyle = Number(stage.getAttribute('data-feature-state-set-count'));
		expect(beforeStyle).toBeGreaterThan(0);
		order.length = 0;

		await fireEvent.click(screen.getByTestId('map-stage-stub-style-load'));
		await tick();

		expect(Number(stage.getAttribute('data-feature-state-set-count'))).toBe(beforeStyle + 1);
		expect(order.filter((event) => event === 'feature-state')).toHaveLength(1);
		expect(order.filter((event) => event === 'exception')).toHaveLength(1);
		const stateOrder = order.indexOf('feature-state');
		for (const feed of ['routes', 'stops', 'motion', 'near-target']) {
			expect(order.indexOf(feed), `${feed} must precede replay`).toBeLessThan(stateOrder);
		}
	});

	it('re-feeds on a live generation but not across five seconds of shared-clock ticks', async () => {
		const bulkCounts = () => ({
			routes: harness.setRouteLines.mock.calls.length,
			motion: harness.motionSet.mock.calls.length,
			stops: harness.setStops.mock.calls.length,
		});

		mapHeroReceiptSignals.setMotionMode('smooth');
		render(MapHero);
		await tick();
		const beforeClock = bulkCounts();

		for (let second = 0; second < 5; second += 1) {
			mapHeroReceiptSignals.advanceClock(1_000);
			await tick();
		}
		expect(bulkCounts()).toEqual(beforeClock);

		mapHeroReceiptSignals.setVehiclesGeneration('2026-06-20T12:00:30Z');
		await tick();
		expect(bulkCounts()).toEqual({
			routes: beforeClock.routes + 1,
			motion: beforeClock.motion + 1,
			stops: beforeClock.stops + 1,
		});
	});

	it('reacts to reduced motion by snapping and cancelling the pending animated upload', async () => {
		const frames = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn((callback: FrameRequestCallback) => {
				const handle = ++nextFrame;
				frames.set(handle, callback);
				return handle;
			}),
		);
		vi.stubGlobal(
			'cancelAnimationFrame',
			vi.fn((handle: number) => {
				frames.delete(handle);
			}),
		);
		mapHeroReceiptSignals.setMotionMode('smooth');

		render(MapHero);
		await tick();
		expect(harness.motionSet.mock.lastCall?.[1]).toMatchObject({ animate: true });
		const pendingHandle = [...frames.keys()][0];
		expect(pendingHandle).toBeTypeOf('number');
		const pending = frames.get(pendingHandle);
		expect(pending).toBeTypeOf('function');

		harness.setReducedMotion(true);
		await tick();
		expect(harness.motionSet.mock.lastCall?.[1]).toMatchObject({ animate: false });
		const uploadsAfterSnap = harness.vehicleSourceSetData.mock.calls.length;
		pending?.(0);

		expect(harness.vehicleSourceSetData).toHaveBeenCalledTimes(uploadsAfterSnap);
	});
});

describe('MapHero mobile alert drilldown orchestrator', () => {
	it('promotes a picked vehicle and its route through the real MapHero path (#37)', async () => {
		render(MapHero);

		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));

		await waitFor(() => {
			const target = String(harness.goto.mock.calls.at(-1)?.[0]);
			const search = new URL(target, 'http://localhost/map').searchParams;
			expect(search.get('route')).toBe('24');
			expect(search.get('vehicle')).toBe('bus-1');
		});
		expect(
			(await screen.findAllByRole('heading', { level: 2 })).some(
				(heading) => heading.textContent === 'Bus bus-1',
			),
		).toBe(true);
	});

	it('swaps custom detail in place, preserves alert identity, and restores Back without redirecting', async () => {
		const documentPathBefore = window.location.pathname;
		render(MapHero);
		// WHY(M1 #45): MapHero now keeps only vehicles + alerts as constructor
		// baselines; stop departures are a committed-selection lease.
		expect(harness.createLiveStore.mock.calls[0]?.[1]).toEqual({
			families: ['vehicles', 'alerts'],
		});

		const stage = await screen.findByTestId('map-stage-stub');
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick'));

		const firstBody = await waitFor(() => {
			const body = document.querySelector<HTMLElement>('[data-slot="bottom-sheet-body"]');
			expect(body).toBeInTheDocument();
			expect(within(body!).queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
			expect(
				screen.getByRole('heading', { level: 2, name: 'Sherbrooke / Saint-Denis' }),
			).toBeInTheDocument();
			return body!;
		});
		expect(harness.liveStore.subscribeFamilies).toHaveBeenCalledWith(['departures']);
		const sheet = document.querySelector('[data-slot="bottom-sheet"]');
		expect(document.querySelectorAll('[data-slot="bottom-sheet"]')).toHaveLength(1);
		expect(document.querySelector('.map-peek')).not.toBeInTheDocument();
		expect(stage).toHaveAttribute('data-pick-count', '1');

		const navigationCountBeforeAlert = harness.goto.mock.calls.length;
		harness.identityReceivers.length = 0;
		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Select alert Board at the temporary stop & follow signs.',
			}),
		);

		await waitFor(() => {
			const body = document.querySelector<HTMLElement>('[data-slot="bottom-sheet-body"]');
			expect(body).toBe(firstBody);
			expect(within(body!).queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
			expect(
				screen.getByRole('heading', { level: 2, name: 'Temporary stop / Clark' }),
			).toBeInTheDocument();
		});

		// The proxy records the receiver used by MapHero when it reads the alert's
		// routing fields. Every receiver remains the exact published Alert object;
		// no presenter or orchestrator clone was inserted along the callback path.
		expect(harness.identityReceivers.length).toBeGreaterThan(0);
		expect(harness.identityReceivers.every((receiver) => receiver === harness.alert)).toBe(true);

		const alertNavigationCalls = harness.goto.mock.calls.slice(navigationCountBeforeAlert);
		expect(alertNavigationCalls.length).toBeGreaterThan(0);
		expect(alertNavigationCalls.at(-1)?.[0]).toBe(
			'/map?route=24&stop=stop-1%2Cstop-2&alert=has_alert',
		);
		for (const [target, options] of alertNavigationCalls) {
			expect(target).toMatch(/^\/map(?:\?|$)/);
			expect(new URL(String(target), 'http://localhost/map').pathname).toBe('/map');
			expect(options).toMatchObject({ replaceState: true, keepFocus: true, noScroll: true });
		}
		expect(window.location.pathname).toBe(documentPathBefore);
		expect(document.querySelectorAll('[data-slot="bottom-sheet"]')).toHaveLength(1);
		expect(document.querySelector('[data-slot="bottom-sheet"]')).toBe(sheet);
		expect(document.querySelector('.map-peek')).not.toBeInTheDocument();
		expect(stage).toHaveAttribute('data-pick-count', '1');

		const navigationCountBeforeBack = harness.goto.mock.calls.length;
		await fireEvent.click(screen.getByRole('button', { name: 'Back' }));

		await waitFor(() => {
			const body = document.querySelector<HTMLElement>('[data-slot="bottom-sheet-body"]');
			expect(body).toBe(firstBody);
			expect(within(body!).queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
			expect(
				screen.getByRole('heading', { level: 2, name: 'Sherbrooke / Saint-Denis' }),
			).toBeInTheDocument();
		});
		expect(harness.goto).toHaveBeenCalledTimes(navigationCountBeforeBack);
		expect(window.location.pathname).toBe(documentPathBefore);
		expect(document.querySelectorAll('[data-slot="bottom-sheet"]')).toHaveLength(1);
		expect(document.querySelector('[data-slot="bottom-sheet"]')).toBe(sheet);
		expect(document.querySelector('.map-peek')).not.toBeInTheDocument();
		expect(stage).toHaveAttribute('data-pick-count', '1');
	});
});
