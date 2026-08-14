import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
	listeners: new Map<string, (event: unknown) => void>(),
}));

vi.mock('$service-worker', () => ({
	build: [
		'/_app/immutable/entry/start.abc123.js',
		'/_app/immutable/chunks/MapHero.def456.js',
		'/_app/immutable/chunks/vendor-maplibre.ghi789.js',
		'/_app/immutable/assets/maplibre.jkl012.css',
	],
	files: [
		'/offline.html',
		'/favicon.svg',
		'/fonts/inter-latin.woff2',
		'/map/basemap-montreal-dark-mobile-20260812.avif',
		'/map/basemap-montreal-light-mobile-20260812.avif',
		'/map/basemap-montreal-dark-desktop-20260812.avif',
		'/map/basemap-montreal-light-desktop-20260812.avif',
	],
	version: 'integration-test',
}));

beforeAll(async () => {
	const worker = {
		location: { origin: 'https://transit.yesid.dev' },
		addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
			runtime.listeners.set(type, listener);
		}),
		skipWaiting: vi.fn(),
		registration: { unregister: vi.fn() },
		clients: { claim: vi.fn(), matchAll: vi.fn().mockResolvedValue([]) },
	};
	Object.defineProperty(globalThis, 'self', { configurable: true, value: worker });
	Object.defineProperty(globalThis, 'caches', {
		configurable: true,
		value: {
			open: vi.fn(),
			keys: vi.fn().mockResolvedValue([]),
			delete: vi.fn(),
		},
	});
	await import('../../service-worker');
});

beforeEach(() => {
	vi.restoreAllMocks();
});

function dispatchFetch(request: Request) {
	const respondWith = vi.fn();
	const waitUntil = vi.fn();
	const listener = runtime.listeners.get('fetch');
	if (!listener) throw new Error('service worker fetch listener was not registered');
	listener({ request, respondWith, waitUntil });
	return { respondWith, waitUntil };
}

function dispatchInstall() {
	const waitUntil = vi.fn();
	const listener = runtime.listeners.get('install');
	if (!listener) throw new Error('service worker install listener was not registered');
	listener({ waitUntil });
	return waitUntil.mock.calls[0]?.[0] as Promise<void>;
}

describe('service-worker install wiring', () => {
	it('precaches non-map static files and offline, never build chunks or map posters', async () => {
		const add = vi.fn().mockResolvedValue(undefined);
		vi.mocked(caches.open).mockResolvedValue({ add } as unknown as Cache);

		await dispatchInstall();

		const requests = add.mock.calls.map(([request]) => request as Request);
		expect(requests.map((request) => request.url)).toEqual([
			'https://transit.yesid.dev/offline.html',
			'https://transit.yesid.dev/favicon.svg',
			'https://transit.yesid.dev/fonts/inter-latin.woff2',
		]);
		expect(requests.every((request) => request.cache === 'reload')).toBe(true);
		expect(requests.some((request) => request.url.includes('/_app/immutable/'))).toBe(false);
		expect(requests.some((request) => request.url.includes('/map/basemap-montreal-'))).toBe(false);
	});
});

describe('service-worker fetch wiring', () => {
	it('caches a requested immutable chunk on demand after an install cache miss', async () => {
		const put = vi.fn().mockResolvedValue(undefined);
		const match = vi.fn().mockResolvedValue(undefined);
		vi.mocked(caches.open).mockResolvedValue({ match, put } as unknown as Cache);
		const response = new Response('chunk', {
			status: 200,
			headers: { 'content-type': 'text/javascript' },
		});
		Object.defineProperty(response, 'type', { configurable: true, value: 'basic' });
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
		const request = new Request(
			'https://transit.yesid.dev/_app/immutable/chunks/MapHero.def456.js',
		);

		const event = dispatchFetch(request);
		expect(event.respondWith).toHaveBeenCalledOnce();
		await expect(event.respondWith.mock.calls[0]?.[0]).resolves.toBe(response);

		expect(match).toHaveBeenCalledExactlyOnceWith(request);
		expect(put).toHaveBeenCalledOnce();
	});

	it('does not call respondWith for either direct-R2 or compatibility snapshot reads', () => {
		const direct = dispatchFetch(
			new Request('https://data.yesid.dev/v1/stm/manifest.json', {
				headers: { accept: 'application/json' },
			}),
		);
		const compatibility = dispatchFetch(
			new Request('https://transit.yesid.dev/data/v1/stm/manifest.json', {
				headers: { accept: 'application/json' },
			}),
		);

		expect(direct.respondWith).not.toHaveBeenCalled();
		expect(compatibility.respondWith).not.toHaveBeenCalled();
	});

	it('leaves arbitrary same-origin data navigation fetches on the native network path', () => {
		const event = dispatchFetch(
			new Request('https://transit.yesid.dev/lines/51?tab=schedule', {
				headers: { accept: 'application/json' },
			}),
		);

		expect(event.respondWith).not.toHaveBeenCalled();
	});

	it('still wires HTML navigations to the network-first strategy', async () => {
		const response = new Response('<!doctype html>', {
			headers: { 'content-type': 'text/html' },
		});
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
		const event = dispatchFetch(
			new Request('https://transit.yesid.dev/lines/51?tab=schedule', {
				headers: { accept: 'text/html' },
			}),
		);

		expect(event.respondWith).toHaveBeenCalledOnce();
		await expect(event.respondWith.mock.calls[0]?.[0]).resolves.toBe(response);
	});
});
