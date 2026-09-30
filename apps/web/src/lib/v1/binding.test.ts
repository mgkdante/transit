import { describe, expect, it, vi } from 'vitest';
import { r2BucketFetch, type R2ObjectBinding } from './binding';

const ORIGIN = 'https://transit.yesid.dev';
const object: R2ObjectBinding = {
	body: '{"provider":"stm"}',
	httpEtag: '"manifest-rev-7"',
	writeHttpMetadata(headers) {
		headers.set('content-type', 'application/json');
		headers.set('cache-control', 'public, max-age=30');
	},
};

describe('direct SSR snapshot adaptation', () => {
	it.each([
		'/data/v1/stm/manifest.json',
		'https://data.yesid.dev/v1/stm/manifest.json',
		new URL('https://data.yesid.dev/v1/stm/manifest.json'),
		new Request('https://data.yesid.dev/v1/stm/manifest.json'),
	])('maps %s to the bucket key and serves publisher metadata', async (input) => {
		const get = vi.fn(async (_key: string) => object);
		const response = await r2BucketFetch({ get }, ORIGIN)(input);
		expect(get.mock.calls[0]?.[0]).toBe('v1/stm/manifest.json');
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('public, max-age=30');
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
		expect(await response.json()).toEqual({ provider: 'stm' });
	});
	it('applies RequestInit overrides before serving the direct object', async () => {
		const get = vi.fn();
		const head = vi.fn(async () => object);
		const response = await r2BucketFetch({ get, head }, ORIGIN)(
			new Request(`${ORIGIN}/data/v1/stm/manifest.json`),
			{ method: 'HEAD' },
		);
		expect(head).toHaveBeenCalledWith('v1/stm/manifest.json');
		expect(get).not.toHaveBeenCalled();
		expect(await response.text()).toBe('');
	});
	it.each(['/outside.json', '/data/v1/%ZZ', '/data/v1/stm/%2e%2e%2fprivate.json'])(
		'rejects invalid key %s before reading R2',
		async (input) => {
			const get = vi.fn();
			expect((await r2BucketFetch({ get }, ORIGIN)(input)).status).toBe(404);
			expect(get).not.toHaveBeenCalled();
		},
	);
	it('keeps internal missing-object and method errors separate from public CORS', async () => {
		const get = vi.fn(async () => null);
		const read = r2BucketFetch({ get }, ORIGIN);
		const missing = await read('/data/v1/stm/manifest.json');
		expect(missing.status).toBe(404);
		expect(missing.headers.has('cache-control')).toBe(false);
		const unsupported = await read('/data/v1/stm/manifest.json', { method: 'POST' });
		expect(unsupported.status).toBe(405);
		expect(unsupported.headers.get('allow')).toBe('GET, HEAD');
		expect(get).toHaveBeenCalledTimes(1);
	});
});
