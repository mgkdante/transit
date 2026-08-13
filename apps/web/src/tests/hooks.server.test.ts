import { describe, expect, it, vi } from 'vitest';
import { handle } from '../hooks.server';

interface CacheHarness {
	readonly match: ReturnType<typeof vi.fn>;
	readonly put: ReturnType<typeof vi.fn>;
	readonly waitUntil: ReturnType<typeof vi.fn>;
	readonly writes: Promise<unknown>[];
}

function cacheHarness(hit?: Response): CacheHarness {
	const writes: Promise<unknown>[] = [];
	return {
		match: vi.fn(async () => hit),
		put: vi.fn(async () => undefined),
		waitUntil: vi.fn((promise: Promise<unknown>) => writes.push(promise)),
		writes,
	};
}

function event(
	url = 'https://transit.yesid.dev/',
	options: {
		readonly method?: string;
		readonly headers?: HeadersInit;
		readonly cache?: CacheHarness;
	} = {},
): Parameters<typeof handle>[0]['event'] {
	const cache = options.cache;
	return {
		url: new URL(url),
		request: new Request(url, {
			method: options.method ?? 'GET',
			headers: options.headers,
		}),
		locals: {},
		platform:
			cache == null
				? undefined
				: ({
						caches: { default: { match: cache.match, put: cache.put } },
						ctx: { waitUntil: cache.waitUntil },
					} as unknown as App.Platform),
	} as Parameters<typeof handle>[0]['event'];
}

function html(body = 'fresh', init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set('content-type', 'text/html; charset=utf-8');
	return new Response(body, { ...init, headers });
}

describe('server request locale', () => {
	it('stores the path locale for error layouts that have no route params', async () => {
		const request = event('https://transit.yesid.dev/fr/missing-route');
		const resolve = vi.fn(async () => new Response('ok'));

		await handle({ event: request, resolve });

		expect(request.locals.locale).toBe('fr');
		expect(request.locals.v1Cache).toBeInstanceOf(Map);
	});
});

describe('server HTML edge cache', () => {
	it('serves an exact-URL cache hit without invoking SvelteKit and reapplies security headers', async () => {
		const cache = cacheHarness(html('cached'));
		const request = event('https://transit.yesid.dev/fr/metrics?grain=week', { cache });
		const resolve = vi.fn(async () => html('fresh'));

		const response = await handle({ event: request, resolve });

		expect(await response.text()).toBe('cached');
		expect(resolve).not.toHaveBeenCalled();
		expect(cache.match).toHaveBeenCalledTimes(1);
		const key = cache.match.mock.calls[0]?.[0] as Request;
		expect(key.method).toBe('GET');
		expect(key.url).toBe('https://transit.yesid.dev/fr/metrics?grain=week');
		expect(response.headers.get('x-transit-edge-cache')).toBe('HIT');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('content-security-policy')).toBeTruthy();
		expect(cache.put).not.toHaveBeenCalled();
	});

	it('stores a safe anonymous HTML miss for 30 seconds without exposing that TTL publicly', async () => {
		const cache = cacheHarness();
		const request = event('https://transit.yesid.dev/lines/24?tab=detail', { cache });
		const resolve = vi.fn(async () => html('fresh'));

		const response = await handle({ event: request, resolve });
		await Promise.all(cache.writes);

		expect(await response.text()).toBe('fresh');
		expect(response.headers.get('x-transit-edge-cache')).toBe('MISS');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(cache.put).toHaveBeenCalledTimes(1);
		expect(cache.waitUntil).toHaveBeenCalledTimes(1);
		const [key, stored] = cache.put.mock.calls[0] as [Request, Response];
		expect(key.url).toBe('https://transit.yesid.dev/lines/24?tab=detail');
		expect(key.method).toBe('GET');
		expect(stored.headers.get('content-security-policy')).toBeTruthy();
		expect(stored.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=30');
		expect(stored.headers.get('x-transit-edge-cache')).toBeNull();
	});

	it.each([
		['cookie', { cookie: 'session=private' }],
		['authorization', { authorization: 'Bearer private' }],
		['range', { range: 'bytes=0-99' }],
		['request no-cache', { 'cache-control': 'no-cache' }],
		['request no-store', { 'cache-control': 'no-store' }],
	])('bypasses both cache reads and writes for %s requests', async (_label, headers) => {
		const cache = cacheHarness(html('cached'));
		const request = event('https://transit.yesid.dev/metrics', { cache, headers });
		const resolve = vi.fn(async () => html('fresh'));

		const response = await handle({ event: request, resolve });

		expect(await response.text()).toBe('fresh');
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(cache.match).not.toHaveBeenCalled();
		expect(cache.put).not.toHaveBeenCalled();
		expect(response.headers.get('x-transit-edge-cache')).toBe('BYPASS');
	});

	it.each([
		['POST', html()],
		['GET', html('not found', { status: 404 })],
		['GET', new Response('{}', { headers: { 'content-type': 'application/json' } })],
		['GET', html('private', { headers: { 'cache-control': 'private, no-store' } })],
		['GET', html('cookie', { headers: { 'set-cookie': 'session=secret' } })],
	] as const)('does not store an unsafe %s response variant', async (method, resolved) => {
		const cache = cacheHarness();
		const request = event('https://transit.yesid.dev/metrics', { cache, method });

		await handle({ event: request, resolve: vi.fn(async () => resolved) });

		expect(cache.put).not.toHaveBeenCalled();
	});

	it('uses a cached GET representation for HEAD without returning a body', async () => {
		const cache = cacheHarness(html('cached'));
		const request = event('https://transit.yesid.dev/metrics', { cache, method: 'HEAD' });
		const resolve = vi.fn(async () => html('fresh'));

		const response = await handle({ event: request, resolve });

		expect(resolve).not.toHaveBeenCalled();
		expect(await response.text()).toBe('');
		expect(response.headers.get('content-type')).toContain('text/html');
		expect(response.headers.get('x-transit-edge-cache')).toBe('HIT');
	});

	it('fails open when cache reads or writes reject', async () => {
		const readFailure = cacheHarness();
		readFailure.match.mockRejectedValueOnce(new Error('cache read unavailable'));
		readFailure.put.mockRejectedValueOnce(new Error('cache write unavailable'));
		const resolve = vi.fn(async () => html('fresh'));

		const response = await handle({
			event: event('https://transit.yesid.dev/', { cache: readFailure }),
			resolve,
		});
		await expect(Promise.all(readFailure.writes)).resolves.toBeDefined();

		expect(await response.text()).toBe('fresh');
		expect(resolve).toHaveBeenCalledTimes(1);
	});
});
