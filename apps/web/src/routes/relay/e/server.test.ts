import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ PUBLIC_PLAUSIBLE_DOMAIN: 'transit.yesid.dev' }));
vi.mock('$app/env/public', () => env);

const { POST } = await import('./+server');

const pageview = {
	n: 'pageview',
	d: 'transit.yesid.dev',
	u: 'https://transit.yesid.dev/lines',
	r: null,
};

function call(body: unknown) {
	const request = new Request('https://transit.yesid.dev/relay/e', {
		method: 'POST',
		headers: { 'Content-Type': 'text/plain', 'User-Agent': 'Agent/1.0' },
		body: JSON.stringify(body),
	});
	return POST({ request, getClientAddress: () => '203.0.113.7' } as Parameters<typeof POST>[0]);
}

afterEach(() => {
	vi.unstubAllGlobals();
	env.PUBLIC_PLAUSIBLE_DOMAIN = 'transit.yesid.dev';
});

describe('POST /relay/e', () => {
	it('forwards a Transit pageview to Plausible once, with the visitor address', async () => {
		const upstream = vi.fn(async () => new Response('ok', { status: 202 }));
		vi.stubGlobal('fetch', upstream);

		const response = await call(pageview);

		expect(response.status).toBe(202);
		expect(upstream).toHaveBeenCalledOnce();
		const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://plausible.io/api/event');
		expect(init.headers).toMatchObject({
			'X-Forwarded-For': '203.0.113.7',
			'User-Agent': 'Agent/1.0',
		});
	});

	it('answers 502 without a retry when Plausible fails', async () => {
		const upstream = vi.fn(async () => new Response('', { status: 500 }));
		vi.stubGlobal('fetch', upstream);

		expect((await call(pageview)).status).toBe(502);
		expect(upstream).toHaveBeenCalledOnce();
	});

	it('refuses an event for the parent yesid.dev site, so a visit is never counted under both', async () => {
		const upstream = vi.fn();
		vi.stubGlobal('fetch', upstream);

		expect((await call({ ...pageview, d: 'yesid.dev' })).status).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('is absent where measurement is off', async () => {
		env.PUBLIC_PLAUSIBLE_DOMAIN = '';
		const upstream = vi.fn();
		vi.stubGlobal('fetch', upstream);

		expect((await call(pageview)).status).toBe(404);
		expect(upstream).not.toHaveBeenCalled();
	});
});
