import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toStopFeatures } from '$lib/components/map/stopsLayer';
import MapHero from './MapHero.svelte';
import { mapHeroReceiptSignals } from './__fixtures__/MapHeroReceiptSignals.svelte';

const harness = vi.hoisted(() => {
	const identityReceivers: unknown[] = [];
	const bakeVehicleSprites = vi.fn();
	const bakeLocationPinSprite = vi.fn();
	const addVehicleSource = vi.fn();
	const addVehicleLayers = vi.fn();
	const addStopsSource = vi.fn();
	const addStopsLayer = vi.fn();
	const addStopExceptionSource = vi.fn();
	const addStopExceptionLayer = vi.fn();
	const addRouteLineSource = vi.fn();
	const addRouteLineLayers = vi.fn();
	const addNearTargetSource = vi.fn();
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
	const getRoute = vi.fn(async (_id?: string, _options?: unknown) => null);
	const getStop = vi.fn(() => null);
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

	return {
		alert,
		isDesktop: false,
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
		vehicleSourceSetData,
		motionDestroy,
		releaseLease,
		createVehicleMotionController,
		getRoute,
		getStop,
		toVehicleFeatures,
		vehicle,
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
	getStopsIndexSlim: () => ({ generated_utc: '2026-06-20T12:00:00Z', stops: harness.stops }),
	getRoute: harness.getRoute,
	getStop: harness.getStop,
}));
vi.mock('$lib/v1/live/store.svelte', async () => {
	const { mapHeroReceiptSignals: signals } =
		await import('./__fixtures__/MapHeroReceiptSignals.svelte');
	Object.defineProperty(harness.liveStore, 'vehicles', {
		configurable: true,
		get: () => {
			const generation = signals.vehiclesGeneration;
			return {
				generated_utc: generation,
				vehicles: [
					{
						...harness.vehicle,
						route: generation === '2026-06-20T12:00:00Z' ? '24' : '55',
					},
				],
			};
		},
	});
	Object.defineProperty(harness.liveStore, 'vehiclesGeneratedUtc', {
		configurable: true,
		get: () => signals.vehiclesGeneration,
	});
	return { createLiveStore: harness.createLiveStore };
});

vi.mock('$lib/v1/resource.svelte', async () => {
	const { createMapHeroResourceStub } = await import('./__fixtures__/MapHeroResourceStub.svelte');
	return { createResource: createMapHeroResourceStub };
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
	focusCoordinate: () => true,
	fitRouteBounds: () => true,
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
	harness.identityReceivers.length = 0;
	harness.isDesktop = false;
	mapHeroReceiptSignals.reset();
	harness.setReducedMotion(false);
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

	it('commits and closes a vehicle with one bulk mutation each while filter emphasis survives', async () => {
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
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		await waitFor(() =>
			expect(bulkCounts()).toEqual({
				routes: beforeClose.routes + 1,
				motion: beforeClose.motion + 1,
				stops: beforeClose.stops + 1,
				nearTarget: beforeClose.nearTarget + 1,
			}),
		);

		const vehicleFeed = harness.toVehicleFeatures.mock.lastCall;
		expect(vehicleFeed?.[1].vehicles.has('bus-1')).toBe(true);
		expect(vehicleFeed?.[3]).toBeNull();
		expect(
			(
				harness.motionSet.mock.lastCall?.[0] as {
					features: Array<{ properties: { selected: number } }>;
				}
			).features[0]?.properties.selected,
		).toBe(1);
	});

	it('commits and closes a stop with one bulk mutation each while filter emphasis survives', async () => {
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
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		await waitFor(() =>
			expect(bulkCounts()).toEqual({
				routes: beforeClose.routes + 1,
				motion: beforeClose.motion + 1,
				stops: beforeClose.stops + 1,
				nearTarget: beforeClose.nearTarget + 1,
			}),
		);

		const stopFeed = harness.setStops.mock.lastCall;
		expect(stopFeed?.[2].stops.has('stop-1')).toBe(true);
		expect(stopFeed?.[4]).toBeNull();
		expect(
			toStopFeatures(stopFeed?.[1] ?? [], stopFeed?.[2], stopFeed?.[3], stopFeed?.[4]).features[0]
				?.properties.selected,
		).toBe(1);
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
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		await waitFor(() =>
			expect(mapHeroReceiptSignals.featureStateEvents).toContainEqual({
				operation: 'remove',
				target: { source: 'stops', id: 'stop-1' },
				property: 'selected',
			}),
		);
	});

	it('keeps committed leases and static-resource calls unchanged during later hover', async () => {
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
			expect(harness.getStop).toHaveBeenCalledWith('stop-1', expect.any(Object));
		});
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
				(heading) => heading.textContent === 'Route 24',
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
