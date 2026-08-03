import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { settled, tick } from 'svelte';
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
	let activeLeaseCount = 0;
	const releaseLease = vi.fn(() => {
		activeLeaseCount = Math.max(0, activeLeaseCount - 1);
	});
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
		subscribeFamilies: vi.fn(() => {
			activeLeaseCount += 1;
			return releaseLease;
		}),
	};
	type HarnessNavigation = import('./__fixtures__/KitNavigationSimulator').SimulatedNavigation;
	type BeforeNavigation = import('./__fixtures__/KitNavigationSimulator').SimulatedBeforeNavigation;
	type NavigationCallback =
		import('./__fixtures__/KitNavigationSimulator').SimulatedNavigationCallback;
	let publishPage: (href: string, state: Readonly<Record<string, unknown>>) => void = () => {
		throw new Error('page publisher used before the $app/stores mock factory ran');
	};
	let publishNavigating: (navigation: HarnessNavigation | null) => void = () => {
		throw new Error('navigation publisher used before the $app/stores mock factory ran');
	};
	let settleDom = async (): Promise<void> => {
		throw new Error('DOM settlement used before the test harness was initialized');
	};
	let tickDom = async (): Promise<void> => {
		throw new Error('DOM tick used before the test harness was initialized');
	};
	let router: import('./__fixtures__/KitNavigationSimulator').KitNavigationSimulator | null = null;
	const navigationRouter = () => {
		if (!router) throw new Error('Kit navigation simulator used before installation');
		return router;
	};

	function resetKitFocus(url: URL): void {
		const autofocus = document.querySelector<HTMLElement>('[autofocus]');
		if (autofocus) {
			autofocus.focus();
			return;
		}
		const hashTarget = url.hash
			? document.getElementById(decodeURIComponent(url.hash.slice(1)))
			: null;
		if (hashTarget) return;
		const tabindex = document.body.getAttribute('tabindex');
		document.body.tabIndex = -1;
		document.body.focus({ preventScroll: true });
		if (tabindex === null) document.body.removeAttribute('tabindex');
		else document.body.setAttribute('tabindex', tabindex);
	}

	const goto = vi.fn((target: string, options: Record<string, unknown> = {}) => {
		const simulator = navigationRouter();
		const started = simulator.startNavigation(
			new URL(target, simulator.currentPageHref).href,
			simulator.currentPageHref,
			{ type: 'goto', keepFocus: options.keepFocus === true },
		);
		return started.navigation.complete;
	});

	return {
		alert,
		locale: 'en' as 'en' | 'fr',
		isDesktop: false,
		setPageUrl(href: string, state: Readonly<Record<string, unknown>> = {}): void {
			navigationRouter().setPageUrl(href, state);
		},
		installNavigationRouter(
			Simulator: typeof import('./__fixtures__/KitNavigationSimulator').KitNavigationSimulator,
		): void {
			router = new Simulator({
				publishPage: (href, state) => publishPage(href, state),
				publishNavigating: (navigation) => publishNavigating(navigation),
				settled: () => settleDom(),
				tick: () => tickDom(),
				activeElement: () => document.activeElement,
				bodyElement: () => document.body,
				resetFocus: resetKitFocus,
			});
		},
		installStorePublishers(
			nextPage: (href: string, state: Readonly<Record<string, unknown>>) => void,
			nextNavigating: (navigation: HarnessNavigation | null) => void,
		): void {
			publishPage = nextPage;
			publishNavigating = nextNavigating;
		},
		installDomFlush(nextSettled: () => Promise<void>, nextTick: () => Promise<void>): void {
			settleDom = nextSettled;
			tickDom = nextTick;
		},
		resetNavigation(): void {
			navigationRouter().reset();
		},
		beforeNavigate(callback: (navigation: BeforeNavigation) => void): () => void {
			return navigationRouter().beforeNavigate(callback);
		},
		onNavigate(callback: NavigationCallback): () => void {
			return navigationRouter().onNavigate(callback);
		},
		afterNavigate(callback: NavigationCallback): () => void {
			return navigationRouter().afterNavigate(callback);
		},
		get activeNavigation() {
			return navigationRouter().activeNavigation;
		},
		get acceptedPublications() {
			return navigationRouter().acceptedPublications;
		},
		flushEffects(): Promise<void> {
			return navigationRouter().flushEffects();
		},
		reachLoadCheckpoint(navigation: HarnessNavigation): boolean {
			return navigationRouter().reachLoadCheckpoint(navigation);
		},
		createLiveStore: vi.fn((_manifest: unknown, _options?: unknown) => liveStore),
		liveStore,
		identityReceivers,
		goto,
		startNavigation(
			...args: Parameters<
				import('./__fixtures__/KitNavigationSimulator').KitNavigationSimulator['startNavigation']
			>
		) {
			return navigationRouter().startNavigation(...args);
		},
		commitNavigation(
			...args: Parameters<
				import('./__fixtures__/KitNavigationSimulator').KitNavigationSimulator['commitNavigation']
			>
		) {
			return navigationRouter().commitNavigation(...args);
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
		stopVehicleUploads,
		hasPendingVehicleMotionFrame: () => vehicleMotionFrame != null,
		releaseLease,
		activeLeaseCount: () => activeLeaseCount,
		resetActiveLeaseCount: () => {
			activeLeaseCount = 0;
		},
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
	const { KitNavigationSimulator } = await import('./__fixtures__/KitNavigationSimulator');
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
	const page = writable(pageValue(new URL('http://localhost/map')));
	const navigating = writable<unknown>(null);
	harness.installStorePublishers(
		(href, state) => page.set(pageValue(new URL(href), state)),
		(navigation) => navigating.set(navigation),
	);
	harness.installNavigationRouter(KitNavigationSimulator);
	return { page, navigating };
});

vi.mock('$app/navigation', () => ({
	goto: harness.goto,
	beforeNavigate: harness.beforeNavigate,
	onNavigate: harness.onNavigate,
	afterNavigate: harness.afterNavigate,
}));

vi.mock('./mapUrlCoordinator', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./mapUrlCoordinator')>();
	return actual;
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

harness.installDomFlush(
	async () => settled(),
	async () => tick(),
);

afterEach(() => {
	cleanup();
	document.body.innerHTML = '';
	vi.clearAllMocks();
	harness.resetMotionSetImplementation();
	harness.resetGetRouteImplementation();
	harness.resetStopsIndex();
	harness.setLiveVehicleVisible(true);
	harness.resetActiveLeaseCount();
	harness.captureDetailFilter(null);
	harness.resetNavigation();
	harness.identityReceivers.length = 0;
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
	it('ignores a device callback delivered after the map owner is destroyed', async () => {
		let deliverPosition!: PositionCallback;
		const getCurrentPosition = vi.fn((success: PositionCallback) => {
			deliverPosition = success;
		});
		Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
		Object.defineProperty(navigator, 'geolocation', {
			configurable: true,
			value: { getCurrentPosition },
		});
		render(MapHero);
		await fireEvent.click(screen.getByRole('button', { name: 'Stops near me' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
		await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledOnce());
		const focusCalls = harness.focusCoordinate.mock.calls.length;
		const gotoCalls = harness.goto.mock.calls.length;

		cleanup();
		deliverPosition({
			coords: { latitude: 45.525686, longitude: -73.594764 },
		} as GeolocationPosition);
		await tick();

		expect(harness.focusCoordinate).toHaveBeenCalledTimes(focusCalls);
		expect(harness.goto).toHaveBeenCalledTimes(gotoCalls);
	});

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

describe('MapHero base-parity navigation and isolated teardown (M6H)', () => {
	const releasedListeners = {
		load: 0,
		styledata: 0,
		sourcedata: 0,
		movestart: 0,
		boxzoomend: 0,
		click: 0,
		mousemove: 0,
		'canvas:mouseleave': 0,
	};
	const activeListeners = Object.fromEntries(
		Object.keys(releasedListeners).map((type) => [type, 1]),
	);
	const activeSources = {
		vehicles: 1,
		stops: 1,
		'stop-exception': 1,
		'route-lines': 1,
		'near-target': 1,
	};

	function capturePageErrors() {
		const values: unknown[] = [];
		const onError = (event: ErrorEvent) => values.push(event.error ?? event.message);
		const onRejection = (event: PromiseRejectionEvent) => values.push(event.reason);
		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);
		return {
			values,
			dispose() {
				window.removeEventListener('error', onError);
				window.removeEventListener('unhandledrejection', onRejection);
			},
		};
	}

	function activeLastGoto(from = 'http://localhost/map') {
		const [target] = harness.goto.mock.lastCall ?? [];
		if (target == null) throw new Error('expected a queued map goto');
		const url = new URL(String(target), from);
		const navigation = harness.activeNavigation;
		if (!navigation) throw new Error('expected the queued goto to be active');
		expect(navigation.to?.url.href).toBe(url.href);
		return { navigation, url };
	}

	async function openDetail(isDesktop = true, options: { settleSelectionUrl?: boolean } = {}) {
		harness.isDesktop = isDesktop;
		render(MapHeroNavigationHarness);
		await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
		const closeLabel = isDesktop ? 'Close panel' : 'Close details';
		const close = await screen.findByRole('button', { name: closeLabel });
		const selectionIdentity = (await screen.findAllByRole('heading', { level: 2 })).find(
			(heading) => heading.textContent === 'Bus bus-1',
		);
		expect(selectionIdentity).toBeDefined();
		const selectionStart = activeLastGoto();
		let currentUrl = new URL('http://localhost/map');
		if (options.settleSelectionUrl !== false) {
			await harness.commitNavigation(selectionStart.url.href);
			currentUrl = selectionStart.url;
		}
		const surfaceSelector = isDesktop
			? '[data-slot="map-detail-overlay"]'
			: '[data-slot="bottom-sheet"]';
		close.focus();
		return {
			close,
			closeLabel,
			currentUrl,
			selectionUrl: selectionStart.url,
			selectionNavigation: selectionStart.navigation,
			surfaceSelector,
			surface: document.querySelector(surfaceSelector),
			selectionIdentity,
			selectionOwnedVehicles: [...(harness.setStops.mock.lastCall?.[2].vehicles ?? [])],
		};
	}

	type OpenDetail = Awaited<ReturnType<typeof openDetail>>;
	type Shape =
		| 'cancelled'
		| 'superseded'
		| 'redirected'
		| 'echo'
		| 'adopt'
		| 'coalesced'
		| 'normalized'
		| 'localized-normalized';

	async function commitMapWinner(shape: Shape, before: OpenDetail) {
		const from = before.currentUrl.href;
		const publicationStart = harness.acceptedPublications.length;
		if (shape === 'cancelled') {
			const releaseCancellation = harness.beforeNavigate((navigation) => {
				if (navigation.to?.url.pathname === '/lines') navigation.cancel();
			});
			const attempt = harness.startNavigation('http://localhost/lines', from, { type: 'link' });
			releaseCancellation();
			expect(attempt.accepted).toBe(false);
			expect(attempt.beforeNavigateDelivered).toBe(true);
			await harness.flushEffects();
			return {
				url: before.currentUrl,
				filtersPreserved: true,
				focus: 'close' as const,
				publications: harness.acceptedPublications.slice(publicationStart),
			};
		}

		if (shape === 'normalized' || shape === 'localized-normalized') {
			const accepted =
				shape === 'normalized' ? 'http://localhost/map/' : 'http://localhost/fr/map/';
			const committed = shape === 'normalized' ? 'http://localhost/map' : 'http://localhost/fr/map';
			expect(
				harness.startNavigation('http://localhost/lines', from, { type: 'link' })
					.beforeNavigateDelivered,
			).toBe(true);
			// Kit suppresses the second callback and may normalize accepted /map/ only
			// when it publishes the committed page URL. No flush is guaranteed here.
			expect(
				harness.startNavigation(accepted, from, { redirect: true }).beforeNavigateDelivered,
			).toBe(false);
			await harness.commitNavigation(committed);
			return {
				url: new URL(committed),
				filtersPreserved: false,
				focus: harness.isDesktop ? ('body' as const) : ('close' as const),
				publications: harness.acceptedPublications.slice(publicationStart),
			};
		}

		let winner = new URL(from);
		let filtersPreserved = true;
		const exit = harness.startNavigation('http://localhost/lines', from, { type: 'link' });
		expect(exit.beforeNavigateDelivered).toBe(shape !== 'echo' && shape !== 'adopt');
		if (shape !== 'echo' && shape !== 'adopt' && shape !== 'coalesced') {
			await harness.flushEffects();
		}
		if (shape === 'superseded') {
			winner = new URL('http://localhost/map');
			filtersPreserved = false;
		} else if (shape === 'echo') {
			winner = new URL(before.selectionUrl);
		} else if (shape === 'adopt') {
			winner = new URL(before.selectionUrl);
			winner.searchParams.set('external-adoption', '1');
		}
		expect(
			harness.startNavigation(winner.href, from, {
				redirect: shape !== 'superseded' && shape !== 'coalesced',
			}).beforeNavigateDelivered,
		).toBe(false);
		await harness.commitNavigation(winner.href);
		return {
			url: winner,
			filtersPreserved,
			focus: harness.isDesktop ? ('body' as const) : ('close' as const),
			publications: harness.acceptedPublications.slice(publicationStart),
		};
	}

	async function commitLines(from: URL): Promise<void> {
		expect(
			harness.startNavigation('http://localhost/lines', from.href, { type: 'link' })
				.beforeNavigateDelivered,
		).toBe(true);
		await harness.commitNavigation('http://localhost/lines');
		if (!harness.isDesktop) await new Promise((resolve) => setTimeout(resolve, 80));
	}

	it.each(
		(
			[
				'cancelled',
				'superseded',
				'redirected',
				'echo',
				'adopt',
				'coalesced',
				'normalized',
				'localized-normalized',
			] as const
		).flatMap((shape) => [
			[`desktop ${shape}`, true, shape] as const,
			[`mobile ${shape}`, false, shape] as const,
		]),
	)(
		'keeps base state/focus for %s, then renders an unlocked destination',
		async (_viewport, desktop, shape) => {
			const pageErrors = capturePageErrors();
			const beforeCallbacks: string[] = [];
			const releaseBeforeProbe = harness.beforeNavigate((navigation) => {
				beforeCallbacks.push(navigation.to?.url.href ?? 'null');
			});
			try {
				const before = await openDetail(desktop, {
					settleSelectionUrl: shape !== 'echo' && shape !== 'adopt',
				});
				expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(activeListeners);
				expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual(activeSources);
				const gotoCalls = harness.goto.mock.calls.length;
				const winner = await commitMapWinner(shape, before);
				expect(document.querySelector(before.surfaceSelector)).toBe(before.surface);
				expect(screen.getByRole('button', { name: before.closeLabel })).toBe(before.close);
				expect(document.body.contains(before.selectionIdentity!)).toBe(true);
				expect(before.selectionIdentity).toHaveTextContent('Bus bus-1');
				expect([...(harness.setStops.mock.lastCall?.[2].vehicles ?? [])]).toEqual(
					winner.filtersPreserved ? before.selectionOwnedVehicles : [],
				);
				expect(document.activeElement).toBe(
					winner.focus === 'close' ? before.close : document.body,
				);
				expect(harness.goto).toHaveBeenCalledTimes(gotoCalls);
				expect(beforeCallbacks).toHaveLength(shape === 'echo' || shape === 'adopt' ? 1 : 2);
				if (
					shape === 'echo' ||
					shape === 'adopt' ||
					shape === 'coalesced' ||
					shape === 'normalized' ||
					shape === 'localized-normalized'
				) {
					expect(winner.publications).toHaveLength(2);
					expect(winner.publications[0]?.flushRevision).toBe(winner.publications[1]?.flushRevision);
				}
				if (shape === 'normalized' || shape === 'localized-normalized') {
					expect(new URL(winner.publications[1]!.href).pathname.endsWith('/')).toBe(true);
					expect(winner.url.pathname.endsWith('/')).toBe(false);
				}

				let exitUrl = winner.url;
				if (shape === 'echo' || shape === 'adopt') {
					const gotoCallsBeforeClose = harness.goto.mock.calls.length;
					await fireEvent.click(before.close);

					const survivesClose = shape === 'adopt';
					await waitFor(() => {
						const filter = harness.setStops.mock.lastCall?.[2];
						expect(filter?.routes.has('24')).toBe(survivesClose);
						expect(filter?.vehicles.has('bus-1')).toBe(survivesClose);
					});
					expect(harness.goto).toHaveBeenCalledTimes(
						gotoCallsBeforeClose + (shape === 'echo' ? 1 : 0),
					);

					if (shape === 'echo') {
						const closeNavigation = activeLastGoto(winner.url.href);
						expect(closeNavigation.url.searchParams.has('route')).toBe(false);
						expect(closeNavigation.url.searchParams.has('vehicle')).toBe(false);
						await harness.commitNavigation(closeNavigation.url.href);
						exitUrl = closeNavigation.url;
					}
				}

				await commitLines(exitUrl);
				const main = document.querySelector<HTMLElement>('#main');
				expect(pageErrors.values).toEqual([]);
				expect(main).toHaveClass('overflow-y-auto');
				expect(screen.getByRole('heading', { level: 1, name: 'Lines' })).toBeInTheDocument();
				expect(document.querySelector('[data-slot="listing-page-shell"]')).toBeInTheDocument();
				expect(document.querySelector('.map-hero')).not.toBeInTheDocument();
				expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
				expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
				expect(harness.liveStore.stop).toHaveBeenCalledTimes(1);
				expect(harness.releaseLease).toHaveBeenCalledTimes(1);
				expect(document.activeElement).not.toBe(before.close);
			} finally {
				releaseBeforeProbe();
				pageErrors.dispose();
			}
		},
	);

	it('keeps a superseded queued selection echo selection-owned after its stale-token rejection', async () => {
		const before = await openDetail(true, { settleSelectionUrl: false });
		const gotoCallsBefore = harness.goto.mock.calls.length;
		const exit = harness.startNavigation('http://localhost/lines', before.currentUrl.href, {
			type: 'link',
		});
		expect(exit.beforeNavigateDelivered).toBe(false);

		expect(harness.reachLoadCheckpoint(before.selectionNavigation)).toBe(false);
		await expect(before.selectionNavigation.complete).rejects.toThrow('navigation aborted');
		await Promise.resolve();
		await Promise.resolve();

		harness.startNavigation(before.selectionUrl.href, before.currentUrl.href, { redirect: true });
		await harness.commitNavigation(before.selectionUrl.href);
		await fireEvent.click(screen.getByRole('button', { name: before.closeLabel }));
		await tick();

		expect(harness.goto).toHaveBeenCalledTimes(gotoCallsBefore + 1);
		const closed = new URL(String(harness.goto.mock.lastCall?.[0]), 'http://localhost');
		expect(closed.searchParams.has('vehicle')).toBe(false);
	});

	it('contains and reports a throwing live stop without skipping sibling teardown owners', async () => {
		const pageErrors = capturePageErrors();
		const stopError = new Error('live stop failed');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const releaseClock = vi.fn();
		const subscribe = vi
			.spyOn(mapHeroReceiptSignals.clock, 'subscribe')
			.mockReturnValue(releaseClock);
		harness.liveStore.stop.mockImplementationOnce(() => {
			throw stopError;
		});
		try {
			const before = await openDetail(true);
			expect(harness.activeLeaseCount()).toBe(1);
			await commitLines(before.currentUrl);

			expect(pageErrors.values).toEqual([]);
			expect(screen.getByRole('heading', { level: 1, name: 'Lines' })).toBeInTheDocument();
			expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
			expect(harness.releaseLease).toHaveBeenCalledOnce();
			expect(releaseClock).toHaveBeenCalledTimes(subscribe.mock.results.length);
			expect(consoleError).toHaveBeenCalledWith('MapHero cleanup failed', stopError);
		} finally {
			subscribe.mockRestore();
			pageErrors.dispose();
		}
	});

	it('contains a breakpoint-listener disposer fault without skipping route-unmount owners', async () => {
		const pageErrors = capturePageErrors();
		const cleanupError = new Error('matchMedia cleanup failed before mutation');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const listeners = new Set<EventListenerOrEventListenerObject>();
		let failCleanup = true;
		let targetRemoveCalls = 0;
		const breakpoint = {
			matches: true,
			media: '(min-width: 1024px)',
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(
				(_type: string, listener: EventListenerOrEventListenerObject | null) => {
					if (listener) listeners.add(listener);
				},
			),
			removeEventListener: vi.fn(
				(_type: string, listener: EventListenerOrEventListenerObject | null) => {
					const isMapHeroListener = typeof listener === 'function' && listener.name === 'onChange';
					if (isMapHeroListener) targetRemoveCalls += 1;
					if (isMapHeroListener && failCleanup) {
						failCleanup = false;
						throw cleanupError;
					}
					if (listener) listeners.delete(listener);
				},
			),
			dispatchEvent: vi.fn(() => true),
		} as unknown as MediaQueryList;
		const nativeMatchMedia = window.matchMedia.bind(window);
		const matchMedia = vi
			.spyOn(window, 'matchMedia')
			.mockImplementation((query) =>
				query === breakpoint.media ? breakpoint : nativeMatchMedia(query),
			);
		try {
			const before = await openDetail(true);
			expect(
				[...listeners].filter(
					(listener) => typeof listener === 'function' && listener.name === 'onChange',
				),
			).toHaveLength(1);

			await commitLines(before.currentUrl);

			expect(pageErrors.values).toEqual([]);
			expect(screen.getByRole('heading', { level: 1, name: 'Lines' })).toBeInTheDocument();
			expect(harness.liveStore.stop).toHaveBeenCalledOnce();
			expect(harness.releaseLease).toHaveBeenCalledOnce();
			expect(harness.activeLeaseCount()).toBe(0);
			expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
			expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(0);
			expect(listeners).toHaveLength(0);
			expect(targetRemoveCalls).toBe(2);
			expect(consoleError).toHaveBeenCalledWith('MapHero cleanup failed', cleanupError);
		} finally {
			matchMedia.mockRestore();
			pageErrors.dispose();
		}
	});

	it('contains and reports a rail-offset disposer fault during route unmount', async () => {
		const pageErrors = capturePageErrors();
		const cleanupError = new Error('rail offset cleanup failed before mutation');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const rootStyle = document.documentElement.style;
		const setProperty = rootStyle.setProperty.bind(rootStyle);
		let armed = false;
		let targetCleanupCalls = 0;
		const setPropertySpy = vi
			.spyOn(rootStyle, 'setProperty')
			.mockImplementation((property: string, value: string | null, priority?: string) => {
				if (armed && property === '--app-effective-rail-offset' && value === '0px') {
					targetCleanupCalls += 1;
					if (targetCleanupCalls === 1) throw cleanupError;
				}
				setProperty(property, value, priority);
			});
		try {
			const before = await openDetail(true);
			armed = true;

			await commitLines(before.currentUrl);

			expect(pageErrors.values).toEqual([]);
			expect(screen.getByRole('heading', { level: 1, name: 'Lines' })).toBeInTheDocument();
			expect(targetCleanupCalls).toBe(2);
			expect(consoleError).toHaveBeenCalledWith('MapHero cleanup failed', cleanupError);
			expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
			expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(0);
			expect(harness.liveStore.stop).toHaveBeenCalledOnce();
			expect(harness.releaseLease).toHaveBeenCalledOnce();
			expect(harness.activeLeaseCount()).toBe(0);
		} finally {
			setPropertySpy.mockRestore();
			pageErrors.dispose();
		}
	});

	it('contains and reports a throwing selection lease without skipping sibling teardown owners', async () => {
		const pageErrors = capturePageErrors();
		const leaseError = new Error('selection lease release failed');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const releaseClock = vi.fn();
		const subscribe = vi
			.spyOn(mapHeroReceiptSignals.clock, 'subscribe')
			.mockReturnValue(releaseClock);
		harness.releaseLease.mockImplementationOnce(() => {
			throw leaseError;
		});
		try {
			const before = await openDetail(true);
			await commitLines(before.currentUrl);

			expect(pageErrors.values).toEqual([]);
			expect(screen.getByRole('heading', { level: 1, name: 'Lines' })).toBeInTheDocument();
			expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
			expect(harness.liveStore.stop).toHaveBeenCalledOnce();
			expect(harness.releaseLease).toHaveBeenCalledTimes(2);
			expect(harness.activeLeaseCount()).toBe(0);
			expect(releaseClock).toHaveBeenCalledTimes(subscribe.mock.results.length);
			expect(consoleError).toHaveBeenCalledWith('MapHero cleanup failed', leaseError);
		} finally {
			subscribe.mockRestore();
			pageErrors.dispose();
		}
	});

	it.each([
		['motion desktop', true, null],
		['motion mobile', false, null],
		['click interaction', true, 'map:click'],
		['mousemove interaction', true, 'map:mousemove'],
		['canvas interaction', true, 'canvas:mouseleave'],
		['emphasis', true, 'emphasis:removeFeatureState'],
	] as const)(
		'isolates a %s teardown fault and still reaches physical zero',
		async (_, desktop, operation) => {
			const pageErrors = capturePageErrors();
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
			const defaultSetStopException = harness.setStopException.getMockImplementation();
			try {
				harness.setStopException.mockImplementation(
					setRealStopException as unknown as NonNullable<typeof defaultSetStopException>,
				);
				if (!operation) mapHeroReceiptSignals.setMotionMode('smooth');
				const before = await openDetail(desktop);
				if (operation === 'emphasis:removeFeatureState') {
					await fireEvent.click(screen.getByTestId('map-stage-stub-hover-stop'));
					await tick();
				}
				expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(activeListeners);
				expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual(activeSources);
				expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(
					operation === 'emphasis:removeFeatureState' ? 2 : 1,
				);
				expect(harness.activeLeaseCount()).toBe(1);
				if (!operation) expect(harness.hasPendingVehicleMotionFrame()).toBe(true);
				const error = new Error(`${operation ?? 'motion'} cleanup failed before mutation`);
				if (operation) mapHeroReceiptSignals.setCleanupFault(operation, error, 'before');
				else {
					harness.motionDestroy.mockImplementationOnce(() => {
						throw error;
					});
				}
				await commitLines(before.currentUrl);
				expect(pageErrors.values).toEqual([]);
				expect(document.querySelector<HTMLElement>('#main')).toHaveClass('overflow-y-auto');
				expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
				expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
				expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(0);
				expect(harness.liveStore.stop).toHaveBeenCalledTimes(1);
				expect(harness.releaseLease).toHaveBeenCalledTimes(1);
				expect(harness.activeLeaseCount()).toBe(0);
				if (!operation) expect(harness.hasPendingVehicleMotionFrame()).toBe(false);
				expect(consoleError).toHaveBeenCalledWith('MapStage cleanup failed', error);
				if (!desktop) expect(document.body.style.overflow).not.toBe('hidden');
			} finally {
				if (defaultSetStopException) {
					harness.setStopException.mockImplementation(defaultSetStopException);
				}
				pageErrors.dispose();
			}
		},
	);

	it('aggregates simultaneous owner faults after every release reaches physical zero', async () => {
		const pageErrors = capturePageErrors();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const errors = [
			new Error('motion cleanup failed'),
			new Error('click cleanup failed after mutation'),
			new Error('mousemove cleanup failed after mutation'),
			new Error('canvas cleanup failed after mutation'),
			new Error('emphasis cleanup failed after mutation'),
		];
		try {
			mapHeroReceiptSignals.setMotionMode('smooth');
			const before = await openDetail(true);
			await fireEvent.click(screen.getByTestId('map-stage-stub-hover-stop'));
			await tick();
			expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(activeListeners);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual(activeSources);
			expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(2);
			expect(harness.activeLeaseCount()).toBe(1);
			expect(harness.hasPendingVehicleMotionFrame()).toBe(true);
			harness.motionDestroy.mockImplementationOnce(() => {
				throw errors[0];
			});
			mapHeroReceiptSignals.setCleanupFault('map:click', errors[1], 'before');
			mapHeroReceiptSignals.setCleanupFault('map:mousemove', errors[2], 'before');
			mapHeroReceiptSignals.setCleanupFault('canvas:mouseleave', errors[3], 'before');
			mapHeroReceiptSignals.setCleanupFault('emphasis:removeFeatureState', errors[4], 'before');

			await commitLines(before.currentUrl);

			expect(pageErrors.values).toEqual([]);
			expect(document.querySelector<HTMLElement>('#main')).toHaveClass('overflow-y-auto');
			expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
			expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
			expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(0);
			expect(harness.liveStore.stop).toHaveBeenCalledTimes(1);
			expect(harness.releaseLease).toHaveBeenCalledTimes(1);
			expect(harness.activeLeaseCount()).toBe(0);
			expect(harness.hasPendingVehicleMotionFrame()).toBe(false);
			const reported = consoleError.mock.calls.find(
				([message]) => message === 'MapStage cleanup failed',
			)?.[1];
			expect(reported).toBeInstanceOf(AggregateError);
			expect((reported as AggregateError).errors).toEqual(errors);
		} finally {
			pageErrors.dispose();
		}
	});

	it('retains a twice-failed canvas receipt for the parent fallback and reaches zero', async () => {
		const error = new Error('canvas cleanup failed twice before mutation');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const before = await openDetail(true);
		mapHeroReceiptSignals.setCleanupFault('canvas:mouseleave', error, 'before', 2);

		await commitLines(before.currentUrl);

		expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
		expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
		expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(0);
		expect(harness.activeLeaseCount()).toBe(0);
		expect(consoleError).toHaveBeenCalledWith(
			'MapStage cleanup failed',
			expect.any(AggregateError),
		);
	});

	it('reaches physical zero through three map to lines round trips', async () => {
		harness.isDesktop = true;
		const pageErrors = capturePageErrors();
		try {
			render(MapHeroNavigationHarness);
			for (let round = 0; round < 3; round += 1) {
				if (round > 0) {
					harness.startNavigation('http://localhost/map', 'http://localhost/lines');
					await harness.commitNavigation('http://localhost/map');
				}
				await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
				await screen.findByRole('button', { name: 'Close panel' });
				expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(activeListeners);
				expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual(activeSources);
				expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(1);
				expect(harness.activeLeaseCount()).toBe(1);
				const selectionUrl = harness.activeNavigation?.to?.url;
				if (!selectionUrl) throw new Error('expected a selection navigation');
				await harness.commitNavigation(selectionUrl.href);
				harness.startNavigation('http://localhost/lines', selectionUrl.href);
				await harness.commitNavigation('http://localhost/lines');
				expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
				expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
				expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(0);
				expect(harness.activeLeaseCount()).toBe(0);
				expect(document.querySelector<HTMLElement>('#main')).toHaveClass('overflow-y-auto');
			}
			expect(pageErrors.values).toEqual([]);
			expect(harness.liveStore.start).toHaveBeenCalledTimes(3);
			expect(harness.liveStore.stop).toHaveBeenCalledTimes(3);
			expect(harness.releaseLease).toHaveBeenCalledTimes(3);
		} finally {
			pageErrors.dispose();
		}
	});

	it('bounds pre-mutation lease, canvas, and feature-state faults across three round trips', async () => {
		harness.isDesktop = true;
		const pageErrors = capturePageErrors();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			render(MapHeroNavigationHarness);
			for (let round = 0; round < 3; round += 1) {
				if (round > 0) {
					harness.startNavigation('http://localhost/map', 'http://localhost/lines');
					await harness.commitNavigation('http://localhost/map');
				}
				await fireEvent.click(screen.getByTestId('map-stage-stub-pick-vehicle'));
				await screen.findByRole('button', { name: 'Close panel' });
				await fireEvent.click(screen.getByTestId('map-stage-stub-hover-stop'));
				await tick();
				expect(harness.activeLeaseCount()).toBe(1);
				expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(2);
				const selectionUrl = harness.activeNavigation?.to?.url;
				if (!selectionUrl) throw new Error('expected a selection navigation');
				await harness.commitNavigation(selectionUrl.href);

				harness.releaseLease.mockImplementationOnce(() => {
					throw new Error(`round ${round} lease failed before mutation`);
				});
				mapHeroReceiptSignals.setCleanupFault(
					'canvas:mouseleave',
					new Error(`round ${round} canvas failed before mutation`),
					'before',
				);
				mapHeroReceiptSignals.setCleanupFault(
					'emphasis:removeFeatureState',
					new Error(`round ${round} emphasis failed before mutation`),
					'before',
				);
				harness.startNavigation('http://localhost/lines', selectionUrl.href);
				await harness.commitNavigation('http://localhost/lines');

				expect(mapHeroReceiptSignals.mapStageListenerCounts).toEqual(releasedListeners);
				expect(mapHeroReceiptSignals.mapStageSourceCounts).toEqual({});
				expect(mapHeroReceiptSignals.mapStageFeatureStateCount).toBe(0);
				expect(harness.activeLeaseCount()).toBe(0);
			}
			expect(pageErrors.values).toEqual([]);
			expect(harness.releaseLease).toHaveBeenCalledTimes(6);
			expect(
				consoleError.mock.calls.filter(([message]) => message === 'MapStage cleanup failed'),
			).toHaveLength(3);
		} finally {
			pageErrors.dispose();
		}
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
