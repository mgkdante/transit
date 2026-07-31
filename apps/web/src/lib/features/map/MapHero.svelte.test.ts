import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MapHero from './MapHero.svelte';

const harness = vi.hoisted(() => {
	const identityReceivers: unknown[] = [];
	const bakeVehicleSprites = vi.fn();
	const bakeLocationPinSprite = vi.fn();
	const addVehicleSource = vi.fn();
	const addVehicleLayers = vi.fn();
	const addStopsSource = vi.fn();
	const addStopsLayer = vi.fn();
	const addRouteLineSource = vi.fn();
	const addRouteLineLayers = vi.fn();
	const addNearTargetSource = vi.fn();
	const addNearTargetLayer = vi.fn();
	const setRouteLines = vi.fn();
	const setStops = vi.fn();
	const setNearTarget = vi.fn();
	const setStale = vi.fn();
	const motionSet = vi.fn();
	const motionDestroy = vi.fn();
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
	const liveStore = {
		vehicles: { generated_utc: '2026-06-20T12:00:00Z', vehicles: [] },
		trips: null,
		departures: null,
		alerts: { generated_utc: '2026-06-20T12:00:00Z', alerts: [alert] },
		network: null,
		index: {
			byVehicleId: new Map(),
			byTripId: new Map(),
			byStopId: new Map(),
			vehiclesByRoute: new Map(),
			vehiclesByStop: new Map(),
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
		subscribeFamilies: vi.fn(() => vi.fn()),
	};

	return {
		alert,
		// reassigned by the $app/stores mock factory below
		setPageUrl: (_href: string): void => {
			throw new Error('setPageUrl used before the $app/stores mock factory ran');
		},
		createLiveStore: vi.fn((_manifest: unknown, _options?: unknown) => liveStore),
		liveStore,
		identityReceivers,
		goto: vi.fn(async (_target: string, _options?: Record<string, unknown>) => {}),
		afterNavigate: vi.fn(),
		bakeVehicleSprites,
		bakeLocationPinSprite,
		addVehicleSource,
		addVehicleLayers,
		addStopsSource,
		addStopsLayer,
		addRouteLineSource,
		addRouteLineLayers,
		addNearTargetSource,
		addNearTargetLayer,
		setRouteLines,
		setStops,
		setNearTarget,
		setStale,
		motionSet,
		motionDestroy,
		createVehicleMotionController,
		stops: [
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
		],
	};
});

const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

vi.mock('$app/stores', async () => {
	const { writable } = await import('svelte/store');
	const pageValue = (url: URL) => ({
		url,
		params: {},
		route: { id: '/map' },
		status: 200,
		error: null,
		data: {},
		form: null,
		state: {},
	});
	const store = writable(pageValue(new URL('http://localhost/map')));
	harness.setPageUrl = (href: string) => store.set(pageValue(new URL(href)));
	return { page: store };
});

vi.mock('$app/navigation', () => ({
	goto: harness.goto,
	afterNavigate: harness.afterNavigate,
}));

vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => 'en' as const };
});

vi.mock('$lib/nav', () => ({
	layout: {
		get isDesktop() {
			return false;
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

vi.mock('$lib/stores', () => ({
	themeStore: {
		current: 'dark',
		isDark: true,
		toggle: vi.fn(),
		apply: vi.fn(),
		init: vi.fn(),
	},
	sharedClock: {
		serverNow: Date.parse('2026-06-20T12:00:30Z'),
		now: Date.parse('2026-06-20T12:00:30Z'),
		subscribe: () => () => {},
	},
	motionMode: {
		current: 'raw',
		set: vi.fn(),
	},
	dataRefresh: {},
}));

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
	getStopsIndexSlim: () => ({ generated_utc: '2026-06-20T12:00:00Z', stops: harness.stops }),
	getRoute: () => null,
	getStop: () => null,
}));
vi.mock('$lib/v1/live/store.svelte', () => ({
	createLiveStore: harness.createLiveStore,
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (loader: () => unknown) => {
		const value = loader();
		// Resolve synchronous static indexes immediately. The route/stop context
		// loaders are async and irrelevant to a static-index stop detail, so they
		// remain at the resource contract's pre-resolution null state.
		const data =
			value != null && typeof (value as Promise<unknown>).then === 'function' ? null : value;
		return {
			data,
			error: null,
			loading: false,
			settled: true,
			reload: vi.fn(),
		};
	},
}));

vi.mock('$lib/components/map', async () => {
	const { default: MapStage } = await import('./__fixtures__/MapStageStub.svelte');
	return {
		MapStage,
		STOPS_LAYER: 'stops',
		VEHICLE_BODY_LAYER: 'vehicle-body',
		ROUTE_LINE_HIT_LAYER: 'route-lines-hit',
		bakeVehicleSprites: harness.bakeVehicleSprites,
		bakeLocationPinSprite: harness.bakeLocationPinSprite,
		addVehicleSource: harness.addVehicleSource,
		addVehicleLayers: harness.addVehicleLayers,
		setStale: harness.setStale,
		toVehicleFeatures: () => ({ type: 'FeatureCollection', features: [] }),
		createVehicleMotionController: harness.createVehicleMotionController,
		addStopsSource: harness.addStopsSource,
		addStopsLayer: harness.addStopsLayer,
		setStops: harness.setStops,
		addRouteLineSource: harness.addRouteLineSource,
		addRouteLineLayers: harness.addRouteLineLayers,
		setRouteLines: harness.setRouteLines,
		addNearTargetSource: harness.addNearTargetSource,
		addNearTargetLayer: harness.addNearTargetLayer,
		setNearTarget: harness.setNearTarget,
		nearestStops: () => [],
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
	focusCoordinate: () => true,
	fitRouteBounds: () => true,
}));

vi.mock('@yesid/motion/stores/reducedMotion', () => ({
	isPrefersReducedMotion: () => false,
}));

afterEach(() => {
	cleanup();
	document.body.innerHTML = '';
	vi.clearAllMocks();
	harness.identityReceivers.length = 0;
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

describe('MapHero map-layer feed lifecycle', () => {
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
			harness.addStopsLayer,
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
});

describe('MapHero mobile alert drilldown orchestrator', () => {
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
			expect(within(body!).getByRole('heading', { level: 2 })).toHaveTextContent(
				'Sherbrooke / Saint-Denis',
			);
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
			expect(within(body!).getByRole('heading', { level: 2 })).toHaveTextContent(
				'Temporary stop / Clark',
			);
		});

		// The proxy records the receiver used by MapHero when it reads the alert's
		// routing fields. Every receiver remains the exact published Alert object;
		// no presenter or orchestrator clone was inserted along the callback path.
		expect(harness.identityReceivers.length).toBeGreaterThan(0);
		expect(harness.identityReceivers.every((receiver) => receiver === harness.alert)).toBe(true);

		const alertNavigationCalls = harness.goto.mock.calls.slice(navigationCountBeforeAlert);
		expect(alertNavigationCalls.length).toBeGreaterThan(0);
		expect(alertNavigationCalls.at(-1)?.[0]).toBe('?route=24&stop=stop-1%2Cstop-2&alert=has_alert');
		for (const [target, options] of alertNavigationCalls) {
			expect(target).toMatch(/^\?/);
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
			expect(within(body!).getByRole('heading', { level: 2 })).toHaveTextContent(
				'Sherbrooke / Saint-Denis',
			);
		});
		expect(harness.goto).toHaveBeenCalledTimes(navigationCountBeforeBack);
		expect(window.location.pathname).toBe(documentPathBefore);
		expect(document.querySelectorAll('[data-slot="bottom-sheet"]')).toHaveLength(1);
		expect(document.querySelector('[data-slot="bottom-sheet"]')).toBe(sheet);
		expect(document.querySelector('.map-peek')).not.toBeInTheDocument();
		expect(stage).toHaveAttribute('data-pick-count', '1');
	});
});
