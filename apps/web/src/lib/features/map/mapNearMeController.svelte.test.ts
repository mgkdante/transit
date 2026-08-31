import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GeocodedLocation } from '$lib/geocode/types';
import MapNearMeControllerHarness from './__fixtures__/MapNearMeControllerHarness.svelte';
import {
	createMapNearMeController,
	type MapNearMeControllerDependencies,
	type NearMeOrigin,
} from './mapNearMeController.svelte';

const translations = {
	nearMeUseLocation: 'Use my location',
	nearMeError: 'Could not find that place',
	nearMeGeoDenied: 'Location permission denied',
	nearMeGeoTimeout: 'Location timed out. Try again',
	nearMeGeoUnavailable: 'Location unavailable',
	nearMeGeoInsecure: 'Location needs a secure connection',
};

const target: NearMeOrigin = {
	lat: 45.501,
	lon: -73.601,
	label: 'Place des Arts',
	precision: 'address',
};

function geolocationError(code: number): GeolocationPositionError {
	return {
		code,
		message: 'test geolocation failure',
		PERMISSION_DENIED: 1,
		POSITION_UNAVAILABLE: 2,
		TIMEOUT: 3,
	} as GeolocationPositionError;
}

function createHarness() {
	let positionSuccess: PositionCallback | undefined;
	let positionFailure: PositionErrorCallback | undefined;
	const currentUrl = new URL('http://localhost/map?route=24');
	const geolocation = {
		getCurrentPosition: vi.fn(
			(
				success: PositionCallback,
				failure?: PositionErrorCallback | null,
				_options?: PositionOptions,
			) => {
				positionSuccess = success;
				positionFailure = failure ?? undefined;
			},
		),
	} as unknown as Geolocation;
	const goto = vi.fn(async () => {});
	const focusOrigin = vi.fn();
	const readTarget = vi.fn(() => null as NearMeOrigin | null);
	const targetKey = vi.fn(
		(origin: NearMeOrigin) => `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}:${origin.label}`,
	);
	const buildTargetSearch = vi.fn(() => '?route=24&near=45.501000%2C-73.601000');
	const clearTargetSearch = vi.fn(() => '?route=24');
	const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
	let secureContext = true;
	let geolocationAvailable = true;

	const dependencies: MapNearMeControllerDependencies = {
		goto,
		currentUrl: () => currentUrl,
		readTarget,
		targetKey,
		buildTargetSearch,
		clearTargetSearch,
		focusOrigin,
		fetch,
		getGeolocation: () => (geolocationAvailable ? geolocation : null),
		isSecureContext: () => secureContext,
		translations,
	};

	return {
		controller: createMapNearMeController(dependencies),
		goto,
		focusOrigin,
		readTarget,
		targetKey,
		buildTargetSearch,
		clearTargetSearch,
		fetch,
		geolocation,
		succeedPosition(lat = 45.51, lon = -73.57) {
			positionSuccess?.({
				coords: { latitude: lat, longitude: lon },
			} as GeolocationPosition);
		},
		failPosition(code: number) {
			positionFailure?.(geolocationError(code));
		},
		setSecureContext(next: boolean) {
			secureContext = next;
		},
		setGeolocationAvailable(next: boolean) {
			geolocationAvailable = next;
		},
	};
}

function submitEvent() {
	return { preventDefault: vi.fn() } as unknown as SubmitEvent;
}

afterEach(() => cleanup());

describe('map near-me controller', () => {
	it('keeps member bindings reactive for controller and input writes', async () => {
		const harness = createHarness();
		harness.controller.query = 'stale query';
		harness.readTarget.mockReturnValue(target);
		render(MapNearMeControllerHarness, {
			props: { controller: harness.controller },
		});

		const open = screen.getByRole('checkbox', { name: 'near open' });
		const query = screen.getByRole('textbox', { name: 'near query' });
		expect(open).not.toBeChecked();
		expect(query).toHaveValue('stale query');

		await fireEvent.click(screen.getByRole('button', { name: 'ingest near target' }));
		await waitFor(() => {
			expect(open).toBeChecked();
			expect(query).toHaveValue('');
		});

		await fireEvent.input(query, { target: { value: 'Berri-UQAM' } });
		await fireEvent.click(open);
		expect(harness.controller.query).toBe('Berri-UQAM');
		expect(harness.controller.open).toBe(false);
	});

	it('syncs a local origin to the live URL by default and can suppress URL sync', () => {
		const first = createHarness();

		first.controller.setOrigin(target);

		expect(first.controller.origin).toEqual(target);
		expect(first.controller.error).toBeNull();
		expect(first.controller.urlKey).toBe('45.501000,-73.601000:Place des Arts');
		expect(first.buildTargetSearch).toHaveBeenCalledWith(
			new URLSearchParams('route=24'),
			'/map',
			target,
		);
		expect(first.goto).toHaveBeenCalledWith('?route=24&near=45.501000%2C-73.601000', {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
		expect(first.focusOrigin).toHaveBeenCalledWith(target);

		const second = createHarness();
		second.controller.setOrigin(target, { syncUrl: false });
		expect(second.goto).not.toHaveBeenCalled();
		expect(second.controller.urlKey).toBe('');
		expect(second.focusOrigin).toHaveBeenCalledWith(target);
	});

	it('keeps a device fix alive when a later URL sync carries no near target (S5-377 B1)', () => {
		const harness = createHarness();
		harness.controller.useLocation();
		harness.succeedPosition();
		expect(harness.controller.origin).not.toBeNull();

		// A filter toggle rewrites the query string with no near params; the
		// device fix is not URL-backed, so the sync-from must not destroy it.
		harness.readTarget.mockReturnValue(null);
		harness.controller.syncFromUrl(new URLSearchParams('routes=55'));
		expect(harness.controller.origin).not.toBeNull();
	});

	it('retires a URL-adopted origin when the URL drops the near params (S5-377 B1 inverse)', () => {
		const harness = createHarness();
		harness.readTarget.mockReturnValue(target);
		harness.controller.syncFromUrl(new URLSearchParams('near=45.501,-73.601'));
		expect(harness.controller.origin).toEqual(target);

		// The URL created it, the URL retires it.
		harness.readTarget.mockReturnValue(null);
		harness.controller.syncFromUrl(new URLSearchParams(''));
		expect(harness.controller.origin).toBeNull();
	});

	it('refocuses the current origin when the map becomes ready', () => {
		const harness = createHarness();
		harness.controller.refocus();
		expect(harness.focusOrigin).not.toHaveBeenCalled();

		harness.controller.setOrigin(target, { syncUrl: false });
		harness.focusOrigin.mockClear();
		harness.controller.refocus();

		expect(harness.focusOrigin).toHaveBeenCalledWith(target);
	});

	it('ingests a URL target once without writing it back', () => {
		const harness = createHarness();
		harness.controller.query = 'stale query';
		harness.readTarget.mockReturnValue(target);

		harness.controller.syncFromUrl(new URLSearchParams('near=45.501000%2C-73.601000'));
		harness.controller.syncFromUrl(new URLSearchParams('near=45.501000%2C-73.601000'));

		expect(harness.controller.open).toBe(true);
		expect(harness.controller.query).toBe('');
		expect(harness.controller.origin).toEqual(target);
		expect(harness.goto).not.toHaveBeenCalled();
		expect(harness.focusOrigin).toHaveBeenCalledOnce();
	});

	it('ignores the URL echo of a typed-search origin without clearing or repeating work', () => {
		const harness = createHarness();
		harness.controller.query = 'Place des Arts';
		harness.controller.setOrigin(target);
		harness.readTarget.mockReturnValue(target);

		harness.controller.syncFromUrl(new URLSearchParams('near=45.501000%2C-73.601000'));

		expect(harness.controller.query).toBe('Place des Arts');
		expect(harness.goto).toHaveBeenCalledOnce();
		expect(harness.focusOrigin).toHaveBeenCalledOnce();
	});

	it('clears local state and only removes near-me params from the live URL', () => {
		const harness = createHarness();
		harness.controller.open = true;
		harness.controller.query = 'Place des Arts';
		harness.controller.setOrigin(target);
		harness.goto.mockClear();

		harness.controller.clear();

		expect(harness.controller.open).toBe(true);
		expect(harness.controller.query).toBe('');
		expect(harness.controller.origin).toBeNull();
		expect(harness.controller.error).toBeNull();
		expect(harness.controller.urlKey).toBe('');
		expect(harness.clearTargetSearch).toHaveBeenCalledWith(new URLSearchParams('route=24'), '/map');
		expect(harness.goto).toHaveBeenCalledWith('?route=24', {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	});

	it('sets and focuses a successful device position, then clears loading', () => {
		const harness = createHarness();

		harness.controller.useLocation();
		expect(harness.controller.open).toBe(true);
		expect(harness.controller.loading).toBe(true);
		expect(harness.geolocation.getCurrentPosition).toHaveBeenCalledWith(
			expect.any(Function),
			expect.any(Function),
			{ enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
		);

		harness.succeedPosition();

		expect(harness.controller.loading).toBe(false);
		expect(harness.controller.origin).toEqual({
			lat: 45.51,
			lon: -73.57,
			label: 'Use my location',
			precision: 'place',
		});
		expect(harness.focusOrigin).toHaveBeenCalledWith(harness.controller.origin);
	});

	it('makes late geolocation callbacks inert after idempotent disposal', () => {
		const harness = createHarness();
		harness.controller.useLocation();
		expect(harness.controller.loading).toBe(true);

		harness.controller.dispose();
		harness.controller.dispose();
		harness.succeedPosition();
		harness.failPosition(1);

		expect(harness.controller.loading).toBe(false);
		expect(harness.controller.origin).toBeNull();
		expect(harness.controller.error).toBeNull();
		expect(harness.focusOrigin).not.toHaveBeenCalled();
		expect(harness.goto).not.toHaveBeenCalled();
	});

	it.each([
		[1, 'Location permission denied'],
		[3, 'Location timed out. Try again'],
		[2, 'Location unavailable'],
	])('maps geolocation failure code %s to the translated error', (code, expected) => {
		const harness = createHarness();

		harness.controller.useLocation();
		harness.failPosition(code);

		expect(harness.controller.loading).toBe(false);
		expect(harness.controller.error).toBe(expected);
		expect(harness.controller.origin).toBeNull();
	});

	it('rejects insecure or unavailable geolocation before requesting a position', () => {
		const insecure = createHarness();
		insecure.setSecureContext(false);
		insecure.controller.useLocation();
		expect(insecure.controller.error).toBe('Location needs a secure connection');
		expect(insecure.geolocation.getCurrentPosition).not.toHaveBeenCalled();

		const unavailable = createHarness();
		unavailable.setGeolocationAvailable(false);
		unavailable.controller.useLocation();
		expect(unavailable.controller.error).toBe('Location unavailable');
		expect(unavailable.geolocation.getCurrentPosition).not.toHaveBeenCalled();
	});

	it('resolves a text query through the injected fetch seam', async () => {
		const harness = createHarness();
		const result: GeocodedLocation = {
			...target,
			precision: 'address',
			source: 'geo_ca',
		};
		harness.fetch.mockResolvedValue({
			ok: true,
			json: async () => result,
		} as Response);
		harness.controller.query = '  Place des Arts  ';
		const event = submitEvent();

		await harness.controller.search(event);

		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(harness.fetch).toHaveBeenCalledWith('/api/geocode/montreal?q=Place%20des%20Arts', {
			signal: expect.any(AbortSignal),
		});
		expect(harness.controller.query).toBe('Place des Arts');
		expect(harness.controller.origin).toEqual(result);
		expect(harness.controller.loading).toBe(false);
	});

	it('aborts a pending geocode fetch and ignores a forced late response', async () => {
		const harness = createHarness();
		let resolveFetch!: (response: Response) => void;
		harness.fetch.mockReturnValue(
			new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			}),
		);
		harness.controller.query = 'Place des Arts';
		const pending = harness.controller.search(submitEvent());
		await waitFor(() => expect(harness.fetch).toHaveBeenCalledOnce());
		const signal = harness.fetch.mock.lastCall?.[1]?.signal;
		expect(signal?.aborted).toBe(false);

		harness.controller.dispose();
		expect(signal?.aborted).toBe(true);
		resolveFetch({ ok: true, json: async () => target } as Response);
		await pending;

		expect(harness.controller.loading).toBe(false);
		expect(harness.controller.origin).toBeNull();
		expect(harness.controller.error).toBeNull();
		expect(harness.focusOrigin).not.toHaveBeenCalled();
		expect(harness.goto).not.toHaveBeenCalled();
	});

	it('ignores geocode JSON that resolves after disposal', async () => {
		const harness = createHarness();
		let resolveJson!: (result: GeocodedLocation) => void;
		const json = vi.fn(
			() =>
				new Promise<GeocodedLocation>((resolve) => {
					resolveJson = resolve;
				}),
		);
		harness.fetch.mockResolvedValue({ ok: true, json } as unknown as Response);
		harness.controller.query = 'Place des Arts';
		const pending = harness.controller.search(submitEvent());
		await waitFor(() => expect(json).toHaveBeenCalledOnce());

		harness.controller.dispose();
		resolveJson(target as GeocodedLocation);
		await pending;

		expect(harness.controller.loading).toBe(false);
		expect(harness.controller.origin).toBeNull();
		expect(harness.controller.error).toBeNull();
		expect(harness.focusOrigin).not.toHaveBeenCalled();
		expect(harness.goto).not.toHaveBeenCalled();
	});

	it('accepts an in-bounds coordinate query without fetching', async () => {
		const harness = createHarness();
		harness.controller.query = '45.5, -73.6';

		await harness.controller.search(submitEvent());

		expect(harness.fetch).not.toHaveBeenCalled();
		expect(harness.controller.origin).toEqual({
			lat: 45.5,
			lon: -73.6,
			label: '45.5, -73.6',
			precision: 'address',
		});
	});

	it('selects a Geo.ca suggestion directly without another provider request', async () => {
		const harness = createHarness();
		const result: GeocodedLocation = {
			...target,
			precision: 'address',
			source: 'geo_ca',
		};

		await harness.controller.selectSuggestion(result);

		expect(harness.fetch).not.toHaveBeenCalled();
		expect(harness.controller.query).toBe(result.label);
		expect(harness.controller.origin).toEqual(result);
		expect(harness.controller.loading).toBe(false);
	});

	it('surfaces a failed query and clears the loading state', async () => {
		const harness = createHarness();
		harness.fetch.mockRejectedValue(new Error('offline'));
		harness.controller.query = 'Unknown';

		await harness.controller.search(submitEvent());

		expect(harness.controller.error).toBe('Could not find that place');
		expect(harness.controller.loading).toBe(false);
		expect(harness.controller.origin).toBeNull();
	});
});
