import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
	listeners: new Map<string, (event: unknown) => void>(),
}));

vi.mock('$service-worker', () => ({ build: [], files: [], version: 'integration-test' }));

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

describe('service-worker fetch wiring', () => {
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
