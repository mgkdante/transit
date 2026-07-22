import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MapHero from './MapHero.svelte';

const harness = vi.hoisted(() => {
	const identityReceivers: unknown[] = [];
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
		loading: false,
		error: null,
		start: vi.fn(),
		stop: vi.fn(),
		refresh: vi.fn(),
	};

	return {
		alert,
		createLiveStore: vi.fn((_manifest: unknown, _options?: unknown) => liveStore),
		identityReceivers,
		goto: vi.fn(async (_target: string, _options?: Record<string, unknown>) => {}),
		afterNavigate: vi.fn(),
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

vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({
			url: new URL('http://localhost/map'),
			params: {},
			route: { id: '/map' },
			status: 200,
			error: null,
			data: {},
			form: null,
			state: {},
		}),
	};
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
	const { default: MapStage } = await import('./MapStageStub.svelte');
	const noop = () => {};
	return {
		MapStage,
		STOPS_LAYER: 'stops',
		VEHICLE_BODY_LAYER: 'vehicle-body',
		ROUTE_LINE_HIT_LAYER: 'route-lines-hit',
		bakeVehicleSprites: noop,
		bakeLocationPinSprite: noop,
		addVehicleSource: noop,
		addVehicleLayers: noop,
		setStale: noop,
		toVehicleFeatures: () => ({ type: 'FeatureCollection', features: [] }),
		createVehicleMotionController: () => ({ set: noop, destroy: noop }),
		addStopsSource: noop,
		addStopsLayer: noop,
		setStops: noop,
		addRouteLineSource: noop,
		addRouteLineLayers: noop,
		setRouteLines: noop,
		addNearTargetSource: noop,
		addNearTargetLayer: noop,
		setNearTarget: noop,
		nearestStops: () => [],
		centerFromProviderBbox: () => [-73.72, 45.52],
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
	harness.goto.mockClear();
	harness.afterNavigate.mockClear();
	harness.createLiveStore.mockClear();
	harness.identityReceivers.length = 0;
});

describe('MapHero mobile alert drilldown orchestrator', () => {
	it('swaps custom detail in place, preserves alert identity, and restores Back without redirecting', async () => {
		const documentPathBefore = window.location.pathname;
		render(MapHero);
		expect(harness.createLiveStore.mock.calls[0]?.[1]).toEqual({
			families: ['vehicles', 'trips', 'departures', 'alerts'],
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
