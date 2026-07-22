import { describe, expect, it, vi } from 'vitest';
import { serverV1Context } from './serverContext';

function fetchSpy(): typeof fetch {
	return vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
}

describe('serverV1Context', () => {
	it('prefers the direct R2 bucket over the quota-bearing DATA Worker binding', async () => {
		const requestFetch = fetchSpy();
		const workerFetch = fetchSpy();
		const bucketGet = vi.fn(async () => ({
			body: JSON.stringify({ id: '24' }),
			httpEtag: '"route-24"',
			writeHttpMetadata(headers: Headers) {
				headers.set('content-type', 'application/json');
			},
		}));
		const ctx = serverV1Context({
			fetch: requestFetch,
			locals: { v1Cache: new Map() },
			platform: {
				env: {
					SNAPSHOTS: { get: bucketGet },
					DATA: { fetch: workerFetch },
				},
			},
			url: new URL('https://transit.yesid.dev/lines/24'),
		});

		const response = await ctx.fetch?.('https://data.yesid.dev/v1/stm/static/routes/24.json');

		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual({ id: '24' });
		expect(bucketGet).toHaveBeenCalledWith('v1/stm/static/routes/24.json', expect.any(Object));
		expect(workerFetch).not.toHaveBeenCalled();
		expect(requestFetch).not.toHaveBeenCalled();
	});

	it('retries through the compatibility Worker only when the direct R2 binding throws', async () => {
		const workerFetch = fetchSpy();
		const bucketGet = vi.fn(async () => {
			throw new Error('temporary R2 binding failure');
		});
		const ctx = serverV1Context({
			fetch: fetchSpy(),
			locals: {},
			platform: {
				env: {
					SNAPSHOTS: { get: bucketGet },
					DATA: { fetch: workerFetch },
				},
			},
			url: new URL('https://transit.yesid.dev/network'),
		});

		const response = await ctx.fetch?.('https://data.yesid.dev/v1/stm/manifest.json');

		expect(response?.status).toBe(200);
		expect(bucketGet).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(workerFetch).mock.calls[0][0])).toBe(
			'https://transit.yesid.dev/data/v1/stm/manifest.json',
		);
	});

	it.each([
		['DOMException AbortError', new DOMException('Aborted', 'AbortError')],
		['DOMException TimeoutError', new DOMException('Timed out', 'TimeoutError')],
		['Error AbortError', Object.assign(new Error('Aborted'), { name: 'AbortError' })],
		['Error TimeoutError', Object.assign(new Error('Timed out'), { name: 'TimeoutError' })],
	])('does not retry %s through the compatibility Worker', async (_name, failure) => {
		const workerFetch = fetchSpy();
		const bucketGet = vi.fn(async () => {
			throw failure;
		});
		const ctx = serverV1Context({
			fetch: fetchSpy(),
			locals: {},
			platform: {
				env: {
					SNAPSHOTS: { get: bucketGet },
					DATA: { fetch: workerFetch },
				},
			},
			url: new URL('https://transit.yesid.dev/network'),
		});

		const caught = await ctx.fetch?.('https://data.yesid.dev/v1/stm/manifest.json').then(
			() => undefined,
			(error: unknown) => error,
		);

		expect.soft(caught).toBe(failure);
		expect.soft(workerFetch).not.toHaveBeenCalled();
	});

	it('uses the Cloudflare DATA binding and preserves the per-request cache when available', async () => {
		const requestFetch = fetchSpy();
		const bindingFetch = fetchSpy();
		const cache = new Map<string, unknown>();
		const ctx = serverV1Context({
			fetch: requestFetch,
			locals: { v1Cache: cache },
			platform: { env: { DATA: { fetch: bindingFetch } } },
			url: new URL('https://transit.yesid.dev/lines/24'),
		});

		await ctx.fetch?.('/data/v1/stm/routes/24.json');

		expect(bindingFetch).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(bindingFetch).mock.calls[0][0])).toBe(
			'https://transit.yesid.dev/data/v1/stm/routes/24.json',
		);
		expect(requestFetch).not.toHaveBeenCalled();
		expect(ctx.cache).toBe(cache);
	});

	it('maps the public direct-R2 URL back to the compatibility Worker route', async () => {
		const workerFetch = fetchSpy();
		const ctx = serverV1Context({
			fetch: fetchSpy(),
			locals: {},
			platform: { env: { DATA: { fetch: workerFetch } } },
			url: new URL('https://transit.yesid.dev/network'),
		});

		await ctx.fetch?.('https://data.yesid.dev/v1/stm/manifest.json');

		expect(String(vi.mocked(workerFetch).mock.calls[0][0])).toBe(
			'https://transit.yesid.dev/data/v1/stm/manifest.json',
		);
	});

	it('falls back to the request fetch when the DATA binding is absent', async () => {
		const requestFetch = fetchSpy();
		const ctx = serverV1Context({
			fetch: requestFetch,
			locals: {},
			platform: undefined,
			url: new URL('http://localhost:5173/stop/1234'),
		});

		await ctx.fetch?.('/data/v1/stm/stops/1234.json');

		expect(requestFetch).toHaveBeenCalledWith('/data/v1/stm/stops/1234.json');
	});
});
